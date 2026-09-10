import { describe, expect, it } from 'vitest';
import { ESCROW, LEGAL_DOCS, businessFooterLines, businessRows, isLegalDoc, legalDocument } from '@/lib/legal/documents';
import { legalHref, legalRest } from '@/lib/legal/links';
import { LOCALES } from '@/lib/i18n/config';
import { buildSitemap } from '@/lib/seo/sitemap';

/**
 * The legal surface exists to pass a payment provider's merchant review and to satisfy
 * 전자상거래법 §21, so what is tested is exactly what a reviewer checks: the three documents exist
 * in both languages, they state the refund rule that governs a per-template payment, they state
 * the likeness standard the reviewer asked about (2026-09-11), the seller block is present, and no
 * trace of the retired stored-value item survives.
 */
describe('legal documents', () => {
  it('has all three documents in both locales, with a title and a body', () => {
    expect(LEGAL_DOCS).toEqual(['terms', 'refund', 'privacy']);
    for (const doc of LEGAL_DOCS) {
      for (const locale of LOCALES) {
        const document = legalDocument(doc, locale);
        expect(document.title.trim(), `${doc}.${locale}`).not.toBe('');
        expect(document.summary.trim(), `${doc}.${locale}`).not.toBe('');
        // Long enough to be a document rather than a placeholder sentence.
        expect(document.body.length, `${doc}.${locale}`).toBeGreaterThan(800);
        expect(document.body, `${doc}.${locale}`).toContain('##');
      }
    }
  });

  it('refuses an unknown document name', () => {
    expect(isLegalDoc('terms')).toBe(true);
    expect(isLegalDoc('cookies')).toBe(false);
    expect(isLegalDoc('../secrets')).toBe(false);
  });

  /**
   * The refund clause is the one a reviewer reads twice, and the one that must match 전자상거래법
   * §17 for made-to-order digital content: 7 days, full refund before rendering starts, withdrawal
   * restricted once delivery has begun (stated at checkout), failure refunded in full.
   */
  it('states the 7-day, before-rendering, delivery-started refund rule in both locales', () => {
    const ko = legalDocument('refund', 'ko').body;
    expect(ko).toContain('7일');
    expect(ko).toContain('청약철회');
    expect(ko).toContain('전자상거래');
    expect(ko).toMatch(/생성이 시작되기 전[^]*?전액 환불/);
    expect(ko).toContain('제17조 제2항 제5호');
    expect(ko).toContain('환불되지 않습니다');

    const en = legalDocument('refund', 'en').body;
    expect(en).toContain('7 days');
    expect(en).toContain('in full');
    expect(en).toContain('Article 17(2)(5)');
    expect(en).toContain('not refundable');
  });

  /** What is sold is one payment per result — no credits, no points, no stored value. */
  it('sells one payment per template and nothing redeemable', () => {
    for (const locale of LOCALES) {
      const refund = legalDocument('refund', locale).body;
      const terms = legalDocument('terms', locale).body;
      expect(terms.toLowerCase()).toMatch(/not a subscription|정기결제가 아닙니다/);
      expect(refund.toLowerCase()).toMatch(/not a subscription|정기결제가 아닌/);
      for (const doc of LEGAL_DOCS) {
        const body = legalDocument(doc, locale).body;
        // The retired credit: the reviewer found it on the old pages, and it must be gone.
        expect(body, `${doc}.${locale}`).not.toMatch(/쿠키 [0-9]+개|유료 쿠키|paid cookies|cookie pack|in-service credit|유료 이용권/);
      }
    }
  });

  /** The standard the PG reviewer asked for (2026-09-11), stated where a reviewer looks. */
  it('states the likeness verification and management standard in the terms and the privacy policy', () => {
    const ko = legalDocument('terms', 'ko').body;
    expect(ko).toContain('본인의 얼굴이 찍힌 사진만');
    expect(ko).toContain('본인 인증을 거친 계정에서만');
    expect(ko).toContain('다른 사람의 얼굴은 생성이 거부');
    expect(ko).toContain('24시간 이내에 검토');
    expect(ko).toContain('미성년자');
    const en = legalDocument('terms', 'en').body;
    expect(en).toContain('only photos of your own face');
    expect(en).toContain('real-person verification');
    expect(en).toContain('within 24 hours');
    // Overseas processing of the photo is a privacy disclosure, not a footnote.
    expect(legalDocument('privacy', 'ko').body).toContain('BytePlus Pte. Ltd.');
    expect(legalDocument('privacy', 'ko').body).toContain('국외 이전');
    expect(legalDocument('privacy', 'en').body).toContain('OpenAI, L.L.C.');
    expect(legalDocument('privacy', 'ko').body).toContain('만 14세 미만');
  });

  it('renders the §21 seller block with the registered company facts', () => {
    for (const locale of LOCALES) {
      const rows = businessRows(locale);
      expect(rows.length).toBe(9);
      for (const [label, value] of rows) {
        expect(label.trim(), label).not.toBe('');
        // An unfilled review blocker must SHOW as a placeholder — never as an empty cell.
        expect(value.trim(), label).not.toBe('');
      }
      const values = rows.map(([, value]) => value).join(' ');
      expect(values).toContain('hello@yagiworkshop.xyz');
      // 등기사항전부증명서 110111-0940868: 대표자, and the head office as registered 2026-05-06.
      expect(values).toContain('윤병삼');
      expect(values).toMatch(/구로|Guro/);
    }
    expect(businessRows('ko').map(([, value]) => value)).toContain('야기워크숍 주식회사');
    // The 양천구 office is struck through on the certificate — a dead address must not survive here.
    expect(businessRows('ko').flat().join(' ')).not.toContain('양천구');
    expect(businessRows('ko').map(([l]) => l)).toContain('사업자등록번호');
    expect(businessRows('en').map(([l]) => l)).toContain('Business registration no.');
    // 전자상거래법 §13 — the escrow (구매안전서비스) enrolment is a DISPLAY duty, not just a filing one.
    expect(businessRows('ko').flat().join(' ')).toContain('KB에스크로');
    expect(businessRows('en').flat().join(' ')).toContain('KB Escrow');
  });

  /** The footer carries the same facts on every page — but never a TODO placeholder to customers. */
  it('gives the footer the seller line without the unfilled mail-order placeholder', () => {
    for (const locale of LOCALES) {
      const lines = businessFooterLines(locale);
      expect(lines).toHaveLength(2);
      const text = lines.join(' ');
      expect(text).toContain('519-81-04213');
      expect(text).toContain('윤병삼');
      expect(text).toContain('hello@yagiworkshop.xyz');
      expect(text).not.toContain('TODO');
      expect(text).not.toContain('양천구');
    }
    expect(businessFooterLines('ko')[0]).toContain('야기워크숍 주식회사');
    expect(businessFooterLines('en')[0]).toContain('YAGI WORKSHOP Inc.');
  });

  it('links the KB escrow mark to the bank-hosted seller-verification page', () => {
    expect(ESCROW.href).toMatch(/^https:\/\/okbfex\.kbstar\.com\/quics\?page=C016760&mHValue=[0-9a-f]{32}$/);
    // The mark image must be https — the bank's own snippet ships http://, which a secure page blocks.
    expect(ESCROW.mark).toMatch(/^https:\/\/img1\.kbstar\.com\//);
  });

  it('addresses every document under one stable path', () => {
    expect(legalRest('terms')).toBe('/legal/terms');
    expect(legalHref('ko', 'privacy')).toBe('/ko/legal/privacy');
  });

  /** A reviewer follows links; a crawler follows the sitemap. Both must reach all three. */
  it('lists every legal document in the sitemap, in both locales', () => {
    const urls = buildSitemap({ origin: 'https://yagiprompts.com', cards: [] }).map((e) => e.url);
    for (const doc of LEGAL_DOCS) {
      for (const locale of LOCALES) {
        expect(urls, `${locale}/${doc}`).toContain(`https://yagiprompts.com/${locale}/legal/${doc}`);
      }
    }
  });
});
