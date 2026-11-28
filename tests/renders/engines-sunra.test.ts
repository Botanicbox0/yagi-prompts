import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArkClient, ArkTask, CreateVideoTaskInput } from '@/lib/ark/client';
import type { KlingClient, KlingTask } from '@/lib/kling/client';
import { createFakeMailer } from '@/lib/notify/mailer-fake';
import { createEmailRenderNotifier } from '@/lib/renders/notify';
import { loadRenderJob } from '@/lib/renders/repo';
import { createRenderJob, runRenderPass, type RenderPassDeps } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { promptHarness } from '@/tests/helpers/prompts';
import { buildStudioRequest } from '@/lib/brand-studio/provider/requests';
import { SunraError, type SunraClient, type SunraQueueResult, type SunraQueueState } from '@/lib/sunra/client';
import {
  SUNRA_DISPATCH_PREFIX,
  SUNRA_DISPATCH_STALE_MS,
  isSunraLaneTaskId,
  pollSunraRender,
  startSunraRender,
  sunraDispatchMarker,
  type SunraRenderDeps,
} from '@/lib/renders/engines-sunra';
import { RenderFailure, pollVideoRender, startVideoRender, type RenderEngineDeps, type VideoRenderInput } from '@/lib/renders/engines';

/**
 * PR A of the personal Sunra lane (docs/PERSONAL-STUDIO.md §5.1): the adapter, driven with fake clients.
 * No test here reaches a provider. The money rule (founder, 2026-11-24) is what most of them pin: once a
 * submission may have been accepted the failure is never retryable and the possible charge is reported;
 * a COMPLETED prediction with `success:false` is a failure; a booked cost is the billed amount x 1.05.
 */

const A = 'https://media.example.com/renders/job-1/input.png?sig=1';
const B = 'https://media.example.com/renders/job-1/slot-partner.jpg?sig=2';
const RESULT_URL = 'https://cdn.sunra.example.com/out/req-1.mp4';
const ON = { TWINGS_PERSONAL_SUNRA_FACES: 'on' };
const RECIPE_PROMPT = 'Image 1 and Image 2 dance in the rain.\n\nImage 1, Image 2 show the two people to feature. Keep each person’s identity, face and features exactly as photographed, and keep them two distinct people.';
const LANE_INPUT: VideoRenderInput = {
  engine: 'seedance-2.5',
  prompt: RECIPE_PROMPT,
  aspect: '9:16',
  seconds: 10,
  photo: null,
  resolution: '720p',
  lane: 'sunra',
  references: [{ type: 'image', url: A }, { type: 'image', url: B }],
};
/** 720p, 10 s: $2.33 by the token formula; booked with the 5% top-up fee. */
const ESTIMATE_WITH_FEE = 2.4465;
const FILM = new Uint8Array(1_300_000).map((_, i) => i % 251);

type Submit = { endpoint: string; body: Record<string, unknown> };

function fakeSunra(script: {
  submit?: () => Promise<{ id: string }>;
  status?: () => Promise<SunraQueueState>;
  result?: () => Promise<SunraQueueResult>;
} = {}) {
  const calls = { submit: [] as Submit[], status: [] as string[], result: [] as string[] };
  const client: SunraClient = {
    async submit(endpoint, body) {
      calls.submit.push({ endpoint, body });
      return script.submit ? script.submit() : { id: 'req-1' };
    },
    async getTask() {
      throw new Error('the lane reads queueStatus/queueResult, never getTask');
    },
    async queueStatus(id) {
      calls.status.push(id);
      return script.status ? script.status() : state({ status: 'IN_PROGRESS' });
    },
    async queueResult(id) {
      calls.result.push(id);
      return script.result ? script.result() : result();
    },
  };
  return { client, calls };
}

function state(over: Partial<SunraQueueState>): SunraQueueState {
  return { status: 'COMPLETED', success: true, error: null, billingUsd: null, ...over };
}

function result(over: Partial<SunraQueueResult> = {}): SunraQueueResult {
  return { files: [{ url: RESULT_URL, contentType: 'video/mp4' }], draftTaskId: null, units: null, durationSeconds: 10, ...over };
}

/** A file host that honours Range, the way Sunra's does; records every Range header it saw. */
function rangedHost(bytes: Uint8Array<ArrayBuffer> = FILM) {
  const ranges: Array<string | null> = [];
  const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    ranges.push(range);
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    if (!m) return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } });
    const start = Number(m[1]);
    const end = Math.min(bytes.byteLength - 1, Number(m[2]));
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
    });
  }) as typeof fetch;
  return { fetchFn, ranges };
}

function recorder() {
  const charges: Array<{ taskId: string | null; usd: number; source: string }> = [];
  const circuits: Array<{ state: string; reason: string }> = [];
  return {
    charges,
    circuits,
    onProviderCharge: async (taskId: string | null, usd: number, source: 'provider_usage' | 'estimate') => {
      charges.push({ taskId, usd, source });
    },
    onSunraCircuit: async (circuitState: string, reason: string) => {
      circuits.push({ state: circuitState, reason });
    },
  };
}

function deps(client: SunraClient | null, rec = recorder(), extra: Partial<SunraRenderDeps> = {}): SunraRenderDeps {
  return { sunra: client, onProviderCharge: rec.onProviderCharge, onSunraCircuit: rec.onSunraCircuit as SunraRenderDeps['onSunraCircuit'], fetch: rangedHost().fetchFn, ...extra };
}

const POLL = { model: 'seedance-2.5' as const, seconds: 10, resolution: '720p' as const, aspect: '9:16' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startSunraRender — what goes out', () => {
  it('sends the brand studio body with the recipe tokens in Sunra spelling, and names the task sunra:{request_id}', async () => {
    const { client, calls } = fakeSunra();
    const rec = recorder();
    const started = await startSunraRender(LANE_INPUT, deps(client, rec), ON);
    expect(started).toEqual({ taskId: 'sunra:req-1', model: 'seedance-2.5', seconds: 10, provider: 'sunra' });
    const sunraPrompt = '@Image1 and @Image2 dance in the rain.\n\n@Image1, @Image2 show the two people to feature. Keep each person’s identity, face and features exactly as photographed, and keep them two distinct people.';
    const brand = buildStudioRequest({
      kind: 'video', model: 'seedance-2.5', prompt: sunraPrompt,
      params: { aspect: '9:16', resolution: '720p', seconds: 10, audio: null, count: 1, locale: 'en' },
      images: [{ url: A }, { url: B }], videos: [],
    });
    expect(calls.submit).toEqual([brand]);
    expect(rec.charges).toEqual([]);
    expect(rec.circuits).toEqual([]);
  });

  it('refuses before any call: lane closed, no client, no charge recorder, the wrong model or resolution, bytes, assets, missing references', async () => {
    const cases: Array<[string, VideoRenderInput, SunraRenderDeps | null, Record<string, string | undefined>, string]> = [
      ['flag unset', LANE_INPUT, null, {}, 'engine_error'],
      ['flag off', LANE_INPUT, null, { TWINGS_PERSONAL_SUNRA_FACES: 'off' }, 'engine_error'],
      ['flag junk', LANE_INPUT, null, { TWINGS_PERSONAL_SUNRA_FACES: 'ON ' }, 'engine_error'],
      ['seedance 2.0', { ...LANE_INPUT, engine: 'seedance-2.0' }, null, ON, 'engine_error'],
      ['480p', { ...LANE_INPUT, resolution: '480p' as never }, null, ON, 'engine_error'],
      ['photo bytes', { ...LANE_INPUT, photo: { bytes: new Uint8Array([1]), mime: 'image/jpeg' } }, null, ON, 'engine_error'],
      ['asset id', { ...LANE_INPUT, assetId: 'asset-1' }, null, ON, 'engine_error'],
      ['no references', { ...LANE_INPUT, references: undefined }, null, ON, 'engine_error'],
      ['data url', { ...LANE_INPUT, references: [{ type: 'image', url: 'data:image/png;base64,AAAA' }] }, null, ON, 'engine_error'],
      ['asset url', { ...LANE_INPUT, references: [{ type: 'image', url: 'asset://asset-1' }] }, null, ON, 'engine_error'],
      ['video reference', { ...LANE_INPUT, references: [{ type: 'image', url: A }, { type: 'video', url: B }] }, null, ON, 'engine_error'],
      ['prompt names a missing image', { ...LANE_INPUT, prompt: 'Image 1 and Image 3 dance.' }, null, ON, 'engine_error'],
      ['4:5 frame', { ...LANE_INPUT, aspect: '4:5' as never }, null, ON, 'engine_error'],
    ];
    for (const [label, input, given, env, code] of cases) {
      const { client, calls } = fakeSunra();
      const rec = recorder();
      await expect(startSunraRender(input, given ?? deps(client, rec), env), label).rejects.toMatchObject({ code, retryable: false });
      expect(calls.submit, label).toEqual([]);
      expect(rec.charges, label).toEqual([]);
    }
    const { client, calls } = fakeSunra();
    await expect(startSunraRender(LANE_INPUT, { sunra: client }, ON)).rejects.toMatchObject({ code: 'engine_error', retryable: false, message: expect.stringMatching(/charge/) });
    await expect(startSunraRender(LANE_INPUT, { ...deps(null) }, ON)).rejects.toMatchObject({ code: 'no_engine_key', retryable: false });
    expect(calls.submit).toEqual([]);
  });
});

describe('startSunraRender — a refused or lost submission', () => {
  async function submitFailing(error: unknown) {
    const { client, calls } = fakeSunra({ submit: async () => { throw error; } });
    const rec = recorder();
    const failure = await startSunraRender(LANE_INPUT, deps(client, rec), ON).then(
      () => { throw new Error('expected a failure'); },
      (e: unknown) => e as RenderFailure,
    );
    expect(failure).toBeInstanceOf(RenderFailure);
    expect(calls.submit).toHaveLength(1);
    return { failure, rec };
  }

  it('maps a policy refusal to moderated or face_policy, never retried, nothing charged', async () => {
    const unsafe = await submitFailing(new SunraError('PREDICTION_UNSAFE_CONTENT', 'unsafe content', 422, false));
    expect(unsafe.failure).toMatchObject({ code: 'moderated', retryable: false });
    const person = await submitFailing(new SunraError('content_policy_violation', 'the input shows a real person', 400, false));
    expect(person.failure).toMatchObject({ code: 'face_policy', retryable: false });
    for (const r of [unsafe.rec, person.rec]) {
      expect(r.charges).toEqual([]);
      expect(r.circuits).toEqual([]);
    }
  });

  it('opens the hold on a short balance (412, 402, INSUFFICIENT_CREDIT) and calls it engine_access, nothing charged', async () => {
    for (const error of [new SunraError('INSUFFICIENT_CREDIT', 'low balance', 400, false), new SunraError('http_412', 'hold', 412, false), new SunraError('http_402', 'pay', 402, false)]) {
      const { failure, rec } = await submitFailing(error);
      expect(failure).toMatchObject({ code: 'engine_access', retryable: false });
      expect(rec.circuits).toEqual([{ state: 'open_insufficient_hold', reason: expect.any(String) }]);
      expect(rec.charges).toEqual([]);
    }
    const key = await submitFailing(new SunraError('http_401', 'bad key', 401, false));
    expect(key.failure).toMatchObject({ code: 'engine_access', retryable: false });
    expect(key.rec.circuits).toEqual([]);
  });

  it('retries only an answer that says the request was not taken (429, 503), and opens the outage circuit', async () => {
    for (const status of [429, 503]) {
      const { failure, rec } = await submitFailing(new SunraError(`http_${status}`, 'busy', status, true));
      expect(failure).toMatchObject({ code: 'engine_error', retryable: true });
      expect(rec.circuits).toEqual([{ state: 'open_provider_outage', reason: expect.any(String) }]);
      expect(rec.charges).toEqual([]);
    }
  });

  it('never retries a submission that may have been accepted, and reports the estimated charge', async () => {
    const ambiguous: unknown[] = [
      new SunraError('sunra_network', 'socket hang up', 0, true),
      new SunraError('sunra_malformed_task', 'submit response has no request_id', 0, false),
      new SunraError('http_500', 'internal', 500, true),
      new SunraError('http_502', 'bad gateway', 502, true),
      new SunraError('http_504', 'gateway timeout', 504, true),
      new TypeError('fetch failed'),
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    ];
    for (const error of ambiguous) {
      const { failure, rec } = await submitFailing(error);
      expect(failure.retryable, String(error)).toBe(false);
      expect(rec.charges, String(error)).toEqual([{ taskId: null, usd: ESTIMATE_WITH_FEE, source: 'estimate' }]);
    }
  });

  it('refuses a request the provider rejected as invalid, without a charge, and still fails closed when the charge cannot be recorded', async () => {
    const invalid = await submitFailing(new SunraError('validation_error', 'ratio is invalid', 400, false));
    expect(invalid.failure).toMatchObject({ code: 'engine_error', retryable: false });
    expect(invalid.rec.charges).toEqual([]);

    const { client } = fakeSunra({ submit: async () => { throw new SunraError('sunra_network', 'reset', 0, true); } });
    const failing = { ...deps(client), onProviderCharge: async () => { throw new Error('db down'); } };
    await expect(startSunraRender(LANE_INPUT, failing, ON)).rejects.toMatchObject({ retryable: false });
  });
});

describe('pollSunraRender', () => {
  it('waits while the request is queued or running, and does not read the result', async () => {
    for (const status of ['IN_QUEUE', 'IN_PROGRESS'] as const) {
      const { client, calls } = fakeSunra({ status: async () => state({ status, success: null }) });
      await expect(pollSunraRender('sunra:req-1', POLL, deps(client))).resolves.toEqual({ status: 'pending' });
      expect(calls.status).toEqual(['req-1']);
      expect(calls.result).toEqual([]);
    }
  });

  it('books the billed amount x 1.05 as provider usage, downloads in ranged pieces, and reports no separate charge', async () => {
    const host = rangedHost();
    const { client } = fakeSunra({ status: async () => state({ billingUsd: 2.32 }) });
    const rec = recorder();
    const done = vi.fn(async () => undefined);
    const polled = await pollSunraRender('sunra:req-1', { ...POLL, onProviderDone: done }, deps(client, rec, { fetch: host.fetchFn }));
    expect(polled.status).toBe('succeeded');
    if (polled.status !== 'succeeded') return;
    expect(polled.output).toMatchObject({ provider: 'sunra', mime: 'video/mp4', costUsd: 2.436, costSource: 'provider_usage', completionTokens: null });
    expect(polled.output.bytes).toEqual(FILM);
    expect(done).toHaveBeenCalledTimes(1);
    expect(host.ranges.length).toBeGreaterThan(1);
    expect(host.ranges.every((range) => range !== null && /^bytes=\d+-\d+$/.test(range))).toBe(true);
    expect(rec.charges).toEqual([]);
    expect(rec.circuits).toEqual([]);
  });

  it('reads the charge from the result body or its units when the status has none, and falls back to the estimate', async () => {
    const fromBody = fakeSunra({ status: async () => state({}), result: async () => result({ billingUsd: 2.3 }) });
    const a = await pollSunraRender('sunra:req-1', POLL, deps(fromBody.client));
    expect(a).toMatchObject({ status: 'succeeded', output: { costUsd: 2.415, costSource: 'provider_usage' } });
    const fromUnits = fakeSunra({ status: async () => state({}), result: async () => result({ units: 2310 }) });
    const b = await pollSunraRender('sunra:req-1', POLL, deps(fromUnits.client));
    expect(b).toMatchObject({ status: 'succeeded', output: { costUsd: 2.4255, costSource: 'provider_usage' } });
    const none = fakeSunra({ status: async () => state({}) });
    const c = await pollSunraRender('sunra:req-1', POLL, deps(none.client));
    expect(c).toMatchObject({ status: 'succeeded', output: { costUsd: ESTIMATE_WITH_FEE, costSource: 'estimate' } });
  });

  it('opens the circuit on a price drift but still delivers the film the customer paid for', async () => {
    const { client } = fakeSunra({ status: async () => state({ billingUsd: 3.1 }) });
    const rec = recorder();
    const polled = await pollSunraRender('sunra:req-1', POLL, deps(client, rec));
    expect(polled).toMatchObject({ status: 'succeeded', output: { costUsd: 3.255, costSource: 'provider_usage' } });
    expect(rec.circuits).toEqual([{ state: 'open_price_drift', reason: expect.stringMatching(/drift/) }]);
  });

  it('treats COMPLETED with success:false as a failure, never retried; a reported charge is recorded', async () => {
    const unsafe = fakeSunra({ status: async () => state({ success: false, error: { code: 'PREDICTION_UNSAFE_CONTENT', reason: 'moderation', retryable: true, message: 'unsafe' } }) });
    const rec = recorder();
    const a = await pollSunraRender('sunra:req-1', POLL, deps(unsafe.client, rec));
    expect(a).toMatchObject({ status: 'failed', failure: { code: 'moderated', retryable: false } });
    expect(unsafe.calls.result).toEqual([]);
    expect(rec.charges).toEqual([]);

    const billed = fakeSunra({ status: async () => state({ success: false, billingUsd: 2.32, error: { code: 'internal_error', reason: null, retryable: true, message: 'render crashed' } }) });
    const rec2 = recorder();
    const b = await pollSunraRender('sunra:req-1', POLL, deps(billed.client, rec2));
    expect(b).toMatchObject({ status: 'failed', failure: { code: 'engine_error', retryable: false } });
    expect(rec2.charges).toEqual([{ taskId: 'sunra:req-1', usd: 2.436, source: 'provider_usage' }]);

    const errorOnly = fakeSunra({ status: async () => state({ success: null, error: { code: 'x', reason: 'insufficient credit', retryable: null, message: 'balance' } }) });
    const rec3 = recorder();
    const c = await pollSunraRender('sunra:req-1', POLL, deps(errorOnly.client, rec3));
    expect(c).toMatchObject({ status: 'failed', failure: { code: 'engine_access', retryable: false } });
    expect(rec3.circuits).toEqual([{ state: 'open_insufficient_hold', reason: expect.any(String) }]);

    const person = fakeSunra({ status: async () => state({ success: false, error: { code: 'content_policy_violation', reason: 'real_person', retryable: false, message: 'a real person was detected' } }) });
    const d = await pollSunraRender('sunra:req-1', POLL, deps(person.client));
    expect(d).toMatchObject({ status: 'failed', failure: { code: 'face_policy', retryable: false } });

    const canceled = fakeSunra({ status: async () => state({ status: 'CANCELED', success: null }) });
    const e = await pollSunraRender('sunra:req-1', POLL, deps(canceled.client));
    expect(e).toMatchObject({ status: 'failed', failure: { code: 'engine_error', retryable: false } });
  });

  it('records the charge when a successful prediction leaves nothing usable', async () => {
    const empty = fakeSunra({ status: async () => state({ billingUsd: 2.32 }), result: async () => result({ files: [] }) });
    const rec = recorder();
    const a = await pollSunraRender('sunra:req-1', POLL, deps(empty.client, rec));
    expect(a).toMatchObject({ status: 'failed', failure: { code: 'bad_output', retryable: false } });
    expect(rec.charges).toEqual([{ taskId: 'sunra:req-1', usd: 2.436, source: 'provider_usage' }]);

    const errored = fakeSunra({ status: async () => state({}), result: async () => result({ error: { code: 'decode_error', reason: null, message: 'bad frames' } }) });
    const rec2 = recorder();
    const b = await pollSunraRender('sunra:req-1', POLL, deps(errored.client, rec2));
    expect(b).toMatchObject({ status: 'failed', failure: { retryable: false } });
    expect(rec2.charges).toEqual([{ taskId: 'sunra:req-1', usd: ESTIMATE_WITH_FEE, source: 'estimate' }]);

    const refusedHost = fakeSunra({ status: async () => state({ billingUsd: 2.32 }), result: async () => result({ files: [{ url: 'http://10.0.0.1/x.mp4', contentType: 'video/mp4' }] }) });
    const rec3 = recorder();
    const c = await pollSunraRender('sunra:req-1', POLL, deps(refusedHost.client, rec3));
    expect(c).toMatchObject({ status: 'failed', failure: { code: 'bad_output', retryable: false } });
    expect(rec3.charges).toEqual([{ taskId: 'sunra:req-1', usd: 2.436, source: 'provider_usage' }]);
  });

  it('keeps a download hiccup pending (re-download only), and a poll that cannot reach Sunra pending', async () => {
    const { client, calls } = fakeSunra({ status: async () => state({ billingUsd: 2.32 }) });
    let first = true;
    const flaky = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (first) { first = false; throw new TypeError('socket hang up'); }
      return rangedHost().fetchFn(url, init);
    }) as typeof fetch;
    const rec = recorder();
    await expect(pollSunraRender('sunra:req-1', POLL, deps(client, rec, { fetch: flaky }))).resolves.toEqual({ status: 'pending' });
    await expect(pollSunraRender('sunra:req-1', POLL, deps(client, rec, { fetch: flaky }))).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls.submit).toEqual([]);
    expect(rec.charges).toEqual([]);

    const offline = fakeSunra({ status: async () => { throw new SunraError('sunra_network', 'reset', 0, true); } });
    await expect(pollSunraRender('sunra:req-1', POLL, deps(offline.client))).resolves.toEqual({ status: 'pending' });
    const busy = fakeSunra({ status: async () => { throw new SunraError('http_503', 'busy', 503, true); } });
    await expect(pollSunraRender('sunra:req-1', POLL, deps(busy.client))).resolves.toEqual({ status: 'pending' });
  });

  it('fails a request whose state cannot be read at all, and reports the estimated charge', async () => {
    const gone = fakeSunra({ status: async () => { throw new SunraError('http_404', 'not found', 404, false); } });
    const rec = recorder();
    await expect(pollSunraRender('sunra:req-1', POLL, deps(gone.client, rec))).resolves.toMatchObject({ status: 'failed', failure: { retryable: false } });
    expect(rec.charges).toEqual([{ taskId: 'sunra:req-1', usd: ESTIMATE_WITH_FEE, source: 'estimate' }]);

    const rec2 = recorder();
    await expect(pollSunraRender('sunra:req-1', POLL, deps(null, rec2))).resolves.toMatchObject({ status: 'failed', failure: { code: 'no_engine_key', retryable: false } });
    expect(rec2.charges).toEqual([{ taskId: 'sunra:req-1', usd: ESTIMATE_WITH_FEE, source: 'estimate' }]);
  });

  it('stays pending rather than settle a charged failure it could not record', async () => {
    const billed = fakeSunra({ status: async () => state({ success: false, billingUsd: 2.32, error: { code: 'internal_error', reason: null, retryable: false, message: 'x' } }) });
    const broken = { ...deps(billed.client), onProviderCharge: async () => { throw new Error('db down'); } };
    await expect(pollSunraRender('sunra:req-1', POLL, broken)).resolves.toEqual({ status: 'pending' });
    const missing = { sunra: billed.client };
    await expect(pollSunraRender('sunra:req-1', POLL, missing)).resolves.toEqual({ status: 'pending' });
  });
});

describe('the dispatch marker (written before submit by the caller, replaced by sunra:{id} after)', () => {
  const now = new Date('2026-11-24T06:00:00.000Z');

  it('is recognised as a Sunra lane task id, and the prefixes do not collide', () => {
    const marker = sunraDispatchMarker(now);
    expect(marker).toBe(`${SUNRA_DISPATCH_PREFIX}2026-11-24T06:00:00.000Z`);
    expect(isSunraLaneTaskId(marker)).toBe(true);
    expect(isSunraLaneTaskId('sunra:req-1')).toBe(true);
    for (const other of ['cgt-20261124-abc', '892734982734', 'asset:asset-1', 'campaign-dispatch:1', 'sunrise:1']) expect(isSunraLaneTaskId(other), other).toBe(false);
  });

  it('waits on a young marker without calling Sunra, and fails an old one with the estimated charge, never retried', async () => {
    const { client, calls } = fakeSunra();
    const rec = recorder();
    const young = sunraDispatchMarker(new Date(now.getTime() - SUNRA_DISPATCH_STALE_MS + 60_000));
    await expect(pollSunraRender(young, POLL, deps(client, rec, { now: () => now }))).resolves.toEqual({ status: 'pending' });
    const old = sunraDispatchMarker(new Date(now.getTime() - SUNRA_DISPATCH_STALE_MS - 1));
    await expect(pollSunraRender(old, POLL, deps(client, rec, { now: () => now }))).resolves.toMatchObject({ status: 'failed', failure: { code: 'network', retryable: false } });
    await expect(pollSunraRender(`${SUNRA_DISPATCH_PREFIX}garbage`, POLL, deps(client, rec, { now: () => now }))).resolves.toMatchObject({ status: 'failed', failure: { retryable: false } });
    expect(rec.charges).toEqual([
      { taskId: old, usd: ESTIMATE_WITH_FEE, source: 'estimate' },
      { taskId: `${SUNRA_DISPATCH_PREFIX}garbage`, usd: ESTIMATE_WITH_FEE, source: 'estimate' },
    ]);
    expect(calls.submit).toEqual([]);
    expect(calls.status).toEqual([]);
  });
});

describe('the three hooks in lib/renders/engines.ts', () => {
  const ARK_INPUT: VideoRenderInput = { engine: 'seedance-2.5', prompt: 'Image 1 waves.', aspect: '9:16', seconds: 10, photo: null, assetId: 'asset-9', resolution: '720p', fixedReferenceUrls: ['https://twings.app/reel/fixed.png'] };

  function fakeArk() {
    const created: CreateVideoTaskInput[] = [];
    const polled: string[] = [];
    const ark: ArkClient = {
      async createVideoTask(input) { created.push(input); return { id: 'cgt-1' }; },
      async getVideoTask(id) { polled.push(id); return { id, status: 'running', model: null, videoUrl: null, error: null, completionTokens: null, createdAt: null, updatedAt: null } satisfies ArkTask; },
    };
    return { ark, created, polled };
  }

  it('route a lane:sunra start and a sunra: poll to the adapter', async () => {
    vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
    const { client, calls } = fakeSunra();
    const { ark, created, polled } = fakeArk();
    const rec = recorder();
    const started = await startVideoRender(LANE_INPUT, { ark, sunra: client, onProviderCharge: rec.onProviderCharge, fetch: rangedHost().fetchFn });
    expect(started.provider).toBe('sunra');
    expect(calls.submit).toHaveLength(1);
    await expect(pollVideoRender({ taskId: started.taskId, model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '9:16' }, { ark, sunra: client })).resolves.toEqual({ status: 'pending' });
    expect(calls.status).toEqual(['req-1']);
    expect(created).toEqual([]);
    expect(polled).toEqual([]);
  });

  it('PARITY: without lane:sunra the ModelArk payload is byte-for-byte what it was, and the Sunra client is never called', async () => {
    for (const flag of [undefined, 'off', 'yes', 'on']) {
      if (flag === undefined) vi.unstubAllEnvs();
      else vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', flag);
      const { client, calls } = fakeSunra();
      const { ark, created, polled } = fakeArk();
      const started = await startVideoRender(ARK_INPUT, { ark, sunra: client, onProviderCharge: async () => { throw new Error('never'); } });
      expect(started).toEqual({ taskId: 'cgt-1', model: 'seedance-2.5', seconds: 10, provider: 'modelark' });
      // Captured before this change (origin/main 1ecaf399): the same content list, flags and frame.
      expect(created).toEqual([{
        model: 'seedance-2.5',
        content: [
          { type: 'text', text: 'Image 1 waves.' },
          { type: 'image_url', image_url: { url: 'asset://asset-9' }, role: 'reference_image' },
          { type: 'image_url', image_url: { url: 'https://twings.app/reel/fixed.png' }, role: 'reference_image' },
        ],
        resolution: '720p',
        ratio: '9:16',
        duration: 10,
        generateAudio: true,
        watermark: false,
      }]);
      await expect(pollVideoRender({ taskId: 'cgt-1', model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '9:16' }, { ark, sunra: client })).resolves.toEqual({ status: 'pending' });
      expect(polled).toEqual(['cgt-1']);
      expect(calls).toEqual({ submit: [], status: [], result: [] });
    }
  });

  it('PARITY through the render pass: a video job with the switch on and a Sunra client wired still renders on its own provider', async () => {
    vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
    const h = await promptHarness();
    const root = await mkdtemp(join(tmpdir(), 'twings-sunra-parity-'));
    try {
      const store = createLocalRenderStore(root);
      await h.sql.query(`update prompt_items set engine = 'kling-omni' where slug = 'neon-alley-dolly'`);
      const photo = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mime: 'image/jpeg' as const };
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: 'neon-alley-dolly', aspect: '9:16', photo, locale: 'ko' });
      if (!created.ok) throw new Error(created.code);
      const klingTask = (status: KlingTask['status'], videoUrl: string | null = null): KlingTask =>
        ({ id: 'task-9', status, message: null, videoUrl, durationSeconds: null, billedUsd: 0.84, createdAt: null, updatedAt: null });
      let current = klingTask('processing');
      const kling: KlingClient = { model: 'kling-3.0-omni', async createVideoTask() { return { id: 'task-9' }; }, async getVideoTask() { return current; } };
      const { client, calls } = fakeSunra();
      const charges: unknown[] = [];
      const deps: RenderPassDeps = {
        sql: h.sql, store, now: new Date('2026-11-24T06:00:00.000Z'), mode: 'virtual',
        engines: { kling, ark: null, sunra: client, onProviderCharge: async (...args) => { charges.push(args); }, fetch: async () => new Response(FILM.slice(0, 64), { status: 200, headers: { 'content-type': 'video/mp4' } }) },
        notifier: createEmailRenderNotifier(createFakeMailer()), siteUrl: 'https://twings.test', siteName: 'TWINGS', assets: null,
      };
      expect(await runRenderPass(deps, { jobId: created.id })).toMatchObject({ claimed: 1, waiting: 1 });
      expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'running', provider: 'kling', providerTaskId: 'task-9' });
      current = klingTask('succeeded', 'https://cdn.kling/out.mp4');
      expect(await runRenderPass(deps, { limit: 0 })).toMatchObject({ succeeded: 1 });
      expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'succeeded', provider: 'kling', costUsd: 0.84 });
      expect(calls).toEqual({ submit: [], status: [], result: [] });
      expect(charges).toEqual([]);
    } finally {
      await h.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('MAGI-2 on the personal Sunra lane', () => {
  const MAGI_ENV = { TWINGS_PERSONAL_SUNRA_FACES: 'on', TWINGS_PERSONAL_MAGI2: 'on' };
  const MAGI_INPUT: VideoRenderInput = {
    engine: 'magi-2',
    prompt: 'A subject walks down a lit street.',
    aspect: '9:16',
    seconds: 10,
    photo: null,
    resolution: '1080p',
    references: [{ type: 'image', url: A }],
  };
  /** $0.08 * 10 = $0.80 list price, booked with 5% top-up fee = $0.84. */
  const MAGI_ESTIMATE_WITH_FEE = 0.84;

  function fakeArk() {
    const created: CreateVideoTaskInput[] = [];
    const ark: ArkClient = {
      async createVideoTask(input) { created.push(input); return { id: 'cgt-never' }; },
      async getVideoTask() { throw new Error('never'); },
    };
    return { ark, created };
  }

  it('refuses MAGI-2 in startSunraRender and startVideoRender unless BOTH flags are on', async () => {
    for (const env of [
      {},
      { TWINGS_PERSONAL_SUNRA_FACES: 'on' },
      { TWINGS_PERSONAL_MAGI2: 'on' },
      { TWINGS_PERSONAL_SUNRA_FACES: 'on', TWINGS_PERSONAL_MAGI2: 'off' },
    ]) {
      const { client, calls } = fakeSunra();
      const { ark, created } = fakeArk();
      const rec = recorder();
      await expect(startSunraRender({ ...MAGI_INPUT, lane: 'sunra' }, deps(client, rec), env)).rejects.toMatchObject({ code: 'engine_error', retryable: false });
      await expect(startVideoRender(MAGI_INPUT, { ark, sunra: client, onProviderCharge: rec.onProviderCharge }, env)).rejects.toMatchObject({ code: 'no_engine_key', retryable: false });
      expect(calls.submit).toEqual([]);
      expect(created).toEqual([]);
    }
  });

  it('routes startVideoRender(magi-2) to Sunra when both flags are on and sends sand/magi-2/reference-to-video', async () => {
    const { client, calls } = fakeSunra();
    const { ark, created } = fakeArk();
    const rec = recorder();
    const started = await startVideoRender(
      {
        ...MAGI_INPUT,
        references: [
          { type: 'image', url: A },
          { type: 'video', url: 'https://media.example.com/renders/job-1/motion.mp4?sig=3' },
          { type: 'audio', url: 'https://media.example.com/renders/job-1/voice.wav?sig=4' },
        ],
      },
      { ark, sunra: client, onProviderCharge: rec.onProviderCharge, fetch: rangedHost().fetchFn },
      MAGI_ENV,
    );
    expect(started).toEqual({ taskId: 'sunra:req-1', model: 'magi-2', seconds: 10, provider: 'sunra' });
    expect(created).toEqual([]);
    expect(calls.submit).toEqual([{
      endpoint: 'sand/magi-2/reference-to-video',
      body: {
        prompt: 'A subject walks down a lit street.',
        duration: 10,
        aspect_ratio: '9:16',
        resolution: '1080p',
        generate_audio: true,
        reference_images: [A],
        reference_videos: ['https://media.example.com/renders/job-1/motion.mp4?sig=3'],
        reference_audios: ['https://media.example.com/renders/job-1/voice.wav?sig=4'],
      },
    }]);
  });

  it('refuses non-https / data URLs, 720p, missing charge recorder, and records ambiguous submits without retry', async () => {
    const { client, calls } = fakeSunra();
    const rec = recorder();
    await expect(startSunraRender({ ...MAGI_INPUT, resolution: '720p' }, deps(client, rec), MAGI_ENV)).rejects.toMatchObject({ code: 'engine_error', retryable: false });
    await expect(startSunraRender({ ...MAGI_INPUT, references: [{ type: 'image', url: 'data:image/png;base64,AAAA' }] }, deps(client, rec), MAGI_ENV)).rejects.toMatchObject({ code: 'engine_error', retryable: false });
    await expect(startSunraRender({ ...MAGI_INPUT, references: [{ type: 'image', url: 'http://media.example.com/a.png' }] }, deps(client, rec), MAGI_ENV)).rejects.toMatchObject({ code: 'engine_error', retryable: false });
    await expect(startSunraRender(MAGI_INPUT, { sunra: client }, MAGI_ENV)).rejects.toMatchObject({ code: 'engine_error', retryable: false, message: expect.stringMatching(/charge/) });
    expect(calls.submit).toEqual([]);

    const flaky = fakeSunra({ submit: async () => { throw new SunraError('http_500', 'internal', 500, true); } });
    const rec2 = recorder();
    await expect(startSunraRender(MAGI_INPUT, deps(flaky.client, rec2), MAGI_ENV)).rejects.toMatchObject({ retryable: false });
    expect(flaky.calls.submit).toHaveLength(1);
    expect(rec2.charges).toEqual([{ taskId: null, usd: MAGI_ESTIMATE_WITH_FEE, source: 'estimate' }]);
  });

  it('refuses before any call (not retryable, nothing billed) a prompt with an unresolved {{…}} token or a reference it does not carry', async () => {
    const VIDEO_URL = 'https://media.example.com/renders/job-1/motion.mp4?sig=3';
    const AUDIO_URL = 'https://media.example.com/renders/job-1/voice.wav?sig=4';
    const cases: Array<[string, VideoRenderInput]> = [
      ['unresolved selfie token', { ...MAGI_INPUT, prompt: '{{selfie}} walks down a lit street.' }],
      ['unresolved token with spaces', { ...MAGI_INPUT, prompt: 'Image 1 walks with {{ product }}.' }],
      ['stray closing braces', { ...MAGI_INPUT, prompt: 'Image 1 walks }} down a lit street.' }],
      ['image past the count', { ...MAGI_INPUT, prompt: 'Image 1 and Image 2 walk down a lit street.' }],
      ['@image past the count', { ...MAGI_INPUT, prompt: '@Image2 walks down a lit street.' }],
      ['video not attached', { ...MAGI_INPUT, prompt: 'Image 1 moves like Video 1.' }],
      ['audio not attached', { ...MAGI_INPUT, prompt: 'Image 1 sings over Audio 1.', references: [{ type: 'image', url: A }, { type: 'video', url: VIDEO_URL }] }],
      ['second video not attached', { ...MAGI_INPUT, prompt: 'Image 1 moves like Video 2.', references: [{ type: 'image', url: A }, { type: 'video', url: VIDEO_URL }] }],
    ];
    for (const [label, input] of cases) {
      const { client, calls } = fakeSunra();
      const rec = recorder();
      await expect(startSunraRender(input, deps(client, rec), MAGI_ENV), label).rejects.toMatchObject({ code: 'engine_error', retryable: false });
      expect(calls.submit, label).toEqual([]);
      expect(rec.charges, label).toEqual([]);
      expect(rec.circuits, label).toEqual([]);
    }
    // The same prompts are fine once the reference is there, and the prompt goes out exactly as written (no
    // Seedance "@ImageN" rewrite: MAGI-2's own reference syntax is not verified yet).
    const { client, calls } = fakeSunra();
    await startSunraRender(
      { ...MAGI_INPUT, prompt: 'Image 1 moves like Video 1 and sings over Audio 1. She says "Image 9".', references: [{ type: 'image', url: A }, { type: 'video', url: VIDEO_URL }, { type: 'audio', url: AUDIO_URL }] },
      deps(client),
      MAGI_ENV,
    );
    expect(calls.submit).toHaveLength(1);
    expect(calls.submit[0]!.body).toMatchObject({
      prompt: 'Image 1 moves like Video 1 and sings over Audio 1. She says "Image 9".',
      reference_images: [A],
      reference_videos: [VIDEO_URL],
      reference_audios: [AUDIO_URL],
    });
  });

  it('classifies references by their explicit type and refuses an unknown type instead of sending it as audio', async () => {
    for (const type of ['text', 'Audio', 'mask', '', undefined, null]) {
      const { client, calls } = fakeSunra();
      const rec = recorder();
      const input: VideoRenderInput = { ...MAGI_INPUT, references: [{ type: 'image', url: A }, { type: type as never, url: B }] };
      await expect(startSunraRender(input, deps(client, rec), MAGI_ENV), String(type)).rejects.toMatchObject({ code: 'engine_error', retryable: false });
      expect(calls.submit, String(type)).toEqual([]);
      expect(rec.charges, String(type)).toEqual([]);
    }
  });

  it('polls MAGI-2 using $0.08/s estimate fallback, records billed failures, and checks MAGI-2 price drift', async () => {
    const magiPoll = { model: 'magi-2' as const, seconds: 10, resolution: '1080p' as const, aspect: '9:16' };
    const none = fakeSunra({ status: async () => state({}) });
    const est = await pollSunraRender('sunra:req-1', magiPoll, deps(none.client));
    expect(est).toMatchObject({ status: 'succeeded', output: { costUsd: MAGI_ESTIMATE_WITH_FEE, costSource: 'estimate' } });

    const billedFail = fakeSunra({ status: async () => state({ success: false, billingUsd: 0.8, error: { code: 'internal_error', reason: null, retryable: true, message: 'failed' } }) });
    const recFail = recorder();
    await expect(pollSunraRender('sunra:req-1', magiPoll, deps(billedFail.client, recFail))).resolves.toMatchObject({ status: 'failed', failure: { retryable: false } });
    expect(recFail.charges).toEqual([{ taskId: 'sunra:req-1', usd: 0.84, source: 'provider_usage' }]);

    const drift = fakeSunra({ status: async () => state({ billingUsd: 1.0 }) });
    const recDrift = recorder();
    await expect(pollSunraRender('sunra:req-1', magiPoll, deps(drift.client, recDrift))).resolves.toMatchObject({ status: 'succeeded', output: { costUsd: 1.05, costSource: 'provider_usage' } });
    expect(recDrift.circuits).toEqual([{ state: 'open_price_drift', reason: expect.stringMatching(/drift/) }]);
  });
});
