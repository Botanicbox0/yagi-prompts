import { safeReturnPath } from '@/lib/auth/return-path';

export type Surface = 'consumer' | 'admin' | 'brand' | 'brands' | 'unknown';
export const SURFACE_HEADER = 'x-twings-surface';
export const REQUEST_ORIGIN_HEADER = 'x-twings-request-origin';

/** Exact deployment names only; never trust a forwarded header or a *.vercel.app suffix. */
function deploymentHostnames(): Array<string | undefined> {
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL];
}

function authority(raw: string, protocol: string): string | null {
  if (!raw || /[\\/\s,@#?]/.test(raw)) return null;
  try { return new URL(`${protocol}//${raw}`).host.toLowerCase(); } catch { return null; }
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

function surfaceForUrl(url: URL, deploymentHosts: Array<string | undefined>): Surface {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'admin.twings.app' && !url.port) return 'admin';
  if (hostname === 'brand.twings.app' && !url.port) return 'brand';
  if (hostname === 'brands.twings.app' && !url.port) return 'brands';
  if (['twings.app', 'www.twings.app', 'yagi-prompts.vercel.app'].includes(hostname) && !url.port) return 'consumer';
  if (LOOPBACK.includes(hostname)) return 'consumer';
  if (!url.port && deploymentHosts.some(value => value && authority(value, 'https:') === hostname)) return 'consumer';
  return 'unknown';
}

/**
 * Next normalizes loopback URLs to localhost and its local server builds the middleware URL
 * from the listening hostname. Restore only an exact known Host in that one case. A remote
 * URL/Host conflict, an unknown authority, or different loopback ports still fails closed.
 */
export function resolveRequestUrl(url: URL, headers: Headers, deploymentHosts = deploymentHostnames()): URL | null {
  const rawHost = headers.get('host');
  if (rawHost === null) return surfaceForUrl(url, deploymentHosts) === 'unknown' ? null : url;
  const host = authority(rawHost, url.protocol);
  if (host === null) return null;
  const candidate = new URL(`${url.protocol}//${host}${url.pathname}${url.search}${url.hash}`);
  if (surfaceForUrl(candidate, deploymentHosts) === 'unknown') return null;
  if (host === url.host.toLowerCase()) return candidate;
  if (!LOOPBACK.includes(url.hostname)) return null;
  if (LOOPBACK.includes(candidate.hostname) && candidate.port !== url.port) return null;
  return candidate;
}

export function resolveSurface(url: URL, headers: Headers, deploymentHosts = deploymentHostnames()): Surface {
  const resolved = resolveRequestUrl(url, headers, deploymentHosts);
  return resolved === null ? 'unknown' : surfaceForUrl(resolved, deploymentHosts);
}

export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** Public logo files share /brand, but are not authenticated workspace routes. */
export function isBrandPath(pathname: string): boolean {
  return pathname === '/brand' || /^\/brand\/(?:projects|members|invite|settings|library|studio)(?:\/|$)/.test(pathname);
}

const AUTH_METHODS: Record<string, readonly string[]> = {
  '/auth/choose': ['GET', 'HEAD'],
  '/auth/open-in-browser': ['GET', 'HEAD'],
  '/auth/signin': ['GET', 'HEAD'],
  '/auth/callback': ['GET', 'HEAD'],
  '/auth/signout': ['POST'],
};

export function adminRouteAllowed(pathname: string, method: string): boolean {
  const read = method === 'GET' || method === 'HEAD';
  if (AUTH_METHODS[pathname]?.includes(method)) return true;
  if (pathname === '/api/workspace-locale') return method === 'POST';
  if (pathname === '/admin/do') return method === 'POST';
  if (isAdminPath(pathname)) return read;
  if (pathname === '/api/admin/staging-url') return method === 'POST';
  if (pathname === '/api/admin/brand-workspace') return method === 'POST';
  if (/^\/api\/admin\/brand-workspace\/attachments\/[^/]+$/.test(pathname)) return method === 'POST';
  if (/^\/api\/admin\/media\/[^/]+$/.test(pathname)) return read;
  // The handler rechecks the current studio role; brand reference files stay private.
  if (/^\/api\/brand-workspace\/attachments\/[^/]+$/.test(pathname)) return read;
  if (!read) return false;
  if (pathname.startsWith('/_next/static/')) return true;
  if (/^\/fonts\/[a-zA-Z0-9_./-]+\.(?:css|woff2?)$/.test(pathname)) return true;
  return ['/favicon.ico', '/icon.png', '/apple-icon.png', '/brand/twings.svg', '/brand/twings-mark-black.png', '/brand/twings-mark-white.png', '/brand/twings-mark-mask.png'].includes(pathname);
}

export function brandRouteAllowed(pathname: string, method: string): boolean {
  const read = method === 'GET' || method === 'HEAD';
  if (AUTH_METHODS[pathname]?.includes(method)) return true;
  if (pathname === '/api/workspace-locale') return method === 'POST';
  if (isBrandPath(pathname)) return read;
  if (pathname === '/api/brand-production') return method === 'POST';
  if (/^\/api\/brand-production\/[a-f0-9-]+(?:\/media)?$/.test(pathname)) return read;
  if (pathname === '/api/brand-workspace') return read || method === 'POST';
  if (/^\/api\/brand-workspace\/attachments\/[^/]+$/.test(pathname)) return read || method === 'POST';
  return read && !pathname.startsWith('/api/') && !isAdminPath(pathname) && adminRouteAllowed(pathname, method);
}

/** Former matcher exclusions now run only AFTER the host policy, preserving consumer behavior. */
export function bypassConsumerLocale(pathname: string): boolean {
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') return true;
  return /^\/(?:_next\/static|_next\/image|favicon\.ico|sitemap\.xml|robots\.txt|sw\.js|offline\.html|manifest\.webmanifest|fonts\/|\.storage\/|api\/|auth\/|r\/)/.test(pathname)
    || /\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|woff2?)$/.test(pathname);
}

export function authReturnPath(raw: unknown, hostname: string, fallback: string): string {
  const base = hostname === 'admin.twings.app' ? '/admin' : hostname === 'brand.twings.app' ? '/brand' : fallback;
  const path = safeReturnPath(raw, base);
  const pathname = new URL(path, 'https://path.invalid').pathname;
  if (hostname === 'admin.twings.app' && !isAdminPath(pathname)) return '/admin';
  if (hostname === 'brand.twings.app' && !isBrandPath(pathname)) return '/brand';
  return path;
}

export function authFailurePath(hostname: string, locale: string, error: string, next = '/admin'): string {
  const query = new URLSearchParams({ error });
  if (hostname === 'admin.twings.app' || hostname === 'brand.twings.app') {
    query.set('next', authReturnPath(next, hostname, hostname === 'brand.twings.app' ? '/brand' : '/admin'));
    query.set('locale', locale);
    return `/auth/choose?${query}`;
  }
  return `/${locale}?${query}`;
}

/** The browser Origin is checked even when Sec-Fetch-Site claims same-origin. */
export function sameOriginMutation(url: URL, headers: Headers): boolean {
  const origin = headers.get('origin');
  if (origin !== null) {
    try { if (new URL(origin).origin !== url.origin) return false; } catch { return false; }
  }
  const site = headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}
