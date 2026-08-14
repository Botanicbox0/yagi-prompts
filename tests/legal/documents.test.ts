import { describe, expect, it } from 'vitest';
import { LEGAL_DOCS, businessRows, isLegalDoc, legalDocument } from '@/lib/legal/documents';
import { legalHref, legalRest } from '@/lib/legal/links';
import { LOCALES } from '@/lib/i18n/config';
import { PACK_COOKIES, PACK_PRICE_USD, SIGNUP_COOKIES, WEEKLY_COOKIES } from '@/lib/cookies/wallet';
import { buildSitemap } from '@/lib/seo/sitemap';

/**
 * The legal surface exists to pass a payment provider's merchant review and to satisfy
 * 전자상거래법 §21, so what is tested is exactly what a reviewer checks: the three documents exist
 * in both languages, they state the refund rule that actually governs a cookie purchase, the seller
 * block is present, and the money facts match the code that charges.
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
   * §17: 7 days, full refund while unused, PRO RATA on a partly spent pack (cookies are spent one
   * at a time, so the pack is 가분적), and no refund for a cookie already spent.
   */
  it('states the 7-day, pro-rata, spent-is-final refund rule in both locales', () => {
    const ko = legalDocument('refund', 'ko').body;
    expect(ko).toContain('7일');
    expect(ko).toContain('청약철회');
    expect(ko).toContain('전자상거래');
    expect(ko).toMatch(/사용하지 않은 쿠키[^]*?환불/);
    expect(ko).toContain('환불되지 않습니다');

    const en = legalDocument('refund', 'en').body;
    expect(en).toContain('7 days');
    expect(en).toContain('pro rata');
    expect(en).toContain('not refundable');
  });

  /** The policy cannot drift from the wallet: the figures are interpolated, not retyped. */
  it('quotes the same money the code charges', () => {
    for (const locale of LOCALES) {
      const refund = legalDocument('refund', locale).body;
      const terms = legalDocument('terms', locale).body;
      expect(refund).toContain(`$${PACK_PRICE_USD}`);
      expect(refund).toContain(String(PACK_COOKIES));
      expect(refund).toContain(String(SIGNUP_COOKIES));
      expect(refund).toContain(String(WEEKLY_COOKIES));
      // …and the terms say it is not a subscription, which is the founder's whole pricing decision.
      expect(terms.toLowerCase()).toMatch(/not a subscription|정기결제가 아닙니다/);
    }
  });

  it('renders the §21 seller block, and shows unfilled fields rather than hiding them', () => {
    for (const locale of LOCALES) {
      const rows = businessRows(locale);
      const labels = rows.map(([label]) => label).join(' ');
      const values = rows.map(([, value]) => value).join(' ');
      expect(rows.length).toBe(8);
      expect(values).toContain('hello@yagiworkshop.xyz');
      // The founder-only facts are visible placeholders — an unfilled review blocker must SHOW.
      expect(values).toContain('TODO');
      expect(labels.length).toBeGreaterThan(0);
    }
    expect(businessRows('ko').map(([l]) => l)).toContain('사업자등록번호');
    expect(businessRows('en').map(([l]) => l)).toContain('Business registration no.');
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
