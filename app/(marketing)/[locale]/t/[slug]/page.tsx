import { cache } from 'react';
import { TemplateRatings } from '@/components/community/ratings';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import type { PromptCard } from '@/lib/prompts/catalog';
import { USE_CASES } from '@/lib/prompts/schemas';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { campaignHref } from '@/lib/campaigns/links';
import { isCampaignPublic } from '@/lib/campaigns/state';
import { formatTemplatePrice, isForSale } from '@/lib/twings/products';
import { aspectsForMedium, defaultAspect, engineLabel, resolveEngine } from '@/lib/images/engines';
import { signInHref } from '@/lib/billing/links';
import { identityVerifyHref } from '@/lib/identity/links';
import { templateMetadata, unresolvedTemplateMetadata } from '@/lib/seo/template-metadata';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
import { storefrontOpen } from '@/lib/auth/purchase-gate';
import { FaqSection } from '@/lib/seo/faq-section';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';
import { templateStructuredData } from '@/lib/seo/structured-data';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptDetailMedia } from '@/components/prompts/detail-media';
import { TypographicPoster, posterRatio } from '@/components/prompts/poster';
import { RelatedPrompts } from '@/components/prompts/detail';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { campaignLabels } from '@/components/campaigns/labels';
import { TwingsStudio, type StudioStyle } from '@/components/twings/studio';
import { formatResolutionPrice, offeredResolutions } from '@/lib/twings/resolution';
import { templateSubscriptionQuote } from '@/lib/twings/subscription-plan';
import { cachedSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { SubscriptionAvailabilityProvider } from '@/components/twings/subscription-availability';
import { TemplateMakeAvailability, TemplateSubscriptionNote } from '@/components/twings/subscription-public-notices';

/**
 * `/[locale]/t/[slug]` — one template, which is also where it is made (docs/TEMPLATES-IA.md §2).
 *
 * Static + tag `prompts` + the 1h TTL floor. This page CAN be static because nothing on it is
 * gated any more: the prompt text is the studio's private recipe and never rendered, so the HTML
 * is the same for a visitor, a member and the admin. The making itself is a client component
 * whose payment step is a per-viewer request, not per-viewer HTML.
 *
 * 404 for anything not published, for everyone — the catalogue projection is the filter.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string; slug: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** One resolution per request, shared by `generateMetadata` and the render. */
const resolve = cache(async (slug: string): Promise<{ card: PromptCard | null; all: PromptCard[] }> => {
  const catalog = await getPromptCatalog();
  const all = [...catalog.video, ...catalog.image];
  return { card: all.find((item) => item.slug === slug) ?? null, all };
});

/** Up to four neighbours: same medium first, sharing a use case first, newest first (repo order). */
function related(card: PromptCard, all: PromptCard[]): PromptCard[] {
  const others = all.filter((item) => item.slug !== card.slug && item.medium === card.medium);
  const shares = (item: PromptCard) => item.useCase.some((value) => card.useCase.includes(value));
  return [...others.filter(shares), ...others.filter((item) => !shares(item))].slice(0, 4);
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const { card } = await resolve(slug);
  if (card === null) return unresolvedTemplateMetadata(dict.meta.siteName);
  return templateMetadata({ card, locale, description: dict.meta.templateDescription, siteName: dict.meta.siteName });
}

export default async function TemplatePage({ params }: RouteParams) {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const [{ card, all }, availability, campaignCatalog] = await Promise.all([resolve(slug), cachedSubscriptionAvailability(), getCampaignCatalog()]);
  if (card === null) notFound();

  const t = dict.templates;
  const labels = promptLabels(dict);
  const ads = adLabels(dict, locale);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  const subscriptionQuote = isForSale(card) ? templateSubscriptionQuote(card) : null;
  const makeAvailabilityCopy = { makeCta: t.makeCta, makeCtaClosed: t.makeCtaClosed, makeBody: t.makeBody, makeBodyClosed: t.makeBodyClosed, makeBodySubscription: t.makeBodySubscription, makeBodySubscriptionPaused: t.makeBodySubscriptionPaused };
  const ratio = card.poster?.w && card.poster.h ? `${card.poster.w} / ${card.poster.h}` : posterRatio(card.slug);
  const credit = card.source === 'yagi' ? labels.byYagi : card.authorHandle ? labels.byAuthor.replace('{handle}', card.authorHandle) : labels.byAnonymous;

  // The campaigns that ask for THIS template — the earn loop, one click from the make loop.
  const campaigns = campaignCatalog.campaigns.filter((c) => c.styleSlug === card.slug && isCampaignPublic(c.status));
  const cLabels = campaignLabels(dict);

  const style: StudioStyle | null = isForSale(card)
    ? {
        id: card.slug,
        title,
        price: formatTemplatePrice(card, locale),
        runtime: String(card.runtimeSeconds ?? 0),
        blurb: card.useCase.map((value) => useCaseLabels[value] ?? value).join(' · '),
        posterSrc: card.poster?.src ?? null,
        videoSrc: card.video?.src ?? null,
        moreHref: templatesHref(locale, card.medium),
        aspects: aspectsForMedium(card.medium).map((id) => ({ id, label: t.aspects[id as keyof typeof t.aspects] ?? id })),
        defaultAspect: card.aspectDefault ?? defaultAspect(card.medium),
        resolutions: offeredResolutions(card).map((id) => ({ id, price: formatResolutionPrice(card, id, locale) })),
      }
    : null;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/t/${slug}`} initialTheme="light" />
      <JsonLd id="template-structured-data" data={templateStructuredData({ origin: siteUrl(), locale, card, description: dict.meta.templateDescription, publicSalesEnabled: RENDER_PIPELINE_PUBLIC })} />

      <SubscriptionAvailabilityProvider initialAvailability={availability}>
      <main id="main" data-template={card.slug} data-medium={card.medium} data-section data-theme="light" className="section pb-24">
        <div id="template-rail-anchor" className="relative">
          <AdRail anchorId="template-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band pt-28 lg:pt-32">
            <a href={templatesHref(locale, card.medium)} className="font-mono text-[0.72rem] opacity-60">
              ← {interpolate(t.backTo, { medium: dict.nav[card.medium] })}
            </a>

            <header className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
              <div>
                <PromptDetailMedia
                  poster={card.poster}
                  video={card.video}
                  alt={labels.resultLabel}
                  ratio={ratio}
                  fallback={<TypographicPoster title={card.title} slug={card.slug} kicker={card.modelLabels.join(' · ')} ratio={ratio} />}
                />
              </div>
              <div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-label text-eyebrow uppercase">
                  <span data-medium-chip className="text-accent">{dict.nav[card.medium]}</span>
                  {/* The engine this template renders on — not the models the recipe was tried on. */}
                  <span data-engine-chip className="opacity-60">{engineLabel(resolveEngine(card.engine, card.medium))}</span>
                </p>
                <h1 className="mt-5 font-display text-[clamp(2.2rem,5vw,4rem)] leading-[0.92] font-black uppercase">{title}</h1>
                <p data-template-description className="mt-5 max-w-detail text-body opacity-70">{dict.meta.templateDescription}</p>
                <p className="mt-4 font-label text-[0.7rem] tracking-[0.12em] uppercase opacity-60">{credit}</p>
                {card.useCase.length > 0 && (
                  <p className="mt-4 flex flex-wrap gap-1.5 font-mono text-[0.75rem] opacity-60">
                    {card.useCase.map((value) => (
                      <span key={value}>{useCaseLabels[value] ?? value}</span>
                    ))}
                  </p>
                )}

                <dl data-template-facts className="mt-8 grid grid-cols-2 gap-px border border-hairline bg-hairline">
                  <div className="bg-surface px-5 py-5">
                    <dt className="font-label text-eyebrow uppercase opacity-60">{t.priceLabel}</dt>
                    <dd className="mt-2 font-display text-[1.6rem] leading-none font-black">
                      {isForSale(card) ? formatTemplatePrice(card, locale) : t.notForSale}
                    </dd>
                  </div>
                  <div className="bg-surface px-5 py-5">
                    <dt className="font-label text-eyebrow uppercase opacity-60">
                      {card.medium === 'video' ? t.runtimeLabel : t.mediumLabel}
                    </dt>
                    <dd className="mt-2 font-display text-[1.6rem] leading-none font-black">
                      {card.medium === 'video' && card.runtimeSeconds
                        ? interpolate(dict.studio.runtimeLabel, { seconds: String(card.runtimeSeconds) })
                        : dict.nav[card.medium]}
                    </dd>
                  </div>
                </dl>

                {subscriptionQuote && <TemplateSubscriptionNote copy={{ subscriptionTemplateNote: dict.pricing.subscriptionTemplateNote, subscriptionTemplateOpenNote: dict.pricing.subscriptionTemplateOpenNote, subscriptionTemplateCreatorNote: dict.pricing.subscriptionTemplateCreatorNote, subscriptionTemplatePausedNote: dict.pricing.subscriptionTemplatePausedNote, subscriptionDetailLink: dict.pricing.subscriptionDetailLink }} count={subscriptionQuote.maxPerMonth} premiumCount={templateSubscriptionQuote(card, 'premium')!.maxPerMonth} locale={locale} />}

                {style === null ? (
                  <p data-template-closed className="mt-6 max-w-detail text-body opacity-70">{t.notForSaleBody}</p>
                ) : (
                  <a href="#make" data-template-make-cta className="mt-6 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
                    <TextSwap><TemplateMakeAvailability copy={makeAvailabilityCopy} oneTimeAvailable={storefrontOpen()} subscriptionEligible={subscriptionQuote !== null} field="cta" /> →</TextSwap>
                  </a>
                )}
              </div>
            </header>

            {/* The make loop, on the template's own page. */}
            <section id="make" data-template-make className="mt-16 border-t border-hairline pt-10">
              <p className="text-accent font-label text-eyebrow uppercase">{t.makeEyebrow}</p>
              <h2 className="mt-4 font-display text-[clamp(1.6rem,3vw,2.4rem)] leading-[0.95] font-black uppercase">{t.makeHeading}</h2>
              <p className="mt-4 max-w-detail text-body opacity-70"><TemplateMakeAvailability copy={makeAvailabilityCopy} oneTimeAvailable={storefrontOpen()} subscriptionEligible={subscriptionQuote !== null} field="body" /></p>
              {style === null ? (
                <p data-template-closed className="mt-8 border border-hairline p-6 text-body opacity-70">{t.notForSaleBody}</p>
              ) : (
                <TwingsStudio
                  styles={[style]}
                  initialStyleId={style.id}
                  live={{
                    endpoint: '/api/renders',
                    accessEndpoint: '/api/renders/access',
                    interestEndpoint: '/api/notify/interest',
                    template: card.slug,
                    locale,
                    signinHref: signInHref(`${templateHref(locale, slug)}#make`, locale),
                    identityHref: identityVerifyHref(`${templateHref(locale, slug)}#make`),
                    portrait: { manage: dict.portrait.manage, change: dict.portrait.change, useSaved: dict.portrait.useSaved },
                    photoGuide: dict.portrait,
                    subscription: { copy: dict.creatorSubscription, editorCopy: dict.premiumEditor },
                    labels: {
                      badge: dict.renders.studio.badge,
                      operatorBadge: dict.renders.studio.operatorBadge,
                      freeCta: dict.renders.studio.freeCta,
                      submitting: dict.renders.studio.submitting,
                      identityNotice: dict.renders.studio.identityNotice,
                      identityPending: dict.renders.studio.identityPending,
                      identityCta: dict.renders.studio.identityCta,
                      errors: dict.renders.studio.errors,
                    },
                  }}
                  labels={{
                    stepPhoto: dict.studio.stepPhoto,
                    stepStyle: dict.studio.stepStyle,
                    stepPay: dict.studio.stepPay,
                    stepResult: dict.studio.stepResult,
                    dropZone: dict.studio.dropZone,
                    dropHint: dict.studio.dropHint,
                    changePhoto: dict.studio.changePhoto,
                    chooseStyle: dict.studio.chooseStyle,
                    payCta: dict.studio.payCta,
                    payNote: dict.studio.payNote,
                    closedBadge: dict.studio.closedBadge,
                    closedTitle: dict.studio.closedTitle,
                    closedBody: dict.studio.closedBody,
                    closedCta: dict.studio.closedCta,
                    closedDone: dict.studio.closedDone,
                    signedOutBadge: dict.studio.signedOutBadge,
                    signedOutTitle: dict.studio.signedOutTitle,
                    signedOutBody: dict.studio.signedOutBody,
                    signedOutCta: dict.studio.signedOutCta,
                    aiNote: dict.studio.aiNote,
                    runtimeLabel: dict.studio.runtimeLabel,
                    needPhoto: dict.studio.needPhoto,
                    noStyles: dict.studio.noStyles,
                    moreTemplates: dict.studio.moreTemplates,
                    aspectLabel: dict.studio.aspectLabel,
                    resolutionLabel: dict.studio.resolutionLabel,
                    resolutionDefault: dict.studio.resolutionDefault,
                    resolutionNote: dict.studio.resolutionNote,
                  }}
                />
              )}
            </section>

            {/* The earn loop: campaigns that ask for exactly this template. */}
            {campaigns.length > 0 && (
              <section data-template-campaigns className="mt-16 border-t border-hairline pt-10">
                <p className="text-accent font-label text-eyebrow uppercase">{dict.campaigns.eyebrow}</p>
                <h2 className="mt-4 font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{t.campaignsHeading}</h2>
                <ul className="mt-6 flex flex-col divide-y divide-hairline border-y border-hairline">
                  {campaigns.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div>
                        <a href={campaignHref(locale, c.slug)} className="font-display text-[1.2rem] leading-none font-black uppercase">
                          {localize(c.title, locale).replace(/\s+/g, ' ')}
                        </a>
                        <p className="mt-1.5 font-mono text-[0.75rem] opacity-60">
                          {c.hostName} · {cLabels.status[c.status]}
                        </p>
                      </div>
                      <a href={campaignHref(locale, c.slug)} className="inline-block border border-current px-4 py-2 font-label text-eyebrow uppercase">
                        <TextSwap>{dict.campaigns.applyCta} →</TextSwap>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {await TemplateRatings({templateId:card.id,copy:dict.community})}
            <RelatedPrompts
              cards={related(card, all)}
              locale={locale}
              labels={{ ...labels, relatedHeading: t.relatedHeading }}
              useCaseLabels={useCaseLabels}
              signinHref={signInHref(templateHref(locale, slug), locale)}
            />

            <div className="mt-16 rail:hidden">
              <AdBanner labels={ads} />
            </div>
          </div>
        </div>
      </main>
      <FaqSection dict={dict} locale={locale} placement="template" path={`/${locale}/t/${slug}`} availability={availability} />
      </SubscriptionAvailabilityProvider>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
