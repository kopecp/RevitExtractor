const uniqueId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}$/i;
const instancePath = value => typeof value === 'string' && value.split('/').every(part => uniqueId.test(part));
const compare = (a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true });

// Source identity comes from instance paths, never names, documentId, or type inheritance.
export class SourceModelIndex {
  constructor(store, { exportId, name, metadata }) {
    this.store = store;
    this.prefix = `${exportId}:`;
    this.host = { key: `${this.prefix}host`, name, kind: 'host', parentKey: null };
    this.unknown = { key: `${this.prefix}unknown`, name: 'Nieustalone źródło', kind: 'unknown', parentKey: null };
    this.links = new Map();
    const declared = new Map();
    for (const link of Array.isArray(metadata?.linkedDocuments) ? metadata.linkedDocuments : []) {
      if (instancePath(link?.instanceId)) declared.set(link.instanceId, link);
    }
    const observed = new Set();
    for (const row of store.rows) {
      const slash = row.externalId.lastIndexOf('/');
      if (slash >= 0) observed.add(row.externalId.slice(0, slash));
    }
    for (const row of store.rows) {
      if (!instancePath(row.externalId) || (!declared.has(row.externalId) && !(observed.has(row.externalId) && row.categoryId === -2001352))) continue;
      let fileName = '', directLink = false;
      store.each(row.dbId, (attr, value) => {
        if (attr[0] === 'Type Name') fileName = String(value || '');
        if (attr[0] === 'CategoryId' && Number(value) === -2001352) directLink = true;
      });
      // The direct instance properties distinguish a placement from a link type/prototype.
      if (!declared.has(row.externalId) && !(directLink && fileName)) continue;
      const link = declared.get(row.externalId);
      const parentName = store.byId.get(row.parent)?.name;
      this.links.set(row.externalId, {
        key: `${this.prefix}${row.externalId}`, instancePath: row.externalId,
        name: fileName || (parentName?.toLowerCase().endsWith('.rvt') ? parentName : `Link ${row.elementId ?? row.dbId}`),
        kind: 'link', instanceDbId: row.dbId, elementId: row.elementId,
        documentId: link?.documentId || null, parentKey: null
      });
    }
    // Keep declared sources even when the instance record is missing.
    for (const [key, link] of declared) if (!this.links.has(key)) {
      this.links.set(key, { key: `${this.prefix}${key}`, instancePath: key, name: `Link ${key}`, kind: 'link', documentId: link.documentId || null, parentKey: null });
    }
    const names = new Map();
    for (const link of this.links.values()) names.set(link.name, (names.get(link.name) || 0) + 1);
    for (const link of this.links.values()) {
      if (names.get(link.name) > 1) link.name += ` [${link.elementId ?? link.instancePath}]`;
      const parent = link.instancePath.slice(0, link.instancePath.lastIndexOf('/'));
      if (this.links.has(parent)) link.parentKey = this.links.get(parent).key;
    }
  }

  source(row) {
    const id = row?.externalId || '';
    const slash = id.lastIndexOf('/');
    if (slash >= 0) return instancePath(id) ? this.links.get(id.slice(0, slash)) || this.unknown : this.unknown;
    return uniqueId.test(id) ? this.host : this.unknown;
  }

  // Only requested geometry is returned: no database-wide payload or parameters.
  tree(geometryIds) {
    const groups = new Map([this.host, ...this.links.values()].map(model => [model.key, { ...model, categories: new Map() }]));
    for (const dbId of new Set(geometryIds)) {
      const row = this.store.byId.get(dbId);
      const model = this.source(row);
      if (!groups.has(model.key)) groups.set(model.key, { ...model, categories: new Map() });
      const group = groups.get(model.key);
      const name = row?.category || 'Bez kategorii';
      const key = row?.categoryId != null ? `id:${row.categoryId}` : `name:${name}`;
      if (!group.categories.has(key)) group.categories.set(key, { key, name, ids: [] });
      group.categories.get(key).ids.push(dbId);
    }
    const models = [...groups.values()].map(group => ({ ...group, categories: [...group.categories.values()].sort(compare) }));
    models.sort((a, b) => (a.kind === 'host' ? -1 : b.kind === 'host' ? 1 : a.kind === 'unknown' ? 1 : b.kind === 'unknown' ? -1 : compare(a, b)));
    return { models, total: new Set(geometryIds).size };
  }
}
