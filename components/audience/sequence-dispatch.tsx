'use client';

import { useEffect, useState } from 'react';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import type { Locale } from '@/lib/i18n/config';
import { TypographicPoster } from '@/components/prompts/poster';
import { cardAspect, cardAuthor, cardRatio } from '@/components/prompts/card-frame';

export type EditorialMoodId =
  | 'all'
  | 'runway-editorial'
  | 'retro-youth'
  | 'dream-fantasy'
  | 'celeb-spotlight'
  | 'photo-series';

export interface EditorialMoodOption {
  id: EditorialMoodId;
  indexLabel: string;
  labelKo: string;
  labelEn: string;
  descKo: string;
  descEn: string;
}

export const EDITORIAL_MOOD_OPTIONS: readonly EditorialMoodOption[] = [
  {
    id: 'all',
    indexLabel: 'ALL',
    labelKo: '전체 에디션',
    labelEn: 'All Editions',
    descKo: '이번 주 추천순 전체 영상 포맷과 5장 화보집을 한눈에 둘러봅니다.',
    descEn: 'Browse all curated video formats and 5-shot editorial photo series.'
  },
  {
    id: 'runway-editorial',
    indexLabel: '01',
    labelKo: '런웨이 & 하이패션',
    labelEn: 'Runway & High Fashion',
    descKo: '패션쇼 프레스 라인, 도심 스트릿 몽타주, 하이주얼리와 웨딩 화보 주인공이 되는 장면',
    descEn: 'Step into front-row runway arrivals, city fashion montages, and couture editorials.'
  },
  {
    id: 'retro-youth',
    indexLabel: '02',
    labelKo: '8090 레트로 & 청춘 기록',
    labelEn: '80s–90s Retro & Youth',
    descKo: '90년대 서울 길거리 인터뷰, 80년대 도쿄 하이틴 스타, 필름 캠코더 감성의 청춘 장면',
    descEn: '1990s Seoul street interviews, 80s teen icons, and analog camcorder nostalgia.'
  },
  {
    id: 'dream-fantasy',
    indexLabel: '03',
    labelKo: '몽환 & 시네마 판타지',
    labelEn: 'Dream & Cinema Fantasy',
    descKo: '어항 속 금붕어 백일몽, 발레리나 렌즈 포털, 동화·무협 세계관의 초현실 시네마',
    descEn: 'Surreal aquarium daydreams, lens portals, fairytales, and cinematic fantasy worlds.'
  },
  {
    id: 'celeb-spotlight',
    indexLabel: '04',
    labelKo: '셀럽 & 뷰티 캠페인',
    labelEn: 'Celeb & Beauty Spotlight',
    descKo: '글로벌 뷰티 광고의 메인 모델이나 매거진 커버 주인공처럼 빛나는 클로즈업',
    descEn: 'Star in luxury beauty commercials, magazine covers, and flash-lit press lines.'
  },
  {
    id: 'photo-series',
    indexLabel: '05',
    labelKo: '5장 화보집 (이미지)',
    labelEn: '5-Shot Photo Series',
    descKo: '셀카 한 장으로 한 번에 5장의 화보 세트를 완성하는 에디토리얼 사진 컬렉션',
    descEn: 'Turn one selfie into a complete 5-frame editorial photography series.'
  }
] as const;

const RUNWAY_SLUGS = new Set([
  'city-fashion-montage',
  'fashion-show-arrival',
  'my-tiffany-s-moment',
  'dollhouse-fashion-salon',
  'the-signature-piece',
  'bridal-editorial-5-shots'
]);

const RETRO_SLUGS = new Set([
  '90s-seoul-interview',
  '80s-roller-disco',
  'japanese-teen-star-in-the-1980s',
  'tokyo-s-new-teen-star-86',
  'memory-film',
  'pink-signal-flip-phone',
  'you-are-a-prom-queen'
]);

const DREAM_SLUGS = new Set([
  'aquarium-goldfish',
  'lens-portal-tutu',
  'alice-in-wonderland',
  'chinese-wuxia-heroine',
  'giant-daydream',
  'gothic-doll-claw-machine',
  'the-three-princes',
  'dobby-is-free',
  'dark-halloween-image-set-5-images'
]);

const CELEB_SLUGS = new Set([
  'star-in-a-virtual-beauty-ad',
  'summer-peach-photoshoot',
  'fashion-show-arrival',
  'my-tiffany-s-moment',
  'bridal-editorial-5-shots'
]);

/**
 * Priority order for the personal home hero showcase video.
 * Replaces the legacy rank-#21 `you-are-a-prom-queen` with top-ranked editorial films from
 * `RECOMMENDED_VIDEO_ORDER` (`city-fashion-montage` 4:3 editorial montage, `aquarium-goldfish`,
 * `fashion-show-arrival`, `my-tiffany-s-moment`).
 */
export const HERO_EDITORIAL_PRIORITY = [
  'city-fashion-montage',
  'aquarium-goldfish',
  'fashion-show-arrival',
  'my-tiffany-s-moment',
  'lens-portal-tutu'
] as const;

export function pickHeroFeaturedTemplate(
  cards: readonly PromptCard[]
): PromptCard | undefined {
  const studioVideo = cards.filter((card) => card.origin !== 'maker');
  for (const slug of HERO_EDITORIAL_PRIORITY) {
    const match = studioVideo.find((card) => card.slug === slug && card.video && card.poster);
    if (match) return match;
  }
  for (const slug of HERO_EDITORIAL_PRIORITY) {
    const match = studioVideo.find((card) => card.slug === slug) ?? cards.find((card) => card.slug === slug);
    if (match) return match;
  }
  return (
    studioVideo.find((card) => card.video && card.poster) ??
    studioVideo[0] ??
    cards[0]
  );
}

/**
 * Classifies any template into meaningful, user-centric editorial moods instead of generic
 * production tags like "cinematic".
 */
export function resolveTemplateMoods(
  slug: string,
  medium: 'video' | 'image' = 'video'
): EditorialMoodId[] {
  const moods: EditorialMoodId[] = ['all'];
  if (medium === 'image' || slug.includes('image') || slug.includes('shots')) {
    moods.push('photo-series');
  }
  if (RUNWAY_SLUGS.has(slug) || /fashion|runway|tiffany|bridal|dress|suit/i.test(slug)) {
    moods.push('runway-editorial');
  }
  if (RETRO_SLUGS.has(slug) || /80s|90s|retro|interview|teen|memory|flip-phone|prom/i.test(slug)) {
    moods.push('retro-youth');
  }
  if (
    DREAM_SLUGS.has(slug) ||
    /aquarium|goldfish|dream|alice|wuxia|portal|tutu|doll|halloween|prince/i.test(slug)
  ) {
    moods.push('dream-fantasy');
  }
  if (CELEB_SLUGS.has(slug) || /beauty|star|peach|photoshoot|celeb/i.test(slug)) {
    moods.push('celeb-spotlight');
  }
  // Ensure every video template belongs to at least one curated theme beyond 'all'
  if (moods.length === 1) {
    moods.push('runway-editorial');
  }
  return moods;
}

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
