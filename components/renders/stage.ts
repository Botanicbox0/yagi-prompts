import type { RenderJob } from '@/lib/renders/repo';
import { ASSET_TASK_PREFIX } from '@/lib/renders/repo';

/**
 * docs/PLATFORM-2.0.md §3.2-4 — the wait, told as three stages instead of one flat bar.
 *
 *   check  사진 확인  held · queued · running while the face asset is being made (`asset:` task)
 *   make   만드는 중  running against the provider
 *   finish 마무리     copying the result and sending the notice
 *
 * `finish` is real since 0055: the pass writes `render_jobs.finishing_at` the moment the provider
 * says done and before it copies the result into our storage (`lib/renders/extras.ts`), so a job
 * still `running` with that timestamp is in its last stage. Without the timestamp (or before 0055)
 * a live job reads "making" until it is `succeeded` — saying "finishing" earlier would be a guess
 * dressed as progress.
 */
export const RENDER_STAGES = ['check', 'make', 'finish'] as const;
export type RenderStage = (typeof RENDER_STAGES)[number];
export type StageState = 'done' | 'current' | 'todo';

export function renderStage(job: Pick<RenderJob, 'status' | 'providerTaskId'> & { finishingAt?: string | null }): RenderStage | null {
  switch (job.status) {
    case 'held':
    case 'queued':
      return 'check';
    case 'running':
      if (job.finishingAt) return 'finish';
      return job.providerTaskId !== null && job.providerTaskId.startsWith(ASSET_TASK_PREFIX) ? 'check' : 'make';
    case 'succeeded':
      return 'finish';
    default:
      return null;
  }
}

export function stageSteps(stage: RenderStage): Array<{ key: RenderStage; state: StageState }> {
  const at = RENDER_STAGES.indexOf(stage);
  return RENDER_STAGES.map((key, index) => ({ key, state: index < at ? 'done' : index === at ? 'current' : 'todo' }));
}
