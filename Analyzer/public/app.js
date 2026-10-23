import { ModelViewer } from './viewer.js';
import { PdfPreview } from './pdf.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icons = {
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.2l8 4.6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  folder: '<path d="M3 7V5h6l2 2h10v13H3z"/><path d="M3 10h18"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  maximize: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  section: '<path d="M4 4h16v16H4zM2 16 16 2M8 22 22 8M4 13l7 7"/>',
  tree: '<path d="M5 3v14h13M5 8h13"/><rect x="16" y="5" width="5" height="5"/><rect x="16" y="15" width="5" height="5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  cursor: '<path d="m5 3 14 11-7 1-3 7z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
  link: '<path d="m9 15 6-6m-5-4 2-2c5-4 11 2 7 7l-3 3m-2 6-2 2c-5 4-11-2-7-7l3-3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  external: '<path d="M14 3h7v7m0-7-11 11M10 4H4v16h16v-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h6"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
$$('i[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number(value).toLocaleString('pl-PL');
const state = { exports: [], current: null, page: 'model', selected: null, stats: null, view: null, offset: 0, limit: 80, rows: [], total: 0, tableRequest: 0, selectionRequest: 0, exportRequest: 0 };
let toastTimer;
const pdf = new PdfPreview();
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000); }
function status(message) { $('#status-text').textContent = message; }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-Analyzer-Token': state.token || '', ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Operacja nie powiodła się.');
  return result;
}
function endpoint(suffix) { return `/api/exports/${state.current.id}/${suffix}`; }
function message(title, description, loading = false, retry = false) {
  $('#viewer-message').hidden = false;
  $('#viewer-message').innerHTML = `${loading ? '<div class="spinner"></div>' : `<div class="message-symbol">${icon('cube')}</div>`}<h2>${esc(title)}</h2><p>${esc(description)}</p>${retry ? '<button class="button primary" id="retry-viewer">Spróbuj ponownie</button>' : ''}`;
  $('#retry-viewer')?.addEventListener('click', () => loadView(state.view));
}
function modelButtons(enabled) { ['fit-model', 'show-all', 'section-model', 'model-tree'].forEach(id => { $(`#${id}`).disabled = !enabled; }); }

const model = new ModelViewer($('#viewer'), {
  notice: toast,
  select: ids => {
    $('#selection-count').textContent = ids.length > 1 ? `${ids.length} WYBRANYCH` : 'ELEMENT';
    if (ids.length) selectElement(ids[0], false);
    else clearSelection();
  },
  progress: percent => { $('#geometry-status').textContent = `Wczytywanie geometrii · ${percent}%`; },
  ready: count => {
    $('#viewer-message').hidden = true; $('#viewer-hint').hidden = false;
    $('#geometry-status').textContent = `${number(count)} obiektów z geometrią`;
    status('Model gotowy · kliknij element, aby zobaczyć parametry');
    modelButtons(true); updateElementActions();
  }
});

function showPage(page) {
  state.page = page;
  $$('.rail-button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $$('.page').forEach(section => section.classList.toggle('active', section.id === `${page}-page`));
  if (page === 'data') loadTable();
  if (page === 'model') requestAnimationFrame(() => model.viewer?.resize());
}
$$('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));

function renderExports() {
  $('#export-select').innerHTML = state.exports.map(item => `<option value="${item.id}">${esc(item.name)} · ${new Date(item.modified).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</option>`).join('') || '<option>Brak eksportów</option>';
  if (state.current) $('#export-select').value = state.current.id;
}
function renderViews() {
  const views = (state.current?.views || []).filter(view => `${view.name} ${view.group}`.toLocaleLowerCase().includes($('#view-search').value.toLocaleLowerCase()));
  const groups = new Map();
  for (const view of [...views].sort((a, b) => b.role.localeCompare(a.role))) {
    if (!groups.has(view.group)) groups.set(view.group, []);
    groups.get(view.group).push(view);
  }
  const labels = { '3D View': 'Modele 3D', 'Sheet': 'Arkusze', 'Floor Plan': 'Rzuty', 'Ceiling Plan': 'Rzuty sufitów', 'Building Elevation': 'Elewacje' };
  $('#view-count').textContent = views.length;
  $('#view-list').innerHTML = [...groups].map(([group, items]) => `<details class="view-group" open><summary>${esc(labels[group] || group)} <span class="muted">${items.length}</span></summary>${items.map(view => `<button class="view-item ${state.view?.path === view.path ? 'active' : ''}" data-view="${esc(view.path)}" title="${esc(view.name)}">${icon(view.role === '3d' ? 'cube' : 'file')}<span>${esc(view.name)}</span></button>`).join('')}</details>`).join('') || '<p class="muted pad">Brak widoków dla tego wyszukiwania.</p>';
  $$('.view-item').forEach(button => button.addEventListener('click', () => openView(state.current.views.find(view => view.path === button.dataset.view))));
}
$('#view-search').addEventListener('input', renderViews);

async function selectExport(item) {
  const request = ++state.exportRequest;
  state.current = item; state.stats = null; state.view = null; state.offset = 0; state.tableRequest++;
  model.clear(); clearSelection(); modelButtons(false);
  $('#viewer-hint').hidden = true;
  $('#data-search').value = ''; $('#category-filter').innerHTML = '<option value="">Wszystkie kategorie</option>';
  $('#table-mode').value = 'elements'; $('#property-search').value = ''; $('#view-search').value = ''; $('#drawing-search').value = '';
  $('#data-table thead').innerHTML = ''; $('#data-table tbody').innerHTML = ''; $('#export-csv').disabled = true;
  $('#project-name').textContent = item.properties['Project Name'] || item.name.replace(/\.rvt$/i, '');
  $('#project-subtitle').textContent = `${item.name} · ${item.properties['Project Number'] || 'Eksport lokalny'}`;
  $('#export-date').textContent = new Date(item.modified).toLocaleDateString('pl-PL');
  $('#count-models').textContent = number(item.modelCount); $('#count-pdfs').textContent = number(item.pdfCount); $('#count-elements').textContent = '…';
  $('#source-path').textContent = item.root; $('#source-path').title = item.root;
  renderExports(); renderViews(); renderDrawings(); closeDrawing();
  status('Wczytywanie eksportu…');
  const first = item.views.find(view => view.role === '3d');
  if (first) loadView(first);
  else { message('Brak widoku 3D', 'Ten eksport nie zawiera pliku SVF. Rysunki i baza danych pozostają dostępne.'); $('#geometry-status').textContent = 'Brak geometrii 3D'; }
  if (!item.hasProperties) { $('#count-elements').textContent = '—'; toast('Ten eksport nie zawiera kompletnej bazy właściwości.'); return; }
  try {
    const stats = await api(endpoint('stats'));
    if (request !== state.exportRequest) return;
    state.stats = stats; $('#count-elements').textContent = number(stats.total);
    $('#category-filter').innerHTML = '<option value="">Wszystkie kategorie</option>' + stats.categories.map(category => `<option value="${esc(category.name)}">${esc(category.name)} (${number(category.count)})</option>`).join('');
    $$('#table-mode option').forEach(option => { if (option.value !== 'elements') option.disabled = !stats.hasSqlite; });
    if (state.page === 'data') loadTable();
  } catch (error) { $('#count-elements').textContent = '—'; toast(error.message); }
}
$('#export-select').addEventListener('change', () => selectExport(state.exports.find(item => item.id === $('#export-select').value)));

async function loadView(view) {
  if (!view) return;
  state.view = view; clearSelection(); modelButtons(false); showPage('model'); renderViews();
  $('#active-view-name').textContent = view.name; $('#viewer-hint').hidden = true;
  $('#geometry-status').textContent = 'Inicjalizacja viewera…';
  message('Otwieranie modelu', 'Wczytuję geometrię i właściwości z lokalnego eksportu.', true);
  const exportId = state.current.id;
  try {
    await model.load(view, state.current.hasProperties ? (ids, signal) => api(`/api/exports/${exportId}/source-models`, { method: 'POST', body: JSON.stringify({ ids }), signal }) : null);
  }
  catch (error) {
    if (exportId !== state.current.id || state.view !== view) return;
    message('Nie udało się otworzyć modelu', error.message, false, true);
    $('#geometry-status').textContent = 'Model niedostępny'; status('Błąd wczytywania 3D · pozostałe dane są dostępne');
  }
}
function openView(view) { if (view.role === '3d') loadView(view); else openDrawing(view); }
$('#fit-model').addEventListener('click', () => model.fit());
$('#show-all').addEventListener('click', () => { model.reset(); clearSelection(); });
$('#section-model').addEventListener('click', () => model.section().catch(error => toast(error.message)));
$('#model-tree').addEventListener('click', () => model.tree().catch(error => toast(error.message)));

function renderDrawings() {
  const drawings = (state.current?.views || []).filter(view => view.role === '2d' && view.name.toLocaleLowerCase().includes($('#drawing-search').value.toLocaleLowerCase()));
  $('#drawing-count').textContent = drawings.length;
  $('#drawing-grid').innerHTML = drawings.map(view => `<button class="drawing-card" data-drawing="${esc(view.path)}">${view.thumbnail ? `<img src="${view.thumbnail}" alt="Podgląd ${esc(view.name)}" loading="lazy">` : '<div class="empty-state">PDF</div>'}<div><strong>${esc(view.name)}</strong><span>${esc(view.group)} <span aria-hidden="true">/</span> PDF</span></div></button>`).join('') || '<p class="empty-state">Brak rysunków do wyświetlenia.</p>';
  $$('.drawing-card').forEach(button => button.addEventListener('click', () => openDrawing(state.current.views.find(view => view.path === button.dataset.drawing))));
}
function openDrawing(view) {
  showPage('drawings'); $('#drawing-grid').hidden = true; $('#drawing-preview').hidden = false;
  $('#drawing-title').textContent = view.name; $('#open-pdf').href = view.url;
  pdf.open(view.url); status(`Podgląd PDF · ${view.name}`);
}
function closeDrawing() { $('#drawing-preview').hidden = true; $('#drawing-grid').hidden = false; pdf.close(); }
$('#close-preview').addEventListener('click', closeDrawing);
$('#drawing-search').addEventListener('input', () => { closeDrawing(); renderDrawings(); });

function clearSelection() {
  state.selectionRequest++; state.selected = null;
  $('#inspector-empty').hidden = false; $('#inspector-content').hidden = true;
  $('#clear-selection').hidden = true;
  $('.workspace').classList.remove('has-selection');
  $$('#data-table tr.selected').forEach(row => row.classList.remove('selected'));
}
async function selectElement(id, fromTable = true) {
  if (!state.current?.hasProperties) { toast('Brak bazy właściwości dla tego eksportu.'); return; }
  const request = ++state.selectionRequest;
  try {
    const detail = await api(endpoint(`elements/${id}`));
    if (request !== state.selectionRequest) return;
    state.selected = detail;
    $('#inspector-empty').hidden = true; $('#inspector-content').hidden = false;
    $('#clear-selection').hidden = false;
    $('.workspace').classList.add('has-selection');
    $('#element-category').textContent = detail.category;
    $('#element-name').textContent = detail.name;
    $('#element-dbid').textContent = `dbId ${detail.dbId}`;
    $('#element-revitid').textContent = detail.elementId === null ? '' : `Revit ${detail.elementId}`;
    $('#property-search').value = '';
    renderProperties(); updateElementActions();
    $$('#data-table tr[data-id]').forEach(row => row.classList.toggle('selected', Number(row.dataset.id) === id));
    if (fromTable && model.has(id) && model.viewer.getSelection()[0] !== id) model.select(id);
  } catch (error) { if (request === state.selectionRequest) toast(error.message); }
}
function updateElementActions() {
  if (!state.selected) return;
  const visible = model.has(state.selected.dbId);
  ['focus-element', 'isolate-element', 'hide-element'].forEach(id => { $(`#${id}`).disabled = !visible; });
  $('#element-visibility').textContent = visible ? 'Element ma geometrię w aktualnym widoku 3D.' : 'Brak geometrii tego rekordu w aktualnym widoku 3D.';
}
function renderProperties() {
  const detail = state.selected;
  if (!detail) return;
  const needle = $('#property-search').value.toLocaleLowerCase();
  const groups = new Map();
  const properties = [{ name: 'UniqueId', category: 'Identyfikacja', value: detail.externalId }, ...detail.properties];
  for (const property of properties) {
    if (!`${property.name} ${property.value} ${property.category}`.toLocaleLowerCase().includes(needle)) continue;
    if (!groups.has(property.category)) groups.set(property.category, []);
    groups.get(property.category).push(property);
  }
  $('#properties').innerHTML = [...groups].map(([category, props]) => `<details open><summary>${esc(category)} <span class="muted">${props.length}</span></summary>${props.map(property => {
    const value = typeof property.value === 'number' ? Number(property.value.toPrecision(9)).toLocaleString('pl-PL', { maximumFractionDigits: 8 }) : property.value;
    const unit = property.unit?.replace('autodesk.unit.unit:', '').replace(/-\d+\.\d+\.\d+$/, '');
    return `<div class="property-row"><span>${esc(property.name)}${property.inherited ? '<small>z typu</small>' : ''}</span><strong title="${esc(property.unit || '')}">${esc(value === '' ? '—' : value)}${unit ? `<small>${esc(unit)} · wartość eksportu</small>` : ''}</strong></div>`;
  }).join('')}</details>`).join('') || '<p class="empty-state">Brak takich parametrów.</p>';
}
$('#property-search').addEventListener('input', renderProperties);
$('#focus-element').addEventListener('click', () => { if (state.selected) { showPage('model'); model.select(state.selected.dbId, true); } });
$('#isolate-element').addEventListener('click', () => { if (state.selected) { showPage('model'); model.isolate(state.selected.dbId); } });
$('#hide-element').addEventListener('click', () => { if (state.selected) model.hide(state.selected.dbId); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#folder-dialog').open) clearSelection(); });
$('#clear-selection').addEventListener('click', () => { model.viewer?.clearSelection(); clearSelection(); });

async function loadTable() {
  if (!state.current?.hasProperties) { $('#data-empty').hidden = false; $('#data-empty').textContent = 'Brak bazy właściwości w tym eksporcie.'; return; }
  const request = ++state.tableRequest;
  const mode = $('#table-mode').value;
  const raw = mode !== 'elements';
  $('#data-search').disabled = raw; $('#category-filter').disabled = raw;
  $('#export-csv').disabled = true;
  $('#data-range').textContent = 'Wczytywanie…';
  $('#table-note').textContent = raw ? 'Oryginalna tabela model.sdb. Baza jest otwarta tylko do odczytu.' : 'Rekordy obejmują także typy, widoki i dane linków. Nie każdy rekord ma geometrię w aktualnym widoku 3D.';
  try {
    const params = new URLSearchParams({ offset: state.offset, limit: state.limit, q: $('#data-search').value, category: $('#category-filter').value });
    const result = await api(endpoint(`${raw ? `tables/${mode}` : 'elements'}?${params}`));
    if (request !== state.tableRequest) return;
    state.rows = result.rows; state.total = result.total;
    const columns = raw ? result.columns : ['dbId', 'name', 'category', 'elementId', 'externalId'];
    state.columns = columns;
    const labels = { dbId: 'dbId', name: 'Nazwa obiektu', category: 'Kategoria', elementId: 'Revit ElementId', externalId: 'UniqueId' };
    $('#data-table thead').innerHTML = `<tr>${columns.map(key => `<th>${esc(raw ? key : labels[key])}</th>`).join('')}</tr>`;
    $('#data-table tbody').innerHTML = result.rows.map(row => `<tr ${raw ? '' : `data-id="${row.dbId}" tabindex="0" role="button" aria-label="Pokaż właściwości ${esc(row.name)}"`} class="${row.dbId === state.selected?.dbId ? 'selected' : ''}">${columns.map(key => `<td title="${esc(row[key])}">${key === 'category' && !raw ? `<span class="category-tag">${esc(row[key])}</span>` : esc(row[key] ?? '—')}</td>`).join('')}</tr>`).join('');
    $$('#data-table tr[data-id]').forEach(row => {
      row.addEventListener('click', () => selectElement(Number(row.dataset.id)));
      row.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectElement(Number(row.dataset.id)); } });
    });
    $('#data-empty').textContent = 'Brak wyników. Zmień wyszukiwanie lub kategorię.'; $('#data-empty').hidden = result.rows.length > 0;
    $('#data-range').textContent = `${number(result.total ? state.offset + 1 : 0)}–${number(state.offset + result.rows.length)} z ${number(result.total)} rekordów`;
    $('#previous-page').disabled = state.offset === 0; $('#next-page').disabled = state.offset + state.limit >= result.total;
    $('#export-csv').disabled = !result.rows.length;
  } catch (error) { if (request === state.tableRequest) { $('#data-range').textContent = 'Nie udało się wczytać danych'; toast(error.message); } }
}
let searchTimer;
$('#data-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.offset = 0; loadTable(); }, 220); });
['category-filter', 'table-mode'].forEach(id => $(`#${id}`).addEventListener('change', () => { state.offset = 0; loadTable(); }));
$('#previous-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadTable(); });
$('#next-page').addEventListener('click', () => { state.offset += state.limit; loadTable(); });
$('#export-csv').addEventListener('click', () => {
  const cell = value => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [state.columns, ...state.rows.map(row => state.columns.map(key => row[key]))].map(row => row.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `analyzer-${$('#table-mode').value}-${state.offset + 1}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#open-folder').addEventListener('click', () => { $('#folder-error').textContent = ''; $('#folder-dialog').showModal(); });
$('#close-dialog').addEventListener('click', () => $('#folder-dialog').close());
async function addExport(item) {
  if (item.cancelled) return;
  state.exports = [item, ...state.exports.filter(other => other.id !== item.id)];
  $('#folder-dialog').close(); await selectExport(item);
}
$('#folder-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#folder-error').textContent = '';
  const button = $('#folder-form button[type="submit"]'); button.disabled = true;
  try { await addExport(await api('/api/open', { method: 'POST', body: JSON.stringify({ path: $('#folder-path').value }) })); }
  catch (error) { $('#folder-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#browse-folder').addEventListener('click', async () => {
  $('#browse-folder').disabled = true; $('#folder-error').textContent = 'Wybierz folder w oknie systemowym…';
  try { await addExport(await api('/api/pick-folder', { method: 'POST', body: '{}' })); $('#folder-error').textContent = ''; }
  catch (error) { $('#folder-error').textContent = error.message; }
  finally { $('#browse-folder').disabled = false; }
});
$('#sample-button').addEventListener('click', () => { if (state.exports.length) selectExport(state.exports[0]); else $('#folder-dialog').showModal(); });

try {
  const session = await api('/api/session');
  state.token = session.token; state.exports = session.exports;
  $('#browse-folder').hidden = !session.folderPicker;
  renderExports();
  if (state.exports.length) await selectExport(state.exports[0]);
} catch (error) { status('Brak połączenia z lokalnym serwerem'); toast(error.message); }
