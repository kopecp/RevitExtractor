import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The offsets in the Autodesk property database count attribute/value PAIRS.
// dbId is the array position; it must never be confused with a Revit ElementId.
export class PropertyStore {
  constructor(resourcePath) {
    const read = (name) => JSON.parse(gunzipSync(readFileSync(path.join(resourcePath, `objects_${name}.json.gz`))));
    this.attrs = read('attrs');
    this.vals = read('vals');
    this.avs = read('avs');
    this.ids = read('ids');
    this.offs = read('offs');
    this.rows = [];
    this.byId = new Map();
    const categories = new Map();
    for (let id = 1; id < this.ids.length; id++) {
      const externalId = String(this.ids[id] ?? '');
      if (!externalId && this.offs[id] === this.offs[id + 1]) continue;
      const basic = { dbId: id, externalId, name: '', category: '', categoryId: null, parent: null, typeId: null, elementId: null };
      this.each(id, (attr, value) => {
        if (attr[1] === '__name__') basic.name = String(value);
        if (attr[1] === '__category__') basic.category = String(value).replace(/^Revit /, '');
        if (attr[0] === 'CategoryId' && Number.isInteger(Number(value))) basic.categoryId = Number(value);
        if (attr[1] === '__parent__') basic.parent = Number(value);
        if (attr[1] === '__instanceof__') basic.typeId = Number(value);
        if (attr[1] === '__revit__' && attr[0] === 'ElementId' && /^\d+$/.test(String(value))) basic.elementId = Number(value);
      });
      const match = externalId.match(/-([0-9a-f]{8})$/i);
      basic.elementId ??= match ? parseInt(match[1], 16) : null;
      this.rows.push(basic);
      this.byId.set(id, basic);
    }
    for (const row of this.rows) {
      // Category can be inherited from the type/category hierarchy.
      const seen = new Set([row.dbId]);
      let source = row;
      while ((!row.category || row.categoryId === null) && source && seen.size < 50) {
        const id = source.typeId || source.parent;
        if (!id || seen.has(id)) break;
        seen.add(id);
        source = this.byId.get(id);
        if (!row.category && source?.category) row.category = source.category;
        if (row.categoryId === null && source?.categoryId !== null && source?.categoryId !== undefined) row.categoryId = source.categoryId;
      }
      row.name ||= this.byId.get(row.typeId)?.name || `Obiekt ${row.dbId}`;
      row.category ||= 'Bez kategorii';
      row.search = `${row.dbId} ${row.elementId ?? ''} ${row.name} ${row.category} ${row.externalId}`.toLocaleLowerCase();
      categories.set(row.category, (categories.get(row.category) || 0) + 1);
    }
    this.categories = [...categories].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    this.sdbPath = path.join(resourcePath, 'model.sdb');
    this.hasSqlite = existsSync(this.sdbPath);
  }

  each(id, callback) {
    const start = this.offs[id];
    if (start === undefined) return;
    const end = this.offs[id + 1] ?? this.avs.length / 2;
    for (let pair = start; pair < end; pair++) {
      const attrId = this.avs[pair * 2];
      const attr = this.attrs[attrId];
      if (Array.isArray(attr)) callback(attr, this.vals[this.avs[pair * 2 + 1]], attrId);
    }
  }

  search({ query = '', category = '', offset = 0, limit = 80 } = {}) {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = this.rows.filter(row => (!category || row.category === category) && (!needle || row.search.includes(needle)));
    return { total: filtered.length, offset, limit, rows: filtered.slice(offset, offset + limit).map(({ search, ...row }) => row) };
  }

  detail(id) {
    const row = this.byId.get(id);
    if (!row) return null;
    const properties = [];
    const keys = new Set();
    const visited = new Set();
    const collect = (sourceId, inherited = false) => {
      if (visited.has(sourceId)) return;
      visited.add(sourceId);
      this.each(sourceId, (attr, value, attrId) => {
        if (keys.has(attrId) || String(attr[1]).startsWith('__')) return;
        keys.add(attrId);
        properties.push({ name: attr[5] || attr[0], category: attr[1] || 'Inne', value, unit: attr[3] || '', inherited, sourceId });
      });
      const typeId = this.byId.get(sourceId)?.typeId;
      if (typeId && visited.size < 50) collect(typeId, true);
    };
    collect(id);
    const { search, ...basic } = row;
    return { ...basic, properties };
  }

  // Read-only SQLite connection; no SQL supplied by the browser is executed.
  table(name, offset = 0, limit = 80) {
    const allowed = ['_objects_id', '_objects_attr', '_objects_val', '_objects_eav'];
    if (!allowed.includes(name)) throw new Error('Nieznana tabela.');
    if (!this.hasSqlite) throw new Error('Brak model.sdb w tym eksporcie.');
    const db = new DatabaseSync(this.sdbPath, { readOnly: true });
    try {
      const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY id LIMIT ? OFFSET ?`).all(limit, offset);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count;
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map(x => x.name);
      return { rows, total, columns, offset, limit };
    } finally { db.close(); }
  }
}
