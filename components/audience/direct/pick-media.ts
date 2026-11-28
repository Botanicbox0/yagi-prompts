import { railOrder } from '@/components/prompts/card-frame';
import type { EvidencePair } from '@/lib/content/slots';
import { soloCatalog, type PromptCard, type PromptCatalog } from '@/lib/prompts/catalog';
import { pickHeroFeaturedTemplate } from '@/lib/prompts/sequence-curation';

export interface DirectPageMedia {
  hero: PromptCard | null;
  step1Evidence: EvidencePair | null;
  step1Card: PromptCard | null;
  step2Card: PromptCard | null;
  step3Card: PromptCard | null;
}

const RATIO_TOLERANCE = 1.1;

function parseAspectPair(value: string | null): [number, number] | null {
  const match = value ? /^(\d+):(\d+)$/.exec(value) : null;
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? [w, h] : null;
}

function measuredDimensions(card: PromptCard): [number, number] | null {
  const media = [card.poster, card.video].find((item) => item?.w && item?.h && item.w > 0 && item.h > 0);
  if (media?.w && media.h) return [media.w, media.h];
  return parseAspectPair(card.aspectDefault);
}

function hasPoster(card: PromptCard): boolean {
  return Boolean(card.poster?.src && card.poster.src.trim().length > 0);
}

function hasVideo(card: PromptCard): boolean {
  return Boolean(card.video?.src && card.video.src.trim().length > 0);
}

function isNineSixteen(card: PromptCard): boolean {
  const dims = measuredDimensions(card);
  if (dims) return Math.abs(dims[0] / dims[1] - 9 / 16) < 0.15;
  return card.aspectDefault === '9:16';
}

function isPortrait(card: PromptCard): boolean {
  const dims = measuredDimensions(card);
  if (dims) return dims[1] > dims[0];
  return card.aspectDefault === '9:16' || card.aspectDefault === '4:5' || card.aspectDefault === '3:4';
}

/**
 * True only when both poster and video have positive dimensions whose aspect ratios agree within
 * 10%. Otherwise the hero shows the poster image only so the video is never cut inside the frame.
 */
export function heroVideoMatchesPoster(card: PromptCard): boolean {
  const poster = card.poster;
  const video = card.video;
  if (!poster?.src?.trim() || !video?.src?.trim()) return false;
  if (!poster.w || !poster.h || poster.w <= 0 || poster.h <= 0) return false;
  if (!video.w || !video.h || video.w <= 0 || video.h <= 0) return false;
  const posterRatioValue = poster.w / poster.h;
  const videoRatioValue = video.w / video.h;
  return Math.max(posterRatioValue / videoRatioValue, videoRatioValue / posterRatioValue) <= RATIO_TOLERANCE;
}

/**
 * Computes the hero box ratio from the poster's own dimensions first (so a portrait poster is never
 * cropped inside a landscape box), falling back to video dimensions, `aspectDefault`, and `9 / 16`.
 */
export function heroAspectRatio(card: PromptCard): {
  css: string;
  ratio: number;
  portrait: boolean;
} {
  const dims = measuredDimensions(card) ?? [9, 16];
  return {
    css: `${dims[0]} / ${dims[1]}`,
    ratio: dims[0] / dims[1],
    portrait: dims[0] < dims[1],
  };
}

/**
 * Computes exact uncropped poster dimensions for step tiles: fixed height (`~120px` below `md`,
 * `~264-300px` from `md` up) with width following the poster's own aspect ratio (`4 / 5` fallback
 * when poster dimensions are unknown).
 */
export function stepTileMetrics(
  card: PromptCard,
  maxDesktopHeightPx = 300,
): {
  aspectCss: string;
  mobileWidthPx: number;
  desktopWidthPx: number;
} {
  const dims: [number, number] =
    card.poster?.w && card.poster?.h && card.poster.w > 0 && card.poster.h > 0
      ? [card.poster.w, card.poster.h]
      : [4, 5];
  const ratio = dims[0] / dims[1];
  return {
    aspectCss: `${dims[0]} / ${dims[1]}`,
    mobileWidthPx: Math.min(128, Math.round(120 * ratio)),
    desktopWidthPx: Math.round(maxDesktopHeightPx * ratio),
  };
}

/**
 * Picks public catalogue media for `/[locale]/direct`:
 * - Hero prefers candidates whose poster and video aspect ratios agree within 10% (maker 9:16
 *   first, then `pickHeroFeaturedTemplate` over agreeing candidates). If none agree, falls back to
 *   poster+video cards (rendered poster-only), then any card with a poster. Cards without a poster
 *   are never chosen.
 * - Step tiles never duplicate hero or one another; any step with no distinct card receives `null`.
 */
export function pickDirectPageMedia(
  catalog: PromptCatalog,
  evidence: EvidencePair | null = null,
): DirectPageMedia {
  const solo = soloCatalog(catalog);
  const videos = solo.video.length > 0 ? solo.video : catalog.video;
  const images = solo.image.length > 0 ? solo.image : catalog.image;

  const orderedVideos = railOrder(videos);
  const orderedImages = railOrder(images);

  const posterPool: PromptCard[] = [];
  const seenSlugs = new Set<string>();
  for (const card of [...orderedVideos, ...orderedImages]) {
    if (!hasPoster(card) || seenSlugs.has(card.slug)) continue;
    seenSlugs.add(card.slug);
    posterPool.push(card);
  }

  const agreeingVideos = orderedVideos.filter(heroVideoMatchesPoster);
  const agreeingMakers = agreeingVideos.filter((card) => card.origin === 'maker');
  const videosWithBoth = orderedVideos.filter((card) => hasPoster(card) && hasVideo(card));
  const makersWithBoth = videosWithBoth.filter((card) => card.origin === 'maker');

  let hero: PromptCard | null = null;
  if (agreeingMakers.length > 0) {
    hero = agreeingMakers.find(isNineSixteen) ?? agreeingMakers.find(isPortrait) ?? agreeingMakers[0]!;
  } else if (agreeingVideos.length > 0) {
    hero = pickHeroFeaturedTemplate(agreeingVideos) ?? agreeingVideos[0]!;
  } else if (makersWithBoth.length > 0) {
    hero = makersWithBoth.find(isNineSixteen) ?? makersWithBoth.find(isPortrait) ?? makersWithBoth[0]!;
  } else if (videosWithBoth.length > 0) {
    hero = pickHeroFeaturedTemplate(videosWithBoth) ?? videosWithBoth[0]!;
  } else if (posterPool.length > 0) {
    const posterVideos = orderedVideos.filter(hasPoster);
    hero =
      (posterVideos.length > 0 ? pickHeroFeaturedTemplate(posterVideos) : undefined) ??
      posterPool.find((card) => card.origin === 'maker') ??
      posterPool[0]!;
  }

  const afterHero = posterPool.filter((card) => card.slug !== hero?.slug);
  const step2Card =
    afterHero.find((card) => card.origin === 'maker' && Boolean(card.authorHandle)) ??
    afterHero.find((card) => Boolean(card.authorHandle)) ??
    afterHero.find((card) => card.origin === 'maker') ??
    afterHero[0] ??
    null;

  let step1Evidence: EvidencePair | null = null;
  let step1Card: PromptCard | null = null;

  if (evidence !== null) {
    step1Evidence = evidence;
  } else {
    const afterStep2 = afterHero.filter((card) => card.slug !== step2Card?.slug);
    step1Card = afterStep2.find(isPortrait) ?? afterStep2[0] ?? null;
  }

  const usedSlugs = new Set<string>(
    [hero?.slug, step2Card?.slug, step1Card?.slug].filter((s): s is string => Boolean(s)),
  );
  const remaining = posterPool.filter((card) => !usedSlugs.has(card.slug));
  const step3Card = remaining.find(isPortrait) ?? remaining[0] ?? null;

  return {
    hero,
    step1Evidence,
    step1Card,
    step2Card,
    step3Card,
  };
}
