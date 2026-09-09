import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import type { ArkAssetsClient } from '@/lib/ark/assets';
import { ASSET_WAIT_HOURS, ensureIdentityAsset, identityStatusFor, loadIdentityGroup, needsIdentity, pollIdentityAsset, recordIdentityUse, type IdentityDeps } from '@/lib/identity/service';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { aspectsForMedium, isEngineId, isImageAspect, isImageEngine, isVideoAspect, isVideoEngine, resolveEngine } from '@/lib/images/engines';
import { loadPromptById, loadPromptBySlug, type PromptRow } from '@/lib/prompts/repo';
import { isForSale } from '@/lib/twings/products';
import { RenderFailure, pollVideoRender, runImageRender, startVideoRender, videoModelFor, type EngineOutput, type RenderEngineDeps, type RenderFailureCode, type RenderPhoto } from './engines';
import type { RenderNotifier } from './notify';
import { buildRenderPrompt } from './prompt';
import {
  ASSET_TASK_PREFIX,
  claimRenderJobs,
  countRenderJobsSince,
  insertRenderJob,
  listRenderJobsAwaitingProvider,
  listRenderJobsForUser,
  listRenderJobsToNotify,
  loadRenderJob,
  markRenderFailed,
  markRenderNotified,
  markRenderRunningWithTask,
  markRenderSucceeded,
  markRenderWaitingForAsset,
  recoverStaleRenderJobs,
  requeueRenderJob,
  type RenderJob,
} from './repo';
import { constantTimeEqual, isRenderId, isShareExpired, isShareTokenShape, newShareToken, shareExpiresAt } from './share';
import { extensionFor, type RenderStore } from './store';

/**
 * The render queue (docs/TEMPLATES-IA.md §8): enqueue, run, tell, show.
 *
 * Why a queue at all: a film takes minutes and a Vercel function has a ceiling, so the request
 * that takes the photo must not be the thing that waits. It stores the photo, writes a row, and
 * answers with the result page's address; the PASS does the rest — and the pass is one function
 * invoked from four places (docs §8): right after enqueueing (`after()`), the provider's
 * completion callback, the owner opening the result page, and a daily cron. On the Hobby plan
 * there is no per-minute cron, so the design has to be correct with an irregular tick, and it is:
 * every step is idempotent, every claim is a lease, every message has an idempotency key.
 *
 * Who may start one: an admin, until payment lands (`RENDER_PIPELINE_PUBLIC`). Everyone else
 * keeps the demo. The gate is HERE, not in the UI — the studio asks `/api/renders/access` and the
 * enqueue route asks this function, and both get the same answer.
 */

export const RENDER_JOBS_PER_DAY = 20;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;
/** A synchronous render claimed this long ago and still `running` was orphaned by a dead process. */
export const LEASE_MINUTES = 20;
export const NOTIFY_MAX_ATTEMPTS = 3;
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];

export function isPhotoMime(value: unknown): value is PhotoMime {
  return typeof value === 'string' && (PHOTO_MIMES as readonly string[]).includes(value);
}

/** The one gate. Anonymous never; everyone once payment is wired; admins now (live verification). */
export function canStartRender(viewer: Viewer): boolean {
  if (viewer.userId === null) return false;
  return viewer.isAdmin || RENDER_PIPELINE_PUBLIC;
}

export interface RenderServiceDeps {
  sql: SqlRunner;
  store: RenderStore;
  now?: Date;
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

export type CreateRenderFailure =
  | 'sign_in_required'
  | 'not_open'
  | 'not_found'
  | 'not_for_sale'
  | 'bad_aspect'
  | 'bad_photo'
  | 'photo_too_large'
  | 'rate_limited'
  /** The template renders on ModelArk, which takes only a verified face (docs §8.2). */
  | 'identity_required';

export type CreateRenderOutcome = { ok: true; id: string } | { ok: false; code: CreateRenderFailure };

export interface CreateRenderInput {
  templateSlug: string;
  aspect: string;
  photo: { bytes: Uint8Array; mime: string } | null;
  locale: string | null;
}

export async function createRenderJob(deps: RenderServiceDeps, viewer: Viewer, input: CreateRenderInput): Promise<CreateRenderOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  if (!canStartRender(viewer)) return { ok: false, code: 'not_open' };
  const now = deps.now ?? new Date();

  const template = await loadPromptBySlug(deps.sql, input.templateSlug);
  if (template === null || template.status !== 'published') return { ok: false, code: 'not_found' };
  if (!isForSale(template)) return { ok: false, code: 'not_for_sale' };

  const engine = resolveEngine(template.engine, template.medium);
  if (!(aspectsForMedium(template.medium) as readonly string[]).includes(input.aspect)) return { ok: false, code: 'bad_aspect' };

  if (input.photo === null || input.photo.bytes.byteLength === 0 || !isPhotoMime(input.photo.mime)) return { ok: false, code: 'bad_photo' };
  if (input.photo.bytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, code: 'photo_too_large' };

  // ModelArk refuses a real person's photo in the bytes: the person verifies their face once
  // (docs/TEMPLATES-IA.md §8.2) and the pass sends an asset reference instead.
  if (needsIdentity(engine) && (await identityStatusFor(deps.sql, viewer.userId)) !== 'active') return { ok: false, code: 'identity_required' };

  const recent = await countRenderJobsSince(deps.sql, viewer.userId, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (recent >= RENDER_JOBS_PER_DAY) return { ok: false, code: 'rate_limited' };

  const id = randomUUID();
  const inputKey = `${id}/input.${extensionFor(input.photo.mime)}`;
  await deps.store.put(inputKey, input.photo.bytes, input.photo.mime);
  await insertRenderJob(deps.sql, {
    id,
    userId: viewer.userId,
    templateId: template.id,
    templateSlug: template.slug,
    medium: template.medium,
    engine,
    aspect: input.aspect,
    locale: isLocale(input.locale) ? input.locale : (viewer.locale ?? DEFAULT_LOCALE),
    inputKey,
    inputMime: input.photo.mime,
  });
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// the pass
// ---------------------------------------------------------------------------

export interface RenderPassDeps extends RenderServiceDeps {
  engines?: RenderEngineDeps;
  /** null = no channel configured; finished jobs keep `notify_status = pending` until one is. */
  notifier: RenderNotifier | null;
  siteUrl: string;
  siteName?: string;
  /** Where ModelArk posts task completion; optional, the poll covers a lost callback. */
  callbackUrl?: string | null;
  /** The bank's asset client (docs §8.2); null = AK/SK not configured, ModelArk renders with a photo fail as `identity_unavailable`. */
  assets?: ArkAssetsClient | null;
}

export interface RenderPassReport {
  recovered: { requeued: number; failed: number };
  claimed: number;
  succeeded: number;
  failed: number;
  requeued: number;
  /** Film jobs handed to the provider (or still with it) at the end of the pass. */
  waiting: number;
  notified: number;
  notifyFailed: number;
  notifyPending: number;
  notifier: string;
  errors: string[];
}

export interface RenderPassOptions {
  /** How many queued jobs to claim; 0 = poll and notify only. */
  limit?: number;
  /** Run exactly this queued job (the request that enqueued it). */
  jobId?: string | null;
}

export async function runRenderPass(deps: RenderPassDeps, options: RenderPassOptions = {}): Promise<RenderPassReport> {
  const now = deps.now ?? new Date();
  const limit = options.limit ?? 5;
  const report: RenderPassReport = {
    recovered: { requeued: 0, failed: 0 },
    claimed: 0,
    succeeded: 0,
    failed: 0,
    requeued: 0,
    waiting: 0,
    notified: 0,
    notifyFailed: 0,
    notifyPending: 0,
    notifier: deps.notifier === null ? 'unconfigured' : `${deps.notifier.channel}:${deps.notifier.kind}`,
    errors: [],
  };

  // 1 — orphaned synchronous renders back to the queue (or failed once the budget is spent).
  report.recovered = await recoverStaleRenderJobs(deps.sql, { now, leaseMinutes: LEASE_MINUTES, maxAttempts: MAX_ATTEMPTS });

  // 2 — claim and run.
  const handedOff = new Set<string>();
  if (limit > 0 || options.jobId) {
    const claimed = await claimRenderJobs(deps.sql, { now, limit: options.jobId ? 1 : limit, jobId: options.jobId ?? null });
    report.claimed = claimed.length;
    for (const job of claimed) await executeClaimed(deps, job, now, report, handedOff);
  }

  // 3 — films the provider is still rendering (not the ones handed over a moment ago).
  const awaiting = await listRenderJobsAwaitingProvider(deps.sql, 20);
  for (const job of awaiting) {
    if (handedOff.has(job.id)) continue;
    await pollAwaiting(deps, job, now, report);
  }

  // 4 — say so.
  await notifyFinished(deps, now, report);
  return report;
}

const ASSET_URL_TTL_SECONDS = 15 * 60;

function identityDeps(deps: RenderPassDeps): IdentityDeps {
  return { sql: deps.sql, assets: deps.assets ?? null, siteUrl: deps.siteUrl, ...(deps.now ? { now: deps.now } : {}) };
}

type Reference =
  | { kind: 'bytes' }
  | { kind: 'asset'; assetId: string }
  | { kind: 'wait'; assetId: string }
  | { kind: 'fail'; failure: RenderFailure };

/**
 * How the person's photo reaches the engine. OpenAI takes the bytes. ModelArk takes only an
 * `asset://` from the person's verified group (docs/TEMPLATES-IA.md §8.2) — registered here by
 * content hash and, while the bank is still comparing, waited on rather than sent.
 */
async function resolveReference(deps: RenderPassDeps, job: RenderJob, photo: RenderPhoto | null): Promise<Reference> {
  if (photo === null || !isEngineId(job.engine) || !needsIdentity(job.engine)) return { kind: 'bytes' };
  const group = await loadIdentityGroup(deps.sql, job.userId);
  if (group === null || group.status !== 'active') {
    return { kind: 'fail', failure: new RenderFailure('identity_required', 'the person has not verified their face', false) };
  }
  const photoUrl = job.inputKey === null ? null : await deps.store.url(job.inputKey, ASSET_URL_TTL_SECONDS);
  const ensured = await ensureIdentityAsset(identityDeps(deps), { group, photo: photo.bytes, photoUrl });
  if (ensured.status === 'active') return { kind: 'asset', assetId: ensured.assetId };
  if (ensured.status === 'processing') return { kind: 'wait', assetId: ensured.assetId };
  const code: RenderFailureCode = ensured.reason === 'identity_required' || ensured.reason === 'identity_unavailable' ? ensured.reason : 'asset_failed';
  return { kind: 'fail', failure: new RenderFailure(code, `the photo could not become an asset (${ensured.reason})`, false) };
}

/** The engine call itself, once the reference is settled. Films are handed over; images finish here. */
async function renderNow(
  deps: RenderPassDeps,
  job: RenderJob,
  template: PromptRow,
  photo: RenderPhoto | null,
  assetId: string | null,
  now: Date,
  report: RenderPassReport,
  handedOff: Set<string>,
): Promise<void> {
  const prompt = buildRenderPrompt({ promptText: template.promptText, medium: job.medium, hasPhoto: photo !== null || assetId !== null });

  if (job.medium === 'image') {
    if (!isImageEngine(job.engine) || !isImageAspect(job.aspect)) throw new RenderFailure('engine_error', `unknown image engine/aspect ${job.engine} ${job.aspect}`, false);
    const output = await runImageRender({ engine: job.engine, prompt: prompt.text, aspect: job.aspect, photo, assetId }, deps.engines ?? {});
    await finish(deps, job, output, now);
    if (assetId !== null) await recordIdentityUse(deps.sql, { userId: job.userId, assetId, now });
    report.succeeded += 1;
    return;
  }

  if (!isVideoEngine(job.engine) || !isVideoAspect(job.aspect)) throw new RenderFailure('engine_error', `unknown video engine/aspect ${job.engine} ${job.aspect}`, false);
  const started = await startVideoRender(
    { engine: job.engine, prompt: prompt.text, aspect: job.aspect, seconds: template.runtimeSeconds ?? 5, photo, assetId, ...(deps.callbackUrl ? { callbackUrl: deps.callbackUrl } : {}) },
    deps.engines ?? {},
  );
  await markRenderRunningWithTask(deps.sql, job.id, { provider: 'modelark', taskId: started.taskId });
  if (assetId !== null) await recordIdentityUse(deps.sql, { userId: job.userId, assetId, now });
  handedOff.add(job.id);
  report.waiting += 1;
}

async function executeClaimed(deps: RenderPassDeps, job: RenderJob, now: Date, report: RenderPassReport, handedOff: Set<string>): Promise<void> {
  try {
    const template = await loadPromptById(deps.sql, job.templateId);
    if (template === null) throw new RenderFailure('engine_error', 'the template no longer exists', false);
    const photo = await readPhoto(deps.store, job);
    const reference = await resolveReference(deps, job, photo);
    if (reference.kind === 'fail') throw reference.failure;
    if (reference.kind === 'wait') {
      // The bank is still comparing the photo: park the job on the asset; the poll picks it up.
      await markRenderWaitingForAsset(deps.sql, job.id, reference.assetId);
      handedOff.add(job.id);
      report.waiting += 1;
      return;
    }
    await renderNow(deps, job, template, photo, reference.kind === 'asset' ? reference.assetId : null, now, report, handedOff);
  } catch (error) {
    await settleFailure(deps, job, error, now, report);
  }
}

async function pollAwaiting(deps: RenderPassDeps, job: RenderJob, now: Date, report: RenderPassReport): Promise<void> {
  if (!job.providerTaskId) return;
  if (job.providerTaskId.startsWith(ASSET_TASK_PREFIX)) {
    await pollAssetWait(deps, job, job.providerTaskId.slice(ASSET_TASK_PREFIX.length), now, report);
    return;
  }
  if (!isVideoEngine(job.engine)) return;
  try {
    const template = await loadPromptById(deps.sql, job.templateId);
    const { model, seconds } = videoModelFor(job.engine, template?.runtimeSeconds ?? 5);
    const polled = await pollVideoRender({ taskId: job.providerTaskId, model, seconds }, deps.engines ?? {});
    if (polled.status === 'pending') {
      report.waiting += 1;
      return;
    }
    if (polled.status === 'succeeded') {
      await finish(deps, job, polled.output, now);
      report.succeeded += 1;
      return;
    }
    await settleFailure(deps, job, polled.failure, now, report);
  } catch (error) {
    await settleFailure(deps, job, error, now, report);
  }
}

/** The bank is comparing the photo: ask once; render when it says Active; give up on Failed, or after a day. */
async function pollAssetWait(deps: RenderPassDeps, job: RenderJob, assetId: string, now: Date, report: RenderPassReport): Promise<void> {
  try {
    const status = await pollIdentityAsset(identityDeps(deps), assetId);
    if (status === 'Active') {
      const template = await loadPromptById(deps.sql, job.templateId);
      if (template === null) throw new RenderFailure('engine_error', 'the template no longer exists', false);
      const photo = await readPhoto(deps.store, job);
      await renderNow(deps, job, template, photo, assetId, now, report, new Set());
      return;
    }
    if (status === 'Failed') throw new RenderFailure('asset_failed', 'the bank could not match the photo to the verified face', false);
    const since = Date.parse(job.claimedAt ?? job.createdAt);
    if (now.getTime() - since > ASSET_WAIT_HOURS * 60 * 60 * 1000) throw new RenderFailure('asset_failed', 'the photo was not registered in time', false);
    report.waiting += 1;
  } catch (error) {
    await settleFailure(deps, job, error, now, report);
  }
}

async function readPhoto(store: RenderStore, job: RenderJob): Promise<RenderPhoto | null> {
  if (job.inputKey === null || !isPhotoMime(job.inputMime)) return null;
  return { bytes: await store.read(job.inputKey), mime: job.inputMime };
}

async function finish(deps: RenderPassDeps, job: RenderJob, output: EngineOutput, now: Date): Promise<void> {
  const resultKey = `${job.id}/result.${extensionFor(output.mime)}`;
  await deps.store.put(resultKey, output.bytes, output.mime);
  await markRenderSucceeded(deps.sql, job.id, {
    resultKey,
    resultMime: output.mime,
    resultBytes: output.bytes.byteLength,
    provider: output.provider,
    costUsd: output.costUsd,
    shareToken: newShareToken(),
    shareExpiresAt: shareExpiresAt(now),
    finishedAt: now,
  });
}

async function settleFailure(deps: RenderPassDeps, job: RenderJob, error: unknown, now: Date, report: RenderPassReport): Promise<void> {
  const failure = error instanceof RenderFailure ? error : new RenderFailure('engine_error', error instanceof Error ? error.message : String(error), false);
  report.errors.push(`${job.id}: ${failure.code} — ${failure.message}`);
  if (failure.retryable && job.attempts < MAX_ATTEMPTS) {
    await requeueRenderJob(deps.sql, job.id, { code: failure.code, message: failure.message });
    report.requeued += 1;
    return;
  }
  await markRenderFailed(deps.sql, job.id, { code: failure.code, message: failure.message, finishedAt: now });
  report.failed += 1;
}

async function notifyFinished(deps: RenderPassDeps, now: Date, report: RenderPassReport): Promise<void> {
  const due = await listRenderJobsToNotify(deps.sql, { limit: 20, maxAttempts: NOTIFY_MAX_ATTEMPTS });
  if (deps.notifier === null) {
    report.notifyPending = due.length;
    return;
  }
  for (const job of due) {
    const recipient = await loadRecipient(deps.sql, job.userId);
    if (recipient === null) {
      await markRenderNotified(deps.sql, job.id, { status: 'skipped', at: now, spendAttempt: false });
      continue;
    }
    const template = await loadPromptById(deps.sql, job.templateId);
    const locale = recipient.locale ?? job.locale;
    const outcome = await deps.notifier.send({
      job,
      templateTitle: templateTitle(template, locale, job.templateSlug),
      recipient: { email: recipient.email, locale },
      failureReason: job.status === 'failed' ? failureReason(job.errorCode, locale) : null,
      siteUrl: deps.siteUrl,
      siteName: deps.siteName ?? getDictionary(locale).meta.siteName,
    });
    if (outcome.ok) {
      await markRenderNotified(deps.sql, job.id, { status: 'sent', at: now, spendAttempt: true });
      report.notified += 1;
      continue;
    }
    // A refusal that is OUR configuration (the sending domain not yet verified at Resend, a bad
    // from address) is not this message's fault: leave it pending without spending an attempt, so
    // it goes out on the first pass after the founder fixes the console (2026-09-09 production).
    if (/domain is not verified|not verified|invalid_from_address|from address/i.test(outcome.error)) {
      await markRenderNotified(deps.sql, job.id, { status: 'pending', at: now, spendAttempt: false });
      report.notifyPending += 1;
      report.errors.push(`${job.id}: notify (config, waiting) — ${outcome.error}`);
      continue;
    }
    const terminal = !outcome.retryable || job.notifyAttempts + 1 >= NOTIFY_MAX_ATTEMPTS;
    await markRenderNotified(deps.sql, job.id, { status: terminal ? 'failed' : 'pending', at: now, spendAttempt: true });
    if (terminal) report.notifyFailed += 1;
    else report.notifyPending += 1;
    report.errors.push(`${job.id}: notify — ${outcome.error}`);
  }
}

async function loadRecipient(sql: SqlRunner, userId: string): Promise<{ email: string | null; locale: Locale | null } | null> {
  const { rows } = await sql.query<{ email: string | null; locale: string | null }>('select email, locale from profiles where id = $1', [userId]);
  const row = rows[0];
  if (!row) return null;
  return { email: row.email, locale: isLocale(row.locale) ? row.locale : null };
}

export function templateTitle(template: Pick<PromptRow, 'title' | 'titleKo'> | null, locale: Locale, fallback: string): string {
  if (template === null) return fallback;
  return locale === 'ko' && template.titleKo ? template.titleKo : template.title;
}

/** The reader-facing explanation of a failure code, in their language. */
export function failureReason(code: string | null, locale: Locale): string {
  const errors = getDictionary(locale).renders.error;
  const key = (code ?? 'engine_error') as keyof typeof errors;
  return errors[key] ?? errors.engine_error;
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

export interface RenderView {
  job: RenderJob;
  templateTitle: string;
  templateTitleKo: string | null;
}

async function withTitles(sql: SqlRunner, jobs: RenderJob[]): Promise<RenderView[]> {
  if (jobs.length === 0) return [];
  const ids = [...new Set(jobs.map((job) => job.templateId))];
  const { rows } = await sql.query<{ id: string; title: string; title_ko: string | null }>('select id, title, title_ko from prompt_items where id = any($1::uuid[])', [ids]);
  const titles = new Map(rows.map((row) => [row.id, row]));
  return jobs.map((job) => {
    const row = titles.get(job.templateId);
    return { job, templateTitle: row?.title ?? job.templateSlug, templateTitleKo: row?.title_ko ?? null };
  });
}

/** The owner's own render, or null — another user's id is "not found", never "forbidden". */
export async function loadOwnRender(sql: SqlRunner, viewer: Viewer, id: string): Promise<RenderView | null> {
  if (viewer.userId === null || !isRenderId(id)) return null;
  const job = await loadRenderJob(sql, id);
  if (job === null || job.userId !== viewer.userId) return null;
  return (await withTitles(sql, [job]))[0] ?? null;
}

export type SharedRender = { status: 'ok'; view: RenderView } | { status: 'expired'; view: RenderView } | { status: 'not_found' };

/** The 3-day link: the token must match the row exactly; an expired one still names the render so the page can say so. */
export async function loadSharedRender(sql: SqlRunner, id: string, token: string, now: Date = new Date()): Promise<SharedRender> {
  if (!isRenderId(id) || !isShareTokenShape(token)) return { status: 'not_found' };
  const job = await loadRenderJob(sql, id);
  if (job === null || job.status !== 'succeeded' || job.shareToken === null || !constantTimeEqual(job.shareToken, token)) return { status: 'not_found' };
  const view = (await withTitles(sql, [job]))[0]!;
  return isShareExpired(job.shareExpiresAt, now) ? { status: 'expired', view } : { status: 'ok', view };
}

export async function listMyRenders(sql: SqlRunner, userId: string, limit = 50): Promise<RenderView[]> {
  return withTitles(sql, await listRenderJobsForUser(sql, userId, limit));
}
