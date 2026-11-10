import type { StudioDeps } from '@/lib/brand-studio/types';
import type { ReviewDeps } from '@/lib/brand-studio/review';
import { pngBytes, requestId } from '../server/helpers';

/** Put a finished job with one ready result straight into the board and return the result's id. */
export async function seedOutput(deps: StudioDeps, orgId: string, by: string, kind: 'image' | 'video' = 'image'): Promise<string> {
  const bytes = kind === 'image' ? await pngBytes(40, 50) : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const { key } = await deps.media.put(bytes, kind === 'image' ? 'image/png' : 'video/mp4');
  const job = (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, finished_at)
         values ($1, $2, $3, $4, 'succeeded', 'fixture-model', 'a blue bottle on white marble', now()) returning id`,
      [orgId, by, requestId(), kind],
    )
  ).rows[0]!.id;
  return (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, width, height, duration_ms)
         values ($1, $2, 0, $3, 'ready', $4, 1080, 1350, $5) returning id`,
      [job, orgId, kind, key, kind === 'video' ? 6000 : null],
    )
  ).rows[0]!.id;
}

export const reviewDeps = (deps: StudioDeps): ReviewDeps => ({ sql: deps.sql, media: deps.media });
