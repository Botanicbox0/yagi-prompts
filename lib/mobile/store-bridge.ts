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

export const DEFAULT_APP_BUNDLE_ID = 'app.twings.client';
export const DEFAULT_ANDROID_PACKAGE = 'app.twings.client';
export const DEFAULT_APPLE_TEAM_ID = 'TEAMID0000';

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

/** `ANDROID_SHA256_CERT_FINGERPRINTS`, comma separated; anything not shaped like a SHA-256 drops out. */
export function parseAndroidFingerprints(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => SHA256_PATTERN.test(item));
}

/**
 * The statement list, or `[]` until Play Console's app signing fingerprint is in Vercel. An empty
 * list is the honest answer: a made-up fingerprint verifies nothing either, and it reads as if a key
 * had been registered.
 */
export function buildAndroidAssetLinks(
  env: Record<string, string | undefined> = process.env,
): AndroidAssetLinkStatement[] {
  const packageName = env.ANDROID_PACKAGE_NAME?.trim() || DEFAULT_ANDROID_PACKAGE;
  const fingerprints = parseAndroidFingerprints(env.ANDROID_SHA256_CERT_FINGERPRINTS);
  if (fingerprints.length === 0) return [];
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
 * Detects whether the current viewer is inside a Capacitor wrapper (which appends `TwingsIOS/` or
 * `TwingsAndroid/` to the user agent), the installed PWA standalone shell, or a regular browser tab.
 * The Google Play app is a Trusted Web Activity — Chrome itself, with Chrome's user agent — so it is
 * recognised in the page instead: lib/mobile/store-shell.ts.
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
