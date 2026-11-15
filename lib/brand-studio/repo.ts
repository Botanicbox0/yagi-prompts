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
import { isStudioMediaKeyReferenced } from './physical-cleanup';
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

export function outputView(
  row: OutputRow,
  media: StudioMediaStore,
  extra?: {
    regionPatch?: StudioOutputView['regionPatch'];
    sourceRef?: StudioOutputView['sourceRef'];
  },
): StudioOutputView {
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
    ...(extra?.regionPatch !== undefined ? { regionPatch: extra.regionPatch } : {}),
    ...(extra?.sourceRef !== undefined ? { sourceRef: extra.sourceRef } : {}),
    createdAt: iso(row.created_at)!,
  };
}

export function jobView(row: JobRow, outputs: OutputRow[], media: StudioMediaStore): StudioJobView {
  const p = row.params ?? ({} as JobRow['params']);
  const closed = row.status === 'failed' || row.status === 'canceled';
  const remix = row.kind === 'video_remix';
  const regionSourceRef =
    row.kind === 'region_edit'
      ? p.source?.assetId
        ? { assetId: p.source.assetId }
        : row.parent_output_id
          ? { outputId: row.parent_output_id }
          : p.source?.outputId
            ? { outputId: p.source.outputId }
            : null
      : undefined;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    model: row.model,
    prompt: row.prompt,
    // Shown when the wording was changed before sending: by the enhancer, or by the one retry after a
    // safety-review block (lib/brand-studio/block-retry.ts). What was sent is never hidden from the customer.
    finalPrompt: row.enhance || row.work?.blockRetry?.source === 'model' || p.reviewedPrompt ? row.final_prompt : null,
    ...(p.reviewedPrompt ? { reviewed: true } : {}),
    expected: row.kind === 'image' ? Math.max(1, Number(p.count ?? 1)) : 1,
    aspect: p.aspect ?? null,
    resolution: p.resolution ?? null,
    ...(p.quality ? { quality: p.quality } : {}),
    seconds: p.seconds ?? null,
    audio: (p.audio ?? null) as StudioAudioMode | null,
    references: (Array.isArray(row.refs) ? row.refs : []) as StudioReference[],
    parentOutputId: row.parent_output_id,
    parentAssetId: row.kind === 'region_edit' ? (p.source?.assetId ?? null) : null,
    box: row.kind === 'region_edit' ? (p.box ?? null) : null,
    method: remix ? (p.method ?? null) : null,
    keep: remix && Array.isArray(p.keep) ? [...p.keep] : [],
    change: remix ? (p.change ?? '') : null,
    ...(remix && Array.isArray(p.shots) && p.shots.length ? { shots: p.shots.map((s) => ({ ...s })) } : {}),
    // A new version of an earlier clip (lib/brand-studio/revision). The base is read from the row's
    // foreign key, so it turns null once that result is deleted.
    ...(p.revision
      ? {
          revision: {
            rootJobId: p.revision.rootJobId,
            version: p.revision.version,
            baseOutputId: row.parent_output_id,
            mode: p.revision.mode,
            added: p.revision.added,
            ...(Array.isArray(p.revision.marks) && p.revision.marks.length
              ? { marks: p.revision.marks.map((m) => ({ ...m })) }
              : {}),
          },
        }
      : {}),
    outputs: outputs
      .filter((o) => o.job_id === row.id && o.status === 'ready' && !o.deleted_at && o.storage_key)
      .sort((a, b) => a.idx - b.idx)
      .map((o) => {
        const patch = row.work?.region?.patches?.[String(o.idx)];
        const regionPatch = patch
          ? {
              url: media.url(patch.patchKey),
              maskUrl: patch.maskKey ? media.url(patch.maskKey) : null,
              x: o.width && o.width > 0 ? patch.box.left / o.width : (p.box?.x ?? 0),
              y: o.height && o.height > 0 ? patch.box.top / o.height : (p.box?.y ?? 0),
              w: o.width && o.width > 0 ? patch.box.width / o.width : (p.box?.w ?? 1),
              h: o.height && o.height > 0 ? patch.box.height / o.height : (p.box?.h ?? 1),
            }
          : row.kind === 'region_edit'
            ? null
            : undefined;
        return outputView(o, media, { regionPatch, sourceRef: regionSourceRef });
      }),
    estimateKrw: closed ? 0 : Number(row.usage_krw ?? row.estimate_krw ?? 0),
    errorCode:
      row.status === 'failed'
        ? row.work?.region?.misaligned
          ? 'region_misaligned'
          : (row.error_code ?? 'failed')
        : null,
    createdAt: iso(row.created_at)!,
    finishedAt: iso(row.finished_at),
  };
}

/* ------------------------------------------------------------------ reads */

/**
 * `brand_studio_jobs.deleted_at` (migration 0089) may not exist yet where the code is already running.
 * A query naming a missing column would fail the whole request, so the column is looked up first: once
 * seen it is there for good; while missing it is looked up again after a minute, so applying the
 * migration needs no redeploy. Without it nothing is filtered and removing a run is not offered.
 */
const SOFT_DELETE_RECHECK_MS = 60_000;
let softDelete: { ready: boolean; at: number } | null = null;

export async function jobSoftDeleteReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (softDelete && (softDelete.ready || now - softDelete.at < SOFT_DELETE_RECHECK_MS)) return softDelete.ready;
  const found = await sql.query(
    `select 1 from information_schema.columns
      where table_schema = current_schema() and table_name = 'brand_studio_jobs' and column_name = 'deleted_at'`,
  );
  softDelete = { ready: found.rows.length > 0, at: now };
  return softDelete.ready;
}

/** Forget the lookup (tests change the schema under one process). */
export function resetJobSoftDeleteProbe(): void {
  softDelete = null;
}

/** The wall leaves out runs a member removed; `''` until the column exists. */
async function notRemoved(sql: SqlRunner): Promise<string> {
  return (await jobSoftDeleteReady(sql)) ? 'and deleted_at is null' : '';
}

export async function jobsOf(sql: SqlRunner, organizationId: string, limit = 60): Promise<JobRow[]> {
  const live = await notRemoved(sql);
  return (
    await sql.query<JobRow>(
      `select * from brand_studio_jobs
        where organization_id = $1 and model <> 'compose-1080p' ${live}
        order by created_at desc, id limit $2`,
      [organizationId, limit],
    )
  ).rows;
}

/**
 * R-08: Loads the newest `perMediumLimit` image-family jobs AND newest `perMediumLimit` video-family
 * jobs so a burst of image generations never evicts video studio history (and vice versa).
 */
export async function jobsOfStudioState(sql: SqlRunner, organizationId: string, perMediumLimit = 60): Promise<JobRow[]> {
  const live = await notRemoved(sql);
  const [imageJobs, videoJobs] = await Promise.all([
    sql.query<JobRow>(
      `select * from brand_studio_jobs
        where organization_id = $1 and kind in ('image', 'region_edit') ${live}
        order by created_at desc, id limit $2`,
      [organizationId, perMediumLimit],
    ),
    sql.query<JobRow>(
      `select * from brand_studio_jobs
        where organization_id = $1 and kind in ('video', 'video_remix', 'video_final') and model <> 'compose-1080p' ${live}
        order by created_at desc, id limit $2`,
      [organizationId, perMediumLimit],
    ),
  ]);
  return [...imageJobs.rows, ...videoJobs.rows].sort((a, b) => {
    const ta = a.created_at instanceof Date ? a.created_at.getTime() : new Date(String(a.created_at)).getTime();
    const tb = b.created_at instanceof Date ? b.created_at.getTime() : new Date(String(b.created_at)).getTime();
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  });
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

/** True when a live asset, output, storyboard cut, or room message other than the one being deleted still points at `key`. */
export async function keyStillUsed(sql: SqlRunner, key: string, except: { assetId?: string; outputId?: string }): Promise<boolean> {
  return isStudioMediaKeyReferenced(sql, key, except);
}
