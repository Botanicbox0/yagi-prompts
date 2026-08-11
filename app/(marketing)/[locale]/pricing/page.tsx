import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPublicCatalog } from '@/lib/content/public-catalog';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { countsLine, planCopy, planFeatures } from '@/components/landing/sections';
import { PlanCards } from '@/components/pricing/plan-cards';
import { PlanTable } from '@/components/pricing/plan-table';
import { Faq } from '@/components/landing/faq';
import { Reveal } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { formatCount } from '@/lib/i18n/format';

/**
 * Pricing — PLAN §3.4 (Free vs Pro) with the §3.1 "N prompts across M playbooks" line computed
 * from the same cached catalog projection the landing uses. Static, like landing.
 *
 * No ad rail here: §3.6 lists the rail on landing, `/library` and playbook detail only.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return {
    title: dict.meta.pricingTitle,
    description: dict.meta.pricingDescription,
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { en: '/en/pricing', ko: '/ko/pricing', 'x-default': '/en/pricing' },
    },
    openGraph: {
      type: 'website',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}/pricing`,
      title: `${dict.meta.pricingTitle} — ${dict.meta.siteName}`,
      description: dict.meta.pricingDescription,
    },
  };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  const catalog = await getPublicCatalog();
  const features = planFeatures(dict);

  const rows = [
    { label: dict.pricing.featureStructure, free: true, pro: true },
    { label: dict.pricing.featureAssets, free: true, pro: true },
    { label: dict.pricing.featureBilingual, free: true, pro: true },
    { label: dict.pricing.featurePrompts, free: false, pro: true },
    { label: dict.pricing.featureParams, free: false, pro: true },
    { label: dict.pricing.featureCopy, free: false, pro: true },
    { label: dict.pricing.featureWorkflow, free: false, pro: true },
    { label: dict.pricing.featureNotifications, free: false, pro: true },
  ];

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/pricing" initialTheme="light" />

      <main id="main">
        <section data-section data-theme="light" className="section">
          <div className="band pt-30 pb-20 lg:pt-40 lg:pb-24">
            <p className="text-accent font-label text-eyebrow uppercase">{dict.pricing.eyebrow}</p>

            <Reveal
              immediate
              delay={0.05}
              as="h1"
              lines={[dict.pricing.line1, dict.pricing.line2]}
              className="mt-7 font-display text-title font-black uppercase"
            />

            <p className="mt-8 max-w-detail text-body opacity-70">{dict.pricing.lede}</p>
            {/* The accent carries its own alpha: nesting it inside `opacity-60` multiplies the
                two and drops #0000EE on white to 4.38:1, just under AA. */}
            <p className="mt-3 font-mono text-code">
              <span className="opacity-60">{countsLine(dict, locale, catalog.totals)}</span>
              {catalog.totals.proBlocks > 0 && (
                <>
                  <span aria-hidden className="px-2 opacity-40">
                    ·
                  </span>
                  <span className="text-accent">
                    {formatCount(catalog.totals.proBlocks, locale)} {dict.pricing.proBlocksLocked}
                  </span>
                </>
              )}
            </p>

            <div className="mt-12">
              <PlanCards
                locale={locale}
                copy={planCopy(dict)}
                freeFeatures={features.free}
                proFeatures={features.pro}
              />
            </div>
          </div>
        </section>

        <section data-section data-theme="dark" className="section">
          <div className="band py-24 lg:py-28">
            <h2 className="font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">
              {dict.pricing.featureHeading}
            </h2>
            <div className="mt-12">
              <PlanTable
                heading={dict.pricing.featureHeading}
                columnFeature={dict.pricing.columnFeature}
                freeLabel={dict.plan.free}
                proLabel={dict.plan.pro}
                includedLabel={dict.pricing.included}
                notIncludedLabel={dict.pricing.notIncluded}
                rows={rows}
              />
            </div>
            <a
              href={`/auth/signin?next=%2Flibrary&locale=${locale}`}
              className="mt-12 inline-block border border-current px-6 py-3 font-label text-label uppercase"
            >
              <TextSwap>{dict.auth.startWithGoogle} →</TextSwap>
            </a>
          </div>
        </section>

        <section data-section data-theme="light" className="section">
          <Faq
            eyebrow={dict.faq.eyebrow}
            title={dict.faq.title}
            items={[
              { q: dict.faq.q2, a: dict.faq.a2 },
              { q: dict.faq.q3, a: dict.faq.a3 },
              { q: dict.faq.q1, a: dict.faq.a1 },
              { q: dict.faq.q5, a: dict.faq.a5 },
            ]}
          />
        </section>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
