import { cache } from 'react';
import { TemplateRatings } from '@/components/community/ratings';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import type { PromptCard, PublicMaker } from '@/lib/prompts/catalog';
import { USE_CASES } from '@/lib/prompts/schemas';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { campaignHref } from '@/lib/campaigns/links';
import { isCampaignPublic } from '@/lib/campaigns/state';
import { formatTemplatePrice, isForSale } from '@/lib/twings/products';
import { aspectsForMedium, defaultAspect, resolveEngine } from '@/lib/images/engines';
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
import { makerProfileRest } from '@/components/prompts/card-frame';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { campaignLabels } from '@/components/campaigns/labels';
import { TwingsStudio, type StudioStyle } from '@/components/twings/studio';
import { formatResolutionPrice, offeredResolutions } from '@/lib/twings/resolution';
import { templateSubscriptionQuote } from '@/lib/twings/subscription-plan';
import { cachedSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { SubscriptionAvailabilityProvider } from '@/components/twings/subscription-availability';
import { TemplateMakeAvailability, TemplateSubscriptionNote } from '@/components/twings/subscription-public-notices';
import { cachedTypicalWaitMinutes } from '@/lib/twings/cached-typical-wait';
import { cachedPublicRecipe } from '@/lib/recipes/cached-public';
import { HowItWasMade } from '@/components/recipes/how-it-was-made';

/**
 * `/[locale]/t/[slug]` — one template, which is also where it is made (docs/TEMPLATES-IA.md §2).
 *
 * Static + tag `prompts` + the 1h TTL floor. This page CAN be static because nothing on it is
 * gated any more: the prompt text is the studio's private recipe and never rendered, so the HTML
 * is the same for a visitor, a member and the admin. The making itself is a client component
 * whose payment step is a per-viewer request, not per-viewer HTML.
 *
 * 404 for anything not published, for everyone — the catalogue projection is the filter.
 *
 * It is the DECISION screen (docs/PLATFORM-2.0.md §15.3-1): the example first, then one make card —
 * price, length · aspect · resolution · "보통 N분", whether it can be bought now (`storefrontOpen()`,
 * the same value the home hero and pricing read), the studio with its one CTA, then the AI limit and
 * the refund sentence. No second heading, no link button to the card, no engine name. On a phone a
 * sticky bar keeps price + CTA at the thumb until the card is on screen.
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
const resolve = cache(async (slug: string): Promise<{ card: PromptCard | null; all: PromptCard[]; makers: PublicMaker[] }> => {
  const catalog = await getPromptCatalog();
  const all = [...catalog.video, ...catalog.image];
  return { card: all.find((item) => item.slug === slug) ?? null, all, makers: catalog.makers ?? [] };
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
  const [{ card, all, makers }, availability, campaignCatalog] = await Promise.all([resolve(slug), cachedSubscriptionAvailability(), getCampaignCatalog()]);
  if (card === null) notFound();
  // Built with the page and refreshed with it (tag `prompts`): the median of recent successful renders
  // for this engine and length, or the engine default below ten (lib/twings/typical-wait.ts).
  const waitMinutes = await cachedTypicalWaitMinutes({ engine: resolveEngine(card.engine, card.medium), medium: card.medium, seconds: card.medium === 'video' ? card.runtimeSeconds ?? null : null });
  // A maker template only (docs/PLATFORM-2.0.md §7.3): what the maker chose to show, in the order they chose.
  const mr = dict.makerRecipe;
  const recipe = await cachedPublicRecipe(card.id, { selfie: mr.selfieLabel, reference: mr.referenceLabel, step: mr.stepResultLabel });
  const howItWasMade = recipe ? <HowItWasMade recipe={recipe} copy={mr} /> : null;

  const t = dict.templates;
  const labels = promptLabels(dict);
  const ads = adLabels(dict, locale);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  const subscriptionQuote = isForSale(card) ? templateSubscriptionQuote(card) : null;
  const makeAvailabilityCopy = { makeCta: t.makeCta, makeCtaClosed: t.makeCtaClosed, makeBody: t.makeBody, makeBodyClosed: t.makeBodyClosed, makeBodySubscription: t.makeBodySubscription, makeBodySubscriptionPaused: t.makeBodySubscriptionPaused };
  const ratio = card.poster?.w && card.poster.h ? `${card.poster.w} / ${card.poster.h}` : posterRatio(card.slug);
  // §7.5·§14.1: origin decides the credit (a maker's template is a `source='yagi'` row too).
  const credit = card.origin !== 'maker' ? labels.byYagi : card.authorHandle ? labels.byAuthor.replace('{handle}', card.authorHandle) : labels.byAnonymous;
  const makerRest = makerProfileRest(card);
  const maker = makerRest ? makers.find((item) => item.handle === card.authorHandle) ?? null : null;
  const shopOpen = storefrontOpen();
  const resolutions = isForSale(card) ? offeredResolutions(card) : [];
  const facts: Array<[string, string]> = [
    card.medium === 'video' && card.runtimeSeconds
      ? [t.runtimeLabel, interpolate(dict.studio.runtimeLabel, { seconds: String(card.runtimeSeconds) })]
      : [t.mediumLabel, dict.nav[card.medium]],
    [t.aspectFact, card.aspectDefault ?? defaultAspect(card.medium)],
    ...(resolutions.length > 0 ? [[t.resolutionFact, resolutions[0]!] as [string, string]] : []),
    [t.waitLabel, interpolate(t.waitValue, { minutes: String(waitMinutes) })],
  ];

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
            <a href={templatesHref(locale, card.medium)} className="inline-flex min-h-11 items-center text-sm text-black/65">
              ← {interpolate(t.backTo, { medium: dict.nav[card.medium] })}
            </a>
            {recipe?.presentation === 'story-first' ? howItWasMade : null}

            <header className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-10">
              <div>
                <PromptDetailMedia
                  poster={card.poster}
                  video={card.video}
                  alt={labels.resultLabel}
                  ratio={ratio}
                  fallback={<TypographicPoster title={card.title} slug={card.slug} kicker={dict.nav[card.medium]} ratio={ratio} />}
                />
              </div>
              <div>
                <p className="font-label text-eyebrow uppercase">
                  <span data-medium-chip className="text-accent">{dict.nav[card.medium]}</span>
                </p>
                <h1 className="mt-4 font-display text-[clamp(2rem,5vw,4rem)] leading-[0.92] font-black uppercase">{title}</h1>
                <p className="mt-4 flex flex-wrap gap-x-1 gap-y-1 text-sm text-black/65">
                  {makerRest ? <a data-template-credit href={`/${locale}${makerRest}`} className="underline underline-offset-4">{credit}</a> : <span data-template-credit>{credit}</span>}
                  {/* Every public template passed studio review, studio and maker alike (§7.5). */}
                  <span data-template-verified title={t.verifiedHint}>· {t.verified}</span>
                  {card.useCase.map((value) => (
                    <span key={value}>· {useCaseLabels[value] ?? value}</span>
                  ))}
                </p>

                {style === null ? (
                  <section data-template-closed className="mt-7 rounded-2xl border border-hairline p-5 sm:p-6">
                    <p className="font-display text-[1.6rem] leading-none font-black">{t.notForSale}</p>
                    <dl data-template-facts className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline pt-4">
                      {facts.filter(([label]) => label !== t.waitLabel).map(([label, value]) => (
                        <div key={label}><dt className="text-xs text-black/65">{label}</dt><dd className="mt-1 text-[0.95rem] font-semibold">{value}</dd></div>
                      ))}
                    </dl>
                    <p className="mt-4 text-sm leading-relaxed text-black/75">{t.notForSaleBody}</p>
                  </section>
                ) : (
                  // The one make card: price box, the studio, then the small print — nothing above it repeats it.
                  <section id="make" data-template-make data-template-price-box className="mt-7 scroll-mt-24 rounded-2xl border border-hairline p-5 sm:p-6">
                    <div className="flex items-baseline justify-between gap-4">
                      <p data-template-price className="font-display text-[2rem] leading-none font-black">{style.price}</p>
                      <p className="text-sm text-black/70">{t.priceLabel}</p>
                    </div>
                    <dl data-template-facts className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-hairline py-4 sm:grid-cols-4">
                      {facts.map(([label, value]) => (
                        <div key={label} data-template-fact>
                          <dt className="text-xs text-black/65">{label}</dt>
                          <dd className="mt-1 text-[0.95rem] font-semibold">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p data-template-sale-state className="mt-4 text-sm leading-relaxed text-black/75">
                      <TemplateMakeAvailability copy={makeAvailabilityCopy} oneTimeAvailable={shopOpen} subscriptionEligible={subscriptionQuote !== null} field="body" />
                    </p>
                    <TwingsStudio
                      styles={[style]}
                      initialStyleId={style.id}
                      shopOpenHint={shopOpen}
                      live={{
                        endpoint: '/api/renders',
                        accessEndpoint: '/api/renders/access',
                        interestEndpoint: '/api/notify/interest',
                        template: card.slug,
                        locale,
                        signinHref: signInHref(`${templateHref(locale, slug)}#make`, locale),
                        identityHref: identityVerifyHref(`${templateHref(locale, slug)}#make`),
                        selfie: dict.selfie,
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
                        closedTitle: dict.studio.closedTitle,
                        closedBody: dict.studio.closedBody,
                        closedCta: dict.studio.closedCta,
                        closedDone: dict.studio.closedDone,
                        signedOutBody: dict.studio.signedOutBody,
                        signedOutCta: dict.studio.signedOutCta,
                        photoExamples: dict.studio.photoExamples,
                        pending: dict.studio.pending,
                        makeCta: t.makeCta,
                        makeCtaClosed: t.makeCtaClosed,
                        otherAspect: dict.studio.otherAspect,
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
                    <div data-template-trust className="mt-5 space-y-1.5 border-t border-hairline pt-4 text-sm leading-relaxed text-black/70">
                      {/* Founder, 2026-09-11: what AI-made means is said before the money, not after the complaint. */}
                      <p data-studio-ai-note>{t.aiLimit}</p>
                      <p data-template-refund>{dict.renders.notCharged}</p>
                    </div>
                  </section>
                )}

                {subscriptionQuote && <TemplateSubscriptionNote copy={{ subscriptionTemplateNote: dict.pricing.subscriptionTemplateNote, subscriptionTemplateOpenNote: dict.pricing.subscriptionTemplateOpenNote, subscriptionTemplateCreatorNote: dict.pricing.subscriptionTemplateCreatorNote, subscriptionTemplatePausedNote: dict.pricing.subscriptionTemplatePausedNote, subscriptionDetailLink: dict.pricing.subscriptionDetailLink }} count={subscriptionQuote.maxPerMonth} premiumCount={templateSubscriptionQuote(card, 'premium')!.maxPerMonth} locale={locale} />}

                {/* The definition, under the first screen (AGENTS.md §7 GEO): in the HTML, not in the way. */}
                <p data-template-description className="mt-6 max-w-detail text-sm leading-relaxed text-black/65">{dict.meta.templateDescription}</p>

                {/* §7.5: the maker block — only for a maker who made their profile public. */}
                {makerRest && card.authorHandle && (
                  <aside data-template-maker={card.authorHandle} className="mt-8 rounded-2xl border border-hairline p-5">
                    <p className="text-xs text-black/60">{t.makerBlockHeading}</p>
                    <p className="mt-2 text-base font-semibold break-all">@{card.authorHandle}</p>
                    {maker?.bio && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line break-words text-black/70">{maker.bio}</p>}
                    <a href={`/${locale}${makerRest}`} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t.makerBlockCta} →</a>
                  </aside>
                )}
              </div>
            </header>
            {recipe?.presentation === 'make-first' ? howItWasMade : null}

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
      {/* Room for the phone's sticky make bar, so it never sits on the footer's last line. */}
      {style !== null && <div aria-hidden="true" className="h-24 md:hidden" />}
    </>
  );
}
