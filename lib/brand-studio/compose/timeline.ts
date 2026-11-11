/**
 * Declarative timeline state and pure operations for Brand Studio Video Composer
 * (`docs/BRAND-VIDEO-COMPOSE-D.md`).
 *
 * Client-safe and dependency-free: tested directly in Node and used by both the interactive timeline UI
 * and the chat-based timeline editor.
 */

export const COMPOSE_ASPECTS = ['9:16', '16:9', '4:5', '1:1'] as const;
export type ComposeAspect = (typeof COMPOSE_ASPECTS)[number];

export const COMPOSE_DIMENSIONS: Readonly<Record<ComposeAspect, { width: number; height: number }>> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
};

export type ComposeSourceKind = 'asset' | 'output' | 'local';
export type CaptionPosition = 'bottom' | 'center' | 'top';
export type CaptionSize = 'sm' | 'md' | 'lg';

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
}

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
}

export interface ComposerProject {
  version: 1;
  aspect: ComposeAspect;
  clips: ComposeClip[];
  captions: ComposeCaption[];
  bgm: ComposeBgm | null;
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
  | { op: 'remove_bgm' };

export const MIN_CLIP_PLAY_SEC = 0.3;
export const MAX_COMPOSE_CLIPS = 24;
export const MAX_COMPOSE_CAPTIONS = 32;

export function roundTenths(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function emptyComposerProject(aspect: ComposeAspect = '9:16'): ComposerProject {
  return {
    version: 1,
    aspect,
    clips: [],
    captions: [],
    bgm: null,
  };
}

export function composeStorageKey(organizationId: string): string {
  return `twings_studio_compose_v1:${organizationId}`;
}

export function normalizeClipBounds(clip: ComposeClip): ComposeClip {
  const full = Math.max(MIN_CLIP_PLAY_SEC, roundTenths(clip.durationSec || 5));
  const start = clamp(roundTenths(clip.trimStartSec), 0, Math.max(0, roundTenths(full - MIN_CLIP_PLAY_SEC)));
  const end = clamp(roundTenths(clip.trimEndSec), roundTenths(start + MIN_CLIP_PLAY_SEC), full);
  return {
    ...clip,
    durationSec: full,
    trimStartSec: start,
    trimEndSec: end,
    volume: clamp(Number.isFinite(clip.volume) ? Math.round(clip.volume * 100) / 100 : 1, 0, 1),
    muted: Boolean(clip.muted),
  };
}

export function clipPlayDuration(clip: ComposeClip): number {
  return Math.max(MIN_CLIP_PLAY_SEC, roundTenths(clip.trimEndSec - clip.trimStartSec));
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

export function frameStateAtTime(
  project: ComposerProject,
  timelineSec: number,
): {
  activeClip: { clip: ComposeClip; index: number; mediaTimeSec: number } | null;
  activeCaptions: ComposeCaption[];
  bgmTimeSec: number | null;
} {
  const spans = timelineSpans(project);
  const total = spans.length > 0 ? spans[spans.length - 1]!.timelineEndSec : 0;
  const t = clamp(timelineSec, 0, Math.max(0, total));
  let activeClip: { clip: ComposeClip; index: number; mediaTimeSec: number } | null = null;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]!;
    const isLast = i === spans.length - 1;
    if (t >= span.timelineStartSec && (t < span.timelineEndSec || (isLast && t <= span.timelineEndSec))) {
      const offset = clamp(t - span.timelineStartSec, 0, Math.max(0, span.durationSec - 0.001));
      activeClip = {
        clip: span.clip,
        index: span.index,
        mediaTimeSec: clamp(span.clip.trimStartSec + offset, span.clip.trimStartSec, span.clip.trimEndSec),
      };
      break;
    }
  }
  const activeCaptions = project.captions.filter((c) => c.text.trim() !== '' && t >= c.startSec && t <= c.endSec);
  let bgmTimeSec: number | null = null;
  if (project.bgm && project.bgm.volume > 0 && total > 0) {
    const bgmPlayable = Math.max(0.5, project.bgm.durationSec - project.bgm.trimStartSec);
    bgmTimeSec = project.bgm.trimStartSec + (t % bgmPlayable);
  }
  return { activeClip, activeCaptions, bgmTimeSec };
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

export function applyTimelinePatches(
  initial: ComposerProject,
  patches: readonly TimelinePatch[],
): { project: ComposerProject; appliedCount: number } {
  let current: ComposerProject = {
    version: 1,
    aspect: initial.aspect,
    clips: initial.clips.map((c) => normalizeClipBounds({ ...c })),
    captions: initial.captions.map((c) => ({ ...c })),
    bgm: initial.bgm ? { ...initial.bgm } : null,
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
        const updated = normalizeClipBounds({ ...target, trimStartSec: nextStart, trimEndSec: nextEnd });
        const clips = [...current.clips];
        clips[patch.clipIndex] = updated;
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
        current = { ...current, clips: current.clips.filter((_, idx) => idx !== patch.clipIndex) };
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
    }
  }

  return { project: current, appliedCount };
}

/** Drops ephemeral `blob:` URLs before saving to localStorage so reloaded tabs never point at dead blobs. */
export function serializeProjectForStorage(project: ComposerProject): string {
  const persistable: ComposerProject = {
    version: 1,
    aspect: project.aspect,
    clips: project.clips.filter((c) => c.sourceKind !== 'local' && !c.srcUrl.startsWith('blob:')),
    captions: project.captions,
    bgm: project.bgm && project.bgm.sourceKind !== 'local' && !project.bgm.srcUrl.startsWith('blob:') ? project.bgm : null,
  };
  return JSON.stringify(persistable);
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
              typeof c.srcUrl === 'string' &&
              !c.srcUrl.startsWith('blob:') &&
              typeof c.durationSec === 'number',
          )
          .slice(0, MAX_COMPOSE_CLIPS)
          .map(normalizeClipBounds)
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
      typeof parsed.bgm.srcUrl === 'string' &&
      !parsed.bgm.srcUrl.startsWith('blob:') &&
      typeof parsed.bgm.durationSec === 'number'
        ? {
            label: String(parsed.bgm.label ?? 'Music'),
            sourceKind: 'asset' as const,
            ...(typeof parsed.bgm.assetId === 'string' ? { assetId: parsed.bgm.assetId } : {}),
            srcUrl: parsed.bgm.srcUrl,
            durationSec: Math.max(0.5, Number(parsed.bgm.durationSec)),
            trimStartSec: clamp(Number(parsed.bgm.trimStartSec ?? 0), 0, Math.max(0, Number(parsed.bgm.durationSec) - 0.5)),
            volume: clamp(Number(parsed.bgm.volume ?? 0.4), 0, 1),
          }
        : null;
    return {
      version: 1,
      aspect: parsed.aspect as ComposeAspect,
      clips,
      captions,
      bgm,
    };
  } catch {
    return null;
  }
}
