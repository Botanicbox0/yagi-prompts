/**
 * Sound Studio composer v2: the one predicate that says whether a stored job (or a provider request built from
 * one) belongs to composer v2. It lives in its own file with type-only imports on purpose: `repo.ts`,
 * `engine.ts` and `provider/requests.ts` are loaded by plain scripts (`npm run db:local`) and must not pull in
 * `server-only` modules through `music-jobs.ts`.
 */
import type { StudioJobKind } from '../contracts';
import type { StudioJobParams, StudioJobWork } from '../types';

export interface MusicJobLike {
  kind?: StudioJobKind;
  model: string;
  params?: Pick<StudioJobParams, 'music'> | null;
  work?: Pick<StudioJobWork, 'lyricsDraftFailed' | 'minimaxDraft'> | null;
}

/**
 * Single shared predicate for whether a stored `JobRow` or `StudioRequestInput` belongs to Sound Studio composer v2.
 * Used across `prepareMusic`, `requestInputOf`, `musicRequestOf`, and `jobView`.
 */
export function isV2MusicJob(job: MusicJobLike): boolean {
  if (job.kind !== undefined && job.kind !== 'music') return false;
  const m = job.params?.music;
  return (
    job.model !== 'suno-v6' ||
    m?.composerMode !== undefined ||
    m?.titleSource !== undefined ||
    m?.durationSeconds !== undefined ||
    m?.durationSource !== undefined ||
    Boolean(job.work?.lyricsDraftFailed) ||
    Boolean(job.work?.minimaxDraft)
  );
}
