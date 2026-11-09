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
  // `usage`: the payment provider's return page for secondary usage (docs/SECONDARY-USAGE.md).
  // `creators`: the creator pool (docs/PLATFORM-2.0.md §17.3).
  // `identity`: the fixed brand identity layer, memory, and looks (docs/BRAND-PRODUCT.md §5).
  return pathname === '/brand' || /^\/brand\/(?:projects|members|invite|settings|library|studio|usage|creators|identity)(?:\/|$)/.test(pathname);
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
  if (/^\/api\/campaign-production\/[a-f0-9-]+\/media$/.test(pathname)) return read;
  if (/^\/api\/campaign-collaboration\/files\/[a-f0-9-]+$/.test(pathname)) return read;
  if (pathname === '/admin/do') return method === 'POST';
  if (isAdminPath(pathname)) return read;
  if (pathname === '/api/admin/staging-url') return method === 'POST';
  if (pathname === '/api/admin/brand-workspace') return method === 'POST';
  if (/^\/api\/admin\/brand-workspace\/attachments\/[^/]+$/.test(pathname)) return method === 'POST';
  if (/^\/api\/admin\/media\/[^/]+$/.test(pathname)) return read;
  if (/^\/api\/admin\/community\/[a-f0-9-]+\/media$/.test(pathname)) return read;
  // The handler rechecks the current studio role; brand reference files stay private.
  if (/^\/api\/brand-workspace\/attachments\/[^/]+$/.test(pathname)) return read;
  // Organization logos: the handler rechecks the studio role before any byte leaves storage.
  if (/^\/api\/brand-workspace\/organizations\/[^/]+\/logo$/.test(pathname)) return read;
  // Shortlist pictures (docs/BRAND-SHORTLIST.md): the handler rechecks the studio role or the campaign seat.
  if (/^\/api\/brand-workspace\/shortlist\/[a-f0-9-]+\/avatar$/.test(pathname)) return read;
  if (!read) return false;
  if (pathname.startsWith('/_next/static/')) return true;
  if (/^\/fonts\/[a-zA-Z0-9_./-]+\.(?:css|woff2?)$/.test(pathname)) return true;
  return [
    '/favicon.ico',
    '/icon.png',
    '/apple-icon.png',
    '/brand/twings.svg',
    '/brand/twings-mark-black.png',
    '/brand/twings-mark-white.png',
    '/brand/twings-mark-mask.png',
    '/brand/yagi-mark-black.png',
    '/brand/yagi-mark-white.png',
    '/brand/yagi-mark-mask.png',
  ].includes(pathname);
}

/**
 * Public example media shown in the brand self-serve studio and workspace showcases.
 * Exact file names only: no other /reel path, extension or directory opens on the brand host.
 */
const STUDIO_DEMO_FILES = new Set([
  ...['designed-format.jpg', 'designed-format.mp4', 'different-person.jpg', 'different-person.mp4', 'reference-selfie.jpeg'].map((f) => `/reel/studio-demo/${f}`),
  ...[
    'vto-free-alley.webp',
    'vto-free-amber.webp',
    'vto-free-drape.webp',
    'vto-free-mirror.webp',
    'vto-free-sofa.webp',
    'vto-garment.webp',
    'vto-look-front.webp',
    'vto-look-side.webp',
    'vto-look-upper.webp',
    'vto-set-front.webp',
    'vto-set-side.webp',
    'vto-set-upper.webp',
  ].map((f) => `/reel/studio/${f}`),
  ...[
    'house-runway-1080p.mp4',
    'house-runway-1080p.jpg',
    'studio-editorial-blue-1080p.mp4',
    'studio-editorial-blue-1080p.jpg',
    'house-french-blue-hero-1080p.mp4',
    'house-french-blue-hero-1080p.jpg',
    'studio-rain-editorial-1080p.mp4',
    'studio-rain-editorial-1080p.jpg',
    'production-paris.mp4',
    'production-paris.jpg',
    'city-fashion.mp4',
    'city-fashion.jpg',
    'tea-editorial.mp4',
    'tea-editorial.jpg',
    'y2k-flip-phone.mp4',
    'y2k-flip-phone.jpg',
    'slot-1-subject-editorial.jpg',
    'slot-2-space-concrete-blue.jpg',
    'slot-3-pose-lowangle-lookbook.jpg',
    'slot-4-color-french-cobalt.jpg',
    'pin-texture-35mm-grain-weave.jpg',
    'swap-product-luxury-bottle.jpg',
    'verified-gpt-image-2-6.png',
    'verified-nano-banana-pro.png',
    'verified-seedream-5-0-pro.png',
  ].map((f) => `/reel/brands/${f}`),
  '/reel/campaigns/beauty-rose.mp4',
  '/reel/campaigns/beauty-rose.jpg',
  '/reel/campaigns/highteen.jpg',
  '/reel/campaigns/retro-phone-01.jpg',
  '/reel/campaigns/retro-phone-02.jpg',
  ...[
    'c-logo-wide.webp',
    'c-logo-raw.webp',
    'c-logo-ours.webp',
    'c-garment-wide.webp',
    'c-garment-raw.webp',
    'c-garment-ours.webp',
    'c-skin-wide.webp',
    'c-skin-raw.webp',
    'c-skin-ours.webp',
    'cut-beads.webp',
    'cut-cheek.webp',
    'cut-hands.webp',
    'cut-mark.webp',
    'cut-pump.webp',
    'cut-scent.webp',
    'look-carpet.webp',
    'look-drape.webp',
    'look-feather.webp',
    'look-knit.webp',
    'look-sculpt.webp',
    'look-street.webp',
    'v7/film-tea.jpg',
    'v7/rx-beauty-orig.jpg',
    'v7/rx-beauty-product.jpg',
    'v7/rx-beauty-world.jpg',
    'v7/rx-runway-duo.jpg',
    'v7/rx-runway-model.jpg',
    'v7/rx-runway-orig.jpg',
    'v7/rx-runway-outfit.jpg',
    'v7/rx-runway-set.jpg',
  ].map((f) => `/reel/landing/${f}`),
]);

export function brandRouteAllowed(pathname: string, method: string): boolean {
  const read = method === 'GET' || method === 'HEAD';
  if (/^\/api\/campaign-production\/[a-f0-9-]+\/media$/.test(pathname)) return read;
  if (AUTH_METHODS[pathname]?.includes(method)) return true;
  if (pathname === '/api/workspace-locale') return method === 'POST';
  if (isBrandPath(pathname)) return read;
  if (STUDIO_DEMO_FILES.has(pathname)) return read;
  if (pathname === '/api/brand-production') return method === 'POST';
  if (pathname === '/api/campaign-collaboration') return method === 'POST';
  // The creator pool's one action, "invite to a campaign" (docs/PLATFORM-2.0.md §17.3).
  if (pathname === '/api/brand-creators') return method === 'POST';
  if (pathname === '/api/campaign-funding') return read || method === 'POST';
  if (/^\/api\/campaign-collaboration\/files\/[a-f0-9-]+$/.test(pathname)) return read;
  if (/^\/api\/brand-production\/[a-f0-9-]+(?:\/media)?$/.test(pathname)) return read;
  if (pathname === '/api/brand-workspace') return read || method === 'POST';
  // The studio's campaign preparation (docs/BRAND-STAFF-ACCESS.md): the handler is admin-only and allowlisted.
  if (pathname === '/api/brand-workspace/studio') return method === 'POST';
  // Secondary-usage payment (docs/SECONDARY-USAGE.md): create/confirm by POST, status by GET.
  if (pathname === '/api/brand-workspace/usage') return read || method === 'POST';
  if (/^\/api\/brand-workspace\/attachments\/[^/]+$/.test(pathname)) return read || method === 'POST';
  if (/^\/api\/brand-workspace\/organizations\/[^/]+\/logo$/.test(pathname)) return read || method === 'POST';
  if (/^\/api\/brand-workspace\/shortlist\/[a-f0-9-]+\/avatar$/.test(pathname)) return read;
  return read && !pathname.startsWith('/api/') && !isAdminPath(pathname) && adminRouteAllowed(pathname, method);
}

/** Former matcher exclusions now run only AFTER the host policy, preserving consumer behavior. */
export function bypassConsumerLocale(pathname: string): boolean {
  // Self-hosted photo hints are static assets. Keep the host boundary above intact.
  if (pathname === '/workers/photo-advice-v1.js' || pathname === '/models/face-landmarker-float16-v1.task' ||
    /^\/vendor\/face-1\.1\.0\/(?:vision_bundle\.js|wasm\/vision_wasm_(?:nosimd_)?internal\.(?:js|wasm))$/.test(pathname)) return true;
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') return true;
  if (pathname === '/.well-known/assetlinks.json' || pathname === '/.well-known/apple-app-site-association') return true;
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

export function authFailurePath(hostname: string, locale: string, error: string, next?: string): string {
  const query = new URLSearchParams({ error });
  if (hostname === 'admin.twings.app' || hostname === 'brand.twings.app') {
    query.set('next', authReturnPath(next, hostname, hostname === 'brand.twings.app' ? '/brand' : '/admin'));
    query.set('locale', locale);
    return `/auth/choose?${query}`;
  }
  // Audit P1-5: a cancelled Kakao/Google consent from a template, apply or checkout path used to
  // drop the reader on home with no way back. `next` rides along, re-validated here (the callers
  // already did) so an unsafe value can never reach the notice band's sign-in retry link.
  query.set('next', authReturnPath(next, hostname, `/${locale}/video`));
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
