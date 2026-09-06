import type { Metadata } from 'next';
import { GoatMark } from '@/components/nav/goat-mark';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { providersForLocale, signInWithProviderHref, type AuthProvider } from '@/lib/auth/providers';

/**
 * `/auth/choose?next=…&locale=…` — the sign-in door (docs/TEMPLATES-IA.md §8).
 *
 * Where `/auth/signin` sends a reader who has not named a provider: two buttons, Kakao first for a
 * Korean reader and Google first for everyone else, each a plain link back into `/auth/signin`
 * with `provider=` set. No JavaScript, no session read — the (app) root layout supplies `noindex`
 * and force-dynamic, and middleware never runs under `/auth/*`, which is why the signin handler
 * writes the locale cookie the layout resolves `<html lang>` from.
 *
 * The Kakao button wears Kakao's brand yellow (#FEE500, black text) as its guidelines ask; Google's
 * is the site's outline button — the brand rules for the Google mark are not met by our type, so
 * the button carries the word rather than the logo.
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

const BUTTON: Record<AuthProvider, string> = {
  kakao: 'bg-[#FEE500] text-[#191919]',
  google: 'border border-current',
};

export default async function ChooseProviderPage(props: RouteProps) {
  const { locale, dict, next } = await resolve(props);
  const labels: Record<AuthProvider, string> = {
    kakao: dict.auth.startWithKakao,
    google: dict.auth.startWithGoogle,
  };

  return (
    <main data-auth-choose className="mx-auto flex min-h-svh w-full max-w-detail flex-col justify-center px-gutter py-16">
      <p className="flex items-center gap-2.5">
        <GoatMark className="h-6 w-6" />
        <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">{dict.meta.siteName}</span>
      </p>

      <p className="text-accent mt-12 font-label text-eyebrow uppercase">{dict.auth.chooseEyebrow}</p>
      <h1 className="mt-5 font-display text-[clamp(2.25rem,8vw,4rem)] leading-[0.92] font-black uppercase">{dict.auth.chooseTitle}</h1>
      <p className="mt-6 max-w-detail text-body opacity-70">{dict.auth.chooseBody}</p>

      <div className="mt-10 flex flex-col gap-3 sm:max-w-sm">
        {providersForLocale(locale).map((provider) => (
          <a
            key={provider}
            href={signInWithProviderHref(provider, next, locale)}
            data-auth-provider={provider}
            className={`inline-flex min-h-12 items-center justify-center px-6 py-3 font-label text-label uppercase ${BUTTON[provider]}`}
          >
            {labels[provider]}
          </a>
        ))}
      </div>

      <p className="mt-8 font-mono text-[0.72rem] leading-relaxed opacity-45">{dict.auth.chooseNote}</p>
    </main>
  );
}
