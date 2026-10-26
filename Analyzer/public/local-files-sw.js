import { fileResponse } from './local-response.js';

// Never cache app code or models. Every page load receives the current deployment.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'identify') event.ports[0]?.postMessage({ clientId: event.source.id });
});

const prefix = new URL('./local-files/', self.location.href).pathname;
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.includes('/local-files/')) return;
  if (!url.pathname.startsWith(prefix)) {
    event.respondWith(new Response('Invalid local file URL', { status: 400 }));
    return;
  }
  // A missing file is a local error, never a request to GitHub or Autodesk.
  event.respondWith(serveLocal(event.request, url));
});

async function serveLocal(request, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Read only', { status: 405 });
  try {
    const [clientId, exportId, ...segments] = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent);
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment))) return new Response('Invalid path', { status: 400 });
    const owner = await self.clients.get(clientId);
    if (!owner) return new Response('Otwórz ponownie folder w Analyzerze.', { status: 410 });
    const result = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Folder nie odpowiada. Wybierz go ponownie.')); }, 30000);
      channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
      owner.postMessage({ type: 'local-file', exportId, path: segments.join('/') }, [channel.port2]);
    });
    if (!result.file) return new Response(result.error || 'Brak pliku.', { status: 404 });
    return fileResponse(result.file, request, segments.at(-1));
  } catch (error) {
    return new Response(error.message, { status: 400 });
  }
}
