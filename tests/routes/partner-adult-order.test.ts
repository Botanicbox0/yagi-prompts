import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { recordAdultAnswer } from '@/lib/account/adult-confirmation';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { getStoreWalletBalance, verifyAndCreditStorePurchase } from '@/lib/mobile/iap/verify';
import { insertPrompt } from '@/lib/prompts/repo';
import { parseRecipe } from '@/lib/recipes/schema';
import { copyRetryPhotos, planRetryPhotos } from '@/lib/renders/cast-form';
import type { PartnerPhotoVerdict } from '@/lib/renders/partner-photo-check';
import { createRenderJob, createStoreIapRenderJob } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * docs/PERSONAL-STUDIO.md §6.1–6.2 (P2 PR B) through the real routes on PGlite, Toss faked locally and the
 * partner check faked at its module seam (no provider is called):
 *   · with TWINGS_PERSONAL_SUNRA_FACES=on, a partner-slot order answers `adult_confirmation_required`,
 *     `adult_only` or a partner-photo refusal BEFORE the order exists: no billing row, no render job, no slot
 *     row, no stored file — and the partner photo is never sent to the check before the age is settled;
 *   · a passing order carries the stored pass to fulfilment, which needs it (and the confirmation) again;
 *   · 다시 결제하기 refuses before a new order when either is missing, and copies the pass otherwise;
 *   · the operator's direct render and the store-credit render follow the same rules;
 *   · with the switch off (unset, `off`, junk) the product behaves exactly as before.
 */
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  root: { path: '' },
  after: vi.fn(),
  partnerCheck: vi.fn(),
}));
const gate = vi.hoisted(() => ({ mode: 'on' as 'on' | 'review' | 'off' }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: mocks.after }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: vi.fn() }));
vi.mock('@/lib/renders/store', async (original) => {
  const actual = await original<typeof import('@/lib/renders/store')>();
  return { ...actual, getRenderStore: async () => actual.createLocalRenderStore(mocks.root.path) };
});
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() { return gate.mode === 'on'; },
  get RENDER_PIPELINE_MODE() { return gate.mode; },
}));
vi.mock('@/lib/renders/partner-photo-check', async (original) => ({
  ...(await original<typeof import('@/lib/renders/partner-photo-check')>()),
  checkPartnerPhoto: mocks.partnerCheck,
}));

import { POST as orderPOST } from '@/app/api/billing/toss/orders/route';
import { POST as retryPOST } from '@/app/api/billing/toss/orders/[id]/retry/route';
import { GET as accessGET } from '@/app/api/renders/access/route';

const ORIGIN = 'https://twings.app';
const buyer = viewerOf('free');
const PASS: PartnerPhotoVerdict = { ok: true };
const selfie = { kind: 'image', source: 'user', required: true } as const;
const partner = { kind: 'image', source: 'user', required: true, role: 'partner' } as const;
const COUPLE = { version: 2, slots: { selfie, partner }, steps: [{ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie', 'partner'], prompt: '{{selfie}} and {{partner}} share an umbrella on a rainy street.', params: { aspect: '4:5' } }], output: { from: 'still' } };

let h: PromptHarness;
let store: RenderStore;
let slug: string;
let selfieId: string;
let PARTNER: Uint8Array;

async function coupleTemplate(): Promise<string> {
  const id = randomUUID();
  const name = `couple-${id.slice(0, 8)}`;
  await insertPrompt(h.sql, { id, slug: name, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: ['gpt-image-2'], title: 'Couple template', titleKo: null, promptText: 'legacy prompt text', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', runtimeSeconds: null, priceCents: 500, priceKrw: 6900, cast: 'couple' });
  const checked = parseRecipe(COUPLE);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  await h.sql.query('update prompt_items set recipe=$2::jsonb where id=$1', [id, JSON.stringify(checked.recipe)]);
  return name;
}

function orderForm(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('template', slug);
  form.set('aspect', '4:5');
  form.set('locale', 'ko');
  form.set('selfieId', selfieId);
  form.set('slot_partner', new File([Buffer.from(PARTNER)], 'partner.jpg', { type: 'image/jpeg' }));
  form.set('partnerConsent', 'yes');
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}
const post = (form: FormData) => orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form }));
const count = async (table: string) => (await h.sql.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;
async function billingRows(): Promise<number> {
  const { rows } = await h.sql.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name like 'billing\\_%' and table_type='BASE TABLE'");
  let total = 0;
  for (const row of rows) total += await count(row.table_name);
  return total;
}
const files = async () => (await readdir(h.root, { recursive: true })).map(String).sort();
async function nothingWritten(before: string[]) {
  expect(await billingRows()).toBe(0);
  expect(await count('render_jobs')).toBe(0);
  expect(await count('render_slot_inputs')).toBe(0);
  expect(await files()).toEqual(before);
}
async function partnerRow(renderRef: string) {
  return (await h.sql.query<{ photo_check: Record<string, unknown> | null; photo_checked_at: Date | null; partner_consent_at: Date | null }>(
    "select photo_check, photo_checked_at, partner_consent_at from render_slot_inputs where render_id=$1 and slot='partner'", [renderRef])).rows[0];
}
async function onlyOrder() {
  return (await h.sql.query<{ id: string; render_ref: string; input_key: string; input_mime: string }>('select id, render_ref, input_key, input_mime from billing_payments')).rows;
}
/** Fulfilment as the confirm route runs it: the paid order's own photo, the partner read from the order's render id. */
async function fulfil(orderId: string) {
  await h.sql.query("update billing_payments set status='paid', payment_key=coalesce(payment_key, 'test-key-' || id::text), approved_at=coalesce(approved_at, now()), consent_at=coalesce(consent_at, now()), consent_version=coalesce(consent_version, 'fixture') where id=$1", [orderId]);
  const order = (await h.sql.query<{ input_key: string; input_mime: string }>('select input_key, input_mime from billing_payments where id=$1', [orderId])).rows[0]!;
  return createRenderJob({ sql: h.sql, store, mode: 'virtual' }, buyer, {
    templateSlug: slug, aspect: '4:5', locale: 'ko', holdForIdentity: true, paymentOrderId: orderId,
    photo: { bytes: await store.read(order.input_key), mime: order.input_mime },
  });
}

beforeEach(async () => {
  gate.mode = 'on';
  vi.stubEnv('TOSS_CLIENT_KEY', '');
  vi.stubEnv('TOSS_SECRET_KEY', '');
  vi.stubEnv('TWINGS_COUPLE_TEMPLATES', 'on');
  delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
  h = await promptHarness();
  mocks.root.path = h.root;
  mocks.sql.mockResolvedValue(h.sql);
  mocks.viewer.mockResolvedValue(buyer);
  mocks.partnerCheck.mockReset();
  mocks.partnerCheck.mockResolvedValue(PASS);
  store = createLocalRenderStore(h.root);
  PARTNER ??= new Uint8Array(await sharp({ create: { width: 400, height: 500, channels: 3, background: { r: 120, g: 140, b: 200 } } }).jpeg().toBuffer());
  const png = new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: '#d6d6d6' } }).png().toBuffer());
  const saved = await saveSelfie({ sql: h.sql, store }, buyer.userId, { bytes: png, mime: 'image/png', consent: true });
  if (!saved.ok) throw new Error(saved.code);
  selfieId = saved.id;
  slug = await coupleTemplate();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await h.close();
});

describe('with the Sunra face switch on', () => {
  beforeEach(() => { vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on'); });

  it('no age answer: adult_confirmation_required before anything — no order, no job, no slot row, no file, no check', async () => {
    const before = await files();
    const response = await post(orderForm());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: 'adult_confirmation_required' });
    await nothingWritten(before);
    expect(await count('adult_confirmations')).toBe(0);
    expect(mocks.partnerCheck).not.toHaveBeenCalled();
  });

  it('a failing answer: adult_only, the answer kept, the partner photo never sent; a later passing answer changes nothing', async () => {
    const before = await files();
    const first = await post(orderForm({ birthYear: '2010', adultAttested: 'yes' }));
    expect(first.status).toBe(403);
    expect(await first.json()).toEqual({ ok: false, code: 'adult_only' });
    const second = await post(orderForm({ birthYear: '1994', adultAttested: 'yes' }));
    expect(await second.json()).toEqual({ ok: false, code: 'adult_only' });
    await nothingWritten(before);
    expect((await h.sql.query('select birth_year, attested from adult_confirmations')).rows).toEqual([{ birth_year: 2010, attested: true }]);
    expect(mocks.partnerCheck).not.toHaveBeenCalled();
  });

  it('a passing answer and a refused partner photo: its own code, still before any order or stored photo', async () => {
    const before = await files();
    const cases: Array<[PartnerPhotoVerdict, string, number]> = [
      [{ ok: false, reason: 'not_one_person' }, 'partner_not_one_person', 400],
      [{ ok: false, reason: 'unclear' }, 'partner_unclear', 400],
      [{ ok: false, reason: 'minor' }, 'partner_minor', 400],
      [{ ok: false, reason: 'screen' }, 'partner_screen', 400],
      [{ ok: false, reason: 'unchecked' }, 'partner_check_unavailable', 503],
    ];
    for (const [verdict, code, status] of cases) {
      mocks.partnerCheck.mockResolvedValueOnce(verdict);
      const response = await post(orderForm({ birthYear: '1994', adultAttested: 'yes' }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
    }
    await nothingWritten(before);
    expect(mocks.partnerCheck).toHaveBeenCalledTimes(cases.length);
  });

  it('a passing order stores the pass with the partner photo; fulfilment reads it and never calls the check again', async () => {
    const response = await post(orderForm({ birthYear: '1994', adultAttested: 'yes' }));
    expect(response.status).toBe(201);
    const [order] = await onlyOrder();
    const row = await partnerRow(order!.render_ref);
    expect(row?.photo_check).toMatchObject({ verdict: 'pass' });
    expect(row?.photo_checked_at).toBeInstanceOf(Date);
    expect(row?.partner_consent_at).toBeInstanceOf(Date);
    const created = await fulfil(order!.id);
    expect(created).toMatchObject({ ok: true });
    expect(mocks.partnerCheck).toHaveBeenCalledTimes(1);
  });

  it('fulfilment refuses a bound partner photo without a stored pass, or an account without the confirmation', async () => {
    await post(orderForm({ birthYear: '1994', adultAttested: 'yes' }));
    const [order] = await onlyOrder();
    await h.sql.query("update render_slot_inputs set photo_check=null, photo_checked_at=null where render_id=$1 and slot='partner'", [order!.render_ref]);
    expect(await fulfil(order!.id)).toEqual({ ok: false, code: 'partner_check_unavailable' });
    await h.sql.query("update render_slot_inputs set photo_check='{\"verdict\":\"pass\",\"check\":\"partner-photo-v1\"}'::jsonb, photo_checked_at=now() where render_id=$1 and slot='partner'", [order!.render_ref]);
    await h.sql.query('delete from adult_confirmations');
    expect(await fulfil(order!.id)).toEqual({ ok: false, code: 'adult_confirmation_required' });
    expect(await count('render_jobs')).toBe(0);
  });

  it('다시 결제하기 refuses before a new order without the pass or the confirmation, and copies the pass otherwise', async () => {
    await post(orderForm({ birthYear: '1994', adultAttested: 'yes' }));
    const [order] = await onlyOrder();
    const plan = await planRetryPhotos(h.sql, buyer.userId!, order!.id);
    expect(plan).toMatchObject({ kind: 'copy', slots: ['partner'] });
    // A second order to copy onto: the photos travel with their pass and its original time.
    await post(orderForm());
    const second = (await onlyOrder()).find((row) => row.id !== order!.id)!;
    if (plan.kind !== 'copy') throw new Error('expected a copy plan');
    await copyRetryPhotos(h.sql, store, { plan, newOrderId: second.id, userId: buyer.userId!, now: new Date() });
    const copied = await partnerRow(second.render_ref);
    expect(copied?.photo_check).toMatchObject({ verdict: 'pass' });
    expect(copied?.photo_checked_at?.getTime()).toBe((await partnerRow(order!.render_ref))?.photo_checked_at?.getTime());

    await h.sql.query("update render_slot_inputs set photo_check=null, photo_checked_at=null where render_id=$1 and slot='partner'", [order!.render_ref]);
    const ordersBefore = await count('billing_payments');
    const refused = await retryPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders/${order!.id}/retry`, { method: 'POST', headers: { origin: ORIGIN } }), { params: Promise.resolve({ id: order!.id }) });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ ok: false, code: 'partner_check_unavailable' });
    expect(await count('billing_payments')).toBe(ordersBefore);
    await h.sql.query('delete from adult_confirmations');
    expect(await planRetryPhotos(h.sql, buyer.userId!, order!.id)).toEqual({ kind: 'refuse', code: 'adult_confirmation_required' });
  });

  it('the operator’s direct render follows the same rules, checking the photo it is handed', async () => {
    const check = vi.fn(async (): Promise<PartnerPhotoVerdict> => ({ ok: false, reason: 'minor' }));
    const input = { templateSlug: slug, aspect: '4:5', locale: 'ko', photo: { bytes: PARTNER, mime: 'image/jpeg' }, slots: { partner: { bytes: PARTNER, mime: 'image/jpeg' } }, partnerConsent: true };
    expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual', partnerCheck: check }, ADMIN_VIEWER, input)).toEqual({ ok: false, code: 'adult_confirmation_required' });
    expect(check).not.toHaveBeenCalled();
    await recordAdultAnswer(h.sql, ADMIN_VIEWER.userId!, { birthYear: 1990, attested: true }, new Date());
    expect(await createRenderJob({ sql: h.sql, store, mode: 'virtual', partnerCheck: check }, ADMIN_VIEWER, input)).toEqual({ ok: false, code: 'partner_minor' });
    expect(await count('render_jobs')).toBe(0);
    expect(await count('render_slot_inputs')).toBe(0);
    check.mockResolvedValueOnce({ ok: true });
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual', partnerCheck: check }, ADMIN_VIEWER, input);
    if (!created.ok) throw new Error(created.code);
    expect((await partnerRow(created.id))?.photo_check).toMatchObject({ verdict: 'pass' });
  });

  it('a store-credit render with a partner refuses before any credit is spent', async () => {
    await verifyAndCreditStorePurchase(h.sql, { userId: buyer.userId!, storePlatform: 'ios-store', productId: 'twings.credits.10000', transactionId: 'ios-pack-partner' }, { verifier: async () => ({ ok: true as const }) });
    const balance = await getStoreWalletBalance(h.sql, buyer.userId!);
    const iap = (check: () => Promise<PartnerPhotoVerdict>) => createStoreIapRenderJob({ sql: h.sql, store, mode: 'virtual', pipelineMode: 'on', partnerCheck: check }, buyer, {
      storePlatform: 'ios-store', requestId: randomUUID(), templateSlug: slug, aspect: '4:5', locale: 'ko',
      photo: { bytes: PARTNER, mime: 'image/jpeg' }, slots: { partner: { bytes: PARTNER, mime: 'image/jpeg' } }, partnerConsent: true,
    });
    expect(await iap(async () => PASS)).toMatchObject({ ok: false, code: 'adult_confirmation_required' });
    await recordAdultAnswer(h.sql, buyer.userId!, { birthYear: 1990, attested: true }, new Date());
    expect(await iap(async () => ({ ok: false, reason: 'screen' }))).toMatchObject({ ok: false, code: 'partner_screen' });
    expect(await getStoreWalletBalance(h.sql, buyer.userId!)).toBe(balance);
    expect(await count('render_jobs')).toBe(0);
    expect(await iap(async () => PASS)).toMatchObject({ ok: true });
  });

  it('the access call says whether this account is confirmed', async () => {
    const access = async () => (await accessGET(new Request(`${ORIGIN}/api/renders/access?template=${slug}&locale=ko`))).json() as Promise<Record<string, unknown>>;
    expect((await access()).adultConfirmed).toBe(false);
    await recordAdultAnswer(h.sql, buyer.userId!, { birthYear: 1994, attested: true }, new Date());
    expect((await access()).adultConfirmed).toBe(true);
  });

  it('a database without the 0188 objects refuses before the order (fail-closed)', async () => {
    await h.sql.query('drop table adult_confirmations');
    const before = await files();
    const response = await post(orderForm({ birthYear: '1994', adultAttested: 'yes' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'adult_check_unavailable' });
    await nothingWritten(before);
    expect(mocks.partnerCheck).not.toHaveBeenCalled();
  });
});

describe.each([['unset', undefined], ['off', 'off'], ['junk', 'yes']] as const)('with the switch %s: exactly as before', (_label, value) => {
  beforeEach(() => { if (value !== undefined) vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', value); });

  it('a couple order needs no age answer, sends nothing to the check, and fulfils', async () => {
    const response = await post(orderForm());
    expect(response.status).toBe(201);
    const [order] = await onlyOrder();
    const row = await partnerRow(order!.render_ref);
    expect(row?.photo_check).toBeNull();
    expect(row?.photo_checked_at).toBeNull();
    expect(row?.partner_consent_at).toBeInstanceOf(Date);
    expect(await fulfil(order!.id)).toMatchObject({ ok: true });
    expect(await planRetryPhotos(h.sql, buyer.userId!, order!.id)).toMatchObject({ kind: 'copy' });
    expect(mocks.partnerCheck).not.toHaveBeenCalled();
    expect(await count('adult_confirmations')).toBe(0);
  });

  it('age fields sent anyway are ignored and stored nowhere', async () => {
    expect((await post(orderForm({ birthYear: '2012', adultAttested: 'yes' }))).status).toBe(201);
    expect(await count('adult_confirmations')).toBe(0);
  });

  it('the operator’s direct couple render is unchanged: no confirmation, no check', async () => {
    const check = vi.fn(async (): Promise<PartnerPhotoVerdict> => ({ ok: false, reason: 'unchecked' }));
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual', partnerCheck: check }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', locale: 'ko', photo: { bytes: PARTNER, mime: 'image/jpeg' }, slots: { partner: { bytes: PARTNER, mime: 'image/jpeg' } }, partnerConsent: true });
    expect(created).toMatchObject({ ok: true });
    expect(check).not.toHaveBeenCalled();
  });

  it('the access call carries no age field', async () => {
    const body = await (await accessGET(new Request(`${ORIGIN}/api/renders/access?template=${slug}&locale=ko`))).json() as Record<string, unknown>;
    expect('adultConfirmed' in body).toBe(false);
  });
});
