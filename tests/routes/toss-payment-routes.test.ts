import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import { createFakeTossGateway, type FakeTossGateway } from '@/lib/billing/toss-fake';
import { TossError } from '@/lib/billing/toss-gateway';
import { createTossOrder, resetTossWebhookLimit, TOSS_WEBHOOK_LIMIT } from '@/lib/billing/toss-service';
import { acceptUsageQuote } from '@/lib/brands/usage/service';
import { confirmUsagePayment, createUsageOrder } from '@/lib/brands/usage/payment';
import { acceptFundingQuote, issueFundingQuote } from '@/lib/campaigns/funding/service';
import { confirmFundingPayment, createFundingOrder } from '@/lib/campaigns/funding/payment';
import { createRenderJob } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { authReturnPath } from '@/lib/routing/surfaces';
import { noticeSigninHref } from '@/components/marketing/notice-codes';
import { viewerOf } from '@/tests/helpers/admin';
import { usageFixture } from '@/tests/helpers/brand-usage';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * The Toss routes over a real (PGlite) database with the local fake gateway — docs/PLATFORM-2.0.md
 * §2.2: approval, the return after a sign-in, 다시 결제하기, the webhook hint (for all three tables
 * the merchant account takes) and the status poll.
 */
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  root: { path: '' },
  session: vi.fn(),
  exchange: vi.fn(),
  after: vi.fn(),
  pass: vi.fn(),
}));
const gate = vi.hoisted(() => ({ mode: 'on' as 'on' | 'review' | 'off' }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: mocks.after }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: mocks.pass }));
vi.mock('@/lib/renders/store', async (original) => {
  const actual = await original<typeof import('@/lib/renders/store')>();
  return { ...actual, getRenderStore: async () => actual.createLocalRenderStore(mocks.root.path) };
});
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() {
    return gate.mode === 'on';
  },
  get RENDER_PIPELINE_MODE() {
    return gate.mode;
  },
}));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_request: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
vi.mock('@/lib/supabase/auth-client', () => ({
  getSessionUser: mocks.session,
  createAuthServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }),
}));

import { middleware } from '@/middleware';
import { GET as signIn } from '@/app/auth/signin/route';
import { GET as callback } from '@/app/auth/callback/route';
import { POST as confirm } from '@/app/api/billing/toss/confirm/route';
import { GET as status, POST as consent } from '@/app/api/billing/toss/orders/[id]/route';
import { POST as retry } from '@/app/api/billing/toss/orders/[id]/retry/route';
import { GET as webhookGet, POST as webhook } from '@/app/api/billing/toss/webhook/route';
import { tossReturnPath, tossSignInHref } from '@/app/(app)/billing/toss/return/resume';

const ORIGIN = 'https://twings.app';
const buyer = viewerOf('free');
const other = viewerOf('pro');
const anon: Viewer = viewerOf('anon');
const input = {
  templateSlug: 'static-portrait-window-light',
  aspect: '4:5',
  locale: 'ko',
  photo: { bytes: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg' },
};
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { host: 'twings.app', origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let h: PromptHarness;
const fake = (): FakeTossGateway =>
  ((globalThis as { __twingsFakeToss?: FakeTossGateway }).__twingsFakeToss ??= createFakeTossGateway());
const deps = () => ({ sql: h.sql, store: createLocalRenderStore(h.root), gateway: fake(), createRender: createRenderJob });
const row = async (id: string) =>
  (await h.sql.query<{ status: string; failure_code: string | null; consent_at: Date | null; retried_by: string | null }>(
    'select status,failure_code,consent_at,retried_by from billing_payments where id=$1',
    [id],
  )).rows[0]!;
async function placed(viewer = buyer) {
  const created = await createTossOrder(deps(), viewer, input);
  if (!created.ok) throw new Error(created.code);
  // What the order page records before it opens the provider window.
  await h.sql.query("update billing_payments set consent_at=now(), consent_version='fixture' where id=$1", [created.order.id]);
  return created.order;
}
async function refusedAtApproval() {
  const o = await placed();
  const original = fake().confirm;
  fake().confirm = async () => {
    throw new TossError('HTTP_403', false, 'REJECT_CARD_COMPANY');
  };
  mocks.viewer.mockResolvedValue(buyer);
  const response = await confirm(json('/api/billing/toss/confirm', { orderId: o.id, paymentKey: 'from-the-window', amount: o.amountKrw }));
  fake().confirm = original;
  return { o, response };
}

beforeEach(async () => {
  gate.mode = 'on';
  vi.stubEnv('TOSS_CLIENT_KEY', '');
  vi.stubEnv('TOSS_SECRET_KEY', '');
  delete (globalThis as { __twingsFakeToss?: unknown }).__twingsFakeToss;
  resetTossWebhookLimit();
  h = await promptHarness();
  mocks.root.path = h.root;
  mocks.sql.mockResolvedValue(h.sql);
  mocks.viewer.mockResolvedValue(buyer);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.viewer.mockReset();
  mocks.session.mockReset();
  mocks.exchange.mockReset();
  await h.close();
});

describe('POST /api/billing/toss/confirm', () => {
  it('answers an unsigned return with 401 and the code the return page turns into a sign-in', async () => {
    mocks.viewer.mockResolvedValue(anon);
    const response = await confirm(json('/api/billing/toss/confirm', { orderId: crypto.randomUUID(), paymentKey: 'k', amount: 1 }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: 'sign_in_required' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('a declined approval answers 400 declined and the order ends failed — no waiting page', async () => {
    const { o, response } = await refusedAtApproval();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: 'declined' });
    expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'declined' });
  });

  it('a changed price answers 400 price_changed and the order is failed, not left for its old checkout', async () => {
    const o = await placed();
    await h.sql.query('update prompt_items set price_krw = price_krw + 1000 where slug = $1', [input.templateSlug]);
    const response = await confirm(json('/api/billing/toss/confirm', { orderId: o.id, paymentKey: 'k', amount: o.amountKrw }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: 'price_changed' });
    expect(await row(o.id)).toMatchObject({ status: 'failed', failure_code: 'price_changed' });
  });
});

describe('the return from an app switch without a session (docs/PLATFORM-2.0.md §2.2-9)', () => {
  it('carries paymentKey through the gate, the sign-in and the OAuth return, and the approval completes', async () => {
    const o = await placed();
    const back = `/billing/toss/return?locale=ko&paymentKey=tgen_probe_20261022&orderId=${o.id}&amount=${o.amountKrw}`;

    // 1. No session: the edge gate sends the reader to sign in with the whole return in `next`.
    const gated = await middleware(new NextRequest(`${ORIGIN}${back}`, { headers: { host: 'twings.app' } }));
    expect(gated.status).toBe(307);
    const home = new URL(gated.headers.get('location')!);
    expect(home.searchParams.get('next')).toBe(back);

    // 2. The notice band's sign-in door keeps it.
    const door = noticeSigninHref('signin', home.search, home.pathname, 'ko');
    expect(new URL(door!, ORIGIN).searchParams.get('next')).toBe(back);

    // 3. /auth/signin hands it to the provider chooser unchanged.
    mocks.session.mockResolvedValue(null);
    const chooser = await signIn(new NextRequest(new URL(door!, ORIGIN), { headers: { host: 'twings.app' } }));
    expect(new URL(chooser.headers.get('location')!, ORIGIN).searchParams.get('next')).toBe(back);

    // 4. The OAuth return lands exactly on the return page, approval parameters intact.
    mocks.exchange.mockResolvedValue({ data: { user: { id: buyer.userId, email: buyer.email } }, error: null });
    const returned = await callback(
      new NextRequest(`${ORIGIN}/auth/callback?code=fixture&locale=ko&next=${encodeURIComponent(back)}`, { headers: { host: 'twings.app' } }),
    );
    const landing = new URL(returned.headers.get('location')!);
    expect(`${landing.pathname}${landing.search}`).toBe(back);

    // 5. Signed in now, the return page posts what it finds there and the approval goes through.
    mocks.viewer.mockResolvedValue(buyer);
    const q = landing.searchParams;
    const response = await confirm(
      json('/api/billing/toss/confirm', { orderId: q.get('orderId'), paymentKey: q.get('paymentKey'), amount: Number(q.get('amount')) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, href: expect.stringMatching(/^\/renders\//) });
    expect(await row(o.id)).toMatchObject({ status: 'paid' });
  });

  it('a session that lapses between the page and the POST signs in and comes back to the same approval', async () => {
    const o = await placed();
    const values = { orderId: o.id, paymentKey: 'tgen_probe_20261022', amount: String(o.amountKrw), locale: 'ko' as const };
    mocks.viewer.mockResolvedValue(anon);
    expect((await confirm(json('/api/billing/toss/confirm', { ...values, amount: o.amountKrw }))).status).toBe(401);
    const href = tossSignInHref(values);
    expect(href.startsWith('/auth/signin?')).toBe(true);
    const next = new URL(href, ORIGIN).searchParams.get('next');
    expect(next).toBe(tossReturnPath(values));
    expect(authReturnPath(next, 'twings.app', '/ko/video')).toBe(tossReturnPath(values));
    const resumed = new URL(tossReturnPath(values), ORIGIN).searchParams;
    expect(Object.fromEntries(resumed)).toEqual(values);
    expect(await row(o.id)).toMatchObject({ status: 'pending' });
  });
});

describe('POST /api/billing/toss/orders/[id]/retry', () => {
  it('makes a new pending order for the owner only, from the same origin', async () => {
    const { o } = await refusedAtApproval();
    mocks.viewer.mockResolvedValue(anon);
    expect((await retry(json(`/api/billing/toss/orders/${o.id}/retry`, {}), params(o.id))).status).toBe(401);
    mocks.viewer.mockResolvedValue(buyer);
    expect((await retry(json(`/api/billing/toss/orders/${o.id}/retry`, {}, { origin: 'https://evil.example' }), params(o.id))).status).toBe(403);
    mocks.viewer.mockResolvedValue(other);
    expect((await retry(json(`/api/billing/toss/orders/${o.id}/retry`, {}), params(o.id))).status).toBe(404);
    mocks.viewer.mockResolvedValue(buyer);
    const made = await retry(json(`/api/billing/toss/orders/${o.id}/retry`, {}), params(o.id));
    expect(made.status).toBe(201);
    const body = await made.json();
    expect(body).toEqual({ ok: true, href: expect.stringMatching(/^\/billing\/toss\/[0-9a-f-]{36}$/) });
    const fresh = body.href.split('/').pop();
    expect(await row(fresh)).toMatchObject({ status: 'pending' });
    expect(await row(o.id)).toMatchObject({ status: 'failed', retried_by: fresh });
    expect(made.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses an order that has nothing to retry, and a closed sale', async () => {
    const pending = await placed();
    expect((await retry(json(`/api/billing/toss/orders/${pending.id}/retry`, {}), params(pending.id))).status).toBe(409);
    const { o } = await refusedAtApproval();
    gate.mode = 'off';
    expect((await retry(json(`/api/billing/toss/orders/${o.id}/retry`, {}), params(o.id))).status).toBe(403);
  });
});

describe('POST /api/billing/toss/webhook', () => {
  it('is POST only', async () => {
    const response = await webhookGet();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('answers a malformed body and an unknown order with an empty 200, reading nothing at the provider', async () => {
    let reads = 0;
    const retrieve = fake().retrieve;
    fake().retrieve = async (key) => {
      reads += 1;
      return retrieve(key);
    };
    for (const body of ['{', '[]', JSON.stringify({ data: { orderId: 'not-an-order' } }), JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: crypto.randomUUID(), paymentKey: 'unknown', status: 'CANCELED' } })]) {
      const response = await webhook(json('/api/billing/toss/webhook', body, { origin: 'https://api.tosspayments.com' }));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(reads).toBe(0);
  });

  it('learns a console cancellation by reading the payment again, and logs no part of the body', async () => {
    const o = await placed();
    const approved = await confirm(json('/api/billing/toss/confirm', { orderId: o.id, paymentKey: 'k', amount: o.amountKrw }));
    expect(approved.status).toBe(200);
    await fake().cancel({ paymentKey: fake().keyFor(o.id), reason: 'console', idempotencyKey: 'console' });
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    const response = await webhook(
      json(
        '/api/billing/toss/webhook',
        { eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-10-22T00:00:00', data: { orderId: o.id, paymentKey: 'hint_secret_probe', status: 'DONE', secret: 'deposit_secret_probe' } },
        { origin: 'https://api.tosspayments.com' },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(await row(o.id)).toMatchObject({ status: 'refunded' });
    expect(lines.join('\n')).not.toMatch(/hint_secret_probe|deposit_secret_probe|2026-10-22T00:00:00/);
  });

  it('settles a secondary-usage order the template table does not know: a console cancellation goes to review', async () => {
    const f = await usageFixture();
    try {
      mocks.sql.mockResolvedValue(f.sql);
      const usage = { sql: f.sql, gateway: fake(), paymentsOpen: true };
      const { caseId, quoteId } = await f.quoted(330000);
      expect(await acceptUsageQuote(usage, f.owner, { caseId, quoteId, expectedRevision: 3, requestId: crypto.randomUUID(), confirmed: true })).toMatchObject({ ok: true });
      const order = await createUsageOrder(usage, f.owner, { caseId, requestId: crypto.randomUUID(), consent: true });
      if (!order.ok) throw new Error(order.code);
      fake().authorize(order.order.id, 330000);
      const key = fake().keyFor(order.order.id);
      expect(await confirmUsagePayment(usage, f.owner, { orderId: order.order.id, paymentKey: key, amount: 330000 })).toMatchObject({ ok: true, state: 'fulfilled' });
      await fake().cancel({ paymentKey: key, reason: 'console', idempotencyKey: 'console' });
      const lines: string[] = [];
      for (const level of ['log', 'info', 'warn', 'error'] as const)
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
      const response = await webhook(
        json(
          '/api/billing/toss/webhook',
          { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: order.order.id, paymentKey: 'hint_secret_probe', status: 'CANCELED' } },
          { origin: 'https://api.tosspayments.com' },
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
      expect((await f.sql.query('select status from brand_usage_payments where id=$1', [order.order.id])).rows[0]).toEqual({ status: 'review' });
      expect((await f.sql.query('select status from brand_usage_cases where id=$1', [caseId])).rows[0]).toEqual({ status: 'fulfilled' });
      expect(lines.join('\n')).not.toMatch(/hint_secret_probe/);
      expect(lines.join('\n')).toMatch(/"kind":"brand_usage","status":"review"/);
    } finally {
      await f.db.close();
    }
  });

  it('settles a campaign-funding receipt neither other table knows, answering 503 while the provider cannot be read', async () => {
    const admin = viewerOf('admin');
    const funding = { sql: h.sql, gateway: fake(), enabled: true, policyReady: true, production: false };
    const [org, project, campaign] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await h.sql.query('insert into brand_organizations(id,name,created_by,request_id) values($1,$2,$3,$4)', [org, 'Fixture brand', admin.userId, crypto.randomUUID()]);
    await h.sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')", [org, buyer.userId]);
    await h.sql.query(
      "insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'Fixture campaign','Fixture objective','creator','active',true,$3,$4)",
      [project, org, admin.userId, crypto.randomUUID()],
    );
    await h.sql.query(
      "insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots) values($1,$2,'draft',$3::jsonb,$3::jsonb,'Fixture brand',array['instagram'],2)",
      [campaign, `funding-${campaign}`, JSON.stringify({ en: 'Fixture', ko: '픽스처' })],
    );
    await h.sql.query('insert into campaign_collaboration_links(campaign_id,project_id,created_by) values($1,$2,$3)', [campaign, project, admin.userId]);
    const quote = await issueFundingQuote({ sql: h.sql }, admin, {
      campaignId: campaign,
      requestId: crypto.randomUUID(),
      totalKrw: 120000,
      taxBasis: 'Fixture tax basis',
      termsSummary: 'Fixture service scope and refund terms',
      termsRef: 'fixture-v1',
      validUntil: new Date(Date.now() + 86400_000).toISOString(),
    });
    if (!quote.ok) throw new Error(quote.code);
    expect(await acceptFundingQuote(funding, buyer, { quoteId: quote.id, revision: quote.revision, consent: true })).toMatchObject({ ok: true });
    const order = await createFundingOrder(funding, buyer, { caseId: quote.caseId, requestId: crypto.randomUUID() });
    if (!order.ok) throw new Error(order.code);
    fake().authorize(order.order.id, 120000);
    const key = fake().keyFor(order.order.id);
    expect(await confirmFundingPayment(funding, buyer, { orderId: order.order.id, amount: 120000, paymentKey: key })).toMatchObject({ ok: true, state: 'paid' });
    await fake().cancel({ paymentKey: key, reason: 'console', idempotencyKey: 'console' });
    const hint = () =>
      webhook(json('/api/billing/toss/webhook', { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: key, status: 'CANCELED' } }, { origin: 'https://api.tosspayments.com' }));
    const retrieve = fake().retrieve;
    fake().retrieve = async () => {
      throw new TossError('NETWORK_ERROR');
    };
    expect((await hint()).status).toBe(503);
    expect((await h.sql.query('select status from campaign_funding_payments where id=$1', [order.order.id])).rows[0]).toEqual({ status: 'paid' });
    fake().retrieve = retrieve;
    const response = await hint();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect((await h.sql.query('select status from campaign_funding_payments where id=$1', [order.order.id])).rows[0]).toEqual({ status: 'refunded' });
    expect((await h.sql.query('select status from campaign_funding_cases where id=$1', [quote.caseId])).rows[0]).toEqual({ status: 'refunded' });
  });

  it(`takes at most ${TOSS_WEBHOOK_LIMIT.perClient} hints a minute from one sender`, async () => {
    const from = (ip: string) => json('/api/billing/toss/webhook', { data: { orderId: crypto.randomUUID() } }, { 'x-forwarded-for': ip });
    for (let i = 0; i < TOSS_WEBHOOK_LIMIT.perClient; i++) expect((await webhook(from('203.0.113.7'))).status).toBe(200);
    const limited = await webhook(from('203.0.113.7'));
    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe('');
    expect((await webhook(from('198.51.100.4'))).status).toBe(200);
  });
});

describe('GET /api/billing/toss/orders/[id] — the status poll', () => {
  it('settles only the order it names, for its owner, and says why it failed', async () => {
    const mine = await placed();
    const theirs = await placed(other);
    await h.sql.query("update billing_payments set expires_at=now()-interval '1 minute'");
    const response = await status(new NextRequest(`${ORIGIN}/api/billing/toss/orders/${mine.id}`), params(mine.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'failed', reason: 'expired', retry: false, renderId: null });
    expect(await row(theirs.id)).toMatchObject({ status: 'pending' });
    mocks.viewer.mockResolvedValue(other);
    expect((await status(new NextRequest(`${ORIGIN}/api/billing/toss/orders/${mine.id}`), params(mine.id))).status).toBe(404);
  });

  it('offers a retry for a declined order while the sale is open', async () => {
    const { o } = await refusedAtApproval();
    const response = await status(new NextRequest(`${ORIGIN}/api/billing/toss/orders/${o.id}`), params(o.id));
    expect(await response.json()).toMatchObject({ status: 'failed', reason: 'declined', retry: true });
  });
});

describe('POST /api/billing/toss/orders/[id] — the withdrawal consent', () => {
  it('records the first consent and keeps it when the reader opens the window again', async () => {
    const created = await createTossOrder(deps(), buyer, input);
    if (!created.ok) throw new Error(created.code);
    const id = created.order.id;
    expect((await consent(json(`/api/billing/toss/orders/${id}`, { consent: true }), params(id))).status).toBe(200);
    const first = (await row(id)).consent_at;
    expect(first).not.toBeNull();
    await h.sql.query("update billing_payments set consent_at=consent_at-interval '5 minutes' where id=$1", [id]);
    const earlier = (await row(id)).consent_at;
    expect((await consent(json(`/api/billing/toss/orders/${id}`, { consent: true }), params(id))).status).toBe(200);
    expect(new Date((await row(id)).consent_at!).toISOString()).toBe(new Date(earlier!).toISOString());
  });
});

// docs/CAST-CATEGORIES.md §3 — 다시 결제하기 on a person + pet order: the second photo follows the new
// order (copied onto its render_ref), or the retry is refused when that photo is already gone. The solo
// retry above is untouched by this.
describe('POST /api/billing/toss/orders/[id]/retry — a pet order', () => {
  async function petOrder() {
    vi.stubEnv('TWINGS_PET_TEMPLATES', 'on');
    const { insertPrompt } = await import('@/lib/prompts/repo');
    const { storeSlotPhotos } = await import('@/lib/renders/cast-inputs');
    const id = crypto.randomUUID(), slug = `pet-${id.slice(0, 8)}`;
    await insertPrompt(h.sql, { id, slug, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: ['gpt-image-2'], title: 'Pet order', titleKo: null, promptText: 'legacy prompt text', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', priceCents: 500, priceKrw: 6900, cast: 'pet' });
    const recipe = { version: 2, slots: { selfie: { kind: 'image', source: 'user', required: true }, pet: { kind: 'image', source: 'user', required: true, role: 'pet' } }, steps: [{ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie', 'pet'], prompt: '{{selfie}} walks {{pet}} through a quiet park.', params: { aspect: '4:5' } }], output: { from: 'still' } };
    await h.sql.query('update prompt_items set recipe=$2::jsonb where id=$1', [id, JSON.stringify(recipe)]);
    const created = await createTossOrder(deps(), buyer, { ...input, templateSlug: slug });
    if (!created.ok) throw new Error(created.code);
    const ref = (await h.sql.query<{ render_ref: string }>('select render_ref from billing_payments where id=$1', [created.order.id])).rows[0]!.render_ref;
    await storeSlotPhotos(h.sql, createLocalRenderStore(h.root), { renderId: ref, userId: buyer.userId!, templateId: id, photos: { pet: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/jpeg' } }, partnerConsentAt: null, now: new Date() });
    // Refused at approval, the way a real decline arrives (the same path as `refusedAtApproval`).
    await h.sql.query("update billing_payments set consent_at=now(), consent_version='fixture' where id=$1", [created.order.id]);
    const original = fake().confirm;
    fake().confirm = async () => { throw new TossError('HTTP_403', false, 'REJECT_CARD_COMPANY'); };
    mocks.viewer.mockResolvedValue(buyer);
    await confirm(json('/api/billing/toss/confirm', { orderId: created.order.id, paymentKey: 'from-the-window', amount: created.order.amountKrw }));
    fake().confirm = original;
    return { order: created.order, ref };
  }

  it('copies the pet photo onto the new order', async () => {
    const { order, ref } = await petOrder();
    const made = await retry(json(`/api/billing/toss/orders/${order.id}/retry`, {}), params(order.id));
    expect(made.status).toBe(201);
    const fresh = (await made.json()).href.split('/').pop();
    const newRef = (await h.sql.query<{ render_ref: string }>('select render_ref from billing_payments where id=$1', [fresh])).rows[0]!.render_ref;
    expect(newRef).not.toBe(ref);
    const rows = (await h.sql.query<{ storage_key: string }>("select storage_key from render_slot_inputs where render_id=$1 and slot='pet' and deleted_at is null", [newRef])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.storage_key).toBe(`${newRef}/slot-pet.jpg`);
    expect(Array.from(await createLocalRenderStore(h.root).read(rows[0]!.storage_key))).toEqual([1, 2, 3, 4]);
  });

  it('refuses the retry when the pet photo is already gone — the reader starts a new order', async () => {
    const { order, ref } = await petOrder();
    await h.sql.query('update render_slot_inputs set deleted_at=now() where render_id=$1', [ref]);
    const refused = await retry(json(`/api/billing/toss/orders/${order.id}/retry`, {}), params(order.id));
    expect(refused.status).toBe(410);
    expect(await refused.json()).toEqual({ ok: false, code: 'photos_gone' });
    expect(await row(order.id)).toMatchObject({ retried_by: null });
  });
});
