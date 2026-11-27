/**
 * The personal Sunra lane's adapter (docs/PERSONAL-STUDIO.md §5.1): one Seedance 2.5 reference-to-video run
 * on Sunra's API lane, in the render engines' one failure vocabulary. lib/renders/engines.ts reaches it
 * through two branches only: `startVideoRender` when the input says `lane: 'sunra'`, `pollVideoRender` when
 * the task id is this lane's (`sunra:{request_id}`, or the caller's dispatch marker). Nothing sets either
 * yet; with `TWINGS_PERSONAL_SUNRA_FACES` off the adapter refuses to submit at all.
 *
 * It sends only what it is given: public https URLs a caller already chose. It never reads a photo, never
 * builds a data URL, never touches the identity library. Who may be sent is the caller's rule.
 *
 * Money (founder, 2026-11-24: every generation is charged to whoever asked; the company never pays for one
 * it is not paid for; no free retry of a billed job):
 *   - Once a submission may have been accepted, the failure is never `retryable`: a lost answer, a timeout, a
 *     malformed 200 or a 5xx other than 503 means "maybe running, maybe billed". The estimated charge
 *     (`estimateSeedanceUsd` x the 5% top-up fee) is reported through `onProviderCharge` so the caller can
 *     hold the refund for an operator. Only 429 and 503 say "not taken"; those are retryable.
 *   - A prediction that reads COMPLETED is judged by `success` and `error`, never by the status (a failed
 *     request also reads COMPLETED, lib/brand-studio/provider/sunra-api.ts). A failure is never retryable;
 *     a charge Sunra reports for it is recorded.
 *   - A success books the billed amount x `SUNRA_TOPUP_FEE_MULTIPLIER` as `provider_usage` (the estimate, x
 *     the fee, as `estimate` when Sunra reports none) in `EngineOutput.costUsd`. `onProviderCharge` is NOT
 *     called on success: the cost travels with the output like every other provider's.
 *   - `onProviderCharge` must be idempotent per task id (set, not add): a poll whose settlement fails is
 *     polled again and reports the same charge again. When it is missing or throws, a poll stays pending
 *     rather than settle a charged failure that nobody recorded; a submission still fails (not retryable).
 *   - The film is fetched with the ranged downloader (lib/brand-studio/provider/download.ts): Sunra's file
 *     hosts serve ~50 KB/s per connection. A download hiccup stays pending and is fetched again; it never
 *     submits again.
 *
 * Circuit (lib/renders/provider-router.ts states, stored by lib/renders/sunra-lane.ts `recordSunraCircuit`
 * through `onSunraCircuit`): a short balance opens the hold, 429/5xx at submit opens the outage, a billed
 * amount beyond the price guardrail opens the drift (that film is still delivered: it was paid for).
 *
 * Imports from ./engines are used inside functions only (engines.ts imports this module back).
 */
import { SUNRA_TOPUP_FEE_MULTIPLIER, SunraError, fromSunraTaskId, sunraConfigFromEnv, createSunraClient, toSunraTaskId, type SunraClient, type SunraQueueResult, type SunraQueueState } from '@/lib/sunra/client';
import { Magi2RequestError, estimateMagi2Usd, magi2ReferenceRequest } from '@/lib/sunra/magi2';
import { SeedanceRequestError, estimateSeedanceUsd, seedanceReferenceRequest, toSunraReferenceSyntax, unattachedReferences } from '@/lib/sunra/seedance';
import { downloadResult } from '@/lib/brand-studio/provider/download';
import { personalMagi2Open, personalSunraFacesOpen } from '@/lib/flags';
import { UnknownVideoEngineError, videoModelForEngine, type VideoModelKey } from '@/lib/video/models';
import { evaluateSunraPriceGuardrail, type CircuitBreakerState } from './provider-router';
import { RenderFailure, VIDEO_RESOLUTION, looksLikeFaceRefusal, type RenderEngineDeps, type StartedVideo, type VideoPoll, type VideoRenderInput } from './engines';

/** The default Seedance model this lane renders on; MAGI-2 also runs here when `TWINGS_PERSONAL_MAGI2=on`. */
export const SUNRA_LANE_MODEL = 'seedance-2.5' as const;
export type SunraLaneModel = typeof SUNRA_LANE_MODEL | 'magi-2';
/**
 * Written to `render_jobs.provider_task_id` by the caller BEFORE submit, replaced by `sunra:{request_id}`
 * right after. A marker that outlives `SUNRA_DISPATCH_STALE_MS` means the submit's answer was lost.
 */
export const SUNRA_DISPATCH_PREFIX = 'sunra-dispatch:';
export const SUNRA_DISPATCH_STALE_MS = 30 * 60 * 1000;

export type SunraChargeSource = 'provider_usage' | 'estimate';
export type SunraOpenCircuit = Exclude<CircuitBreakerState, 'closed'>;

export type SunraRenderDeps = Pick<RenderEngineDeps, 'sunra' | 'fetch' | 'onProviderCharge' | 'onSunraCircuit'> & { now?: () => Date };

export function sunraDispatchMarker(now: Date): string {
  return `${SUNRA_DISPATCH_PREFIX}${now.toISOString()}`;
}

/** Both of this lane's task ids: the request (`sunra:`) and the caller's pre-submit marker (`sunra-dispatch:`). */
export function isSunraLaneTaskId(taskId: string): boolean {
  return fromSunraTaskId(taskId) !== null || taskId.startsWith(SUNRA_DISPATCH_PREFIX);
}

function round4(usd: number): number {
  return Math.round(usd * 10000) / 10000;
}

/** What a charge of `billedUsd` costs us: Sunra's credits are bought with a 5% top-up fee. */
export function sunraBookedUsd(billedUsd: number): number {
  return round4(billedUsd * SUNRA_TOPUP_FEE_MULTIPLIER);
}

function laneResolution(resolution: string | undefined): '720p' | '1080p' | null {
  const value = resolution ?? VIDEO_RESOLUTION;
  return value === '720p' || value === '1080p' ? value : null;
}

/** The charge when Sunra reports none: the token formula for this length and resolution, with the fee. */
function estimatedBookedUsd(resolution: '720p' | '1080p', seconds: number): number {
  return sunraBookedUsd(estimateSeedanceUsd({ resolution, seconds, referenceVideoSeconds: 0 }));
}

function refuse(message: string): RenderFailure {
  return new RenderFailure('engine_error', message, false);
}

function sunraClientFromEnv(env: Record<string, string | undefined>): SunraClient | null {
  const config = sunraConfigFromEnv(env);
  return config === null ? null : createSunraClient(config);
}

async function openCircuit(deps: SunraRenderDeps, state: SunraOpenCircuit, reason: string): Promise<void> {
  try {
    await deps.onSunraCircuit?.(state, reason.slice(0, 300));
  } catch {
    // Best effort: the circuit protects the next job; this job's outcome does not depend on it.
  }
}

/** Reports a charge; false when there is no recorder or it failed (the caller then keeps the job undecided). */
async function recordCharge(deps: SunraRenderDeps, taskId: string | null, usd: number, source: SunraChargeSource): Promise<boolean> {
  if (!deps.onProviderCharge) return false;
  try {
    await deps.onProviderCharge(taskId, usd, source);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ classification */

const UNSAFE = new Set(['unsafe_content', 'PREDICTION_UNSAFE_CONTENT', 'content_policy_violation', 'copyright', 'SENSITIVE_WORD_ERROR']);
/** Sunra's moderation categories and relay statuses (lib/brand-studio/provider/sunra-api.ts). */
const REFUSAL = /moderation|unsafe|sensitive|copyright|real[-_ ]?person|content[-_ ]?policy/i;
const REAL_PERSON = /real[-_ ]?person/i;

function policyFailure(code: string, reason: string, message: string): RenderFailure | null {
  if (!UNSAFE.has(code) && !REFUSAL.test(code) && !REFUSAL.test(reason)) return null;
  const face = REAL_PERSON.test(code) || REAL_PERSON.test(reason) || looksLikeFaceRefusal(message);
  return new RenderFailure(face ? 'face_policy' : 'moderated', message || code, false);
}

type SubmitOutcome = { failure: RenderFailure; ambiguous: boolean; circuit: SunraOpenCircuit | null };

/**
 * What a failed submit means. `ambiguous` = the request may have been taken (and billed): never retried,
 * the estimate is recorded. Only an answer that says "not taken" (429, 503) is retryable.
 */
function classifySubmitError(error: unknown): SubmitOutcome {
  if (!(error instanceof SunraError)) {
    // A thrown fetch (TypeError), an abort or a timeout: the request may be on the wire or already queued.
    const message = error instanceof Error ? error.message : String(error);
    return { failure: new RenderFailure('network', `Sunra submit: ${message}`, false), ambiguous: true, circuit: null };
  }
  const detail = `${error.code} (${error.status}): ${error.message}`.slice(0, 500);
  const policy = policyFailure(error.code, '', error.message);
  if (policy || error.moderated) return { failure: policy ?? new RenderFailure('moderated', detail, false), ambiguous: false, circuit: null };
  if (error.insufficientCredit || error.status === 402) {
    return { failure: new RenderFailure('engine_access', detail, false), ambiguous: false, circuit: 'open_insufficient_hold' };
  }
  if (error.status === 401 || error.status === 403) return { failure: new RenderFailure('engine_access', detail, false), ambiguous: false, circuit: null };
  if (error.status === 429 || error.status === 503) return { failure: new RenderFailure('engine_error', detail, true), ambiguous: false, circuit: 'open_provider_outage' };
  // Any other 5xx: the gateway may have queued the request before failing to answer.
  if (error.status >= 500) return { failure: new RenderFailure('engine_error', detail, false), ambiguous: true, circuit: 'open_provider_outage' };
  // No status: the network failed after sending, or a 200 came back without a request id.
  if (error.status === 0) return { failure: new RenderFailure('network', detail, false), ambiguous: true, circuit: null };
  // The provider read the request and turned it down (validation, unknown endpoint): nothing ran.
  return { failure: new RenderFailure('engine_error', detail, false), ambiguous: false, circuit: null };
}

function predictionFailure(error: { code: string | null; reason: string | null; message: string | null } | null): { failure: RenderFailure; circuit: SunraOpenCircuit | null } {
  const code = error?.code ?? 'unknown';
  const reason = error?.reason ?? '';
  const message = error?.message ?? '';
  const detail = `${code}${reason ? `/${reason}` : ''}: ${message}`.slice(0, 500);
  const policy = policyFailure(code, reason, message);
  if (policy) return { failure: new RenderFailure(policy.code, detail, false), circuit: null };
  if (/credit|balance|insufficient/i.test(reason) || /credit|balance/i.test(code)) {
    return { failure: new RenderFailure('engine_access', detail, false), circuit: 'open_insufficient_hold' };
  }
  return { failure: new RenderFailure('engine_error', detail, false), circuit: null };
}

/* ------------------------------------------------------------------ start */

export async function startSunraRender(
  input: VideoRenderInput,
  deps: SunraRenderDeps,
  env: Record<string, string | undefined> = process.env,
): Promise<StartedVideo> {
  if (!personalSunraFacesOpen(env)) throw refuse('the personal Sunra lane is closed (TWINGS_PERSONAL_SUNRA_FACES is not on)');
  if (input.engine === 'magi-2' && !personalMagi2Open(env)) {
    throw refuse('MAGI-2 on the personal Sunra lane is closed (TWINGS_PERSONAL_MAGI2 is not on)');
  }
  const client = deps.sunra === undefined ? sunraClientFromEnv(env) : deps.sunra;
  if (client === null) throw new RenderFailure('no_engine_key', 'SUNRA_API_KEY is not set', false);
  // Fail closed: a billed submission whose possible charge nobody could record is not sent.
  if (!deps.onProviderCharge) throw refuse('no charge recorder: a Sunra submission is never sent without one');

  let model: VideoModelKey;
  let seconds: number;
  try {
    ({ model, seconds } = videoModelForEngine(input.engine, input.seconds));
  } catch (error) {
    if (error instanceof UnknownVideoEngineError) throw refuse(error.message);
    throw error;
  }
  if (model !== SUNRA_LANE_MODEL && model !== 'magi-2') {
    throw refuse(`${input.engine} renders on ${model}; the Sunra lane renders ${SUNRA_LANE_MODEL} or magi-2 only`);
  }
  if (model === 'magi-2' && !personalMagi2Open(env)) {
    throw refuse('MAGI-2 on the personal Sunra lane is closed (TWINGS_PERSONAL_MAGI2 is not on)');
  }

  // Only URLs a caller chose: no photo bytes, no ModelArk asset, no fixed list outside the recipe's references.
  if (input.photo || input.assetId) throw refuse('the Sunra lane takes reference URLs only, never photo bytes or an asset');
  if (!input.references || input.references.length === 0) throw refuse('the Sunra lane needs the step references');

  let request: { endpoint: string; body: Record<string, unknown> };
  let estimateUsd: number;

  if (model === 'magi-2') {
    if (input.resolution !== undefined && input.resolution !== '1080p') {
      throw refuse(`MAGI-2 renders 1080p only, not ${String(input.resolution)}`);
    }
    // Each reference by its explicit type; a type this lane does not know is refused, never guessed into audio.
    const referenceImages: string[] = [];
    const referenceVideos: string[] = [];
    const referenceAudios: string[] = [];
    for (const reference of input.references) {
      const type: unknown = reference.type;
      if (type === 'image') referenceImages.push(reference.url);
      else if (type === 'video') referenceVideos.push(reference.url);
      else if (type === 'audio') referenceAudios.push(reference.url);
      else throw refuse(`MAGI-2 takes image, video or audio references, not ${JSON.stringify(type ?? null)}`);
    }
    // The prompt checks (unresolved {{…}} tokens, a reference it names but this request does not carry) run in
    // `magi2ReferenceRequest`; the prompt is sent exactly as written (MAGI-2's reference syntax is unverified).
    try {
      request = magi2ReferenceRequest({
        prompt: input.prompt,
        seconds,
        aspectRatio: input.aspect,
        resolution: '1080p',
        generateAudio: true,
        referenceImages,
        referenceVideos,
        referenceAudios,
      });
    } catch (error) {
      if (error instanceof Magi2RequestError) throw refuse(error.message);
      throw error;
    }
    estimateUsd = sunraBookedUsd(estimateMagi2Usd(seconds));
  } else {
    const resolution = laneResolution(input.resolution);
    if (resolution === null) throw refuse(`the Sunra lane renders 720p or 1080p, not ${String(input.resolution)}`);
    if (input.references.some((reference) => reference.type !== 'image')) throw refuse('the Sunra lane sends reference images only');
    const images = input.references.map((reference) => reference.url);

    const prompt = toSunraReferenceSyntax(input.prompt, images.length);
    const missing = unattachedReferences(prompt, images.length);
    if (missing.length) throw refuse(`the prompt names ${missing.join(', ')} that this request does not carry`);

    try {
      request = seedanceReferenceRequest({ prompt, resolution, ratio: input.aspect, seconds, referenceImages: images });
    } catch (error) {
      if (error instanceof SeedanceRequestError) throw refuse(error.message);
      throw error;
    }
    estimateUsd = estimatedBookedUsd(resolution, seconds);
  }

  let id: string;
  try {
    // No webhook in this phase: the pass polls.
    ({ id } = await client.submit(request.endpoint, request.body));
  } catch (error) {
    const outcome = classifySubmitError(error);
    if (outcome.circuit) await openCircuit(deps, outcome.circuit, outcome.failure.message);
    if (outcome.ambiguous) {
      const recorded = await recordCharge(deps, null, estimateUsd, 'estimate');
      if (!recorded) throw new RenderFailure(outcome.failure.code, `${outcome.failure.message} (possible charge NOT recorded)`, false);
    }
    throw outcome.failure;
  }
  return { taskId: toSunraTaskId(id), model, seconds, provider: 'sunra' };
}

/* ------------------------------------------------------------------ poll */

export interface SunraPollArgs {
  model?: VideoModelKey;
  seconds: number;
  resolution?: string;
  /** Called once Sunra reports success, before the film is downloaded (the wait's "마무리"). Must not throw. */
  onProviderDone?: () => Promise<void>;
}

/** The billed USD Sunra reported: `billing.amount` on the status, then on the result, then `units / 1000`. */
function billedOf(state: SunraQueueState, result: SunraQueueResult | null): number | null {
  const candidates = [state.billingUsd, result?.billingUsd ?? null, result && result.units !== null && result.units > 0 ? result.units / 1000 : null];
  for (const value of candidates) if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return null;
}

function filmOf(result: SunraQueueResult): string | null {
  const video = result.files.find((file) => file.contentType?.startsWith('video/')) ?? result.files.find((file) => /\.(mp4|mov|webm)(\?|$)/i.test(file.url));
  return (video ?? result.files[0])?.url ?? null;
}

/** Failed, with the charge recorded first; pending when the charge could not be recorded. */
async function failCharged(deps: SunraRenderDeps, taskId: string, failure: RenderFailure, usd: number, source: SunraChargeSource): Promise<VideoPoll> {
  if (!(await recordCharge(deps, taskId, usd, source))) return { status: 'pending' };
  return { status: 'failed', failure };
}

export async function pollSunraRender(taskId: string, args: SunraPollArgs, deps: SunraRenderDeps): Promise<VideoPoll> {
  const model: SunraLaneModel = args.model === 'magi-2' ? 'magi-2' : SUNRA_LANE_MODEL;
  const resolution: '720p' | '1080p' = model === 'magi-2' ? '1080p' : (laneResolution(args.resolution) ?? '720p');
  const estimate = model === 'magi-2' ? sunraBookedUsd(estimateMagi2Usd(args.seconds)) : estimatedBookedUsd(resolution, args.seconds);

  // The caller's marker: the submit was sent (or about to be) and its answer is not on the row yet.
  if (taskId.startsWith(SUNRA_DISPATCH_PREFIX)) {
    const sentAt = Date.parse(taskId.slice(SUNRA_DISPATCH_PREFIX.length));
    const now = (deps.now ?? (() => new Date()))().getTime();
    if (Number.isFinite(sentAt) && now - sentAt < SUNRA_DISPATCH_STALE_MS) return { status: 'pending' };
    return failCharged(deps, taskId, new RenderFailure('network', 'the Sunra submit never reported a request id', false), estimate, 'estimate');
  }

  const requestId = fromSunraTaskId(taskId);
  if (requestId === null) return { status: 'failed', failure: refuse(`not a Sunra task id: ${taskId}`) };
  const client = deps.sunra === undefined ? sunraClientFromEnv(process.env) : deps.sunra;
  if (client === null || !client.queueStatus || !client.queueResult) {
    // The request was taken and may have run: no key now does not mean no charge.
    return failCharged(deps, taskId, new RenderFailure('no_engine_key', 'SUNRA_API_KEY is not set', false), estimate, 'estimate');
  }

  let state: SunraQueueState;
  try {
    state = await client.queueStatus(requestId);
  } catch (error) {
    const outcome = classifySubmitError(error);
    // A poll that cannot reach Sunra is not a failed render: ask again next pass.
    if (outcome.failure.code === 'network' || outcome.failure.retryable || (error instanceof SunraError && error.status >= 500)) return { status: 'pending' };
    return failCharged(deps, taskId, new RenderFailure(outcome.failure.code, `Sunra status: ${outcome.failure.message}`, false), estimate, 'estimate');
  }

  if (state.status === 'IN_QUEUE' || state.status === 'IN_PROGRESS') return { status: 'pending' };

  const reported = billedOf(state, null);
  const settleFailed = async (failure: RenderFailure, charged: boolean, billed: number | null): Promise<VideoPoll> => {
    if (billed !== null) return failCharged(deps, taskId, failure, sunraBookedUsd(billed), 'provider_usage');
    if (charged) return failCharged(deps, taskId, failure, estimate, 'estimate');
    return { status: 'failed', failure };
  };

  if (state.status === 'CANCELED') return settleFailed(new RenderFailure('engine_error', 'the request was canceled at Sunra', false), false, reported);
  // A failed request also reads COMPLETED: `success` and `error` decide, never `status`.
  if (state.success === false || (state.success !== true && state.error)) {
    const { failure, circuit } = predictionFailure(state.error);
    if (circuit) await openCircuit(deps, circuit, failure.message);
    return settleFailed(failure, false, reported);
  }

  await args.onProviderDone?.();
  let result: SunraQueueResult;
  try {
    result = await client.queueResult(requestId);
  } catch (error) {
    const outcome = classifySubmitError(error);
    if (outcome.failure.code === 'network' || outcome.failure.retryable || (error instanceof SunraError && error.status >= 500)) return { status: 'pending' };
    return settleFailed(new RenderFailure('bad_output', `Sunra result: ${outcome.failure.message}`, false), true, reported);
  }
  const billed = billedOf(state, result);
  // From here the prediction succeeded or reported a charge: every failure below records one.
  const charged = state.success === true || billed !== null;
  if (result.error) {
    const { failure, circuit } = predictionFailure(result.error);
    if (circuit) await openCircuit(deps, circuit, failure.message);
    return settleFailed(failure, charged, billed);
  }
  const url = filmOf(result);
  if (url === null) return settleFailed(new RenderFailure('bad_output', 'Sunra completed without a file', false), charged, billed);

  let file: { bytes: Uint8Array; mime: string | null };
  try {
    file = await downloadResult(deps.fetch ?? globalThis.fetch, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An address we will not fetch, or a file over the cap, will not get better on the next poll.
    if (/refused address|too large/.test(message)) return settleFailed(new RenderFailure('bad_output', message, false), charged, billed);
    return { status: 'pending' };
  }
  if (file.bytes.byteLength === 0) return { status: 'pending' };

  if (billed !== null) {
    const guard = evaluateSunraPriceGuardrail({ model, resolution, seconds: args.seconds, actualBilledUsd: billed });
    if (!guard.withinGuardrail) {
      const reason = guard.alert?.reason === 'no_baseline'
        ? `no pinned price baseline for ${model} ${resolution} (${args.seconds}s billed $${billed})`
        : `price drift ${guard.alert?.driftPercent ?? '?'}% (${resolution} ${args.seconds}s billed $${billed})`;
      await openCircuit(deps, 'open_price_drift', reason);
    }
  }
  const mime = file.mime && file.mime !== 'application/octet-stream' ? file.mime : 'video/mp4';
  return {
    status: 'succeeded',
    output: {
      bytes: file.bytes,
      mime,
      provider: 'sunra',
      costUsd: billed !== null ? sunraBookedUsd(billed) : estimate,
      costSource: billed !== null ? 'provider_usage' : 'estimate',
      completionTokens: null,
    },
  };
}
