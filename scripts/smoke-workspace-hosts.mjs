/**
 * Read-only integration smoke for the BUILT host-routing branch.
 * Run only after that branch's build:local/start:local, without a dev identity:
 *   node scripts/smoke-workspace-hosts.mjs [port]
 * Every socket connects to 127.0.0.1 on the selected port (default 3000). Host headers are synthetic; redirects
 * are inspected but never followed. No cookies, credentials, env reads, POSTs,
 * response content, or Set-Cookie values are printed.
 */
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Expected a valid local port');
const ADMIN = 'admin.twings.app';
const BRANDS = 'brands.twings.app';
const FONT = '/fonts/pretendard/pretendard-dynamic-subset.css';
const cases = [];
const add = (name, host, path, expected, extra = {}) => cases.push({ name, host, path, expected, ...extra });
const blocked = (name, host, path, extra = {}) => add(name, host, path, { status: 404, private: true, noindex: true }, extra);
const redirect = (status, path, query = {}, privateResponse = false) => ({
  status, locationPath: path, locationQuery: query, sameHost: true,
  ...(privateResponse ? { private: true, noindex: true } : {}),
});

for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, 'twings.app', 'www.twings.app']) {
  add('consumer root', host, '/', redirect(308, '/ko'));
  add('consumer marketing', host, '/ko/video', { status: 200, html: true });
  add('consumer unprefixed', host, '/video', redirect(308, '/ko/video'));
}
add('consumer font retained', `localhost:${PORT}`, FONT, { status: 200, css: true });
add('consumer closed render access', `localhost:${PORT}`, '/api/renders/access', { status: 200, anonymousClosed: true });
add('forwarded admin does not grant surface', `localhost:${PORT}`, '/ko/video', { status: 200, html: true }, { headers: { 'X-Forwarded-Host': ADMIN } });
add('forged surface context overwritten', `localhost:${PORT}`, '/ko/video', { status: 200, html: true }, { headers: { 'X-Twings-Surface': 'admin', 'X-Twings-Request-Origin': 'https://evil.invalid' } });

add('admin root', ADMIN, '/', redirect(307, '/admin', {}, true));
add('admin root HEAD', ADMIN, '/?discard=1', { ...redirect(307, '/admin', {}, true), noQuery: true }, { method: 'HEAD' });
add('admin anonymous entry', ADMIN, '/admin', redirect(307, '/auth/choose', { next: '/admin', locale: 'ko' }, true));
add('admin return query preserved', ADMIN, '/admin/campaigns?status=running', redirect(307, '/auth/choose', { next: '/admin/campaigns?status=running', locale: 'ko' }, true));
add('admin chooser renders', ADMIN, '/auth/choose?next=%2Fadmin&locale=ko', { status: 200, html: true, noindex: true, private: true, providerNext: '/admin' });
add('admin required font allowed', ADMIN, FONT, { status: 200, css: true, noindex: true });
for (const path of ['/ko/video', '/account', '/api/renders/access', '/api/brands/inquiries', '/api/admin/staging-url', '/admin/do', '/auth/signout', '/offline.html', '/sw.js', '/manifest.webmanifest', '/sitemap.xml', '/r/probe/probe', '/reel/probe.mp4', '/anything.png', '/_next/image?url=%2Ficon.png&w=64&q=75']) {
  blocked('admin closed route', ADMIN, path);
}

for (const host of [ADMIN, BRANDS]) {
  add('workspace robots', host, '/robots.txt', { status: 200, robotsClosed: true, noindex: true, private: true });
  add('workspace robots HEAD', host, '/robots.txt', { status: 200, empty: true, noindex: true, private: true }, { method: 'HEAD' });
}
for (const path of ['/', '/ko/video', '/auth/choose', '/api/renders/access', '/admin', FONT, '/anything.png']) {
  blocked('brands not open', BRANDS, path);
}
for (const path of ['/', '/ko/video', '/robots.txt', FONT, '/_next/static/probe.js']) {
  blocked('unknown host', 'unlisted.example.invalid', path);
}
blocked('unknown forwarded host spoof', 'unlisted.example.invalid', '/', { headers: { 'X-Forwarded-Host': 'twings.app' } });
blocked('unknown surface-header spoof', 'unlisted.example.invalid', '/', { headers: { 'X-Twings-Surface': 'consumer', 'X-Twings-Request-Origin': 'https://twings.app' } });
blocked('admin unexpected port', 'admin.twings.app:3000', '/');

const unsafeNext = ['https://evil.invalid/escape', '//evil.invalid/escape', '/\\evil.invalid/escape', '/%2F%2Fevil.invalid', '/%5Cevil.invalid', '/admin/../../ko/video', '/ko/video'];
for (const next of unsafeNext) {
  const query = new URLSearchParams({ next, locale: 'ko' });
  add('admin signin sanitizes return', ADMIN, `/auth/signin?${query}`, redirect(303, '/auth/choose', { next: '/admin', locale: 'ko' }, true));
  add('admin callback without code sanitizes return', ADMIN, `/auth/callback?${query}`, redirect(307, '/auth/choose', { next: '/admin', locale: 'ko', error: 'oauth' }, true));
}
const validNext = '/admin/campaigns?status=running';
add('admin signin local return', ADMIN, `/auth/signin?${new URLSearchParams({ next: validNext, locale: 'ko' })}`, redirect(303, '/auth/choose', { next: validNext, locale: 'ko' }, true));
add('admin chooser sanitizes provider links', ADMIN, `/auth/choose?${new URLSearchParams({ next: '//evil.invalid', locale: 'ko' })}`, { status: 200, noindex: true, private: true, providerNext: '/admin' });
add('consumer signin sanitizes return', `localhost:${PORT}`, `/auth/signin?${new URLSearchParams({ next: '//evil.invalid', locale: 'ko' })}`, redirect(303, '/auth/choose', { next: '/ko/video', locale: 'ko' }));
add('consumer signin local return', `localhost:${PORT}`, `/auth/signin?${new URLSearchParams({ next: '/account', locale: 'ko' })}`, redirect(303, '/auth/choose', { next: '/account', locale: 'ko' }));

function request(test) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, method: test.method ?? 'GET', path: test.path,
      headers: { Host: test.host, 'Accept-Language': 'ko', Accept: '*/*', 'User-Agent': 'TWINGS-loopback-host-smoke', ...(test.headers ?? {}) },
      agent: false,
    }, res => {
      const chunks = []; let retained = 0;
      res.on('data', chunk => {
        if (retained < 2_000_000) { chunks.push(chunk); retained += chunk.length; }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(20_000, () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    req.end();
  });
}

const decodeHtml = value => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
function inspect(test, response) {
  const expected = test.expected, errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(response.status === expected.status, `status expected ${expected.status}`);
  const noindex = /\bnoindex\b/i.test(String(response.headers['x-robots-tag'] ?? ''));
  if (expected.noindex) check(noindex, 'missing X-Robots-Tag noindex');
  if (expected.private) {
    const cache = String(response.headers['cache-control'] ?? '');
    check(/\bprivate\b/.test(cache) && /\bno-store\b/.test(cache), 'missing private,no-store');
  }
  if (expected.html) check(String(response.headers['content-type'] ?? '').includes('text/html'), 'expected HTML');
  if (expected.css) check(String(response.headers['content-type'] ?? '').includes('text/css'), 'expected CSS');
  if (expected.empty) check(response.body.length === 0, 'HEAD included body');
  if (expected.robotsClosed) check(/^User-agent:\s*\*\s*\r?\nDisallow:\s*\/\s*$/i.test(response.body.trim()), 'robots not fully closed');
  if (expected.anonymousClosed) {
    try { const data = JSON.parse(response.body); check(data.live === false && data.signedIn === false && data.charge === false, 'expected anonymous closed render access'); }
    catch { errors.push('expected render access JSON'); }
  }
  let location = '-';
  if (response.headers.location) {
    try {
      const target = new URL(response.headers.location, `http://${test.host}`);
      location = target.host === test.host ? target.pathname : '[different-host]';
      if (expected.sameHost) check(target.host === test.host, 'redirect changed host');
      if (expected.locationPath) check(target.pathname === expected.locationPath, 'redirect pathname mismatch');
      for (const [key, value] of Object.entries(expected.locationQuery ?? {})) check(target.searchParams.get(key) === value, `redirect ${key} mismatch`);
      if (expected.noQuery) check(target.search === '', 'root redirect retained query');
    } catch { errors.push('invalid Location'); location = '[invalid]'; }
  } else if (expected.locationPath) errors.push('missing Location');
  if (expected.providerNext) {
    const links = [...response.body.matchAll(/\bhref="([^"]+)"/g)].map(match => decodeHtml(match[1]));
    const providerLinks = links.map(href => { try { return new URL(href, `http://${test.host}`); } catch { return null; } })
      .filter(url => url?.pathname === '/auth/signin' && ['google', 'kakao'].includes(url.searchParams.get('provider')));
    check(providerLinks.length === 2, 'expected two provider links');
    check(providerLinks.every(url => url.host === test.host && url.searchParams.get('next') === expected.providerNext), 'provider link escaped sanitized return');
  }
  return { errors, noindex, location };
}

let passed = 0;
for (const [index, test] of cases.entries()) {
  try {
    const response = await request(test);
    const { errors, noindex, location } = inspect(test, response);
    if (!errors.length) passed++;
    // Path excludes query strings; redirect output excludes every query value.
    console.log(`${errors.length ? 'FAIL' : 'PASS'} ${String(index + 1).padStart(2, '0')} ${test.name} [${test.method ?? 'GET'} ${test.host}${test.path.split('?')[0]}] status=${response.status} location=${location} noindex=${noindex}${errors.length ? ` checks=${errors.join('; ')}` : ''}`);
  } catch (error) {
    console.log(`FAIL ${String(index + 1).padStart(2, '0')} ${test.name} request=${typeof error?.code === 'string' ? error.code.replace(/[^A-Z0-9_]/g, '') : 'FAILED'}`);
    if (error?.code === 'ECONNREFUSED') break;
  }
}
console.log(`HOST SMOKE ${passed === cases.length ? 'PASSED' : 'FAILED'} ${passed}/${cases.length}`);
process.exitCode = passed === cases.length ? 0 : 1;
