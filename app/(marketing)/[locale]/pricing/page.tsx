import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { promptsHref } from '@/lib/prompts/links';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from '@/lib/seo/og';
import { isCookiePackPurchasable } from '@/lib/cookies/purchase';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { countsLine } from '@/components/landing/sections';
import { CookieTable } from '@/components/pricing/cookie-table';
import { PlanTable } from '@/components/pricing/plan-table';
import { Faq } from '@/components/landing/faq';
import { Reveal } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { formatCount } from '@/lib/i18n/format';

/**
 * Pricing — PLAN §15.3: the cookie model (가입 3 · 주 1 · $4/5), with the §3.1 counts line from
 * the same cached prompt projection the landing reads. Static, like landing — nothing here may
 * know the viewer, which is exactly why the page can present the model but never a balance.
 *
 * The $9 plan cards are gone from this surface: the subscription is de-emphasized, not sold
 * (§15). The `pro` tier survives only in access logic, where it keeps old entitlements honest.
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
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  // §13.2 — the pricing page counts PROMPTS now, from the tagged prompt projection.
  const catalog = await getPromptCatalog();
  const lockedYagi = catalog.yagi.filter((card) => card.hasLock).length;

  // §15.3 — the three ways cookies arrive. Figures in display type; sentences do the explaining.
  // F5: while no MoR gateway is connected (`isCookiePackPurchasable`, env-derived and
  // static-safe — no session), the pack cell wears its status instead of implying a checkout
  // that does not exist yet.
  const cells = [
    {
      title: dict.pricing.cookieSignupTitle,
      value: dict.pricing.cookieSignupValue,
      note: dict.pricing.cookieSignupNote,
    },
    {
      title: dict.pricing.cookieWeeklyTitle,
      value: dict.pricing.cookieWeeklyValue,
      note: dict.pricing.cookieWeeklyNote,
    },
    {
      title: dict.pricing.cookiePackTitle,
      value: dict.pricing.cookiePackValue,
      note: dict.pricing.cookiePackNote,
      ...(isCookiePackPurchasable() ? {} : { chip: dict.pricing.cookiePackStatus }),
    },
  ];

  // What is free stays the whole §13 doctrine; what a cookie opens is one row of it.
  const rows = [
    { label: dict.pricing.featureStructure, free: true, pro: true },
    { label: dict.pricing.featureAssets, free: true, pro: true },
    { label: dict.pricing.featureBilingual, free: true, pro: true },
    { label: dict.pricing.featurePrompts, free: false, pro: true },
    { label: dict.pricing.featureCopy, free: false, pro: true },
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
              {lockedYagi > 0 && (
                <>
                  <span aria-hidden className="px-2 opacity-40">
                    ·
                  </span>
                  <span className="text-accent">
                    {formatCount(lockedYagi, locale)} {dict.pricing.proBlocksLocked}
                  </span>
                </>
              )}
            </p>

            <div className="mt-12">
              <CookieTable cells={cells} rule={dict.pricing.cookieRule} />
            </div>
            <p className="mt-6 font-mono text-code opacity-60">{dict.pricing.cancelNote}</p>
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
                proLabel={dict.pricing.cookieColumn}
                includedLabel={dict.pricing.included}
                notIncludedLabel={dict.pricing.notIncluded}
                rows={rows}
              />
            </div>
            <a
              href={promptsHref(locale)}
              className="mt-12 inline-block border border-current px-6 py-3 font-label text-label uppercase"
            >
              <TextSwap>{dict.nav.prompts} →</TextSwap>
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
