import type { Metadata } from 'next';
import { TwingsLogo, TwingsMark } from '@/components/brand/twings-mark';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { getRequestLocale } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { AUTH_PROVIDERS, chooseProviderHref, signInWithProviderHref, type AuthProvider } from '@/lib/auth/providers';
import { legalDocument } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import { authReturnPath, isBrandPath } from '@/lib/routing/surfaces';
import { publicHref, requestSurface } from '@/lib/routing/request-surface';
import { BrandShowcase } from '@/components/auth/brand-showcase';
import styles from '@/components/auth/brand-entry.module.css';

/**
 * `/auth/choose?next=…&locale=…` — the sign-in door (docs/TEMPLATES-IA.md §8).
 *
 * Provider links, consent and copy render on the server, without a session read. Brand entry
 * adds a product introduction and a small public-media carousel; consumer/admin entry stays
 * compact. The (app) layout supplies noindex and force-dynamic; middleware owns locale/host.
 *
 * Both buttons follow their owner's brand rules: Google's is white with the four-colour "G", the
 * #747775 border and the name in mixed case (never "GOOGLE", so no `uppercase` here); Kakao's is
 * #FEE500 with the black speech-bubble symbol and 85% black text.
 */
export const dynamic = 'force-dynamic';

interface RouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : (value?.[0] ?? null);
}

async function resolve(props: RouteProps) {
  const params = await props.searchParams;
  const rawLocale = first(params.locale);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : await getRequestLocale();
  const { admin, brand, workspace } = await requestSurface();
  const error = first(params.error);
  const next = authReturnPath(first(params.next), admin ? 'admin.twings.app' : brand ? 'brand.twings.app' : '', '/');
  const brandEntry = !admin && (brand || isBrandPath(new URL(next, 'https://path.invalid').pathname));
  return { locale, dict: getDictionary(locale), admin: workspace, brandEntry, error, next };
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

function ProviderMark({ provider, className }: { provider: AuthProvider; className?: string }) {
  return provider === 'google' ? <GoogleMark className={className} /> : <KakaoMark className={className} />;
}

const STYLE: Record<AuthProvider, string> = {
  google: 'border border-[#747775] bg-white text-[#1f1f1f]',
  kakao: 'border border-[#FEE500] bg-[#FEE500] text-[#000000]/85',
};

interface LegalLink {
  href: string;
  label: string;
}

/**
 * The consent line carries `{terms}` / `{privacy}` placeholders (the dictionaries keep ko/en
 * placeholders in step); each becomes a link to the document, everything else stays text.
 */
function withLinks(template: string, links: Readonly<Record<string, LegalLink>>) {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    const link = key ? links[key] : undefined;
    if (!link) return part;
    return (
      <a key={index} href={link.href} className="underline underline-offset-2 hover:opacity-100">
        {link.label}
      </a>
    );
  });
}

export default async function ChooseProviderPage(props: RouteProps) {
  const { locale, dict, next, admin, brandEntry, error } = await resolve(props);
  const labels: Record<AuthProvider, string> = {
    google: dict.auth.continueWithGoogle,
    kakao: dict.auth.continueWithKakao,
  };
  const legal = withLinks(dict.auth.chooseLegal, {
    terms: { href: publicHref(legalHref(locale, 'terms'), admin), label: legalDocument('terms', locale).title },
    privacy: { href: publicHref(legalHref(locale, 'privacy'), admin), label: legalDocument('privacy', locale).title },
  });
  const providers = AUTH_PROVIDERS.map(provider => (
    <a key={provider} href={signInWithProviderHref(provider, next, locale)} data-auth-provider={provider}
      className={`relative flex h-12 w-full items-center justify-center rounded-[4px] px-12 text-[0.95rem] font-semibold transition-opacity hover:opacity-85 ${STYLE[provider]}`}>
      <ProviderMark provider={provider} className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" />
      {labels[provider]}
    </a>
  ));
  const languageLinks = (['ko', 'en'] as const).map(language => (
    <a key={language} href={chooseProviderHref(next, language)} hrefLang={language} lang={language}
      aria-current={locale === language ? 'true' : undefined}
      className={locale === language ? 'underline underline-offset-4' : 'opacity-60 hover:opacity-100'}>
      {language === 'ko' ? dict.nav.localeKo : dict.nav.localeEn}
    </a>
  ));
  const authError = (error === 'oauth' || error === 'oauth_unconfigured') && (
    <p role="alert" className="mt-6 border-l-2 border-accent pl-3 text-left text-body">
      {error === 'oauth' ? dict.notice.oauth : dict.notice.oauthUnconfigured}
    </p>
  );

  if (brandEntry) {
    const copy = dict.auth.brandEntry;
    return (
      <main data-auth-choose data-brand-auth className={styles.page}>
        {/* Local/preview brand links get the same licensed type as the dedicated brand host. */}
        {!admin && <link rel="stylesheet" href="/fonts/helvetica-neue/helvetica-neue.css" />}
        <div className={styles.layout}>
          <div className={styles.intro}>
            <header className={styles.header}>
              <a href={publicHref(`/${locale}`, admin)} className={styles.logo}>
                <TwingsLogo size={22} />
                <span className={styles.byline}>{dict.admin.byline}</span>
              </a>
              <nav data-auth-language className={styles.languages}>{languageLinks}</nav>
            </header>
            <div className={styles.content}>
              <p className={styles.eyebrow}>{copy.eyebrow}</p>
              <h1 className={styles.heading}><span>{copy.title}</span><span>{copy.titleEnd}</span></h1>
              <p className={styles.description}>{copy.description}</p>
              <p className={styles.steps}>{copy.steps}</p>
              <section className={styles.login} aria-labelledby="brand-auth-title">
                <h2 id="brand-auth-title">{dict.auth.chooseTitle}</h2>
                <p className={styles.loginHint}>{dict.auth.chooseLede}</p>
                {authError}
                <div className={styles.providers}>{providers}</div>
                <p data-auth-legal className={styles.legal}>{legal}</p>
              </section>
            </div>
            <footer className={styles.footer}>
              <a href={publicHref(`/${locale}/campaigns`, admin)}>{copy.more} <span aria-hidden="true">↗</span></a>
              <a href={next} data-auth-back>← {dict.auth.chooseBack}</a>
            </footer>
          </div>
          <BrandShowcase copy={copy} assetOrigin={admin ? 'https://twings.app' : ''} />
        </div>
      </main>
    );
  }

  return (
    <main data-auth-choose className="mx-auto flex min-h-svh w-full max-w-shell flex-col items-center justify-center px-gutter py-16">
      <div className="flex w-full max-w-[22rem] flex-col items-center text-center">
        <a href={publicHref(`/${locale}`, admin)} className={admin ? 'workspace-brand workspace-auth-brand' : 'inline-flex items-center gap-2.5'}>
          {admin ? (
            <>
              <TwingsLogo size={22} />
              <span className="workspace-brand-byline">{dict.admin.byline}</span>
            </>
          ) : (
            <>
              <TwingsMark className="h-7" />
              <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">{dict.meta.siteName}</span>
            </>
          )}
        </a>

        <h1 className="mt-12 font-display text-[1.75rem] leading-tight font-black uppercase">{dict.auth.chooseTitle}</h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed opacity-60">{dict.auth.chooseLede}</p>

        {authError}

        <div className="mt-10 flex w-full flex-col gap-3">
          {providers}
        </div>

        <p data-auth-legal className="mt-8 text-[0.75rem] leading-relaxed opacity-50">
          {legal}
        </p>

        <div data-auth-language className="mt-6 flex gap-4 text-sm">
          {languageLinks}
        </div>

        <a href={next} data-auth-back className="mt-10 font-label text-eyebrow uppercase opacity-50 hover:opacity-100">
          ← {dict.auth.chooseBack}
        </a>
      </div>
    </main>
  );
}
