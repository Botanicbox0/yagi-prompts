/**
 * The address to load a media file from when its pixels will be READ in the browser (drawn to a canvas,
 * exported to a data URL), i.e. for an element with `crossOrigin = 'anonymous'`.
 *
 * The media domain answers a request without an `Origin` header with no `Access-Control-Allow-Origin`
 * and no `Vary` header, cacheable for a year. The viewer plays a clip with a plain `<video>` (no CORS),
 * so that answer is in the browser's cache by the time a frame is captured; the capture element then
 * asks for the same address, the browser reuses the cached answer, the CORS check fails and the element
 * errors out (MEDIA_ERR_SRC_NOT_SUPPORTED). Measured on brand.twings.app with media.twings.app on
 * 2026-11-15: same address fails, the address with any query parameter loads and can be captured.
 *
 * So a cross-origin file that will be read is always fetched under its own cache entry: the same
 * address with `cors=1` (object storage ignores the query). Same-origin, `blob:` and `data:` addresses
 * need nothing and are returned as they are.
 *
 * Client-safe: no env, no DOM beyond an optional `location`.
 */
export function corsMediaUrl(url: string, pageOrigin: string | null = typeof location === 'undefined' ? null : location.origin): string {
  if (!url || /^(?:blob|data):/i.test(url)) return url;
  const absolute = /^https?:\/\//i.test(url);
  if (!absolute && !pageOrigin) return url;
  let parsed: URL;
  try {
    parsed = new URL(url, pageOrigin ?? undefined);
  } catch {
    return url;
  }
  if (!/^https?:$/.test(parsed.protocol)) return url;
  if (pageOrigin && parsed.origin === pageOrigin) return url;
  parsed.searchParams.set('cors', '1');
  return parsed.toString();
}
