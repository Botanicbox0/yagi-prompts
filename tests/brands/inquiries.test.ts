import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, runner } from '@/tests/helpers/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { EmailMessage, Mailer, SendOutcome } from '@/lib/notify/mailer';
import { countBrandInquiries, listBrandInquiries, loadBrandInquiry, updateBrandInquiryStatus } from '@/lib/brands/repo';
import { notifyBrandInquiry, submitBrandInquiry } from '@/lib/brands/service';
import { BRAND_INQUIRIES_PER_DAY } from '@/lib/brands/schemas';

/**
 * The brand enquiry form's service (2026-09-11) against a real PGlite: validation names the field,
 * the honeypot is swallowed, the per-address cap holds, the studio's bookkeeping stamps the moment
 * someone wrote back, and the two mails carry distinct idempotency keys in the right language.
 */

const good = {
  company: 'ROYAL & CO.',
  contactName: '김담당',
  email: 'Brand@Example.com',
  phone: '',
  budgetBand: '3m_10m',
  templateSlug: 'neon-alley-dolly',
  timing: '10월 중순',
  message: '네온 골목 템플릿으로 릴스 캠페인을 열고 싶습니다. 참고: https://example.com',
  consent: true,
  locale: 'ko',
  website: '',
};

function capturingMailer(): { mailer: Mailer; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const mailer: Mailer = {
    kind: 'fake',
    from: 'hello@twings.test',
    async send(message): Promise<SendOutcome> {
      sent.push(message);
      return { ok: true, id: `m${sent.length}` };
    },
  };
  return { mailer, sent };
}

describe('brand enquiries', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it('names the field that is wrong instead of a generic no', async () => {
    const bad = await submitBrandInquiry({ sql }, { ...good, email: 'not-an-address' }, null);
    expect(bad).toEqual({ ok: false, code: 'invalid', field: 'email' });
    const unchecked = await submitBrandInquiry({ sql }, { ...good, consent: false }, null);
    expect(unchecked).toEqual({ ok: false, code: 'invalid', field: 'consent' });
    const short = await submitBrandInquiry({ sql }, { ...good, message: 'hi' }, null);
    expect(short).toEqual({ ok: false, code: 'invalid', field: 'message' });
    expect(await countBrandInquiries(sql, 'new')).toBe(0);
  });

  it('says yes to a filled honeypot and stores nothing', async () => {
    const result = await submitBrandInquiry({ sql }, { ...good, website: 'http://spam.example' }, null);
    expect(result).toEqual({ ok: true, inquiry: null });
    expect(await countBrandInquiries(sql, 'new')).toBe(0);
  });

  it('stores a real enquiry, lower-cases the address, and blanks the optional lines', async () => {
    const result = await submitBrandInquiry({ sql }, good, null);
    expect(result.ok).toBe(true);
    if (!result.ok || result.inquiry === null) throw new Error('expected a stored enquiry');
    expect(result.inquiry.email).toBe('brand@example.com');
    expect(result.inquiry.phone).toBeNull();
    expect(result.inquiry.status).toBe('new');
    expect(result.inquiry.templateSlug).toBe('neon-alley-dolly');
    const listed = await listBrandInquiries(sql, { statuses: ['new'], limit: 10 });
    expect(listed.map((q) => q.id)).toEqual([result.inquiry.id]);
  });

  it('caps one address at three enquiries per rolling day', async () => {
    for (let i = 0; i < BRAND_INQUIRIES_PER_DAY; i += 1) {
      const result = await submitBrandInquiry({ sql }, { ...good, message: `${good.message} #${i}` }, null);
      expect(result.ok).toBe(true);
    }
    const fourth = await submitBrandInquiry({ sql }, good, null);
    expect(fourth).toEqual({ ok: false, code: 'rate_limited' });
    // A different address is a different brand.
    const other = await submitBrandInquiry({ sql }, { ...good, email: 'other@example.com' }, null);
    expect(other.ok).toBe(true);
    // And yesterday's three do not count against today.
    const later = await submitBrandInquiry({ sql, now: new Date(Date.now() + 25 * 60 * 60 * 1000) }, good, null);
    expect(later.ok).toBe(true);
  });

  it('stamps contacted_at the first time an enquiry leaves new, and keeps it when closed', async () => {
    const result = await submitBrandInquiry({ sql }, good, null);
    if (!result.ok || result.inquiry === null) throw new Error('expected a stored enquiry');
    const id = result.inquiry.id;
    expect(await updateBrandInquiryStatus(sql, id, 'contacted')).toBe(true);
    const contacted = await loadBrandInquiry(sql, id);
    expect(contacted?.status).toBe('contacted');
    expect(contacted?.contactedAt).not.toBeNull();
    expect(await updateBrandInquiryStatus(sql, id, 'closed')).toBe(true);
    const closed = await loadBrandInquiry(sql, id);
    expect(closed?.status).toBe('closed');
    expect(closed?.contactedAt).toBe(contacted?.contactedAt);
    expect(await updateBrandInquiryStatus(sql, '00000000-0000-4000-8000-000000000000', 'closed')).toBe(false);
    expect(await listBrandInquiries(sql, { statuses: ['new', 'contacted'], limit: 10 })).toEqual([]);
  });

  it('sends the studio an alert and the brand a receipt in their language, each idempotent on its own key', async () => {
    const result = await submitBrandInquiry({ sql }, good, null);
    if (!result.ok || result.inquiry === null) throw new Error('expected a stored enquiry');
    const { mailer, sent } = capturingMailer();
    const outcome = await notifyBrandInquiry({ mailer, siteUrl: 'https://twings.app/', siteName: 'TWINGS' }, result.inquiry);
    expect(outcome.studio?.ok).toBe(true);
    expect(outcome.brand?.ok).toBe(true);
    expect(sent).toHaveLength(2);
    const [studio, brand] = sent;
    expect(studio?.to).toBe('hello@yagiworkshop.xyz');
    expect(studio?.subject).toContain('ROYAL & CO.');
    expect(studio?.text).toContain('https://twings.app/admin/inquiries');
    expect(studio?.html).toContain('ROYAL &amp; CO.');
    expect(brand?.to).toBe('brand@example.com');
    expect(brand?.subject).toContain('의뢰');
    expect(brand?.text).toContain('1영업일');
    expect(new Set([studio?.idempotencyKey, brand?.idempotencyKey]).size).toBe(2);
    expect(studio?.idempotencyKey).toBe(`brand-inquiry:${result.inquiry.id}:studio`);
  });

  it('answers in English when the brand wrote in English, and skips mail with no mailer', async () => {
    const result = await submitBrandInquiry({ sql }, { ...good, locale: 'en', email: 'en@example.com' }, null);
    if (!result.ok || result.inquiry === null) throw new Error('expected a stored enquiry');
    const { mailer, sent } = capturingMailer();
    await notifyBrandInquiry({ mailer, siteUrl: 'https://twings.app', siteName: 'TWINGS' }, result.inquiry);
    expect(sent[1]?.subject).toContain('enquiry');
    expect(sent[1]?.text).toContain('one business day');
    expect(await notifyBrandInquiry({ mailer: null, siteUrl: 'https://twings.app', siteName: 'TWINGS' }, result.inquiry)).toEqual({ studio: null, brand: null });
  });
});
