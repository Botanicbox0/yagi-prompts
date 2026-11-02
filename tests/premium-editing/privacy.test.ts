import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purgePremiumEditDataForAccountDeletion, PREMIUM_EDIT_PRIVACY_BATCH_ROWS } from '@/lib/premium-editing/privacy';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import type { RenderStore } from '@/lib/renders/store';

const NOW = new Date('2026-10-10T00:00:00Z');
const userId = viewerOf('free').userId!;
const otherId = viewerOf('pro').userId!;
const confirmation = { userId, confirmedUserId: userId };

describe('operator-only scoped Premium edit privacy cleanup', () => {
  let h: PromptHarness;
  let objects: Map<string, Uint8Array>;
  let remove: ReturnType<typeof vi.fn<(key: string) => Promise<void>>>;
  let store: RenderStore;
  let subscriptionId: string;
  let periodId: string;
  let created = 0;
  beforeEach(async () => {
    h = await promptHarness();
    objects = new Map(); created = 0;
    remove = vi.fn(async key => { objects.delete(key); });
    store = { name: 'local', async put(key, bytes) { objects.set(key, bytes); }, async read(key) { return objects.get(key)!; }, async url() { return null; }, delete: remove };
    await h.db.exec('create role service_role nologin bypassrls; create role anon nologin; create role authenticated nologin; grant select,insert,update,delete on creator_subscription_renders to service_role;');
    subscriptionId = randomUUID(); periodId = randomUUID();
    await h.sql.query(`insert into creator_subscriptions(id,user_id,environment,plan_id,plan_version,amount_krw,monthly_units,premium_edit_limit,consent_version,consent_at,locale,customer_key,status,expires_at)
      values($1,$2,'test','premium','v1',49000,1200,30,'v1',$3,'ko',$4,'ended',$3)`, [subscriptionId, userId, NOW, randomUUID()]);
    await h.sql.query(`insert into creator_subscription_periods(id,subscription_id,period_index,environment,starts_at,ends_at,amount_krw,monthly_units,status,paid_at)
      values($1,$2,0,'test',$3,$4,49000,1200,'paid',$3)`, [periodId, subscriptionId, new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z')]);
  });
  afterEach(async () => { await h.close(); });
  const cleanup = (input = confirmation, operator = ADMIN_VIEWER) => purgePremiumEditDataForAccountDeletion({ sql: h.sql, store, now: NOW }, operator, input);

  async function privateRequest(owner = userId, refs = 2, requestOwner = owner) {
    const id = randomUUID();
    const at = new Date(NOW.getTime() + created++);
    await h.sql.query(`insert into render_jobs(id,user_id,template_id,template_slug,medium,engine,aspect,locale,status,error_code,input_key,input_mime,result_key,result_mime)
      select $1,$2,id,slug,'video','seedance-2.5','9:16','ko','failed','edit_refused',$3,'image/jpeg',$4,'video/mp4' from prompt_items where slug='neon-alley-dolly'`, [id, owner, `${id}/input.jpg`, `${id}/result.mp4`]);
    const keys = Array.from({ length: refs }, (_, index) => `${id}/reference${String.fromCharCode(97 + index)}.jpg`);
    await h.sql.query(`insert into creator_subscription_renders(render_ref,user_id,environment,request_id,fingerprint,base_prompt,runtime_seconds,edit_text,allowed_scopes,reference_keys,guide_version,edit_status,prepared_plan,references_expire_at,created_at)
      values($1,$2,'test',$3,$4,'private recipe fixture',10,'private edit fixture',array['wardrobe_color'],$5::jsonb,'fixture','prepared',$6::jsonb,$7,$8)`, [id, requestOwner, randomUUID(), 'a'.repeat(64), JSON.stringify(keys), JSON.stringify({ approved: true, refusal: 'none', changes: [{ scope: 'wardrobe_color', value: 'blue' }] }), new Date(NOW.getTime() + 7 * 86400000), at]);
    for (const key of [...keys, `${id}/input.jpg`, `${id}/result.mp4`]) objects.set(key, new Uint8Array([1]));
    if (owner === userId) await h.sql.query(`insert into creator_subscription_usage(render_ref,subscription_id,period_id,user_id,environment,units,state,settled_at)
      values($1,$2,$3,$4,'test',100,'released',$5)`, [id, subscriptionId, periodId, owner, NOW]);
    return { id, keys };
  }

  it('requires a current real admin, an existing target UUID, exact confirmation and no caller keys', async () => {
    await privateRequest();
    expect(await cleanup(confirmation, viewerOf('free'))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await cleanup(confirmation, { ...viewerOf('free'), isAdmin: true })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await cleanup({ userId, confirmedUserId: otherId })).toMatchObject({ ok: false, code: 'confirmation_required' });
    expect(await cleanup({ userId: 'not-a-uuid', confirmedUserId: 'not-a-uuid' })).toMatchObject({ ok: false, code: 'bad_request' });
    const absent = randomUUID();
    expect(await cleanup({ userId: absent, confirmedUserId: absent })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await cleanup({ ...confirmation, keys: ['foreign/input.jpg'] } as never)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(remove).not.toHaveBeenCalled();
    expect((await h.sql.query('select render_ref from creator_subscription_renders')).rows).toHaveLength(1);
  });

  it('fails closed until all billing, key cleanup, reserved usage and render work is settled', async () => {
    const request = await privateRequest();
    await h.sql.query("update creator_subscriptions set status='active' where id=$1", [subscriptionId]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'billing_active' });
    await h.sql.query("update creator_subscriptions set status='ended' where id=$1", [subscriptionId]);
    await h.sql.query("update creator_subscription_periods set status='charging' where id=$1", [periodId]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'billing_pending' });
    await h.sql.query("update creator_subscription_periods set status='paid' where id=$1", [periodId]);
    await h.sql.query("update creator_subscription_usage set state='reserved' where render_ref=$1", [request.id]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'billing_pending' });
    await h.sql.query("update creator_subscription_usage set state='released' where render_ref=$1", [request.id]);
    const keyCleanupId = randomUUID();
    await h.sql.query(`insert into creator_subscription_key_cleanup(id,subscription_id,environment,key_fingerprint,status) values($1,$2,'test','fixture-key','pending')`, [keyCleanupId, subscriptionId]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'billing_pending' });
    await h.sql.query("update creator_subscription_key_cleanup set status='revoked' where id=$1", [keyCleanupId]);
    await h.sql.query(`insert into subscriptions(user_id,stripe_subscription_id,status,stripe_fetched_at) values($1,'fixture-sub','active',$2)`, [userId, NOW]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'billing_active' });
    await h.sql.query("update subscriptions set status='canceled' where user_id=$1", [userId]);
    const paymentId = randomUUID();
    await h.sql.query(`insert into billing_payments(id,user_id,environment,payment_type,amount_krw,order_name,locale,expires_at,status) values($1,$2,'test','BILLING',1000,'fixture','ko',$3,'confirming')`, [paymentId, userId, NOW]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'billing_pending' });
    await h.sql.query("update billing_payments set status='failed' where id=$1", [paymentId]);
    await h.sql.query("update render_jobs set status='running' where id=$1", [request.id]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'render_pending' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('purges only a fixed batch of the selected private rows and references while preserving every ledger and asset', async () => {
    for (let i = 0; i < PREMIUM_EDIT_PRIVACY_BATCH_ROWS + 1; i++) await privateRequest();
    const foreign = await privateRequest(otherId);
    await h.sql.query("insert into identity_groups(user_id,status,group_id,verified_at) values($1,'active','fixture-identity',$2)", [userId, NOW]);
    const before = await Promise.all(['creator_subscriptions','creator_subscription_periods','creator_subscription_usage','render_jobs','identity_groups','profiles'].map(table => h.sql.query(`select * from ${table} order by 1`)));
    expect(await cleanup()).toEqual({ ok: true, deletedRequests: PREMIUM_EDIT_PRIVACY_BATCH_ROWS, processedReferences: PREMIUM_EDIT_PRIVACY_BATCH_ROWS * 2, remainingRequests: 1, complete: false });
    expect(await cleanup()).toEqual({ ok: true, deletedRequests: 1, processedReferences: 2, remainingRequests: 0, complete: true });
    expect(await cleanup()).toEqual({ ok: true, deletedRequests: 0, processedReferences: 0, remainingRequests: 0, complete: true });
    const after = await Promise.all(['creator_subscriptions','creator_subscription_periods','creator_subscription_usage','render_jobs','identity_groups','profiles'].map(table => h.sql.query(`select * from ${table} order by 1`)));
    expect(after).toEqual(before);
    expect((await h.sql.query('select render_ref from creator_subscription_renders')).rows).toEqual([{ render_ref: foreign.id }]);
    expect([...objects.keys()].filter(key => key.endsWith('/input.jpg') || key.endsWith('/result.mp4'))).toHaveLength((PREMIUM_EDIT_PRIVACY_BATCH_ROWS + 2) * 2);
    expect(foreign.keys.every(key => objects.has(key))).toBe(true);
    expect(remove.mock.calls.every(([key]) => /\/reference[abc]\.jpg$/.test(key))).toBe(true);
  });

  it('validates all keys and render owners before deletion and retains rows after a partial storage failure for retry', async () => {
    const first = await privateRequest();
    const second = await privateRequest();
    await h.sql.query('update creator_subscription_renders set reference_keys=$2::jsonb where render_ref=$1', [second.id, JSON.stringify([`${second.id}/input.jpg`])]);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'invalid_private_data' });
    expect(remove).not.toHaveBeenCalled();
    await h.sql.query('update creator_subscription_renders set reference_keys=$2::jsonb where render_ref=$1', [second.id, JSON.stringify(second.keys)]);
    const mismatch = await privateRequest(otherId, 1, userId);
    expect(await cleanup()).toMatchObject({ ok: false, code: 'invalid_private_data' });
    expect(remove).not.toHaveBeenCalled();
    await h.sql.query('update creator_subscription_renders set user_id=$2 where render_ref=$1', [mismatch.id, otherId]);
    remove.mockImplementationOnce(async key => { objects.delete(key); });
    remove.mockImplementationOnce(async () => { throw Error('fixture storage failure'); });
    expect(await cleanup()).toMatchObject({ ok: false, code: 'storage_unavailable', retryable: true });
    expect((await h.sql.query('select render_ref from creator_subscription_renders where user_id=$1', [userId])).rows).toHaveLength(2);
    expect(objects.has(first.keys[0]!)).toBe(false);
    expect(await cleanup()).toEqual({ ok: true, deletedRequests: 2, processedReferences: 4, remainingRequests: 0, complete: true });
    expect(objects.has(`${first.id}/input.jpg`)).toBe(true);
    expect(objects.has(`${second.id}/result.mp4`)).toBe(true);
    expect(objects.has(mismatch.keys[0]!)).toBe(true);
  });
});
