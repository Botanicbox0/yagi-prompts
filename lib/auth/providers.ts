/**
 * The OAuth doors TWINGS offers (docs/TEMPLATES-IA.md §8, founder 2026-09-06: "kr쪽은 카카오톡으로
 * 가입하기가 가능하면 좀 편할 것 같다").
 *
 * Both are Supabase Auth providers, so the round trip is the same code path with a different
 * `provider` string; what differs is the DOOR: Kakao first for a Korean reader, Google first for
 * everyone else, and the embedded-WebView interstitial (F1) applies to Google only — Kakao login
 * works inside KakaoTalk's own browser, which is where Korean readers arrive from.
 */
export const AUTH_PROVIDERS = ['google', 'kakao'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && (AUTH_PROVIDERS as readonly string[]).includes(value);
}

/** The order the chooser lists the doors in, by locale. */
export function providersForLocale(locale: string): readonly AuthProvider[] {
  return locale === 'ko' ? ['kakao', 'google'] : ['google', 'kakao'];
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
