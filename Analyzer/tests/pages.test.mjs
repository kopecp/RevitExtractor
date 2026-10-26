import test from 'node:test';
import assert from 'node:assert/strict';
import { fileResponse } from '../public/local-response.js';
import { normalizeExport, exportInfo } from '../public/local-export.js';
import { PropertyIndex } from '../public/property-index.js';

const guid = '00000000-0000-0000-0000-000000000000-00000001';
function fixture(prefix = '') {
  const manifest = { type: 'design', name: 'Model.rvt', children: [{ type: 'geometry', viewableID: guid, name: 'Widok ąć' }] };
  return new Map([
    ['bubble.json', new File([JSON.stringify(manifest)], 'bubble.json', { lastModified: 100000 })],
    [`Resource/3D View/${guid}/Widok ąć.svf`, new File(['geometry'], 'view.svf')],
    [`Resource/3D View/${guid}/Widok ąć4.png`, new File(['image'], 'thumb.png')],
    ['Resource/Sheet/A 01.pdf', new File(['pdf'], 'A 01.pdf')],
    ...['attrs', 'vals', 'ids', 'avs', 'offs'].map(name => [`Resource/objects_${name}.json.gz`, new File(['data'], name)]),
    ['Resource/model.sdb', new File(['sqlite'], 'model.sdb')]
  ].map(([key, value]) => [`${prefix}${key}`, value]));
}

test('folder and parent normalize to identical views under a project Pages path', async () => {
  for (const prefix of ['', 'output/']) {
    const normalized = await normalizeExport(fixture(prefix), 'selected');
    const item = exportInfo(normalized, 'export-id', '/RevitExtractor/local-files/owner/export-id/');
    assert.equal(item.name, 'Model.rvt');
    assert.equal(item.modelCount, 1); assert.equal(item.pdfCount, 1);
    assert.equal(item.hasProperties, true); assert.equal(item.hasSqlite, true);
    const view = item.views.find(v => v.role === '3d');
    assert.equal(view.name, 'Widok ąć');
    assert.ok(view.url.includes('3D%20View'));
    assert.ok(view.url.endsWith('Widok%20%C4%85%C4%87.svf'));
    assert.ok(view.thumbnail.endsWith('4.png'));
    assert.ok(view.url.startsWith('/RevitExtractor/'));
  }
});

test('missing or invalid export is rejected before registering files', async () => {
  await assert.rejects(normalizeExport(new Map(), 'empty'), /output/);
  const files = fixture(); files.set('bubble.json', new File(['{'], 'bubble.json'));
  await assert.rejects(normalizeExport(files, 'broken'));
  files.set('bubble.json', new File(['{"type":"other"}'], 'bubble.json'));
  await assert.rejects(normalizeExport(files, 'other'), /output/);
});

test('virtual files serve original bytes, HEAD, and PDF byte ranges', async () => {
  const file = new File(['0123456789'], 'drawing.pdf');
  const request = (range, method = 'GET') => new Request('https://example.com/local', { method, headers: range ? { range } : {} });
  const whole = fileResponse(file, request(), 'drawing.pdf');
  assert.equal(await whole.text(), '0123456789');
  assert.equal(whole.headers.get('content-type'), 'application/pdf');
  for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=7-', '789'], ['bytes=-3', '789'], ['bytes=7-999', '789']]) {
    const response = fileResponse(file, request(range), 'drawing.pdf');
    assert.equal(response.status, 206); assert.equal(await response.text(), expected);
  }
  for (const range of ['bytes=99-', 'bytes=7-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5']) assert.equal(fileResponse(file, request(range)).status, 416);
  const head = fileResponse(file, request(undefined, 'HEAD'));
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
});

test('property index retains final record and type inheritance without Node APIs', () => {
  const index = new PropertyIndex({
    attrs: [null, ['Name', '__name__'], ['Type', '__instanceof__'], ['Material', 'Materials'], ['Category', '__category__']],
    vals: ['Type name', 'Steel', 'Revit Walls', 'Instance', 1],
    ids: ['', 'type-00000001', 'element-00000002'],
    offs: [0, 0, 3], avs: [1, 0, 3, 1, 4, 2, 1, 3, 2, 4]
  });
  assert.equal(index.rows.length, 2);
  const detail = index.detail(2);
  assert.equal(detail.name, 'Instance'); assert.equal(detail.category, 'Walls');
  assert.equal(detail.properties.find(p => p.name === 'Material').value, 'Steel');
  assert.equal(detail.properties.find(p => p.name === 'Material').inherited, true);
  assert.equal(index.search({ query: 'Instance', limit: 1 }).total, 1);
});
