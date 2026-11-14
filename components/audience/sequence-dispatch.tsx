'use client';

import { useEffect, useState } from 'react';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionaries';
import { isForSale } from '@/lib/twings/products';
import { TypographicPoster } from '@/components/prompts/poster';
import { cardAuthor, cardRatio } from '@/components/prompts/card-frame';
import {
  EDITORIAL_MOOD_OPTIONS,
  HERO_EDITORIAL_PRIORITY,
  pickHeroFeaturedTemplate,
  resolveDefaultMediumForPlan,
  resolveTemplateMoods,
  type EditorialMoodId,
  type EditorialMoodOption,
  type GalleryMediumTab,
  type ViewerPlanTier,
} from '@/lib/prompts/sequence-curation';

export {
  EDITORIAL_MOOD_OPTIONS,
  HERO_EDITORIAL_PRIORITY,
  pickHeroFeaturedTemplate,
  resolveDefaultMediumForPlan,
  resolveTemplateMoods,
  type EditorialMoodId,
  type EditorialMoodOption,
  type GalleryMediumTab,
  type ViewerPlanTier,
};

export interface SequenceDispatchProps {
  locale: Locale;
  hotVideos: readonly PromptCard[];
  imageSeries: readonly PromptCard[];
  cardSecondsPattern: string;
  cardAuthorPattern: string;
  cardAuthorAnonymous: string;
  initialPlanTier?: ViewerPlanTier;
  copy?: Dictionary['creatorJourney']['sequenceDispatch'];
}

/**
 * Editorial curation & mood discovery for personal TWINGS:
 * 1. Weekly dispatch strip with auto-playing looping films alongside the 5-shot editorial photo series spotlight.
 * 2. Instant Medium Switcher (`전체` / `영상` / `이미지`) so users can flip directly to Image Templates at the top.
 * 3. Meaningful Editorial Mood Curator + `나만의 영상 만들기` entry door.
 */
export function SequenceDispatchSection({
  locale,
  hotVideos,
  imageSeries,
  cardSecondsPattern,
  cardAuthorPattern,
  cardAuthorAnonymous,
  initialPlanTier = 'standard',
  copy: copyProp
}: SequenceDispatchProps) {
  const copy = copyProp ?? getDictionary(locale).creatorJourney.sequenceDispatch;
  const [planTier, setPlanTier] = useState<ViewerPlanTier>(initialPlanTier);
  const [activeMedium, setActiveMedium] = useState<GalleryMediumTab>(() =>
    resolveDefaultMediumForPlan(initialPlanTier)
  );
  const [activeMood, setActiveMood] = useState<EditorialMoodId>('all');
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  const handleSelectMedium = (medium: GalleryMediumTab) => {
    setActiveMedium(medium);
    if (medium === 'image' && activeMood !== 'all') {
      setActiveMood('photo-series');
    } else if (medium === 'video' && activeMood === 'photo-series') {
      setActiveMood('all');
    } else if (medium === 'all' && activeMood === 'photo-series') {
      setActiveMood('all');
    }
  };

  const handleSelectMood = (mood: EditorialMoodId) => {
    setActiveMood(mood);
    if (mood === 'photo-series') {
      setActiveMedium('image');
    } else if (activeMedium === 'image' && mood !== 'all') {
      setActiveMedium('all');
    }
  };

  useEffect(() => {
    const videoRail = document.querySelector<HTMLElement>('[data-rail="video"]');
    const imageRail = document.querySelector<HTMLElement>('[data-rail="image"]');
    const allVideoLink = document.querySelector<HTMLElement>('[data-all-video]')?.parentElement ?? document.querySelector<HTMLElement>('[data-all-video]');
    const items = document.querySelectorAll<HTMLElement>('[data-prompt-item]');

    const effectiveImageOnly = activeMedium === 'image' || activeMood === 'photo-series';
    const effectiveVideoOnly = activeMedium === 'video';

    let matched = 0;
    for (const item of items) {
      const cardEl = item.querySelector<HTMLElement>('[data-prompt-card]');
      const slug = cardEl?.dataset.promptCard ?? '';
      const medium = (cardEl?.dataset.medium === 'image' ? 'image' : 'video') as 'video' | 'image';
      const moods = resolveTemplateMoods(slug, medium);

      const mediumMatch =
        (effectiveImageOnly && medium === 'image') ||
        (effectiveVideoOnly && medium === 'video') ||
        (!effectiveImageOnly && !effectiveVideoOnly);

      const moodMatch =
        activeMood === 'all' ||
        activeMood === 'photo-series' ||
        moods.includes(activeMood);

      const show = mediumMatch && moodMatch;
      item.hidden = !show;
      if (show) matched += 1;
    }

    if (videoRail) {
      const videoMatches = videoRail.querySelectorAll<HTMLElement>('[data-prompt-item]:not([hidden])').length;
      const emptyLine = videoRail.querySelector<HTMLElement>('[data-rail-filtered-empty]');
      if (emptyLine) emptyLine.hidden = videoMatches > 0 || effectiveImageOnly;
      if (effectiveImageOnly) {
        videoRail.style.display = 'none';
        if (allVideoLink) allVideoLink.style.display = 'none';
      } else {
        videoRail.style.display = '';
        if (allVideoLink) allVideoLink.style.display = '';
      }
    }

    if (imageRail) {
      const imageMatches = imageRail.querySelectorAll<HTMLElement>('[data-prompt-item]:not([hidden])').length;
      const emptyLine = imageRail.querySelector<HTMLElement>('[data-rail-filtered-empty]');
      if (emptyLine) emptyLine.hidden = imageMatches > 0 || effectiveVideoOnly;
      if (effectiveVideoOnly) {
        imageRail.style.display = 'none';
      } else {
        imageRail.style.display = '';
      }
    }

    setVisibleCount(
      activeMood === 'all' && activeMedium === 'all' ? null : matched
    );

    return () => {
      for (const item of items) item.hidden = false;
      if (videoRail) videoRail.style.display = '';
      if (imageRail) imageRail.style.display = '';
      if (allVideoLink) allVideoLink.style.display = '';
    };
  }, [activeMood, activeMedium]);

  const topVideos = hotVideos.slice(0, 3);
  const sortedImageSeries = [...imageSeries].sort((a, b) => Number(isForSale(b)) - Number(isForSale(a)));
  const featuredImageSet = sortedImageSeries[0] ?? null;
  const secondarySeries = sortedImageSeries.filter((s) => s.slug !== featuredImageSet?.slug);
  const activeMoodObj =
    EDITORIAL_MOOD_OPTIONS.find((opt) => opt.id === activeMood) ?? EDITORIAL_MOOD_OPTIONS[0]!;
  const imageFirst = planTier === 'image_only' || activeMedium === 'image';

  return (
    <div data-sequence-editorial data-plan-tier={planTier} className="mb-10 space-y-8">
      {/* 1. THIS WEEK IN TWINGS — Editorial Dispatch (Auto-playing films, clean frameless top) */}
      <section
        data-weekly-dispatch
        aria-labelledby="weekly-dispatch-heading"
        className="bg-white"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#09090B]/[0.08] pb-5">
          <div>
            <p className="text-[13px] font-medium text-[#71717A]">
              {copy.weeklyEyebrow}
            </p>
            <h2
              id="weekly-dispatch-heading"
              className="mt-2 font-display text-[clamp(1.45rem,2.6vw,2.15rem)] leading-[1.08] font-bold tracking-[-0.025em] text-[#09090B]"
            >
              {copy.weeklyHeading}
            </h2>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-[#52525B]">
            {copy.weeklySubcopy}
          </p>
        </div>

        {/* Asymmetric Sequence Magazine Spread: 3 Auto-Playing Video Dispatches + 1 Elevated 5-Shot Photo Series Spotlight */}
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-12">
          {/* 3 Featured Video Formats — Clean frameless media + auto-playing looping video */}
          <div
            className={[
              'grid gap-4 sm:grid-cols-3 lg:col-span-7',
              imageFirst ? 'lg:order-2' : 'lg:order-1'
            ].join(' ')}
          >
            {topVideos.map((card) => {
              const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
              const author = cardAuthor(card);
              const seconds =
                card.medium === 'video' && card.runtimeSeconds && card.runtimeSeconds > 0
                  ? card.runtimeSeconds
                  : null;
              return (
                <article
                  key={card.slug}
                  data-dispatch-card={card.slug}
                  data-dispatch-kind="video"
                  className="group relative flex flex-col"
                >
                  <div>
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[12px] bg-[#F4F4F5]">
                      {card.video ? (
                        <video
                          data-dispatch-video={card.slug}
                          src={card.video.src}
                          poster={card.poster?.src}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02]"
                        />
                      ) : card.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element -- public catalog poster
                        <img
                          src={card.poster.src}
                          alt={title}
                          width={card.poster.w}
                          height={card.poster.h}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02]"
                        />
                      ) : (
                        <TypographicPoster
                          title={card.title}
                          slug={card.slug}
                          kicker=""
                          ratio={String(cardRatio(card))}
                        />
                      )}
                    </div>
                    <h3 className="mt-2.5 line-clamp-1 text-sm font-semibold tracking-[-0.01em] text-[#09090B]">
                      <a
                        href={templateHref(locale, card.slug)}
                        className="outline-none after:absolute after:inset-0 after:rounded-[12px] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[#FF58AE]"
                      >
                        {title}
                      </a>
                    </h3>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[#52525B] tabular-nums">
                    {seconds !== null && (
                      <span>{cardSecondsPattern.replace('{seconds}', String(seconds))}</span>
                    )}
                    {author && (
                      <span>
                        ·{' '}
                        {author.handle
                          ? cardAuthorPattern.replace('{handle}', author.handle)
                          : cardAuthorAnonymous}
                      </span>
                    )}
                  </p>
                </article>
              );
            })}
          </div>

          {/* 5-Shot Photo Series Spotlight (Moves to Left #1 position when Image-Only plan or Image tab is active) */}
          <div
            data-dispatch-image-spotlight
            data-image-priority={imageFirst ? 'first' : 'second'}
            className={[
              'flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-5 lg:col-span-5',
              imageFirst ? 'lg:order-1' : 'lg:order-2'
            ].join(' ')}
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#52525B]">
                    {copy.spotlightBadge}
                  </span>
                  {featuredImageSet && !isForSale(featuredImageSet) && (
                    <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#71717A]">
                      {copy.spotlightSoonBadge}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  data-dispatch-image-switch
                  onClick={() => handleSelectMedium('image')}
                  className="text-xs font-semibold text-[#CC1573] underline underline-offset-4 hover:text-[#09090B]"
                >
                  {copy.spotlightSwitchCta}
                </button>
              </div>

              {featuredImageSet ? (
                <div className="mt-3">
                  <h3 className="text-base font-bold tracking-[-0.015em] text-[#09090B]">
                    <a
                      href={templateHref(locale, featuredImageSet.slug)}
                      data-dispatch-image-featured={featuredImageSet.slug}
                      className="hover:underline"
                    >
                      {locale === 'ko' && featuredImageSet.titleKo
                        ? featuredImageSet.titleKo
                        : featuredImageSet.title}
                    </a>
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[#52525B]">
                    {copy.spotlightDesc}
                  </p>

                  {/* Contact-sheet preview strip (shows multi-frame nature of Image Series) */}
                  <a
                    href={templateHref(locale, featuredImageSet.slug)}
                    className="mt-3.5 block transition-opacity hover:opacity-95"
                  >
                    {featuredImageSet.gallery && featuredImageSet.gallery.length >= 2 ? (
                      <div className="grid grid-cols-3 gap-1.5">
                        {featuredImageSet.gallery.slice(0, 3).map((frame, idx) => (
                          <div
                            key={`${frame.src}-${idx}`}
                            className="aspect-[4/5] overflow-hidden rounded-[12px] bg-white"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- public gallery frame */}
                            <img
                              src={frame.src}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    ) : featuredImageSet.poster ? (
                      <div className="aspect-[16/10] w-full overflow-hidden rounded-[12px] bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element -- public poster */}
                        <img
                          src={featuredImageSet.poster.src}
                          alt={featuredImageSet.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex items-center justify-between text-xs text-[#52525B] tabular-nums">
                      <span>
                        {copy.spotlightCountLabel}
                      </span>
                      <span className="font-semibold text-[#09090B]">
                        {copy.spotlightOpenCta}
                      </span>
                    </div>
                  </a>
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-[#52525B]">
                  {copy.spotlightFallback}
                </p>
              )}
            </div>

            {secondarySeries.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#09090B]/[0.08] pt-3">
                <span className="text-xs text-[#71717A]">
                  {copy.moreSeriesLabel}
                </span>
                {secondarySeries.slice(0, 2).map((series) => (
                  <a
                    key={series.slug}
                    href={templateHref(locale, series.slug)}
                    className="inline-flex min-h-8 items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-[#09090B] transition-colors hover:bg-[#09090B] hover:text-white"
                  >
                    {locale === 'ko' && series.titleKo ? series.titleKo : series.title} ↗
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Instant Medium Switcher & Mood Curator */}
      <div
        data-editorial-mood-curator
        className="border-t border-[#09090B]/[0.08] pt-8"
      >
        <div
          data-gallery-medium-switcher
          className="flex flex-wrap items-center justify-between gap-3 border-b border-[#09090B]/[0.08] pb-4"
        >
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={copy.tabAriaLabel}>
            <button
              type="button"
              role="tab"
              data-medium-tab="all"
              aria-selected={activeMedium === 'all'}
              onClick={() => handleSelectMedium('all')}
              className={[
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                activeMedium === 'all'
                  ? 'border-[#09090B] bg-[#09090B] text-white'
                  : 'border-[#09090B]/[0.08] bg-[#F4F4F5] text-[#09090B] hover:border-[#09090B]/[0.16]'
              ].join(' ')}
            >
              <span>{copy.tabAll}</span>
              <span className="font-mono text-[0.72rem] opacity-75 tabular-nums">
                {hotVideos.length + imageSeries.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              data-medium-tab="video"
              aria-selected={activeMedium === 'video'}
              onClick={() => handleSelectMedium('video')}
              className={[
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                activeMedium === 'video'
                  ? 'border-[#09090B] bg-[#09090B] text-white'
                  : 'border-[#09090B]/[0.08] bg-[#F4F4F5] text-[#09090B] hover:border-[#09090B]/[0.16]'
              ].join(' ')}
            >
              <span>{copy.tabVideo}</span>
              <span className="font-mono text-[0.72rem] opacity-75 tabular-nums">
                {hotVideos.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              data-medium-tab="image"
              aria-selected={activeMedium === 'image'}
              onClick={() => handleSelectMedium('image')}
              className={[
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                activeMedium === 'image'
                  ? 'border-[#09090B] bg-[#09090B] text-white'
                  : 'border-[#09090B]/[0.08] bg-[#F4F4F5] text-[#09090B] hover:border-[#09090B]/[0.16]'
              ].join(' ')}
            >
              <span>{copy.tabImage}</span>
              <span className="font-mono text-[0.72rem] opacity-85 tabular-nums">
                {imageSeries.length}
              </span>
            </button>
          </div>
        </div>

        {/* Second Row: Meaningful Editorial Mood Curator */}
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium text-[#71717A]">
              {copy.moodEyebrow}
            </p>
            <h3 className="mt-1 text-base font-bold tracking-[-0.015em] text-[#09090B]">
              {copy.moodHeading}
            </h3>
          </div>
          {visibleCount !== null && (
            <div className="flex items-center gap-3 text-xs text-[#52525B] tabular-nums">
              <span data-mood-count>
                {copy.moodCountPattern.replace('{count}', String(visibleCount))}
              </span>
              <button
                type="button"
                data-mood-reset
                onClick={() => {
                  setActiveMood('all');
                  setActiveMedium('all');
                  setPlanTier(initialPlanTier);
                }}
                className="text-xs font-medium text-[#09090B] underline underline-offset-4 hover:opacity-70"
              >
                {copy.moodReset}
              </button>
            </div>
          )}
        </div>

        <div
          role="group"
          aria-label={copy.moodGroupLabel}
          className="mt-3.5 flex items-center gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-x-visible"
        >
          {EDITORIAL_MOOD_OPTIONS.map((option) => {
            const isActive = activeMood === option.id;
            return (
              <button
                key={option.id}
                type="button"
                data-mood-pill={option.id}
                aria-pressed={isActive}
                onClick={() => handleSelectMood(option.id)}
                className={[
                  'inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF58AE]',
                  isActive
                    ? 'border-[#09090B] bg-[#09090B] text-white'
                    : 'border-[#09090B]/[0.08] bg-[#F4F4F5] text-[#09090B] hover:border-[#09090B]/[0.16] hover:bg-white'
                ].join(' ')}
              >
                <span>{locale === 'en' ? option.labelEn : option.labelKo}</span>
              </button>
            );
          })}
        </div>

        <p
          data-mood-description={activeMood}
          className="mt-3 text-xs leading-relaxed text-[#52525B]"
        >
          {locale === 'en' ? activeMoodObj.descEn : activeMoodObj.descKo}
        </p>

        {/* 3. Make Your Own Video & Publish as a Template Maker */}
        <div
          data-direct-scene-door
          className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[16px] bg-[#F4F4F5] px-5 py-4"
        >
          <div className="max-w-2xl">
            <p className="text-[13px] font-medium text-[#71717A]">
              {copy.directDoorEyebrow}
            </p>
            <p
              className="mt-1 text-sm font-bold tracking-[-0.01em] text-[#09090B]"
              style={{ wordBreak: 'keep-all' }}
            >
              {copy.directDoorBody}
            </p>
          </div>
          <a
            href={`/${locale}/direct`}
            data-direct-scene-link
            className="audience-button-quiet shrink-0 min-h-10 px-4 text-xs"
          >
            {copy.directDoorCta}
          </a>
        </div>
      </div>
    </div>
  );
}
