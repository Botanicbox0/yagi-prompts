import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { insertPrompt } from '@/lib/prompts/repo';
import { directorSpecAsksEdits, loadTemplateEditsClosed } from '@/lib/prompts/edits-closed';
import { createLocalRenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * Founder 2026-11-25 — a buyer who pays for an edit must get it. A template whose text leaves no room for edits
 * (`templateEditsClosed`) refuses an order or a director turn that carries one with `edits_closed` (409), before any
 * order, job, charge or file exists; the same order without an edit, and any template with room, go on as before.
 * Through the real routes on PGlite (Toss faked locally, no provider called). Filler text only.
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
import { POST as directorPOST } from '@/app/api/template-director/route';

const ORIGIN = 'https://twings.app';
const buyer = viewerOf('free');
const EDIT = JSON.stringify({ userMessage: '모든 컷에서 검은 가죽 재킷을 입혀 주세요.', audioMode: 'ambient' });
const OWN = JSON.stringify({ audioMode: 'ambient', own: ['hair'] });

let h: PromptHarness;
let selfieId: string;

const film = (chars: number) => {
  const head = 'Shot 1 (0-3s): she walks down a quiet street at dusk.\nShot 2 (3-6s): she turns to the camera.\n';
  return `${head}${'x'.repeat(chars - head.length)}`;
};
async function template(chars: number): Promise<string> {
  const id = randomUUID();
  const slug = `walk-${chars}-${id.slice(0, 6)}`;
  await insertPrompt(h.sql, { id, slug, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: ['seedance-2.5'], title: 'Long walk', titleKo: null, promptText: film(chars), textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: 'video', engine: 'seedance-2.5', aspectDefault: '9:16', runtimeSeconds: 10, priceCents: 1900, priceKrw: 24900, cast: 'solo' });
  return slug;
}
function form(slug: string, extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set('template', slug);
  data.set('aspect', '9:16');
  data.set('locale', 'ko');
  data.set('resolution', '720p');
  data.set('selfieId', selfieId);
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}
const count = async (table: string) => (await h.sql.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;
const codeOf = async (response: Response) => ((await response.json()) as { code?: string }).code;

beforeEach(async () => {
  vi.stubEnv('TOSS_CLIENT_KEY', '');
  vi.stubEnv('TOSS_SECRET_KEY', '');
  delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
  h = await promptHarness();
  mocks.root.path = h.root;
  mocks.sql.mockResolvedValue(h.sql);
  mocks.viewer.mockResolvedValue(buyer);
  mocks.after.mockReset();
  const png = new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: '#d6d6d6' } }).png().toBuffer());
  const saved = await saveSelfie({ sql: h.sql, store: createLocalRenderStore(h.root) }, buyer.userId, { bytes: png, mime: 'image/png', consent: true });
  if (!saved.ok) throw new Error(saved.code);
  selfieId = saved.id;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await h.close();
});

describe('a template with no room for edits', () => {
  it('knows which templates are closed: 14,879 characters yes, 9,000 no', async () => {
    expect(await loadTemplateEditsClosed(h.sql, await template(14_879))).toBe(true);
    expect(await loadTemplateEditsClosed(h.sql, await template(9_000))).toBe(false);
    expect(directorSpecAsksEdits(JSON.parse(EDIT))).toBe(true);
    expect(directorSpecAsksEdits(JSON.parse(OWN))).toBe(true);
    expect(directorSpecAsksEdits({ audioMode: 'ambient' } as never)).toBe(false);
  });

  it('the paid order with an edit or an own part answers edits_closed (409) before any order exists', async () => {
    const closed = await template(14_879);
    for (const spec of [EDIT, OWN]) {
      const response = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form(closed, { directorSpec: spec }) }));
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe('edits_closed');
    }
    expect(await count('billing_payments')).toBe(0);
    expect(await count('render_jobs')).toBe(0);
    // The same template without an edit is not refused for it.
    const plain = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form(closed) }));
    expect(await codeOf(plain.clone())).not.toBe('edits_closed');
    // A template with room takes the edit as before.
    const open = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form(await template(9_000), { directorSpec: EDIT }) }));
    expect(await codeOf(open.clone())).not.toBe('edits_closed');
  });

  it('the operator render and the store-credit render answer the same, before anything is made', async () => {
    const closed = await template(14_879);
    mocks.viewer.mockResolvedValue(ADMIN_VIEWER);
    const free = await rendersPOST(new NextRequest(`${ORIGIN}/api/renders`, { method: 'POST', body: form(closed, { directorSpec: EDIT }) }));
    expect(free.status).toBe(409);
    expect(await codeOf(free)).toBe('edits_closed');
    mocks.viewer.mockResolvedValue(buyer);
    const iap = await iapPOST(new NextRequest(`${ORIGIN}/api/mobile/iap/renders`, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 TwingsIOS/1.0' }, body: form(closed, { directorSpec: OWN, requestId: randomUUID() }) }));
    expect(iap.status).toBe(409);
    expect(await codeOf(iap)).toBe('edits_closed');
    expect(await count('render_jobs')).toBe(0);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('the director takes no turn for it', async () => {
    const closed = await template(14_879);
    const turn = (slug: string) => {
      const data = new FormData();
      data.set('template', slug);
      data.set('message', '머리를 짧게 해 주세요.');
      data.set('locale', 'ko');
      return directorPOST(new NextRequest(`${ORIGIN}/api/template-director`, { method: 'POST', headers: { origin: ORIGIN }, body: data }));
    };
    const refused = await turn(closed);
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe('edits_closed');
    const open = await turn(await template(9_000));
    expect(open.status).not.toBe(409);
  });
});

describe('an edit too long for the template it is for', () => {
  const NOTE = JSON.stringify({ audioMode: 'bgm', bgmMood: 'cinematic', userMessage: `모든 컷에서 ${'가'.repeat(990)}` });
  const SHORT = JSON.stringify({ audioMode: 'ambient', userMessage: '검은 가죽 재킷을 입혀 주세요.' });

  it('every order entry answers edit_too_long (422) before anything exists; a short edit and a roomy template go on', async () => {
    const tight = await template(13_900);
    expect(await loadTemplateEditsClosed(h.sql, tight)).toBe(false);
    const order = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form(tight, { directorSpec: NOTE }) }));
    expect(order.status).toBe(422);
    expect(await codeOf(order)).toBe('edit_too_long');
    mocks.viewer.mockResolvedValue(ADMIN_VIEWER);
    const free = await rendersPOST(new NextRequest(`${ORIGIN}/api/renders`, { method: 'POST', body: form(tight, { directorSpec: NOTE }) }));
    expect(await codeOf(free)).toBe('edit_too_long');
    mocks.viewer.mockResolvedValue(buyer);
    const iap = await iapPOST(new NextRequest(`${ORIGIN}/api/mobile/iap/renders`, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 TwingsIOS/1.0' }, body: form(tight, { directorSpec: NOTE, requestId: randomUUID() }) }));
    expect(await codeOf(iap)).toBe('edit_too_long');
    expect(await count('billing_payments')).toBe(0);
    expect(await count('render_jobs')).toBe(0);

    const short = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form(tight, { directorSpec: SHORT }) }));
    expect(await codeOf(short.clone())).not.toBe('edit_too_long');
    const roomy = await orderPOST(new NextRequest(`${ORIGIN}/api/billing/toss/orders`, { method: 'POST', headers: { origin: ORIGIN }, body: form(await template(9_000), { directorSpec: NOTE }) }));
    expect(await codeOf(roomy.clone())).not.toBe('edit_too_long');
  });

  it('the director leaves the sheet as it was and says too_long when a turn would not fit', async () => {
    vi.stubEnv('TWINGS_PERSONAL_EDIT_SHEET', 'on');
    vi.stubEnv('GEMINI_API_KEY', '');
    const line = (c: string) => `${c} ${'w'.repeat(117)}`;
    const prior = { sheet: { change: [], keep: Array.from({ length: 6 }, (_, i) => line(`k${i}`)), exclude: Array.from({ length: 4 }, (_, i) => line(`e${i}`)) }, turns: [], question: null, asked: false };
    const turn = (slug: string) => {
      const data = new FormData();
      data.set('template', slug);
      data.set('message', 'Put me in a red dress');
      data.set('locale', 'ko');
      data.set('sheet', JSON.stringify(prior));
      return directorPOST(new NextRequest(`${ORIGIN}/api/template-director`, { method: 'POST', headers: { origin: ORIGIN }, body: data }));
    };
    const refused = await turn(await template(13_900));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, code: 'too_long', message: '요청이 길어 이 템플릿에 다 담을 수 없어요. 고칠 내용을 줄여 주세요.' });
    const roomy = await turn(await template(9_000));
    expect(roomy.status).toBe(200);
    const body = (await roomy.json()) as { turn: { sheet: { change: unknown[] }; changed: boolean } };
    expect(body.turn.changed).toBe(true);
    expect(body.turn.sheet.change.length).toBeGreaterThan(0);
  });
});
