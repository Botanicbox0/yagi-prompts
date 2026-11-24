/**
 * Declarative timeline state and pure operations for Brand Studio Editing Studio v4
 * (`docs/BRAND-VIDEO-COMPOSE-D.md`, `docs/STUDIO-PRO-SUITE-V4.md`).
 *
 * Client-safe and dependency-free: tested directly in Node and used by the interactive timeline UI,
 * scene-cut splitter, reference color-grading engine, and chat-based timeline editor.
 */

import type {
  ColorGradeProfile,
  ColorGradeRegion,
  ColorGradeScope,
  ColorGradeSpec,
  GradePresetId,
} from './color-grade';

export const COMPOSE_ASPECTS = ['9:16', '16:9', '4:5', '1:1'] as const;
export type ComposeAspect = (typeof COMPOSE_ASPECTS)[number];

export const COMPOSE_DIMENSIONS: Readonly<Record<ComposeAspect, { width: number; height: number }>> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
};

export const COMPOSE_COLOR_PRESET_IDS = [
  'twings-french-blue',
  'clean-high-key',
  'editorial-cool-porcelain',
  'kodak-2383-warm',
  'moody-teal-amber',
  'pastel-airy-film',
] as const satisfies readonly GradePresetId[];
export type ComposeColorPresetId = (typeof COMPOSE_COLOR_PRESET_IDS)[number];

export const COMPOSE_COLOR_SCOPES = ['full_timeline', 'selected_clip', 'region'] as const satisfies readonly ColorGradeScope[];
export type ComposeColorScope = (typeof COMPOSE_COLOR_SCOPES)[number];

export type ComposeColorRegion = ColorGradeRegion;
export type ComposeReferenceColorProfile = ColorGradeProfile;

export interface ComposeColorGradeState {
  enabled: boolean;
  scope: ComposeColorScope;
  clipId?: string | null;
  clipIndex?: number | null;
  region?: ComposeColorRegion | null;
  presetId?: ComposeColorPresetId | null;
  referenceLabel?: string | null;
  referenceUrl?: string | null;
  referenceAssetId?: string | null;
  referenceOutputId?: string | null;
  referenceProfile?: ComposeReferenceColorProfile | null;
  /** `0..1` overall grade blend strength. */
  intensity: number;
  /** `0..1` warm skin-tone protection factor. */
  skinProtect: number;
  /** `0..10` film grain strength. */
  grain: number;
  /** `0..0.2` highlight halation bloom. */
  halation: number;
}

export type ComposeSourceKind = 'asset' | 'output' | 'local';
export type CaptionPosition = 'bottom' | 'center' | 'top';
export type CaptionSize = 'sm' | 'md' | 'lg';
export type ClipTransitionKind = 'none' | 'cross_dissolve' | 'dip_to_black';

export interface ComposeOverlayClip {
  id: string;
  label: string;
  sourceKind: ComposeSourceKind;
  assetId?: string;
  outputId?: string;
  srcUrl: string;
  thumbUrl?: string | null;
  mediaKind: 'image' | 'video';
  startSec: number;
  endSec: number;
  /** Normalized horizontal center `0..1` (default `0.5`). */
  x: number;
  /** Normalized vertical center `0..1` (default `0.5`). */
  y: number;
  /** Scale factor `0.1..1.5` relative to sequence width (default `0.45`). */
  scale: number;
  /** Layer opacity `0..1` (default `1`). */
  opacity: number;
}

export interface ComposeSfxClip {
  id: string;
  label: string;
  sourceKind: 'asset' | 'local';
  assetId?: string;
  srcUrl: string;
  startSec: number;
  durationSec: number;
  volume: number;
}

export interface TimelineClipTake {
  id: string;
  label: string;
  sourceKind: ComposeSourceKind;
  outputId?: string;
  assetId?: string;
  srcUrl: string;
  thumbUrl: string | null;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  createdAt?: string;
}

export interface ComposeClip {
  id: string;
  label: string;
  sourceKind: ComposeSourceKind;
  assetId?: string;
  outputId?: string;
  srcUrl: string;
  thumbUrl?: string | null;
  /** Natural full media length in seconds. */
  durationSec: number;
  /** Trim in-point in seconds (`0 <= trimStartSec < trimEndSec`). */
  trimStartSec: number;
  /** Trim out-point in seconds (`trimStartSec < trimEndSec <= durationSec`). */
  trimEndSec: number;
  /** `0..1` clip audio gain. */
  volume: number;
  muted: boolean;
  /** Playback speed multiplier `0.25..4` (`1` omitted). */
  playbackRate?: number;
  /** J/L cut audio lead/lag in seconds `-5..5` (`0` omitted). */
  audioOffsetSec?: number;
  /** Incoming cut transition (`'none'` omitted). */
  transitionIn?: ClipTransitionKind;
  /** Transition overlap duration in seconds `0.1..2` (omitted when `'none'`). */
  transitionDurationSec?: number;
  /** Detected scene transition timestamps in media seconds (`0 < t < durationSec`). */
  cutMarkers?: number[];
  /** Multi-take stack (`1/N`) for regenerating a shot in-place without timeline sprawl. */
  takes?: TimelineClipTake[];
  /** Zero-based index into `takes`. */
  activeTakeIndex?: number;
}

export type TimelineClip = ComposeClip;

export interface ComposeCaption {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  position: CaptionPosition;
  size: CaptionSize;
}

export interface ComposeBgm {
  label: string;
  sourceKind: 'asset' | 'local';
  assetId?: string;
  srcUrl: string;
  durationSec: number;
  trimStartSec: number;
  volume: number;
  /** Marks reference-generated guide audio (`CC BY-NC 4.0`, non-commercial draft only). */
  nonCommercialGuide?: boolean;
  /** Target timeline cut timestamp (seconds) where the beat drop was synced (`0ms`). */
  dropSyncSec?: number | null;
}

export interface ComposerProject {
  version: 1;
  aspect: ComposeAspect;
  clips: ComposeClip[];
  captions: ComposeCaption[];
  bgm: ComposeBgm | null;
  colorGrade?: ComposeColorGradeState | null;
  /** V2 Picture-in-Picture / product cutout overlay track (omitted when empty). */
  overlays?: ComposeOverlayClip[];
  /** A2 dedicated sound-effects track (omitted when empty). */
  sfxClips?: ComposeSfxClip[];
  /** Asset UUIDs referenced during generation (e.g., `@video1` film sheets) for automatic cache cleanup on completion. */
  referenceAssetIds?: string[];
}

export interface ClipTimelineSpan {
  clip: ComposeClip;
  index: number;
  timelineStartSec: number;
  timelineEndSec: number;
  durationSec: number;
}

export type TimelinePatch =
  | { op: 'set_aspect'; aspect: ComposeAspect }
  | { op: 'trim_clip'; clipIndex: number; trimStartSec?: number; trimEndSec?: number; targetDurationSec?: number }
  | { op: 'set_clip_cuts'; clipIndex: number; cutMarkers: number[] }
  | { op: 'split_clip_at'; clipIndex: number; atMediaSec: number }
  | { op: 'split_clip_cuts'; clipIndex: number; cutMediaSecs: number[] }
  | { op: 'move_clip'; fromIndex: number; toIndex: number }
  | { op: 'swap_clips'; indexA: number; indexB: number }
  | { op: 'remove_clip'; clipIndex: number }
  | { op: 'set_clip_audio'; clipIndex: number | 'all'; volume?: number; muted?: boolean }
  | {
      op: 'add_caption';
      text: string;
      startSec?: number;
      endSec?: number;
      anchor?: 'start' | 'end' | 'full';
      durationSec?: number;
      position?: CaptionPosition;
      size?: CaptionSize;
    }
  | {
      op: 'update_caption';
      captionIndex: number;
      text?: string;
      startSec?: number;
      endSec?: number;
      position?: CaptionPosition;
      size?: CaptionSize;
    }
  | { op: 'remove_caption'; captionIndex: number | 'all' }
  | { op: 'set_bgm_volume'; volume: number; muted?: boolean }
  | { op: 'remove_bgm' }
  | {
      op: 'set_color_grade';
      enabled: boolean;
      scope?: ComposeColorScope;
      clipIndex?: number | null;
      clipId?: string | null;
      region?: ComposeColorRegion | null;
      presetId?: ComposeColorPresetId | null;
      referenceLabel?: string | null;
      referenceUrl?: string | null;
      referenceAssetId?: string | null;
      referenceOutputId?: string | null;
      referenceProfile?: ComposeReferenceColorProfile | null;
      intensity?: number;
      skinProtect?: number;
      grain?: number;
      halation?: number;
    }
  | { op: 'set_clip_speed'; clipIndex: number; playbackRate: number }
  | { op: 'slip_clip'; clipIndex: number; deltaSec: number }
  | { op: 'set_clip_audio_offset'; clipIndex: number; audioOffsetSec: number }
  | {
      op: 'set_clip_transition';
      clipIndex: number;
      transitionIn: ClipTransitionKind;
      transitionDurationSec?: number;
    }
  | {
      op: 'add_overlay';
      label: string;
      sourceKind: ComposeSourceKind;
      assetId?: string;
      outputId?: string;
      srcUrl: string;
      thumbUrl?: string | null;
      mediaKind: 'image' | 'video';
      startSec: number;
      endSec: number;
      x?: number;
      y?: number;
      scale?: number;
      opacity?: number;
    }
  | { op: 'remove_overlay'; overlayIndex: number | 'all' }
  | {
      op: 'add_sfx';
      label: string;
      sourceKind: 'asset' | 'local';
      assetId?: string;
      srcUrl: string;
      startSec: number;
      durationSec: number;
      volume?: number;
    }
  | { op: 'remove_sfx'; sfxIndex: number | 'all' }
  | { op: 'set_sfx_volume'; sfxIndex: number; volume: number };

export const MIN_CLIP_PLAY_SEC = 0.3;
export const AUTO_CUT_EDGE_GUARD_SEC = 0.4;
export const MAX_COMPOSE_CLIPS = 24;
export const MAX_COMPOSE_CAPTIONS = 32;
export const MAX_COMPOSE_OVERLAYS = 12;
export const MAX_COMPOSE_SFX = 24;

/** Longest footage the library records for one video (`AssetCompleteSchema.seconds`). */
export const COMPOSE_SOURCE_MAX_SEC = 600;
/** Slowest speed either editor plays a cut at: the new editor's 0.1× (this one stops at 0.25×). */
export const COMPOSE_SLOWEST_SPEED = 0.1;
/**
 * The longest film the export record (`render.reserve`) writes as it is, shared by both editors: every cut of
 * the longest library footage at the slowest speed, 144,000 s. Export is free and the row is only a record, so a
 * longer film (only device files over 10 minutes can make one) is recorded at this length, never refused.
 * (The 300 s it replaces came from the per-second export price, gone since docs/BRAND-EDITING-STUDIO.md §8-3.)
 */
export const COMPOSE_FILM_MAX_SEC = (MAX_COMPOSE_CLIPS * COMPOSE_SOURCE_MAX_SEC) / COMPOSE_SLOWEST_SPEED;

export const DEFAULT_COLOR_REGION: ComposeColorRegion = {
  x: 0.15,
  y: 0.15,
  w: 0.7,
  h: 0.7,
};

export function roundTenths(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function roundHundredths(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeColorRegion(region?: Partial<ComposeColorRegion> | null): ComposeColorRegion {
  const x = clamp(roundHundredths(region?.x ?? DEFAULT_COLOR_REGION.x), 0, 0.92);
  const y = clamp(roundHundredths(region?.y ?? DEFAULT_COLOR_REGION.y), 0, 0.92);
  const w = clamp(roundHundredths(region?.w ?? DEFAULT_COLOR_REGION.w), 0.08, roundHundredths(1 - x));
  const h = clamp(roundHundredths(region?.h ?? DEFAULT_COLOR_REGION.h), 0.08, roundHundredths(1 - y));
  return { x, y, w, h };
}

export function normalizeCutMarkers(markers: readonly number[] | undefined, durationSec: number): number[] | undefined {
  if (!markers || markers.length === 0) return undefined;
  const unique: number[] = [];
  const sorted = [...markers]
    .filter((m) => Number.isFinite(m) && m > 0.05 && m < durationSec - 0.05)
    .map((m) => roundHundredths(m))
    .sort((a, b) => a - b);
  for (const m of sorted) {
    if (unique.length === 0 || m - unique[unique.length - 1]! >= 0.2) {
      unique.push(m);
    }
  }
  return unique.length > 0 ? unique : undefined;
}

export function normalizeColorGradeState(grade?: ComposeColorGradeState | null): ComposeColorGradeState | null {
  if (!grade || !grade.enabled) return null;
  const scope: ComposeColorScope = (COMPOSE_COLOR_SCOPES as readonly string[]).includes(grade.scope)
    ? grade.scope
    : 'full_timeline';
  const presetId: ComposeColorPresetId | null =
    grade.presetId && (COMPOSE_COLOR_PRESET_IDS as readonly string[]).includes(grade.presetId)
      ? grade.presetId
      : null;
  return {
    enabled: true,
    scope,
    clipId: grade.clipId ?? null,
    clipIndex: typeof grade.clipIndex === 'number' ? Math.max(0, Math.trunc(grade.clipIndex)) : null,
    region: scope === 'region' ? normalizeColorRegion(grade.region) : grade.region ? normalizeColorRegion(grade.region) : null,
    presetId,
    referenceLabel: grade.referenceLabel ?? null,
    referenceUrl: grade.referenceUrl ?? null,
    referenceAssetId: grade.referenceAssetId ?? null,
    referenceOutputId: grade.referenceOutputId ?? null,
    referenceProfile: grade.referenceProfile ?? null,
    intensity: clamp(roundHundredths(grade.intensity ?? 0.85), 0, 1),
    skinProtect: clamp(roundHundredths(grade.skinProtect ?? 0.7), 0, 1),
    grain: clamp(roundHundredths(grade.grain ?? 2.0), 0, 10),
    halation: clamp( Math.round((grade.halation ?? 0.04) * 1000) / 1000, 0, 0.2),
  };
}

export function emptyComposerProject(aspect: ComposeAspect = '9:16'): ComposerProject {
  return {
    version: 1,
    aspect,
    clips: [],
    captions: [],
    bgm: null,
    colorGrade: null,
  };
}

export function composeStorageKey(organizationId: string): string {
  return `twings_studio_compose_v1:${organizationId}`;
}

export function normalizeTakeBounds(take: TimelineClipTake): TimelineClipTake {
  const full = Math.max(MIN_CLIP_PLAY_SEC, roundTenths(take.durationSec || 5));
  const start = clamp(roundTenths(take.trimStartSec), 0, Math.max(0, roundTenths(full - MIN_CLIP_PLAY_SEC)));
  const end = clamp(roundTenths(take.trimEndSec), roundTenths(start + MIN_CLIP_PLAY_SEC), full);
  return {
    id: take.id,
    label: take.label,
    sourceKind: take.sourceKind,
    ...(take.outputId ? { outputId: take.outputId } : {}),
    ...(take.assetId ? { assetId: take.assetId } : {}),
    srcUrl: take.srcUrl,
    thumbUrl: take.thumbUrl ?? null,
    durationSec: full,
    trimStartSec: start,
    trimEndSec: end,
    ...(take.createdAt ? { createdAt: take.createdAt } : {}),
  };
}

export function normalizeClipBounds(clip: ComposeClip): ComposeClip {
  const full = Math.max(MIN_CLIP_PLAY_SEC, roundTenths(clip.durationSec || 5));
  const start = clamp(roundTenths(clip.trimStartSec), 0, Math.max(0, roundTenths(full - MIN_CLIP_PLAY_SEC)));
  const end = clamp(roundTenths(clip.trimEndSec), roundTenths(start + MIN_CLIP_PLAY_SEC), full);
  const cutMarkers = normalizeCutMarkers(clip.cutMarkers, full);
  const normalizedTakes =
    Array.isArray(clip.takes) && clip.takes.length > 0 ? clip.takes.map(normalizeTakeBounds) : undefined;
  const activeTakeIndex =
    normalizedTakes && normalizedTakes.length > 0
      ? clamp(
          typeof clip.activeTakeIndex === 'number' && Number.isFinite(clip.activeTakeIndex)
            ? Math.trunc(clip.activeTakeIndex)
            : normalizedTakes.length - 1,
          0,
          normalizedTakes.length - 1,
        )
      : undefined;
  const {
    playbackRate: rawRate,
    audioOffsetSec: rawAudioOffset,
    transitionIn: rawTransitionIn,
    transitionDurationSec: rawTransitionDuration,
    ...baseClip
  } = clip;
  const rate =
    typeof rawRate === 'number' && Number.isFinite(rawRate) && Math.abs(rawRate - 1) >= 0.01
      ? clamp(roundHundredths(rawRate), 0.25, 4)
      : undefined;
  const audioOffsetSec =
    typeof rawAudioOffset === 'number' && Number.isFinite(rawAudioOffset) && Math.abs(rawAudioOffset) >= 0.05
      ? clamp(roundHundredths(rawAudioOffset), -5, 5)
      : undefined;
  const transitionIn =
    rawTransitionIn === 'cross_dissolve' || rawTransitionIn === 'dip_to_black' ? rawTransitionIn : undefined;
  const transitionDurationSec = transitionIn
    ? clamp(roundTenths(rawTransitionDuration ?? 0.4), 0.1, 2)
    : undefined;

  return {
    ...baseClip,
    durationSec: full,
    trimStartSec: start,
    trimEndSec: end,
    volume: clamp(Number.isFinite(clip.volume) ? Math.round(clip.volume * 100) / 100 : 1, 0, 1),
    muted: Boolean(clip.muted),
    ...(rate !== undefined ? { playbackRate: rate } : {}),
    ...(audioOffsetSec !== undefined ? { audioOffsetSec } : {}),
    ...(transitionIn ? { transitionIn, transitionDurationSec } : {}),
    ...(cutMarkers ? { cutMarkers } : { cutMarkers: undefined }),
    ...(normalizedTakes ? { takes: normalizedTakes, activeTakeIndex } : { takes: undefined, activeTakeIndex: undefined }),
  };
}

/** The speed a cut plays at (1 unless set; 0.25–4). The previews set their `<video>` to it, the export uses it. */
export function clipPlaybackRate(clip: Pick<ComposeClip, 'playbackRate'>): number {
  return clip.playbackRate && Number.isFinite(clip.playbackRate) ? clamp(clip.playbackRate, 0.25, 4) : 1;
}

export function clipPlayDuration(clip: ComposeClip): number {
  const rate = clipPlaybackRate(clip);
  return Math.max(MIN_CLIP_PLAY_SEC, roundTenths((clip.trimEndSec - clip.trimStartSec) / rate));
}

/** Returns scene-cut media timestamps strictly inside `(trimStartSec + 0.4, trimEndSec - 0.4)`. */
export function splittableCutMediaSecs(clip: Pick<ComposeClip, 'trimStartSec' | 'trimEndSec'>, cutMediaSecs: readonly number[]): number[] {
  const minMedia = clip.trimStartSec + AUTO_CUT_EDGE_GUARD_SEC + 1e-7;
  const maxMedia = clip.trimEndSec - AUTO_CUT_EDGE_GUARD_SEC - 1e-7;
  const sorted = [...cutMediaSecs]
    .filter((t) => Number.isFinite(t) && t > minMedia && t < maxMedia)
    .map((t) => roundTenths(t))
    .sort((a, b) => a - b);

  const valid: number[] = [];
  let prev = roundTenths(clip.trimStartSec);
  const outBound = roundTenths(clip.trimEndSec - MIN_CLIP_PLAY_SEC);
  for (const pt of sorted) {
    if (pt >= roundTenths(prev + MIN_CLIP_PLAY_SEC) && pt <= outBound) {
      valid.push(pt);
      prev = pt;
    }
  }
  return valid;
}

export function timelineSpans(project: ComposerProject): ClipTimelineSpan[] {
  let cursor = 0;
  return project.clips.map((raw, index) => {
    const clip = normalizeClipBounds(raw);
    const durationSec = clipPlayDuration(clip);
    const timelineStartSec = roundTenths(cursor);
    const timelineEndSec = roundTenths(cursor + durationSec);
    cursor = timelineEndSec;
    return { clip, index, timelineStartSec, timelineEndSec, durationSec };
  });
}

export function projectDurationSec(project: ComposerProject): number {
  const spans = timelineSpans(project);
  return spans.length === 0 ? 0 : spans[spans.length - 1]!.timelineEndSec;
}

export function activeColorGradeForFrame(
  project: ComposerProject,
  activeClip: { clip: ComposeClip; index: number } | null,
): ComposeColorGradeState | null {
  const grade = normalizeColorGradeState(project.colorGrade);
  if (!grade) return null;
  if (grade.scope === 'full_timeline') return grade;
  if (!activeClip) return null;

  if (grade.scope === 'selected_clip') {
    if (grade.clipId) {
      return activeClip.clip.id === grade.clipId ? grade : null;
    }
    const targetIdx = grade.clipIndex ?? 0;
    return activeClip.index === targetIdx ? grade : null;
  }

  // scope === 'region'
  if (grade.clipId && activeClip.clip.id !== grade.clipId) {
    return null;
  }
  if (!grade.clipId && grade.clipIndex !== null && grade.clipIndex !== undefined && activeClip.index !== grade.clipIndex) {
    return null;
  }
  return {
    ...grade,
    region: normalizeColorRegion(grade.region),
  };
}

export function toColorGradeSpec(grade: ComposeColorGradeState | null | undefined): ColorGradeSpec | null {
  const normalized = normalizeColorGradeState(grade);
  if (!normalized) return null;
  return {
    enabled: true,
    scope: normalized.scope,
    targetClipId: normalized.clipId ?? null,
    region: normalized.scope === 'region' ? normalizeColorRegion(normalized.region) : normalized.region,
    presetId: normalized.presetId ?? null,
    referenceLabel: normalized.referenceLabel ?? null,
    referenceProfile: normalized.referenceProfile ?? null,
    intensity: normalized.intensity,
    skinProtect: normalized.skinProtect,
    halation: normalized.halation,
    grain: normalized.grain,
  };
}

export function frameStateAtTime(
  project: ComposerProject,
  timelineSec: number,
): {
  activeClip: { clip: ComposeClip; index: number; mediaTimeSec: number } | null;
  activeCaptions: ComposeCaption[];
  activeOverlays: ComposeOverlayClip[];
  activeSfx: ComposeSfxClip[];
  bgmTimeSec: number | null;
  activeColorGrade: ComposeColorGradeState | null;
} {
  const spans = timelineSpans(project);
  const total = spans.length > 0 ? spans[spans.length - 1]!.timelineEndSec : 0;
  const t = clamp(timelineSec, 0, Math.max(0, total));
  let activeClip: { clip: ComposeClip; index: number; mediaTimeSec: number } | null = null;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]!;
    const isLast = i === spans.length - 1;
    if (t >= span.timelineStartSec && (t < span.timelineEndSec || (isLast && t <= span.timelineEndSec))) {
      const rate = clipPlaybackRate(span.clip);
      const offset = clamp(t - span.timelineStartSec, 0, Math.max(0, span.durationSec - 0.001));
      activeClip = {
        clip: span.clip,
        index: span.index,
        mediaTimeSec: clamp(span.clip.trimStartSec + offset * rate, span.clip.trimStartSec, span.clip.trimEndSec),
      };
      break;
    }
  }
  const activeCaptions = project.captions.filter((c) => c.text.trim() !== '' && t >= c.startSec && t <= c.endSec);
  const activeOverlays = (project.overlays ?? []).filter((o) => t >= o.startSec && t <= o.endSec);
  const activeSfx = (project.sfxClips ?? []).filter((s) => t >= s.startSec && t <= s.startSec + s.durationSec);
  let bgmTimeSec: number | null = null;
  if (project.bgm && project.bgm.volume > 0 && total > 0) {
    const bgmPlayable = Math.max(0.5, project.bgm.durationSec - project.bgm.trimStartSec);
    bgmTimeSec = project.bgm.trimStartSec + (t % bgmPlayable);
  }
  const activeColorGrade = activeColorGradeForFrame(project, activeClip);
  return { activeClip, activeCaptions, activeOverlays, activeSfx, bgmTimeSec, activeColorGrade };
}

export function playheadClipSplitTarget(
  project: ComposerProject,
  timelineSec: number,
): { clipIndex: number; atMediaSec: number } | null {
  const state = frameStateAtTime(project, timelineSec);
  if (!state.activeClip) return null;
  const { clip, index, mediaTimeSec } = state.activeClip;
  const atMediaSec = roundTenths(mediaTimeSec);
  if (
    atMediaSec < roundTenths(clip.trimStartSec + MIN_CLIP_PLAY_SEC) ||
    atMediaSec > roundTenths(clip.trimEndSec - MIN_CLIP_PLAY_SEC)
  ) {
    return null;
  }
  return { clipIndex: index, atMediaSec };
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function appendClip(project: ComposerProject, clip: Omit<ComposeClip, 'id'> & { id?: string }): ComposerProject {
  if (project.clips.length >= MAX_COMPOSE_CLIPS) return project;
  const normalized = normalizeClipBounds({
    ...clip,
    id: clip.id ?? nextId('clip'),
  });
  return { ...project, clips: [...project.clips, normalized] };
}

function seedTakesFromClip(clip: ComposeClip): TimelineClipTake[] {
  const normalized = normalizeClipBounds(clip);
  if (normalized.takes && normalized.takes.length > 0) {
    const activeIdx = normalized.activeTakeIndex ?? normalized.takes.length - 1;
    return normalized.takes.map((take, idx) =>
      idx === activeIdx
        ? normalizeTakeBounds({
            ...take,
            durationSec: normalized.durationSec,
            trimStartSec: normalized.trimStartSec,
            trimEndSec: normalized.trimEndSec,
          })
        : normalizeTakeBounds(take),
    );
  }
  return [
    normalizeTakeBounds({
      id: `${normalized.id}_take_1`,
      label: normalized.label,
      sourceKind: normalized.sourceKind,
      ...(normalized.outputId ? { outputId: normalized.outputId } : {}),
      ...(normalized.assetId ? { assetId: normalized.assetId } : {}),
      srcUrl: normalized.srcUrl,
      thumbUrl: normalized.thumbUrl ?? null,
      durationSec: normalized.durationSec,
      trimStartSec: normalized.trimStartSec,
      trimEndSec: normalized.trimEndSec,
    }),
  ];
}

function syncClipFromTake(
  clip: ComposeClip,
  chosen: TimelineClipTake,
  takes: TimelineClipTake[],
  activeTakeIndex: number,
): ComposeClip {
  return normalizeClipBounds({
    id: clip.id,
    label: chosen.label || clip.label,
    sourceKind: chosen.sourceKind,
    ...(chosen.outputId ? { outputId: chosen.outputId } : {}),
    ...(chosen.assetId ? { assetId: chosen.assetId } : {}),
    srcUrl: chosen.srcUrl,
    thumbUrl: chosen.thumbUrl ?? null,
    durationSec: chosen.durationSec,
    trimStartSec: chosen.trimStartSec,
    trimEndSec: chosen.trimEndSec,
    volume: clip.volume,
    muted: clip.muted,
    takes,
    activeTakeIndex,
  });
}

export function stackClipTake(
  project: ComposerProject,
  clipId: string,
  newTake: Omit<TimelineClipTake, 'id'> & { id?: string },
): ComposerProject {
  const idx = project.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return project;
  const target = project.clips[idx]!;
  const existingTakes = seedTakesFromClip(target);
  const appended = normalizeTakeBounds({
    ...newTake,
    id: newTake.id ?? nextId('take'),
    thumbUrl: newTake.thumbUrl ?? null,
  });
  const nextTakes = [...existingTakes, appended];
  const nextActive = nextTakes.length - 1;
  const updatedClip = syncClipFromTake(target, appended, nextTakes, nextActive);
  const clips = [...project.clips];
  clips[idx] = updatedClip;
  return { ...project, clips };
}

export function selectClipTake(project: ComposerProject, clipId: string, takeIndex: number): ComposerProject {
  const idx = project.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return project;
  const target = normalizeClipBounds(project.clips[idx]!);
  if (!target.takes || target.takes.length === 0) return project;
  const syncedTakes = seedTakesFromClip(target);
  const nextIdx = clamp(Math.trunc(takeIndex), 0, syncedTakes.length - 1);
  const chosen = syncedTakes[nextIdx]!;
  const updatedClip = syncClipFromTake(target, chosen, syncedTakes, nextIdx);
  const clips = [...project.clips];
  clips[idx] = updatedClip;
  return { ...project, clips };
}

export function addProjectReferenceAssetIds(
  project: ComposerProject,
  assetIds: readonly string[],
): ComposerProject {
  const existing = new Set((project.referenceAssetIds ?? []).filter((id) => typeof id === 'string' && id.trim() !== ''));
  let changed = false;
  for (const id of assetIds) {
    const trimmed = id.trim();
    if (trimmed && !existing.has(trimmed)) {
      existing.add(trimmed);
      changed = true;
    }
  }
  if (!changed) return project;
  return { ...project, referenceAssetIds: [...existing] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractProjectReferencedAssetIds(
  timeline: Partial<ComposerProject> | null | undefined,
): string[] {
  if (!timeline || typeof timeline !== 'object') return [];
  const ids = new Set<string>();
  const add = (candidate: unknown) => {
    if (typeof candidate === 'string' && UUID_PATTERN.test(candidate.trim())) {
      ids.add(candidate.trim().toLowerCase());
    }
  };
  if (Array.isArray(timeline.clips)) {
    for (const clip of timeline.clips) {
      if (!clip || typeof clip !== 'object') continue;
      add(clip.assetId);
      if (Array.isArray(clip.takes)) {
        for (const take of clip.takes) {
          if (take && typeof take === 'object') add(take.assetId);
        }
      }
    }
  }
  if (timeline.bgm && typeof timeline.bgm === 'object') {
    add(timeline.bgm.assetId);
  }
  if (timeline.colorGrade && typeof timeline.colorGrade === 'object') {
    add(timeline.colorGrade.referenceAssetId);
  }
  if (Array.isArray(timeline.overlays)) {
    for (const overlay of timeline.overlays) {
      if (overlay && typeof overlay === 'object') add(overlay.assetId);
    }
  }
  if (Array.isArray(timeline.sfxClips)) {
    for (const sfx of timeline.sfxClips) {
      if (sfx && typeof sfx === 'object') add(sfx.assetId);
    }
  }
  if (Array.isArray(timeline.referenceAssetIds)) {
    for (const id of timeline.referenceAssetIds) add(id);
  }
  return [...ids];
}

export function normalizeCaptions(captions: readonly ComposeCaption[], totalSec: number): ComposeCaption[] {
  const capMax = Math.max(3, roundTenths(totalSec || 10));
  return captions.slice(0, MAX_COMPOSE_CAPTIONS).map((caption) => {
    const startSec = clamp(roundTenths(caption.startSec), 0, Math.max(0, roundTenths(capMax - 0.3)));
    const endSec = clamp(roundTenths(caption.endSec), roundTenths(startSec + 0.3), Math.max(capMax, roundTenths(startSec + 0.3)));
    return {
      ...caption,
      text: caption.text.slice(0, 120),
      startSec,
      endSec,
    };
  });
}

/** Clamps one overlay's timing, placement and opacity (shared by patches, local storage and server saves). */
export function normalizeOverlayClip(overlay: ComposeOverlayClip): ComposeOverlayClip {
  const startSec = clamp(roundTenths(overlay.startSec), 0, 3600);
  const endSec = Math.max(roundTenths(startSec + 0.3), roundTenths(overlay.endSec));
  return {
    ...overlay,
    label: overlay.label.trim().slice(0, 80) || 'Overlay',
    startSec,
    endSec,
    x: clamp(roundHundredths(overlay.x), 0, 1),
    y: clamp(roundHundredths(overlay.y), 0, 1),
    scale: clamp(roundHundredths(overlay.scale), 0.1, 1.5),
    opacity: clamp(roundHundredths(overlay.opacity), 0, 1),
  };
}

/** Clamps one sound effect's timing and volume (shared by patches, local storage and server saves). */
export function normalizeSfxClip(sfx: ComposeSfxClip): ComposeSfxClip {
  return {
    ...sfx,
    label: sfx.label.trim().slice(0, 80) || 'SFX',
    startSec: clamp(roundTenths(sfx.startSec), 0, 3600),
    durationSec: clamp(roundTenths(sfx.durationSec), 0.2, 60),
    volume: clamp(roundHundredths(sfx.volume), 0, 1),
  };
}

export function applyTimelinePatches(
  initial: ComposerProject,
  patches: readonly TimelinePatch[],
): { project: ComposerProject; appliedCount: number } {
  const initialOverlays = initial.overlays?.map((o) => normalizeOverlayClip({ ...o })).slice(0, MAX_COMPOSE_OVERLAYS);
  const initialSfx = initial.sfxClips?.map((s) => normalizeSfxClip({ ...s })).slice(0, MAX_COMPOSE_SFX);
  let current: ComposerProject = {
    version: 1,
    aspect: initial.aspect,
    clips: initial.clips.map((c) => normalizeClipBounds({ ...c })),
    captions: initial.captions.map((c) => ({ ...c })),
    bgm: initial.bgm ? { ...initial.bgm } : null,
    colorGrade: normalizeColorGradeState(initial.colorGrade),
    ...(initialOverlays && initialOverlays.length > 0 ? { overlays: initialOverlays } : {}),
    ...(initialSfx && initialSfx.length > 0 ? { sfxClips: initialSfx } : {}),
    ...(initial.referenceAssetIds && initial.referenceAssetIds.length > 0
      ? { referenceAssetIds: [...initial.referenceAssetIds] }
      : {}),
  };
  let appliedCount = 0;

  for (const patch of patches) {
    switch (patch.op) {
      case 'set_aspect': {
        if ((COMPOSE_ASPECTS as readonly string[]).includes(patch.aspect) && current.aspect !== patch.aspect) {
          current = { ...current, aspect: patch.aspect };
          appliedCount += 1;
        }
        break;
      }
      case 'trim_clip': {
        const target = current.clips[patch.clipIndex];
        if (!target) break;
        let nextStart = patch.trimStartSec !== undefined ? patch.trimStartSec : target.trimStartSec;
        let nextEnd = patch.trimEndSec !== undefined ? patch.trimEndSec : target.trimEndSec;
        if (patch.targetDurationSec !== undefined) {
          const desired = clamp(roundTenths(patch.targetDurationSec), MIN_CLIP_PLAY_SEC, target.durationSec);
          nextEnd = clamp(roundTenths(nextStart + desired), roundTenths(nextStart + MIN_CLIP_PLAY_SEC), target.durationSec);
          if (roundTenths(nextEnd - nextStart) < desired) {
            nextStart = clamp(roundTenths(nextEnd - desired), 0, Math.max(0, roundTenths(target.durationSec - MIN_CLIP_PLAY_SEC)));
          }
        }
        const preliminary = normalizeClipBounds({ ...target, trimStartSec: nextStart, trimEndSec: nextEnd });
        const syncedTakes =
          preliminary.takes && preliminary.takes.length > 0
            ? preliminary.takes.map((take, idx) =>
                idx === (preliminary.activeTakeIndex ?? preliminary.takes!.length - 1)
                  ? normalizeTakeBounds({
                      ...take,
                      trimStartSec: preliminary.trimStartSec,
                      trimEndSec: preliminary.trimEndSec,
                    })
                  : take,
              )
            : undefined;
        const updated = syncedTakes ? normalizeClipBounds({ ...preliminary, takes: syncedTakes }) : preliminary;
        const clips = [...current.clips];
        clips[patch.clipIndex] = updated;
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'set_clip_cuts': {
        const target = current.clips[patch.clipIndex];
        if (!target) break;
        const updated = normalizeClipBounds({ ...target, cutMarkers: patch.cutMarkers });
        const clips = [...current.clips];
        clips[patch.clipIndex] = updated;
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'split_clip_at': {
        const target = current.clips[patch.clipIndex];
        if (!target || current.clips.length >= MAX_COMPOSE_CLIPS) break;
        const splitAt = roundTenths(patch.atMediaSec);
        const minSplit = roundTenths(target.trimStartSec + MIN_CLIP_PLAY_SEC);
        const maxSplit = roundTenths(target.trimEndSec - MIN_CLIP_PLAY_SEC);
        if (splitAt < minSplit || splitAt > maxSplit) break;

        const left = normalizeClipBounds({
          ...target,
          id: target.id,
          trimStartSec: target.trimStartSec,
          trimEndSec: splitAt,
          cutMarkers: target.cutMarkers?.filter((m) => m > target.trimStartSec && m < splitAt),
        });
        const right = normalizeClipBounds({
          ...target,
          id: nextId('clip'),
          trimStartSec: splitAt,
          trimEndSec: target.trimEndSec,
          cutMarkers: target.cutMarkers?.filter((m) => m > splitAt && m < target.trimEndSec),
        });
        const clips = [...current.clips];
        clips.splice(patch.clipIndex, 1, left, right);
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'split_clip_cuts': {
        const target = current.clips[patch.clipIndex];
        if (!target || current.clips.length >= MAX_COMPOSE_CLIPS) break;
        const rawCuts = patch.cutMediaSecs.length > 0 ? patch.cutMediaSecs : (target.cutMarkers ?? []);
        const maxNewPieces = Math.max(0, MAX_COMPOSE_CLIPS - current.clips.length);
        const validCuts = splittableCutMediaSecs(target, rawCuts).slice(0, maxNewPieces);
        if (validCuts.length === 0) break;

        const points = [target.trimStartSec, ...validCuts, target.trimEndSec];
        const segments: ComposeClip[] = [];
        for (let i = 0; i < points.length - 1; i += 1) {
          const segStart = points[i]!;
          const segEnd = points[i + 1]!;
          segments.push(
            normalizeClipBounds({
              ...target,
              id: i === 0 ? target.id : nextId('clip'),
              trimStartSec: segStart,
              trimEndSec: segEnd,
              cutMarkers: undefined,
            }),
          );
        }
        const clips = [...current.clips];
        clips.splice(patch.clipIndex, 1, ...segments);
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'move_clip': {
        const { fromIndex, toIndex } = patch;
        if (fromIndex < 0 || fromIndex >= current.clips.length) break;
        const clampedTo = clamp(Math.round(toIndex), 0, current.clips.length - 1);
        if (fromIndex === clampedTo) break;
        const clips = [...current.clips];
        const [moved] = clips.splice(fromIndex, 1);
        if (!moved) break;
        clips.splice(clampedTo, 0, moved);
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'swap_clips': {
        const { indexA, indexB } = patch;
        if (
          indexA < 0 ||
          indexB < 0 ||
          indexA >= current.clips.length ||
          indexB >= current.clips.length ||
          indexA === indexB
        ) {
          break;
        }
        const clips = [...current.clips];
        const a = clips[indexA]!;
        const b = clips[indexB]!;
        clips[indexA] = b;
        clips[indexB] = a;
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'remove_clip': {
        if (patch.clipIndex < 0 || patch.clipIndex >= current.clips.length) break;
        const removedId = current.clips[patch.clipIndex]?.id;
        const nextClips = current.clips.filter((_, idx) => idx !== patch.clipIndex);
        let nextColorGrade = current.colorGrade;
        if (nextColorGrade && removedId && nextColorGrade.clipId === removedId) {
          nextColorGrade = nextClips.length > 0 ? { ...nextColorGrade, clipId: nextClips[0]!.id, clipIndex: 0 } : null;
        }
        current = { ...current, clips: nextClips, colorGrade: nextColorGrade };
        appliedCount += 1;
        break;
      }
      case 'set_clip_audio': {
        if (current.clips.length === 0) break;
        const indices =
          patch.clipIndex === 'all'
            ? current.clips.map((_, i) => i)
            : patch.clipIndex >= 0 && patch.clipIndex < current.clips.length
              ? [patch.clipIndex]
              : [];
        if (indices.length === 0) break;
        const clips = current.clips.map((clip, idx) => {
          if (!indices.includes(idx)) return clip;
          const nextVol = patch.volume !== undefined ? clamp(patch.volume, 0, 1) : clip.volume;
          const nextMuted = patch.muted !== undefined ? patch.muted : nextVol === 0 ? true : false;
          return { ...clip, volume: nextVol === 0 && !nextMuted ? 0.5 : nextVol, muted: nextMuted };
        });
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'add_caption': {
        const text = patch.text.trim().slice(0, 120);
        if (!text || current.captions.length >= MAX_COMPOSE_CAPTIONS) break;
        const total = Math.max(3, projectDurationSec(current));
        const dur = clamp(roundTenths(patch.durationSec ?? 2.5), 0.5, total);
        let startSec = patch.startSec ?? 0;
        let endSec = patch.endSec ?? roundTenths(startSec + dur);
        if (patch.anchor === 'end') {
          endSec = total;
          startSec = Math.max(0, roundTenths(total - dur));
        } else if (patch.anchor === 'full') {
          startSec = 0;
          endSec = total;
        } else if (patch.anchor === 'start' && patch.startSec === undefined) {
          startSec = 0;
          endSec = Math.min(total, dur);
        }
        const caption: ComposeCaption = {
          id: nextId('cap'),
          text,
          startSec: clamp(roundTenths(startSec), 0, Math.max(0, roundTenths(total - 0.3))),
          endSec: clamp(roundTenths(endSec), roundTenths(startSec + 0.3), Math.max(total, roundTenths(startSec + 0.3))),
          position: patch.position ?? 'bottom',
          size: patch.size ?? 'md',
        };
        current = { ...current, captions: [...current.captions, caption] };
        appliedCount += 1;
        break;
      }
      case 'update_caption': {
        const target = current.captions[patch.captionIndex];
        if (!target) break;
        const total = Math.max(3, projectDurationSec(current));
        const nextStart = patch.startSec !== undefined ? roundTenths(patch.startSec) : target.startSec;
        const nextEnd = patch.endSec !== undefined ? roundTenths(patch.endSec) : target.endSec;
        const updated: ComposeCaption = {
          ...target,
          text: patch.text !== undefined ? patch.text.slice(0, 120) : target.text,
          startSec: clamp(nextStart, 0, Math.max(0, roundTenths(total - 0.3))),
          endSec: clamp(nextEnd, roundTenths(nextStart + 0.3), Math.max(total, roundTenths(nextStart + 0.3))),
          position: patch.position ?? target.position,
          size: patch.size ?? target.size,
        };
        const captions = [...current.captions];
        captions[patch.captionIndex] = updated;
        current = { ...current, captions };
        appliedCount += 1;
        break;
      }
      case 'remove_caption': {
        if (current.captions.length === 0) break;
        if (patch.captionIndex === 'all') {
          current = { ...current, captions: [] };
          appliedCount += 1;
        } else if (patch.captionIndex >= 0 && patch.captionIndex < current.captions.length) {
          current = { ...current, captions: current.captions.filter((_, idx) => idx !== patch.captionIndex) };
          appliedCount += 1;
        }
        break;
      }
      case 'set_bgm_volume': {
        if (!current.bgm) break;
        const vol = patch.muted ? 0 : clamp(patch.volume, 0, 1);
        current = { ...current, bgm: { ...current.bgm, volume: Math.round(vol * 100) / 100 } };
        appliedCount += 1;
        break;
      }
      case 'remove_bgm': {
        if (!current.bgm) break;
        current = { ...current, bgm: null };
        appliedCount += 1;
        break;
      }
      case 'set_color_grade': {
        if (!patch.enabled) {
          current = { ...current, colorGrade: null };
          appliedCount += 1;
          break;
        }
        const prev = current.colorGrade;
        const scope = patch.scope ?? prev?.scope ?? 'full_timeline';
        const resolvedIdx =
          patch.clipIndex !== undefined
            ? patch.clipIndex
            : scope === 'selected_clip'
              ? (prev?.clipIndex ?? 0)
              : null;
        const resolvedClipId =
          patch.clipId !== undefined
            ? patch.clipId
            : resolvedIdx !== null && resolvedIdx !== undefined
              ? (current.clips[resolvedIdx]?.id ?? prev?.clipId ?? null)
              : scope === 'full_timeline'
                ? null
                : (prev?.clipId ?? null);

        const nextGrade = normalizeColorGradeState({
          enabled: true,
          scope,
          clipIndex: resolvedIdx,
          clipId: resolvedClipId,
          region:
            scope === 'region'
              ? normalizeColorRegion(patch.region ?? prev?.region ?? DEFAULT_COLOR_REGION)
              : (patch.region ?? prev?.region ?? null),
          presetId: patch.presetId !== undefined ? patch.presetId : (prev?.presetId ?? null),
          referenceLabel: patch.referenceLabel !== undefined ? patch.referenceLabel : (prev?.referenceLabel ?? null),
          referenceUrl: patch.referenceUrl !== undefined ? patch.referenceUrl : (prev?.referenceUrl ?? null),
          referenceAssetId: patch.referenceAssetId !== undefined ? patch.referenceAssetId : (prev?.referenceAssetId ?? null),
          referenceOutputId: patch.referenceOutputId !== undefined ? patch.referenceOutputId : (prev?.referenceOutputId ?? null),
          referenceProfile: patch.referenceProfile !== undefined ? patch.referenceProfile : (prev?.referenceProfile ?? null),
          intensity: patch.intensity ?? prev?.intensity ?? 0.85,
          skinProtect: patch.skinProtect ?? prev?.skinProtect ?? 0.7,
          grain: patch.grain ?? prev?.grain ?? 2.0,
          halation: patch.halation ?? prev?.halation ?? 0.04,
        });
        current = { ...current, colorGrade: nextGrade };
        appliedCount += 1;
        break;
      }
      case 'set_clip_speed': {
        const target = current.clips[patch.clipIndex];
        if (!target || !Number.isFinite(patch.playbackRate)) break;
        const clips = [...current.clips];
        clips[patch.clipIndex] = normalizeClipBounds({
          ...target,
          playbackRate: clamp(roundHundredths(patch.playbackRate), 0.25, 4),
        });
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'slip_clip': {
        const target = current.clips[patch.clipIndex];
        if (!target || !Number.isFinite(patch.deltaSec)) break;
        const span = Math.max(MIN_CLIP_PLAY_SEC, roundTenths(target.trimEndSec - target.trimStartSec));
        const maxStart = Math.max(0, roundTenths(target.durationSec - span));
        const nextStart = clamp(roundTenths(target.trimStartSec + patch.deltaSec), 0, maxStart);
        const nextEnd = Math.min(target.durationSec, roundTenths(nextStart + span));
        const clips = [...current.clips];
        clips[patch.clipIndex] = normalizeClipBounds({
          ...target,
          trimStartSec: nextStart,
          trimEndSec: nextEnd,
        });
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'set_clip_audio_offset': {
        const target = current.clips[patch.clipIndex];
        if (!target || !Number.isFinite(patch.audioOffsetSec)) break;
        const clips = [...current.clips];
        clips[patch.clipIndex] = normalizeClipBounds({
          ...target,
          audioOffsetSec: clamp(roundHundredths(patch.audioOffsetSec), -5, 5),
        });
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'set_clip_transition': {
        const target = current.clips[patch.clipIndex];
        if (!target) break;
        const nextClip =
          patch.transitionIn === 'none'
            ? normalizeClipBounds({ ...target, transitionIn: undefined, transitionDurationSec: undefined })
            : normalizeClipBounds({
                ...target,
                transitionIn: patch.transitionIn,
                transitionDurationSec: patch.transitionDurationSec ?? target.transitionDurationSec ?? 0.4,
              });
        const clips = [...current.clips];
        clips[patch.clipIndex] = nextClip;
        current = { ...current, clips };
        appliedCount += 1;
        break;
      }
      case 'add_overlay': {
        const existing = current.overlays ?? [];
        if (!patch.srcUrl || existing.length >= MAX_COMPOSE_OVERLAYS) break;
        const total = Math.max(3, projectDurationSec(current));
        const startSec = clamp(roundTenths(patch.startSec), 0, Math.max(0, roundTenths(total - 0.3)));
        const endSec = Math.max(roundTenths(startSec + 0.3), roundTenths(patch.endSec));
        const overlay = normalizeOverlayClip({
          id: nextId('ovl'),
          label: patch.label,
          sourceKind: patch.sourceKind,
          ...(patch.assetId ? { assetId: patch.assetId } : {}),
          ...(patch.outputId ? { outputId: patch.outputId } : {}),
          srcUrl: patch.srcUrl,
          ...(patch.thumbUrl !== undefined ? { thumbUrl: patch.thumbUrl } : {}),
          mediaKind: patch.mediaKind,
          startSec,
          endSec,
          x: patch.x ?? 0.5,
          y: patch.y ?? 0.5,
          scale: patch.scale ?? 0.45,
          opacity: patch.opacity ?? 1,
        });
        current = { ...current, overlays: [...existing, overlay] };
        appliedCount += 1;
        break;
      }
      case 'remove_overlay': {
        const existing = current.overlays ?? [];
        if (patch.overlayIndex === 'all') {
          if (existing.length > 0) {
            const { overlays: _dropped, ...rest } = current;
            current = rest;
            appliedCount += 1;
          }
          break;
        }
        if (patch.overlayIndex < 0 || patch.overlayIndex >= existing.length) break;
        const nextOverlays = existing.filter((_, idx) => idx !== patch.overlayIndex);
        if (nextOverlays.length > 0) {
          current = { ...current, overlays: nextOverlays };
        } else {
          const { overlays: _dropped, ...rest } = current;
          current = rest;
        }
        appliedCount += 1;
        break;
      }
      case 'add_sfx': {
        const existing = current.sfxClips ?? [];
        if (!patch.srcUrl || existing.length >= MAX_COMPOSE_SFX) break;
        const sfx = normalizeSfxClip({
          id: nextId('sfx'),
          label: patch.label,
          sourceKind: patch.sourceKind,
          ...(patch.assetId ? { assetId: patch.assetId } : {}),
          srcUrl: patch.srcUrl,
          startSec: patch.startSec,
          durationSec: patch.durationSec,
          volume: patch.volume ?? 0.85,
        });
        current = { ...current, sfxClips: [...existing, sfx] };
        appliedCount += 1;
        break;
      }
      case 'remove_sfx': {
        const existing = current.sfxClips ?? [];
        if (patch.sfxIndex === 'all') {
          if (existing.length > 0) {
            const { sfxClips: _dropped, ...rest } = current;
            current = rest;
            appliedCount += 1;
          }
          break;
        }
        if (patch.sfxIndex < 0 || patch.sfxIndex >= existing.length) break;
        const nextSfx = existing.filter((_, idx) => idx !== patch.sfxIndex);
        if (nextSfx.length > 0) {
          current = { ...current, sfxClips: nextSfx };
        } else {
          const { sfxClips: _dropped, ...rest } = current;
          current = rest;
        }
        appliedCount += 1;
        break;
      }
      case 'set_sfx_volume': {
        const existing = current.sfxClips ?? [];
        const target = existing[patch.sfxIndex];
        if (!target || !Number.isFinite(patch.volume)) break;
        const nextSfx = existing.map((item, idx) =>
          idx === patch.sfxIndex ? normalizeSfxClip({ ...item, volume: patch.volume }) : item,
        );
        current = { ...current, sfxClips: nextSfx };
        appliedCount += 1;
        break;
      }
    }
  }

  return { project: current, appliedCount };
}

export function sanitizeProjectForPersistence(project: ComposerProject): ComposerProject {
  const sanitizedGrade = project.colorGrade
    ? {
        ...project.colorGrade,
        referenceUrl:
          project.colorGrade.referenceUrl && !project.colorGrade.referenceUrl.startsWith('blob:')
            ? project.colorGrade.referenceUrl
            : null,
      }
    : null;
  const sanitizedClips = project.clips
    .filter((c) => c.sourceKind !== 'local' && !c.srcUrl.startsWith('blob:'))
    .map((clip) => {
      if (!clip.takes || clip.takes.length === 0) return normalizeClipBounds(clip);
      const validTakes = clip.takes.filter((t) => t.sourceKind !== 'local' && !t.srcUrl.startsWith('blob:'));
      if (validTakes.length === 0) return normalizeClipBounds({ ...clip, takes: undefined, activeTakeIndex: undefined });
      const activeId = clip.takes[clip.activeTakeIndex ?? clip.takes.length - 1]?.id;
      const mappedIdx = activeId ? validTakes.findIndex((t) => t.id === activeId) : -1;
      const nextActive = mappedIdx >= 0 ? mappedIdx : validTakes.length - 1;
      return normalizeClipBounds({ ...clip, takes: validTakes, activeTakeIndex: nextActive });
    });
  const sanitizedOverlays = (project.overlays ?? [])
    .filter((o) => o.sourceKind !== 'local' && !o.srcUrl.startsWith('blob:'))
    .slice(0, MAX_COMPOSE_OVERLAYS)
    .map(normalizeOverlayClip);
  const sanitizedSfx = (project.sfxClips ?? [])
    .filter((s) => s.sourceKind !== 'local' && !s.srcUrl.startsWith('blob:'))
    .slice(0, MAX_COMPOSE_SFX)
    .map(normalizeSfxClip);
  return {
    version: 1,
    aspect: project.aspect,
    clips: sanitizedClips,
    captions: project.captions,
    bgm: project.bgm && project.bgm.sourceKind !== 'local' && !project.bgm.srcUrl.startsWith('blob:') ? project.bgm : null,
    colorGrade: sanitizedGrade,
    ...(sanitizedOverlays.length > 0 ? { overlays: sanitizedOverlays } : {}),
    ...(sanitizedSfx.length > 0 ? { sfxClips: sanitizedSfx } : {}),
    ...(project.referenceAssetIds && project.referenceAssetIds.length > 0
      ? { referenceAssetIds: project.referenceAssetIds.filter((id) => typeof id === 'string' && id.trim() !== '') }
      : {}),
  };
}

/** Drops ephemeral `blob:` URLs before saving to localStorage so reloaded tabs never point at dead blobs. */
export function serializeProjectForStorage(project: ComposerProject): string {
  return JSON.stringify(sanitizeProjectForPersistence(project));
}

export function parseStoredProject(raw: string | null): ComposerProject | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ComposerProject>;
    if (!parsed || parsed.version !== 1 || typeof parsed.aspect !== 'string') return null;
    if (!(COMPOSE_ASPECTS as readonly string[]).includes(parsed.aspect)) return null;
    const clips = Array.isArray(parsed.clips)
      ? parsed.clips
          .filter(
            (c): c is ComposeClip =>
              Boolean(c) &&
              typeof c.id === 'string' &&
              typeof c.label === 'string' &&
              (typeof c.srcUrl === 'string' || typeof c.assetId === 'string' || typeof c.outputId === 'string') &&
              !(typeof c.srcUrl === 'string' && c.srcUrl.startsWith('blob:')) &&
              typeof c.durationSec === 'number',
          )
          .slice(0, MAX_COMPOSE_CLIPS)
          .map((c) => {
            const validTakes = Array.isArray(c.takes)
              ? c.takes.filter(
                  (t): t is TimelineClipTake =>
                    Boolean(t) &&
                    typeof t.id === 'string' &&
                    typeof t.label === 'string' &&
                    typeof t.srcUrl === 'string' &&
                    !t.srcUrl.startsWith('blob:') &&
                    typeof t.durationSec === 'number',
                )
              : undefined;
            return normalizeClipBounds({
              ...c,
              srcUrl: typeof c.srcUrl === 'string' ? c.srcUrl : '',
              ...(validTakes && validTakes.length > 0 ? { takes: validTakes } : { takes: undefined, activeTakeIndex: undefined }),
            });
          })
      : [];
    const captions = Array.isArray(parsed.captions)
      ? parsed.captions
          .filter(
            (c): c is ComposeCaption =>
              Boolean(c) &&
              typeof c.id === 'string' &&
              typeof c.text === 'string' &&
              typeof c.startSec === 'number' &&
              typeof c.endSec === 'number',
          )
          .slice(0, MAX_COMPOSE_CAPTIONS)
      : [];
    const bgm =
      parsed.bgm &&
      typeof parsed.bgm === 'object' &&
      (typeof parsed.bgm.srcUrl === 'string' || typeof parsed.bgm.assetId === 'string') &&
      !(typeof parsed.bgm.srcUrl === 'string' && parsed.bgm.srcUrl.startsWith('blob:')) &&
      typeof parsed.bgm.durationSec === 'number'
        ? {
            label: String(parsed.bgm.label ?? 'Music'),
            sourceKind: 'asset' as const,
            ...(typeof parsed.bgm.assetId === 'string' ? { assetId: parsed.bgm.assetId } : {}),
            srcUrl: typeof parsed.bgm.srcUrl === 'string' ? parsed.bgm.srcUrl : '',
            durationSec: Math.max(0.5, Number(parsed.bgm.durationSec)),
            trimStartSec: clamp(Number(parsed.bgm.trimStartSec ?? 0), 0, Math.max(0, Number(parsed.bgm.durationSec) - 0.5)),
            volume: clamp(Number(parsed.bgm.volume ?? 0.4), 0, 1),
            ...(parsed.bgm.nonCommercialGuide ? { nonCommercialGuide: true } : {}),
            ...(typeof parsed.bgm.dropSyncSec === 'number' ? { dropSyncSec: parsed.bgm.dropSyncSec } : {}),
          }
        : null;
    const colorGrade =
      parsed.colorGrade && typeof parsed.colorGrade === 'object'
        ? normalizeColorGradeState(parsed.colorGrade as ComposeColorGradeState)
        : null;
    const overlays = Array.isArray(parsed.overlays)
      ? parsed.overlays
          .filter(
            (o): o is ComposeOverlayClip =>
              Boolean(o) &&
              typeof o.id === 'string' &&
              typeof o.label === 'string' &&
              (typeof o.srcUrl === 'string' || typeof o.assetId === 'string' || typeof o.outputId === 'string') &&
              !(typeof o.srcUrl === 'string' && o.srcUrl.startsWith('blob:')) &&
              (o.mediaKind === 'image' || o.mediaKind === 'video') &&
              typeof o.startSec === 'number' &&
              typeof o.endSec === 'number',
          )
          .slice(0, MAX_COMPOSE_OVERLAYS)
          .map((o) =>
            normalizeOverlayClip({
              ...o,
              srcUrl: typeof o.srcUrl === 'string' ? o.srcUrl : '',
              x: typeof o.x === 'number' ? o.x : 0.5,
              y: typeof o.y === 'number' ? o.y : 0.5,
              scale: typeof o.scale === 'number' ? o.scale : 0.45,
              opacity: typeof o.opacity === 'number' ? o.opacity : 1,
            }),
          )
      : [];
    const sfxClips = Array.isArray(parsed.sfxClips)
      ? parsed.sfxClips
          .filter(
            (s): s is ComposeSfxClip =>
              Boolean(s) &&
              typeof s.id === 'string' &&
              typeof s.label === 'string' &&
              (typeof s.srcUrl === 'string' || typeof s.assetId === 'string') &&
              !(typeof s.srcUrl === 'string' && s.srcUrl.startsWith('blob:')) &&
              typeof s.startSec === 'number' &&
              typeof s.durationSec === 'number',
          )
          .slice(0, MAX_COMPOSE_SFX)
          .map((s) =>
            normalizeSfxClip({
              ...s,
              srcUrl: typeof s.srcUrl === 'string' ? s.srcUrl : '',
              volume: typeof s.volume === 'number' ? s.volume : 0.85,
            }),
          )
      : [];
    const referenceAssetIds = Array.isArray(parsed.referenceAssetIds)
      ? parsed.referenceAssetIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : undefined;
    return {
      version: 1,
      aspect: parsed.aspect as ComposeAspect,
      clips,
      captions,
      bgm,
      ...(colorGrade ? { colorGrade } : {}),
      ...(overlays.length > 0 ? { overlays } : {}),
      ...(sfxClips.length > 0 ? { sfxClips } : {}),
      ...(referenceAssetIds && referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
    };
  } catch {
    return null;
  }
}
