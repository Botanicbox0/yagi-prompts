'use client';

import { useEffect, useState } from 'react';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import type { Locale } from '@/lib/i18n/config';
import { TypographicPoster } from '@/components/prompts/poster';
import { cardAspect, cardAuthor, cardRatio } from '@/components/prompts/card-frame';
import {
  EDITORIAL_MOOD_OPTIONS,
  HERO_EDITORIAL_PRIORITY,
  pickHeroFeaturedTemplate,
  resolveTemplateMoods,
  type EditorialMoodId,
  type EditorialMoodOption,
} from '@/lib/prompts/sequence-curation';

export {
  EDITORIAL_MOOD_OPTIONS,
  HERO_EDITORIAL_PRIORITY,
  pickHeroFeaturedTemplate,
  resolveTemplateMoods,
  type EditorialMoodId,
  type EditorialMoodOption,
};

export interface SequenceDispatchProps {
  locale: Locale;
  hotVideos: readonly PromptCard[];
  imageSeries: readonly PromptCard[];
  cardSecondsPattern: string;
  cardAuthorPattern: string;
  cardAuthorAnonymous: string;
}

/**
 * Cosmos Sequence (`cosmos.so/sequence`) inspired editorial curation & mood discovery for personal TWINGS:
 * 1. "THIS WEEK IN TWINGS" weekly dispatch strip highlighting top trending video formats alongside
 *    5-shot editorial photo series right at the top so image templates are never buried at the bottom.
 * 2. Meaningful Editorial Mood Curator replacing vague "Cinematic" genre labels with user-centric
 *    protagonist worlds (Runway & High Fashion, 80s–90s Retro, Dream & Fantasy, Celeb Spotlight, 5-Shot Photo Series).
 */
export function SequenceDispatchSection({
  locale,
  hotVideos,
  imageSeries,
  cardSecondsPattern,
  cardAuthorPattern,
  cardAuthorAnonymous
}: SequenceDispatchProps) {
  const [activeMood, setActiveMood] = useState<EditorialMoodId>('all');
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  useEffect(() => {
    const videoRail = document.querySelector<HTMLElement>('[data-rail="video"]');
    const imageRail = document.querySelector<HTMLElement>('[data-rail="image"]');
    const allVideoLink = document.querySelector<HTMLElement>('[data-all-video]');
    const items = document.querySelectorAll<HTMLElement>('[data-prompt-item]');

    let matched = 0;
    for (const item of items) {
      const cardEl = item.querySelector<HTMLElement>('[data-prompt-card]');
      const slug = cardEl?.dataset.promptCard ?? '';
      const medium = (cardEl?.dataset.medium === 'image' ? 'image' : 'video') as 'video' | 'image';
      const moods = resolveTemplateMoods(slug, medium);
      const show = activeMood === 'all' || moods.includes(activeMood);
      item.hidden = !show;
      if (show) matched += 1;
    }

    if (videoRail) {
      const videoMatches = videoRail.querySelectorAll<HTMLElement>('[data-prompt-item]:not([hidden])').length;
      const emptyLine = videoRail.querySelector<HTMLElement>('[data-rail-filtered-empty]');
      if (emptyLine) emptyLine.hidden = videoMatches > 0 || activeMood === 'photo-series';
      if (activeMood === 'photo-series') {
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
      if (emptyLine) emptyLine.hidden = imageMatches > 0;
    }

    setVisibleCount(activeMood === 'all' ? null : matched);

    return () => {
      for (const item of items) item.hidden = false;
      if (videoRail) videoRail.style.display = '';
      if (allVideoLink) allVideoLink.style.display = '';
    };
  }, [activeMood]);

  const topVideos = hotVideos.slice(0, 3);
  const featuredImageSet = imageSeries[0] ?? null;
  const activeMoodObj =
    EDITORIAL_MOOD_OPTIONS.find((opt) => opt.id === activeMood) ?? EDITORIAL_MOOD_OPTIONS[0]!;

  return (
    <div data-sequence-editorial className="mb-12 space-y-10">
      {/* 1. THIS WEEK IN TWINGS — Cosmos Sequence Editorial Dispatch */}
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
                : 'THIS WEEK IN TWINGS · 이번 주 가장 핫한 에디토리얼 큐레이션'}
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

        {/* Asymmetric Sequence Magazine Spread: 3 Hot Video Dispatches + 1 Elevated 5-Shot Photo Series Spotlight */}
        <div className="mt-6 grid gap-5 lg:grid-cols-12">
          {/* Left 7 cols: Top 3 Hot Video Formats in an editorial numbered sequence */}
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-7">
            {topVideos.map((card, index) => {
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
                  className="group relative flex flex-col justify-between rounded-[20px] border border-hairline bg-[#F6F7F9]/75 p-3 transition-colors hover:border-[#3875C5]/45 hover:bg-white"
                >
                  <div>
                    <div className="mb-2 flex items-center justify-between font-mono text-[0.68rem] text-black/55 tabular-nums">
                      <span className="font-semibold text-[#3063A7]">0{index + 1} · HOT FILM</span>
                      <span>{cardAspect(card)}</span>
                    </div>
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[14px] bg-sky">
                      {card.poster ? (
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
                    <h3 className="mt-3 line-clamp-1 text-sm font-semibold tracking-[-0.01em] text-[#0E1013]">
                      <a
                        href={templateHref(locale, card.slug)}
                        className="outline-none after:absolute after:inset-0 after:rounded-[20px] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[#3875C5]"
                      >
                        {title}
                      </a>
                    </h3>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[0.7rem] text-black/55 tabular-nums">
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

          {/* Right 5 cols: Elevated 5-Shot Photo Series Spotlight (Solves Image Templates Being Buried) */}
          <div
            data-dispatch-image-spotlight
            className="flex flex-col justify-between rounded-[20px] border border-[#3875C5]/25 bg-[#F3F7FA] p-4 sm:p-5 lg:col-span-5"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8EFF7] px-2.5 py-1 font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase tabular-nums">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3875C5]" />
                  {locale === 'en' ? '5-SHOT PHOTO SERIES' : '5장 에디토리얼 화보 세트'}
                </span>
                <a
                  href={templatesHref(locale, 'image')}
                  data-dispatch-image-all
                  className="font-mono text-[0.7rem] font-medium text-[#3063A7] underline underline-offset-4 hover:text-[#0E1013]"
                >
                  {locale === 'en' ? 'All photo series ↗' : '화보 전체 보기 ↗'}
                </a>
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
                    <div className="mt-2 flex items-center justify-between px-1 font-mono text-[0.68rem] text-black/60 tabular-nums">
                      <span>
                        {locale === 'en'
                          ? 'FRAMES 01–05 · EDITORIAL CONTACT SHEET'
                          : 'FRAMES 01–05 · 5컷 연속 화보 패키지'}
                      </span>
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

      {/* 2. Meaningful Editorial Mood Curator (Replaces meaningless "Cinematic / Short film" tags) */}
      <div
        data-editorial-mood-curator
        className="rounded-[24px] border border-hairline bg-white p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-mono text-[0.68rem] font-medium tracking-[0.08em] text-[#3063A7] uppercase">
              {locale === 'en' ? 'CURATED BY MOOD & WORLD' : '분위기와 세계관으로 고르기'}
            </p>
            <h3 className="mt-1 text-base font-bold tracking-[-0.015em] text-[#0E1013]">
              {locale === 'en'
                ? 'What kind of scene do you want to star in today?'
                : '오늘 어떤 장면의 주인공이 되고 싶으신가요?'}
            </h3>
          </div>
          {visibleCount !== null && (
            <div className="flex items-center gap-3 font-mono text-xs text-black/60 tabular-nums">
              <span data-mood-count>
                {locale === 'en' ? `${visibleCount} formats` : `${visibleCount}개 포맷`}
              </span>
              <button
                type="button"
                data-mood-reset
                onClick={() => setActiveMood('all')}
                className="text-xs font-medium text-[#3063A7] underline underline-offset-4 hover:text-[#0E1013]"
              >
                {locale === 'en' ? 'Show all' : '전체 보기'}
              </button>
            </div>
          )}
        </div>

        <div
          role="group"
          aria-label={locale === 'en' ? 'Filter by editorial mood' : '분위기별 에디션 선택'}
          className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-x-visible"
        >
          {EDITORIAL_MOOD_OPTIONS.map((option) => {
            const isActive = activeMood === option.id;
            return (
              <button
                key={option.id}
                type="button"
                data-mood-pill={option.id}
                aria-pressed={isActive}
                onClick={() => setActiveMood(option.id)}
                className={[
                  'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3875C5]',
                  isActive
                    ? 'border-[#3875C5] bg-[#3875C5] text-white'
                    : 'border-hairline bg-[#F6F7F9] text-[#0E1013] hover:border-[#3875C5]/45 hover:bg-[#E8EFF7]/60'
                ].join(' ')}
              >
                <span
                  className={[
                    'font-mono text-[0.68rem] tabular-nums',
                    isActive ? 'text-white/85' : 'text-[#3063A7]'
                  ].join(' ')}
                >
                  {option.indexLabel}
                </span>
                <span>{locale === 'en' ? option.labelEn : option.labelKo}</span>
              </button>
            );
          })}
        </div>

        <p
          data-mood-description={activeMood}
          className="mt-3 text-xs leading-relaxed text-black/65"
        >
          {locale === 'en' ? activeMoodObj.descEn : activeMoodObj.descKo}
        </p>

        <div
          data-direct-scene-door
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#3875C5]/20 bg-[#F3F7FA] px-4 py-3"
        >
          <p className="text-xs leading-relaxed text-[#0E1013]">
            <span className="font-semibold text-[#3063A7]">
              {locale === 'en' ? 'DIRECT SCENE · ' : '직접 연출 · '}
            </span>
            {locale === 'en'
              ? 'Have your own reference video? Cast your face in it and publish the finished scene as your own template.'
              : '따로 찍어보고 싶은 레퍼런스 영상이 있나요? 내 얼굴로 연출한 뒤 그대로 내 템플릿으로 등판시킬 수 있습니다.'}
          </p>
          <a
            href={`/${locale}/direct`}
            data-direct-scene-link
            className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-[#3063A7] shadow-xs transition-colors hover:bg-[#3875C5] hover:text-white"
          >
            {locale === 'en' ? 'Direct Your Scene →' : '직접 연출 & 템플릿 등판 보기 →'}
          </a>
        </div>
      </div>
    </div>
  );
}
