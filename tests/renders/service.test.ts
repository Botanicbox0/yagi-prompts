import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArkAsset, ArkAssetsClient, ArkAssetStatus } from '@/lib/ark/assets';
import type { ArkClient, ArkTask } from '@/lib/ark/client';
import type { GptImageResult, OpenAiImageClient } from '@/lib/images/openai';
import { OpenAiImageError } from '@/lib/images/openai';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { createEmailRenderNotifier, renderIdempotencyKey, type RenderNotifier } from '@/lib/renders/notify';
import { loadRenderJob } from '@/lib/renders/repo';
import {
  MAX_ATTEMPTS,
  RENDER_JOBS_PER_DAY,
  createRenderJob,
  listMyRenders,
  loadOwnRender,
  loadSharedRender,
  releaseHeldRendersFor,
  runRenderPass,
  type RenderPassDeps,
} from '@/lib/renders/service';
import { SHARE_TTL_DAYS } from '@/lib/renders/share';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import type { RenderEngineDeps } from '@/lib/renders/engines';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * The render queue end to end on a real database and a real (local) store, with the engines
 * and the mailer faked at their seams: enqueue → claim → engine → result → 3-day link → email.
 */

const IMAGE_TEMPLATE = 'static-portrait-window-light'; // image · gpt-image-2 · $2 (scripts/prompt-fixtures.ts)
const VIDEO_TEMPLATE = 'neon-alley-dolly'; // video · seedance-2.0 · $4 (scripts/prompt-fixtures.ts)

const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mime: 'image/jpeg' };
const RESULT_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02, 0x03]);
const VIDEO_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const NOW = new Date('2026-09-06T12:00:00.000Z');
const SITE = 'https://twings.test';

const okImage = (): GptImageResult => ({ b64: Buffer.from(RESULT_BYTES).toString('base64'), outputFormat: 'jpeg', size: '1024x1280', quality: 'high', usage: null, usd: 0.19 });

function fakeOpenAi(impl: () => Promise<GptImageResult>): OpenAiImageClient {
  return { generate: impl, edit: impl } as OpenAiImageClient;
}

/** The bank's asset client, faked at its seam: one asset, whose status the test moves. */
function fakeAssets(state: { status: ArkAssetStatus; created: number }): ArkAssetsClient {
  const asset = (id: string): ArkAsset => ({
    id,
    groupId: 'grp-1',
    status: state.status,
    createdAt: '2026-09-10T00:00:00Z',
    lastInferenceAt: null,
    assetType: 'Image',
    name: '',
    url: 'https://store.test/photo.jpg',
    updatedAt: '2026-09-10T00:00:00Z',
    projectName: 'default',
    moderation: { strategy: 'Default' },
  });
  return {
    async createVisualValidateSession(input) {
      return { bytedToken: 'tok', h5Link: 'https://h5.bank.test/x', callbackUrl: input.callbackUrl };
    },
    async getVisualValidateResult() {
      return { groupId: 'grp-1' };
    },
    async createAsset() {
      state.created += 1;
      return { id: `asset-${state.created}` };
    },
    async getAsset(input) {
      return asset(typeof input === 'string' ? input : input.id);
    },
    async listAssets() {
      return [];
    },
    async listAssetGroups() {
      return [];
    },
    async deleteAsset() {},
    async createAssetGroup() {
      return { id: 'group-aigc-fake' };
    },
    async deleteAssetGroup() {},
  };
}

function task(status: ArkTask['status'], videoUrl: string | null = null): ArkTask {
  return { id: 'cgt-1', status, model: 'dreamina-seedance-2-0-260128', videoUrl, error: null, completionTokens: null, createdAt: null, updatedAt: null };
}

describe('the render queue', () => {
  let h: PromptHarness;
  let store: RenderStore;
  let root: string;
  let mailer: FakeMailer;
  let notifier: RenderNotifier;

  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'playbook-renders-'));
    store = createLocalRenderStore(root);
    mailer = createFakeMailer();
    notifier = createEmailRenderNotifier(mailer);
  });
  afterEach(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  const deps = (engines: RenderEngineDeps, overrides: Partial<RenderPassDeps> = {}): RenderPassDeps => ({
    sql: h.sql,
    store,
    now: NOW,
    mode: 'liveness',
    engines,
    notifier,
    siteUrl: SITE,
    siteName: 'TWINGS',
    ...overrides,
  });

  const enqueue = (slug = IMAGE_TEMPLATE, aspect = '4:5') =>
    createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: slug, aspect, photo: PHOTO, locale: 'ko' });

  it('refuses the anonymous and the not-yet-open reader, checks the input, and queues an admin render', async () => {
    const service = { sql: h.sql, store };
    const input = { templateSlug: IMAGE_TEMPLATE, aspect: '4:5', photo: PHOTO, locale: 'ko' };
    expect(await createRenderJob(service, viewerOf('anon'), input)).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await createRenderJob(service, viewerOf('free'), input)).toEqual({ ok: false, code: 'not_open' });
    expect(await createRenderJob(service, ADMIN_VIEWER, { ...input, templateSlug: 'no-such-template' })).toEqual({ ok: false, code: 'not_found' });
    expect(await createRenderJob(service, ADMIN_VIEWER, { ...input, aspect: '21:9' })).toEqual({ ok: false, code: 'bad_aspect' });
    expect(await createRenderJob(service, ADMIN_VIEWER, { ...input, photo: null })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await createRenderJob(service, ADMIN_VIEWER, { ...input, photo: { bytes: PHOTO.bytes, mime: 'image/heic' } })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await createRenderJob(service, ADMIN_VIEWER, { ...input, photo: { bytes: new Uint8Array(8 * 1024 * 1024 + 1), mime: 'image/jpeg' } })).toEqual({
      ok: false,
      code: 'photo_too_large',
    });

    const outcome = await createRenderJob(service, ADMIN_VIEWER, input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const job = (await loadRenderJob(h.sql, outcome.id))!;
    expect(job).toMatchObject({ status: 'queued', medium: 'image', engine: 'gpt-image-2', aspect: '4:5', locale: 'ko', templateSlug: IMAGE_TEMPLATE, attempts: 0, notifyStatus: 'pending' });
    expect(job.inputKey).toBe(`${outcome.id}/input.jpg`);
    expect(await store.read(job.inputKey!)).toEqual(PHOTO.bytes);
  });

  it('caps a reader at the daily number', async () => {
    for (let i = 0; i < RENDER_JOBS_PER_DAY; i += 1) expect((await enqueue()).ok).toBe(true);
    expect(await enqueue()).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('renders an image through the engine, stores the result, mints the 3-day link and sends the email once', async () => {
    const created = await enqueue();
    if (!created.ok) throw new Error(created.code);
    const openai = fakeOpenAi(async () => okImage());

    const report = await runRenderPass(deps({ openai }), { jobId: created.id });
    expect(report).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, requeued: 0, notified: 1, notifyFailed: 0, errors: [] });

    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job.status).toBe('succeeded');
    expect(job.resultKey).toBe(`${created.id}/result.jpg`);
    expect(job.resultMime).toBe('image/jpeg');
    expect(job.resultBytes).toBe(RESULT_BYTES.byteLength);
    expect(job.provider).toBe('openai');
    expect(job.costUsd).toBe(0.19);
    expect(await store.read(job.resultKey!)).toEqual(RESULT_BYTES);
    expect(job.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(job.finishedAt).toBe(NOW.toISOString());
    expect(Date.parse(job.shareExpiresAt!) - NOW.getTime()).toBe(SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(job.notifyStatus).toBe('sent');

    expect(mailer.sent).toHaveLength(1);
    const email = mailer.sent[0]!;
    expect(email.to).toBe(ADMIN_VIEWER.email);
    expect(email.idempotencyKey).toBe(renderIdempotencyKey(job));
    expect(email.html).toContain(`${SITE}/r/${created.id}/${job.shareToken}`);
    expect(email.html).toContain(`${SITE}/api/renders/media/${created.id}?s=${job.shareToken}`);
    expect(email.html).not.toContain('Static medium close-up'); // the recipe never travels
    expect(email.text).toContain(`/r/${created.id}/${job.shareToken}`);

    // A second pass finds nothing to do and sends nothing again.
    const again = await runRenderPass(deps({ openai }));
    expect(again).toMatchObject({ claimed: 0, succeeded: 0, notified: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.duplicateKeys()).toEqual([]);
  });

  it('leaves the message pending while no channel is configured, then sends it when one is', async () => {
    const created = await enqueue();
    if (!created.ok) throw new Error(created.code);
    const openai = fakeOpenAi(async () => okImage());
    const silent = await runRenderPass(deps({ openai }, { notifier: null }), { jobId: created.id });
    expect(silent).toMatchObject({ succeeded: 1, notified: 0, notifyPending: 1, notifier: 'unconfigured' });
    expect((await loadRenderJob(h.sql, created.id))!.notifyStatus).toBe('pending');

    const later = await runRenderPass(deps({ openai }), { limit: 0 });
    expect(later).toMatchObject({ claimed: 0, notified: 1 });
    expect(mailer.sent).toHaveLength(1);
  });

  it('fails a policy refusal at once, with the reason in the reader’s language and a failure email', async () => {
    const created = await enqueue();
    if (!created.ok) throw new Error(created.code);
    const openai = fakeOpenAi(async () => {
      throw new OpenAiImageError('Your request was rejected by the safety system.', 400, 'moderation_blocked', 'invalid_request_error');
    });
    const report = await runRenderPass(deps({ openai }), { jobId: created.id });
    expect(report).toMatchObject({ claimed: 1, failed: 1, requeued: 0, notified: 1 });
    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('moderated');
    expect(job.shareToken).toBeNull();
    expect(mailer.sent).toHaveLength(1);
    const email = mailer.sent[0]!;
    expect(email.subject).toMatch(/Not finished|완성하지 못했어요/);
    expect(email.html).toContain(`/t/${IMAGE_TEMPLATE}`);
    expect(email.html).not.toContain('/r/');
  });

  it('retries a transient engine failure and gives up after the attempt budget', async () => {
    const created = await enqueue();
    if (!created.ok) throw new Error(created.code);
    const openai = fakeOpenAi(async () => {
      throw new OpenAiImageError('upstream unavailable', 503, null, 'server_error');
    });
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const report = await runRenderPass(deps({ openai }), { jobId: created.id });
      expect(report).toMatchObject({ claimed: 1, requeued: 1, failed: 0 });
      const job = (await loadRenderJob(h.sql, created.id))!;
      expect(job).toMatchObject({ status: 'queued', attempts: attempt, errorCode: 'engine_error', claimedAt: null });
    }
    const last = await runRenderPass(deps({ openai }), { jobId: created.id });
    expect(last).toMatchObject({ claimed: 1, requeued: 0, failed: 1 });
    expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, errorCode: 'engine_error' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('refuses a ModelArk render with a photo until the person has verified their face (docs §8.2)', async () => {
    expect(await enqueue(VIDEO_TEMPLATE, '9:16')).toEqual({ ok: false, code: 'identity_required' });
    await h.sql.query(`insert into identity_groups (user_id, status) values ($1, 'pending')`, [ADMIN_VIEWER.userId]);
    expect(await enqueue(VIDEO_TEMPLATE, '9:16')).toEqual({ ok: false, code: 'identity_required' });
    await h.sql.query(`update identity_groups set status = 'active', group_id = 'grp-1', verified_at = now() where user_id = $1`, [ADMIN_VIEWER.userId]);
    expect((await enqueue(VIDEO_TEMPLATE, '9:16')).ok).toBe(true);
    // The OpenAI image path never asks: the photo itself is what it takes.
    expect((await enqueue()).ok).toBe(true);
  });

  it('holds a film with its photo behind the face check, and releases it the moment the person is verified', async () => {
    const held = await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko', holdForIdentity: true });
    expect(held).toMatchObject({ ok: true, held: true });
    if (!held.ok) return;
    const job = (await loadRenderJob(h.sql, held.id))!;
    expect(job.status).toBe('held');
    expect(await store.read(job.inputKey!)).toEqual(PHOTO.bytes);
    // Nothing to run yet: a pass leaves it where it is.
    expect(await runRenderPass(deps({ ark: null }), { limit: 5 })).toMatchObject({ claimed: 0 });
    expect((await loadRenderJob(h.sql, held.id))!.status).toBe('held');

    // Verified: the callback releases it and the next pass takes it through the asset path.
    await h.sql.query(`insert into identity_groups (user_id, status, group_id, verified_at) values ($1, 'active', 'grp-1', now())`, [ADMIN_VIEWER.userId]);
    expect(await releaseHeldRendersFor(h.sql, ADMIN_VIEWER.userId!)).toEqual([held.id]);
    expect((await loadRenderJob(h.sql, held.id))!.status).toBe('queued');
    const assets = fakeAssets({ status: 'Active', created: 0 });
    const bankStore = { ...store, url: async () => 'https://store.test/photo.jpg' };
    const ark: ArkClient = { async createVideoTask() { return { id: 'cgt-held' }; }, async getVideoTask() { return task('running'); } };
    const report = await runRenderPass(deps({ ark }, { assets, store: bankStore }), { limit: 5 });
    expect(report).toMatchObject({ claimed: 1, waiting: 1, failed: 0 });
    expect((await loadRenderJob(h.sql, held.id))!).toMatchObject({ status: 'running', providerTaskId: 'cgt-held' });
    // A verified person's next render is not held at all.
    expect(await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko', holdForIdentity: true })).toMatchObject({ ok: true, held: false });
  });

  it('in virtual mode a first-time person is never held: the pass makes their AIGC group, then the asset, then the film', async () => {
    // Enqueue in virtual mode: no door, the job is queued at once.
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko', holdForIdentity: true });
    expect(created).toMatchObject({ ok: true, held: false });
    if (!created.ok) return;
    expect((await loadRenderJob(h.sql, created.id))!.status).toBe('queued');

    const groups: string[] = [];
    const base = fakeAssets({ status: 'Active', created: 0 });
    const assets: ArkAssetsClient = { ...base, async createAssetGroup(input) { groups.push(input.groupType ?? '?'); return { id: 'aigc-9' }; } };
    const bankStore = { ...store, url: async () => 'https://store.test/photo.jpg' };
    const calls: Parameters<ArkClient['createVideoTask']>[0][] = [];
    const ark: ArkClient = { async createVideoTask(input) { calls.push(input); return { id: 'cgt-virtual' }; }, async getVideoTask() { return task('running'); } };

    const report = await runRenderPass(deps({ ark }, { assets, store: bankStore, mode: 'virtual' }), { jobId: created.id });
    expect(report).toMatchObject({ claimed: 1, waiting: 1, failed: 0 });
    expect(groups).toEqual(['AIGC']);
    expect((await h.sql.query<{ group_id: string; group_type: string; status: string }>('select group_id, group_type, status from identity_groups where user_id = $1', [ADMIN_VIEWER.userId])).rows[0]).toEqual({ group_id: 'aigc-9', group_type: 'AIGC', status: 'active' });
    // The film references the asset, never the photo bytes.
    const reference = calls[0]!.content.find((item) => item.type === 'image_url');
    expect(reference && 'image_url' in reference ? reference.image_url.url : '').toMatch(/^asset:\/\//);
    expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'running', providerTaskId: 'cgt-virtual' });

    // The second render of the same person makes no second group.
    const second = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko' });
    if (!second.ok) throw new Error(second.code);
    await runRenderPass(deps({ ark }, { assets, store: bankStore, mode: 'virtual' }), { jobId: second.id });
    expect(groups).toEqual(['AIGC']);
  });

  it('parks a film while the bank compares the photo, then references the asset — never the bytes', async () => {
    await h.sql.query(`insert into identity_groups (user_id, status, group_id, verified_at) values ($1, 'active', 'grp-1', now())`, [ADMIN_VIEWER.userId]);
    const created = await enqueue(VIDEO_TEMPLATE, '9:16');
    if (!created.ok) throw new Error(created.code);
    const bank = { status: 'Processing' as ArkAssetStatus, created: 0 };
    const assets = fakeAssets(bank);
    const bankStore = { ...store, url: async () => 'https://store.test/photo.jpg' };
    const calls: Parameters<ArkClient['createVideoTask']>[0][] = [];
    let state: ArkTask = task('queued');
    const ark: ArkClient = {
      async createVideoTask(input) {
        calls.push(input);
        return { id: 'cgt-1' };
      },
      async getVideoTask() {
        return state;
      },
    };
    const doFetch: typeof fetch = async () => new Response(VIDEO_BYTES, { status: 200, headers: { 'content-type': 'video/mp4' } });

    const parked = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { jobId: created.id });
    expect(parked).toMatchObject({ claimed: 1, waiting: 1, succeeded: 0, failed: 0 });
    expect(bank.created).toBe(1);
    expect(calls).toHaveLength(0);
    let job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'running', provider: 'modelark', providerTaskId: 'asset:asset-1' });

    // Still comparing: nothing moves, nothing is re-registered.
    const still = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { limit: 0 });
    expect(still).toMatchObject({ waiting: 1, claimed: 0 });
    expect(bank.created).toBe(1);

    // Active: the film task is created with the asset reference, and the job now waits on the task.
    bank.status = 'Active';
    const started = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { limit: 0 });
    expect(started).toMatchObject({ waiting: 1, succeeded: 0 });
    expect(calls).toHaveLength(1);
    expect((calls[0]!.content[1] as { image_url: { url: string } }).image_url.url).toBe('asset://asset-1');
    expect(JSON.stringify(calls[0])).not.toContain('base64');
    job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'running', providerTaskId: 'cgt-1' });

    state = task('succeeded', 'https://ark.example/out.mp4');
    const done = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { limit: 0 });
    expect(done).toMatchObject({ succeeded: 1, notified: 1 });
    expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'succeeded', resultMime: 'video/mp4' });
    const { rows } = await h.sql.query<{ last_used_at: string | null }>('select last_used_at from identity_assets where asset_id = $1', ['asset-1']);
    expect(rows[0]?.last_used_at).not.toBeNull();
  });

  it('fails a ModelArk render whose photo the bank refuses, with the reason the page can explain', async () => {
    await h.sql.query(`insert into identity_groups (user_id, status, group_id, verified_at) values ($1, 'active', 'grp-1', now())`, [ADMIN_VIEWER.userId]);
    const created = await enqueue(VIDEO_TEMPLATE, '9:16');
    if (!created.ok) throw new Error(created.code);
    const assets = fakeAssets({ status: 'Failed', created: 0 });
    const bankStore = { ...store, url: async () => 'https://store.test/photo.jpg' };
    const report = await runRenderPass(deps({ ark: null }, { assets, store: bankStore }), { jobId: created.id });
    expect(report).toMatchObject({ claimed: 1, failed: 1, waiting: 0 });
    expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'failed', errorCode: 'asset_failed' });
    // No bank client at all is a configuration gap, named as such.
    const again = await enqueue(VIDEO_TEMPLATE, '9:16');
    if (!again.ok) throw new Error(again.code);
    const noBank = await runRenderPass(deps({ ark: null }, { assets: null, store: bankStore }), { jobId: again.id });
    expect(noBank).toMatchObject({ failed: 1 });
    expect((await loadRenderJob(h.sql, again.id))!.errorCode).toBe('identity_unavailable');
  });

  it('hands a film to the provider and finishes it on a later poll, copying the file before the url dies', async () => {
    await h.sql.query(`insert into identity_groups (user_id, status, group_id, verified_at) values ($1, 'active', 'grp-1', now())`, [ADMIN_VIEWER.userId]);
    const created = await enqueue(VIDEO_TEMPLATE, '9:16');
    if (!created.ok) throw new Error(created.code);
    const assets = fakeAssets({ status: 'Active', created: 0 });
    const bankStore = { ...store, url: async () => 'https://store.test/photo.jpg' };
    let state: ArkTask = task('queued');
    const calls: Parameters<ArkClient['createVideoTask']>[0][] = [];
    const ark: ArkClient = {
      async createVideoTask(input) {
        calls.push(input);
        return { id: 'cgt-1' };
      },
      async getVideoTask() {
        return state;
      },
    };
    const doFetch: typeof fetch = async () => new Response(VIDEO_BYTES, { status: 200, headers: { 'content-type': 'video/mp4' } });

    const { rows } = await h.sql.query<{ runtime_seconds: number | null }>('select runtime_seconds from prompt_items where slug = $1', [VIDEO_TEMPLATE]);
    const seconds = Math.min(15, Math.max(4, rows[0]?.runtime_seconds ?? 5));

    const started = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { jobId: created.id });
    expect(started).toMatchObject({ claimed: 1, waiting: 1, succeeded: 0, notified: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'seedance-2.0', ratio: '9:16', duration: seconds, generateAudio: true, watermark: false });
    expect(calls[0]!.content[0]).toMatchObject({ type: 'text' });
    expect(calls[0]!.content[1]).toMatchObject({ type: 'image_url', role: 'reference_image' });
    // The verified library's reference, never the photo's bytes (ModelArk refuses a real face in them).
    expect((calls[0]!.content[1] as { image_url: { url: string } }).image_url.url).toBe('asset://asset-1');
    let job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'running', provider: 'modelark', providerTaskId: 'cgt-1' });

    state = task('running');
    const stillRunning = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { limit: 0 });
    expect(stillRunning).toMatchObject({ claimed: 0, waiting: 1, succeeded: 0 });

    state = task('succeeded', 'https://ark.example/out.mp4');
    const done = await runRenderPass(deps({ ark, fetch: doFetch }, { assets, store: bankStore }), { limit: 0 });
    expect(done).toMatchObject({ waiting: 0, succeeded: 1, notified: 1 });
    job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'succeeded', resultKey: `${created.id}/result.mp4`, resultMime: 'video/mp4', provider: 'modelark' });
    expect(job.costUsd).toBeCloseTo(0.15 * seconds, 2); // $0.15 per second at 720p on Seedance 2.0
    expect(await store.read(job.resultKey!)).toEqual(VIDEO_BYTES);
    expect(mailer.sent).toHaveLength(1);
    // A film has no frame to preview; the email carries the link and nothing else from the gateway.
    expect(mailer.sent[0]!.html).not.toContain('/api/renders/media/');
    expect(mailer.sent[0]!.html).toContain(`/r/${created.id}/${job.shareToken}`);
  });

  it('opens the 3-day link only with its exact token, closes it after three days, and keeps the owner’s page private', async () => {
    const created = await enqueue();
    if (!created.ok) throw new Error(created.code);
    await runRenderPass(deps({ openai: fakeOpenAi(async () => okImage()) }), { jobId: created.id });
    const job = (await loadRenderJob(h.sql, created.id))!;
    const token = job.shareToken!;

    expect((await loadSharedRender(h.sql, created.id, token, NOW)).status).toBe('ok');
    expect((await loadSharedRender(h.sql, created.id, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), NOW)).status).toBe('not_found');
    expect((await loadSharedRender(h.sql, created.id, 'short', NOW)).status).toBe('not_found');
    expect((await loadSharedRender(h.sql, created.id, token, new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000))).status).toBe('expired');

    expect(await loadOwnRender(h.sql, ADMIN_VIEWER, created.id)).toMatchObject({ job: { id: created.id }, templateTitle: 'Static portrait, window light', templateTitleKo: '정적 인물, 창문 광' });
    expect(await loadOwnRender(h.sql, viewerOf('free'), created.id)).toBeNull();
    expect(await loadOwnRender(h.sql, viewerOf('anon'), created.id)).toBeNull();
    expect((await listMyRenders(h.sql, ADMIN_VIEWER.userId!)).map((view) => view.job.id)).toEqual([created.id]);
    expect(await listMyRenders(h.sql, viewerOf('free').userId!)).toEqual([]);
  });

  it('recovers a synchronous render orphaned by a dead process', async () => {
    const created = await enqueue();
    if (!created.ok) throw new Error(created.code);
    await h.sql.query(`update render_jobs set status = 'running', attempts = 1, claimed_at = now() - interval '30 minutes' where id = $1`, [created.id]);
    const report = await runRenderPass(deps({ openai: null }, { now: new Date() }), { limit: 0 });
    expect(report.recovered).toEqual({ requeued: 1, failed: 0 });
    expect((await loadRenderJob(h.sql, created.id))!).toMatchObject({ status: 'queued', claimedAt: null, attempts: 1 });
  });
});
