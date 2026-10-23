import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { ExportRegistry, resolveOutput, inside } from '../lib/exports.mjs';
import { createAnalyzer } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = process.env.ANALYZER_TEST_OUTPUT || path.join(ROOT, '..', 'test-333cd21fb42b444282bb5082acb2573d', 'output');
let registry, item, store, server, base, session, databaseHash;
const hashDatabase = async () => createHash('sha256').update(await fs.readFile(path.join(SAMPLE, 'Resource', 'model.sdb'))).digest('hex');

before(async () => {
  databaseHash = await hashDatabase();
  const app = await createAnalyzer({ discover: false });
  server = app.server; registry = app.registry;
  item = await registry.register(SAMPLE); store = registry.store(item.id);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  session = await (await fetch(`${base}/api/session`)).json();
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  assert.equal(await hashDatabase(), databaseHash, 'Source SQLite must remain byte-for-byte unchanged');
});

test('output, parent run and Resource resolve to the same export', async () => {
  for (const input of [SAMPLE, path.dirname(SAMPLE), path.join(SAMPLE, 'Resource')]) {
    assert.equal((await resolveOutput(input)).root, item.root);
  }
  assert.ok(item.views.some(view => view.role === '3d'));
  assert.equal(item.views.filter(view => view.role === '2d').length, item.pdfCount);
  for (const view of item.views) assert.ok((await fs.stat(await inside(item.root, view.path))).isFile());
});

test('gzip IDs and direct property values match the independent SQLite representation', () => {
  const db = new DatabaseSync(path.join(SAMPLE, 'Resource', 'model.sdb'), { readOnly: true });
  try {
    assert.equal(store.rows.length, db.prepare('SELECT COUNT(*) AS n FROM _objects_id').get().n);
    const selected = [1, 13, 3199, 5000, store.ids.length - 1];
    const properties = db.prepare('SELECT a.name, a.category, v.value FROM _objects_eav e JOIN _objects_attr a ON a.id=e.attribute_id JOIN _objects_val v ON v.id=e.value_id WHERE e.entity_id=?');
    for (const id of selected) {
      assert.equal(store.byId.get(id).externalId, db.prepare('SELECT external_id FROM _objects_id WHERE id=?').get(id).external_id);
      const actual = []; store.each(id, (attr, value) => actual.push({ name: attr[0], category: attr[1], value }));
      assert.deepEqual(actual, properties.all(id).map(row => ({ ...row })), `Properties differ for dbId ${id}`);
    }
  } finally { db.close(); }
});

test('type properties are inherited with instance values taking precedence', () => {
  const detail = store.detail(3199);
  assert.ok(detail.properties.length > 0);
  assert.ok(detail.properties.some(property => property.inherited));
  assert.equal(detail.elementId, 1365662);
  assert.equal(detail.category, 'Ducts');
  assert.equal(store.detail(-1), null);
});

test('filtering runs before pagination and covers records after the first page', () => {
  const first = store.search({ query: 'Round Duct', category: 'Ducts', limit: 3 });
  const second = store.search({ query: 'Round Duct', category: 'Ducts', offset: 3, limit: 3 });
  assert.ok(first.total > 6);
  assert.equal(first.total, second.total);
  assert.equal(first.rows.length, 3);
  assert.ok(second.rows.every(row => row.category === 'Ducts' && row.name.includes('Round Duct')));
  assert.ok(second.rows.every(row => !first.rows.some(previous => previous.dbId === row.dbId)));
  assert.equal(store.search({ query: 'no-results-__analyzer__' }).total, 0);
});

test('SVF with spaces and PDF range requests are served correctly', async () => {
  const view = item.views.find(view => view.role === '3d');
  const response = await fetch(`${base}${view.url}`);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, await fs.readFile(path.join(SAMPLE, view.path)));
  const pdf = item.views.find(view => view.role === '2d');
  const partial = await fetch(`${base}${pdf.url}`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), '%PDF-');
  assert.equal((await fetch(`${base}${pdf.url}`, { headers: { Range: 'bytes=999999999-' } })).status, 416);
});

test('file traversal and cross-origin requests are rejected', async () => {
  await assert.rejects(inside(item.root, '../index.json'));
  const response = await fetch(`${base}/files/${item.id}/Resource/%2e%2e%5c%2e%2e%5cindex.json`);
  assert.notEqual(response.status, 200);
  assert.equal((await fetch(`${base}/api/session`, { headers: { Origin: 'https://example.com' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/session`, { headers: { Host: `attacker.example:${server.address().port}` } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject);
  });
  assert.equal(foreignHost, 403);
});

test('mount requires the session token and invalid mounts preserve current exports', async () => {
  const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: SAMPLE }) };
  assert.equal((await fetch(`${base}/api/open`, post)).status, 403);
  const good = await fetch(`${base}/api/open`, { ...post, headers: { ...post.headers, 'X-Analyzer-Token': session.token } });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).id, item.id);
  const bad = await fetch(`${base}/api/open`, { ...post, headers: { ...post.headers, 'X-Analyzer-Token': session.token }, body: JSON.stringify({ path: ROOT }) });
  assert.equal(bad.status, 400);
  assert.equal(registry.items.size, 1);
});

test('SQLite table API is paginated and allowlisted', async () => {
  const result = await (await fetch(`${base}/api/exports/${item.id}/tables/_objects_id?offset=10&limit=5`)).json();
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[0].id, 11);
  assert.ok(result.columns.includes('external_id'));
  assert.equal((await fetch(`${base}/api/exports/${item.id}/tables/sqlite_master`)).status, 400);
});
