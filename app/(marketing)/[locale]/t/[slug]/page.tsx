import { cache } from 'react';
import { TemplateRatings } from '@/components/community/ratings';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import { cachedPromptCardsBySlugs } from '@/lib/prompts/cached-by-slugs';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import type { PromptCard, PublicMaker } from '@/lib/prompts/catalog';
import { USE_CASES } from '@/lib/prompts/schemas';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { campaignHref } from '@/lib/campaigns/links';
import { isCampaignPublic } from '@/lib/campaigns/state';
import { formatTemplatePrice, isForSale } from '@/lib/twings/products';
import { aspectsForMedium, defaultAspect, estimateImageUsd, isImageEngine, resolveEngine } from '@/lib/images/engines';
import { templateImageSetInfo } from '@/lib/twings/selective-frames';
import { signInHref } from '@/lib/billing/links';
import { identityVerifyHref } from '@/lib/identity/links';
import { templateMetadata, unresolvedTemplateMetadata } from '@/lib/seo/template-metadata';
import { storefrontOpen } from '@/lib/auth/purchase-gate';
import { personalEditSheetOpen, templateLookOpen } from '@/lib/flags';
import { FaqSection } from '@/lib/seo/faq-section';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';
import { templateStructuredData } from '@/lib/seo/structured-data';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptDetailMedia } from '@/components/prompts/detail-media';
import { TemplateGallery, TransformStrip } from '@/components/prompts/template-gallery';
import { TypographicPoster, posterRatio } from '@/components/prompts/poster';
import { RelatedPrompts } from '@/components/prompts/detail';
import { makerProfileRest } from '@/components/prompts/card-frame';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { campaignLabels } from '@/components/campaigns/labels';
import { TwingsStudio, type StudioStyle } from '@/components/twings/studio';
import { TemplateLookIsland } from '@/components/template-look/look-island';
import { LookMismatch } from '@/components/template-look/look-mismatch';
import { engineOrdersOpen, formatResolutionPrice, offeredResolutions } from '@/lib/twings/resolution';
import { templateSubscriptionQuote } from '@/lib/twings/subscription-plan';
import { cachedSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { SubscriptionAvailabilityProvider } from '@/components/twings/subscription-availability';
import { TemplateMakeAvailability } from '@/components/twings/subscription-public-notices';
import { cachedTypicalWaitMinutes } from '@/lib/twings/cached-typical-wait';
import { cachedPublicRecipe } from '@/lib/recipes/cached-public';
import { cachedMakeInputs } from '@/lib/renders/cached-make-inputs';
import { recipeTeaser } from '@/lib/recipes/public';
import { publicRecipeText } from '@/lib/template-director/public-text';
import { HowItWasMade } from '@/components/recipes/how-it-was-made';
import { RecipeActions } from '@/components/recipes/recipe-actions';
import { RecipeAccessProvider } from '@/components/recipes/recipe-access-context';
import { RecipeClipsSection } from '@/components/recipes/recipe-clips-section';
import { MakeLauncher } from '@/components/templates/make-launcher';
import { MakeSheet } from '@/components/templates/make-sheet';
import { templateCredits } from '@/lib/twings/credits';
import { CreativeAvatar } from '@/components/makers/identity';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { defaultTimelineKeyframes, splitKeyframes } from '@/lib/prompts/keyframes';
import { cachedPromptKeyframes } from '@/lib/prompts/keyframes-cached';
import { partRows, templatePartsView } from '@/lib/template-director/parts-view';
import { makerBlogOpen } from '@/lib/posts/flag';
import {
  cachedPrimaryBlogPostForTemplate,
  cachedTemplateOriginalInstagram,
  cachedTemplateStories,
} from '@/lib/posts/cached-public';
import { makerBlogPostHref } from '@/lib/posts/links';
import { TemplateStories } from '@/components/posts/template-stories';
import { InstagramLink } from '@/components/posts/instagram-link';

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
const resolve = cache(
  async (
    slug: string,
  ): Promise<{ card: PromptCard | null; unlisted: boolean; all: PromptCard[]; makers: PublicMaker[] }> => {
    const catalog = await getPromptCatalog();
    const all = [...catalog.video, ...catalog.image];
    const listedCard = all.find((item) => item.slug === slug) ?? null;
    if (listedCard) {
      return { card: listedCard, unlisted: false, all, makers: catalog.makers ?? [] };
    }
    const unlistedCards = await cachedPromptCardsBySlugs([slug]);
    const unlistedCard = unlistedCards[0] ?? null;
    return { card: unlistedCard, unlisted: unlistedCard !== null, all, makers: catalog.makers ?? [] };
  },
);

/** Up to four neighbours: same medium first, sharing a use case first, newest first (repo order). */
function related(card: PromptCard, all: PromptCard[]): PromptCard[] {
  const others = all.filter((item) => item.slug !== card.slug && item.medium === card.medium);
  const shares = (item: PromptCard) => item.useCase.some((value) => card.useCase.includes(value));
  return [...others.filter(shares), ...others.filter((item) => !shares(item))].slice(0, 4);
}

/** The terms say a single purchase's price is on the template page, so credits and "subscribe" wait until subscriptions open (docs/PLATFORM-2.0.md §19.2). */
function templateDescription(dict: ReturnType<typeof getDictionary>, subscriptionOpen: boolean): string {
  return subscriptionOpen ? dict.meta.templateDescription : dict.meta.templateDescriptionSingle;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const { card, unlisted } = await resolve(slug);
  if (card === null) return unresolvedTemplateMetadata(dict.meta.siteName);
  const [availability, makeInputs] = await Promise.all([cachedSubscriptionAvailability(), cachedMakeInputs(card.id, card.cast ?? 'solo')]);
  // docs/CAST-CATEGORIES.md §5: a pet-only template asks for no face, and its description says so.
  const petOnly = makeInputs !== null && makeInputs.pet && !makeInputs.selfie;
  const baseMeta = templateMetadata({ card, locale, description: petOnly ? dict.cast.pet.templateDescription : templateDescription(dict, availability.status === 'open'), siteName: dict.meta.siteName });
  return unlisted ? { ...baseMeta, robots: { index: false, follow: false } } : baseMeta;
}

export default async function TemplatePage({ params }: RouteParams) {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const [{ card, unlisted, all, makers }, availability, campaignCatalog] = await Promise.all([resolve(slug), cachedSubscriptionAvailability(), getCampaignCatalog()]);
  if (card === null) notFound();
  if (unlisted && makerBlogOpen()) {
    const primaryPost = await cachedPrimaryBlogPostForTemplate(card.slug);
    if (primaryPost) {
      redirect(`${makerBlogPostHref(locale, primaryPost.handle, primaryPost.slug)}#make-${card.slug}`);
    }
  }
  // Built with the page and refreshed with it (tag `prompts`): the median of recent successful renders
  // for this engine and length, or the engine default below ten (lib/twings/typical-wait.ts).
  const waitMinutes = await cachedTypicalWaitMinutes({ engine: resolveEngine(card.engine, card.medium), medium: card.medium, seconds: card.medium === 'video' ? card.runtimeSeconds ?? null : null });
  // A maker template only (docs/PLATFORM-2.0.md §7.3·§20.3): what the maker chose to show, in the order they chose.
  // One gate: the static HTML carries the teaser (the intro, the opening of step 1 and its BGM line); a
  // signed-in member gets the rest — every prompt, the tips, the files — from /api/renders/access.
  const mr = dict.makerRecipe;
  // docs/PERSONAL-STUDIO.md §3.3–§3.4.9: the step prompts a reader sees leave out the compiler's lock and styling blocks.
  const recipe = publicRecipeText(await cachedPublicRecipe(card.id, { selfie: mr.selfieLabel, reference: mr.referenceLabel, step: mr.stepResultLabel, pet: dict.cast.photo.petTitle, partner: dict.cast.photo.partnerTitle }));
  // docs/CAST-CATEGORIES.md §3: what the make card asks for (selfie · pet · partner). Null = a pet or
  // couple template without a matching recipe — shown, but not offered for making.
  const blogEnabled = makerBlogOpen();
  const [makeInputs, storedKeyframes, templateStories, originalInstagram] = await Promise.all([
    cachedMakeInputs(card.id, card.cast ?? 'solo'),
    card.medium === 'video' ? cachedPromptKeyframes(card.slug) : Promise.resolve(null),
    blogEnabled ? cachedTemplateStories(card.id) : Promise.resolve([]),
    blogEnabled ? cachedTemplateOriginalInstagram(card.id) : Promise.resolve(null),
  ]);
  // The column holds beats (the keyframe strip) and marks (docs/PERSONAL-STUDIO.md §3.4.4, T1a); a row without beats
  // keeps the default beats, as a row without keyframes always did.
  const { beats: storedBeats, marks } = splitKeyframes(storedKeyframes ?? []);
  const videoKeyframes = card.medium === 'video' ? (storedBeats.length ? storedBeats : defaultTimelineKeyframes(card.runtimeSeconds)) : null;
  // §3.4.4 (T1a) · §3.4.9 (S2): what the template decides — its locked parts, the hair, makeup or wardrobe it styles
  // and the parts it takes from the photo. Names come from the public lock and styling projections (never a word of a
  // block); a mark for a part the template does not declare is dropped here. No declaration, no prop.
  const declaredLocks = card.locks ?? null;
  const declaredStyling = card.styling ?? null;
  const declares = declaredLocks !== null || declaredStyling !== null;
  const partsView = declares
    ? templatePartsView({ locks: declaredLocks, styling: declaredStyling, marks: card.medium === 'video' ? marks : [], copy: dict.editSheet, locale })
    : [];
  const fixedAll = declaredLocks?.all === true;
  const fixed = card.medium === 'video' && declares && (partsView.length > 0 || fixedAll)
    ? { parts: partsView, all: fixedAll, copy: { ...dict.templates.fixed, lockedAll: dict.editSheet.lockedAll } }
    : null;
  // The same parts on the make card, one row per part, with the hair and makeup choice where the template styles them.
  const e = dict.editSheet;
  const makeParts = declares && (partsView.length > 0 || fixedAll)
    ? {
        rows: partRows(partsView),
        all: fixedAll,
        copy: {
          heading: dict.templates.fixed.heading,
          lockedAll: e.lockedAll,
          locked: dict.templates.fixed.locked,
          styled: dict.templates.fixed.styled,
          photo: dict.templates.fixed.photo,
          choiceLabel: e.styleChoiceLabel,
          template: e.styleTemplate,
          mine: e.styleMine,
          templateNote: card.medium === 'image' ? e.styleTemplateNoteImage : e.styleTemplateNote,
          mineHair: e.styleMineHair,
          mineMakeup: e.styleMineMakeup,
          overridden: e.styleOverridden,
          outfitPhoto: e.styleOutfitPhoto,
          outfitPhotoCta: e.styleOutfitPhotoCta,
          outfitAttached: e.styleOutfitAttached,
          tooLong: e.tooLong,
        },
      }
    : null;
  const petOnly = makeInputs !== null && makeInputs.pet && !makeInputs.selfie;
  const openToAll = recipe !== null && card.origin === 'studio' && card.lock === null;
  const visibleRecipe = openToAll ? recipe : recipe ? recipeTeaser(recipe) : null;
  // Story-first (founder, 2026-10-29): the result, then how it was made, then "one selfie and it's
  // you" with the make box — the recipe sits in the column under the title, ahead of any cost.
  const recipeFirst = visibleRecipe?.presentation === 'story-first' && Boolean(visibleRecipe.steps);
  const accessEndpoint = `/api/renders/access?template=${encodeURIComponent(card.slug)}&locale=${locale}`;
  const hasGuide = (visibleRecipe?.guide?.length ?? visibleRecipe?.guideOutline?.length ?? 0) > 0;
  const howItWasMade = visibleRecipe ? (
    <HowItWasMade
      recipe={visibleRecipe}
      copy={mr}
      compact={recipeFirst}
      {...(hasGuide ? { clipsHref: '#clips' } : {})}
      {...(openToAll
        ? {}
        : {
            gate: {
              accessEndpoint,
              signinHref: signInHref(`${templateHref(locale, slug)}#how`, locale),
            },
          })}
    />
  ) : null;
  const clipsSection = visibleRecipe && hasGuide ? (
    <RecipeClipsSection
      recipe={visibleRecipe}
      copy={mr}
      {...(openToAll
        ? {}
        : {
            gate: {
              accessEndpoint,
              signinHref: signInHref(`${templateHref(locale, slug)}#clips`, locale),
            },
          })}
    />
  ) : null;

  const t = dict.templates;
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  // A priced template whose engine is not open for orders (an engine on the personal Sunra lane alone, before its
  // order wiring) reads as not for sale: no make box, no buy action. Every other template: exactly `isForSale`.
  const forSale = isForSale(card) && engineOrdersOpen(card);
  const subscriptionQuote = forSale ? templateSubscriptionQuote(card) : null;
  const makeAvailabilityCopy = { makeCta: t.makeCta, makeCtaClosed: t.makeCtaClosed, makeBody: t.makeBody, makeBodyClosed: t.makeBodyClosed, makeBodySubscription: t.makeBodySubscription, makeBodySubscriptionPaused: t.makeBodySubscriptionPaused };
  const ratio = card.poster?.w && card.poster.h ? `${card.poster.w} / ${card.poster.h}` : posterRatio(card.slug);
  // §7.5·§14.1: origin decides the fallback (a maker's template is a `source='yagi'` row too); a typed handle wins on both.
  const credit = card.authorHandle ? labels.byAuthor.replace('{handle}', card.authorHandle) : card.origin !== 'maker' ? labels.byYagi : labels.byAnonymous;
  const makerRest = makerProfileRest(card);
  const maker = makerRest ? makers.find((item) => item.handle === card.authorHandle) ?? null : null;
  // §20: the creative's other templates — their catalogue, one click from the one being read.
  const moreFromMaker = maker ? all.filter((item) => item.slug !== card.slug && item.makerProfile && item.authorHandle === maker.handle).slice(0, 4) : [];
  const shopOpen = storefrontOpen();
  const subscriptionOpen = availability.status === 'open';
  const description = petOnly ? dict.cast.pet.templateDescription : templateDescription(dict, subscriptionOpen);
  const resolutions = forSale ? offeredResolutions(card) : [];
  // A set template (2026-10-27): one order, one example per frame it makes.
  const gallery = card.gallery ?? [];
  const setSize = gallery.length > 1 ? gallery.length : null;
  // docs/PERSONAL-STUDIO.md §3.4.10 — the card carries `look` only with the switch on; `lookOpen` gates every addition.
  const lookOpen = templateLookOpen();
  const templateLook = lookOpen ? card.look ?? null : null;
  const facts: Array<[string, string]> = [
    card.medium === 'video' && card.runtimeSeconds
      ? [t.runtimeLabel, interpolate(dict.studio.runtimeLabel, { seconds: String(card.runtimeSeconds) })]
      : [t.mediumLabel, setSize ? interpolate(t.setOutput, { n: String(setSize) }) : dict.nav[card.medium]],
    [t.aspectFact, card.aspectDefault ?? defaultAspect(card.medium)],
    ...(resolutions.length > 0 ? [[t.resolutionFact, resolutions[0]!] as [string, string]] : []),
    // docs/PERSONAL-STUDIO.md §3.4.10 — one quiet fact on a template written for one style (switch on only).
    ...(templateLook ? [[dict.templateLook.factLabel, dict.templateLook[templateLook]] as [string, string]] : []),
    [t.waitLabel, interpolate(t.waitValue, { minutes: String(waitMinutes) })],
  ];
  // §3.4.10: the line the make box and the make card show when the viewer picked the other style (client-side only).
  const lookMismatch = templateLook ? <LookMismatch template={templateLook} note={dict.templateLook.mismatch} className="mt-1.5" /> : null;

  // The campaigns that ask for THIS template — the earn loop, one click from the make loop.
  const campaigns = campaignCatalog.campaigns.filter((c) => c.styleSlug === card.slug && isCampaignPublic(c.status));
  const cLabels = campaignLabels(dict);

  const resolvedEngine = resolveEngine(card.engine, card.medium);
  const style: StudioStyle | null = forSale && makeInputs !== null
    ? {
        castInputs: { selfie: makeInputs.selfie, pet: makeInputs.pet, partner: makeInputs.partner },
        id: card.slug,
        title,
        price: formatTemplatePrice(card, locale),
        // 2026-11-24: an unknown length is no length, never "0초".
        runtime: card.runtimeSeconds ? String(card.runtimeSeconds) : '',
        blurb: card.useCase.map((value) => useCaseLabels[value] ?? value).join(' · '),
        posterSrc: card.poster?.src ?? null,
        videoSrc: card.video?.src ?? null,
        moreHref: templatesHref(locale, card.medium),
        aspects: aspectsForMedium(card.medium).map((id) => ({ id, label: t.aspects[id as keyof typeof t.aspects] ?? id })),
        defaultAspect: card.aspectDefault ?? defaultAspect(card.medium),
        resolutions: offeredResolutions(card).map((id) => ({ id, price: formatResolutionPrice(card, id, locale) })),
        imageSetSpec:
          card.medium === 'image' && setSize
            ? {
                totalFrames: setSize,
                perFrameProviderUsd: isImageEngine(resolvedEngine)
                  ? estimateImageUsd(resolvedEngine, 1)
                  : 0.09,
                royaltyKrw: templateImageSetInfo(card, null).royaltyKrw,
                frameThumbnails: gallery.map((f) => f.src),
              }
            : null,
      }
    : null;

  const mediaAspect = card.aspectDefault ?? defaultAspect(card.medium);
  // Pictures get the interactive stage (swipe, viewer, zoom); a film keeps its player. A set opens
  // on its poster frame — the founder's pick, the same published object as that frame.
  const galleryLabels = t.gallery;
  const stageFrames = card.medium === 'image' ? (setSize ? gallery : card.poster ? [card.poster] : null) : null;
  const stageStart = setSize && card.poster ? Math.max(0, gallery.findIndex((frame) => frame.src === card.poster!.src)) : 0;
  const photoGuideExamples = [
    { id: 'front', src: '/images/portrait-guide/front-facing.webp', label: dict.studio.photoExamples.front, crop: 'object-[50%_30%]' },
    { id: 'bright', src: '/images/portrait-guide/clear-face.webp', label: dict.studio.photoExamples.bright, crop: 'object-[50%_20%]' },
    { id: 'solo', src: '/images/portrait-guide/front-facing.webp', label: dict.studio.photoExamples.solo, crop: 'object-[50%_18%] scale-150' },
  ];

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest={`/t/${slug}`} initialTheme="light" />
      {/* No Offer: a template page names no won or dollar price (founder, 2026-10-29 — credits). */}
      <JsonLd id="template-structured-data" data={templateStructuredData({ origin: siteUrl(), locale, card, description, publicSalesEnabled: false })} />

      <SubscriptionAvailabilityProvider initialAvailability={availability}>
      <main id="main" data-template={card.slug} data-medium={card.medium} data-section data-theme="light" className="section pb-24">
        <RecipeAccessProvider
          accessEndpoint={visibleRecipe && !openToAll ? accessEndpoint : null}
          initialUnlocked={openToAll ? recipe : null}
        >
        {/* The page's own centred shell. `.band` keeps a 300px ad rail free at 1440+, which this
            page never has — that empty rail is what pushed everything left (founder, 2026-10-28). */}
        <div data-template-shell className="mx-auto w-full max-w-[calc(var(--container-audience)+2*var(--spacing-gutter))] px-[var(--spacing-gutter)] pt-24">
            <a href={templatesHref(locale, card.medium)} className="inline-flex min-h-11 items-center text-sm text-black/65 transition-colors hover:text-black">
              ← {interpolate(t.backTo, { medium: dict.nav[card.medium] })}
            </a>

            <header className="mt-3 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,25rem)] lg:items-start lg:gap-12 xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-16">
              <div className="min-w-0">
                {stageFrames ? (
                  <TemplateGallery
                    frames={stageFrames}
                    initialIndex={stageStart}
                    setSize={setSize}
                    title={title}
                    aspect={mediaAspect}
                    makeHref={style !== null ? '#make' : null}
                    selfieTile={!petOnly}
                    labels={{
                      ...galleryLabels,
                      lead: petOnly ? dict.cast.pet.transform : setSize ? galleryLabels.transformSet : galleryLabels.transformImage,
                      position: dict.renders.frames.position,
                      selfie: dict.creatorJourney.evidenceSelfie,
                    }}
                  />
                ) : (
                  <>
                    <div className="-mx-[var(--spacing-gutter)] sm:mx-0">
                      <PromptDetailMedia
                        poster={card.poster}
                        video={card.video}
                        alt={labels.resultLabel}
                        ratio={ratio}
                        aspect={mediaAspect}
                        keyframes={videoKeyframes}
                        {...(fixed ? { fixed } : {})}
                        locale={locale}
                        controls={{
                          play: dict.campaigns.landing.reelPlay,
                          pause: dict.campaigns.landing.reelPause,
                          unmute: dict.campaigns.landing.reelUnmute,
                          mute: dict.campaigns.landing.reelMute,
                        }}
                        fallback={<TypographicPoster title={card.title} slug={card.slug} kicker={dict.nav[card.medium]} ratio={ratio} />}
                      />
                    </div>
                    {/* A film with no poster still gets the promise, without the result tile. Story-first
                        moves it under the recipe, into the make box. */}
                    {!recipeFirst && !petOnly && (
                      <TransformStrip
                        lead={galleryLabels.transformVideo}
                        selfieLabel={dict.creatorJourney.evidenceSelfie}
                        makeHref={style !== null ? '#make' : null}
                        poster={card.poster}
                        aspect={mediaAspect}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="min-w-0 lg:sticky lg:top-24">
                <p className="text-[13px] font-medium text-[#71717A]">
                  <span data-medium-chip>{dict.nav[card.medium]}</span>
                </p>
                <h1 className="mt-2 font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.16] font-bold tracking-[-0.028em] text-balance break-keep">{title}</h1>
                {/* §7.5 (founder 2026-10-30): a creative's template says who made it and opens their
                    profile — one line under the title, nothing more. Bio, place and links live on the profile. */}
                {makerRest && card.authorHandle && (
                  <a data-template-maker={card.authorHandle} data-template-credit href={`/${locale}${makerRest}`} className="group mt-3 flex max-w-md min-h-11 items-center gap-3">
                    <CreativeAvatar handle={card.authorHandle} name={maker?.displayName ?? null} src={maker?.avatar ?? null} size={36} eager />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-[#71717A]">{t.makerBlockHeading}</span>
                      <span className="block truncate text-sm font-semibold group-hover:underline">
                        {maker?.displayName ?? `@${card.authorHandle}`}
                        {maker?.displayName && <span className="ml-1.5 font-normal text-[#71717A]">@{card.authorHandle}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-[#52525B] group-hover:text-[#09090B]">{t.makerBlockCta} →</span>
                  </a>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  {!makerRest && (
                    <span data-template-credit className="inline-flex items-center rounded-full bg-[#F4F4F5] px-2.5 py-1 font-medium text-[#09090B]">
                      {credit}
                    </span>
                  )}
                  {/* Every public template passed studio review, studio and maker alike (§7.5). */}
                  <span data-template-verified title={t.verifiedHint} className="inline-flex items-center rounded-full bg-[#F4F4F5] px-2.5 py-1 font-medium text-[#52525B]">
                    {t.verified}
                  </span>
                  {/* 2026-11-24 (founder): genre words say nothing about a video, so a video template leaves them out. */}
                  {card.medium !== 'video' && card.useCase.filter((v) => v !== 'cinematic').map((value) => (
                    <span key={value} data-template-use-case={value} className="inline-flex items-center rounded-full bg-[#F4F4F5] px-2.5 py-1 text-[#52525B]">
                      {useCaseLabels[value] ?? value}
                    </span>
                  ))}
                </div>

                {/* Story-first: the recipe itself, right under the title — before the make box and any cost. */}
                {recipeFirst && <div id="recipe" data-template-recipe="story-first" className="scroll-mt-24">{howItWasMade}</div>}

                {/* Make-first, with a public recipe: copy the prompt or make it, both one tap from the title
                    (2026-10-29). Only the step count goes down: the full prompt stays behind the members' gate. */}
                {!recipeFirst && recipe?.steps?.length ? (
                  <RecipeActions
                    steps={recipe.steps.length}
                    labels={{ ...mr.actions, copied: mr.how.copied }}
                    makeHref={style !== null ? '#make' : null}
                    shopOpen={shopOpen}
                    accessEndpoint={`/api/renders/access?template=${encodeURIComponent(card.slug)}&locale=${locale}`}
                    signinHref={signInHref(`${templateHref(locale, slug)}#how`, locale)}
                    {...(openToAll ? { initialUnlocked: recipe } : {})}
                  />
                ) : null}

                {style === null ? (
                  <>
                    <section data-template-closed className="mt-6 rounded-[16px] bg-[#F4F4F5] p-5 sm:p-6">
                      <p className="font-display text-[1.5rem] leading-none font-bold">{t.notForSale}</p>
                      <dl data-template-facts className="mt-2.5 flex flex-wrap items-center gap-y-1 text-xs text-[#52525B]">
                        {facts.filter(([label]) => label !== t.waitLabel).map(([label, value], idx) => (
                          <div key={label} data-template-fact className="inline-flex items-center">
                            {idx > 0 && <span aria-hidden="true" className="mx-1.5 text-black/30">·</span>}
                            <dt className="sr-only">{label}</dt>
                            <dd className="inline font-medium text-[#09090B]">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-3 text-sm leading-relaxed text-[#52525B]">{t.notForSaleBody}</p>
                      <a href={templatesHref(locale, card.medium)} data-template-closed-browse className="audience-button-quiet mt-4 min-h-10 px-4 text-xs">
                        {card.medium === 'image' ? t.closedBrowseImageCta : t.closedBrowseVideoCta} →
                      </a>
                    </section>
                  </>
                ) : (
                  <>
                    {/* The make box (founder, 2026-10-29): once subscriptions open, credits for a member and "Subscribe to make it here" for a
                        visitor. Until then the single-purchase price the terms promise. The make card itself is the sheet below. */}
                    <MakeLauncher
                      credits={subscriptionOpen ? templateCredits(card) : null}
                      price={!subscriptionOpen && shopOpen ? { value: style.price, label: t.priceLabel } : null}
                      signinHref={signInHref(`${templateHref(locale, slug)}#make`, locale)}
                      labels={{ subscribeCta: subscriptionOpen ? t.subscribeCta : t.makeCta, credits: t.credits, makeCta: t.makeCta, makeCtaClosed: t.makeCtaClosed }}
                      stickyAfter={recipeFirst}
                      lead={recipeFirst && !stageFrames && !petOnly ? (
                        <TransformStrip
                          lead={galleryLabels.transformVideo}
                          selfieLabel={dict.creatorJourney.evidenceSelfie}
                          makeHref="#make"
                          poster={card.poster}
                          aspect={mediaAspect}
                          className=""
                        />
                      ) : undefined}
                    >
                      <dl data-template-facts className="flex flex-wrap items-center gap-y-1 text-xs text-black/65">
                        {facts.map(([label, value], idx) => (
                          <div key={label} data-template-fact className="inline-flex items-center">
                            {idx > 0 && <span aria-hidden="true" className="mx-1.5 text-black/30">·</span>}
                            <dt className={label === t.waitLabel ? 'mr-1 inline' : 'sr-only'}>{label}</dt>
                            <dd className="inline font-medium text-black/80">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {/* Founder, 2026-11-15: 720p is the default and it is enough — say so where the price is decided. */}
                      {resolutions.length > 0 && <p data-resolution-standard className="mt-1.5 text-xs text-black/65">{t.resolutionStandard}</p>}
                      {lookMismatch}
                    </MakeLauncher>

                    {/* The make card as a sheet: studio, refund and AI notes, the photo guide. Every `#make` opens it. */}
                    <MakeSheet title={title} closeLabel={t.gallery.close}>
                      <section id="make" data-template-make className="scroll-mt-24">
                        <TwingsStudio
                          styles={[style]}
                          initialStyleId={style.id}
                          shopOpenHint={shopOpen}
                          stickyBar={false}
                          live={{
                            endpoint: '/api/renders',
                            accessEndpoint: '/api/renders/access',
                            interestEndpoint: '/api/notify/interest',
                            template: card.slug,
                            locale,
                            signinHref: signInHref(`${templateHref(locale, slug)}#make`, locale),
                            identityHref: identityVerifyHref(`${templateHref(locale, slug)}#make`),
                            selfie: dict.selfie,
                            cast: dict.cast.photo,
                            subscription: { copy: dict.creatorSubscription, editorCopy: dict.premiumEditor },
                            // docs/PERSONAL-STUDIO.md §3.1 — the sheet card only with the server flag on.
                            ...(personalEditSheetOpen() ? { editSheet: dict.editSheet } : {}),
                            // docs/PERSONAL-STUDIO.md §3.3 — a template's locked parts, flag on or off: the card's
                            // public projection only (which parts, never the lock block's words).
                            ...(card.locks ? { locks: card.locks, lockCopy: dict.editSheet } : {}),
                            // docs/PERSONAL-STUDIO.md §3.4.9 (S2) — the styling projection (names only) and the declared
                            // parts with the make card's words; only on a template that declares them.
                            ...(card.styling ? { styling: card.styling, lockCopy: dict.editSheet } : {}),
                            // Founder 2026-11-25 — a template with no room left for edits: one line, no edit panel.
                            ...(card.editsClosed ? { editsClosed: t.editsClosed } : {}),
                            // …and, with room, the numbers that tell which "내 사진 그대로" switch still fits.
                            ...(card.editRoom ? { editRoom: card.editRoom } : {}),
                            ...(makeParts ? { parts: makeParts } : {}),
                            // docs/PERSONAL-STUDIO.md §3.4.10 — a one-style template's mismatch line, above the button.
                            ...(templateLook ? { templateLook: { look: templateLook, note: dict.templateLook.mismatch } } : {}),
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
                            signedOutCta: subscriptionOpen ? t.subscribeCta : t.makeCta,
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
                        <div data-template-trust className="mt-4 space-y-1 border-t border-hairline pt-3.5 text-xs leading-relaxed text-black/65">
                          <p data-template-refund className="font-medium text-black/80">{dict.renders.notCharged}</p>
                          {/* Founder, 2026-09-11: what AI-made means is said before the money, not after the complaint. */}
                          <p data-studio-ai-note>{t.aiLimit}</p>
                        </div>
                        <p data-template-sale-state className="mt-3 text-xs leading-relaxed text-black/60">
                          <TemplateMakeAvailability copy={makeAvailabilityCopy} oneTimeAvailable={shopOpen} subscriptionEligible={subscriptionQuote !== null} field="body" />
                        </p>
                        {/* The face photo guide is for a selfie; a pet-only card has its own tips beside the pet photo. */}
                        {!petOnly && <section data-template-photo-guide className="mt-5 rounded-[16px] bg-[#F4F4F5] p-4 sm:p-5">
                          <h2 className="text-xs font-semibold text-[#09090B]">{dict.selfie.goodExamples}</h2>
                          <p className="mt-2 text-xs leading-relaxed text-[#52525B]">{dict.studio.signedOutBody}</p>
                          <ul data-studio-photo-examples className="mt-3 grid grid-cols-3 gap-2.5">
                            {photoGuideExamples.map((example) => (
                              <li key={example.id} data-studio-photo-example={example.id}>
                                <figure>
                                  <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black/5">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- the public photo guide */}
                                    <img src={example.src} alt="" width={160} height={200} loading="lazy" className={`h-full w-full object-cover ${example.crop}`} />
                                  </div>
                                  <figcaption className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[#09090B]">
                                    <span aria-hidden="true" className="text-[#09090B]">✓</span>{example.label}
                                  </figcaption>
                                </figure>
                              </li>
                            ))}
                          </ul>
                        </section>}
                      </section>
                    </MakeSheet>
                  </>
                )}

                {/* The definition, under the first screen (AGENTS.md §7 GEO): in the HTML, not in the way. */}
                <p data-template-description className="mt-6 max-w-detail text-sm leading-relaxed text-[#52525B]">{style !== null ? description : dict.creatorJourney.body}</p>
              </div>
            </header>

            {recipeFirst && clipsSection}

            {/* The recipe follows the result, never ahead of it (founder, 2026-10-28). A maker's
                'story-first' sits in the column above (2026-10-29); 'make-first' after the campaigns.
                "만드는 법" draws its own rule and spacing; the wrapper only anchors `#recipe`. */}

            {/* The earn loop: campaigns that ask for exactly this template. */}
            {campaigns.length > 0 && (
              <section data-template-campaigns className="mt-16 border-t border-[#09090B]/[0.08] pt-10">
                <p className="text-[13px] font-medium text-[#71717A]">{dict.campaigns.eyebrow}</p>
                <h2 className="audience-heading mt-3">{t.campaignsHeading}</h2>
                <ul className="mt-6 flex flex-col divide-y divide-[#09090B]/[0.08] border-y border-[#09090B]/[0.08]">
                  {campaigns.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div>
                        <a href={campaignHref(locale, c.slug)} className="text-base font-bold tracking-[-0.015em] text-[#09090B] hover:underline">
                          {localize(c.title, locale).replace(/\s+/g, ' ')}
                        </a>
                        <p className="mt-1 text-xs text-[#71717A]">
                          {c.hostName} · {cLabels.status[c.status]}
                        </p>
                      </div>
                      <a href={campaignHref(locale, c.slug)} className="audience-button-quiet min-h-10 px-4 text-xs">
                        <TextSwap>{dict.campaigns.applyCta} →</TextSwap>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {recipe?.presentation === 'make-first' && <div id="recipe" data-template-recipe="make-first" className="scroll-mt-24">{howItWasMade}</div>}
            {!recipeFirst && clipsSection}

            {maker && moreFromMaker.length > 0 && (
              <div data-template-more-from={maker.handle}>
                <RelatedPrompts
                  cards={moreFromMaker}
                  locale={locale}
                  labels={{ ...labels, relatedHeading: interpolate(t.moreFrom, { handle: maker.handle }) }}
                  useCaseLabels={useCaseLabels}
                  signinHref={signInHref(templateHref(locale, slug), locale)}
                />
              </div>
            )}

            {blogEnabled && templateStories.length > 0 ? (
              <TemplateStories
                stories={templateStories}
                locale={locale}
                heading={dict.makerBlog.templateStoriesHeading}
                lede={dict.makerBlog.templateStoriesLede}
              />
            ) : null}

            {blogEnabled && originalInstagram ? (
              <section
                data-template-original-instagram
                className="mt-16 border-t border-[#09090B]/[0.08] pt-10"
              >
                <h2 className="font-display text-xl font-bold tracking-[-0.025em] break-keep text-[#09090B]">
                  {dict.makerBlog.originalPostHeading}
                </h2>
                <div className="mt-5 max-w-detail">
                  <InstagramLink
                    url={originalInstagram.url}
                    labels={{
                      placeholderLabel: dict.makerBlog.instagramPlaceholderLabel,
                      open: dict.makerBlog.instagramShowEmbed,
                    }}
                  />
                </div>
              </section>
            ) : null}

            {await TemplateRatings({templateId:card.id,copy:dict.community})}
            <RelatedPrompts
              cards={related(card, all).filter((item) => !moreFromMaker.includes(item))}
              locale={locale}
              labels={{ ...labels, relatedHeading: t.relatedHeading }}
              useCaseLabels={useCaseLabels}
              signinHref={signInHref(templateHref(locale, slug), locale)}
            />
          </div>
        </RecipeAccessProvider>
      </main>
      <FaqSection dict={dict} locale={locale} placement="template" path={`/${locale}/t/${slug}`} availability={availability} />
      </SubscriptionAvailabilityProvider>
      <MarketingFooter locale={locale} dict={dict} />
      {/* docs/PERSONAL-STUDIO.md §3.4.10 — the related templates follow the viewer's style; the question, once. */}
      {lookOpen && <TemplateLookIsland copy={dict.templateLook} />}
      {/* Room for the phone's sticky make bar, so it never sits on the footer's last line. */}
      {style !== null && <div aria-hidden="true" className="h-24 md:hidden" />}
    </PersonalIdentity>
  );
}
