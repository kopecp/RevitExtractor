import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'dist');
// Fixed output directory, never derived from a user's export path.
await fs.rm(destination, { recursive: true, force: true });
await fs.cp(path.join(root, 'public'), destination, { recursive: true });
const indexPath = path.join(destination, 'index.html');
await fs.writeFile(indexPath, (await fs.readFile(indexPath, 'utf8')).replace('<html lang="pl">', '<html lang="pl" data-mode="browser">'));
const pdfRoot = path.join(root, 'node_modules/pdfjs-dist');
for (const name of ['build', 'cmaps', 'standard_fonts', 'wasm', 'LICENSE']) {
  await fs.cp(path.join(pdfRoot, name), path.join(destination, 'vendor/pdfjs', name), { recursive: true });
}
const sqlRoot = path.join(root, 'node_modules/sql.js');
const sqlDestination = path.join(destination, 'vendor/sqljs');
await fs.mkdir(sqlDestination, { recursive: true });
// sql.js UMD assigns to `module`; declare it locally for strict ES-module scope.
// Expose its initializer for the module worker without eval or global scripts.
await fs.writeFile(path.join(sqlDestination, 'sql-wasm.mjs'), 'var module;\n' + (await fs.readFile(path.join(sqlRoot, 'dist/sql-wasm.js'), 'utf8')) + '\nexport default initSqlJs;\n');
await fs.copyFile(path.join(sqlRoot, 'dist/sql-wasm.wasm'), path.join(sqlDestination, 'sql-wasm.wasm'));
await fs.copyFile(path.join(sqlRoot, 'LICENSE'), path.join(sqlDestination, 'LICENSE'));
await fs.writeFile(path.join(destination, '.nojekyll'), '');
console.log(`GitHub Pages: ${destination} (application only; no model exports)`);
