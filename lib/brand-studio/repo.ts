/**
 * Rows <-> wire views, and the reads every studio module shares. SQL here never decides access:
 * callers pass an organization they already seated (./access.ts) and every query is scoped to it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type {
  StudioAssetView,
  StudioAudioMode,
  StudioJobView,
  StudioOutputView,
  StudioReference,
} from './contracts';
import type { StudioMediaStore } from './media-store';
import type { AssetRow, JobRow, OutputRow } from './types';

const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const seconds = (ms: number | null | undefined): number | null => (ms == null ? null : Math.round(Number(ms) / 100) / 10);

export function tagsOf(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{')) {
    const inner = value.slice(1, -1);
    return inner ? inner.split(',').map((t) => t.replace(/^"|"$/g, '')) : [];
  }
  return [];
}

export function assetView(row: AssetRow, media: StudioMediaStore): StudioAssetView {
  return {
    id: row.id,
    kind: row.kind,
    role: row.role,
    name: row.name,
    tags: tagsOf(row.tags),
    url: media.url(row.storage_key),
    thumbUrl: row.thumb_key ? media.url(row.thumb_key) : null,
    width: row.width,
    height: row.height,
    seconds: seconds(row.duration_ms),
    source: row.source,
    createdAt: iso(row.created_at)!,
  };
}

export function outputView(row: OutputRow, media: StudioMediaStore): StudioOutputView {
  return {
    id: row.id,
    jobId: row.job_id,
    kind: row.kind,
    url: media.url(row.storage_key!),
    thumbUrl: row.thumb_key ? media.url(row.thumb_key) : null,
    width: row.width,
    height: row.height,
    seconds: seconds(row.duration_ms),
    draft: row.is_draft && Boolean(row.draft_task_id),
    savedAssetId: row.saved_asset_id,
    createdAt: iso(row.created_at)!,
  };
}

export function jobView(row: JobRow, outputs: OutputRow[], media: StudioMediaStore): StudioJobView {
  const p = row.params ?? ({} as JobRow['params']);
  const closed = row.status === 'failed' || row.status === 'canceled';
  const remix = row.kind === 'video_remix';
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    model: row.model,
    prompt: row.prompt,
    // Shown when the wording was changed before sending: by the enhancer, or by the one retry after a
    // safety-review block (lib/brand-studio/block-retry.ts). What was sent is never hidden from the customer.
    finalPrompt: row.enhance || row.work?.blockRetry?.source === 'model' ? row.final_prompt : null,
    expected: row.kind === 'image' ? Math.max(1, Number(p.count ?? 1)) : 1,
    aspect: p.aspect ?? null,
    resolution: p.resolution ?? null,
    seconds: p.seconds ?? null,
    audio: (p.audio ?? null) as StudioAudioMode | null,
    references: (Array.isArray(row.refs) ? row.refs : []) as StudioReference[],
    parentOutputId: row.parent_output_id,
    parentAssetId: row.kind === 'region_edit' ? (p.source?.assetId ?? null) : null,
    box: row.kind === 'region_edit' ? (p.box ?? null) : null,
    method: remix ? (p.method ?? null) : null,
    keep: remix && Array.isArray(p.keep) ? [...p.keep] : [],
    change: remix ? (p.change ?? '') : null,
    outputs: outputs
      .filter((o) => o.job_id === row.id && o.status === 'ready' && !o.deleted_at && o.storage_key)
      .sort((a, b) => a.idx - b.idx)
      .map((o) => outputView(o, media)),
    estimateKrw: closed ? 0 : Number(row.usage_krw ?? row.estimate_krw ?? 0),
    errorCode: row.status === 'failed' ? (row.error_code ?? 'failed') : null,
    createdAt: iso(row.created_at)!,
    finishedAt: iso(row.finished_at),
  };
}

/* ------------------------------------------------------------------ reads */

export async function jobsOf(sql: SqlRunner, organizationId: string, limit = 60): Promise<JobRow[]> {
  return (
    await sql.query<JobRow>('select * from brand_studio_jobs where organization_id = $1 order by created_at desc, id limit $2', [organizationId, limit])
  ).rows;
}

export async function jobsByIds(sql: SqlRunner, organizationId: string, ids: readonly string[]): Promise<JobRow[]> {
  if (ids.length === 0) return [];
  return (
    await sql.query<JobRow>(
      'select * from brand_studio_jobs where organization_id = $1 and id = any($2::uuid[]) order by created_at desc, id',
      [organizationId, [...ids]],
    )
  ).rows;
}

export async function outputsOfJobs(sql: SqlRunner, jobIds: readonly string[]): Promise<OutputRow[]> {
  if (jobIds.length === 0) return [];
  return (await sql.query<OutputRow>('select * from brand_studio_outputs where job_id = any($1::uuid[]) order by job_id, idx', [[...jobIds]])).rows;
}

export async function viewsOf(sql: SqlRunner, jobs: JobRow[], media: StudioMediaStore): Promise<StudioJobView[]> {
  const outputs = await outputsOfJobs(sql, jobs.map((j) => j.id));
  return jobs.map((j) => jobView(j, outputs, media));
}

export async function assetsOf(sql: SqlRunner, organizationId: string, limit = 600): Promise<AssetRow[]> {
  return (
    await sql.query<AssetRow>(
      `select * from brand_studio_assets where organization_id = $1 and status = 'ready' and deleted_at is null
        order by created_at desc, id limit $2`,
      [organizationId, limit],
    )
  ).rows;
}

/** A live, ready library entry of this organization. */
export async function readyAsset(sql: SqlRunner, organizationId: string, id: string): Promise<AssetRow | null> {
  return (
    (
      await sql.query<AssetRow>(
        "select * from brand_studio_assets where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null",
        [id, organizationId],
      )
    ).rows[0] ?? null
  );
}

/** A live, ready result of this organization. */
export async function readyOutput(sql: SqlRunner, organizationId: string, id: string): Promise<OutputRow | null> {
  return (
    (
      await sql.query<OutputRow>(
        "select * from brand_studio_outputs where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null",
        [id, organizationId],
      )
    ).rows[0] ?? null
  );
}

export async function campaignsOf(sql: SqlRunner, organizationId: string): Promise<Array<{ id: string; title: string }>> {
  return (
    await sql.query<{ id: string; title: string }>(
      `select id, title from brand_projects where organization_id = $1 and client_visible
          and status not in ('completed','cancelled') order by updated_at desc limit 50`,
      [organizationId],
    )
  ).rows.map((r) => ({ id: String(r.id), title: String(r.title) }));
}

export async function openJobCount(sql: SqlRunner, organizationId: string): Promise<number> {
  return Number(
    (
      await sql.query<{ n: number }>(
        "select count(*)::int as n from brand_studio_jobs where organization_id = $1 and status in ('held','queued','running','finishing')",
        [organizationId],
      )
    ).rows[0]?.n ?? 0,
  );
}

/** True when a live asset or output other than the one being deleted still points at `key`. */
export async function keyStillUsed(sql: SqlRunner, key: string, except: { assetId?: string; outputId?: string }): Promise<boolean> {
  const row = (
    await sql.query(
      `select 1 from brand_studio_assets where deleted_at is null and (storage_key = $1 or thumb_key = $1) and id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       union all
       select 1 from brand_studio_outputs where deleted_at is null and (storage_key = $1 or thumb_key = $1) and id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       limit 1`,
      [key, except.assetId ?? null, except.outputId ?? null],
    )
  ).rows[0];
  return Boolean(row);
}
