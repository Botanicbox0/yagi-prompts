import type { Metadata } from 'next';
import { GoatMark } from '@/components/nav/goat-mark';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { AUTH_PROVIDERS, signInWithProviderHref, type AuthProvider } from '@/lib/auth/providers';

/**
 * `/auth/choose?next=…&locale=…` — the sign-in door (docs/TEMPLATES-IA.md §8).
 *
 * Where `/auth/signin` sends a reader who has not named a provider: one compact panel, Google
 * first (founder, 2026-09-06), Kakao second, each a plain link back into `/auth/signin` with
 * `provider=` set. No JavaScript, no session read — the (app) root layout supplies `noindex` and
 * force-dynamic, and middleware never runs under `/auth/*`.
 *
 * Both buttons follow their owner's brand rules: Google's is white with the four-colour "G" and a
 * neutral border; Kakao's is #FEE500 with the black speech-bubble symbol and 85% black text.
 */
export const dynamic = 'force-dynamic';

interface RouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : (value?.[0] ?? null);
}

/** Same rule as `/auth/signin`: same-origin relative paths only. */
function safeNext(raw: string | null): string {
  return raw !== null && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

async function resolve(props: RouteProps) {
  const params = await props.searchParams;
  const rawLocale = first(params.locale);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  return { locale, dict: getDictionary(locale), next: safeNext(first(params.next)) };
}

export async function generateMetadata(props: RouteProps): Promise<Metadata> {
  const { dict } = await resolve(props);
  return { title: dict.auth.chooseTitle };
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function KakaoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#000000"
        fillOpacity="0.85"
        d="M12 3C6.48 3 2 6.58 2 11c0 2.84 1.86 5.33 4.66 6.75l-1.2 4.42c-.1.38.32.68.65.46l5.25-3.5c.21.02.42.02.64.02 5.52 0 10-3.58 10-8S17.52 3 12 3z"
      />
    </svg>
  );
}

const STYLE: Record<AuthProvider, string> = {
  google: 'border border-[#dadce0] bg-white text-[#1f1f1f]',
  kakao: 'border border-[#FEE500] bg-[#FEE500] text-[#000000]/85',
};

export default async function ChooseProviderPage(props: RouteProps) {
  const { locale, dict, next } = await resolve(props);
  const labels: Record<AuthProvider, string> = {
    google: dict.auth.startWithGoogle,
    kakao: dict.auth.startWithKakao,
  };

  return (
    <main data-auth-choose className="mx-auto flex min-h-svh w-full max-w-shell flex-col items-center justify-center px-gutter py-16">
      <div className="w-full max-w-[26rem]">
        <a href={`/${locale}`} className="inline-flex items-center gap-2.5">
          <GoatMark className="h-6 w-6" />
          <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">{dict.meta.siteName}</span>
        </a>

        <p className="text-accent mt-10 font-label text-eyebrow uppercase">{dict.auth.chooseEyebrow}</p>
        <h1 className="mt-3 font-display text-[clamp(1.9rem,5vw,2.6rem)] leading-[0.95] font-black whitespace-pre-line uppercase">
          {dict.auth.chooseTitle}
        </h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed opacity-70">{dict.auth.chooseBody}</p>

        <div className="mt-8 flex flex-col gap-3">
          {AUTH_PROVIDERS.map((provider) => (
            <a
              key={provider}
              href={signInWithProviderHref(provider, next, locale)}
              data-auth-provider={provider}
              className={`relative flex h-12 items-center justify-center rounded-[4px] pr-6 pl-12 font-label text-label uppercase transition-opacity hover:opacity-85 ${STYLE[provider]}`}
            >
              {provider === 'google' ? <GoogleMark className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" /> : <KakaoMark className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" />}
              {labels[provider]}
            </a>
          ))}
        </div>

        <p className="mt-6 font-mono text-[0.7rem] leading-relaxed opacity-45">{dict.auth.chooseNote}</p>
        <a href={next} data-auth-back className="mt-8 inline-block font-label text-eyebrow uppercase opacity-60 hover:opacity-100">
          ← {dict.auth.chooseBack}
        </a>
      </div>
    </main>
  );
}
