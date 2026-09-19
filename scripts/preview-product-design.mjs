import http from 'node:http';
import { readFile } from 'node:fs/promises';

const surface = process.argv[2] ?? 'admin';
if (!['admin', 'brand'].includes(surface)) throw new Error('Choose admin or brand');
const filename = surface === 'admin' ? 'admin-prototype.html' : 'brand-workspace-prototype.html';
const port = surface === 'admin' ? 4780 : 4781;
const root = new URL('../', import.meta.url);

// Exact document/font allowlist; never expose the repository or environment files.
function assetFor(path) {
  if (path === '/' || path === `/${filename}`) return [`docs/product/${filename}`, 'text/html; charset=utf-8'];
  if (path === '/workspace-typography.css') return ['docs/product/workspace-typography.css', 'text/css; charset=utf-8'];
  if (path === '/public/fonts/pretendard/pretendard-dynamic-subset.css') return [path.slice(1), 'text/css; charset=utf-8'];
  if (path === '/public/fonts/helvetica-neue/helvetica-neue.css') return [path.slice(1), 'text/css; charset=utf-8'];
  if (/^\/public\/fonts\/helvetica-neue\/helvetica-neue-(?:roman|medium|bold)\.woff2$/.test(path)) return [path.slice(1), 'font/woff2'];
  if (path === '/public/brand/twings.svg') return [path.slice(1), 'image/svg+xml'];
  if (path === '/public/brand/twings-mark-mask.png') return [path.slice(1), 'image/png'];
  const font = path.match(/^\/public\/fonts\/pretendard\/woff2-dynamic-subset\/PretendardVariable\.subset\.(\d{1,2})\.woff2$/);
  if (font && Number(font[1]) <= 91) return [path.slice(1), 'font/woff2'];
  return null;
}

http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const asset = assetFor(new URL(req.url, 'http://localhost').pathname);
  if (!asset) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const bytes = await readFile(new URL(asset[0], root));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(503); res.end('Preview unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`${surface} design: http://127.0.0.1:${port}`));
