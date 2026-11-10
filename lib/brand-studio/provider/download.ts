/**
 * Fetching a result file the provider or the account-lane worker pointed at. Only public https hosts
 * (no IP literals, no localhost), a size cap, and a timeout: the URL arrives from outside the app.
 */
import { isIP } from 'node:net';

export const DOWNLOAD_MAX_BYTES = 250_000_000;
const TIMEOUT_MS = 120_000;

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

export async function downloadResult(
  doFetch: typeof fetch,
  raw: string,
  maxBytes = DOWNLOAD_MAX_BYTES,
): Promise<{ bytes: Uint8Array; mime: string | null }> {
  const url = downloadableUrl(raw);
  if (!url) throw new Error('download: refused address');
  const response = await doFetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`download: status ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error('download: too large');
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
  return { bytes, mime: response.headers.get('content-type')?.split(';')[0]?.trim() || null };
}
