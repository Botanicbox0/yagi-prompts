/**
 * Whether a reference video is one the provider will take (docs/BRAND-STUDIO-V2.md §5.2), from its
 * measured length and size against the model's limits in the registry (lib/brand-studio/models.ts).
 * One implementation: the dock tells the customer before they spend, and the server refuses the same
 * cases with `invalid` (./plan.ts). A measurement that is missing never blocks.
 *
 * Client-safe: no db, no env, no server imports.
 */
import type { StudioVideoModel } from './models';

export type ReferenceVideoProblem = 'length' | 'small' | 'large';

export interface ReferenceVideoFit {
  /** Why the provider would refuse it, or null when it is usable (or unmeasured). */
  problem: ReferenceVideoProblem | null;
  /** "이 영상을 고치기" needs at least `editMin` seconds. */
  editable: boolean;
}

export function referenceVideoFit(
  model: Pick<StudioVideoModel, 'referenceVideoSeconds' | 'referenceVideoPixels'>,
  video: { seconds: number | null | undefined; width: number | null | undefined; height: number | null | undefined },
): ReferenceVideoFit {
  const time = model.referenceVideoSeconds;
  const size = model.referenceVideoPixels;
  const seconds = typeof video.seconds === 'number' && Number.isFinite(video.seconds) ? video.seconds : null;
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
