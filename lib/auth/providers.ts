/**
 * The OAuth doors TWINGS offers (docs/TEMPLATES-IA.md §8, founder 2026-09-06: "kr쪽은 카카오톡으로
 * 가입하기가 가능하면 좀 편할 것 같다").
 *
 * Both are Supabase Auth providers, so the round trip is the same code path with a different
 * `provider` string; what differs is the DOOR page, and the embedded-WebView interstitial (F1),
 * which applies to Google only — Kakao login works inside KakaoTalk's own browser, which is where
 * Korean readers arrive from.
 */
export const ALL_AUTH_PROVIDERS = ['apple', 'google', 'kakao'] as const;
export const AUTH_PROVIDERS = ['google', 'kakao'] as const;
export type AuthProvider = (typeof ALL_AUTH_PROVIDERS)[number];

export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && (ALL_AUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The order the chooser lists the doors in: Google first on web/Android, Apple first in the iOS
 * App Store shell (`ios-store`) or when `NEXT_PUBLIC_APPLE_AUTH=on` (App Store Guideline 4.8),
 * keeping 1-arg `providersForLocale('ko' | 'en')` at `['google', 'kakao']`.
 */
export function providersForLocale(
  _locale: string,
  options?: {
    platform?: 'ios-store' | 'android-store' | 'pwa-standalone' | 'web';
    appleEnabled?: boolean;
  },
): readonly AuthProvider[] {
  if (
    options?.appleEnabled === true ||
    options?.platform === 'ios-store' ||
    process.env.NEXT_PUBLIC_APPLE_AUTH === 'on'
  ) {
    return ALL_AUTH_PROVIDERS;
  }
  return AUTH_PROVIDERS;
}

/** Google refuses OAuth inside embedded WebViews; Kakao does not. */
export function needsRealBrowser(provider: AuthProvider): boolean {
  return provider === 'google';
}

export function signInWithProviderHref(provider: AuthProvider, next: string, locale: string): string {
  return `/auth/signin?provider=${provider}&next=${encodeURIComponent(next)}&locale=${locale}`;
}

export function chooseProviderHref(next: string, locale: string): string {
  return `/auth/choose?next=${encodeURIComponent(next)}&locale=${locale}`;
}
