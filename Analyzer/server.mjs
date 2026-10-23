import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExportRegistry, inside } from './lib/exports.mjs';
import { SourceModelIndex, readSourceMetadata } from './lib/source-models.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.gz': 'application/gzip', '.ico': 'image/x-icon' };
const integer = (value, fallback, max) => Math.min(max, Math.max(0, Number.parseInt(value, 10) || fallback));

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req, maxBytes = 16_384) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Zbyt duże żądanie.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

async function serve(req, res, file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
  const headers = { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  let start = 0; let end = stat.size - 1; let status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    status = 206;
  }
  headers['Content-Length'] = stat.size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export async function createAnalyzer({ discover = true, parent = path.dirname(ROOT) } = {}) {
  const registry = new ExportRegistry();
  if (discover) await registry.discover(parent);
  const token = randomBytes(24).toString('hex');
  let picking = false;
  const server = http.createServer(async (req, res) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) console.warn(`${res.statusCode} ${req.method} ${req.url}`);
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const port = server.address().port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Dozwolony jest tylko dostęp lokalny.' });
    if (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'Niedozwolone pochodzenie żądania.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Niedozwolone pochodzenie żądania.' });
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (req.method === 'POST') {
        if (req.headers['x-analyzer-token'] !== token) return json(res, 403, { error: 'Odśwież stronę i spróbuj ponownie.' });
        if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'exports' && parts[3] === 'source-models') {
          const item = registry.get(parts[2]);
          const data = await body(req, 12_000_000);
          if (!Array.isArray(data.ids) || data.ids.length > 1_000_000 || data.ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) throw new Error('Nieprawidłowa lista identyfikatorów geometrii.');
          const store = registry.store(item.id);
          store.sourceModels ||= new SourceModelIndex(store, { exportId: item.id, name: item.name, metadata: readSourceMetadata(path.join(item.root, 'Resource')) });
          return json(res, 200, store.sourceModels.tree(data.ids));
        }
        if (url.pathname === '/api/open') {
          const data = await body(req);
          if (typeof data.path !== 'string' || !data.path.trim()) throw new Error('Podaj ścieżkę folderu output.');
          return json(res, 200, await registry.register(data.path));
        }
        if (url.pathname === '/api/pick-folder') {
          if (process.platform !== 'win32') throw new Error('Wklej ścieżkę folderu w polu poniżej.');
          if (picking) throw new Error('Okno wyboru folderu jest już otwarte.');
          picking = true;
          try {
            const script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Wybierz folder output z RevitExtractor'; $dialog.ShowNewFolderButton = $false; if ($dialog.ShowDialog() -eq 'OK') { [Console]::Write($dialog.SelectedPath) }; $dialog.Dispose()";
            const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 300000 });
            return json(res, 200, stdout.trim() ? await registry.register(stdout.trim()) : { cancelled: true });
          } finally { picking = false; }
        }
        return json(res, 404, { error: 'Nieznana operacja.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Metoda niedozwolona.' });
      if (url.pathname === '/api/session') return json(res, 200, { token, exports: [...registry.items.values()], folderPicker: process.platform === 'win32' });
      if (parts[0] === 'api' && parts[1] === 'exports' && parts[2]) {
        const item = registry.get(parts[2]);
        const params = url.searchParams;
        if (!parts[3]) return json(res, 200, item);
        const store = registry.store(item.id);
        if (parts[3] === 'stats') return json(res, 200, { total: store.rows.length, categories: store.categories, attributes: store.attrs.length - 1, hasSqlite: store.hasSqlite });
        if (parts[3] === 'elements') {
          if (parts[4]) {
            const detail = store.detail(Number(parts[4]));
            return json(res, detail ? 200 : 404, detail || { error: 'Brak tego obiektu w bazie.' });
          }
          return json(res, 200, store.search({ query: params.get('q') || '', category: params.get('category') || '', offset: integer(params.get('offset'), 0, 10_000_000), limit: integer(params.get('limit'), 80, 200) }));
        }
        if (parts[3] === 'tables') return json(res, 200, store.table(parts[4], integer(params.get('offset'), 0, 10_000_000), integer(params.get('limit'), 80, 200)));
      }
      if (parts[0] === 'files' && parts[1]) {
        const item = registry.get(parts[1]);
        return await serve(req, res, await inside(item.root, parts.slice(2).join('/')));
      }
      if (parts[0] === 'vendor' && parts[1] === 'pdfjs') {
        return await serve(req, res, await inside(path.join(ROOT, 'node_modules', 'pdfjs-dist'), parts.slice(2).join('/')));
      }
      const publicRoot = path.join(ROOT, 'public');
      return await serve(req, res, await inside(publicRoot, url.pathname === '/' ? 'index.html' : parts.join('/')));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? 'Nie znaleziono pliku.' : error.message });
    }
  });
  return { server, registry };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output');
  const { server, registry } = await createAnalyzer({ discover: outputIndex === -1 });
  if (outputIndex !== -1 && process.argv[outputIndex + 1]) await registry.register(process.argv[outputIndex + 1]);
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex !== -1 ? process.argv[portIndex + 1] : process.env.PORT || 4317);
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} jest zajęty. Użyj: node server.mjs --port 4318` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`\nRevit Extractor / Analyzer\nLocal: ${url}\nEksporty: ${registry.items.size}\nCtrl+C zatrzymuje serwer.\n`);
    if (process.argv.includes('--open') && process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true });
  });
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}
