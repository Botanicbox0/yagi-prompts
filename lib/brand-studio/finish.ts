/**
 * `finishing` -> `succeeded` | `failed` (docs/BRAND-STUDIO-V2.md §7, §8.3): download what the provider
 * (or the lane worker) made, composite a region edit back into its original, store result + thumbnail
 * in the media store, and settle the usage at the real cost. Each output is stored once: a retry only
 * touches outputs still `pending`.
 */
import { adjustOrganizationStorageBytes } from '@/lib/brands/storage-quota';
import type { StudioErrorCode } from './contracts';
import { kindOfMime, imageInfo, sha256Hex, sniffMime, thumbnailWebp, videoInfo } from './files';
import { dropWorkingFiles, failPendingOutputs, saveJob } from './job-store';
import { downloadResult } from './provider/download';
import type { JobRow, OutputRow, StudioDeps, StudioPendingResult } from './types';
import { settledUsageKrw } from './usage-rate';

const now = (deps: StudioDeps) => (deps.now?.() ?? new Date()).toISOString();

export async function fetchResult(deps: StudioDeps, url: string): Promise<{ bytes: Uint8Array; mime: string | null }> {
  // The provider downloads (the fake serves its own `fake://` files; Sunra's is a guarded https fetch).
  // With no API provider configured (account lane only), the same guarded download runs directly.
  return deps.provider ? deps.provider.download(url) : downloadResult(globalThis.fetch, url);
}

class RegionMisalignedError extends Error {
  readonly residual: number;
  constructor(residual: number) {
    super(`region_misaligned (residual=${residual.toFixed(2)})`);
    this.residual = residual;
  }
}

interface StoredPatch {
  patchKey: string;
  maskKey: string | null;
  box: { left: number; top: number; width: number; height: number };
}

async function storeOne(deps: StudioDeps, job: JobRow, output: OutputRow, result: StudioPendingResult): Promise<StoredPatch | null> {
  const fetched = await fetchResult(deps, result.url);
  let bytes = fetched.bytes;
  let mime = sniffMime(bytes);
  if (output.kind === 'image' ? !mime || kindOfMime(mime) !== 'image' : mime !== 'video/mp4' && mime !== 'video/quicktime') {
    throw new Error(`result is not ${output.kind} (${fetched.mime ?? 'unknown'})`);
  }
  const region = job.kind === 'region_edit' ? job.work.region : undefined;
  let patchPng: Buffer | undefined;
  let maskPng: Buffer | undefined;
  let patchBox = region?.plan.box;
  if (region) {
    const original = await deps.media.read(region.sourceKey);
    const composed = await deps.intel.compositeRegion({ original, edited: bytes, plan: region.plan });
    const bypassFake = deps.provider?.name === 'fake' && !job.prompt.includes('[[fake:misalign]]');
    if (composed.misaligned && !bypassFake) {
      throw new RegionMisalignedError(composed.ringResidual ?? 0);
    }
    bytes = composed.bytes;
    mime = composed.mime;
    patchPng = composed.patchPng;
    maskPng = composed.maskPng;
    // Region edit v2 may widen the paste zone; the patch covers the zone it used.
    if (composed.box) patchBox = composed.box;
  }
  const keys: string[] = [];
  try {
    const { key } = await deps.media.put(bytes, mime!);
    keys.push(key);
    let width: number | null = null, height: number | null = null, durationMs: number | null = null, thumbKey: string | null = null;
    let storedPatch: StoredPatch | null = null;
    if (output.kind === 'image') {
      const size = await imageInfo(bytes);
      width = size?.width ?? null;
      height = size?.height ?? null;
      thumbKey = (await deps.media.put(await thumbnailWebp(bytes), 'image/webp')).key;
      keys.push(thumbKey);
      if (region && patchPng) {
        const patchKey = (await deps.media.put(patchPng, 'image/png')).key;
        keys.push(patchKey);
        let maskKey: string | null = null;
        if (maskPng) {
          maskKey = (await deps.media.put(maskPng, 'image/png')).key;
          keys.push(maskKey);
        }
        storedPatch = { patchKey, maskKey, box: { ...(patchBox ?? region.plan.box) } };
      }
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
        // A draft id is kept only on a result planned as a draft (./reference-video.ts `isDraftRun`), whatever
        // a lane reports: "finish at 1080p" is offered from it, and the provider refuses any other task id.
        [output.id, key, thumbKey, mime, bytes.byteLength, width, height, durationMs, sha256Hex(bytes), output.is_draft ? (result.draftTaskId ?? null) : null],
      )
    ).rows[0];
    if (!stored) throw new Error('output no longer pending');
    await adjustOrganizationStorageBytes(deps.sql, job.organization_id, bytes.byteLength);
    return storedPatch;
  } catch (error) {
    for (const key of keys) await deps.media.delete(key).catch(() => undefined);
    throw error;
  }
}

/** Tries per result before a stored-result failure is final. */
const STORE_ATTEMPTS = 3;
/** Failures another try cannot fix: the file is the wrong kind, refused, or too large. */
const PERMANENT_STORE_ERROR = /^result is not |refused address|too large|no longer pending/;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

/** Store every pending output that has a result; returns the job after settling, or null when it lost the lease. */
export async function finishJob(deps: StudioDeps, job: JobRow, token: string): Promise<JobRow | null> {
  const outputs = (await deps.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [job.id])).rows;
  const work = { ...job.work, results: { ...(job.work.results ?? {}) }, failures: { ...(job.work.failures ?? {}) } };
  let retry = false;
  let requeueForAlign = false;
  for (const output of outputs.filter((o) => o.status === 'pending')) {
    const key = String(output.idx);
    const result = work.results[key];
    if (result) {
      try {
        const storedPatch = await storeOne(deps, job, output, result);
        if (storedPatch && work.region) {
          work.region = {
            ...work.region,
            patches: { ...(work.region.patches ?? {}), [key]: storedPatch },
          };
        }
        continue;
      } catch (error) {
        if (error instanceof RegionMisalignedError && work.region) {
          const prevAlignAttempts = work.region.alignAttempts?.[key] ?? 0;
          deps.log?.('studio_region_misaligned', {
            jobId: job.id,
            idx: output.idx,
            attempt: prevAlignAttempts + 1,
            residual: Math.round(error.residual * 100) / 100,
          });
          if (prevAlignAttempts < 1) {
            work.region = {
              ...work.region,
              alignAttempts: { ...(work.region.alignAttempts ?? {}), [key]: prevAlignAttempts + 1 },
            };
            delete work.results[key];
            delete work.failures[key];
            await deps.sql.query(
              "update brand_studio_outputs set provider_task_id = null where id = $1 and status = 'pending'",
              [output.id],
            );
            requeueForAlign = true;
            continue;
          }
          work.region = { ...work.region, misaligned: true };
          work.failures[key] = { code: 'failed', detail: error.message.slice(0, 300) };
          await deps.sql.query("update brand_studio_outputs set status = 'failed' where id = $1 and status = 'pending'", [output.id]);
          continue;
        }
        const message = error instanceof Error ? error.message : 'store failed';
        const attempts = (work.storeAttempts?.[key] ?? 0) + 1;
        work.storeAttempts = { ...(work.storeAttempts ?? {}), [key]: attempts };
        deps.log?.('studio_store_failed', { jobId: job.id, idx: output.idx, attempt: attempts, host: hostOf(result.url), message: message.slice(0, 200) });
        // The provider already made (and charged for) this result. A slow or dropped download is ours to
        // retry, not the customer's failure: the job stays `finishing` and the next pass tries again.
        if (attempts < STORE_ATTEMPTS && !PERMANENT_STORE_ERROR.test(message)) {
          retry = true;
          continue;
        }
        work.failures[key] = { code: 'failed', detail: message.slice(0, 300) };
      }
    } else if (!work.failures[key]) {
      work.failures[key] = { code: 'failed', detail: 'no result for this slot' };
    }
    await deps.sql.query("update brand_studio_outputs set status = 'failed' where id = $1 and status = 'pending'", [output.id]);
  }
  if (requeueForAlign) {
    return saveJob(deps.sql, job, token, { status: 'queued', started_at: null, attempts: 0, work });
  }
  if (retry) return saveJob(deps.sql, job, token, { work });
  return settleJob(deps, job, token, work);
}

async function settleJob(deps: StudioDeps, job: JobRow, token: string, work: JobRow['work']): Promise<JobRow | null> {
  const outputs = (await deps.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [job.id])).rows;
  const ready = outputs.filter((o) => o.status === 'ready');
  const failures = Object.entries(work.failures ?? {});
  const detail = failures.map(([idx, f]) => `#${idx} ${f.code}: ${f.detail}`).join(' | ').slice(0, 1000) || null;
  await dropWorkingFiles(deps.media, work);
  if (ready.length === 0) {
    const rawCode: StudioErrorCode = failures.find(([, f]) => f.code !== 'failed')?.[1].code ?? 'failed';
    const dbCode: StudioErrorCode = rawCode === 'region_misaligned' ? 'failed' : rawCode;
    return saveJob(deps.sql, job, token, { status: 'failed', error_code: dbCode, error_detail: detail, work, finished_at: now(deps), usage_krw: 0 });
  }
  // What the provider charged, kept for our own margin only. It never changes what the run takes.
  const share = Number(job.estimate_usd) / Math.max(1, outputs.length);
  const cost = ready.reduce((sum, o) => {
    const reported = work.results?.[String(o.idx)]?.costUsd;
    return sum + (typeof reported === 'number' && reported >= 0 ? reported : share);
  }, 0);
  return saveJob(deps.sql, job, token, {
    status: 'succeeded',
    error_code: null,
    error_detail: detail,
    work,
    cost_usd: Math.round(cost * 10_000) / 10_000,
    usage_krw: settledUsageKrw(Number(job.estimate_krw), outputs.length, ready.length),
    finished_at: now(deps),
  });
}

/** A job that cannot go on: every pending slot fails, nothing is counted. */
export async function failJob(deps: StudioDeps, job: JobRow, token: string, code: StudioErrorCode, detail: string): Promise<JobRow | null> {
  const isMisaligned = code === 'region_misaligned';
  const dbCode: StudioErrorCode = isMisaligned ? 'failed' : code;
  const work =
    isMisaligned && job.work.region
      ? { ...job.work, region: { ...job.work.region, misaligned: true } }
      : undefined;
  const saved = await saveJob(deps.sql, job, token, {
    status: 'failed',
    error_code: dbCode,
    error_detail: detail.slice(0, 1000),
    ...(work ? { work } : {}),
    finished_at: now(deps),
    usage_krw: 0,
  });
  if (saved) {
    await failPendingOutputs(deps.sql, job.id);
    await dropWorkingFiles(deps.media, saved.work);
  }
  return saved;
}
