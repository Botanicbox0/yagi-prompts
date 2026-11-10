import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArkAsset, ArkAssetsClient } from '@/lib/ark/assets';
import type { ArkClient, ArkTask, CreateVideoTaskInput } from '@/lib/ark/client';
import { OpenAiImageError, type GptImageResult, type OpenAiImageClient } from '@/lib/images/openai';
import { insertPrompt } from '@/lib/prompts/repo';
import type { TemplateCast } from '@/lib/prompts/schemas';
import { loadRenderJob } from '@/lib/renders/repo';
import { createRenderJob, runRenderPass, type RenderPassDeps } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import type { RenderEngineDeps } from '@/lib/renders/engines';
import { deleteSpentSlotPhotos, storeSlotPhotos, UNCLAIMED_SLOT_HOURS } from '@/lib/renders/cast-inputs';
import { parseRecipe } from '@/lib/recipes/schema';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * docs/CAST-CATEGORIES.md §3·§4 through the real render pass on PGlite, engines faked at their seams
 * (no paid generation):
 *   · a pet photo is never face-checked and never registered as a face asset — but the provider's own
 *     moderation still decides what it accepts;
 *   · a pet-only template needs no selfie; a person + pet template needs both photos;
 *   · couples do not exist while TWINGS_COUPLE_TEMPLATES is off; with it on, the partner photo needs
 *     the uploader's confirmation, never joins the identity group, and is deleted after the render.
 */

const NOW = new Date('2026-11-11T12:00:00.000Z');
const SITE = 'https://twings.test';
let PET: { bytes: Uint8Array; mime: string };
let FACE: { bytes: Uint8Array; mime: string };
let PARTNER: { bytes: Uint8Array; mime: string };
const VIDEO = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

async function jpeg(r: number, g: number, b: number) {
  const data = await sharp({ create: { width: 400, height: 500, channels: 3, background: { r, g, b } } }).jpeg().withMetadata({ exif: { IFD0: { Make: 'PhoneCo' } } }).toBuffer();
  return { bytes: new Uint8Array(data), mime: 'image/jpeg' };
}

function fakeOpenAi(log: Array<{ prompt: string; references: number }>, fail?: () => Error | null): OpenAiImageClient {
  const answer = async (input: { prompt: string; references?: unknown[] }): Promise<GptImageResult> => {
    log.push({ prompt: input.prompt, references: input.references?.length ?? 0 });
    const error = fail?.();
    if (error) throw error;
    return { b64: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]).toString('base64'), outputFormat: 'jpeg', size: '1024x1280', quality: 'high', usage: null, usd: 0.19 };
  };
  return { generate: answer, edit: answer } as unknown as OpenAiImageClient;
}
function fakeAssets(): ArkAssetsClient & { created: number; groups: number } {
  const state = { created: 0, groups: 0 };
  const asset = (id: string): ArkAsset => ({ id, groupId: 'grp-c', status: 'Active', createdAt: '', lastInferenceAt: null, assetType: 'Image', name: '', url: '', updatedAt: '', projectName: 'default', moderation: { strategy: 'Default' } });
  const client = {
    async createVisualValidateSession() { return { bytedToken: 't', h5Link: 'https://h5', callbackUrl: '' }; },
    async getVisualValidateResult() { return { groupId: 'grp-c' }; },
    async createAsset() { state.created += 1; return { id: `asset-${state.created}` }; },
    async getAsset(input: string | { id: string }) { return asset(typeof input === 'string' ? input : input.id); },
    async listAssets() { return []; }, async listAssetGroups() { return []; }, async deleteAsset() {},
    async createAssetGroup() { state.groups += 1; return { id: 'aigc-c' }; }, async deleteAssetGroup() {},
  };
  return Object.assign(client, { get created() { return state.created; }, get groups() { return state.groups; } }) as unknown as ArkAssetsClient & { created: number; groups: number };
}
const task = (status: ArkTask['status'], videoUrl: string | null = null): ArkTask => ({ id: 'cgt-c', status, model: 'dreamina-seedance-2-5-260628', videoUrl, error: null, completionTokens: null, createdAt: null, updatedAt: null });

const selfie = { kind: 'image', source: 'user', required: true } as const;
const pet = { kind: 'image', source: 'user', required: true, role: 'pet' } as const;
const partner = { kind: 'image', source: 'user', required: true, role: 'partner' } as const;
const image = (inputs: string[], prompt: string) => ({ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs, prompt, params: { aspect: '4:5' } });

describe('pet and couple renders', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    PET ??= await jpeg(200, 160, 120);
    FACE ??= await jpeg(230, 200, 180);
    PARTNER ??= await jpeg(120, 140, 200);
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-cast-'));
    const local = createLocalRenderStore(root);
    store = { ...local, url: async () => 'https://store.test/object' };
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  const deps = (engines: RenderEngineDeps, overrides: Partial<RenderPassDeps> = {}): RenderPassDeps => ({ sql: h.sql, store, now: NOW, mode: 'virtual', engines, notifier: null, siteUrl: SITE, ...overrides });
  const exists = async (key: string) => store.read(key).then(() => true, () => false);

  async function template(cast: TemplateCast, raw: Record<string, unknown> | null, medium: 'image' | 'video' = 'image'): Promise<string> {
    const id = randomUUID(), slug = `cast-${id.slice(0, 8)}`;
    await insertPrompt(h.sql, { id, slug, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: ['gpt-image-2'], title: 'Cast template', titleKo: null, promptText: 'legacy prompt text', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium, engine: medium === 'image' ? 'gpt-image-2' : 'seedance-2.5', aspectDefault: medium === 'image' ? '4:5' : '9:16', runtimeSeconds: medium === 'video' ? 10 : null, priceCents: 500, priceKrw: 6900, cast });
    if (raw) {
      const checked = parseRecipe(raw);
      if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
      await h.sql.query('update prompt_items set recipe=$2::jsonb where id=$1', [id, JSON.stringify(checked.recipe)]);
    }
    return slug;
  }
  const petOnly = { version: 2, slots: { pet }, steps: [image(['pet'], 'A studio portrait of {{pet}} on a powder-blue backdrop.')], output: { from: 'still' } };
  const personAndPet = { version: 2, slots: { selfie, pet }, steps: [image(['selfie', 'pet'], '{{selfie}} walks {{pet}} through a quiet park.')], output: { from: 'still' } };
  const couple = { version: 2, slots: { selfie, partner }, steps: [image(['selfie', 'partner'], '{{selfie}} and {{partner}} share an umbrella on a rainy street.')], output: { from: 'still' } };

  describe('pets', () => {
    it('a pet-only template takes the pet as its one photo: no selfie, no face check, no face asset', async () => {
      const slug = await template('pet', petOnly);
      // Liveness mode with nobody verified: a person template would be held. A pet is not.
      const created = await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PET, locale: 'ko' });
      expect(created).toMatchObject({ ok: true, held: false });
      if (!created.ok) return;
      const log: Array<{ prompt: string; references: number }> = [];
      const assets = fakeAssets();
      const report = await runRenderPass(deps({ openai: fakeOpenAi(log) }, { assets, mode: 'liveness' }), { jobId: created.id });
      expect(report.succeeded).toBe(1);
      expect(assets.created).toBe(0);
      expect(assets.groups).toBe(0);
      expect(log[0]!.prompt).toContain('Image 1 shows the pet to feature.');
      expect(log[0]!.prompt).not.toMatch(/person/);
    });

    it('…its photo is stripped of metadata and deleted once the render is finished', async () => {
      const slug = await template('pet', petOnly);
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PET, locale: 'ko' });
      if (!created.ok) throw new Error(created.code);
      const job = (await loadRenderJob(h.sql, created.id))!;
      const stored = await store.read(job.inputKey!);
      expect((await sharp(stored).metadata()).exif).toBeUndefined();
      await runRenderPass(deps({ openai: fakeOpenAi([]) }), { jobId: created.id });
      expect(await exists(job.inputKey!)).toBe(false);
      const rows = await h.sql.query<{ deleted_at: Date | null }>('select deleted_at from render_slot_inputs where render_id=$1', [created.id]);
      expect(rows.rows[0]!.deleted_at).not.toBeNull();
    });

    it('a pet photo still goes through the provider’s moderation: a refusal fails the job', async () => {
      const slug = await template('pet', petOnly);
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PET, locale: 'ko' });
      if (!created.ok) throw new Error(created.code);
      const openai = fakeOpenAi([], () => new OpenAiImageError('Your request was rejected by the safety system.', 400, 'moderation_blocked', 'invalid_request_error'));
      const report = await runRenderPass(deps({ openai }), { jobId: created.id });
      expect(report.failed).toBe(1);
      expect((await loadRenderJob(h.sql, created.id))!.errorCode).toBe('moderated:still');
    });

    it('a pet film sends the pet to the video engine as a plain reference, never as a face asset', async () => {
      const slug = await template('pet', { version: 2, slots: { pet }, steps: [{ id: 'run', kind: 'video', engine: 'seedance-2.5', inputs: ['pet'], prompt: 'The dog from {{pet}} runs along a beach at dawn.', params: { aspect: '9:16', duration: 10, resolution: '720p' } }], output: { from: 'run' } }, 'video');
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '9:16', photo: PET, locale: 'ko' });
      if (!created.ok) throw new Error(created.code);
      const calls: CreateVideoTaskInput[] = [];
      let state = task('running');
      const ark: ArkClient = { async createVideoTask(input) { calls.push(input); return { id: 'cgt-c' }; }, async getVideoTask() { return state; } };
      const assets = fakeAssets();
      const doFetch = (async () => new Response(VIDEO, { headers: { 'content-type': 'video/mp4' } })) as typeof fetch;
      await runRenderPass(deps({ ark, fetch: doFetch }, { assets }), { jobId: created.id });
      const refs = calls[0]!.content.filter((item) => item.type === 'image_url').map((item) => (item as { image_url: { url: string } }).image_url.url);
      expect(refs).toEqual(['https://store.test/object']);
      expect(assets.created).toBe(0);
      state = task('succeeded', 'https://cdn.test/film.mp4');
      expect((await runRenderPass(deps({ ark, fetch: doFetch }, { assets }), { limit: 0 })).succeeded).toBe(1);
    });

    it('a person + pet template needs both photos, and only the selfie is the face', async () => {
      const slug = await template('pet', personAndPet);
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko' })).toEqual({ ok: false, code: 'slot_missing' });
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko', slots: { pet: PET } });
      if (!created.ok) throw new Error(created.code);
      const log: Array<{ prompt: string; references: number }> = [];
      await runRenderPass(deps({ openai: fakeOpenAi(log) }), { jobId: created.id });
      expect(log[0]!.references).toBe(2);
      expect(log[0]!.prompt).toContain('Image 1 shows the person to feature.');
      expect(log[0]!.prompt).toContain('Image 2 shows the pet to feature.');
      // The pet photo is gone; the buyer's own photo keeps its existing rules.
      expect(await exists(`${created.id}/slot-pet.jpg`)).toBe(false);
      expect(await exists((await loadRenderJob(h.sql, created.id))!.inputKey!)).toBe(true);
    });

    it('a pet-only job never carries a saved selfie', async () => {
      const slug = await template('pet', petOnly);
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, selfieId: randomUUID(), locale: 'ko' })).toEqual({ ok: false, code: 'bad_photo' });
    });

    it('a pet template without a matching recipe cannot be made', async () => {
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: await template('pet', null), aspect: '4:5', photo: PET, locale: 'ko' })).toEqual({ ok: false, code: 'not_for_sale' });
      // A solo-marked template whose recipe takes a pet is an authoring mistake, not a guess.
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: await template('solo', petOnly), aspect: '4:5', photo: PET, locale: 'ko' })).toEqual({ ok: false, code: 'not_for_sale' });
    });
  });

  describe('couples', () => {
    it('with the flag off a couple template does not exist, partner photo or not', async () => {
      vi.stubEnv('TWINGS_COUPLE_TEMPLATES', '');
      const slug = await template('couple', couple);
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko', slots: { partner: PARTNER }, partnerConsent: true })).toEqual({ ok: false, code: 'not_found' });
    });

    it('with the flag on: the partner needs the uploader’s confirmation', async () => {
      vi.stubEnv('TWINGS_COUPLE_TEMPLATES', 'on');
      const slug = await template('couple', couple);
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko' })).toEqual({ ok: false, code: 'slot_missing' });
      expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko', slots: { partner: PARTNER } })).toEqual({ ok: false, code: 'partner_consent_required' });
    });

    it('…the partner never joins the identity group, and the photo is deleted after the render', async () => {
      vi.stubEnv('TWINGS_COUPLE_TEMPLATES', 'on');
      const slug = await template('couple', couple);
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko', slots: { partner: PARTNER }, partnerConsent: true });
      if (!created.ok) throw new Error(created.code);
      const consent = await h.sql.query<{ partner_consent_at: Date | null }>("select partner_consent_at from render_slot_inputs where render_id=$1 and slot='partner'", [created.id]);
      expect(consent.rows[0]!.partner_consent_at).not.toBeNull();
      expect(await exists(`${created.id}/slot-partner.jpg`)).toBe(true);
      const log: Array<{ prompt: string; references: number }> = [];
      const assets = fakeAssets();
      expect((await runRenderPass(deps({ openai: fakeOpenAi(log) }, { assets }), { jobId: created.id })).succeeded).toBe(1);
      expect(assets.created).toBe(0);
      expect(log[0]!.prompt).toContain('show the two people to feature');
      expect(await exists(`${created.id}/slot-partner.jpg`)).toBe(false);
    });

    it('…and a failed render deletes it too', async () => {
      vi.stubEnv('TWINGS_COUPLE_TEMPLATES', 'on');
      const slug = await template('couple', couple);
      const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: FACE, locale: 'ko', slots: { partner: PARTNER }, partnerConsent: true });
      if (!created.ok) throw new Error(created.code);
      const openai = fakeOpenAi([], () => new OpenAiImageError('Your request was rejected by the safety system.', 400, 'moderation_blocked', 'invalid_request_error'));
      await runRenderPass(deps({ openai }), { jobId: created.id });
      expect(await exists(`${created.id}/slot-partner.jpg`)).toBe(false);
    });
  });

  it('photos bound to an order that never became a job are deleted after the unclaimed window', async () => {
    const slug = await template('pet', personAndPet);
    const { rows } = await h.sql.query<{ id: string }>('select id from prompt_items where slug=$1', [slug]);
    const renderRef = randomUUID();
    await storeSlotPhotos(h.sql, store, { renderId: renderRef, userId: ADMIN_VIEWER.userId!, templateId: rows[0]!.id, photos: { pet: PET }, partnerConsentAt: null, now: NOW });
    expect(await deleteSpentSlotPhotos(h.sql, store, new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(await deleteSpentSlotPhotos(h.sql, store, new Date(NOW.getTime() + (UNCLAIMED_SLOT_HOURS + 1) * 3_600_000))).toBe(1);
    expect(await exists(`${renderRef}/slot-pet.jpg`)).toBe(false);
  });
});
