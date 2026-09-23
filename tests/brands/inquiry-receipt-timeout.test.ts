import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb, runner } from '@/tests/helpers/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { EmailMessage, Mailer } from '@/lib/notify/mailer';

/**
 * Release review L3: the brand enquiry form waits for its receipt inside the request. A slow or
 * failing provider must end in a stored enquiry, a success answer, and `receipt: false` — never a
 * hung form. The live mailer receives a real AbortSignal that fires at the deadline.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, mailer: null as Mailer | null }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: null, email: null, isAdmin: false, tier: 'anonymous', locale: 'ko' }) }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => mocks.mailer }));

const { POST } = await import('@/app/api/brands/inquiries/route');
const { sendBrandInquiryReceipt, submitBrandInquiry, BRAND_RECEIPT_TIMEOUT_MS } = await import('@/lib/brands/service');
const { countBrandInquiries } = await import('@/lib/brands/repo');

const good = {
  company: 'Fixture Co.', contactName: '담당자', email: 'brand@example.test', phone: '', budgetBand: '3m_10m',
  templateSlug: '', timing: '10월', message: '캠페인 문의입니다. 일정과 예산을 상의하고 싶습니다.', consent: true, locale: 'ko', website: '',
};
const deps = { siteUrl: 'https://twings.app', siteName: 'TWINGS' };
function hanging(seen: EmailMessage[]): Mailer {
  return { kind: 'fake', from: 'x@twings.test', send: (m) => { seen.push(m); return new Promise(() => {}); } };
}

describe('brand enquiry receipt deadline', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDb(); mocks.sql = runner(db); });
  afterEach(async () => { vi.useRealTimers(); await db.close(); });

  it('uses a short, bounded default', () => {
    expect(BRAND_RECEIPT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BRAND_RECEIPT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('gives up at the deadline, aborts the send, and reports no receipt', async () => {
    const result = await submitBrandInquiry({ sql: mocks.sql! }, good, null);
    if (!result.ok || result.inquiry === null) throw new Error('expected a stored enquiry');
    const seen: EmailMessage[] = [];
    const started = Date.now();
    expect(await sendBrandInquiryReceipt({ ...deps, mailer: hanging(seen) }, result.inquiry, 30)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.signal?.aborted).toBe(true);
  });

  it('a send that honours the signal and rejects is also just "no receipt"', async () => {
    const result = await submitBrandInquiry({ sql: mocks.sql! }, good, null);
    if (!result.ok || result.inquiry === null) throw new Error('expected a stored enquiry');
    const aborting: Mailer = {
      kind: 'fake', from: 'x@twings.test',
      send: (m) => new Promise((_, reject) => m.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    };
    expect(await sendBrandInquiryReceipt({ ...deps, mailer: aborting }, result.inquiry, 30)).toBe(false);
  });

  it('the form still succeeds and the enquiry is stored when the provider hangs or rejects', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.mailer = hanging([]);
    const request = () => new Request('https://twings.app/api/brands/inquiries', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(good),
    });
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(BRAND_RECEIPT_TIMEOUT_MS + 10);
    const hung = await pending;
    expect(hung.status).toBe(201);
    expect(await hung.json()).toEqual({ ok: true, receipt: false });
    vi.useRealTimers();

    mocks.mailer = { kind: 'fake', from: 'x@twings.test', send: async () => { throw new Error('provider down'); } };
    const rejected = await POST(request());
    expect(await rejected.json()).toEqual({ ok: true, receipt: false });
    expect(await countBrandInquiries(mocks.sql!, 'new')).toBe(2);
  });
});
