import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GeminiImageClient, GeminiImageResult } from '@/lib/images/gemini';
import { GeminiImageError } from '@/lib/images/gemini';
import { KlingError, type CreateKlingTaskInput, type KlingClient, type KlingTask } from '@/lib/kling/client';
import { engineProvider, IMAGE_ENGINE_IDS, VIDEO_ENGINE_IDS, type EngineId } from '@/lib/images/engines';
import { needsIdentity } from '@/lib/identity/service';
import { identityPath } from '@/lib/recipes/schema';
import { RenderFailure, looksLikeFaceRefusal, pollVideoRender, runImageRender, startVideoRender, videoModelFor } from '@/lib/renders/engines';
import { loadRenderJob } from '@/lib/renders/repo';
import { createRenderJob, runRenderPass, type RenderPassDeps } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { createFakeMailer } from '@/lib/notify/mailer-fake';
import { createEmailRenderNotifier } from '@/lib/renders/notify';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * R2 (docs/PLATFORM-2.0.md §7.3, §18): the two new adapters through the render engines layer and
 * the pass, faked at their seams — the same failure vocabulary, the same retry rule, the person's
 * photo on the bytes path, and the job row recording the new providers (migration 0061).
 */

const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mime: 'image/jpeg' as const };
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 7, 8, 9]);
const VIDEO = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const okImage = (): GeminiImageResult => ({ b64: Buffer.from(IMAGE).toString('base64'), mime: 'image/jpeg', size: '1856x2304', usage: { inputTokens: 1400, outputTokens: 1680, outputImageTokens: 1680 }, usd: 0.0525, interactionId: 'int-1' });
const task = (status: KlingTask['status'], videoUrl: string | null = null, extra: Partial<KlingTask> = {}): KlingTask =>
  ({ id: 'task-1', status, message: null, videoUrl, durationSeconds: null, billedUsd: null, createdAt: null, updatedAt: null, ...extra });
const doFetch: typeof fetch = async () => new Response(VIDEO, { status: 200, headers: { 'content-type': 'video/mp4' } });

describe('the real-person matrix (needsIdentity · identityPath)', () => {
  it('sends the photo as bytes to OpenAI, Gemini and Kling, and only as a verified asset to ModelArk — one rule, two readers', () => {
    const all: EngineId[] = [...IMAGE_ENGINE_IDS, ...VIDEO_ENGINE_IDS];
    for (const engine of all) expect(identityPath(engine) === 'asset', engine).toBe(needsIdentity(engine));
    expect(needsIdentity('nano-banana-2.1')).toBe(false);
    expect(needsIdentity('kling-omni')).toBe(false);
    expect(needsIdentity('seedance-2.5')).toBe(true);
    expect(needsIdentity('seedream-5.0-lite')).toBe(true);
    expect(engineProvider('nano-banana-2.1')).toBe('google');
    expect(engineProvider('kling-omni')).toBe('kling');
  });
});

describe('Gemini through runImageRender', () => {
  it('sends the photo as bytes, returns the image with the booked estimate, and says which key is missing', async () => {
    const calls: Array<{ prompt: string; references: number; aspect: string }> = [];
    const gemini = { model: 'gemini-nano-banana-2.1', async generate(input: { prompt: string; references?: unknown[]; aspect: string }) { calls.push({ prompt: input.prompt, references: input.references?.length ?? 0, aspect: input.aspect }); return okImage(); } } as unknown as GeminiImageClient;
    const output = await runImageRender({ engine: 'nano-banana-2.1', prompt: 'Image 1 smiles', aspect: '4:5', photo: PHOTO, assetId: null }, { gemini });
    expect(output).toMatchObject({ provider: 'google', mime: 'image/jpeg', costUsd: 0.0525, costSource: 'estimate' });
    expect(output.bytes).toEqual(IMAGE);
    expect(calls).toEqual([{ prompt: 'Image 1 smiles', references: 1, aspect: '4:5' }]);
    await expect(runImageRender({ engine: 'nano-banana-2.1', prompt: 'p', aspect: '4:5', photo: PHOTO, assetId: null }, { gemini: null })).rejects.toMatchObject({ code: 'no_engine_key', message: 'GEMINI_API_KEY is not set' });
    await expect(runImageRender({ engine: 'nano-banana-2.1', prompt: 'p', aspect: '4:5', photo: null, assetId: null, references: [{ kind: 'url', url: 'asset://a' }] }, { gemini })).rejects.toMatchObject({ code: 'engine_error', retryable: false });
  });

  it('maps its refusals onto the shared vocabulary: face_policy, moderated, engine_access, retryable engine_error', async () => {
    const failing = (error: Error) => ({ model: 'm', async generate() { throw error; } }) as unknown as GeminiImageClient;
    const run = (gemini: GeminiImageClient) => runImageRender({ engine: 'nano-banana-2.1', prompt: 'p', aspect: '1:1', photo: PHOTO, assetId: null }, { gemini });
    await expect(run(failing(new GeminiImageError('blocked: the input depicts a real person', 400, 'safety')))).rejects.toMatchObject({ code: 'face_policy', retryable: false });
    await expect(run(failing(new GeminiImageError('prohibited content', 400, 'INVALID_ARGUMENT')))).rejects.toMatchObject({ code: 'moderated', retryable: false });
    await expect(run(failing(new GeminiImageError('the interaction ended incomplete', 200, null, 'incomplete')))).rejects.toMatchObject({ code: 'moderated', retryable: false });
    await expect(run(failing(new GeminiImageError('key not valid', 403, '403')))).rejects.toMatchObject({ code: 'engine_access', retryable: false });
    await expect(run(failing(new GeminiImageError('RESOURCE_EXHAUSTED', 429, '429')))).rejects.toMatchObject({ code: 'engine_error', retryable: true });
    await expect(run(failing(new GeminiImageError('bad request', 400, '400')))).rejects.toMatchObject({ code: 'engine_error', retryable: false });
    await expect(run(failing(new TypeError('fetch failed')))).rejects.toMatchObject({ code: 'network', retryable: true });
    expect(looksLikeFaceRefusal('Request blocked: portrait of a real person')).toBe(true);
    expect(looksLikeFaceRefusal('Request blocked: violence')).toBe(false);
  });
});

describe('Kling through startVideoRender / pollVideoRender', () => {
  function fakeKling(state: { task: KlingTask; calls: CreateKlingTaskInput[]; fail?: KlingError }): KlingClient {
    return {
      model: 'kling-3.0-omni',
      async createVideoTask(input) { if (state.fail) throw state.fail; state.calls.push(input); return { id: 'task-1' }; },
      async getVideoTask() { return state.task; },
    };
  }

  it('hands the photo over as bytes with the clamped duration, and refuses what Kling cannot take', async () => {
    const state = { task: task('submitted'), calls: [] as CreateKlingTaskInput[] };
    const kling = fakeKling(state);
    const started = await startVideoRender({ engine: 'kling-omni', prompt: 'Image 1 waves', aspect: '9:16', seconds: 20, photo: PHOTO, assetId: null, fixedReferenceUrls: ['https://twings.test/reel/plate.jpg'] }, { kling });
    expect(started).toEqual({ taskId: 'task-1', model: 'kling-3.0-omni', seconds: 15, provider: 'kling' });
    expect(state.calls[0]).toMatchObject({ prompt: 'Image 1 waves', resolution: '720p', aspect: '9:16', duration: 15, audio: 'native' });
    expect(state.calls[0]!.references).toEqual([{ type: 'image', url: `data:image/jpeg;base64,${Buffer.from(PHOTO.bytes).toString('base64')}` }, { type: 'image', url: 'https://twings.test/reel/plate.jpg' }]);
    expect(videoModelFor('kling-omni', 5)).toEqual({ model: 'kling-3.0-omni', seconds: 5 });
    await expect(startVideoRender({ engine: 'kling-omni', prompt: 'p', aspect: '4:3', seconds: 5, photo: PHOTO, assetId: null }, { kling })).rejects.toMatchObject({ code: 'engine_error', retryable: false, message: expect.stringContaining('4:3') });
    await expect(startVideoRender({ engine: 'kling-omni', prompt: 'p', aspect: '9:16', seconds: 5, photo: null, assetId: 'asset-1' }, { kling })).rejects.toMatchObject({ code: 'engine_error', retryable: false });
    await expect(startVideoRender({ engine: 'kling-omni', prompt: 'p', aspect: '9:16', seconds: 5, photo: PHOTO, assetId: null }, { kling: null })).rejects.toMatchObject({ code: 'no_engine_key', message: 'KLING_API_KEY is not set' });
    // A Seedance job never reaches the Kling client, and vice versa.
    await expect(startVideoRender({ engine: 'seedance-2.0', prompt: 'p', aspect: '9:16', seconds: 5, photo: PHOTO, assetId: null }, { ark: null, kling })).rejects.toMatchObject({ code: 'no_engine_key', message: 'ARK_API_KEY is not set' });
  });

  it('translates the service codes at creation like every other adapter', async () => {
    const run = (fail: KlingError) => startVideoRender({ engine: 'kling-omni', prompt: 'p', aspect: '1:1', seconds: 5, photo: PHOTO, assetId: null }, { kling: fakeKling({ task: task('submitted'), calls: [], fail }) });
    await expect(run(new KlingError('1301', 'Trigger the platform content security policy: real person detected', 400, false))).rejects.toMatchObject({ code: 'face_policy', retryable: false });
    await expect(run(new KlingError('1300', 'Request blocked by platform policy', 400, false))).rejects.toMatchObject({ code: 'moderated', retryable: false });
    await expect(run(new KlingError('1103', 'Unauthorized access to model', 403, false))).rejects.toMatchObject({ code: 'engine_access', retryable: false });
    await expect(run(new KlingError('1101', 'Account in arrears', 429, true))).rejects.toMatchObject({ code: 'engine_access', retryable: false });
    await expect(run(new KlingError('1302', 'rate limit', 429, true))).rejects.toMatchObject({ code: 'engine_error', retryable: true });
    await expect(run(new KlingError('5000', 'internal', 500, true))).rejects.toMatchObject({ code: 'engine_error', retryable: true });
    await expect(run(new KlingError('1201', 'invalid parameter', 400, false))).rejects.toMatchObject({ code: 'engine_error', retryable: false });
    await expect(run(new KlingError('kling_network', 'ECONNRESET', 0, true))).rejects.toMatchObject({ code: 'network', retryable: true });
    await expect(run(new KlingError('kling_malformed_task', 'no id', 0, false))).rejects.toMatchObject({ code: 'bad_output', retryable: false });
  });

  it('polls: pending while it runs, downloaded and priced when done, policy or error when it fails', async () => {
    const state = { task: task('processing'), calls: [] as CreateKlingTaskInput[] };
    const kling = fakeKling(state);
    const args = { taskId: 'task-1', model: 'kling-3.0-omni' as const, seconds: 10, resolution: '720p' as const, aspect: '9:16' };
    expect(await pollVideoRender(args, { kling, fetch: doFetch })).toEqual({ status: 'pending' });

    let finishing = 0;
    state.task = task('succeeded', 'https://cdn.kling/out.mp4', { durationSeconds: 10 });
    const estimated = await pollVideoRender({ ...args, onProviderDone: async () => { finishing += 1; } }, { kling, fetch: doFetch });
    expect(finishing).toBe(1);
    expect(estimated.status === 'succeeded' && estimated.output).toMatchObject({ provider: 'kling', mime: 'video/mp4', costUsd: 1.12, costSource: 'estimate', completionTokens: null });
    expect(estimated.status === 'succeeded' && estimated.output.bytes).toEqual(VIDEO);

    state.task = task('succeeded', 'https://cdn.kling/out.mp4', { billedUsd: 1.05 });
    const billed = await pollVideoRender(args, { kling, fetch: doFetch });
    expect(billed.status === 'succeeded' && billed.output).toMatchObject({ costUsd: 1.05, costSource: 'provider_usage' });

    state.task = task('failed', null, { message: 'Trigger the platform content risk control' });
    expect(await pollVideoRender(args, { kling, fetch: doFetch })).toMatchObject({ status: 'failed', failure: { code: 'moderated', retryable: false } });
    state.task = task('failed', null, { message: 'risk control: the reference image contains a real person' });
    expect(await pollVideoRender(args, { kling, fetch: doFetch })).toMatchObject({ status: 'failed', failure: { code: 'face_policy' } });
    state.task = task('failed', null, { message: 'internal error' });
    expect(await pollVideoRender(args, { kling, fetch: doFetch })).toMatchObject({ status: 'failed', failure: { code: 'engine_error', retryable: false } });

    // A poll that cannot reach the provider is not a failed render; a dead key is.
    const offline: KlingClient = { model: 'kling-3.0-omni', async createVideoTask() { return { id: 'x' }; }, async getVideoTask() { throw new KlingError('kling_network', 'offline', 0, true); } };
    expect(await pollVideoRender(args, { kling: offline, fetch: doFetch })).toEqual({ status: 'pending' });
    const revoked: KlingClient = { ...offline, async getVideoTask() { throw new KlingError('1002', 'Authorization is invalid', 401, false); } };
    expect(await pollVideoRender(args, { kling: revoked, fetch: doFetch })).toMatchObject({ status: 'failed', failure: { code: 'engine_access' } });
    expect(await pollVideoRender(args, { kling: null, fetch: doFetch })).toMatchObject({ status: 'failed', failure: { code: 'no_engine_key' } });
    expect(await pollVideoRender({ ...args, model: 'seedance-2.0' }, { ark: null, kling, fetch: doFetch })).toMatchObject({ status: 'failed', failure: { code: 'no_engine_key', message: 'ARK_API_KEY is not set' } });
    expect(await pollVideoRender({ ...args, resolution: '480p' }, { kling, fetch: doFetch })).toMatchObject({ status: 'failed' });
  });
});

describe('a Kling template through the render pass (migration 0061)', () => {
  const VIDEO_TEMPLATE = 'neon-alley-dolly';
  const NOW = new Date('2026-10-24T12:00:00.000Z');
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-r2-'));
    store = createLocalRenderStore(root);
  });
  afterEach(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('records provider=kling with the task id, never asks the bank for an asset, and finishes on a later poll', async () => {
    await h.sql.query(`update prompt_items set engine = 'kling-omni' where slug = $1`, [VIDEO_TEMPLATE]);
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const state = { task: task('processing'), calls: [] as CreateKlingTaskInput[] };
    const kling: KlingClient = { model: 'kling-3.0-omni', async createVideoTask(input) { state.calls.push(input); return { id: 'task-9' }; }, async getVideoTask() { return state.task; } };
    const mailer = createFakeMailer();
    const deps: RenderPassDeps = { sql: h.sql, store, now: NOW, mode: 'virtual', engines: { kling, ark: null, fetch: doFetch }, notifier: createEmailRenderNotifier(mailer), siteUrl: 'https://twings.test', siteName: 'TWINGS', assets: null };

    const started = await runRenderPass(deps, { jobId: created.id });
    expect(started).toMatchObject({ claimed: 1, waiting: 1, succeeded: 0, failed: 0 });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.references![0]).toMatchObject({ type: 'image', url: expect.stringMatching(/^data:image\/jpeg;base64,/) });
    let job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'running', provider: 'kling', providerTaskId: 'task-9' });

    state.task = task('succeeded', 'https://cdn.kling/out.mp4', { billedUsd: 0.84 });
    const done = await runRenderPass(deps, { limit: 0 });
    expect(done).toMatchObject({ waiting: 0, succeeded: 1, notified: 1 });
    job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'succeeded', provider: 'kling', resultMime: 'video/mp4', costUsd: 0.84 });
    expect(await store.read(job.resultKey!)).toEqual(VIDEO);
    const { rows } = await h.sql.query<{ cost_source: string | null }>('select cost_source from render_jobs where id = $1', [created.id]);
    expect(rows[0]?.cost_source).toBe('provider_usage');
  });

  it('fails the job as face_policy when Kling refuses the selfie, without a retry', async () => {
    await h.sql.query(`update prompt_items set engine = 'kling-omni' where slug = $1`, [VIDEO_TEMPLATE]);
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const kling: KlingClient = { model: 'kling-3.0-omni', async createVideoTask() { throw new KlingError('1301', 'content security policy: portrait of a real person', 400, false); }, async getVideoTask() { return task('failed'); } };
    const deps: RenderPassDeps = { sql: h.sql, store, now: NOW, mode: 'virtual', engines: { kling, ark: null }, notifier: createEmailRenderNotifier(createFakeMailer()), siteUrl: 'https://twings.test', siteName: 'TWINGS', assets: null };
    expect(await runRenderPass(deps, { jobId: created.id })).toMatchObject({ claimed: 1, failed: 1, requeued: 0 });
    expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'failed', errorCode: 'face_policy' });
  });
});
