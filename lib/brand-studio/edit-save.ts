/**
 * Save a finished LayerEditor picture directly to the studio wall (`BRAND_STUDIO_EDIT_TO_WALL`).
 *
 * Reserve validates membership, source, filing, and quota without allocating any DB row; upload uses either a
 * deterministic user+requestId staging key (direct signed PUT in cloud or local POST gateway); complete runs
 * inside `lockOrganization`, checks idempotency (`conflict` if requestId already belongs to a non-edit job),
 * verifies magic bytes & sharp dimensions (never client-supplied dimensions), stores main + 512px webp thumb,
 * charges only the full image bytes to storage quota, and writes a zero-cost, lane-less `brand_studio_jobs` row.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandStudioEditToWallOpenFor } from '@/lib/flags';
import { adjustOrganizationStorageBytes, checkStorageQuotaForUpload } from '@/lib/brands/storage-quota';
import { STAGING_BUCKET, StorageObjectNotFound } from '@/lib/storage';
import { lockOrganization, requireCreate, studioSeat, StudioDenied } from './access';
import { brandProjectFiling, brandProjectForNew, fileStudioJob } from './brand-projects';
import {
  OutputEditCompleteSchema,
  OutputEditReserveSchema,
  STUDIO_LIMITS,
  type StudioFailure,
  type StudioOutputEditReserved,
  type StudioOutputEditSaved,
} from './contracts';
import { checkUpload, imageInfo, sha256Hex, thumbnailWebp } from './files';
import { projectForNewJob, studioProjectsReady } from './job-projects';
import { notFillRun } from './list-rules';
import { EDITED_NO_MODEL } from './model-label';
import { guarded } from './outcome';
import { IMAGE_RUNS, jobView, liveRunsFilter, VISIBLE_OUTPUT } from './repo';
import type { JobRow, OutputRow, StudioDeps, StudioJobParams } from './types';

export const LOCAL_EDIT_UPLOAD_ROUTE = '/api/brand-studio/edit';

export function editStagingKey(organizationId: string, userId: string, requestId: string): string {
  return `brand-studio/edit/${organizationId}/${userId}/${requestId}`;
}

export function editSwitchEnvOf(deps: Pick<StudioDeps, 'intelDeps'>): Record<string, string | undefined> {
  const env = deps.intelDeps?.env;
  return env && ('BRAND_STUDIO_EDIT_TO_WALL' in env || 'BRAND_STUDIO_EDIT_TO_WALL_ORGS' in env) ? env : process.env;
}

async function resolveEditedSource(
  sql: SqlRunner,
  organizationId: string,
  parentOutputId: string,
): Promise<{ outputId: string; model: string }> {
  const live = await liveRunsFilter(sql, 'j');
  const row = (
    await sql.query<{ id: string; model: string }>(
      `select o.id, j.model
         from brand_studio_outputs o
         join brand_studio_jobs j on j.id = o.job_id and j.organization_id = o.organization_id
        where o.id = $1
          and o.organization_id = $2
          and ${VISIBLE_OUTPUT('o')}
          and o.kind = 'image'
          and ${IMAGE_RUNS('j')}
          and ${notFillRun('j')}
          and j.model <> 'compose-1080p'
          ${live}`,
      [parentOutputId, organizationId],
    )
  ).rows[0];
  if (!row) throw new StudioDenied('not_found');
  return { outputId: row.id, model: row.model };
}

export async function reserveEditedOutput(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<StudioOutputEditReserved | StudioFailure> {
  const parsed = OutputEditReserveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;

  return guarded(async () =>
    deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (!brandStudioEditToWallOpenFor(v.organizationId, editSwitchEnvOf(deps))) {
        throw new StudioDenied('invalid');
      }
      requireCreate(seat);
      const filing = await brandProjectFiling(tx, v.organizationId, raw);

      const prior = (
        await tx.query<JobRow>(
          'select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = $3',
          [v.organizationId, seat.userId, v.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.kind !== 'image' || prior.params?.edited !== true) {
          throw new StudioDenied('conflict');
        }
        if (prior.status === 'succeeded') {
          const outputs = (
            await tx.query<OutputRow>(
              "select * from brand_studio_outputs where job_id = $1 and status = 'ready' and deleted_at is null order by idx asc",
              [prior.id],
            )
          ).rows;
          if (outputs.length > 0) {
            return {
              ok: true as const,
              direct: false,
              url: '',
              job: jobView(prior, outputs, deps.media),
            };
          }
        }
        const key = editStagingKey(v.organizationId, seat.userId, v.requestId);
        if (deps.staging.servesSignedUrls) {
          const url = deps.staging.signedUploadUrl ? await deps.staging.signedUploadUrl(key, v.mime) : null;
          if (!url) throw new StudioDenied('failed');
          return {
            ok: true as const,
            direct: true,
            url,
          };
        }
        return {
          ok: true as const,
          direct: false,
          url: `${LOCAL_EDIT_UPLOAD_ROUTE}/${encodeURIComponent(v.requestId)}?organizationId=${encodeURIComponent(v.organizationId)}`,
        };
      }

      const parentOutputId = v.parentOutputId ?? null;
      if (parentOutputId) {
        await resolveEditedSource(tx, v.organizationId, parentOutputId);
      }

      if (filing.open) {
        await brandProjectForNew(tx, v.organizationId, {
          requested: filing.requested,
          parentOutputId,
          fill: false,
        });
      }
      if (await studioProjectsReady(deps, tx)) {
        await projectForNewJob(tx, v.organizationId, {
          requested: v.projectId,
          parentOutputId,
          fill: false,
        });
      }

      const now = deps.now?.() ?? new Date();
      const isAdmin =
        (await tx.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [seat.userId])).rows[0]
          ?.is_admin === true;
      if (!isAdmin) {
        const quota = await checkStorageQuotaForUpload(tx, v.organizationId, v.sizeBytes, now, 1);
        if (!quota.allowed) throw new StudioDenied(quota.code, quota.reason);
      }

      const key = editStagingKey(v.organizationId, seat.userId, v.requestId);
      if (deps.staging.servesSignedUrls) {
        const url = deps.staging.signedUploadUrl ? await deps.staging.signedUploadUrl(key, v.mime) : null;
        if (!url) throw new StudioDenied('failed');
        return {
          ok: true as const,
          direct: true,
          url,
        };
      }
      return {
        ok: true as const,
        direct: false,
        url: `${LOCAL_EDIT_UPLOAD_ROUTE}/${encodeURIComponent(v.requestId)}?organizationId=${encodeURIComponent(v.organizationId)}`,
      };
    }),
  );
}

export async function completeEditedOutput(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<StudioOutputEditSaved | StudioFailure> {
  const parsed = OutputEditCompleteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;

  return guarded(async () => {
    const writtenMediaKeys: string[] = [];
    let stagingKeyToRelease: string | null = null;
    try {
      const { preSeat, filing } = await deps.sql.transaction(async (tx) => {
        const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
        if (!brandStudioEditToWallOpenFor(v.organizationId, editSwitchEnvOf(deps))) {
          throw new StudioDenied('invalid');
        }
        requireCreate(seat);
        const filingScope = await brandProjectFiling(tx, v.organizationId, raw);
        return { preSeat: seat, filing: filingScope };
      });

      const key = editStagingKey(v.organizationId, preSeat.userId, v.requestId);
      let bytes: Uint8Array | null = null;
      try {
        bytes = await deps.staging.read(STAGING_BUCKET, key);
        stagingKeyToRelease = key;
      } catch (error) {
        if (!(error instanceof StorageObjectNotFound)) {
          stagingKeyToRelease = key;
          throw error;
        }
      }

      let prepared: {
        mime: string;
        bytesLength: number;
        width: number;
        height: number;
        sha: string;
        imageKey: string;
        thumbKey: string;
      } | null = null;
      if (bytes !== null) {
        if (bytes.byteLength > STUDIO_LIMITS.imageBytesMax) throw new StudioDenied('file_too_large');
        const verdict = checkUpload(bytes, { mime: v.mime, sizeBytes: bytes.byteLength });
        if (!verdict.ok) throw new StudioDenied(verdict.code);
        const dims = await imageInfo(bytes);
        if (!dims) throw new StudioDenied('unsupported_file');
        const thumbBytes = await thumbnailWebp(bytes);
        const sha = sha256Hex(bytes);
        const storedImage = await deps.media.put(bytes, verdict.mime);
        writtenMediaKeys.push(storedImage.key);
        const storedThumb = await deps.media.put(thumbBytes, 'image/webp');
        writtenMediaKeys.push(storedThumb.key);
        prepared = {
          mime: verdict.mime,
          bytesLength: bytes.byteLength,
          width: dims.width,
          height: dims.height,
          sha,
          imageKey: storedImage.key,
          thumbKey: storedThumb.key,
        };
      }

      const outcome = await deps.sql.transaction(async (tx) => {
        const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
        if (!brandStudioEditToWallOpenFor(v.organizationId, editSwitchEnvOf(deps))) {
          throw new StudioDenied('invalid');
        }
        requireCreate(seat);
        await lockOrganization(tx, v.organizationId);

        const prior = (
          await tx.query<JobRow>(
            'select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = $3',
            [v.organizationId, seat.userId, v.requestId],
          )
        ).rows[0];
        if (prior) {
          if (prior.kind !== 'image' || prior.params?.edited !== true) {
            throw new StudioDenied('conflict');
          }
          const outputs = (
            await tx.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx asc', [
              prior.id,
            ])
          ).rows;
          return { duplicate: true as const, result: { ok: true as const, job: jobView(prior, outputs, deps.media) } };
        }

        if (!prepared) throw new StudioDenied('not_found');

        const now = deps.now?.() ?? new Date();
        const isAdmin =
          (await tx.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [seat.userId])).rows[0]
            ?.is_admin === true;
        if (!isAdmin) {
          const quota = await checkStorageQuotaForUpload(tx, v.organizationId, prepared.bytesLength, now, 1);
          if (!quota.allowed) throw new StudioDenied(quota.code, quota.reason);
        }

        const parentOutputId = v.parentOutputId ?? null;
        const source = parentOutputId ? await resolveEditedSource(tx, v.organizationId, parentOutputId) : null;
        const resolvedModel = source?.model ?? EDITED_NO_MODEL;

        const brandProjectId = filing.open
          ? await brandProjectForNew(tx, v.organizationId, {
              requested: filing.requested,
              parentOutputId,
              fill: false,
            })
          : null;
        const legacyProjectId = (await studioProjectsReady(deps, tx))
          ? await projectForNewJob(tx, v.organizationId, {
              requested: v.projectId,
              parentOutputId,
              fill: false,
            })
          : null;

        await adjustOrganizationStorageBytes(tx, v.organizationId, prepared.bytesLength);

        const ts = now.toISOString();
        const jobParams: StudioJobParams = {
          aspect: null,
          resolution: null,
          seconds: null,
          audio: null,
          count: 1,
          locale: viewer.locale === 'en' ? 'en' : 'ko',
          edited: true,
        };
        const insertedJob = (
          await tx.query<JobRow>(
            `insert into brand_studio_jobs (
               organization_id, created_by, request_id, kind, status, lane, model,
               prompt, final_prompt, enhance, refs, parent_output_id, params,
               estimate_usd, estimate_krw, usage_krw, created_at, started_at, finished_at
             ) values (
               $1, $2, $3, 'image', 'succeeded', null, $4,
               '', null, false, '[]'::jsonb, $5, $6::jsonb,
               0, 0, 0, $7, $7, $7
             ) returning *`,
            [
              v.organizationId,
              seat.userId,
              v.requestId,
              resolvedModel,
              parentOutputId,
              JSON.stringify(jobParams),
              ts,
            ],
          )
        ).rows[0]!;

        if (brandProjectId) {
          await fileStudioJob(tx, v.organizationId, insertedJob.id, brandProjectId);
          insertedJob.brand_project_id = brandProjectId;
        }
        if (legacyProjectId) {
          await tx.query('update brand_studio_jobs set project_id = $3 where id = $1 and organization_id = $2', [
            insertedJob.id,
            v.organizationId,
            legacyProjectId,
          ]);
          insertedJob.project_id = legacyProjectId;
        }

        const insertedOutput = (
          await tx.query<OutputRow>(
            `insert into brand_studio_outputs (
               job_id, organization_id, idx, kind, status, storage_key, thumb_key, mime, bytes, width, height, sha256, created_at
             ) values ($1, $2, 0, 'image', 'ready', $3, $4, $5, $6, $7, $8, $9, $10)
             returning *`,
            [
              insertedJob.id,
              v.organizationId,
              prepared.imageKey,
              prepared.thumbKey,
              prepared.mime,
              prepared.bytesLength,
              prepared.width,
              prepared.height,
              prepared.sha,
              ts,
            ],
          )
        ).rows[0]!;

        return {
          duplicate: false as const,
          result: { ok: true as const, job: jobView(insertedJob, [insertedOutput], deps.media) },
        };
      });

      if (outcome.duplicate) {
        for (const mediaKey of writtenMediaKeys) {
          await deps.media.delete(mediaKey).catch(() => undefined);
        }
      }
      return outcome.result;
    } catch (error) {
      for (const mediaKey of writtenMediaKeys) {
        await deps.media.delete(mediaKey).catch(() => undefined);
      }
      throw error;
    } finally {
      if (stagingKeyToRelease) {
        await deps.staging.releaseStaging?.(stagingKeyToRelease).catch(() => undefined);
      }
    }
  });
}
