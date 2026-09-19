/**
 * Return targets are paths, never authorities. WHATWG URL parsing treats backslashes as
 * slashes and removes tabs/newlines; startsWith('/') alone therefore permits open redirects.
 * Validate before parsing, then return the parser's normalized same-origin path.
 */
const PATH_ORIGIN = 'https://return-path.invalid';

export function normalizeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw, PATH_ORIGIN);
    if (url.origin !== PATH_ORIGIN) return null;
    // Reject encoded separators/control characters in the pathname as well. Query strings may
    // legitimately contain encoded URLs, so they are not decoded or rewritten here.
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function safeReturnPath(raw: unknown, fallback = '/'): string {
  return normalizeReturnPath(raw) ?? normalizeReturnPath(fallback) ?? '/';
}
