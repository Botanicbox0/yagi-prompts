import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { CREATOR_APPLY_PATH, CREATOR_PROGRAM_REST, CREATOR_WORKSPACE_PATH, creatorProgramOpen } from '@/lib/creator-platform/links';
import { localeAlternates } from '@/lib/seo/playbook-metadata';
import { SITE_TWITTER_CARD, siteOgImage } from '@/lib/seo/og';

/**
 * `/{locale}/creators` — the format creator program (docs/CREATOR-PLATFORM.md).
 *
 * Static like every marketing page. It exists only while public intake is open
 * (`creatorProgramOpen()`, server env at build), so the closed default is a real 404 rather than
 * a page promising an application that cannot be sent. The apply form re-checks schema per request.
 */
export const revalidate = 3600;
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = getDictionary(locale).creatorProgram;
  const siteName = getDictionary(locale).meta.siteName;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates: { canonical: `/${locale}${CREATOR_PROGRAM_REST}`, languages: localeAlternates(CREATOR_PROGRAM_REST) },
    openGraph: {
      type: 'website', title: t.metaTitle, description: t.metaDescription,
      url: `/${locale}${CREATOR_PROGRAM_REST}`, locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      siteName, images: [siteOgImage(locale)],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export default async function CreatorProgramPage({ params }: Props) {
  if (!creatorProgramOpen()) notFound();
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale), t = dict.creatorProgram;
  const steps = [[t.step1Title, t.step1Body], [t.step2Title, t.step2Body], [t.step3Title, t.step3Body], [t.step4Title, t.step4Body]];
  const facts = [[t.shareHeading, t.shareBody, 'share'], [t.privateHeading, t.privateBody, 'private'], [t.rulesHeading, t.rulesBody, 'rules']];
  return <>
    <MarketingNav locale={locale} dict={dict} rest={CREATOR_PROGRAM_REST} />
    <main id="main" data-creator-program>
      <section data-section data-theme="light" className="section">
        <div className="audience-shell pt-28 pb-14 lg:pt-36 lg:pb-20">
          <h1 className="audience-title max-w-3xl whitespace-pre-line">{t.title}</h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed opacity-65">{t.body}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={CREATOR_APPLY_PATH} data-creator-apply-cta className="audience-button">{t.cta} →</a>
            <a href={CREATOR_WORKSPACE_PATH} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.workspaceLink}</a>
          </div>
          <p data-service-definition className="mt-12 max-w-2xl border-t border-hairline pt-6 text-sm leading-relaxed opacity-70">{t.definition}</p>
        </div>
      </section>
      <section data-section data-theme="light" className="section border-t border-hairline">
        <div className="audience-shell grid gap-10 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:py-20">
          <h2 className="audience-heading">{t.whoHeading}</h2>
          <ul className="space-y-4 text-base leading-relaxed">{[t.who1, t.who2, t.who3].map((line) => <li key={line} className="border-t border-hairline pt-4">{line}</li>)}</ul>
        </div>
      </section>
      <section data-section data-theme="light" data-creator-steps className="section border-t border-hairline">
        <div className="audience-shell py-16 lg:py-20">
          <h2 className="audience-heading max-w-2xl">{t.stepsHeading}</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{steps.map(([title, body], index) => <li key={title} className="border-t border-hairline pt-5"><span className="text-xs opacity-40">0{index + 1}</span><h3 className="mt-4 text-xl font-semibold tracking-tight">{title}</h3><p className="mt-3 text-sm leading-relaxed opacity-65">{body}</p></li>)}</ol>
        </div>
      </section>
      <section data-section data-theme="light" className="section border-t border-hairline">
        <div className="audience-shell grid gap-12 py-16 lg:grid-cols-3 lg:py-20">
          {facts.map(([heading, body, key]) => <div key={key} data-creator-fact={key}><h2 className="text-xl font-semibold tracking-tight">{heading}</h2><p className="mt-4 text-sm leading-relaxed opacity-70">{body}</p></div>)}
        </div>
      </section>
      <aside className="audience-shell my-16 grid gap-6 border-t border-hairline pt-8 sm:grid-cols-[1fr_auto] sm:items-center">
        <p className="max-w-xl text-sm opacity-65">{t.distinction}</p>
        <a href={CREATOR_APPLY_PATH} className="audience-button">{t.cta} →</a>
      </aside>
    </main>
    <MarketingFooter locale={locale} dict={dict} />
  </>;
}
