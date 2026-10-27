import type { Metadata } from 'next';
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import { ACCOUNT_DELETE_PATH, ACCOUNT_DELETION_REST } from '@/lib/account/links';
import { localeAlternates } from '@/lib/seo/playbook-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { DeletionFacts } from '@/components/account/deletion';
import { deletionMailto } from '@/components/app/deletion-mailto';

/**
 * `/[locale]/delete-account` — how to delete a TWINGS account, readable without signing in
 * (docs/APP-STORE-LAUNCH.md §3.2). Google Play's listing asks for exactly this URL; Apple's reviewer
 * reaches the same request inside the app at `/account/delete`.
 *
 * STATIC, like the legal pages: nothing on it is viewer-shaped, and a store reviewer has to reach it
 * with no session and no JavaScript. Every promise on it comes from the privacy policy's §3.
 */
export const dynamic = 'force-static';
export const revalidate = 3600;

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const copy = getDictionary(locale).accountDeletion;
  return {
    // The root layout appends " · TWINGS"; the brand is not repeated in front of it.
    title: copy.metaTitle,
    description: copy.publicDescription,
    alternates: { canonical: `/${locale}${ACCOUNT_DELETION_REST}`, languages: localeAlternates(ACCOUNT_DELETION_REST) },
  };
}

export default async function DeleteAccountPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const copy = dict.accountDeletion;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={ACCOUNT_DELETION_REST} initialTheme="light" />
      <main id="main" data-account-deletion-page data-section data-theme="light" className="section">
        <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
          <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
          <h1 className="mt-6 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black">{copy.publicTitle}</h1>
          <p data-service-definition className="mt-6 max-w-detail text-body opacity-70">{copy.publicDefinition}</p>

          <section data-deletion-steps aria-labelledby="deletion-how" className="mt-14 max-w-detail">
            <h2 id="deletion-how" className="text-xl font-semibold">{copy.howHeading}</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[0.9375rem] leading-relaxed opacity-80">
              {copy.howSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <a href={ACCOUNT_DELETE_PATH} data-deletion-signin className="mt-6 inline-flex min-h-12 items-center rounded-full bg-accent px-6 text-sm font-semibold text-white">
              {copy.signinCta} →
            </a>
          </section>

          <section data-deletion-mail aria-labelledby="deletion-mail" className="mt-12 max-w-detail border-t border-hairline pt-8">
            <h2 id="deletion-mail" className="text-xl font-semibold">{copy.mailHeading}</h2>
            <p className="mt-3 text-[0.9375rem] leading-relaxed opacity-80">{interpolate(copy.mailBody, { email: BUSINESS.email })}</p>
            <a href={deletionMailto(dict.account, null)} className="text-accent mt-4 inline-block font-label text-eyebrow uppercase">
              {copy.mailCta} →
            </a>
          </section>

          <div className="mt-12 max-w-detail border-t border-hairline pt-8">
            <DeletionFacts copy={copy} questions />
          </div>

          <section data-deletion-time aria-labelledby="deletion-time" className="mt-12 max-w-detail border-t border-hairline pt-8">
            <h2 id="deletion-time" className="text-xl font-semibold">{copy.timeHeading}</h2>
            <p className="mt-3 text-[0.9375rem] leading-relaxed opacity-80">{copy.timeBody}</p>
            <a href={legalHref(locale, 'privacy')} data-deletion-privacy className="mt-4 inline-block text-sm underline underline-offset-4">
              {copy.privacyLink} →
            </a>
          </section>
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
