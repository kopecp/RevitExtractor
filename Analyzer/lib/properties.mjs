import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { PropertyIndex } from '../public/property-index.js';

export class PropertyStore extends PropertyIndex {
  constructor(resourcePath) {
    const read = name => JSON.parse(gunzipSync(readFileSync(path.join(resourcePath, `objects_${name}.json.gz`))));
    super(Object.fromEntries(['attrs', 'vals', 'avs', 'ids', 'offs'].map(name => [name, read(name)])));
    this.sdbPath = path.join(resourcePath, 'model.sdb');
    this.hasSqlite = existsSync(this.sdbPath);
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
