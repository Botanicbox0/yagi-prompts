/**
 * Fetching a result file the provider or the account-lane worker pointed at. Only public https hosts
 * (no IP literals, no localhost), a size cap, and timeouts: the URL arrives from outside the app.
 *
 * Measured on 2026-11-10: the provider's file hosts served about 50 KB/s per connection (a 1.2 MB
 * picture took 18-29 s, a 2K PNG ran past two minutes and a paid result was lost), while eight ranged
 * requests in parallel brought the same file in 4 s. So a file is fetched in ranged pieces, several at
 * a time, when the host supports it; a host that ignores `Range` is read as one stream.
 */
import { isIP } from 'node:net';

export const DOWNLOAD_MAX_BYTES = 250_000_000;
/** One piece. Small enough that a slow connection finishes it well inside `PIECE_TIMEOUT_MS`. */
const PIECE_BYTES = 512 * 1024;
const PIECE_TIMEOUT_MS = 60_000;
const PIECE_ATTEMPTS = 3;
const PARALLEL = 10;
/** A host without range support gets one long read. */
const STREAM_TIMEOUT_MS = 240_000;

export function downloadableUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (isIP(host) || host === 'localhost' || !host.includes('.') || /\.(?:local|internal|localhost)$/.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

async function readAll(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('download: empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('download: too large');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** `bytes 0-524287/1184292` -> 1184292; null when the header is missing or open-ended. */
function totalOf(contentRange: string | null): number | null {
  const total = /\/(\d+)\s*$/.exec(contentRange ?? '')?.[1];
  return total ? Number(total) : null;
}

async function piece(doFetch: typeof fetch, url: URL, start: number, end: number): Promise<Uint8Array> {
  let last: unknown = null;
  for (let attempt = 0; attempt < PIECE_ATTEMPTS; attempt++) {
    try {
      const response = await doFetch(url, {
        cache: 'no-store',
        redirect: 'follow',
        headers: { range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(PIECE_TIMEOUT_MS),
      });
      if (response.status !== 206) throw new Error(`download: status ${response.status}`);
      const bytes = await readAll(response, end - start + 1);
      if (bytes.byteLength !== end - start + 1) throw new Error('download: short piece');
      return bytes;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error('download: piece failed');
}

export async function downloadResult(
  doFetch: typeof fetch,
  raw: string,
  maxBytes = DOWNLOAD_MAX_BYTES,
): Promise<{ bytes: Uint8Array; mime: string | null }> {
  const url = downloadableUrl(raw);
  if (!url) throw new Error('download: refused address');
  const first = await doFetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { range: `bytes=0-${PIECE_BYTES - 1}` },
    signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
  });
  if (!first.ok || !first.body) throw new Error(`download: status ${first.status}`);
  const mime = first.headers.get('content-type')?.split(';')[0]?.trim() || null;
  const total = first.status === 206 ? totalOf(first.headers.get('content-range')) : null;

  // No range support (or an unknown length): the answer is the whole file, read as one stream.
  if (total === null) {
    if (Number(first.headers.get('content-length') ?? 0) > maxBytes) throw new Error('download: too large');
    return { bytes: await readAll(first, maxBytes), mime };
  }
  if (total > maxBytes) {
    await first.body.cancel().catch(() => undefined);
    throw new Error('download: too large');
  }
  const head = await readAll(first, PIECE_BYTES);
  if (head.byteLength >= total) return { bytes: head.subarray(0, total), mime };

  const bytes = new Uint8Array(total);
  bytes.set(head, 0);
  const starts: number[] = [];
  for (let at = head.byteLength; at < total; at += PIECE_BYTES) starts.push(at);
  let next = 0;
  const workers = Array.from({ length: Math.min(PARALLEL, starts.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= starts.length) return;
      const start = starts[index]!;
      const end = Math.min(total, start + PIECE_BYTES) - 1;
      bytes.set(await piece(doFetch, url, start, end), start);
    }
  });
  await Promise.all(workers);
  return { bytes, mime };
}
