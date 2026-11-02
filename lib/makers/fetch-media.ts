import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';

/**
 * docs/PLATFORM-2.0.md §20.5 — fetch one public media file for a creative's agent ("upload the
 * still Higgsfield just made"). This is the only place the server reaches a URL a user chose, so it
 * is fenced the way an SSRF target has to be:
 *
 *   · https on the default port, no credentials in the URL;
 *   · every address the name resolves to must be public — checked INSIDE the socket's own lookup,
 *     so a DNS answer that changes between a check and the connect cannot slip a private address
 *     in (rebinding);
 *   · at most three redirects, each one fenced again; 15 s; the body is counted as it arrives and
 *     cut at the cap. The caller still sniffs the bytes — the server's Content-Type means nothing.
 */

export class MediaFetchError extends Error {
  constructor(readonly code: 'bad_url' | 'blocked' | 'too_large' | 'failed') { super(code); this.name = 'MediaFetchError'; }
}

const V4_BLOCKED: Array<[number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 3],
];

function v4ToInt(address: string): number {
  return address.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

/** True for any address a server must not be pointed at: private, loopback, link-local, CGNAT, multicast, reserved. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = v4ToInt(address);
    return V4_BLOCKED.some(([base, bits]) => ((value ^ base) >>> (32 - bits)) === 0);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[1]!);
    if (lower === '::' || lower === '::1') return true;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast, 2001:db8::/32 documentation, 64:ff9b::/96 NAT64.
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00
      || lower.startsWith('2001:db8:') || lower.startsWith('64:ff9b:');
  }
  return true;
}

export function checkedMediaUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 2048) throw new MediaFetchError('bad_url');
  let url: URL;
  try { url = new URL(raw); } catch { throw new MediaFetchError('bad_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new MediaFetchError('bad_url');
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) throw new MediaFetchError('blocked');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.internal') || !url.hostname.includes('.')) throw new MediaFetchError('blocked');
  return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** The socket's own lookup: resolve, then refuse unless EVERY answer is public. */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, options.all ? [] : '');
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((entry) => isBlockedAddress(entry.address))) {
      return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), options.all ? [] : '');
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

function once(url: URL, maxBytes: number): Promise<{ status: number; location: string | null; bytes: Uint8Array | null }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', lookup: guardedLookup as never, timeout: 15_000, headers: { 'User-Agent': 'TWINGS-media-import/1', Accept: 'image/*,video/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); resolve({ status, location: res.headers.location ?? null, bytes: null }); return; }
      if (status !== 200) { res.resume(); reject(new MediaFetchError('failed')); return; }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); reject(new MediaFetchError('too_large')); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxBytes) { res.destroy(); reject(new MediaFetchError('too_large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, location: null, bytes: new Uint8Array(Buffer.concat(chunks)) }));
      res.on('error', () => reject(new MediaFetchError('failed')));
    });
    req.on('timeout', () => req.destroy(new MediaFetchError('failed')));
    req.on('error', (error) => reject(error instanceof MediaFetchError ? error : (error as { code?: string }).code === 'EBLOCKED' ? new MediaFetchError('blocked') : new MediaFetchError('failed')));
    req.end();
  });
}

export async function fetchPublicMedia(raw: unknown, maxBytes: number): Promise<Uint8Array> {
  let url = checkedMediaUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const result = await once(url, maxBytes);
    if (result.bytes) return result.bytes;
    if (!result.location) throw new MediaFetchError('failed');
    url = checkedMediaUrl(new URL(result.location, url).toString());
  }
  throw new MediaFetchError('failed');
}

/** `data:` or bare base64 → bytes, bounded before decoding. */
export function decodeBase64Media(raw: unknown, maxBytes: number): Uint8Array {
  if (typeof raw !== 'string') throw new MediaFetchError('bad_url');
  const body = raw.replace(/^data:[a-z0-9.+/-]+;base64,/i, '').replace(/\s+/g, '');
  if (body.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new MediaFetchError('too_large');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) throw new MediaFetchError('bad_url');
  const bytes = new Uint8Array(Buffer.from(body, 'base64'));
  if (!bytes.byteLength) throw new MediaFetchError('bad_url');
  if (bytes.byteLength > maxBytes) throw new MediaFetchError('too_large');
  return bytes;
}
