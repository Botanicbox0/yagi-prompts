import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { insertPrompt } from '@/lib/prompts/repo';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * A saved photo whose file is gone from the render store, through the real routes on PGlite (Toss faked
 * locally, no provider called): the paid order, the operator's free render and the store-credit render
 * all answer `selfie_file_missing` with 409 before anything exists — no billing row, no render job, no
 * stored file, no credit spent — instead of the old 503 "try again later" (orders) or an unhandled 500.
 */
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), root: { path: '' }, after: vi.fn() }));
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
  get RENDER_PIPELINE_PUBLIC() { return true; },
  get RENDER_PIPELINE_MODE() { return 'on'; },
}));

import { POST as orderPOST } from '@/app/api/billing/toss/orders/route';
import { POST as rendersPOST } from '@/app/api/renders/route';
import { POST as iapPOST } from '@/app/api/mobile/iap/renders/route';

const ORIGIN = 'https://twings.app';
const buyer = viewerOf('free');

let h: PromptHarness;
let store: RenderStore;
let slug: string;
let selfieId: string;

async function soloTemplate(): Promise<string> {
  const id = randomUUID();
  const name = `solo-${id.slice(0, 8)}`;
  await insertPrompt(h.sql, { id, slug: name, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: ['gpt-image-2'], title: 'Solo template', titleKo: null, promptText: 'prompt text', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', runtimeSeconds: null, priceCents: 500, priceKrw: 6900, cast: 'solo' });
  return name;
}
function makeForm(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('template', slug);
  form.set('aspect', '4:5');
  form.set('locale', 'ko');
  form.set('selfieId', selfieId);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}
const count = async (table: string) => (await h.sql.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;
async function billingRows(): Promise<number> {
  const { rows } = await h.sql.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name like 'billing\\_%' and table_type='BASE TABLE'");
  let total = 0;
  for (const row of rows) total += await count(row.table_name);
  return total;
}
const files = async () => (await readdir(h.root, { recursive: true })).map(String).sort();
async function loseSelfieFile() {
  const { rows } = await h.sql.query<{ input_key: string }>('select input_key from identity_selfies where id=$1', [selfieId]);
  await rm(join(h.root, 'renders', rows[0]!.input_key));
}

beforeEach(async () => {
  vi.stubEnv('TOSS_CLIENT_KEY', '');
  vi.stubEnv('TOSS_SECRET_KEY', '');
  delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
  h = await promptHarness();
  mocks.root.path = h.root;
  mocks.sql.mockResolvedValue(h.sql);
  mocks.viewer.mockResolvedValue(buyer);
  mocks.after.mockReset();
  store = createLocalRenderStore(h.root);
  const png = new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: '#d6d6d6' } }).png().toBuffer());
  const saved = await saveSelfie({ sql: h.sql, store }, buyer.userId, { bytes: png, mime: 'image/png', consent: true });
  if (!saved.ok) throw new Error(saved.code);
  selfieId = saved.id;
  slug = await soloTemplate();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await h.close();
});

describe('a saved photo whose file is missing', () => {
  it('the paid order answers selfie_file_missing (409) before the order exists: no billing row, no job, no stored file', async () => {
    await loseSelfieFile();
    const before = await files();
    const response = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: makeForm() }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: 'selfie_file_missing' });
    expect(await billingRows()).toBe(0);
    expect(await count('render_jobs')).toBe(0);
    expect(await files()).toEqual(before);
  });

  it('the same order with the file in place still opens a checkout (the fix changes nothing else)', async () => {
    const response = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: makeForm() }));
    expect(response.status).toBe(201);
    expect(await count('billing_payments')).toBe(1);
  });

  it('the operator’s free render answers the same code, never an unhandled 500', async () => {
    mocks.viewer.mockResolvedValue(ADMIN_VIEWER);
    const png = new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: '#a0a0a0' } }).png().toBuffer());
    const saved = await saveSelfie({ sql: h.sql, store }, ADMIN_VIEWER.userId, { bytes: png, mime: 'image/png', consent: true });
    if (!saved.ok) throw new Error(saved.code);
    selfieId = saved.id;
    await loseSelfieFile();
    const before = await files();
    const response = await rendersPOST(new NextRequest(`${ORIGIN}/api/renders`, { method: 'POST', body: makeForm() }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: 'selfie_file_missing' });
    expect(await count('render_jobs')).toBe(0);
    expect(await files()).toEqual(before);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('the store-credit render answers the same code before any credit is spent, never an unhandled 500', async () => {
    await loseSelfieFile();
    const before = await files();
    const response = await iapPOST(new NextRequest(`${ORIGIN}/api/mobile/iap/renders`, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 TwingsIOS/1.0' }, body: makeForm({ requestId: randomUUID() }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: 'selfie_file_missing' });
    expect(await count('render_jobs')).toBe(0);
    expect(await files()).toEqual(before);
  });
});
