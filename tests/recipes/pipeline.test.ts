import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArkAsset, ArkAssetsClient } from '@/lib/ark/assets';
import type { ArkClient, ArkTask, CreateVideoTaskInput } from '@/lib/ark/client';
import { OpenAiImageError, type GptImageResult, type OpenAiImageClient } from '@/lib/images/openai';
import { SeedreamError, type SeedreamClient, type SeedreamGenerateInput } from '@/lib/images/seedream';
import { insertPrompt } from '@/lib/prompts/repo';
import { loadRenderJob } from '@/lib/renders/repo';
import { createRecipeSandboxRender, createRenderJob, failureReason, listMyRenders, loadSharedRender, runRenderPass, type RenderPassDeps } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import type { RenderEngineDeps } from '@/lib/renders/engines';
import { listJobOutputs, loadJobRecipe } from '@/lib/recipes/repo';
import { parseRecipe, type Recipe } from '@/lib/recipes/schema';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * Recipe v2 through the real render pass (docs/PLATFORM-2.0.md §7.3) on PGlite, engines faked at their
 * seams — no paid generation: image → film, a carousel, a failing step, a resumed retry, the old
 * single-prompt path untouched, and test renders kept out of email, history and share links.
 */

const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mime: 'image/jpeg' };
const NOW = new Date('2026-10-23T12:00:00.000Z');
const SITE = 'https://twings.test';
const SCENE = `ast_${'d'.repeat(32)}`;
const imageBytes = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xdb, n, n + 1, n + 2]);
const VIDEO = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function fakeOpenAi(log: Array<{ prompt: string; references: number }>, fail?: (call: number) => Error | null): OpenAiImageClient {
  let call = 0;
  const answer = async (input: { prompt: string; references?: unknown[] }): Promise<GptImageResult> => {
    call += 1;
    log.push({ prompt: input.prompt, references: input.references?.length ?? 0 });
    const error = fail?.(call);
    if (error) throw error;
    return { b64: Buffer.from(imageBytes(call)).toString('base64'), outputFormat: 'jpeg', size: '1024x1280', quality: 'high', usage: null, usd: 0.19 };
  };
  return { generate: answer, edit: answer } as unknown as OpenAiImageClient;
}
function fakeAssets(): ArkAssetsClient & { created: number } {
  const state = { created: 0 };
  const asset = (id: string): ArkAsset => ({ id, groupId: 'grp-r', status: 'Active', createdAt: '', lastInferenceAt: null, assetType: 'Image', name: '', url: '', updatedAt: '', projectName: 'default', moderation: { strategy: 'Default' } });
  const client = {
    async createVisualValidateSession() { return { bytedToken: 't', h5Link: 'https://h5', callbackUrl: '' }; },
    async getVisualValidateResult() { return { groupId: 'grp-r' }; },
    async createAsset() { state.created += 1; return { id: `asset-${state.created}` }; },
    async getAsset(input: string | { id: string }) { return asset(typeof input === 'string' ? input : input.id); },
    async listAssets() { return []; }, async listAssetGroups() { return []; }, async deleteAsset() {},
    async createAssetGroup() { return { id: 'aigc-r' }; }, async deleteAssetGroup() {},
  };
  return Object.assign(client, { get created() { return state.created; } }) as unknown as ArkAssetsClient & { created: number };
}
const task = (status: ArkTask['status'], videoUrl: string | null = null): ArkTask => ({ id: 'cgt-r', status, model: 'dreamina-seedance-2-5-260628', videoUrl, error: null, completionTokens: null, createdAt: null, updatedAt: null });

describe('recipe v2 in the render pass', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-recipes-'));
    const local = createLocalRenderStore(root);
    store = { ...local, url: async () => 'https://store.test/object' };
  });
  afterEach(async () => { await h.close(); await rm(root, { recursive: true, force: true }); });

  const deps = (engines: RenderEngineDeps, overrides: Partial<RenderPassDeps> = {}): RenderPassDeps => ({ sql: h.sql, store, now: NOW, mode: 'virtual', engines, notifier: null, siteUrl: SITE, ...overrides });

  async function recipeTemplate(raw: Record<string, unknown>): Promise<{ slug: string; recipe: Recipe }> {
    const checked = parseRecipe(raw);
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    const id = randomUUID(), slug = `recipe-${id.slice(0, 8)}`;
    const primary = checked.recipe.steps[checked.recipe.steps.length - 1]!;
    await insertPrompt(h.sql, { id, slug, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: [primary.engine], title: 'Recipe template', titleKo: null, promptText: 'legacy', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: primary.kind, engine: primary.engine, aspectDefault: primary.params.aspect, runtimeSeconds: primary.kind === 'video' ? primary.params.duration : null, priceCents: 500, priceKrw: 6900 });
    await h.sql.query('update prompt_items set recipe=$2::jsonb where id=$1', [id, JSON.stringify(checked.recipe)]);
    return { slug, recipe: checked.recipe };
  }
  async function makerScene() {
    const formatId = randomUUID();
    await h.sql.query("insert into platform_formats(id,user_id,title,recipe,medium,status) values($1,$2,'Scene owner','', 'video','draft')", [formatId, ADMIN_VIEWER.userId]);
    const key = `${formatId}/${SCENE}.jpg`;
    await store.put(key, imageBytes(90), 'image/jpeg');
    await h.sql.query("insert into platform_format_assets(id,format_id,user_id,role,kind,storage_key,mime,bytes,sha256) values($1,$2,$3,'reference','image',$4,'image/jpeg',7,$5)", [SCENE, formatId, ADMIN_VIEWER.userId, key, 'e'.repeat(64)]);
    return formatId;
  }
  const carousel = (n: number) => ({
    version: 2, slots: { selfie: { kind: 'image', source: 'user', required: true } },
    steps: Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Frame ${i + 1} of {{selfie}} on a street.`, params: { aspect: '4:5' } })),
    output: { frames: Array.from({ length: n }, (_, i) => `f${i + 1}`) },
  });

  it('runs an image step, hands the film to ModelArk with the face as an asset, then books both costs', async () => {
    await makerScene();
    const { slug } = await recipeTemplate({
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true }, scene: { kind: 'image', source: 'creator', asset: SCENE } },
      steps: [
        { id: 'sheet', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'Character sheet of {{selfie}}.', params: { aspect: '16:9' } },
        { id: 'shot1', kind: 'video', engine: 'seedance-2.5', inputs: ['sheet', 'scene'], prompt: 'The person from {{sheet}} walks through {{scene}}.', params: { aspect: '9:16', duration: 10, resolution: '720p' } },
      ],
      output: { from: 'shot1' },
    });
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '9:16', photo: PHOTO, locale: 'ko' });
    expect(created).toMatchObject({ ok: true, held: false });
    if (!created.ok) return;
    const images: Array<{ prompt: string; references: number }> = [];
    const calls: CreateVideoTaskInput[] = [];
    let state: ArkTask = task('running');
    const ark: ArkClient = { async createVideoTask(input) { calls.push(input); return { id: 'cgt-r' }; }, async getVideoTask() { return state; } };
    const assets = fakeAssets();
    const doFetch = (async () => new Response(VIDEO, { headers: { 'content-type': 'video/mp4' } })) as typeof fetch;
    const engines = { openai: fakeOpenAi(images), ark, fetch: doFetch };

    const first = await runRenderPass(deps(engines, { assets }), { jobId: created.id });
    expect(first).toMatchObject({ claimed: 1, waiting: 1, failed: 0 });
    // OpenAI got the bytes (one reference); the film got the sheet as an asset and the maker scene as a URL.
    expect(images).toHaveLength(1);
    expect(images[0]!.references).toBe(1);
    expect(calls).toHaveLength(1);
    const refs = calls[0]!.content.filter((item) => item.type === 'image_url').map((item) => (item as { image_url: { url: string } }).image_url.url);
    expect(refs[0]).toMatch(/^asset:\/\//);
    expect(refs[1]).toBe('https://store.test/object');
    expect(calls[0]!.content[0]).toMatchObject({ type: 'text' });
    expect((calls[0]!.content[0] as { text: string }).text).toContain('The person from Image 1 walks through Image 2.');
    expect(calls[0]!.duration).toBe(10);
    expect((await loadJobRecipe(h.sql, created.id))!.state.steps!.sheet).toMatchObject({ key: `${created.id}/step-sheet.jpg`, usd: 0.19 });
    expect((await loadRenderJob(h.sql, created.id))!.status).toBe('running');

    state = task('succeeded', 'https://cdn.test/film.mp4');
    const second = await runRenderPass(deps(engines, { assets }), { limit: 0 });
    expect(second.succeeded).toBe(1);
    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'succeeded', resultKey: `${created.id}/result.mp4`, resultMime: 'video/mp4' });
    expect(job.costUsd).toBeGreaterThan(0.19);
    expect((await h.sql.query<{ cost_source: string }>('select cost_source from render_jobs where id=$1', [created.id])).rows[0]!.cost_source).toBe('estimate');
    expect((await listJobOutputs(h.sql, created.id)).map((o) => [o.position, o.stepId, o.key])).toEqual([[0, 'shot1', `${created.id}/result.mp4`]]);
  });

  it('renders a carousel: N results, the first is the job result, costs summed', async () => {
    const { slug } = await recipeTemplate(carousel(3));
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const images: Array<{ prompt: string; references: number }> = [];
    const report = await runRenderPass(deps({ openai: fakeOpenAi(images) }), { jobId: created.id });
    expect(report).toMatchObject({ succeeded: 1, failed: 0 });
    expect(images.map((i) => i.prompt.split('\n')[0])).toEqual(['Frame 1 of Image 1 on a street.', 'Frame 2 of Image 1 on a street.', 'Frame 3 of Image 1 on a street.']);
    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job.resultKey).toBe(`${created.id}/result.jpg`);
    expect(job.costUsd).toBeCloseTo(0.57, 4);
    const outputs = await listJobOutputs(h.sql, created.id);
    expect(outputs.map((o) => o.key)).toEqual([`${created.id}/result.jpg`, `${created.id}/result-2.jpg`, `${created.id}/result-3.jpg`]);
    expect(Array.from(await store.read(outputs[2]!.key))).toEqual(Array.from(imageBytes(3)));
  });

  it('sends the selfie itself to Seedream as base64 — no asset group, no asset:// — and keeps every frame', async () => {
    const { slug } = await recipeTemplate({
      ...carousel(3),
      steps: carousel(3).steps.map((step) => ({ ...step, engine: 'seedream-5.0-pro', params: { aspect: '3:4' } })),
    });
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '3:4', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const sent: SeedreamGenerateInput[] = [];
    const seedream = { async generate(input: SeedreamGenerateInput) { sent.push(input); return { model: 'seedream', images: [{ url: null, b64: Buffer.from(imageBytes(sent.length)).toString('base64'), size: '1776x2368', outputFormat: 'jpeg' }], usage: null }; } } as SeedreamClient;
    const assets = fakeAssets();

    expect(await runRenderPass(deps({ seedream }, { assets }), { jobId: created.id })).toMatchObject({ succeeded: 1, failed: 0 });
    expect(sent).toHaveLength(3);
    const selfie = `data:image/jpeg;base64,${Buffer.from(PHOTO.bytes).toString('base64')}`;
    for (const input of sent) expect(input.references).toEqual([selfie]);
    expect(assets.created).toBe(0);
    expect((await h.sql.query('select 1 from identity_groups')).rows).toHaveLength(0);
    expect((await listJobOutputs(h.sql, created.id)).map((o) => o.key)).toEqual([`${created.id}/result.jpg`, `${created.id}/result-2.jpg`, `${created.id}/result-3.jpg`]);
  });

  it('fails a face Seedream refuses as the face policy, on the step it refused', async () => {
    const { slug } = await recipeTemplate({ ...carousel(2), steps: carousel(2).steps.map((step) => ({ ...step, engine: 'seedream-5.0-pro', params: { aspect: '3:4' } })) });
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '3:4', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const seedream = { async generate() { throw new SeedreamError('The request failed because the input image may contain real person.', 400, 'InputImageSensitiveContentDetected.PrivacyInformation', 'req-1'); } } as unknown as SeedreamClient;
    expect(await runRenderPass(deps({ seedream }), { jobId: created.id })).toMatchObject({ succeeded: 0, failed: 1 });
    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'failed', errorCode: 'face_policy:f1' });
    expect(failureReason(job.errorCode, 'ko')).toBe(failureReason('face_policy', 'ko'));
  });

  it('names the failing step in the code, and the reader still gets the plain reason', async () => {
    const { slug } = await recipeTemplate(carousel(2));
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const openai = fakeOpenAi([], (call) => (call === 2 ? new OpenAiImageError('Your request was rejected by the safety system.', 400, 'moderation_blocked', 'invalid_request_error') : null));
    const report = await runRenderPass(deps({ openai }), { jobId: created.id });
    expect(report.failed).toBe(1);
    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job).toMatchObject({ status: 'failed', errorCode: 'moderated:f2' });
    expect(job.errorMessage).toMatch(/^\[f2\]/);
    expect(failureReason(job.errorCode, 'ko')).toBe(failureReason('moderated', 'ko'));
    expect(Object.keys((await loadJobRecipe(h.sql, created.id))!.state.steps ?? {})).toEqual(['f1']);
  });

  it('resumes after the finished steps when a retryable failure requeues the job', async () => {
    const { slug } = await recipeTemplate(carousel(2));
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const log: Array<{ prompt: string; references: number }> = [];
    const openai = fakeOpenAi(log, (call) => (call === 2 ? new OpenAiImageError('upstream unavailable', 503, null, 'server_error') : null));
    expect((await runRenderPass(deps({ openai }), { jobId: created.id })).requeued).toBe(1);
    expect((await loadRenderJob(h.sql, created.id))!.errorCode).toBe('engine_error:f2');
    expect((await runRenderPass(deps({ openai }), { jobId: created.id })).succeeded).toBe(1);
    // f1 once, f2 twice (the refused call and the retry) — the finished step was not paid for again.
    expect(log.map((l) => l.prompt.split('\n')[0]!.slice(0, 7))).toEqual(['Frame 1', 'Frame 2', 'Frame 2']);
  });

  it('leaves a studio original on the single-prompt path, with no recipe rows', async () => {
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: 'static-portrait-window-light', aspect: '4:5', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const log: Array<{ prompt: string; references: number }> = [];
    expect((await runRenderPass(deps({ openai: fakeOpenAi(log) }), { jobId: created.id })).succeeded).toBe(1);
    expect(log).toHaveLength(1);
    expect(await loadJobRecipe(h.sql, created.id)).toBeNull();
    expect(await listJobOutputs(h.sql, created.id)).toEqual([]);
  });

  it('runs a test render through the same pass, but sends no email, lists nowhere and has no share link', async () => {
    const formatId = randomUUID();
    await h.sql.query("insert into platform_formats(id,user_id,title,recipe,medium,status) values($1,$2,'Draft','', 'image','draft')", [formatId, ADMIN_VIEWER.userId]);
    const recipe = (parseRecipe(carousel(1)) as { ok: true; recipe: Recipe }).recipe;
    const created = await createRecipeSandboxRender({ sql: h.sql, store, mode: 'virtual' }, { userId: ADMIN_VIEWER.userId!, locale: 'ko', formatId, purpose: 'maker_test', recipe, photo: PHOTO });
    if (!created.ok) throw new Error(created.code);
    const sent: string[] = [];
    const notifier = { channel: 'email' as const, kind: 'fake', async send(m: { job: { id: string } }) { sent.push(m.job.id); return { ok: true as const }; } };
    expect((await runRenderPass(deps({ openai: fakeOpenAi([]) }, { notifier: notifier as unknown as RenderPassDeps['notifier'] }), { jobId: created.id })).succeeded).toBe(1);
    const job = (await loadRenderJob(h.sql, created.id))!;
    expect(job.status).toBe('succeeded');
    expect(sent).toEqual([]);
    expect(job.notifyStatus).toBe('skipped');
    expect((await listMyRenders(h.sql, ADMIN_VIEWER.userId!)).map((v) => v.job.id)).not.toContain(created.id);
    expect(await loadSharedRender(h.sql, created.id, job.shareToken!)).toEqual({ status: 'not_found' });
  });
});
