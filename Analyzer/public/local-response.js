// Also used by tests: identical byte-range behavior for SVF, PDF and property files.
export function fileResponse(file, request, fileName = '') {
  const types = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', json: 'application/json', gz: 'application/gzip' };
  const headers = { 'Content-Type': types[fileName.split('.').at(-1).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  let start = 0, end = file.size - 1, status = 200;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    status = 206;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(request.method === 'HEAD' ? null : file.slice(start, end + 1), { status, headers });
}
