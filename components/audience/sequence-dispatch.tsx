'use client';

import { useEffect, useState } from 'react';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import type { Locale } from '@/lib/i18n/config';
import { TypographicPoster } from '@/components/prompts/poster';
import { cardAuthor, cardRatio } from '@/components/prompts/card-frame';
import {
  HERO_EDITORIAL_PRIORITY,
  HOME_FILTER_IDS,
  matchesHomeFilter,
  pickHeroFeaturedTemplate,
  resolveDefaultFilterForPlan,
  resolveDefaultMediumForPlan,
  resolveTemplateMoods,
  type EditorialMoodId,
  type GalleryMediumTab,
  type HomeFilterId,
  type ViewerPlanTier,
} from '@/lib/prompts/sequence-curation';

export {
  HERO_EDITORIAL_PRIORITY,
  HOME_FILTER_IDS,
  matchesHomeFilter,
  pickHeroFeaturedTemplate,
  resolveDefaultFilterForPlan,
  resolveDefaultMediumForPlan,
  resolveTemplateMoods,
  type EditorialMoodId,
  type GalleryMediumTab,
  type HomeFilterId,
  type ViewerPlanTier,
};

export interface HomeFilterLabels {
  label: string;
  all: string;
  video: string;
  image: string;
  runway: string;
  retro: string;
  fantasy: string;
  celeb: string;
}

const FILTER_LABEL_KEY: Record<HomeFilterId, keyof Omit<HomeFilterLabels, 'label'>> = {
  all: 'all',
  video: 'video',
  image: 'image',
  'runway-editorial': 'runway',
  'retro-youth': 'retro',
  'dream-fantasy': 'fantasy',
  'celeb-spotlight': 'celeb'
};

export interface SequenceDispatchProps {
  locale: Locale;
  hotVideos: readonly PromptCard[];
  imageSeries: readonly PromptCard[];
  cardSecondsPattern: string;
  cardAuthorPattern: string;
  cardAuthorAnonymous: string;
  filterLabels: HomeFilterLabels;
  initialPlanTier?: ViewerPlanTier;
}

/**
 * Cosmos Sequence (`cosmos.so/sequence`) inspired editorial curation & mood discovery for personal TWINGS:
 * 1. "THIS WEEK IN TWINGS" weekly dispatch strip with auto-playing looping films (no redundant "01 HOT FILM" header text)
 *    alongside the 5-shot editorial photo series spotlight.
 * 2. One chip row (all · video · photos · four moods) that filters the rails below; the "make your own"
 *    door sits after the rails in the page itself.
 */
export function SequenceDispatchSection({
  locale,
  hotVideos,
  imageSeries,
  cardSecondsPattern,
  cardAuthorPattern,
  cardAuthorAnonymous,
  filterLabels,
  initialPlanTier = 'standard'
}: SequenceDispatchProps) {
  const planTier = initialPlanTier;
  const [activeFilter, setActiveFilter] = useState<HomeFilterId>(() =>
    resolveDefaultFilterForPlan(initialPlanTier)
  );

  useEffect(() => {
    const videoRail = document.querySelector<HTMLElement>('[data-rail="video"]');
    const imageRail = document.querySelector<HTMLElement>('[data-rail="image"]');
    const allVideoLink = document.querySelector<HTMLElement>('[data-all-video]')?.parentElement ?? document.querySelector<HTMLElement>('[data-all-video]');
    const items = document.querySelectorAll<HTMLElement>('[data-prompt-item]');

    const effectiveImageOnly = activeFilter === 'image';
    const effectiveVideoOnly = activeFilter === 'video';

    for (const item of items) {
      const cardEl = item.querySelector<HTMLElement>('[data-prompt-card]');
      const slug = cardEl?.dataset.promptCard ?? '';
      const medium = (cardEl?.dataset.medium === 'image' ? 'image' : 'video') as 'video' | 'image';
      item.hidden = !matchesHomeFilter(activeFilter, slug, medium);
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

    return () => {
      for (const item of items) item.hidden = false;
      if (videoRail) videoRail.style.display = '';
      if (imageRail) imageRail.style.display = '';
      if (allVideoLink) allVideoLink.style.display = '';
    };
  }, [activeFilter]);

  const topVideos = hotVideos.slice(0, 3);
  const featuredImageSet = imageSeries[0] ?? null;
  const imageFirst = planTier === 'image_only' || activeFilter === 'image';

  return (
    <div data-sequence-editorial data-plan-tier={planTier} className="mb-10 space-y-8">
      {/* 1. THIS WEEK IN TWINGS — Cosmos Sequence Editorial Dispatch (Auto-playing films, clean frameless top) */}
      <section
        data-weekly-dispatch
        aria-labelledby="weekly-dispatch-heading"
        className="rounded-[24px] border border-hairline bg-white p-6 shadow-[0_18px_42px_-28px_rgba(12,15,20,0.12)] sm:p-8 lg:p-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-5">
          <div>
            <p className="font-mono text-[0.72rem] font-medium tracking-[0.08em] text-[#3063A7] uppercase tabular-nums">
              {locale === 'en'
                ? 'THIS WEEK IN TWINGS · WEEKLY CURATED DISPATCH'
                : 'THIS WEEK IN TWINGS · 이번 주 에디토리얼 큐레이션'}
            </p>
            <h2
              id="weekly-dispatch-heading"
              className="mt-2 font-display text-[clamp(1.45rem,2.6vw,2.15rem)] leading-[1.08] font-black tracking-[-0.025em] text-[#0E1013]"
            >
              {locale === 'en'
                ? 'Scenes everyone is stepping into right now'
                : '지금 가장 많이 주인공이 되는 장면'}
            </h2>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-black/60">
            {locale === 'en'
              ? 'Selected for photographic realism, lighting, and natural facial likeness — featuring both short films and 5-shot editorial photo series.'
              : '실제 사진 같은 조명과 자연스러운 얼굴 닮음새로 이번 주 가장 많이 선택받은 대표 필름과 5장 화보집입니다.'}
          </p>
        </div>

        {/* Asymmetric Sequence Magazine Spread: 3 Auto-Playing Video Dispatches + 1 Elevated 5-Shot Photo Series Spotlight */}
        <div className="mt-6 grid gap-5 lg:grid-cols-12">
          {/* 3 Featured Video Formats — Clean top edge (no "01 HOT FILM" label) & auto-playing looping video */}
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
                  className="group relative flex flex-col justify-between rounded-[20px] border border-hairline bg-[#F6F7F9]/75 p-2.5 transition-colors hover:border-[#3875C5]/45 hover:bg-white"
                >
                  <div>
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[14px] bg-sky">
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
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                      ) : card.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element -- public catalog poster
                        <img
                          src={card.poster.src}
                          alt={title}
                          width={card.poster.w}
                          height={card.poster.h}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
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
                    <h3 className="mt-2.5 line-clamp-1 px-0.5 text-sm font-semibold tracking-[-0.01em] text-[#0E1013]">
                      <a
                        href={templateHref(locale, card.slug)}
                        className="outline-none after:absolute after:inset-0 after:rounded-[20px] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[#3875C5]"
                      >
                        {title}
                      </a>
                    </h3>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 px-0.5 font-mono text-[0.7rem] text-black/55 tabular-nums">
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
              'flex flex-col justify-between rounded-[20px] border border-[#3875C5]/25 bg-[#F3F7FA] p-4 sm:p-5 lg:col-span-5',
              imageFirst ? 'lg:order-1' : 'lg:order-2'
            ].join(' ')}
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8EFF7] px-2.5 py-1 font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase tabular-nums">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3875C5]" />
                  {locale === 'en' ? '5-SHOT PHOTO SERIES' : '5장 에디토리얼 화보 세트'}
                </span>
                <button
                  type="button"
                  data-dispatch-image-switch
                  onClick={() => setActiveFilter('image')}
                  className="font-mono text-[0.7rem] font-semibold text-[#3063A7] underline underline-offset-4 hover:text-[#0E1013]"
                >
                  {locale === 'en' ? 'Switch to all photo series ↓' : '화보 템플릿으로 바로 전환 ↓'}
                </button>
              </div>

              {featuredImageSet ? (
                <div className="mt-3">
                  <h3 className="text-base font-bold tracking-[-0.015em] text-[#0E1013]">
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
                  <p className="mt-1 text-xs leading-relaxed text-black/65">
                    {locale === 'en'
                      ? 'One front selfie creates a cohesive 5-frame magazine editorial shoot with varying angles and poses.'
                      : '정면 셀카 한 장으로 구도와 포즈가 다른 5장의 하이패션 매거진 화보 세트를 한 번에 완성합니다.'}
                  </p>

                  {/* Contact-sheet preview strip (shows multi-frame nature of Image Series) */}
                  <a
                    href={templateHref(locale, featuredImageSet.slug)}
                    className="mt-3.5 block overflow-hidden rounded-[16px] border border-white/80 bg-white p-2 shadow-sm transition-transform hover:scale-[1.01]"
                  >
                    {featuredImageSet.gallery && featuredImageSet.gallery.length >= 2 ? (
                      <div className="grid grid-cols-3 gap-1.5">
                        {featuredImageSet.gallery.slice(0, 3).map((frame, idx) => (
                          <div
                            key={`${frame.src}-${idx}`}
                            className="aspect-[4/5] overflow-hidden rounded-[10px] bg-sky"
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
                      <div className="aspect-[16/10] w-full overflow-hidden rounded-[12px] bg-sky">
                        {/* eslint-disable-next-line @next/next/no-img-element -- public poster */}
                        <img
                          src={featuredImageSet.poster.src}
                          alt={featuredImageSet.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center justify-end px-1 text-[0.72rem]">
                      <span className="font-semibold text-[#3063A7]">
                        {locale === 'en' ? 'Open series →' : '화보 세트 열기 →'}
                      </span>
                    </div>
                  </a>
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-black/65">
                  {locale === 'en'
                    ? 'Explore multi-shot editorial photo templates crafted for natural facial likeness.'
                    : '내 얼굴 그대로 5장의 화보를 완성하는 이미지 에디션을 만나보세요.'}
                </p>
              )}
            </div>

            {imageSeries.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#3875C5]/15 pt-3">
                <span className="font-mono text-[0.66rem] text-black/55 uppercase">
                  {locale === 'en' ? 'MORE SERIES:' : '다른 화보 세트:'}
                </span>
                {imageSeries.slice(1, 3).map((series) => (
                  <a
                    key={series.slug}
                    href={templateHref(locale, series.slug)}
                    className="inline-flex min-h-8 items-center rounded-full border border-hairline bg-white px-3 py-1 text-xs font-medium text-[#0E1013] transition-colors hover:border-[#3875C5] hover:text-[#3063A7]"
                  >
                    {locale === 'ko' && series.titleKo ? series.titleKo : series.title} ↗
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div
        role="group"
        aria-label={filterLabels.label}
        data-home-filter
        className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0"
      >
        {HOME_FILTER_IDS.map((id) => {
          const isActive = activeFilter === id;
          return (
            <button
              key={id}
              type="button"
              data-home-filter-chip={id}
              aria-pressed={isActive}
              onClick={() => setActiveFilter(id)}
              className={[
                'inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3875C5]',
                isActive
                  ? 'border-[#3875C5] bg-[#3875C5] text-white'
                  : 'border-hairline bg-white text-[#0E1013] hover:border-[#3875C5]/45'
              ].join(' ')}
            >
              {filterLabels[FILTER_LABEL_KEY[id]]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
