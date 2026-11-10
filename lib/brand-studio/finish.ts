/**
 * `finishing` -> `succeeded` | `failed` (docs/BRAND-STUDIO-V2.md §7, §8.3): download what the provider
 * (or the lane worker) made, composite a region edit back into its original, store result + thumbnail
 * in the media store, and settle the usage at the real cost. Each output is stored once: a retry only
 * touches outputs still `pending`.
 */
import type { StudioErrorCode } from './contracts';
import { kindOfMime, imageInfo, sha256Hex, sniffMime, thumbnailWebp, videoInfo } from './files';
import { dropWorkingFiles, failPendingOutputs, saveJob } from './job-store';
import { downloadResult } from './provider/download';
import type { JobRow, OutputRow, StudioDeps, StudioPendingResult } from './types';
import { usageKrw } from './usage';

const now = (deps: StudioDeps) => (deps.now?.() ?? new Date()).toISOString();

export async function fetchResult(deps: StudioDeps, url: string): Promise<{ bytes: Uint8Array; mime: string | null }> {
  // The provider downloads (the fake serves its own `fake://` files; Sunra's is a guarded https fetch).
  // With no API provider configured (account lane only), the same guarded download runs directly.
  return deps.provider ? deps.provider.download(url) : downloadResult(globalThis.fetch, url);
}

async function storeOne(deps: StudioDeps, job: JobRow, output: OutputRow, result: StudioPendingResult): Promise<void> {
  const fetched = await fetchResult(deps, result.url);
  let bytes = fetched.bytes;
  let mime = sniffMime(bytes);
  if (output.kind === 'image' ? !mime || kindOfMime(mime) !== 'image' : mime !== 'video/mp4' && mime !== 'video/quicktime') {
    throw new Error(`result is not ${output.kind} (${fetched.mime ?? 'unknown'})`);
  }
  const region = job.kind === 'region_edit' ? job.work.region : undefined;
  if (region) {
    const original = await deps.media.read(region.sourceKey);
    const composed = await deps.intel.compositeRegion({ original, edited: bytes, plan: region.plan });
    bytes = composed.bytes;
    mime = composed.mime;
  }
  const keys: string[] = [];
  try {
    const { key } = await deps.media.put(bytes, mime!);
    keys.push(key);
    let width: number | null = null, height: number | null = null, durationMs: number | null = null, thumbKey: string | null = null;
    if (output.kind === 'image') {
      const size = await imageInfo(bytes);
      width = size?.width ?? null;
      height = size?.height ?? null;
      thumbKey = (await deps.media.put(await thumbnailWebp(bytes), 'image/webp')).key;
      keys.push(thumbKey);
    } else {
      const info = videoInfo(bytes);
      width = info?.width ?? null;
      height = info?.height ?? null;
      durationMs = info?.durationMs ?? (typeof result.seconds === 'number' ? Math.round(result.seconds * 1000) : null);
    }
    const stored = (
      await deps.sql.query(
        `update brand_studio_outputs set status = 'ready', storage_key = $2, thumb_key = $3, mime = $4, bytes = $5, width = $6,
            height = $7, duration_ms = $8, sha256 = $9, draft_task_id = coalesce($10, draft_task_id)
          where id = $1 and status = 'pending' and deleted_at is null returning id`,
        [output.id, key, thumbKey, mime, bytes.byteLength, width, height, durationMs, sha256Hex(bytes), result.draftTaskId ?? null],
      )
    ).rows[0];
    if (!stored) throw new Error('output no longer pending');
  } catch (error) {
    for (const key of keys) await deps.media.delete(key).catch(() => undefined);
    throw error;
  }
}

/** Store every pending output that has a result; returns the job after settling, or null when it lost the lease. */
export async function finishJob(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  const outputs = (await deps.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [job.id])).rows;
  const work = { ...job.work, results: { ...(job.work.results ?? {}) }, failures: { ...(job.work.failures ?? {}) } };
  for (const output of outputs.filter((o) => o.status === 'pending')) {
    const key = String(output.idx);
    const result = work.results[key];
    if (result) {
      try {
        await storeOne(deps, job, output, result);
        continue;
      } catch (error) {
        deps.log?.('studio_store_failed', { jobId: job.id, idx: output.idx, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
        work.failures[key] = { code: 'failed', detail: error instanceof Error ? error.message.slice(0, 300) : 'store failed' };
      }
    } else if (!work.failures[key]) {
      work.failures[key] = { code: 'failed', detail: 'no result for this slot' };
    }
    await deps.sql.query("update brand_studio_outputs set status = 'failed' where id = $1 and status = 'pending'", [output.id]);
  }
  return settleJob(deps, job, token, work);
}

async function settleJob(deps: StudioDeps, job: JobRow, token: string, work: JobRow['work']): Promise<JobRow | null> {
  const outputs = (await deps.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [job.id])).rows;
  const ready = outputs.filter((o) => o.status === 'ready');
  const failures = Object.entries(work.failures ?? {});
  const detail = failures.map(([idx, f]) => `#${idx} ${f.code}: ${f.detail}`).join(' | ').slice(0, 1000) || null;
  await dropWorkingFiles(deps.media, work);
  if (ready.length === 0) {
    const code: StudioErrorCode = failures.find(([, f]) => f.code !== 'failed')?.[1].code ?? 'failed';
    return saveJob(deps.sql, job, token, { status: 'failed', error_code: code, error_detail: detail, work, finished_at: now(deps), usage_krw: 0 });
  }
  const share = Number(job.estimate_usd) / Math.max(1, outputs.length);
  const cost = ready.reduce((sum, o) => {
    const reported = work.results?.[String(o.idx)]?.costUsd;
    return sum + (typeof reported === 'number' && reported >= 0 ? reported : share);
  }, 0);
  const medium = job.kind === 'image' || job.kind === 'region_edit' ? 'image' : 'video';
  return saveJob(deps.sql, job, token, {
    status: 'succeeded',
    error_code: null,
    error_detail: detail,
    work,
    cost_usd: Math.round(cost * 10_000) / 10_000,
    usage_krw: usageKrw(cost, medium),
    finished_at: now(deps),
  });
}

/** A job that cannot go on: every pending slot fails, nothing is counted. */
export async function failJob(deps: StudioDeps, job: JobRow, token: string, code: StudioErrorCode, detail: string): Promise<JobRow | null> {
  const saved = await saveJob(deps.sql, job, token, {
    status: 'failed',
    error_code: code,
    error_detail: detail.slice(0, 1000),
    finished_at: now(deps),
    usage_krw: 0,
  });
  if (saved) {
    await failPendingOutputs(deps.sql, job.id);
    await dropWorkingFiles(deps.media, job.work);
  }
  return saved;
}
