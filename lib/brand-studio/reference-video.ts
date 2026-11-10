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
 * Whether a clip can be read into a blueprint: its length within the same bounds a reference may run
 * (the remake is 4–15 s, so a longer clip would be squeezed past usefulness). Picture size never matters.
 */
export function blueprintFit(
  model: Pick<StudioVideoModel, 'referenceVideoSeconds'>,
  video: { seconds: number | null | undefined },
): { readable: boolean; problem: 'length' | null } {
  const seconds = secondsOf(video.seconds);
  const time = model.referenceVideoSeconds;
  const problem = seconds !== null && (seconds < time.min || seconds > time.max) ? 'length' : null;
  return { readable: problem === null, problem };
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
