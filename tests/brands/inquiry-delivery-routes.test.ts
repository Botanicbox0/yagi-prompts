import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Mailer } from '@/lib/notify/mailer';
import { freshDb, runner } from '@/tests/helpers/pglite';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null, mailer: null as Mailer | null, after: [] as Array<() => Promise<void>>,
  delivery: vi.fn().mockResolvedValue({ configuration: 'unconfigured', claimed: 0, sent: 0, uncertain: 0, failed: 0 }),
}));
vi.mock('next/server', async original => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => Promise<void>) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => null }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => mocks.mailer }));
vi.mock('@/lib/brands/slack-runtime', () => ({ runLiveBrandInquiryDelivery: mocks.delivery }));
const { POST } = await import('@/app/api/brands/inquiries/route');
const { GET: tick } = await import('@/app/api/brands/inquiries/tick/route');
const { GET: resultPage } = await import('@/app/api/brands/inquiries/result/route');

const good = {
  requestId: '8dc7926f-2a98-4b6c-84f6-341293229b75', company: 'Company', contactName: 'Name',
  email: 'inquiry@example.test', budgetBand: 'undecided', message: 'Please discuss our campaign.',
  consent: true, locale: 'en', inquiryType: 'production', useCase: 'launch',
};
const request = (body = good) => new Request('https://twings.app/api/brands/inquiries', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('inquiry delivery API boundaries', () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(); });
  beforeEach(async () => {
    mocks.sql = runner(db); mocks.mailer = null; mocks.after = [];
    mocks.delivery.mockClear(); mocks.delivery.mockResolvedValue({ configuration: 'unconfigured', claimed: 0, sent: 0, uncertain: 0, failed: 0 });
    await mocks.sql.query('delete from brand_inquiries');
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await db.close(); });

  it('reports DB acceptance regardless of Slack configuration, and runs delivery only after acceptance', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, receipt: false, id: expect.any(String) });
    expect(mocks.delivery).not.toHaveBeenCalled();
    expect((await mocks.sql!.query('select status from brand_inquiry_deliveries')).rows).toEqual([{ status: 'pending' }]);
    await mocks.after[0]!();
    expect(mocks.delivery).toHaveBeenCalledOnce();
  });

  it('replays a stored receipt without another inquiry, studio email or Slack attempt', async () => {
    const send = vi.fn<Mailer['send']>().mockResolvedValue({ ok: true, id: 'mail-id' });
    mocks.mailer = { kind: 'fake', from: 'fixture@example.test', send };
    const original = await (await POST(request())).json();
    expect(original).toEqual({ ok: true, receipt: true, id: expect.any(String) });
    await mocks.after[0]!();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await (await POST(request({ ...good, company: 'Changed Company', email: 'different@example.test', message: 'A changed body must not replace the accepted inquiry.' }))).json()).toEqual(original);
    expect(mocks.after).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(mocks.delivery).toHaveBeenCalledOnce();
    expect((await mocks.sql!.query('select id from brand_inquiries')).rows).toHaveLength(1);
    expect((await mocks.sql!.query('select company, email, message from brand_inquiries')).rows).toEqual([{ company: good.company, email: good.email, message: good.message }]);
  });

  it('a plain form reaches a server-rendered receipt with no JavaScript or personal data', async () => {
    const body = new URLSearchParams(Object.entries(good).map(([key, value]) => [key, String(value)]));
    const response = await POST(new Request('https://twings.app/api/brands/inquiries', { method: 'POST', body }));
    expect(response.status).toBe(303);
    const id = (await mocks.sql!.query<{ id: string }>('select id from brand_inquiries')).rows[0]!.id;
    const location = response.headers.get('location')!;
    expect(location).toBe(`https://twings.app/api/brands/inquiries/result?locale=en&outcome=sent&id=${id}`);
    const page = await resultPage(new Request(location));
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await page.text();
    expect(html).toContain('Enquiry received.');
    expect(html).toContain(id);
    expect(html).toContain('href="/en/brands#brands"');
    expect(html).not.toContain('<script');
    for (const value of [good.email, good.message, good.company, good.contactName]) expect(html).not.toContain(value);
  });

  it('accepts the empty hidden requestId before hydration while retaining UUID validation', async () => {
    const body = new URLSearchParams(Object.entries({ ...good, requestId: '' }).map(([key, value]) => [key, String(value)]));
    const response = await POST(new Request('https://twings.app/api/brands/inquiries', { method: 'POST', body }));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).searchParams.get('outcome')).toBe('sent');
    const rejected = await POST(request({ ...good, requestId: 'not-a-uuid' }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ ok: false, code: 'invalid', field: 'requestId' });
  });

  it('renders localized no-JS errors and a return link without reflecting query content', async () => {
    const page = await resultPage(new Request('https://twings.app/api/brands/inquiries/result?locale=ko&outcome=invalid&field=%3Cscript%3E&id=%3Cscript%3E'));
    expect(page.status).toBe(400);
    const html = await page.text();
    expect(html).toContain('입력 내용을 확인한 뒤 다시 보내 주세요.');
    expect(html).toContain('href="/ko/brands#brands"');
    expect(html).not.toContain('<script>');
  });

  it('does not manufacture a receipt for an unknown UUID or claim an email from a query flag', async () => {
    const missing = await resultPage(new Request('https://twings.app/api/brands/inquiries/result?locale=en&outcome=sent&id=88888888-8888-4888-8888-888888888888'));
    expect(missing.status).toBe(503);
    expect(await missing.text()).not.toContain('Enquiry received.');
    const accepted = await (await POST(request())).json();
    const page = await resultPage(new Request(`https://twings.app/api/brands/inquiries/result?locale=en&outcome=sent&id=${accepted.id}&receipt=1`));
    expect(await page.text()).not.toContain('A confirmation email is on its way');
  });

  it('fails closed for recovery without a configured secret and with missing or incorrect authorization', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await tick(new Request('https://twings.app/api/brands/inquiries/tick'))).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'fixture-cron-secret');
    expect((await tick(new Request('https://twings.app/api/brands/inquiries/tick'))).status).toBe(401);
    expect((await tick(new Request('https://twings.app/api/brands/inquiries/tick', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it('returns only delivery counters after private recovery authorization; does not expose thrown details', async () => {
    vi.stubEnv('CRON_SECRET', 'fixture-cron-secret');
    const authorized = () => new Request('https://twings.app/api/brands/inquiries/tick', { headers: { authorization: 'Bearer fixture-cron-secret' } });
    const response = await tick(authorized());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ ok: true, report: { configuration: 'unconfigured' } });
    mocks.delivery.mockRejectedValueOnce(new Error('secret=https://hooks.slack.com/services/test-secret'));
    const failed = await tick(authorized());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, code: 'unavailable' });
  });

  it('does not report success when durable inquiry storage failed', async () => {
    mocks.sql = { query: async () => { throw new Error('private DB detail'); }, transaction: async () => { throw new Error('unused'); } };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'unavailable' });
    expect(mocks.after).toHaveLength(0);
  });
});
