/**
 * Pure presentation rules for the 직접 만들기 home's project cards and 미분류 line (docs/BRAND-PROJECT-SPINE.md §5, slice 3a).
 * No React or DOM imports; reuses `formatRelativeTime` from slice 1b and `tileSources` from the assets hub model.
 */
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { clampRatio, tileSources } from '@/components/brand-studio/asset-hub-model';
import { formatRelativeTime } from '@/components/brand-studio/project-chip/model';
import {
  BRAND_PROJECT_CARD_LIMITS,
  type BrandProjectFileKind,
  type StudioBrandProjectCard,
  type StudioBrandProjectCardCover,
  type StudioBrandProjectCards,
  type StudioBrandProjectCounts,
  type StudioBrandProjectCover,
} from '@/lib/brand-studio/contracts';
import { scopedHref } from '@/lib/brands/workspace/selection';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';

export interface SpineHomeProps {
  cards: StudioBrandProjectCards;
  canCreate: boolean;
  roomsOpen: boolean;
}

export type ProjectHomeCopy = Dictionary['projectHome'];

export interface ProjectCardsCopy {
  projectHome: ProjectHomeCopy;
  projectSpine: Dictionary['projectSpine'];
  libraryHub: Dictionary['studioLibrary']['hub'];
  roomsOverview: Dictionary['roomsShell']['overview'];
}

export type CoverSlot =
  | {
      kind: 'image';
      id: string;
      src: string;
      srcSet?: string;
      sizes?: string;
      width?: number;
      height?: number;
    }
  | { kind: 'video'; id: string; url: string }
  | { kind: 'video_placeholder'; id: string };

export interface CardCoverLayout {
  mode: 'empty' | 'one' | 'two' | 'three';
  slots: CoverSlot[];
}

export interface CardUnreadBadge {
  display: string;
  label: string;
}

export type NewProjectTriggerState = 'idle' | 'open' | 'submitting' | 'created';

export type NewProjectTriggerEvent = 'open' | 'submit' | 'fail' | 'succeed' | 'close';

const HOME_PROJECTS_MAX = 24;
const HOME_UNFILED_THUMBS_MAX = 6;
const UNFILED_THUMB_PX = 44;
const COUNT_KINDS: readonly BrandProjectFileKind[] = ['image', 'video', 'sound', 'upload', 'film'];

function cardSlotSizes(mode: 'one' | 'two' | 'three', index: number): string {
  if (mode === 'one') return '(min-width: 1800px) 22vw, 30vw';
  if (mode === 'two') return '(min-width: 1800px) 11vw, 15vw';
  return index === 0 ? '(min-width: 1800px) 15vw, 20vw' : '(min-width: 1800px) 8vw, 10vw';
}

function toCoverSlot(
  cover: {
    id: string;
    kind: 'image' | 'video';
    url: string;
    thumbUrl: string | null;
    width: number | null;
    height: number | null;
  },
  sizes: string,
  fixedSide?: number,
): CoverSlot {
  const positiveWidth = cover.width && cover.width > 0 ? cover.width : undefined;
  const positiveHeight = cover.height && cover.height > 0 ? cover.height : undefined;
  const width = fixedSide ?? positiveWidth;
  const height = fixedSide ?? positiveHeight;

  if (cover.kind === 'image') {
    let srcSet: string | undefined;
    if (!fixedSide && cover.thumbUrl && positiveWidth && positiveHeight) {
      const tiled = tileSources({
        kind: 'image',
        url: cover.url,
        thumbUrl: cover.thumbUrl,
        ratio: clampRatio(positiveWidth / positiveHeight),
        pixelWidth: positiveWidth,
      });
      srcSet = tiled?.srcSet;
    }
    return {
      kind: 'image',
      id: cover.id,
      src: cover.thumbUrl ?? cover.url,
      ...(srcSet ? { srcSet } : {}),
      sizes,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    };
  }
  if (cover.thumbUrl) {
    return {
      kind: 'image',
      id: cover.id,
      src: cover.thumbUrl,
      sizes,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    };
  }
  if (cover.url) {
    return { kind: 'video', id: cover.id, url: cover.url };
  }
  return { kind: 'video_placeholder', id: cover.id };
}

/** At most 24 project cards on the home, preserving server order; `hasMore` triggers the "모두 보기" link. */
export function projectCardsSlice(projects: readonly StudioBrandProjectCard[]): {
  shown: StudioBrandProjectCard[];
  hasMore: boolean;
} {
  return {
    shown: projects.slice(0, HOME_PROJECTS_MAX),
    hasMore: projects.length > HOME_PROJECTS_MAX,
  };
}

/** Picture slots for 0–3 card covers (never mounts a video element; video without `thumbUrl` becomes a placeholder). */
export function cardCoverLayout(covers: readonly StudioBrandProjectCardCover[]): CardCoverLayout {
  const picked = covers.slice(0, BRAND_PROJECT_CARD_LIMITS.covers);
  const mode = picked.length === 0 ? 'empty' : picked.length === 1 ? 'one' : picked.length === 2 ? 'two' : 'three';
  const slots = mode === 'empty' ? [] : picked.map((cover, index) => toCoverSlot(cover, cardSlotSizes(mode, index)));
  return { mode, slots };
}

/** Up to 6 small thumbnails (44×44) for the 미분류 line (same no-video-element rule as project cards). */
export function unfiledCoverSlots(covers: readonly StudioBrandProjectCover[]): CoverSlot[] {
  return covers.slice(0, HOME_UNFILED_THUMBS_MAX).map((cover) =>
    toCoverSlot(
      {
        id: cover.outputId,
        kind: cover.kind,
        url: cover.url,
        thumbUrl: cover.thumbUrl,
        width: cover.width,
        height: cover.height,
      },
      `${UNFILED_THUMB_PX}px`,
      UNFILED_THUMB_PX,
    ),
  );
}

/** Sum of the five file counts for the 미분류 line (derived strictly from `counts`, never from cover length). */
export function unfiledTotal(counts: StudioBrandProjectCounts): number {
  let total = 0;
  for (const kind of COUNT_KINDS) {
    const value = counts[kind];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      total += Math.floor(value);
    }
  }
  return total;
}

/** Second line under a card: positive counts in fixed order for own projects, origin + stage for team projects. */
export function cardSecondLine(card: StudioBrandProjectCard, copy: ProjectCardsCopy): string {
  if (card.project.origin === 'team') {
    const teamTag = copy.projectSpine.pickerTeamTag;
    if (!card.stage) return teamTag;
    return `${teamTag} · ${copy.roomsOverview.stageNow} · ${copy.roomsOverview.stages[card.stage.stage]}`;
  }
  const labels: Record<BrandProjectFileKind, string> = {
    image: copy.libraryHub.kinds.image,
    video: copy.libraryHub.kinds.video,
    sound: copy.projectHome.kindSound,
    upload: copy.projectHome.kindUploads,
    film: copy.projectSpine.film,
  };
  const parts: string[] = [];
  for (const kind of COUNT_KINDS) {
    const count = card.counts[kind];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      parts.push(`${labels[kind]} ${Math.floor(count)}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : copy.projectHome.cardEmpty;
}

/** Third line under a card: named/anonymous activity + relative time, or `pickerLast` from `project.lastActivityAt`. */
export function cardThirdLine(
  card: StudioBrandProjectCard,
  copy: ProjectCardsCopy,
  locale: 'ko' | 'en',
  now = new Date(),
): string {
  const h = copy.projectHome;
  if (card.lastActivity) {
    const namedMap: Record<BrandProjectFileKind, string> = {
      image: h.actNamedImage,
      video: h.actNamedVideo,
      sound: h.actNamedSound,
      upload: h.actNamedUpload,
      film: h.actNamedFilm,
    };
    const anonMap: Record<BrandProjectFileKind, string> = {
      image: h.actImage,
      video: h.actVideo,
      sound: h.actSound,
      upload: h.actUpload,
      film: h.actFilm,
    };
    const actor = card.lastActivity.actorName?.trim();
    const sentence = actor
      ? interpolate(namedMap[card.lastActivity.kind], { name: actor })
      : anonMap[card.lastActivity.kind];
    const when = formatRelativeTime(card.lastActivity.at, locale, now);
    return when ? `${sentence} · ${when}` : sentence;
  }
  const when = formatRelativeTime(card.project.lastActivityAt, locale, now);
  return when ? interpolate(copy.projectSpine.pickerLast, { when }) : '';
}

/** Address that opens the image studio with a brand project selected. */
export function studioProjectHref(organizationId: string, projectId: string): string {
  return `${scopedHref('/brand/studio', { id: organizationId })}&project=${encodeURIComponent(projectId)}`;
}

/** Link target for a project card: team projects open their room (or project page while rooms are closed); own projects open the image studio. */
export function cardHref(card: StudioBrandProjectCard, organizationId: string, roomsOpen: boolean): string {
  if (card.project.origin === 'team') {
    return roomsOpen
      ? roomHref(card.project.id, organizationId)
      : scopedHref(`/brand/projects/${encodeURIComponent(card.project.id)}`, { id: organizationId });
  }
  return studioProjectHref(organizationId, card.project.id);
}

/** Unread count beside a card title when positive; `null` when zero. */
export function cardUnreadBadge(unread: number, copy: Pick<ProjectHomeCopy, 'cardUnread'>): CardUnreadBadge | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  const n = Math.floor(unread);
  return {
    display: String(n),
    label: interpolate(copy.cardUnread, { n }),
  };
}

/** May the "새 프로젝트 만들기" trigger open a dialog: only when idle (stays locked after created until unload). */
export function canOpenNewProjectTrigger(state: NewProjectTriggerState): boolean {
  return state === 'idle';
}

/** May the dialog close/cancel: only while open and not submitting or already created. */
export function canCloseNewProjectDialog(state: NewProjectTriggerState): boolean {
  return state === 'open';
}

export function newProjectTriggerReducer(
  state: NewProjectTriggerState,
  event: NewProjectTriggerEvent,
): NewProjectTriggerState {
  if (event === 'open') return canOpenNewProjectTrigger(state) ? 'open' : state;
  if (event === 'submit') return state === 'open' ? 'submitting' : state;
  if (event === 'fail') return state === 'submitting' ? 'open' : state;
  if (event === 'succeed') return state === 'submitting' || state === 'open' ? 'created' : state;
  if (event === 'close') return canCloseNewProjectDialog(state) ? 'idle' : state;
  return state;
}
