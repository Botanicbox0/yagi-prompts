/**
 * TWINGS Native Store Bridge & Domain Association Contract
 * (docs/PLATFORM-2.0.md §5.1–§5.3 — PWA + iOS App Store + Google Play Store).
 *
 * Why this module exists:
 * 1. Both Apple App Store (Universal Links / Associated Domains) and Google Play Store
 *    (Trusted Web Activity / Android App Links) verify domain ownership via `/.well-known/*`
 *    JSON endpoints before allowing the native app shell to open `https://twings.app`
 *    without a browser address bar.
 * 2. Apple Guideline 3.1.1 and Google Play Payments policy forbid raw web PG checkout
 *    inside a store-distributed WebView for digital goods unless In-App Purchase (15–30%)
 *    or Korea alternative billing (26%) is used. Because TWINGS template prices run on a
 *    5% floor margin (docs/TOSS-CONTRACT.md), the store binary runs in Companion Studio
 *    mode (`companion`) by default: format discovery, native camera selfie capture,
 *    completion push notifications, render gallery/download/share, and creator campaigns.
 */

/**
 * How a store binary tells the site what it is (docs/APP-STORE-LAUNCH.md §2):
 * - Capacitor (iOS/Android) appends `TwingsIOS/1.0` / `TwingsAndroid/1.0` to the user agent
 *   (mobile/capacitor.config.json), so the server and the page can both read it.
 * - A Trusted Web Activity runs in Chrome with Chrome's own user agent and SHARES Chrome's cookies, so
 *   it is recognised by its start URL (`?source=twa`, mobile/twa-manifest.json) or its own
 *   `android-app://app.twings.client` referrer and remembered in sessionStorage — per tab, so the
 *   same person's ordinary Chrome tab stays a normal web page that can pay. Only OUR package counts:
 *   Gmail, Slack and other apps open links in Custom Tabs with their own `android-app://` referrer,
 *   and those visitors must still be able to buy.
 * The page mirrors the answer onto `<html data-store>`; app/globals.css hides every purchase surface
 * under it, and API calls carry it as the `x-twings-client` header.
 */
export const STORE_CLIENT_KEY = 'twings:store-client';
export const STORE_CLIENT_HEADER = 'x-twings-client';
export const TWA_SOURCE = 'twa';

export const DEFAULT_APP_BUNDLE_ID = 'app.twings.client';
export const DEFAULT_ANDROID_PACKAGE = 'app.twings.client';
export const DEFAULT_APPLE_TEAM_ID = 'TEAMID0000';

/**
 * Runs inline in `<head>` before first paint (both root layouts), so a static template page never
 * flashes its price or make button inside a store binary. Kept dependency-free and wrapped in
 * try/catch: blocked storage must not break the page, only the TWA memory.
 */
export const STORE_CLIENT_SCRIPT = `(function(){var d=document.documentElement,u=navigator.userAgent||'',v=null,k=${JSON.stringify(STORE_CLIENT_KEY)};
if(/TwingsIOS\\//i.test(u))v='ios-store';else if(/TwingsAndroid\\//i.test(u))v='android-store';
else{try{v=sessionStorage.getItem(k)}catch(e){}
if(v!=='android-store'){var q=null;try{q=new URLSearchParams(location.search).get('source')}catch(e){}
if(q===${JSON.stringify(TWA_SOURCE)}||(document.referrer||'').indexOf(${JSON.stringify(`android-app://${DEFAULT_ANDROID_PACKAGE}`)})===0)v='android-store';else v=null}}
if(v){d.setAttribute('data-store',v);d.setAttribute('data-standalone','');try{sessionStorage.setItem(k,v)}catch(e){}}})();`;

/** Default placeholder fingerprint when `ANDROID_SHA256_CERT_FINGERPRINTS` is not set yet. */
export const PLACEHOLDER_SHA256_FINGERPRINT =
  '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00';

const SHA256_PATTERN = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export type StorePlatform = 'ios-store' | 'android-store' | 'pwa-standalone' | 'web';

export interface AndroidAssetLinkStatement {
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

export interface AppleAppSiteAssociation {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: Array<{
        '/': string;
        exclude?: boolean;
        comment?: string;
      }>;
    }>;
  };
  webcredentials: {
    apps: string[];
  };
}

export function parseAndroidFingerprints(raw: string | undefined): string[] {
  if (!raw) return [PLACEHOLDER_SHA256_FINGERPRINT];
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => SHA256_PATTERN.test(item));
  return parsed.length > 0 ? parsed : [PLACEHOLDER_SHA256_FINGERPRINT];
}

export function buildAndroidAssetLinks(
  env: Record<string, string | undefined> = process.env,
): AndroidAssetLinkStatement[] {
  const packageName = env.ANDROID_PACKAGE_NAME?.trim() || DEFAULT_ANDROID_PACKAGE;
  const fingerprints = parseAndroidFingerprints(env.ANDROID_SHA256_CERT_FINGERPRINTS);
  return [
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function buildAppleAppSiteAssociation(
  env: Record<string, string | undefined> = process.env,
): AppleAppSiteAssociation {
  const teamId = env.APPLE_TEAM_ID?.trim() || DEFAULT_APPLE_TEAM_ID;
  const bundleId = env.IOS_BUNDLE_ID?.trim() || DEFAULT_APP_BUNDLE_ID;
  const appId = `${teamId}.${bundleId}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            // Excludes first: the first matching component wins. Payment returns and the price page
            // must stay in the browser that started them — the app sells nothing (3.1.3(f)).
            { '/': '/billing/*', exclude: true, comment: 'Web checkout returns stay in the browser' },
            { '/': '/ko/pricing', exclude: true, comment: 'Prices are web-only' },
            { '/': '/en/pricing', exclude: true, comment: 'Prices are web-only' },
            { '/': '/admin/*', exclude: true, comment: 'Admin console stays in browser' },
            { '/': '/brand/*', exclude: true, comment: 'Brand workspace stays on brand.twings.app' },
            { '/': '/api/*', exclude: true, comment: 'API endpoints' },
            { '/': '/ko/*', comment: 'Korean consumer catalogue & templates' },
            { '/': '/en/*', comment: 'English consumer catalogue & templates' },
            { '/': '/renders/*', comment: 'Owner render status & finished works' },
            { '/': '/renders', comment: 'Owner render gallery' },
            { '/': '/account', comment: 'Account & selfie library' },
            { '/': '/identity/*', comment: 'Selfie & social verification' },
            { '/': '/campaigns/*', comment: 'Creator campaign participation' },
            { '/': '/r/*', comment: 'Shared render links' },
            { '/': '/auth/callback', comment: 'OAuth callback' },
          ],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
  };
}

/**
 * Detects whether the current viewer is inside the iOS App Store wrapper, Google Play TWA/Capacitor
 * wrapper, installed PWA standalone shell, or regular browser tab.
 */
export function detectStorePlatform(input: {
  userAgent?: string | null;
  standalone?: boolean;
  clientHeader?: string | null;
}): StorePlatform {
  const header = (input.clientHeader ?? '').toLowerCase();
  if (header === 'ios-store') return 'ios-store';
  if (header === 'android-store') return 'android-store';

  const ua = input.userAgent ?? '';
  if (/TwingsIOS\//i.test(ua)) return 'ios-store';
  if (/TwingsAndroid\//i.test(ua)) return 'android-store';
  if (input.standalone) return 'pwa-standalone';
  return 'web';
}

export interface StoreCheckoutPolicy {
  platform: StorePlatform;
  /** Whether direct Toss Payments web widget checkout is allowed in this surface. */
  allowWebPgCheckout: boolean;
  /**
   * `direct`: standard web / installed PWA Toss checkout.
   * `companion`: iOS/Android store binary where 5% floor margin prevents 15-30% IAP fee;
   * users manage selfies, push notifications, finished renders, and creator campaigns in-app.
   */
  mode: 'direct' | 'companion';
}

/**
 * Whether a request comes from a store binary — the server half of the companion rule. Every route
 * that starts a charge (single order, subscription enrolment, subscription render) refuses these, so
 * a hidden button that something still reaches cannot open checkout inside the app.
 */
export function isStoreRequest(headers: Pick<Headers, 'get'>): boolean {
  const platform = detectStorePlatform({ userAgent: headers.get('user-agent'), clientHeader: headers.get(STORE_CLIENT_HEADER) });
  return !storeCheckoutPolicy(platform).allowWebPgCheckout;
}

/** The header value a page in a store binary sends with its API calls (`<html data-store>`), or null. */
export function storeClientHeaderValue(root: { getAttribute(name: string): string | null } | null | undefined): string | null {
  const value = root?.getAttribute('data-store') ?? null;
  return value === 'ios-store' || value === 'android-store' ? value : null;
}

export function storeCheckoutPolicy(platform: StorePlatform): StoreCheckoutPolicy {
  if (platform === 'ios-store' || platform === 'android-store') {
    return {
      platform,
      allowWebPgCheckout: false,
      mode: 'companion',
    };
  }
  return {
    platform,
    allowWebPgCheckout: true,
    mode: 'direct',
  };
}
