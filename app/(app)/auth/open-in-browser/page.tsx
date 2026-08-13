import type { Metadata } from 'next';
import { GoatMark } from '@/components/nav/goat-mark';
import { absoluteUrl } from '@/lib/seo/site-url';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * `/auth/open-in-browser?next=…&locale=…` — design review F1.
 *
 * Where `/auth/signin` sends a reader whose User-Agent is an embedded WebView
 * (`lib/auth/webview.ts`): Google refuses OAuth there (`disallowed_useragent`), and the bio
 * link on Instagram/KakaoTalk is exactly how readers arrive. The page has ONE job — get the
 * reader into a real browser — so it offers the two moves that actually work in a WebView:
 * long-press-copy the absolute address, or the app's own ⋯ → open-in-external-browser.
 *
 * A page route rather than HTML written by the signin handler, so the heading is set in the §5
 * display faces through the (app) root layout instead of a system stack. That layout also
 * supplies `noindex` and force-dynamic; middleware never runs under `/auth/*`, which is why the
 * signin redirect writes the locale cookie the layout resolves `<html lang>` from.
 *
 * No JavaScript on purpose: a WebView that blocks OAuth is not a place to depend on anything.
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
  return { dict: getDictionary(locale), next: safeNext(first(params.next)) };
}

export async function generateMetadata(props: RouteProps): Promise<Metadata> {
  const { dict } = await resolve(props);
  return { title: dict.auth.webviewTitle };
}

export default async function OpenInBrowserPage(props: RouteProps) {
  const { dict, next } = await resolve(props);

  return (
    <main
      data-webview-interstitial
      className="mx-auto flex min-h-svh w-full max-w-detail flex-col justify-center px-gutter py-16"
    >
      <p className="flex items-center gap-2.5">
        <GoatMark className="h-6 w-6" />
        <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">
          {dict.meta.siteName}
        </span>
      </p>

      <p className="text-accent mt-12 font-label text-eyebrow uppercase">
        {dict.auth.webviewEyebrow}
      </p>
      <h1 className="mt-5 font-display text-[clamp(2.25rem,8vw,4rem)] leading-[0.92] font-black uppercase">
        {dict.auth.webviewTitle}
      </h1>
      <p className="mt-6 max-w-detail text-body opacity-70">{dict.auth.webviewBody}</p>

      <p className="mt-10 font-label text-eyebrow uppercase opacity-60">
        {dict.auth.webviewUrlLabel}
      </p>
      {/* `select-all`: one long-press selects the WHOLE address — the copy this page exists for. */}
      <p
        data-webview-next
        className="mt-3 border border-hairline p-4 font-mono text-code break-all select-all"
      >
        {absoluteUrl(next)}
      </p>

      <p className="mt-6 font-mono text-[0.72rem] leading-relaxed opacity-45">
        {dict.auth.webviewMenuHint}
      </p>
    </main>
  );
}
