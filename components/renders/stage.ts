import type { RenderJob } from '@/lib/renders/repo';
import { ASSET_TASK_PREFIX } from '@/lib/renders/repo';

/**
 * docs/PLATFORM-2.0.md §3.2-4 — the wait, told as three stages instead of one flat bar.
 *
 *   check  사진 확인  held · queued · running while the face asset is being made (`asset:` task)
 *   make   만드는 중  running against the provider
 *   finish 마무리     copying the result and sending the notice
 *
 * The service does not record `finish` as its own state: the provider's "done", the copy into our
 * storage and `markRenderSucceeded` happen in one pass. So a live job is never shown in `finish`
 * — it reads "making" until it is `succeeded`, and the page then shows the result instead of the
 * stages. Saying "finishing" earlier would be a guess dressed as progress.
 */
export const RENDER_STAGES = ['check', 'make', 'finish'] as const;
export type RenderStage = (typeof RENDER_STAGES)[number];
export type StageState = 'done' | 'current' | 'todo';

export function renderStage(job: Pick<RenderJob, 'status' | 'providerTaskId'>): RenderStage | null {
  switch (job.status) {
    case 'held':
    case 'queued':
      return 'check';
    case 'running':
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
