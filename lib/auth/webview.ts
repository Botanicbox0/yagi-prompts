/**
 * Design review F1 — embedded-WebView detection for the OAuth entry (§3.7).
 *
 * Google refuses OAuth inside in-app browsers (`disallowed_useragent`), and the founder shares
 * twings.app as a bio link — so sign-in presses arrive from EXACTLY those WebViews:
 * Instagram, KakaoTalk, Facebook, Line, Naver, Daum, Everytime, plus anything built on the
 * Android WebView (`; wv)` is the platform's own marker). `/auth/signin` sends a detected
 * reader to `/auth/open-in-browser` instead of into Google's error page.
 *
 * Pure and dependency-free so the token list is testable with real UA strings
 * (tests/auth/webview.test.ts). Matching is case-insensitive: the apps do not agree on casing.
 * A miss costs one round trip to Google's own error; a false positive costs a working browser
 * the interstitial — so the list stays to markers real apps actually send, never `Mobile/`-wide
 * guesses.
 */

export const EMBEDDED_WEBVIEW_TOKENS = [
  'Instagram',
  'KAKAOTALK',
  'FBAN',
  'FBAV',
  'Line/',
  'NAVER(inapp',
  'DaumApps',
  'Everytime',
  '; wv)',
] as const;

export function isEmbeddedWebView(ua: string): boolean {
  const haystack = ua.toLowerCase();
  return EMBEDDED_WEBVIEW_TOKENS.some((token) => haystack.includes(token.toLowerCase()));
}

/** Recognizes the native Capacitor shell WebView (`TwingsIOS/` or `TwingsAndroid/`). */
export function isCapacitorShellWebView(ua: string): boolean {
  return /Twings(?:IOS|Android)\//i.test(ua);
}
