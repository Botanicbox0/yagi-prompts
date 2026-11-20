/**
 * The one retry a run gets after a provider's safety review stopped it (docs/BRAND-STUDIO-V2.md §8.4).
 * Both lanes use this: the API lane when every result came back rejected, the account lane when its
 * worker reports a rejection. The wording is rewritten by lib/brand-studio/enhancer/blocked.ts; the
 * retry passes through the same review again, and a run is never retried twice.
 */
import { studioModel } from './models';
import { sendPrompt } from './prepare';
import type { JobRow, StudioDeps, StudioJobWork } from './types';

export interface BlockRetryPlan {
  finalPrompt: string;
  work: StudioJobWork;
  source: 'model' | 'same';
}

/** Null when the run may not be retried: it already was, it is a 1080p final, or the request is what the review is for. */
export async function planBlockRetry(deps: Pick<StudioDeps, 'intel' | 'intelDeps' | 'log'>, job: JobRow): Promise<BlockRetryPlan | null> {
  // Music and sound effects have no rewording pass: a blocked description fails and takes nothing (docs/BRAND-SOUND-STUDIO.md §5).
  if (job.work.blockRetry || job.kind === 'video_final' || job.kind === 'music' || job.kind === 'sound_effect') return null;
  const model = studioModel(job.model);
  const rewrite = deps.intel.rewriteBlockedPrompt;
  if (!model || !rewrite) return null;
  const blocked = sendPrompt(job);
  const answer = await rewrite({ prompt: blocked, kind: job.kind, profile: model.promptProfile }, deps.intelDeps);
  if (answer.action === 'stop') {
    deps.log?.('studio_block_final', { jobId: job.id });
    return null;
  }
  deps.log?.('studio_block_retry', { jobId: job.id, source: answer.source });
  return {
    finalPrompt: answer.prompt,
    source: answer.source,
    work: { ...job.work, results: {}, failures: {}, blockRetry: { source: answer.source }, blockedPrompt: blocked.slice(0, 6000) },
  };
}
