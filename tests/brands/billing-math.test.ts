import { describe, expect, it } from 'vitest';
import {
  BRAND_DISCOUNT_CODE_ALPHABET,
  BRAND_INVOICE_OVERDUE_DAYS,
  BRAND_PLAN_GRACE_DAYS_DEFAULT,
  BRAND_PLAN_PRICES_VAT_EXCLUSIVE,
  daysInYearMonth,
  formatBusinessRegNo,
  invoiceAmounts,
  isAllowedGrantMonth,
  isInvoiceOverdue,
  isValidDiscountCode,
  isValidKoreanBusinessRegNo,
  nextKstMonthOf,
  normalizeBusinessRegNo,
  normalizeDiscountCode,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
  proposeProration,
} from '@/lib/brands/billing/math';

describe('B2B billing invoice math (VAT-exclusive default)', () => {
  it('keeps the VAT-exclusive flag as the single default constant', () => {
    expect(BRAND_PLAN_PRICES_VAT_EXCLUSIVE).toBe(true);
  });

  it('computes 0%, 40%, 100% discounts and 10% VAT using floor integers only', () => {
    expect(invoiceAmounts({ listKrw: 290_000, discountPct: 0 })).toEqual({
      baseListKrw: 290_000,
      listKrw: 290_000,
      discountPct: 0,
      discountKrw: 0,
      supplyKrw: 290_000,
      vatKrw: 29_000,
      totalKrw: 319_000,
      proratedDays: null,
      periodDays: null,
    });

    expect(invoiceAmounts({ listKrw: 490_000, discountPct: 40 })).toEqual({
      baseListKrw: 490_000,
      listKrw: 490_000,
      discountPct: 40,
      discountKrw: 196_000,
      supplyKrw: 294_000,
      vatKrw: 29_400,
      totalKrw: 323_400,
      proratedDays: null,
      periodDays: null,
    });

    expect(invoiceAmounts({ listKrw: 690_000, discountPct: 100 })).toEqual({
      baseListKrw: 690_000,
      listKrw: 690_000,
      discountPct: 100,
      discountKrw: 690_000,
      supplyKrw: 0,
      vatKrw: 0,
      totalKrw: 0,
      proratedDays: null,
      periodDays: null,
    });
  });

  it('handles 1 KRW, 0 KRW, and never produces negative or fractional amounts', () => {
    expect(invoiceAmounts({ listKrw: 1, discountPct: 0 })).toMatchObject({
      listKrw: 1,
      discountKrw: 0,
      supplyKrw: 1,
      vatKrw: 0,
      totalKrw: 1,
    });
    expect(invoiceAmounts({ listKrw: 1, discountPct: 50 })).toMatchObject({
      listKrw: 1,
      discountKrw: 0,
      supplyKrw: 1,
      vatKrw: 0,
      totalKrw: 1,
    });
    expect(invoiceAmounts({ listKrw: 1, discountPct: 100 })).toMatchObject({
      listKrw: 1,
      discountKrw: 1,
      supplyKrw: 0,
      vatKrw: 0,
      totalKrw: 0,
    });
    expect(invoiceAmounts({ listKrw: 0, discountPct: 40 })).toMatchObject({
      listKrw: 0,
      discountKrw: 0,
      supplyKrw: 0,
      vatKrw: 0,
      totalKrw: 0,
    });
    for (const amount of [0, 1, 9, 15, 290_000]) {
      for (const pct of [0, 1, 33, 40, 99, 100]) {
        const res = invoiceAmounts({ listKrw: amount, discountPct: pct, prorate: { usedDays: 7, totalDays: 30 } });
        for (const n of [res.listKrw, res.discountKrw, res.supplyKrw, res.vatKrw, res.totalKrw]) {
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
        }
        expect(res.totalKrw).toBe(res.supplyKrw + res.vatKrw);
      }
    }
  });

  it('applies proration BEFORE discount on first/last day boundaries', () => {
    // First day of 30-day month -> full month
    expect(
      invoiceAmounts({ listKrw: 290_000, discountPct: 40, prorate: { usedDays: 30, totalDays: 30 } }),
    ).toMatchObject({
      baseListKrw: 290_000,
      listKrw: 290_000,
      discountKrw: 116_000,
      supplyKrw: 174_000,
      vatKrw: 17_400,
      totalKrw: 191_400,
      proratedDays: 30,
      periodDays: 30,
    });

    // Last day of 30-day month -> floor(290000 * 1 / 30) = 9666, discount = floor(9666 * 40 / 100) = 3866,
    // supply = 5800, vat = floor(5800 * 10 / 100) = 580, total = 6380
    expect(
      invoiceAmounts({ listKrw: 290_000, discountPct: 40, prorate: { usedDays: 1, totalDays: 30 } }),
    ).toMatchObject({
      baseListKrw: 290_000,
      listKrw: 9_666,
      discountKrw: 3_866,
      supplyKrw: 5_800,
      vatKrw: 580,
      totalKrw: 6_380,
      proratedDays: 1,
      periodDays: 30,
    });

    // Last day with 1 KRW list -> prorated 0 KRW
    expect(
      invoiceAmounts({ listKrw: 1, discountPct: 10, prorate: { usedDays: 1, totalDays: 31 } }),
    ).toMatchObject({
      listKrw: 0,
      discountKrw: 0,
      supplyKrw: 0,
      vatKrw: 0,
      totalKrw: 0,
    });
  });

  it('rejects out-of-range invoiceAmount inputs', () => {
    expect(() => invoiceAmounts({ listKrw: -1 })).toThrow();
    expect(() => invoiceAmounts({ listKrw: 100, discountPct: 101 })).toThrow();
    expect(() => invoiceAmounts({ listKrw: 100, discountPct: -1 })).toThrow();
    expect(() => invoiceAmounts({ listKrw: 100, prorate: { usedDays: 31, totalDays: 30 } })).toThrow();
  });

  it('proposes proration only for mid-month starts in the target period', () => {
    expect(daysInYearMonth('2024-02')).toBe(29);
    expect(daysInYearMonth('2026-02')).toBe(28);
    expect(daysInYearMonth('2026-11')).toBe(30);
    expect(proposeProration('2026-11-01', '2026-11')).toBeNull();
    expect(proposeProration('2026-10-15', '2026-11')).toBeNull();
    expect(proposeProration('2026-11-11', '2026-11')).toEqual({ usedDays: 20, totalDays: 30 });
    expect(proposeProration('2026-11-30', '2026-11')).toEqual({ usedDays: 1, totalDays: 30 });
    expect(proposeProration('2024-02-20', '2024-02')).toEqual({ usedDays: 10, totalDays: 29 });
  });
});

describe('Korean business registration number checksum & discount code format', () => {
  it('validates synthetic 10-digit Korean business registration numbers', () => {
    expect(isValidKoreanBusinessRegNo('111-11-11119')).toBe(true);
    expect(isValidKoreanBusinessRegNo('1111111119')).toBe(true);
    expect(isValidKoreanBusinessRegNo('123-45-67891')).toBe(true);
    expect(isValidKoreanBusinessRegNo('123-45-67890')).toBe(false);
    expect(isValidKoreanBusinessRegNo('000-00-00000')).toBe(false);
    expect(isValidKoreanBusinessRegNo('123456789')).toBe(false);
    expect(isValidKoreanBusinessRegNo('12345678901')).toBe(false);
    expect(isValidKoreanBusinessRegNo('abc-de-fghij')).toBe(false);
    expect(normalizeBusinessRegNo('111-11-11119')).toBe('1111111119');
    expect(formatBusinessRegNo('1111111119')).toBe('111-11-11119');
  });

  it('normalizes and validates discount codes (10-24 A-Z, 0-9, hyphen)', () => {
    expect(normalizeDiscountCode(' spring-40-2026 ')).toBe('SPRING-40-2026');
    expect(isValidDiscountCode('spring-40-2026')).toBe(true);
    expect(isValidDiscountCode('A1B2C3D4E5')).toBe(true);
    expect(isValidDiscountCode('A1B2C3D4E')).toBe(false);
    expect(isValidDiscountCode('SHORT')).toBe(false);
    expect(isValidDiscountCode('A'.repeat(25))).toBe(false);
    expect(isValidDiscountCode('BAD_CODE')).toBe(false);
  });
});

describe('plan grace period & overdue calculation', () => {
  it('honors default 7 grace days after endsOn', () => {
    expect(BRAND_PLAN_GRACE_DAYS_DEFAULT).toBe(7);
    const plan = { startedOn: '2026-10-01', endsOn: '2026-11-10' };
    expect(planActiveWithGrace(plan, '2026-09-30')).toEqual({ active: false, inGrace: false });
    expect(planActiveWithGrace(plan, '2026-11-09')).toEqual({ active: true, inGrace: false });
    expect(planActiveWithGrace(plan, '2026-11-10')).toEqual({ active: true, inGrace: true });
    expect(planActiveWithGrace(plan, '2026-11-17')).toEqual({ active: true, inGrace: true });
    expect(planActiveWithGrace(plan, '2026-11-18')).toEqual({ active: false, inGrace: false });
    expect(planActiveWithGrace(plan, '2026-11-10', 0)).toEqual({ active: false, inGrace: false });
    expect(planActiveWithGrace(plan, '2026-11-24', 14)).toEqual({ active: true, inGrace: true });
  });

  it('marks issued invoices older than 14 days as overdue', () => {
    expect(BRAND_INVOICE_OVERDUE_DAYS).toBe(14);
    const now = new Date('2026-11-23T00:00:00Z');
    const exactly14d = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const over14d = new Date(now.getTime() - 14 * 86_400_000 - 1).toISOString();
    expect(isInvoiceOverdue({ status: 'draft', issuedAt: over14d }, now)).toBe(false);
    expect(isInvoiceOverdue({ status: 'paid', issuedAt: over14d }, now)).toBe(false);
    expect(isInvoiceOverdue({ status: 'void', issuedAt: over14d }, now)).toBe(false);
    expect(isInvoiceOverdue({ status: 'issued', issuedAt: exactly14d }, now)).toBe(false);
    expect(isInvoiceOverdue({ status: 'issued', issuedAt: over14d }, now)).toBe(true);
  });

  it('validates allowed grant months across year boundaries and paid plan default list', () => {
    expect(PAID_BRAND_PLAN_IDS).toEqual(['b2b_29', 'b2b_49', 'b2b_69']);
    expect(BRAND_DISCOUNT_CODE_ALPHABET).toHaveLength(31);
    const decKst = new Date('2026-12-31T14:59:59Z'); // 2026-12-31 23:59:59 KST
    expect(nextKstMonthOf(decKst)).toBe('2027-01');
    expect(isAllowedGrantMonth('2026-12', decKst)).toBe(true);
    expect(isAllowedGrantMonth('2027-01', decKst)).toBe(true);
    expect(isAllowedGrantMonth('2027-02', decKst)).toBe(false);
    expect(isAllowedGrantMonth('2026-11', decKst)).toBe(false);
  });
});
