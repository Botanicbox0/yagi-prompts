import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubscriptionRenderJob, runRenderPass } from '@/lib/renders/service';
import { loadRenderJob } from '@/lib/renders/repo';
import { loadOwnEditSummary, loadSubscriptionRender, deleteExpiredEditReferences, subscriptionRenderSchemaReady } from '@/lib/premium-editing/repo';
import type { ArkClient, ArkContentItem } from '@/lib/ark/client';
import type { ArkAssetsClient } from '@/lib/ark/assets';
import { prepareSubscriptionPrompt } from '@/lib/premium-editing/service';
import { PremiumEditFailure } from '@/lib/premium-editing/provider';
import { getPremiumEditBudget } from '@/lib/premium-editing/budget';
import type { RenderStore } from '@/lib/renders/store';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { viewerOf } from '@/tests/helpers/admin';

const NOW = new Date('2026-10-09T12:00:00Z');
const viewer = viewerOf('free');
const ownPhoto = { bytes: new Uint8Array([255,216,255,1,2]), mime: 'image/jpeg' };
const request = () => ({ requestId: randomUUID(), templateSlug: 'neon-alley-dolly', ownFaceConsent: true, photo: ownPhoto, locale: 'ko' });

describe('subscription render authorization and private preparation', () => {
  let h: PromptHarness;
  let store: RenderStore;
  let objects: Map<string, Uint8Array>;
  beforeEach(async () => {
    vi.stubEnv('PREMIUM_EDIT_REQUESTS_PER_PERIOD', '30');
    h = await promptHarness();
    objects = new Map();
    store = { name: 'local', async put(key, bytes) { objects.set(key, bytes); }, async read(key) { const bytes = objects.get(key); if (!bytes) throw Error('missing'); return bytes; }, async url() { return null; }, async delete(key) { objects.delete(key); } };
    await h.db.exec('create role service_role nologin bypassrls; create role anon nologin; create role authenticated nologin; grant select,insert,update,delete on creator_subscription_renders to service_role;');
    await h.sql.query("update prompt_items set engine='seedance-2.5',runtime_seconds=10,aspect_default='9:16' where slug='neon-alley-dolly'");
    await h.sql.query("insert into identity_groups(user_id,status,group_id,verified_at) values($1,'active','own-face-group',$2)", [viewer.userId, NOW]);
  });
  afterEach(async () => { await h.close(); vi.unstubAllEnvs(); });
  const deps = () => ({ sql: h.sql, store, environment: 'test' as const, now: NOW, mode: 'liveness' as const });
  async function paid(plan = 'premium', units = 1200, premiumEditLimit = 30) {
    const sid = randomUUID(), pid = randomUUID();
    await h.sql.query(`insert into creator_subscriptions(id,user_id,environment,plan_id,plan_version,amount_krw,monthly_units,consent_version,consent_at,locale,customer_key,status,current_period_index,expires_at,premium_edit_limit)
      values($1,$2,'test',$3,'v1',49000,$4,'v1',$5,'ko',$6,'active',0,$7,$8)`, [sid, viewer.userId, plan, units, NOW, randomUUID(), new Date('2026-11-09T12:00:00Z'), plan === 'premium' ? premiumEditLimit : null]);
    await h.sql.query(`insert into creator_subscription_periods(id,subscription_id,period_index,environment,starts_at,ends_at,amount_krw,monthly_units,status,paid_at)
      values($1,$2,0,'test',$3,$4,49000,$5,'paid',$3)`, [pid, sid, NOW, new Date('2026-11-09T12:00:00Z'), units]);
    return { sid, pid };
  }

  it('requires own-face consent, a matching paid environment and Premium for edits', async () => {
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), ownFaceConsent: false })).toMatchObject({ ok: false, code: 'consent_required' });
    expect(await createSubscriptionRenderJob(deps(), viewer, request())).toMatchObject({ ok: false, code: 'subscription_required' });
    await paid('creator');
    expect(await createSubscriptionRenderJob({ ...deps(), environment: 'live' }, viewer, request())).toMatchObject({ ok: false, code: 'subscription_required' });
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), editText: '셔츠를 파란색으로' })).toMatchObject({ ok: false, code: 'premium_required' });
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), portraitId: randomUUID() })).toMatchObject({ ok: false, code: 'identity_required' });
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), photo: null })).toMatchObject({ ok: false, code: 'bad_photo' });
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), templateSlug: 'static-portrait-window-light' })).toMatchObject({ ok: false, code: 'unsupported_template' });
    expect((await h.sql.query('select * from creator_subscription_usage')).rows).toHaveLength(0);
  });

  it('reserves the server quote once, rejects changed replay and immutable-field overrides', async () => {
    expect(await subscriptionRenderSchemaReady(h.sql)).toBe(true);
    await h.db.exec('revoke update on creator_subscription_renders from service_role');
    expect(await subscriptionRenderSchemaReady(h.sql)).toBe(false);
    await h.db.exec('grant update on creator_subscription_renders to service_role; grant select on creator_subscription_renders to anon');
    expect(await subscriptionRenderSchemaReady(h.sql)).toBe(false);
    await h.db.exec('revoke select on creator_subscription_renders from anon; grant select(base_prompt) on creator_subscription_renders to anon');
    expect(await subscriptionRenderSchemaReady(h.sql)).toBe(false);
    await h.db.exec('revoke select(base_prompt) on creator_subscription_renders from anon; create policy unsafe_edit_read on creator_subscription_renders for select to anon using (true)');
    expect(await subscriptionRenderSchemaReady(h.sql)).toBe(false);
    await h.db.exec('drop policy unsafe_edit_read on creator_subscription_renders; alter table creator_subscription_renders disable row level security');
    expect(await subscriptionRenderSchemaReady(h.sql)).toBe(false);
    await h.db.exec('alter table creator_subscription_renders enable row level security');
    const { pid } = await paid();
    const input = request();
    const created = await createSubscriptionRenderJob(deps(), viewer, input);
    expect(created.ok).toBe(true); if (!created.ok) return;
    expect(await createSubscriptionRenderJob(deps(), viewer, input)).toEqual(created);
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...input, editText: '셔츠를 파란색으로' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), prompt: 'swap face' } as never)).toMatchObject({ ok: false, code: 'bad_request' });
    const job = await loadRenderJob(h.sql, created.id);
    expect(job).toMatchObject({ userId: viewer.userId, engine: 'seedance-2.5', aspect: '9:16', resolution: '720p' });
    expect((await h.sql.query('select reserved_units from creator_subscription_periods where id=$1', [pid])).rows[0]).toEqual({ reserved_units: 100 });
    expect((await h.sql.query('select * from creator_subscription_usage')).rows).toHaveLength(1);
  });

  it('caches one bounded model plan and never sends the recipe or own face to the edit client', async () => {
    await paid();
    vi.stubEnv('PREMIUM_EDIT_REQUESTS_PER_PERIOD', undefined);
    const image = new Uint8Array(await sharp({ create: { width: 48, height: 48, channels: 3, background: 'blue' } }).png().toBuffer());
    const created = await createSubscriptionRenderJob(deps(), viewer, { ...request(), editText: '셔츠를 파란색으로', references: [{ bytes: image, mime: 'image/png' }], referencesConsent: true });
    expect(created.ok).toBe(true); if (!created.ok) return;
    const row = (await loadSubscriptionRender(h.sql, created.id))!;
    const prepare = vi.fn(async (_input: import('@/lib/premium-editing/provider').PrepareEditInput) => ({ plan: { approved: true, refusal: 'none' as const, changes: [{ scope: 'wardrobe_color' as const, value: 'blue' as const }] }, model: 'gpt-5.6-sol', usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20 } }));
    const first = await prepareSubscriptionPrompt(h.sql, store, row, NOW, { prepare });
    const cached = (await loadSubscriptionRender(h.sql, created.id))!;
    expect(await prepareSubscriptionPrompt(h.sql, store, cached, NOW, { prepare })).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0]).not.toHaveProperty('basePrompt');
    expect(JSON.stringify(prepare.mock.calls[0])).not.toContain(row.base_prompt);
    expect(await loadOwnEditSummary(h.sql, viewer.userId!, created.id, 'test')).toEqual({ status: 'prepared', changes: [{ scope: 'wardrobe_color', value: 'blue' }], errorCode: null });
    expect(await loadOwnEditSummary(h.sql, viewerOf('pro').userId!, created.id, 'test')).toBeNull();
    expect(await loadOwnEditSummary(h.sql, viewer.userId!, created.id, 'live')).toBeNull();
    expect((await h.sql.query('select input_tokens,output_tokens from creator_subscription_renders where render_ref=$1', [created.id])).rows[0]).toEqual({ input_tokens: 50, output_tokens: 20 });
    await h.sql.query("insert into identity_assets(user_id,group_id,asset_id,photo_sha256,status) values($1,'own-face-group','own-face-asset',$2,'Active')", [viewer.userId, createHash('sha256').update(ownPhoto.bytes).digest('hex')]);
    const submitted: ArkContentItem[][] = [];
    const ark = {
      async createVideoTask(input: { content: ArkContentItem[] }) { submitted.push(input.content); return { id: 'video-task' }; },
      async getVideoTask() { return { id: 'video-task', model: 'dreamina-seedance-2-5-260628', status: 'succeeded', videoUrl: 'https://provider.test/output.mp4', completionTokens: 123456, error: null, createdAt: null, updatedAt: null }; },
    } as unknown as ArkClient;
    const passDeps = { ...deps(), notifier: null, siteUrl: 'https://twings.test', tossGateway: null, releaseAfterUse: false, assets: {} as ArkAssetsClient, premiumEditor: { prepare }, engines: { ark, fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }) } };
    await h.db.exec('revoke update on creator_subscription_renders from service_role');
    expect((await runRenderPass(passDeps, { jobId: created.id })).waiting).toBeGreaterThan(0);
    expect(submitted).toHaveLength(0);
    await h.db.exec('grant update on creator_subscription_renders to service_role');
    const recoveredDeps = { ...passDeps, now: new Date(NOW.getTime() + 21 * 60 * 1000) };
    await runRenderPass(recoveredDeps, { jobId: created.id });
    await runRenderPass(recoveredDeps, { limit: 0 });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.filter(item => item.type === 'image_url')).toEqual([{ type: 'image_url', image_url: { url: 'asset://own-face-asset' }, role: 'reference_image' }]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect((await h.sql.query('select provider_completion_tokens,cost_source,cost_usd from render_jobs where id=$1', [created.id])).rows[0]).toEqual({ provider_completion_tokens: 123456, cost_source: 'provider_usage', cost_usd: '1.3210' });
    expect((await h.sql.query('select state from creator_subscription_usage where render_ref=$1', [created.id])).rows[0]).toEqual({ state: 'consumed' });
  });

  it('restores failed render allowance once while counting every dispatched edit against the paid promise', async () => {
    const { pid } = await paid('premium', 1200, 1);
    vi.stubEnv('PREMIUM_EDIT_REQUESTS_PER_PERIOD', '1000');
    const created = await createSubscriptionRenderJob(deps(), viewer, { ...request(), editText: '셔츠를 파란색으로' });
    expect(created.ok).toBe(true); if (!created.ok) return;
    const competing = await createSubscriptionRenderJob(deps(), viewer, { ...request(), editText: '셔츠를 파란색으로' });
    expect(competing.ok).toBe(true); if (!competing.ok) return;
    const row = (await loadSubscriptionRender(h.sql, created.id))!;
    const competingRow = (await loadSubscriptionRender(h.sql, competing.id))!;
    const prepare = vi.fn(async () => { throw new PremiumEditFailure('edit_refused'); });
    const results = await Promise.allSettled([prepareSubscriptionPrompt(h.sql, store, row, NOW, { prepare }), prepareSubscriptionPrompt(h.sql, store, competingRow, NOW, { prepare })]);
    expect(results.map(result => result.status === 'rejected' ? (result.reason as { code: string }).code : 'fulfilled').sort()).toEqual(['edit_refused', 'edit_request_limit']);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await getPremiumEditBudget(h.sql, viewer.userId!, { environment: 'test', now: NOW })).toEqual({ limit: 1, attempted: 1, remaining: 0 });
    expect(await getPremiumEditBudget(h.sql, viewer.userId!, { environment: 'live', now: NOW })).toBeNull();
    expect(await getPremiumEditBudget(h.sql, viewerOf('pro').userId!, { environment: 'test', now: NOW })).toBeNull();
    await h.sql.query("update render_jobs set status='failed',error_code='edit_refused',finished_at=$2 where id=$1", [created.id, NOW]);
    await h.sql.query("update render_jobs set status='failed',error_code='edit_request_limit',finished_at=$2 where id=$1", [competing.id, NOW]);
    const passDeps = { ...deps(), notifier: null, siteUrl: 'https://twings.test', tossGateway: null, releaseAfterUse: false };
    await runRenderPass(passDeps, { limit: 0 });
    await runRenderPass(passDeps, { limit: 0 });
    expect((await h.sql.query('select reserved_units,consumed_units from creator_subscription_periods where id=$1', [pid])).rows[0]).toEqual({ reserved_units: 0, consumed_units: 0 });
    expect((await h.sql.query('select state from creator_subscription_usage where render_ref=$1', [created.id])).rows[0]).toEqual({ state: 'released' });
    expect(await createSubscriptionRenderJob(deps(), viewer, { ...request(), editText: '셔츠를 파란색으로' })).toEqual({ ok: false, code: 'edit_request_limit' });
    expect((await h.sql.query('select count(*)::int as count from creator_subscription_usage')).rows[0]).toEqual({ count: 2 });
    expect(await getPremiumEditBudget(h.sql, viewer.userId!, { environment: 'test', now: NOW })).toEqual({ limit: 1, attempted: 1, remaining: 0 });
  });

  it('counts an unknown dispatched edit, releases its stale render once and deletes only expired private references', async () => {
    const { pid } = await paid('premium', 1200, 1);
    const stalled = await createSubscriptionRenderJob(deps(), viewer, { ...request(), editText: '셔츠를 파란색으로' });
    expect(stalled.ok).toBe(true);
    if (!stalled.ok) return;
    await h.sql.query("update creator_subscription_renders set edit_status='preparing',prepare_started_at=$2,edit_request_started_at=$2 where render_ref=$1", [stalled.id, NOW]);
    await h.sql.query("update render_jobs set status='running',attempts=1,provider_task_id='asset:pending' where id=$1", [stalled.id]);
    const passDeps = { ...deps(), notifier: null, siteUrl: 'https://twings.test', tossGateway: null, releaseAfterUse: false };
    await runRenderPass({ ...passDeps, now: new Date(NOW.getTime() + 21 * 60 * 1000) }, { limit: 0 });
    await runRenderPass({ ...passDeps, now: new Date(NOW.getTime() + 21 * 60 * 1000) }, { limit: 0 });
    expect((await loadRenderJob(h.sql, stalled.id))?.status).toBe('failed');
    expect((await h.sql.query('select state from creator_subscription_usage where render_ref=$1', [stalled.id])).rows[0]).toEqual({ state: 'released' });
    expect((await h.sql.query('select reserved_units,consumed_units from creator_subscription_periods where id=$1', [pid])).rows[0]).toEqual({ reserved_units: 0, consumed_units: 0 });
    expect(await getPremiumEditBudget(h.sql, viewer.userId!, { environment: 'test', now: NOW })).toEqual({ limit: 1, attempted: 1, remaining: 0 });
    const ref = `${stalled.id}/referencea.jpg`; objects.set(ref, new Uint8Array([1]));
    await h.sql.query('update creator_subscription_renders set reference_keys=$2::jsonb where render_ref=$1', [stalled.id, JSON.stringify([ref])]);
    expect(await deleteExpiredEditReferences(h.sql, store, new Date('2026-10-17T12:00:00Z'))).toBe(1);
    expect(objects.has(ref)).toBe(false);
    expect(objects.has(`${stalled.id}/input.jpg`)).toBe(true);
  });
});
