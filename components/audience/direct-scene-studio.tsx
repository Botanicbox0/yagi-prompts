import type { CSSProperties } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { EvidencePair } from '@/lib/content/slots';
import { EMPTY_PROMPT_CATALOG, type PromptCard, type PromptCatalog } from '@/lib/prompts/catalog';
import { cardAuthor } from '@/components/prompts/card-frame';
import { templateHref } from '@/lib/prompts/links';
import {
  quoteVideoResolutionTiers,
  simulateMakerTemplateRevenue,
} from '@/lib/twings/template-price';
import { DEFAULT_DIRECT_ROYALTY_KRW } from './direct/defaults';
import { DirectEarningsCalculator } from './direct/earnings-calculator';
import { DirectHeroVideo } from './direct/hero-video';
import {
  heroAspectRatio,
  heroVideoMatchesPoster,
  pickDirectPageMedia,
  stepTileMetrics,
} from './direct/pick-media';

export const DEFAULT_DIRECT_VIDEO_PROVIDER_USD = quoteVideoResolutionTiers({
  seconds: 10,
  aspect: '9:16',
}).tiers['720p'].providerUsd;

const QUALITY_RULE_IDS = ['01', '02', '03'] as const;

export interface DirectSceneStudioProps {
  locale: Locale;
  videoCatalogHref: string;
  creatorWorkspaceHref: string;
  catalog?: PromptCatalog;
  evidence?: EvidencePair | null;
}

export function DirectSceneStudio({
  locale,
  videoCatalogHref,
  creatorWorkspaceHref,
  catalog = EMPTY_PROMPT_CATALOG,
  evidence = null,
}: DirectSceneStudioProps) {
  const dict = getDictionary(locale);
  const ds = dict.creatorJourney.directScene;
  const media = pickDirectPageMedia(catalog, evidence);

  const numLocale = locale === 'en' ? 'en-US' : 'ko-KR';
  const fmt = (value: number) => value.toLocaleString(numLocale);

  const defaultSim = simulateMakerTemplateRevenue({
    medium: 'video',
    providerUsd: DEFAULT_DIRECT_VIDEO_PROVIDER_USD,
    royaltyKrw: DEFAULT_DIRECT_ROYALTY_KRW,
  });
  const step3ExampleLabel = ds.step3TileLabel.replace(
    '{amount}',
    fmt(DEFAULT_DIRECT_ROYALTY_KRW),
  );
  const step3ExampleAmount = ds.simPerMakePattern.replace(
    '{amount}',
    fmt(defaultSim.perMake.creator),
  );

  const cardTitle = (card: PromptCard) =>
    locale === 'ko' && card.titleKo ? card.titleKo : card.title;

  const cardAuthorLine = (card: PromptCard): string | null => {
    const author = cardAuthor(card);
    if (!author) return null;
    return author.handle
      ? dict.prompts.cardAuthor.replace('{handle}', author.handle)
      : dict.prompts.cardAuthorAnonymous;
  };

  const heroCard = media.hero;
  const heroPosterSrc = heroCard?.poster?.src?.trim() ? heroCard.poster.src : null;
  const heroVideoSrc =
    heroCard && heroVideoMatchesPoster(heroCard) && heroCard.video?.src?.trim()
      ? heroCard.video.src
      : null;
  const heroHasMedia = Boolean(heroCard && heroPosterSrc);
  const heroRatio = heroCard
    ? heroAspectRatio(heroCard)
    : { css: '9 / 16', ratio: 9 / 16, portrait: true };
  const heroTitle = heroCard ? cardTitle(heroCard) : '';
  const heroAuthorLine = heroCard ? cardAuthorLine(heroCard) : null;
  const heroMaxCapPx = heroRatio.portrait ? 420 : 576;
  const heroRatioRounded = Number(heroRatio.ratio.toFixed(4));
  const heroFigureStyle: CSSProperties = {
    maxWidth: `min(100%, ${heroMaxCapPx}px, calc(68vh * ${heroRatioRounded}))`,
  };

  const step1Metrics = media.step1Card ? stepTileMetrics(media.step1Card, 300) : null;
  const step2Metrics = media.step2Card ? stepTileMetrics(media.step2Card, 264) : null;
  const step3Metrics = media.step3Card ? stepTileMetrics(media.step3Card, 264) : null;

  const step2Title = media.step2Card ? cardTitle(media.step2Card) : null;
  const step2AuthorLine = media.step2Card ? cardAuthorLine(media.step2Card) : null;

  const tileFrameStyle = (metrics: {
    aspectCss: string;
    mobileWidthPx: number;
    desktopWidthPx: number;
  }): CSSProperties =>
    ({
      aspectRatio: metrics.aspectCss,
      '--step-w-sm': `${metrics.mobileWidthPx}px`,
      '--step-w-md': `${metrics.desktopWidthPx}px`,
    }) as CSSProperties;

  return (
    <div
      data-direct-scene-studio
      className="audience-shell space-y-14 pt-20 pb-16 lg:space-y-20 lg:pt-28 lg:pb-24"
    >
      {/* A. Hero — mobile order: eyebrow -> h1 -> sub -> CTA -> media; desktop: text left, media right */}
      <header
        data-direct-hero
        className={
          heroHasMedia
            ? 'grid items-center gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12'
            : 'max-w-3xl'
        }
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[#71717A]">{ds.heroEyebrow}</p>
          <h1 className="audience-title mt-3 whitespace-pre-line text-[#09090B]">
            {ds.heroHeading}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#52525B]">{ds.heroSubcopy}</p>
          <p className="mt-2.5 text-xs font-medium text-[#71717A]">{ds.heroStatus}</p>
          <div className="mt-5 flex flex-wrap items-center gap-4 sm:gap-5">
            <a
              href={creatorWorkspaceHref}
              data-direct-workspace-cta
              className="audience-button"
            >
              {ds.primaryCta}
            </a>
            <a
              href={videoCatalogHref}
              className="inline-flex min-h-11 items-center text-sm font-medium text-[#09090B] underline underline-offset-4 transition-colors duration-[160ms] hover:opacity-70"
            >
              {ds.secondaryCta}
            </a>
          </div>
        </div>

        {heroHasMedia && heroCard && heroPosterSrc && (
          <figure
            data-direct-hero-media
            style={heroFigureStyle}
            className="mx-auto w-full min-w-0 lg:mx-0 lg:justify-self-end"
          >
            {heroVideoSrc ? (
              <DirectHeroVideo
                videoSrc={heroVideoSrc}
                posterSrc={heroPosterSrc}
                title={heroTitle}
                ratio={heroRatio.css}
              />
            ) : (
              <div
                className="relative w-full overflow-hidden rounded-[12px] bg-[#F4F4F5]"
                style={{ aspectRatio: heroRatio.css }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- public catalogue poster */}
                <img
                  src={heroPosterSrc}
                  alt={heroTitle}
                  width={heroCard.poster?.w}
                  height={heroCard.poster?.h}
                  loading="eager"
                  fetchPriority="high"
                  className="h-full w-full object-contain"
                />
              </div>
            )}

            <figcaption className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-[#71717A]">
              <a
                href={templateHref(locale, heroCard.slug)}
                className="font-medium text-[#09090B] underline-offset-4 hover:underline"
              >
                {heroTitle}
              </a>
              {heroAuthorLine && <span>{heroAuthorLine}</span>}
            </figcaption>
          </figure>
        )}
      </header>

      {/* B. Three steps — compact rows on mobile (~120px height), uncropped posters centred on #F4F4F5 at md+ */}
      <section
        data-direct-steps
        aria-label={ds.stepsAriaLabel}
        className="border-t border-[#09090B]/[0.08] pt-12"
      >
        <div className="grid items-stretch gap-4 md:grid-cols-3 md:gap-6">
          {/* Step 1 */}
          <article
            data-direct-step="1"
            className="flex min-w-0 items-start gap-4 rounded-[16px] bg-[#F4F4F5] p-4 md:flex-col md:items-stretch md:gap-0 md:p-5"
          >
            {media.step1Evidence ? (
              <div className="shrink-0 md:flex md:h-[300px] md:w-full md:items-center md:justify-center">
                <div className="flex items-center justify-center md:w-full md:max-w-[340px] md:gap-3">
                  <div className="hidden aspect-[4/5] w-[140px] shrink-0 overflow-hidden rounded-[12px] md:block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- configured selfie slot */}
                    <img
                      src={media.step1Evidence.before}
                      alt={dict.creatorJourney.evidenceSelfieAlt}
                      width={400}
                      height={500}
                      loading="lazy"
                      className="block h-full w-full object-contain"
                    />
                  </div>
                  <span aria-hidden="true" className="hidden text-xs text-[#71717A] md:inline">
                    →
                  </span>
                  <div className="aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-[12px] md:w-[170px]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- configured result slot */}
                    <img
                      src={media.step1Evidence.after}
                      alt={dict.creatorJourney.evidenceSceneAlt}
                      width={640}
                      height={480}
                      loading="lazy"
                      className="block h-full w-full object-contain"
                    />
                  </div>
                </div>
              </div>
            ) : media.step1Card?.poster?.src && step1Metrics ? (
              <div className="shrink-0 md:flex md:h-[300px] md:w-full md:items-center md:justify-center">
                <div
                  className="w-[var(--step-w-sm)] max-w-full overflow-hidden rounded-[12px] md:mx-auto md:w-full md:max-w-[var(--step-w-md)]"
                  style={tileFrameStyle(step1Metrics)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- public catalogue poster */}
                  <img
                    src={media.step1Card.poster.src}
                    alt={cardTitle(media.step1Card)}
                    width={media.step1Card.poster.w}
                    height={media.step1Card.poster.h}
                    loading="lazy"
                    className="block h-full w-full object-contain"
                  />
                </div>
              </div>
            ) : null}

            <div className="min-w-0 flex-1 md:mt-4 md:flex-initial">
              <h2 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B]">
                {ds.step1Title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#52525B]">{ds.step1Body}</p>
            </div>
          </article>

          {/* Step 2 */}
          <article
            data-direct-step="2"
            className="flex min-w-0 items-start gap-4 rounded-[16px] bg-[#F4F4F5] p-4 md:flex-col md:items-stretch md:gap-0 md:p-5"
          >
            {media.step2Card?.poster?.src && step2Title && step2Metrics && (
              <a
                href={templateHref(locale, media.step2Card.slug)}
                className="group flex shrink-0 flex-col items-center justify-center md:h-[300px] md:w-full"
              >
                <div
                  className="w-[var(--step-w-sm)] max-w-full overflow-hidden rounded-[12px] md:mx-auto md:w-full md:max-w-[var(--step-w-md)]"
                  style={tileFrameStyle(step2Metrics)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- public catalogue poster; title is in link text */}
                  <img
                    src={media.step2Card.poster.src}
                    alt=""
                    width={media.step2Card.poster.w}
                    height={media.step2Card.poster.h}
                    loading="lazy"
                    className="block h-full w-full object-contain transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02]"
                  />
                </div>
                <span className="sr-only md:hidden">{step2Title}</span>
                <div className="mt-2.5 hidden w-full flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-center md:flex">
                  <span className="line-clamp-1 text-xs font-semibold text-[#09090B]">
                    {step2Title}
                  </span>
                  {step2AuthorLine && (
                    <span className="text-xs text-[#71717A]">{step2AuthorLine}</span>
                  )}
                </div>
              </a>
            )}

            <div className="min-w-0 flex-1 md:mt-4 md:flex-initial">
              <h2 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B]">
                {ds.step2Title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#52525B]">{ds.step2Body}</p>
            </div>
          </article>

          {/* Step 3 */}
          <article
            data-direct-step="3"
            className="flex min-w-0 items-start gap-4 rounded-[16px] bg-[#F4F4F5] p-4 md:flex-col md:items-stretch md:gap-0 md:p-5"
          >
            {media.step3Card?.poster?.src && step3Metrics ? (
              <div className="shrink-0 md:flex md:h-[300px] md:w-full md:flex-col md:items-center md:justify-center">
                <div
                  className="w-[var(--step-w-sm)] max-w-full overflow-hidden rounded-[12px] md:mx-auto md:w-full md:max-w-[var(--step-w-md)]"
                  style={tileFrameStyle(step3Metrics)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- public catalogue poster */}
                  <img
                    src={media.step3Card.poster.src}
                    alt={cardTitle(media.step3Card)}
                    width={media.step3Card.poster.w}
                    height={media.step3Card.poster.h}
                    loading="lazy"
                    className="block h-full w-full object-contain"
                  />
                </div>
                <div className="mt-2.5 hidden items-baseline justify-center gap-2 text-xs tabular-nums md:flex">
                  <span className="text-[#52525B]">{step3ExampleLabel}</span>
                  <span className="font-semibold text-[#09090B]">{step3ExampleAmount}</span>
                </div>
              </div>
            ) : (
              <div className="flex w-24 shrink-0 flex-col justify-center rounded-[12px] bg-[#FFFFFF]/70 p-3 md:h-[300px] md:w-full md:items-center md:bg-transparent md:p-4 md:text-center">
                <p className="text-[11px] font-medium leading-snug text-[#52525B] md:text-xs">
                  {step3ExampleLabel}
                </p>
                <p className="mt-1.5 text-base font-bold text-[#09090B] tabular-nums md:text-2xl">
                  {step3ExampleAmount}
                </p>
              </div>
            )}

            <div className="min-w-0 flex-1 md:mt-4 md:flex-initial">
              <h2 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B]">
                {ds.step3Title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#52525B]">{ds.step3Body}</p>
              {media.step3Card?.poster?.src && (
                <p className="mt-1.5 text-xs font-medium text-[#09090B] tabular-nums md:hidden">
                  {step3ExampleLabel} {step3ExampleAmount}
                </p>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* C. Earnings (the single client island) */}
      <DirectEarningsCalculator
        locale={locale}
        providerUsd={DEFAULT_DIRECT_VIDEO_PROVIDER_USD}
        copy={{
          simBadge: ds.simBadge,
          simHeading: ds.simHeading,
          simRaiseGroupLabel: ds.simRaiseGroupLabel,
          simBaseChip: ds.simBaseChip,
          simRaiseChipPattern: ds.simRaiseChipPattern,
          simDisclosure: ds.simDisclosure,
          simSalePriceLabel: ds.simSalePriceLabel,
          simSalePricePattern: ds.simSalePricePattern,
          simPerMakeLabel: ds.simPerMakeLabel,
          simPerMakePattern: ds.simPerMakePattern,
          simHundredMakesPattern: ds.simHundredMakesPattern,
          simSettlementNote: ds.simSettlementNote,
        }}
      />

      {/* D. Tips (closed by default) */}
      <section
        data-high-quality-guide
        aria-labelledby="quality-guide-heading"
        className="border-t border-[#09090B]/[0.08] pt-12"
      >
        <h2 id="quality-guide-heading" className="audience-heading max-w-2xl text-[#09090B]">
          {ds.tipsHeading}
        </h2>
        <div className="mt-6 divide-y divide-[#09090B]/[0.08] border-y border-[#09090B]/[0.08]">
          {ds.tips.map((tip, index) => {
            const ruleId = QUALITY_RULE_IDS[index] ?? '01';
            return (
              <details key={ruleId} data-quality-rule={ruleId} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <span className="block min-w-0">
                    <span className="block text-[17px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B]">
                      {tip.title}
                    </span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-[#52525B]">
                      {tip.summary}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F4F4F5] text-sm font-medium text-[#09090B] transition-transform duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[12px] bg-[#F4F4F5] p-4">
                    <p className="text-xs font-semibold text-[#09090B]">{ds.tipsGoodLabel}</p>
                    <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-[#09090B]">
                      {tip.good.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#09090B]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-[12px] border border-[#09090B]/[0.08] bg-white p-4">
                    <p className="text-xs font-semibold text-[#71717A]">{ds.tipsAvoidLabel}</p>
                    <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-[#52525B]">
                      {tip.avoid.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#71717A]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {/* E. Closing row */}
      <section
        data-buyer-preview-card
        className="flex flex-wrap items-center justify-between gap-5 rounded-[16px] bg-[#F4F4F5] p-6 sm:p-8"
      >
        <p className="max-w-xl text-sm font-medium leading-relaxed text-[#09090B]">
          {ds.closingBody}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <a href={creatorWorkspaceHref} className="audience-button-quiet max-w-full text-sm">
            {ds.primaryCta}
          </a>
          <a
            href={videoCatalogHref}
            className="inline-flex min-h-11 items-center text-sm font-medium text-[#09090B] underline underline-offset-4 transition-colors duration-[160ms] hover:opacity-70"
          >
            {ds.secondaryCta}
          </a>
        </div>
      </section>
    </div>
  );
}
