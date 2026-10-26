// File handles and File objects stay in the browser. No upload or persistent copy.
export async function readLocalFile(entry) {
  if (!entry) throw new Error('Brak pliku w wybranym eksporcie.');
  return entry.kind === 'file' ? entry.getFile() : entry;
}

export async function normalizeExport(entries, rootName) {
  for (const prefix of ['', 'output/']) {
    const bubble = entries.get(`${prefix}bubble.json`);
    if (!bubble) continue;
    const manifest = JSON.parse(await (await readLocalFile(bubble)).text());
    if (manifest.type !== 'design' || ![...entries.keys()].some(key => key.startsWith(`${prefix}Resource/`))) continue;
    const files = new Map([...entries].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
    return { files, manifest, rootName: `${rootName}${prefix ? '/output' : ''}`, modified: new Date((await readLocalFile(bubble)).lastModified).toISOString() };
  }
  throw new Error('Wybierz folder output z plikami bubble.json i Resource albo jego bezpośredni folder nadrzędny.');
}

export async function entriesFromHandle(directory, prefix = '', entries = new Map()) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'directory') await entriesFromHandle(handle, `${prefix}${name}/`, entries);
    else entries.set(`${prefix}${name}`, handle);
  }
  return entries;
}

export function entriesFromFiles(files) {
  return new Map([...files].map(file => [file.webkitRelativePath.split('/').slice(1).join('/'), file]));
}

export function exportInfo({ files, manifest, rootName, modified }, id, base) {
  const paths = [...files.keys()];
  const url = relative => `${base}${relative.split('/').map(encodeURIComponent).join('/')}`;
  const nodes = new Map();
  const visit = (node, group = '') => {
    if (node.type === 'geometry') nodes.set(node.viewableID || node.guid, { ...node, group });
    for (const child of node.children || []) visit(child, node.type === 'folder' ? node.name : group);
  };
  visit(manifest);
  const views = paths.filter(file => /\.(svf|pdf)$/i.test(file)).map(relative => {
    const parts = relative.split('/');
    const guid = parts.find(part => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part));
    const meta = nodes.get(guid) || {};
    const stem = relative.replace(/\.[^.]+$/, '');
    const thumbnail = [`${stem}4.png`, `${stem}2.png`, `${stem}1.png`].find(file => files.has(file));
    return { id: guid || relative, role: /\.svf$/i.test(relative) ? '3d' : '2d', name: meta.name || stem.split('/').at(-1), group: parts[1] || meta.group || 'Widoki', path: relative, url: url(relative), thumbnail: thumbnail ? url(thumbnail) : null };
  }).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name, 'pl', { numeric: true }));
  return {
    id, root: rootName, name: manifest.name || rootName, modified,
    properties: manifest.properties?.['Document Information'] || {}, views,
    fileCount: files.size, pdfCount: views.filter(v => v.role === '2d').length,
    modelCount: views.filter(v => v.role === '3d').length,
    preview: files.has('preview.png') ? url('preview.png') : null,
    hasProperties: ['attrs', 'vals', 'avs', 'ids', 'offs'].every(name => files.has(`Resource/objects_${name}.json.gz`)),
    hasSqlite: files.has('Resource/model.sdb'), propertyUrl: url('Resource/')
  };
}
