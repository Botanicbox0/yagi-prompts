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
  type StudioJobCreate,
  type StudioJobCreated,
  type StudioPromptPreview,
  type StudioShieldedPromptPreview,
} from './contracts';
import { lockOrganization, requireCreate, studioSeat, StudioDenied } from './access';
import { imageInfo } from './files';
import { dropWorkingFiles, LEASE_SECONDS } from './job-store';
import { routeJob } from './lanes';
import type { StudioImageModel } from './models';
import { planFinal, planJob, type JobPlan } from './plan';
import { planRevision } from './revision/plan';
import { ReviseDialogueRecordSchema } from './revision/sheet';
import { brandSummary, enhanceInputOf, enhanceReferences, keepSheet, readSheet, regionEditPlan, remixContext, runEnhancer } from './prepare';
import { readCachedFilmSheet } from './film-sheet';
import { jobSoftDeleteReady, jobView, openJobCount, readyAsset, readyOutput } from './repo';
import type { EnhanceInput, JobRow, OutputRow, StudioDeps } from './types';
import { loadAllowance, reserveAllowance } from './usage';
import { projectForNewJob, studioProjectsReady } from './job-projects';
import { brandProjectFiling, brandProjectForNew, fileStudioJob } from './brand-projects';
import { failure, guarded } from './outcome';
import { createMusicJob } from './sound/music-jobs';
import { renderPresetPrompt, type StudioJobPreset } from './workflows/presets';
import { promptPageCount } from './prompt-shield/layout';
import { REVIEWED_PROMPT_MAX, reviewedSentence, shieldedReuseOf } from './prompt-shield/reuse';
import { videoPromptShieldActive } from './prompt-shield/shield';
import { sealPromptToken } from './prompt-shield/token';

const localeOf = (viewer: Viewer): 'ko' | 'en' => (viewer.locale === 'en' ? 'en' : 'ko');

/**
 * R-03 guardrails: free Gemini intelligence operations (`prompt.enhance`, `film.analyze`) require an
 * open monthly allowance (`capKrw > 0`) and enforce a sliding-window per-organization rate cap so
 * automated scripts cannot burn Gemini API budget without spending studio credits.
 */
export const FREE_INTEL_LIMITS = {
  windowMs: 60_000,
  enhancePerMinute: 20,
  analyzePerMinute: 6,
  /** `revise.plan` (lib/brand-studio/revision/advise.ts). */
  revisePerMinute: 20,
  /** `revise.mark` (lib/brand-studio/revision/mark.ts): one call per mark placed. */
  markPerMinute: 30,
  /** `lyrics.draft` (lib/brand-studio/sound/lyrics-draft.ts): a first draft of lyrics, per organization. */
  lyricsPerMinute: 6,
  /** The existing-lyrics judgment before a music run is reserved (lib/brand-studio/sound/music-jobs.ts, §12.5). */
  lyricsJudgePerMinute: 12,
} as const;

const freeIntelBuckets = new Map<string, number[]>();

export function resetFreeIntelRateLimits(): void {
  freeIntelBuckets.clear();
}

export function takeFreeIntelSlot(key: string, maxPerWindow: number, nowMs: number): boolean {
  const cutoff = nowMs - FREE_INTEL_LIMITS.windowMs;
  const recent = (freeIntelBuckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= maxPerWindow) {
    freeIntelBuckets.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  freeIntelBuckets.set(key, recent);
  if (freeIntelBuckets.size > 500) {
    for (const [k, list] of freeIntelBuckets) {
      const kept = list.filter((ts) => ts > cutoff);
      if (kept.length === 0) freeIntelBuckets.delete(k);
      else freeIntelBuckets.set(k, kept);
    }
  }
  return true;
}

export async function insertJob(
  deps: StudioDeps,
  sql: StudioDeps['sql'],
  userId: string,
  organizationId: string,
  requestId: string,
  plan: JobPlan,
  projectId: string | null = null,
  brandProjectId: string | null = null,
) {
  // A free lane now means the job starts `queued`; `held` only while every lane is full.
  const lane = await routeJob(sql, {
    organizationId,
    model: plan.model,
    defaultLane: deps.env.defaultLane,
    caps: deps.env.caps,
    apiUp: deps.env.apiConfigured && deps.provider !== null,
    now: deps.now?.() ?? new Date(),
    stick: plan.kind === 'video_final' ? (plan.stickLane ?? 'sunra_api') : null,
    place: null,
  });
  const job = (
    await sql.query<JobRow>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, enhance, params, refs,
          parent_output_id, estimate_usd, estimate_krw, work)
        values ($1, $2, $3, $4, $14, $15, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::jsonb) returning *`,
      [
        organizationId, userId, requestId, plan.kind, plan.model.id, plan.prompt, plan.enhance,
        JSON.stringify(plan.params), JSON.stringify(plan.refs), plan.parentOutputId,
        Math.round(plan.estimateUsd * 10_000) / 10_000, plan.estimateKrw,
        JSON.stringify(plan.stickLane ? { stickLane: plan.stickLane } : {}),
        lane ? 'queued' : 'held', lane,
      ],
    )
  ).rows[0]!;
  // Written apart from the insert so the statement above is the same with or without migration 0091.
  if (projectId) {
    await sql.query('update brand_studio_jobs set project_id = $2 where id = $1', [job.id, projectId]);
    job.project_id = projectId;
  }
  // The brand project spine (./brand-projects.ts), the same way: apart from the insert, only when there is one.
  if (brandProjectId) {
    await fileStudioJob(sql, organizationId, job.id, brandProjectId);
    job.brand_project_id = brandProjectId;
  }
  const outputs = (
    await sql.query<OutputRow>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, is_draft)
        select $1, $2, g, $3, $4 from generate_series(0, $5::int - 1) as g returning *`,
      [job.id, organizationId, plan.outputs.kind, plan.outputs.isDraft, plan.outputs.count],
    )
  ).rows;
  return jobView(job, outputs, deps.media);
}

/**
 * A `video_revise` request as the planner takes it. The conversation record (`dialogue`) is read only while
 * `BRAND_STUDIO_REVISE_V2` is on; with the flag off it is dropped unread, as an unknown key always was.
 */
function reviseInput(v: Extract<StudioJobCreate, { kind: 'video_revise' }>, dialogueOpen: boolean) {
  const { dialogue: raw, ...rest } = v;
  if (!dialogueOpen || raw === undefined) return rest;
  const parsed = ReviseDialogueRecordSchema.safeParse(raw);
  if (!parsed.success) throw new StudioDenied('invalid');
  return { ...rest, dialogue: parsed.data };
}

/**
 * `internal` is set by server code only (a starter workflow, lib/brand-studio/workflows/service.ts) and is never
 * read from `raw`: the request schema has no preset, so no API or MCP caller can set one.
 */
export async function createStudioJob(deps: StudioDeps, viewer: Viewer, raw: unknown, internal?: { preset?: StudioJobPreset }): Promise<StudioJobCreated | StudioFailure> {
  // A preset (lib/brand-studio/workflows/presets) rides only on a plain picture run, and only a known one.
  const preset = internal?.preset ?? null;
  if (preset && ((raw as { kind?: unknown } | null)?.kind !== 'image' || renderPresetPrompt(preset) === null)) return failure('invalid');
  // Music (docs/BRAND-SOUND-STUDIO.md §7.4): same table and money rules, its own request shape and gates.
  if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'music') return createMusicJob(deps, viewer, raw);
  const parsed = StudioJobCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  // The video prompt shield: a `video` run may name its designed sentence instead of carrying it. Closed for the
  // organization (or any other kind), `reviewedFrom` / `reviewedToken` are not even read, as before.
  // Judged here, refused only after the seat below, so a non-member learns nothing about the switch.
  const reuse = v.kind === 'video' && videoPromptShieldActive(v.organizationId) ? shieldedReuseOf(raw, v.reviewedPrompt !== undefined) : null;
  const locale = localeOf(viewer);
  // "빈 곳 채우기" runs exist only while its flag is on.
  if (v.kind === 'region_edit' && v.purpose && !deps.env.outpaint) return failure('feature_unavailable');
  // The brand project spine: closed for the organization, `brandProjectId` is not even read; open, its value is
  // judged only after the seat, inside the transaction (`brandProjectForNew`).
  const filing = await brandProjectFiling(deps.sql, v.organizationId, raw);
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId);
      requireCreate(seat);
      if (reuse && 'refused' in reuse) throw new StudioDenied(reuse.refused);
      await lockOrganization(sql, v.organizationId);
      const prior = (
        await sql.query<JobRow>('select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = $3', [v.organizationId, seat.userId, v.requestId])
      ).rows[0];
      if (prior) {
        // A new version is stored as the kind it runs as (`video_revise` is a request shape only).
        const same = v.kind === 'video_revise'
          ? Boolean(prior.params?.revision) && (prior.kind === 'video' || prior.kind === 'video_remix')
          : prior.kind === v.kind;
        if (!same) throw new StudioDenied('conflict');
        const outputs = (await sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1', [prior.id])).rows;
        return { ok: true as const, job: jobView(prior, outputs, deps.media) };
      }
      // A reused designed sentence takes the place of `reviewedPrompt` and is sent as it is (`enhance` off, as the bar
      // sends a read sentence); everything after is that path, unchanged.
      const input = reuse && !('refused' in reuse) && v.kind === 'video'
        ? { ...v, enhance: false, reviewedPrompt: await reviewedSentence(sql, reuse, { organizationId: v.organizationId, userId: seat.userId, model: v.model }) }
        : v;
      // Planned under the organization lock, so a revision's version number cannot be taken twice.
      const plan = input.kind === 'video_final'
        ? await planFinal(sql, input.organizationId, input.draftOutputId, locale)
        : input.kind === 'video_revise'
          ? await planRevision(sql, input.organizationId, reviseInput(input, deps.env.reviseV2 === true), deps.media, locale)
          : await planJob(sql, input.organizationId, input, deps.media, locale, { regionV2: deps.env.regionV2 });
      // A preset run: its text is assembled at prepare time from the server-only original, never by the enhancer.
      if (preset) Object.assign(plan, { enhance: false, params: { ...plan.params, preset: { id: preset.id, vars: { ...preset.vars } } } });
      if ((await openJobCount(sql, v.organizationId)) >= STUDIO_LIMITS.openJobsPerOrganization) throw new StudioDenied('too_many_running');
      const verdict = await reserveAllowance(sql, v.organizationId, plan.estimateKrw, deps.env, deps.now?.() ?? new Date());
      if (!verdict.ok) throw new StudioDenied(verdict.code);
      // Closed (flag off or column missing): the request's `projectId` is not even looked at.
      const projectId = (await studioProjectsReady(deps, sql))
        ? await projectForNewJob(sql, v.organizationId, {
            requested: 'projectId' in v ? v.projectId : null,
            parentOutputId: plan.parentOutputId,
            fill: plan.params.purpose === 'fill',
          })
        : null;
      // Same place and same rule for the spine's project (a refusal here rolls the whole transaction back,
      // reservation included, as the `projectId` check above does).
      const brandProjectId = filing.open
        ? await brandProjectForNew(sql, v.organizationId, {
            requested: filing.requested,
            parentOutputId: plan.parentOutputId,
            fill: plan.params.purpose === 'fill',
          })
        : null;
      return { ok: true as const, job: await insertJob(deps, sql, seat.userId, v.organizationId, v.requestId, plan, projectId, brandProjectId) };
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
      const job = (
        await sql.query<JobRow & { leased: boolean }>(
          `select *, (claimed_at is not null and claimed_at > now() - interval '${LEASE_SECONDS} seconds') as leased
             from brand_studio_jobs where id = $1 and organization_id = $2 for update`,
          [v.jobId, v.organizationId],
        )
      ).rows[0];
      if (!job) throw new StudioDenied('not_found');
      if (job.status === 'canceled') return job;
      // Only while nothing has reached a provider. Once it has (running, finishing, any slot sent, or a
      // prepared API-lane job under a live lease, which may be sending this very moment) the run is
      // paid for, so it is left to land.
      if (job.status !== 'held' && job.status !== 'queued') throw new StudioDenied('conflict');
      if (job.status === 'queued' && job.lane === 'sunra_api' && job.work?.prepared && job.leased) throw new StudioDenied('conflict');
      const sent = (await sql.query('select 1 from brand_studio_outputs where job_id = $1 and provider_task_id is not null limit 1', [job.id])).rows[0];
      if (sent) throw new StudioDenied('conflict');
      await sql.query("update brand_studio_jobs set status = 'canceled', usage_krw = 0, finished_at = now() where id = $1", [job.id]);
      await sql.query("update brand_studio_outputs set status = 'failed' where job_id = $1 and status = 'pending'", [job.id]);
      return job;
    }),
  );
  if ('ok' in outcome) return outcome;
  await dropWorkingFiles(deps.media, outcome.work);
  return { ok: true };
}

/**
 * `job.delete`: takes a run that ended with no result (failed or stopped) off the wall. It only sets
 * `deleted_at`: the row with its status, reason, usage and cost stays for audit and billing. A run that is
 * still open, or one with results, is refused: results are deleted one by one (`output.delete`).
 */
export async function deleteStudioJob(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioDone | StudioFailure> {
  const parsed = JobRefSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      // The column arrives with migration 0090; before that there is nothing to set.
      if (!(await jobSoftDeleteReady(sql))) throw new StudioDenied('feature_unavailable');
      const job = (
        await sql.query<Pick<JobRow, 'id' | 'status' | 'deleted_at'>>(
          'select id, status, deleted_at from brand_studio_jobs where id = $1 and organization_id = $2 for update',
          [v.jobId, v.organizationId],
        )
      ).rows[0];
      if (!job) throw new StudioDenied('not_found');
      if (job.deleted_at) return job;
      if (job.status !== 'failed' && job.status !== 'canceled') throw new StudioDenied('conflict');
      const shown = (await sql.query("select 1 from brand_studio_outputs where job_id = $1 and status = 'ready' and deleted_at is null limit 1", [job.id])).rows[0];
      if (shown) throw new StudioDenied('conflict');
      await sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [job.id]);
      return job;
    }),
  );
  return 'ok' in outcome ? outcome : { ok: true };
}

export async function previewStudioPrompt(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioPromptPreview | StudioShieldedPromptPreview | StudioFailure> {
  const parsed = PromptPreviewSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale = localeOf(viewer);
  const now = deps.now?.() ?? new Date();
  const ready = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId);
      requireCreate(seat);
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      if (!takeFreeIntelSlot(`enhance:${v.organizationId}`, FREE_INTEL_LIMITS.enhancePerMinute, now.getTime())) {
        throw new StudioDenied('too_many_running');
      }
      const plan = await planJob(sql, v.organizationId, { ...v, requestId: 'preview' }, deps.media, locale, { regionV2: deps.env.regionV2 });
      return { seat, plan };
    }),
  );
  if ('ok' in ready) return ready;
  const { seat, plan } = ready;
  // A remix is previewed exactly as it will be sent: the same reading and, for a blueprint, no video token.
  const remix =
    plan.kind === 'video_remix'
      ? await remixContext(deps, { organizationId: seat.organizationId, params: plan.params, refs: plan.refs, resolved: plan.resolved, locale })
      : null;
  let editCropThumb: EnhanceInput['editCropThumb'] = null;
  let regionWindow: EnhanceInput['regionWindow'] = null;
  if (plan.kind === 'region_edit' && plan.params.box) {
    try {
      const source = plan.params.source ?? {};
      const srcRow = source.assetId
        ? await readyAsset(deps.sql, seat.organizationId, source.assetId)
        : source.outputId
          ? await readyOutput(deps.sql, seat.organizationId, source.outputId)
          : null;
      if (srcRow?.storage_key) {
        const original = await deps.media.read(srcRow.storage_key);
        const size = await imageInfo(original);
        if (size) {
          const planned = await regionEditPlan(deps, original, size, plan.params, plan.model as StudioImageModel);
          editCropThumb = { bytes: planned.crop.bytes, mime: planned.crop.mime };
          regionWindow = planned.regionWindow;
        }
      }
    } catch {
      editCropThumb = null;
    }
  }
  const input = enhanceInputOf(
    { kind: plan.kind, prompt: plan.prompt, params: plan.params },
    plan.model,
    await enhanceReferences(deps, remix?.resolved ?? plan.resolved),
    await brandSummary(deps, seat.organizationId, seat.organizationName),
    remix?.sheet ?? null,
    editCropThumb,
    null,
    regionWindow,
  );
  const result = await runEnhancer({ ...deps, organizationId: seat.organizationId }, input);
  // The director marks a structured prompt it keeps as written `fallback` too; that one is a choice, not a failure.
  const passthrough = result.source === 'fallback' && (result as { intent?: string }).intent === 'passthrough';
  const source = passthrough ? 'passthrough' : result.source;
  // The video prompt shield: a VIDEO model's design leaves only as a token (and pictures of it); never as text.
  if ((plan.kind === 'video' || plan.kind === 'video_remix') && videoPromptShieldActive(seat.organizationId)) {
    // What the bar would send back: the designed sentence cut as the screen cuts it (`designedSentence`).
    const designed = result.prompt.trim().slice(0, REVIEWED_PROMPT_MAX);
    const token = sealPromptToken({ org: seat.organizationId, user: seat.userId, model: plan.model.id, kind: plan.kind, prompt: designed });
    if (!token) return failure('failed');
    return { ok: true, source, shielded: true, token, pages: promptPageCount(designed) };
  }
  return { ok: true, prompt: result.prompt, notes: result.notes, source };
}

export async function analyzeStudioFilm(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioFilmAnalysis | StudioFailure> {
  const parsed = FilmAnalyzeSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const asset = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      const row = await readyAsset(sql, v.organizationId, v.assetId);
      if (!row || row.kind !== 'video') throw new StudioDenied('not_found');
      return row;
    }),
  );
  if ('ok' in asset) return asset;
  const locale = localeOf(viewer);
  const depth = v.depth ?? 'basic';
  // Read once per asset, language and depth (respecting 14-day sliding TTL): kept reading answers later calls.
  const kept = await readCachedFilmSheet(deps.sql, {
    organizationId: v.organizationId,
    assetId: asset.id,
    locale,
    depth,
    now,
  });
  if (kept) return { ok: true, sheet: kept };
  if (!takeFreeIntelSlot(`analyze:${v.organizationId}`, FREE_INTEL_LIMITS.analyzePerMinute, now.getTime())) {
    return failure('too_many_running');
  }
  const sheet = await readSheet(
    deps,
    {
      index: 1, ordinal: 1, kind: 'video', key: asset.storage_key, thumbKey: null, url: deps.media.url(asset.storage_key),
      label: 'Video 1', durationMs: asset.duration_ms, width: asset.width, height: asset.height,
    },
    locale,
    depth,
  );
  if (sheet) await keepSheet(deps.sql, v.organizationId, asset.id, locale, sheet, depth, now);
  return { ok: true, sheet };
}
