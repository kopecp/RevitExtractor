import { entriesFromFiles, entriesFromHandle, normalizeExport, exportInfo, readLocalFile } from './local-export.js';

export class BrowserBackend {
  constructor() {
    this.exports = new Map(); this.pending = new Map(); this.sequence = 0;
    this.worker = new Worker(new URL('./local-data-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = () => {
      this.failure = new Error('Nie można odczytać bazy w przeglądarce. Odśwież stronę i wybierz folder ponownie.');
      for (const pending of this.pending.values()) pending.reject(this.failure);
      this.pending.clear();
    };
    navigator.serviceWorker.addEventListener('message', async event => {
      if (event.data?.type !== 'local-file' || !event.ports[0]) return;
      try {
        const file = await readLocalFile(this.exports.get(event.data.exportId)?.files.get(event.data.path));
        event.ports[0].postMessage({ file });
      } catch (error) { event.ports[0].postMessage({ error: error.message }); }
    });
  }

  request(message) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence;
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...message, requestId });
    });
  }

  async init() {
    if (!isSecureContext || !navigator.serviceWorker) throw new Error('Otwórz stronę przez HTTPS w Chrome lub Edge.');
    await navigator.serviceWorker.register(new URL('./local-files-sw.js', import.meta.url), { type: 'module', scope: './', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Odśwież stronę, aby włączyć odczyt lokalnych plików.')); }, 15000);
      const changed = () => { clearTimeout(timeout); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      if (navigator.serviceWorker.controller) changed();
    });
    this.clientId = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Odśwież stronę i ponów wybór folderu.')); }, 15000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timeout); channel.port1.close(); resolve(data.clientId); };
      navigator.serviceWorker.controller.postMessage({ type: 'identify' }, [channel.port2]);
    });
  }

  async open(entries, name) {
    if (!this.clientId) throw new Error('Odczyt lokalny nie jest gotowy. Odśwież stronę.');
    const normalized = await normalizeExport(entries, name);
    const id = crypto.randomUUID();
    const base = new URL(`./local-files/${this.clientId}/${id}/`, import.meta.url).pathname;
    const info = exportInfo(normalized, id, base);
    this.exports.set(id, normalized);
    await this.request({ type: 'register', info, files: normalized.files });
    return info;
  }

  async pickFolder() {
    // Must be invoked directly from the click handler, before any await.
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    return this.open(await entriesFromHandle(handle), handle.name);
  }
  openFiles(files) { return this.open(entriesFromFiles(files), files[0]?.webkitRelativePath.split('/')[0] || 'output'); }
  async api(url, options = {}) {
    options.signal?.throwIfAborted();
    const result = await this.request({ type: 'query', url, body: options.body });
    options.signal?.throwIfAborted();
    return result;
  }
}
