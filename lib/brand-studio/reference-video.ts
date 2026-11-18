/**
 * Whether a reference video is one the provider will take (docs/BRAND-STUDIO-V2.md §5.2), from its
 * measured length and size against the model's limits in the registry (lib/brand-studio/models.ts).
 * One implementation: the dock tells the customer before they spend, and the server refuses the same
 * cases with `invalid` (./plan.ts). A measurement that is missing never blocks.
 *
 * The blueprint method (docs/BRAND-STUDIO-V3.md §6) only reads the video and never attaches it, so the
 * provider's picture-size limits do not apply to it; only the length the shot plan works with does.
 *
 * Client-safe: no db, no env, no server imports.
 */
import { STUDIO_SHOT_LIMITS, type FilmShot } from './contracts';
import type { StudioVideoModel } from './models';

export type ReferenceVideoProblem = 'length' | 'small' | 'large';

export interface ReferenceVideoFit {
  /** Why the provider would refuse it, or null when it is usable (or unmeasured). */
  problem: ReferenceVideoProblem | null;
  /** "이 영상을 고치기" needs at least `editMin` seconds. */
  editable: boolean;
}

function secondsOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function referenceVideoFit(
  model: Pick<StudioVideoModel, 'referenceVideoSeconds' | 'referenceVideoPixels'>,
  video: { seconds: number | null | undefined; width: number | null | undefined; height: number | null | undefined },
): ReferenceVideoFit {
  const time = model.referenceVideoSeconds;
  const size = model.referenceVideoPixels;
  const seconds = secondsOf(video.seconds);
  const w = video.width ?? null;
  const h = video.height ?? null;
  const area = w && h ? w * h : null;
  const problem: ReferenceVideoProblem | null =
    seconds !== null && (seconds < time.min || seconds > time.max)
      ? 'length'
      : area !== null && (area < size.min || Math.min(w!, h!) < size.minSide)
        ? 'small'
        : area !== null && area > size.max
          ? 'large'
          : null;
  return { problem, editable: problem === null && (seconds === null || seconds >= time.editMin) };
}

/**
 * Whether a clip can be read into a blueprint: up to `STUDIO_SHOT_LIMITS.secondsMax` (600 s), since
 * the video is only read into a shot plan and never sent to the generator as raw video input.
 * Picture size never matters.
 */
export function blueprintFit(
  model: Pick<StudioVideoModel, 'referenceVideoSeconds'>,
  video: { seconds: number | null | undefined },
): { readable: boolean; problem: 'length' | null } {
  const seconds = secondsOf(video.seconds);
  const time = model.referenceVideoSeconds;
  const problem =
    seconds !== null && (seconds < time.min || seconds > STUDIO_SHOT_LIMITS.secondsMax) ? 'length' : null;
  return { readable: problem === null, problem };
}

export interface MultiClipWindow {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface MultiClipPlan {
  clipCount: number;
  clipDurations: number[];
  windows: MultiClipWindow[];
  sweetSpotWarning: boolean;
}

/**
 * Splits a requested total output duration into 1 clip (4–15 s) or 2–4 coherent clips (4–15 s each)
 * so long reference formats (> 15 s or > 30 s) can be generated concurrently without hitting the
 * per-clip Seedance 15 s generation cap or 30 s raw-video input cap.
 */
export function planMultiClipGeneration(input: {
  referenceSeconds: number | null;
  targetTotalSeconds: number;
  clipCount?: number;
  maxPerClipSeconds?: number;
}): MultiClipPlan {
  const minPerClip = 4;
  const maxPerClip = Math.min(15, Math.max(minPerClip, Math.round(input.maxPerClipSeconds ?? 15)));
  const rawTotal = Number.isFinite(input.targetTotalSeconds) ? Math.round(input.targetTotalSeconds) : maxPerClip;
  const wantsMulti = rawTotal > maxPerClip || (input.clipCount !== undefined && input.clipCount >= 2);

  if (!wantsMulti) {
    const dur = Math.min(maxPerClip, Math.max(minPerClip, rawTotal));
    return {
      clipCount: 1,
      clipDurations: [dur],
      windows: [{ index: 0, startSec: 0, endSec: dur, durationSec: dur }],
      sweetSpotWarning: dur > 30 || rawTotal > 30,
    };
  }

  const count =
    input.clipCount !== undefined && input.clipCount >= 2
      ? Math.min(4, Math.max(2, Math.round(input.clipCount)))
      : Math.min(4, Math.max(2, Math.ceil(rawTotal / maxPerClip)));

  const clampedTotal = Math.min(count * maxPerClip, Math.max(count * minPerClip, rawTotal));
  const base = Math.floor(clampedTotal / count);
  const rem = clampedTotal - base * count;
  const clipDurations = Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));

  let cursor = 0;
  const windows: MultiClipWindow[] = clipDurations.map((durationSec, index) => {
    const startSec = round1(cursor);
    const endSec = round1(cursor + durationSec);
    cursor = endSec;
    return { index, startSec, endSec, durationSec };
  });

  const totalPlanned = clipDurations.reduce((sum, n) => sum + n, 0);
  return {
    clipCount: count,
    clipDurations,
    windows,
    sweetSpotWarning: totalPlanned > 30 || rawTotal > 30,
  };
}

/**
 * A run whose length follows its reference video (the provider's `duration: -1`): an edit, or a new take
 * with a reference video whose length was not picked. A blueprint never sends its video and always has a length.
 */
export function followsReferenceLength(kind: string, params: { method?: string | null; seconds?: number | null }): boolean {
  return kind === 'video_remix' && params.method !== 'blueprint' && (params.method === 'edit' || typeof params.seconds !== 'number');
}

/**
 * A 480p draft that a 1080p final can be made from: asked for as a draft, at a length of its own. The account
 * lane's CLI says a run that follows its reference (`duration: -1`) cannot be a preview; the API's documentation
 * does not say either way and it has never been tried. So neither lane makes one: such a run is asked for as the
 * standard 480p run at the same price, and no final is offered for it (docs/BRAND-STUDIO-LANE-WORKER.md).
 */
export function isDraftRun(kind: string, params: { resolution?: string | null; method?: string | null; seconds?: number | null }): boolean {
  return (kind === 'video' || kind === 'video_remix') && params.resolution === 'draft' && !followsReferenceLength(kind, params);
}

/**
 * The length a remake runs when the customer did not pick one: the reference's, rounded into the model's
 * range. Rounded from tenths, the precision a screen sees (`StudioAssetView.seconds`), so both sides agree.
 */
export function remakeSeconds(
  model: Pick<StudioVideoModel, 'minSeconds' | 'maxSeconds' | 'defaultSeconds'>,
  referenceSeconds: number | null | undefined,
): number {
  const seconds = secondsOf(referenceSeconds);
  const tenths = seconds === null ? null : Math.round(seconds * 10) / 10;
  return Math.min(model.maxSeconds, Math.max(model.minSeconds, Math.round(tenths ?? model.defaultSeconds)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const flat = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, STUDIO_SHOT_LIMITS.fieldMax);

/**
 * A shot table as the server keeps it: sorted, times clamped to the reference (when measured) and
 * rounded to 0.1 s, shots shorter than 0.1 s dropped, text flattened and bounded. Gaps and overlaps are
 * left for the shot plan to close (lib/brand-studio/enhancer/blueprint.ts lays them end to end).
 */
export function normalizeShots(shots: readonly FilmShot[], referenceSeconds: number | null | undefined): FilmShot[] {
  const limit = secondsOf(referenceSeconds) ?? STUDIO_SHOT_LIMITS.secondsMax;
  const clamp = (n: number) => round1(Math.min(limit, Math.max(0, n)));
  return shots
    .map((s): FilmShot => {
      const move = s.move ? { travel: flat(s.move.travel), turn: flat(s.move.turn), zoom: flat(s.move.zoom) } : undefined;
      const transition = flat(s.transition);
      return {
        start: clamp(Math.min(s.start, s.end)),
        end: clamp(Math.max(s.start, s.end)),
        framing: flat(s.framing),
        camera: flat(s.camera),
        action: flat(s.action),
        ...(transition ? { transition } : {}),
        ...(move ? { move } : {}),
      };
    })
    .filter((s) => s.end - s.start >= 0.1)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, STUDIO_SHOT_LIMITS.shotsMax);
}

/**
 * Slices a blueprint shot table for one window of a multi-clip generation, shifting and scaling the
 * part's cuts onto `[0, sourceSpan]` so `blueprintShots(window.durationSec, sheet)` lays them out
 * across that clip's exact duration.
 */
export function sliceShotsForWindow(
  shots: readonly FilmShot[],
  referenceSeconds: number | null | undefined,
  window: MultiClipWindow,
  totalPlannedSeconds: number,
): FilmShot[] {
  if (!shots.length || totalPlannedSeconds <= 0 || window.durationSec <= 0) return [];
  const cleaned = normalizeShots(shots, referenceSeconds);
  if (!cleaned.length) return [];
  const sourceSpan = Math.max(secondsOf(referenceSeconds) ?? 0, ...cleaned.map((s) => s.end));
  if (!(sourceSpan > 0)) return [];

  const sliceStart = (window.startSec / totalPlannedSeconds) * sourceSpan;
  const sliceEnd = (window.endSec / totalPlannedSeconds) * sourceSpan;
  const sliceLen = sliceEnd - sliceStart;
  if (!(sliceLen >= 0.1)) return [];

  const scale = sourceSpan / sliceLen;
  const overlapped = cleaned
    .filter((s) => s.end > sliceStart + 0.02 && s.start < sliceEnd - 0.02)
    .map((s): FilmShot => {
      const relStart = Math.max(0, s.start - sliceStart) * scale;
      const relEnd = Math.min(sliceLen, s.end - sliceStart) * scale;
      return {
        ...s,
        start: round1(Math.max(0, Math.min(sourceSpan, relStart))),
        end: round1(Math.max(0, Math.min(sourceSpan, relEnd))),
      };
    })
    .filter((s) => s.end - s.start >= 0.1);

  if (!overlapped.length) {
    const mid = (sliceStart + sliceEnd) / 2;
    const nearest =
      cleaned.find((s) => s.start <= mid && s.end >= mid) ??
      cleaned[Math.min(cleaned.length - 1, Math.floor((window.index / Math.max(1, totalPlannedSeconds)) * cleaned.length))] ??
      cleaned[0]!;
    return [{ ...nearest, start: 0, end: round1(sourceSpan) }];
  }

  overlapped[0] = { ...overlapped[0]!, start: 0 };
  overlapped[overlapped.length - 1] = { ...overlapped[overlapped.length - 1]!, end: round1(sourceSpan) };
  return normalizeShots(overlapped, sourceSpan);
}
