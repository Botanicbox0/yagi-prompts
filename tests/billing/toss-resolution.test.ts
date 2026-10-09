import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArkClient } from '@/lib/ark/client';
import { createFakeTossGateway } from '@/lib/billing/toss-fake';
import { confirmTossOrder, createTossOrder } from '@/lib/billing/toss-service';
import { loadRenderJob } from '@/lib/renders/repo';
import { createRenderJob, runRenderPass } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * docs/CREATOR-RESOLUTION.md end to end on the real schema: the buyer names a resolution, the
 * server prices it from the row, the order and the job keep it, and the provider is asked for it.
 */

const gate = vi.hoisted(() => ({ open: true }));
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() {
    return gate.open;
  },
}));

const FILM = 'neon-alley-dolly'; // video · seedance-2.0 · 15s · 1080p $9 / 11,900원 (scripts/prompt-fixtures.ts)
const IMAGE = 'static-portrait-window-light';
const buyer = viewerOf('free');
const PHOTO = { bytes: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg' };
const film = (resolution?: string) => ({ templateSlug: FILM, aspect: '9:16', locale: 'ko', photo: PHOTO, ...(resolution === undefined ? {} : { resolution }) });

describe('creator resolution through checkout, order, job and provider', () => {
  let h: PromptHarness;
  let gateway: ReturnType<typeof createFakeTossGateway>;
  beforeEach(async () => {
    gate.open = true;
    h = await promptHarness();
    gateway = createFakeTossGateway();
    // The fixture's base won price is the suggestion (0); checkout charges only a row's own price.
    await h.sql.query('update prompt_items set price_krw = 5900 where slug = $1', [FILM]);
  });
  afterEach(async () => {
    await h.close();
  });
  const deps = () => ({ sql: h.sql, store: createLocalRenderStore(h.root), gateway, createRender: createRenderJob });
  async function pay(orderId: string, amount: number) {
    gateway.authorize(orderId, amount);
    return confirmTossOrder(deps(), buyer, { orderId, paymentKey: gateway.keyFor(orderId), amount, consent: true });
  }
  const orderRow = async (id: string) =>
    (await h.sql.query<{ amount_krw: number; resolution: string | null; order_name: string }>('select amount_krw,resolution,order_name from billing_payments where id=$1', [id])).rows[0]!;

  it('defaults a film order to 720p at the base price and keeps 720p on the job', async () => {
    const created = await createTossOrder(deps(), buyer, film());
    if (!created.ok) throw new Error(created.code);
    expect(created.order).toMatchObject({ amountKrw: 5900, resolution: '720p' });
    expect(await orderRow(created.order.id)).toMatchObject({ amount_krw: 5900, resolution: '720p', order_name: 'TWINGS · 네온 골목 달리' });
    const result = await pay(created.order.id, 5900);
    if (!result.ok) throw new Error(result.code);
    expect((await loadRenderJob(h.sql, result.id))!.resolution).toBe('720p');
  });

  it('charges the row’s 1080p price for an explicit 1080p choice and carries it onto the job', async () => {
    const created = await createTossOrder(deps(), buyer, film('1080p'));
    if (!created.ok) throw new Error(created.code);
    expect(created.order).toMatchObject({ amountKrw: 11900, resolution: '1080p' });
    expect(await orderRow(created.order.id)).toMatchObject({ amount_krw: 11900, resolution: '1080p', order_name: 'TWINGS · 네온 골목 달리 · 1080p' });
    // The 720p amount on a 1080p order is a forgery, whatever the browser says.
    gateway.authorize(created.order.id, 11900);
    expect(await confirmTossOrder(deps(), buyer, { orderId: created.order.id, paymentKey: gateway.keyFor(created.order.id), amount: 5900, consent: true }))
      .toEqual({ ok: false, code: 'amount_mismatch' });
    const result = await confirmTossOrder(deps(), buyer, { orderId: created.order.id, paymentKey: gateway.keyFor(created.order.id), amount: 11900, consent: true });
    if (!result.ok) throw new Error(result.code);
    expect((await loadRenderJob(h.sql, result.id))!.resolution).toBe('1080p');
  });

  it('refuses a resolution the template does not sell, and never downgrades it silently', async () => {
    for (const bad of ['4k', '480p', 'FULLHD']) {
      expect(await createTossOrder(deps(), buyer, film(bad))).toEqual({ ok: false, code: 'bad_resolution' });
    }
    await h.sql.query('update prompt_items set price_1080_krw = 0 where slug = $1', [FILM]);
    expect(await createTossOrder(deps(), buyer, film('1080p'))).toEqual({ ok: false, code: 'bad_resolution' });
    expect(await createTossOrder(deps(), buyer, { templateSlug: IMAGE, aspect: '4:5', locale: 'ko', photo: PHOTO, resolution: '1080p' }))
      .toEqual({ ok: false, code: 'bad_resolution' });
    const image = await createTossOrder(deps(), buyer, { templateSlug: IMAGE, aspect: '4:5', locale: 'ko', photo: PHOTO });
    if (!image.ok) throw new Error(image.code);
    expect(image.order.resolution).toBeNull();
    expect((await h.sql.query('select * from billing_payments where resolution is not null')).rows).toHaveLength(0);
  });

  it('refuses to approve a 1080p order whose 1080p price changed or disappeared before payment', async () => {
    const created = await createTossOrder(deps(), buyer, film('1080p'));
    if (!created.ok) throw new Error(created.code);
    await h.sql.query('update prompt_items set price_1080_krw = 9900 where slug = $1', [FILM]);
    expect(await pay(created.order.id, 11900)).toEqual({ ok: false, code: 'price_changed' });
    const second = await createTossOrder(deps(), buyer, film('1080p'));
    if (!second.ok) throw new Error(second.code);
    expect(second.order.amountKrw).toBe(9900);
    await h.sql.query('update prompt_items set price_1080_cents = 0 where slug = $1', [FILM]);
    expect(await pay(second.order.id, 9900)).toEqual({ ok: false, code: 'price_changed' });
    // A base-price change leaves an open 1080p order alone: it was never priced from it.
    await h.sql.query('update prompt_items set price_1080_cents = 900 where slug = $1', [FILM]);
    const third = await createTossOrder(deps(), buyer, film('1080p'));
    if (!third.ok) throw new Error(third.code);
    await h.sql.query('update prompt_items set price_krw = 4900 where slug = $1', [FILM]);
    expect(await pay(third.order.id, 9900)).toMatchObject({ ok: true });
    expect(gateway.confirmCalls).toBe(1);
  });

  it('keeps a paid 1080p order at 1080p even if the 1080p price is withdrawn before fulfilment', async () => {
    const created = await createTossOrder(deps(), buyer, film('1080p'));
    if (!created.ok) throw new Error(created.code);
    gateway.authorize(created.order.id, 11900);
    // Paid, then fulfilment deferred (the approval path's own recovery); the price goes away meanwhile.
    await h.sql.query(`update billing_payments set status='paid', payment_key=$2, approved_at=now(), consent_at=now() where id=$1`, [created.order.id, gateway.keyFor(created.order.id)]);
    await h.sql.query('update prompt_items set price_1080_krw = 0, price_1080_cents = 0 where slug = $1', [FILM]);
    const result = await createRenderJob({ sql: h.sql, store: createLocalRenderStore(h.root) }, buyer, { ...film('720p'), paymentOrderId: created.order.id });
    if (!result.ok) throw new Error(result.code);
    // The order decides, not the caller: '720p' in the request is ignored for a paid render.
    expect((await loadRenderJob(h.sql, result.id))!.resolution).toBe('1080p');
  });

  it('confirms a pre-0039 order (no resolution) at the base price and renders it at 720p', async () => {
    const created = await createTossOrder(deps(), buyer, film());
    if (!created.ok) throw new Error(created.code);
    await h.sql.query('update billing_payments set resolution = null where id = $1', [created.order.id]);
    const result = await pay(created.order.id, 5900);
    if (!result.ok) throw new Error(result.code);
    const job = (await loadRenderJob(h.sql, result.id))!;
    expect(job.resolution).toBe('720p');
  });
});

describe('the provider is asked for the job’s resolution, on every attempt', () => {
  let h: PromptHarness;
  beforeEach(async () => {
    h = await promptHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const pass = (ark: ArkClient, jobId: string | null, extra: { fetch?: typeof fetch } = {}) => {
    const store = createLocalRenderStore(h.root);
    return runRenderPass({
      sql: h.sql,
      store: { ...store, url: async () => 'https://store.test/photo.jpg' },
      mode: 'liveness',
      engines: { ark, ...extra },
      notifier: null,
      siteUrl: 'https://twings.test',
      tossGateway: null,
      assets: {
        async createVisualValidateSession() { throw new Error('unused'); },
        async getVisualValidateResult() { return { groupId: 'grp-1' }; },
        async createAsset() { return { id: 'asset-1' }; },
        async getAsset() { return { id: 'asset-1', groupId: 'grp-1', status: 'Active', createdAt: '', lastInferenceAt: null, assetType: 'Image', name: '', url: '', updatedAt: '', projectName: 'default', moderation: { strategy: 'Default' } }; },
        async listAssets() { return []; },
        async listAssetGroups() { return []; },
        async deleteAsset() {},
        async createAssetGroup() { return { id: 'grp-1' }; },
        async deleteAssetGroup() {},
      },
    }, jobId ? { jobId } : { limit: 0 });
  };

  async function enqueue(resolution?: string | null) {
    await h.sql.query(`insert into identity_groups (user_id, status, group_id, verified_at) values ($1, 'active', 'grp-1', now()) on conflict do nothing`, [ADMIN_VIEWER.userId]);
    const created = await createRenderJob({ sql: h.sql, store: createLocalRenderStore(h.root), mode: 'liveness' }, ADMIN_VIEWER, { ...film(), ...(resolution === undefined ? {} : { resolution }) });
    if (!created.ok) throw new Error(created.code);
    return created.id;
  }

  it('asks for 720p by default and books the 720p cost', async () => {
    const calls: Parameters<ArkClient['createVideoTask']>[0][] = [];
    let done = false;
    const ark: ArkClient = {
      async createVideoTask(input) { calls.push(input); return { id: 'cgt-720' }; },
      async getVideoTask() { return { id: 'cgt-720', status: done ? 'succeeded' : 'running', model: null, videoUrl: done ? 'https://ark.test/out.mp4' : null, error: null, completionTokens: null, createdAt: null, updatedAt: null }; },
    };
    const id = await enqueue();
    await pass(ark, id);
    expect(calls[0]).toMatchObject({ model: 'seedance-2.0', resolution: '720p', duration: 15 });
    done = true;
    await pass(ark, null, { fetch: async () => new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } }) });
    // Missing usage counters are estimates: 24fps pixel tokens at the official 720p $7/1M rate.
    expect((await loadRenderJob(h.sql, id))!.costUsd).toBeCloseTo(15 * 720 * 1280 * 24 / 1024 * 7 / 1_000_000, 8);
  });

  it('asks for 1080p when the job was bought at 1080p, again after a retryable failure, and books the 1080p cost', async () => {
    const calls: Parameters<ArkClient['createVideoTask']>[0][] = [];
    let fail = true;
    let done = false;
    const { ArkError } = await import('@/lib/ark/client');
    const ark: ArkClient = {
      async createVideoTask(input) {
        calls.push(input);
        if (fail) throw new ArkError('InternalServiceError', 'busy', 503, true);
        return { id: 'cgt-1080' };
      },
      async getVideoTask() { return { id: 'cgt-1080', status: done ? 'succeeded' : 'running', model: null, videoUrl: done ? 'https://ark.test/out.mp4' : null, error: null, completionTokens: null, createdAt: null, updatedAt: null }; },
    };
    const id = await enqueue('1080p');
    expect(await pass(ark, id)).toMatchObject({ requeued: 1 });
    expect((await loadRenderJob(h.sql, id))!).toMatchObject({ status: 'queued', resolution: '1080p' });
    fail = false;
    await pass(ark, id);
    expect(calls.map((call) => call.resolution)).toEqual(['1080p', '1080p']);
    done = true;
    await pass(ark, null, { fetch: async () => new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } }) });
    expect((await loadRenderJob(h.sql, id))!).toMatchObject({ status: 'succeeded', resolution: '1080p' });
    // A 1080p job uses the official $7.70/1M rate and its own dimensions, including on retry.
    expect((await loadRenderJob(h.sql, id))!.costUsd).toBeCloseTo(15 * 1080 * 1920 * 24 / 1024 * 7.7 / 1_000_000, 8);
  });

  it('refuses an operator render at a resolution the engine cannot do, and any resolution on an image', async () => {
    const store = createLocalRenderStore(h.root);
    expect(await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { ...film(), resolution: '4k' })).toEqual({ ok: false, code: 'bad_resolution' });
    expect(await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: IMAGE, aspect: '4:5', locale: 'ko', photo: PHOTO, resolution: '720p' })).toEqual({ ok: false, code: 'bad_resolution' });
    const image = await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: IMAGE, aspect: '4:5', locale: 'ko', photo: PHOTO });
    if (!image.ok) throw new Error(image.code);
    expect((await loadRenderJob(h.sql, image.id))!.resolution).toBeNull();
  });
});

describe('between merge and the cloud migration', () => {
  it('still serves every template, as 720p only, on a database without the 0039 price columns', async () => {
    const h = await promptHarness();
    try {
      await h.sql.query('alter table prompt_items drop column price_1080_cents, drop column price_1080_krw');
      const { loadPromptBySlug, loadPublishedPrompts } = await import('@/lib/prompts/repo');
      const { offeredResolutions } = await import('@/lib/twings/resolution');
      const row = (await loadPromptBySlug(h.sql, FILM))!;
      expect(row).toMatchObject({ price1080Cents: 0, price1080Krw: 0 });
      expect(offeredResolutions(row)).toEqual(['720p']);
      expect((await loadPublishedPrompts(h.sql)).length).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  });
});
