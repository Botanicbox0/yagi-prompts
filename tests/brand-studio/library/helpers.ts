import { randomUUID } from 'node:crypto';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { pngBytes, requestId } from '../server/helpers';

/** A finished image result of `orgId`, stored in the deps' media store. Returns the output id. */
export async function seedImageOutput(deps: StudioDeps, orgId: string, by: string): Promise<string> {
  const bytes = await pngBytes(32, 32);
  const { key } = await deps.media.put(bytes, 'image/png');
  const job = (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, finished_at)
        values ($1, $2, $3, 'image', 'succeeded', 'seedream-5-pro', 'a bottle', now()) returning id`,
      [orgId, by, requestId()],
    )
  ).rows[0]!.id;
  return (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, bytes, width, height)
        values ($1, $2, 0, 'image', 'ready', $3, 'image/png', $4, 32, 32) returning id`,
      [job, orgId, key, bytes.byteLength],
    )
  ).rows[0]!.id;
}

/** A second organization with its own owner, for cross-organization checks. */
export async function seedOtherOrganization(deps: StudioDeps, owner: string): Promise<string> {
  return (
    await deps.sql.query<{ id: string }>("insert into brand_organizations (name, created_by, request_id) values ('Other brand', $1, $2) returning id", [owner, randomUUID()])
  ).rows[0]!.id;
}
