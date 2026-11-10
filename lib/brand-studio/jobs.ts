/**
 * `job.create`, `job.cancel`, `prompt.enhance`, `film.analyze` (docs/BRAND-STUDIO-V2.md §5.2, §8, §9).
 *
 * `job.create` runs in ONE transaction: seat -> organization row lock -> idempotency -> plan -> open
 * job cap -> allowance reservation -> insert. The lock makes two concurrent requests take turns, so the
 * second sees the first one's reservation and the month cannot be overspent. Nothing reaches a
 * provider here; the route starts the engine after the commit.
 */
import type { Viewer } from '@/lib/auth/identity';
import {
  FilmAnalyzeSchema,
  JobRefSchema,
  PromptPreviewSchema,
  STUDIO_LIMITS,
  StudioJobCreateSchema,
  type StudioDone,
  type StudioFailure,
  type StudioFilmAnalysis,
  type StudioJobCreated,
  type StudioPromptPreview,
} from './contracts';
import { lockOrganization, requireCreate, studioSeat, StudioDenied } from './access';
import { dropWorkingFiles } from './job-store';
import { planFinal, planJob, type JobPlan } from './plan';
import { brandSummary, enhanceInputOf, enhanceReferences, readSheet, runEnhancer } from './prepare';
import { jobView, openJobCount, readyAsset } from './repo';
import type { JobRow, OutputRow, StudioDeps } from './types';
import { reserveAllowance } from './usage';
import { failure, guarded } from './outcome';

const localeOf = (viewer: Viewer): 'ko' | 'en' => (viewer.locale === 'en' ? 'en' : 'ko');

async function insertJob(deps: StudioDeps, sql: StudioDeps['sql'], userId: string, organizationId: string, requestId: string, plan: JobPlan) {
  const job = (
    await sql.query<JobRow>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, enhance, params, refs,
          parent_output_id, estimate_usd, estimate_krw, work)
        values ($1, $2, $3, $4, 'held', $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::jsonb) returning *`,
      [
        organizationId, userId, requestId, plan.kind, plan.model.id, plan.prompt, plan.enhance,
        JSON.stringify(plan.params), JSON.stringify(plan.refs), plan.parentOutputId,
        Math.round(plan.estimateUsd * 10_000) / 10_000, plan.estimateKrw,
        JSON.stringify(plan.stickLane ? { stickLane: plan.stickLane } : {}),
      ],
    )
  ).rows[0]!;
  const outputs = (
    await sql.query<OutputRow>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, is_draft)
        select $1, $2, g, $3, $4 from generate_series(0, $5::int - 1) as g returning *`,
      [job.id, organizationId, plan.outputs.kind, plan.outputs.isDraft, plan.outputs.count],
    )
  ).rows;
  return jobView(job, outputs, deps.media);
}

export async function createStudioJob(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioJobCreated | StudioFailure> {
  const parsed = StudioJobCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale = localeOf(viewer);
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId);
      requireCreate(seat);
      await lockOrganization(sql, v.organizationId);
      const prior = (
        await sql.query<JobRow>('select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = $3', [v.organizationId, seat.userId, v.requestId])
      ).rows[0];
      if (prior) {
        if (prior.kind !== v.kind) throw new StudioDenied('conflict');
        const outputs = (await sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1', [prior.id])).rows;
        return { ok: true as const, job: jobView(prior, outputs, deps.media) };
      }
      const plan = v.kind === 'video_final'
        ? await planFinal(sql, v.organizationId, v.draftOutputId, locale)
        : await planJob(sql, v.organizationId, v, deps.media, locale);
      if ((await openJobCount(sql, v.organizationId)) >= STUDIO_LIMITS.openJobsPerOrganization) throw new StudioDenied('too_many_running');
      const verdict = await reserveAllowance(sql, v.organizationId, plan.estimateKrw, deps.env, deps.now?.() ?? new Date());
      if (!verdict.ok) throw new StudioDenied(verdict.code);
      return { ok: true as const, job: await insertJob(deps, sql, seat.userId, v.organizationId, v.requestId, plan) };
    }),
  );
}

export async function cancelStudioJob(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioDone | StudioFailure> {
  const parsed = JobRefSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const job = (await sql.query<JobRow>('select * from brand_studio_jobs where id = $1 and organization_id = $2 for update', [v.jobId, v.organizationId])).rows[0];
      if (!job) throw new StudioDenied('not_found');
      if (job.status === 'canceled') return { job, tasks: [] as string[] };
      // `finishing` means the provider already made it: let it land rather than throw it away.
      if (!['held', 'queued', 'running'].includes(job.status)) throw new StudioDenied('conflict');
      const tasks = job.lane === 'sunra_api'
        ? (await sql.query<{ provider_task_id: string }>("select provider_task_id from brand_studio_outputs where job_id = $1 and status = 'pending' and provider_task_id is not null", [job.id])).rows.map((r) => r.provider_task_id)
        : [];
      await sql.query("update brand_studio_jobs set status = 'canceled', usage_krw = 0, finished_at = now() where id = $1", [job.id]);
      await sql.query("update brand_studio_outputs set status = 'failed' where job_id = $1 and status = 'pending'", [job.id]);
      return { job, tasks };
    }),
  );
  if ('ok' in outcome) return outcome;
  for (const task of outcome.tasks) await deps.provider?.cancel?.(task).catch(() => undefined);
  await dropWorkingFiles(deps.media, outcome.job.work);
  return { ok: true };
}

export async function previewStudioPrompt(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioPromptPreview | StudioFailure> {
  const parsed = PromptPreviewSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale = localeOf(viewer);
  const ready = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId);
      requireCreate(seat);
      const plan = await planJob(sql, v.organizationId, { ...v, requestId: 'preview' }, deps.media, locale);
      return { seat, plan };
    }),
  );
  if ('ok' in ready) return ready;
  const { seat, plan } = ready;
  const film = plan.kind === 'video_remix' ? plan.resolved.find((r) => r.kind === 'video') : undefined;
  const sheet = film ? await readSheet(deps, film, locale) : null;
  const input = enhanceInputOf(
    { kind: plan.kind, prompt: plan.prompt, params: plan.params },
    plan.model,
    await enhanceReferences(deps, plan.resolved),
    await brandSummary(deps, seat.organizationId, seat.organizationName),
    sheet,
  );
  const result = await runEnhancer(deps, input);
  return { ok: true, prompt: result.prompt, notes: result.notes };
}

export async function analyzeStudioFilm(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioFilmAnalysis | StudioFailure> {
  const parsed = FilmAnalyzeSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const asset = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const row = await readyAsset(sql, v.organizationId, v.assetId);
      if (!row || row.kind !== 'video') throw new StudioDenied('not_found');
      return row;
    }),
  );
  if ('ok' in asset) return asset;
  const sheet = await readSheet(
    deps,
    {
      index: 1, ordinal: 1, kind: 'video', key: asset.storage_key, thumbKey: null, url: deps.media.url(asset.storage_key),
      label: 'Video 1', durationMs: asset.duration_ms, width: asset.width, height: asset.height,
    },
    localeOf(viewer),
  );
  return { ok: true, sheet };
}
