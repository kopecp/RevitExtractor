import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { SourceModelIndex, readSourceMetadata } from '../lib/source-models.mjs';
import { PropertyStore } from '../lib/properties.mjs';
import { VisibilityState, ViewerVisibility, viewerCategories } from '../public/visibility.js';

const uid = n => `00000000-0000-0000-0000-000000000000-${n.toString(16).padStart(8, '0')}`;
function fixture() {
  const rows = [
    { dbId: 1, externalId: uid(1), category: 'Walls', categoryId: -1 },
    { dbId: 2, externalId: `${uid(10)}/${uid(1)}`, category: 'Walls', categoryId: -1 },
    { dbId: 3, externalId: `${uid(11)}/${uid(1)}`, category: 'Walls', categoryId: -1 },
    { dbId: 4, externalId: `${uid(99)}/${uid(1)}`, category: '' },
    { dbId: 5, externalId: 'prototype', category: '' },
    { dbId: 6, externalId: `${uid(10)}/${uid(12)}/${uid(1)}`, category: 'Doors', categoryId: -2 },
    ...[10, 11, 12].map(n => ({ dbId: n, externalId: n === 12 ? `${uid(10)}/${uid(n)}` : uid(n), categoryId: -2001352, elementId: n }))
  ];
  const store = { rows, byId: new Map(rows.map(row => [row.dbId, row])), each(id, cb) {
    if (id >= 10) { cb(['CategoryId', '__categoryId__'], -2001352); cb(['Type Name', 'Identity Data'], 'Same.rvt'); }
  } };
  const metadata = { linkedDocuments: [10, 11].map(n => ({ instanceId: uid(n), documentId: 'same-document' })) };
  return { store, metadata };
}

test('source instances stay separate despite identical documentId, file name and element UniqueId', () => {
  const { store, metadata } = fixture();
  const index = new SourceModelIndex(store, { exportId: 'e', name: 'Host.rvt', metadata });
  const tree = index.tree([1, 2, 3, 4, 5, 6, 1, 999]);
  assert.equal(tree.total, 7);
  assert.equal(tree.models.filter(model => model.kind === 'link').length, 3);
  assert.equal(new Set(tree.models.map(model => model.name)).size, tree.models.length);
  assert.equal(tree.models.flatMap(model => model.categories.flatMap(category => category.ids)).length, 7);
  assert.deepEqual(tree.models.find(model => model.kind === 'unknown').categories.flatMap(category => category.ids), [4, 5, 999]);
  assert.equal(index.source(store.byId.get(2)).instancePath, uid(10));
  assert.equal(index.source(store.byId.get(3)).instancePath, uid(11));
  const nested = index.source(store.byId.get(6));
  assert.equal(nested.instancePath, `${uid(10)}/${uid(12)}`);
  assert.equal(nested.parentKey, `e:${uid(10)}`);
});

test('missing AEC uses verified link instances; invalid prefixes never become host geometry', () => {
  const { store } = fixture();
  const index = new SourceModelIndex(store, { exportId: 'e', name: 'Host.rvt', metadata: null });
  assert.equal(index.source(store.byId.get(2)).kind, 'link');
  assert.equal(index.source(store.byId.get(4)).kind, 'unknown');
  assert.equal(index.source({ externalId: `${uid(10)}extra/${uid(1)}` }).kind, 'unknown');
  assert.equal(readSourceMetadata('missing-directory'), null);
});

test('unloaded link references without exported membership are not additional source models', () => {
  const { store } = fixture();
  store.rows = store.rows.filter(row => !row.externalId.includes('/'));
  const index = new SourceModelIndex(store, { exportId: 'e', name: 'Host.rvt', metadata: null });
  assert.equal(index.links.size, 0);
  assert.equal(index.tree([1]).models.length, 1);
});

const sample = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-f1c34a6483774b0aa039c23a4f37cd8f/output/Resource');
test('actual Snowdon sources retain six placements and agree with exported prefixed IDs', { skip: !existsSync(sample) }, () => {
  const store = new PropertyStore(sample);
  const index = new SourceModelIndex(store, { exportId: 'snowdon', name: 'SnowdonHVAC.rvt', metadata: readSourceMetadata(sample) });
  assert.equal(index.links.size, 6);
  let linked = 0;
  for (const row of store.rows) if (row.externalId.includes('/')) { assert.equal(index.source(row).kind, 'link'); linked++; }
  assert.equal(linked, 80757);
  const tree = index.tree([3199, 9522, 76414]);
  assert.equal(tree.models.flatMap(model => model.categories.flatMap(category => category.ids)).length, 3);
});

function visibilityFixture() {
  return new VisibilityState({ models: [
    { key: 'host', categories: [{ key: 'walls', ids: [1] }, { key: 'doors', ids: [3] }] },
    { key: 'link', categories: [{ key: 'walls', ids: [2] }, { key: 'doors', ids: [4] }] }
  ] });
}
test('model switches preserve scoped category and manual hides', () => {
  const state = visibilityFixture();
  state.toggleCategory('link', 'walls');
  assert.equal(state.visible(1), true); assert.equal(state.visible(2), false);
  state.setHidden([4], true); state.toggleModel('link'); state.toggleModel('link');
  assert.equal(state.visible(2), false); assert.equal(state.visible(4), false); assert.equal(state.visible(3), true);
  state.toggleModel('link'); state.setGlobalCategory('walls', true);
  assert.equal(state.visible(2), false);
  state.toggleModel('link'); assert.equal(state.visible(2), true); assert.equal(state.visible(4), false);
  state.reset(); assert.deepEqual([...state.membership.keys()].filter(id => state.visible(id)).sort(), [1, 2, 3, 4]);
});
test('isolation respects model/category masks and nested link switches', () => {
  const state = visibilityFixture(); state.toggleModel('link'); state.isolate([2]);
  assert.equal(state.counts([1, 2, 3, 4]).visible, 0);
  state.toggleModel('link'); assert.equal(state.visible(2), true); assert.equal(state.visible(1), false);
  const nested = new VisibilityState({ models: [
    { key: 'a', categories: [{ key: 'walls', ids: [1] }] },
    { key: 'b', parentKey: 'a', categories: [{ key: 'walls', ids: [2] }] }
  ] });
  nested.toggleCategory('b', 'walls'); nested.toggleModel('a'); nested.toggleModel('a');
  assert.equal(nested.visible(1), true); assert.equal(nested.visible(2), false);
  assert.deepEqual(nested.modelIds.get('a'), [1, 2]);
});

test('nested components follow the native category branch instead of their type category', () => {
  const parents = new Map([[1, 100], [2, 1], [100, 999], [999, 0]]);
  const tree = { getRootId: () => 999, getNodeParentId: id => parents.get(id), getNodeName: () => 'Windows' };
  const data = { models: [{ key: 'a', categories: [{ key: 'windows', ids: [1] }, { key: 'generic', ids: [2] }] }] };
  const result = viewerCategories(data, tree);
  assert.deepEqual(result.models[0].categories, [{ key: 'tree:100', name: 'Windows', ids: [1, 2] }]);
});

const events = { HIDE_EVENT: 'hide', SHOW_EVENT: 'show', ISOLATE_EVENT: 'isolate', SHOW_ALL_EVENT: 'showAll' };
function fakeViewer(nested = false) {
  const listeners = new Map(); let hidden = new Set(); let isolation = null; let selected = [];
  const members = id => id === 100 ? [1, 2, 3, 4] : id === 10 || nested && id === 1 ? [1, 2] : id === 20 ? [3, 4] : [id];
  const v = {
    model: { getInstanceTree: () => ({ getRootId: () => 100, getNodeParentId: id => id === 100 ? 0 : nested && id === 2 ? 1 : [10, 20].includes(id) ? 100 : 10, enumNodeChildren: (id, cb) => { if ([100, 10, 20].includes(id) || nested && id === 1) members(id).forEach(cb); } }) },
    addEventListener: (type, cb) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(cb); },
    removeEventListener: (type, cb) => listeners.get(type).delete(cb),
    fire(type, ids = []) { for (const cb of listeners.get(type) || []) cb({ nodeIdArray: ids, model: v.model }); },
    showAll() { hidden.clear(); isolation = null; v.fire('isolate'); v.fire('showAll'); },
    show(ids) { ids.flatMap(members).forEach(id => hidden.delete(id)); v.fire('show', ids); },
    hide(ids) { ids.flatMap(members).forEach(id => hidden.add(id)); v.fire('hide', ids); },
    isolate(ids) { isolation = new Set(ids.flatMap(members)); v.fire('isolate', ids); },
    getSelection: () => selected, select(ids) { selected = ids; },
    isNodeVisible: id => !hidden.has(id) && (!isolation || isolation.has(id))
  };
  return v;
}
test('native category eyes, external hide/isolate and show-all synchronize without loops', async () => {
  const state = visibilityFixture(), viewer = fakeViewer(); let updates = 0;
  const adapter = new ViewerVisibility(viewer, state, events, () => updates++);
  state.toggleModel('link'); adapter.apply();
  adapter.toggleNode(10); assert.equal(viewer.isNodeVisible(1), false);
  adapter.toggleNode(10); assert.equal(viewer.isNodeVisible(1), true); assert.equal(viewer.isNodeVisible(2), false);
  viewer.hide([3]); await Promise.resolve();
  state.toggleModel('link'); adapter.apply(); assert.equal(viewer.isNodeVisible(3), false); assert.equal(viewer.isNodeVisible(4), true);
  viewer.isolate([2]); await Promise.resolve(); assert.equal(viewer.isNodeVisible(2), true); assert.equal(viewer.isNodeVisible(1), false);
  viewer.showAll(); await Promise.resolve(); assert.equal(state.counts([1, 2, 3, 4]).visible, 4);
  assert.ok(updates < 15);
  viewer.hide([1]); adapter.dispose(); await Promise.resolve();
  const before = updates; viewer.showAll(); await Promise.resolve(); assert.equal(updates, before);
});

test('recursive SDK hide/show cannot override independently masked geometry children', () => {
  const state = visibilityFixture(), viewer = fakeViewer(true);
  const adapter = new ViewerVisibility(viewer, state, events);
  state.toggleModel('host'); adapter.apply();
  assert.equal(viewer.isNodeVisible(1), false); assert.equal(viewer.isNodeVisible(2), true);
  state.setHidden([2], true); adapter.apply();
  state.toggleModel('host'); adapter.apply();
  assert.equal(viewer.isNodeVisible(1), true); assert.equal(viewer.isNodeVisible(2), false);
  adapter.dispose();
});

test('hiding a model clears group selections that contain hidden geometry', () => {
  const state = visibilityFixture(), viewer = fakeViewer();
  const adapter = new ViewerVisibility(viewer, state, events);
  viewer.select([10]); state.toggleModel('link'); adapter.apply();
  assert.deepEqual(viewer.getSelection(), []);
  adapter.dispose();
});

test('nested placement counts do not duplicate descendants when children precede parents', () => {
  const state = new VisibilityState({ models: [
    { key: 'c', parentKey: 'b', categories: [{ key: 'walls', ids: [3] }] },
    { key: 'b', parentKey: 'a', categories: [{ key: 'walls', ids: [2] }] },
    { key: 'a', categories: [{ key: 'walls', ids: [1] }] }
  ] });
  assert.deepEqual(state.modelIds.get('a').sort(), [1, 2, 3]);
});
