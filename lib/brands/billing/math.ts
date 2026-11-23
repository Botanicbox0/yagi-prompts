/**
 * Pure B2B billing arithmetic, calendar helpers and validation (client-safe: no env, no db).
 */

/**
 * Founder decision pending: whether published B2B plan prices (290k / 490k / 690k KRW) are VAT-exclusive.
 * Default is VAT-exclusive (supply = list - discount, VAT = floor(supply * 10 / 100)).
 * Keep in this ONE constant so flipping it adjusts all invoice calculations consistently.
 */
export const BRAND_PLAN_PRICES_VAT_EXCLUSIVE = true as const;
export const BRAND_INVOICE_VAT_PERCENT = 10 as const;
export const BRAND_INVOICE_OVERDUE_DAYS = 14 as const;
export const BRAND_PLAN_GRACE_DAYS_DEFAULT = 7 as const;

export const PAID_BRAND_PLAN_IDS = ['b2b_29', 'b2b_49', 'b2b_69'] as const;
export type PaidBrandPlanId = (typeof PAID_BRAND_PLAN_IDS)[number];

export const BRAND_DISCOUNT_CODE_PATTERN = /^[A-Z0-9-]{10,24}$/;
export const BRAND_DISCOUNT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ' as const;
export const BRAND_DISCOUNT_AUTO_CODE_LENGTH = 12 as const;
export const BRAND_DISCOUNT_ATTEMPTS_LIMIT = 5 as const;
export const BRAND_DISCOUNT_ATTEMPTS_WINDOW_MINUTES = 10 as const;
export const BRAND_DISCOUNT_USER_ATTEMPTS_LIMIT = 10 as const;
export const BRAND_DISCOUNT_USER_ATTEMPTS_WINDOW_MINUTES = 60 as const;

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Current KST calendar day as `YYYY-MM-DD`. */
export function kstDayOf(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Current KST calendar month as `YYYY-MM`. */
export function kstMonthOf(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7);
}

/** Next KST calendar month as `YYYY-MM`. */
export function nextKstMonthOf(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const monthIdx = kst.getUTCMonth();
  const nextYear = monthIdx === 11 ? year + 1 : year;
  const nextMonth = monthIdx === 11 ? 1 : monthIdx + 2;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/** Extra credit grants apply strictly to the current or next KST calendar month. */
export function isAllowedGrantMonth(month: string, now: Date = new Date()): boolean {
  if (!MONTH_PATTERN.test(month)) return false;
  return month === kstMonthOf(now) || month === nextKstMonthOf(now);
}

export function isValidCalendarDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function isValidYearMonth(period: string): boolean {
  return MONTH_PATTERN.test(period);
}

/** Number of calendar days in a `YYYY-MM` period (28–31). */
export function daysInYearMonth(period: string): number {
  const m = MONTH_PATTERN.exec(period);
  if (!m) throw new RangeError(`invalid period: ${period}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addCalendarDays(day: string, deltaDays: number): string {
  if (!isValidCalendarDay(day) || !Number.isInteger(deltaDays)) {
    throw new RangeError(`invalid calendar day addition: ${day}, ${deltaDays}`);
  }
  const ms = Date.parse(`${day}T00:00:00Z`) + deltaDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole calendar days from `earlierDay` to `laterDay` (`laterDay - earlierDay`). */
export function diffCalendarDays(laterDay: string, earlierDay: string): number {
  if (!isValidCalendarDay(laterDay) || !isValidCalendarDay(earlierDay)) {
    throw new RangeError(`invalid calendar day diff: ${laterDay}, ${earlierDay}`);
  }
  return Math.round((Date.parse(`${laterDay}T00:00:00Z`) - Date.parse(`${earlierDay}T00:00:00Z`)) / 86_400_000);
}

/**
 * Whether an organization's plan assignment is active on `todayKst` (`YYYY-MM-DD`), honoring
 * `graceDays` (default 7) after `endsOn`. A plan whose `endsOn` passed more than `graceDays` days
 * ago counts as inactive (`active: false`).
 */
export function planActiveWithGrace(
  plan: { startedOn: string; endsOn: string | null } | null,
  todayKst: string,
  graceDays: number = BRAND_PLAN_GRACE_DAYS_DEFAULT,
): { active: boolean; inGrace: boolean } {
  if (!plan) return { active: false, inGrace: false };
  if (plan.startedOn > todayKst) return { active: false, inGrace: false };
  if (plan.endsOn === null || todayKst < plan.endsOn) return { active: true, inGrace: false };
  const safeGrace = Number.isInteger(graceDays) && graceDays > 0 ? graceDays : 0;
  if (safeGrace === 0) return { active: false, inGrace: false };
  const elapsed = diffCalendarDays(todayKst, plan.endsOn);
  const active = elapsed <= safeGrace;
  return { active, inGrace: active };
}

export interface InvoiceProrateInput {
  usedDays: number;
  totalDays: number;
}

export interface InvoiceAmountsInput {
  listKrw: number;
  discountPct?: number;
  prorate?: InvoiceProrateInput | null;
}

export interface InvoiceAmountsResult {
  baseListKrw: number;
  listKrw: number;
  discountPct: number;
  discountKrw: number;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  proratedDays: number | null;
  periodDays: number | null;
}

/**
 * Compute integer-only invoice amounts from plan list price, optional first-month proration (applied
 * BEFORE discount), and discount percentage. All amounts are non-negative integers.
 */
export function invoiceAmounts(input: InvoiceAmountsInput): InvoiceAmountsResult {
  const { listKrw, discountPct = 0, prorate = null } = input;
  if (!Number.isInteger(listKrw) || listKrw < 0) {
    throw new RangeError('listKrw must be a non-negative integer');
  }
  if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new RangeError('discountPct must be an integer between 0 and 100');
  }

  let effectiveListKrw = listKrw;
  let proratedDays: number | null = null;
  let periodDays: number | null = null;

  if (prorate !== null && prorate !== undefined) {
    const { usedDays, totalDays } = prorate;
    if (!Number.isInteger(totalDays) || totalDays < 1 || totalDays > 31) {
      throw new RangeError('prorate.totalDays must be an integer between 1 and 31');
    }
    if (!Number.isInteger(usedDays) || usedDays < 0 || usedDays > totalDays) {
      throw new RangeError('prorate.usedDays must be an integer between 0 and totalDays');
    }
    proratedDays = usedDays;
    periodDays = totalDays;
    effectiveListKrw = Math.floor((listKrw * usedDays) / totalDays);
  }

  const discountKrw = Math.floor((effectiveListKrw * discountPct) / 100);
  const netKrw = Math.max(0, effectiveListKrw - discountKrw);

  let supplyKrw: number;
  let vatKrw: number;
  if (BRAND_PLAN_PRICES_VAT_EXCLUSIVE) {
    supplyKrw = netKrw;
    vatKrw = Math.floor((supplyKrw * BRAND_INVOICE_VAT_PERCENT) / 100);
  } else {
    supplyKrw = Math.ceil((netKrw * 100) / (100 + BRAND_INVOICE_VAT_PERCENT));
    vatKrw = Math.max(0, netKrw - supplyKrw);
  }

  return {
    baseListKrw: listKrw,
    listKrw: effectiveListKrw,
    discountPct,
    discountKrw,
    supplyKrw,
    vatKrw,
    totalKrw: supplyKrw + vatKrw,
    proratedDays,
    periodDays,
  };
}

/**
 * Propose first-month proration when the plan's `startedOn` falls inside `period` (`YYYY-MM`) after day 1.
 * Returns null if the plan covers the entire month (or started in a different month).
 */
export function proposeProration(startedOn: string | null, period: string): InvoiceProrateInput | null {
  if (!startedOn || !isValidCalendarDay(startedOn) || !isValidYearMonth(period)) return null;
  if (!startedOn.startsWith(`${period}-`)) return null;
  const startDay = Number(startedOn.slice(8, 10));
  if (startDay <= 1) return null;
  const totalDays = daysInYearMonth(period);
  const usedDays = Math.max(1, totalDays - startDay + 1);
  return { usedDays, totalDays };
}

/** Strip hyphens and whitespace from a Korean business registration number. */
export function normalizeBusinessRegNo(raw: string): string {
  return raw.replace(/[-\s]/g, '');
}

/**
 * Validate a 10-digit Korean business registration number (사업자등록번호) using the official
 * National Tax Service weighted checksum. Accepts raw 10 digits or hyphenated `XXX-XX-XXXXX`.
 */
export function isValidKoreanBusinessRegNo(raw: string): boolean {
  const digits = normalizeBusinessRegNo(raw);
  if (!/^[0-9]{10}$/.test(digits) || digits === '0000000000') return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * weights[i]!;
  }
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  const expected = (10 - (sum % 10)) % 10;
  return Number(digits[9]) === expected;
}

export function formatBusinessRegNo(digits: string): string {
  const clean = normalizeBusinessRegNo(digits);
  if (!/^[0-9]{10}$/.test(clean)) return digits;
  return `${clean.slice(0, 3)}-${clean.slice(3, 5)}-${clean.slice(5)}`;
}

export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidDiscountCode(raw: string): boolean {
  return BRAND_DISCOUNT_CODE_PATTERN.test(normalizeDiscountCode(raw));
}

/** Issued, unpaid, and `issuedAt` strictly older than `BRAND_INVOICE_OVERDUE_DAYS` (14 days). */
export function isInvoiceOverdue(
  invoice: { status: string; issuedAt: string | null },
  now: Date = new Date(),
): boolean {
  if (invoice.status !== 'issued' || !invoice.issuedAt) return false;
  const issuedMs = Date.parse(invoice.issuedAt);
  if (!Number.isFinite(issuedMs)) return false;
  return now.getTime() - issuedMs > BRAND_INVOICE_OVERDUE_DAYS * 86_400_000;
}
