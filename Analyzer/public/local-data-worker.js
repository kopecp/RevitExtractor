import { PropertyIndex } from './property-index.js';
import { SourceModelIndex } from './source-model-index.js';
import { readLocalFile } from './local-export.js';

const exports = new Map();
let activeId, store, sources, database, sqlModule;
async function activate(id) {
  if (activeId === id) return;
  const entry = exports.get(id);
  if (!entry) throw new Error('Wybierz ponownie folder eksportu.');
  database?.close(); database = null; store = null; sources = null; activeId = null;
  const data = {};
  for (const name of ['attrs', 'vals', 'avs', 'ids', 'offs']) {
    const file = await readLocalFile(entry.files.get(`Resource/objects_${name}.json.gz`));
    data[name] = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }
  store = new PropertyIndex(data);
  let metadata = null;
  try { metadata = JSON.parse(await (await readLocalFile(entry.files.get('Resource/AECModelData.json'))).text()); } catch { /* Optional metadata. */ }
  sources = new SourceModelIndex(store, { exportId: id, name: entry.info.name, metadata });
  activeId = id;
}

async function query(message) {
  if (message.type === 'register') { exports.set(message.info.id, message); return null; }
  const url = new URL(message.url, 'https://local.invalid');
  const [, , , id, operation, arg] = url.pathname.split('/');
  await activate(id);
  const params = url.searchParams;
  const integer = (key, fallback, max) => Math.min(max, Math.max(0, Number.parseInt(params.get(key), 10) || fallback));
  const offset = integer('offset', 0, 10_000_000), limit = integer('limit', 80, 200);
  if (operation === 'stats') return { total: store.rows.length, categories: store.categories, attributes: store.attrs.length - 1, hasSqlite: exports.get(id).info.hasSqlite };
  if (operation === 'elements') {
    if (!arg) return store.search({ query: params.get('q') || '', category: params.get('category') || '', offset, limit });
    const result = store.detail(Number(arg));
    if (!result) throw new Error('Brak tego obiektu w bazie.');
    return result;
  }
  if (operation === 'source-models') return sources.tree(JSON.parse(message.body).ids);
  if (operation === 'tables') {
    if (!['_objects_id', '_objects_attr', '_objects_val', '_objects_eav'].includes(arg)) throw new Error('Nieznana tabela.');
    if (!database) {
      // Load SQLite only when the user requests a raw table. Source file is untouched.
      const { default: initSqlJs } = await import('./vendor/sqljs/sql-wasm.mjs');
      sqlModule ||= await initSqlJs({ locateFile: file => new URL(`./vendor/sqljs/${file}`, import.meta.url).href });
      const file = await readLocalFile(exports.get(id).files.get('Resource/model.sdb'));
      database = new sqlModule.Database(new Uint8Array(await file.arrayBuffer()));
      database.run('PRAGMA query_only = ON');
    }
    const statement = database.prepare(`SELECT * FROM "${arg}" ORDER BY id LIMIT ? OFFSET ?`);
    let columns, rows = [];
    try {
      statement.bind([limit, offset]); columns = statement.getColumnNames();
      while (statement.step()) rows.push(statement.getAsObject());
    } finally { statement.free(); }
    const total = database.exec(`SELECT COUNT(*) FROM "${arg}"`)[0].values[0][0];
    return { rows, columns, total, offset, limit };
  }
  throw new Error('Nieobsługiwana operacja.');
}

// Serial queue prevents a concurrent export switch from mixing two databases.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { self.postMessage({ requestId: data.requestId, result: await query(data) }); }
    catch (error) { self.postMessage({ requestId: data.requestId, error: error.message }); }
  });
};
