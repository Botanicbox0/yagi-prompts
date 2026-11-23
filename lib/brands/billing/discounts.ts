import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandBillingDenied, requireBrandBillingSeat, requireDbAdmin } from './access';
import {
  BRAND_DISCOUNT_ATTEMPTS_LIMIT,
  BRAND_DISCOUNT_ATTEMPTS_WINDOW_MINUTES,
  BRAND_DISCOUNT_AUTO_CODE_LENGTH,
  BRAND_DISCOUNT_CODE_ALPHABET,
  BRAND_DISCOUNT_CODE_PATTERN,
  BRAND_DISCOUNT_USER_ATTEMPTS_LIMIT,
  BRAND_DISCOUNT_USER_ATTEMPTS_WINDOW_MINUTES,
  normalizeDiscountCode,
} from './math';
import { hasTable, hasTables } from './schema-guard';
import type {
  BrandBillingFailureCode,
  BrandBillingOutcome,
  BrandDiscount,
  BrandDiscountCode,
  BrandDiscountSource,
  BrandDiscountStatus,
} from './types';

const UUID = z.string().uuid();
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function outcomeError(error: unknown): { ok: false; code: BrandBillingFailureCode } {
  if (error instanceof BrandBillingDenied) return { ok: false, code: error.code };
  if ((error as { code?: string } | null)?.code === '23505') return { ok: false, code: 'conflict' };
  throw error;
}

type DiscountRow = {
  id: string;
  organization_id: string;
  percent: number;
  invoices_total: number | null;
  invoices_used: number;
  status: string;
  memo: string;
  source: string;
  code_id: string | null;
  created_by: string | null;
  created_at: unknown;
  ended_at: unknown;
  ended_by: string | null;
  end_reason: string;
};

function mapDiscount(row: DiscountRow): BrandDiscount {
  const total = row.invoices_total === null ? null : Number(row.invoices_total);
  const used = Number(row.invoices_used);
  const status = row.status as BrandDiscountStatus;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    percent: Number(row.percent),
    invoicesTotal: total,
    invoicesUsed: used,
    invoicesRemaining: total === null ? null : status === 'ended' ? Math.max(0, total - used) : Math.max(0, total - used),
    status,
    memo: String(row.memo ?? ''),
    source: row.source as BrandDiscountSource,
    codeId: row.code_id ? String(row.code_id) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: stamp(row.created_at) ?? new Date(0).toISOString(),
    endedAt: stamp(row.ended_at),
    endedBy: row.ended_by ? String(row.ended_by) : null,
    endReason: String(row.end_reason ?? ''),
  };
}

type CodeRow = {
  id: string;
  code: string;
  percent: number;
  invoices_total: number | null;
  max_redemptions: number | null;
  redeemed_count: number;
  valid_until: unknown;
  organization_id: string | null;
  memo: string;
  disabled: boolean;
  disabled_by: string | null;
  disabled_at: unknown;
  created_by: string | null;
  created_at: unknown;
};

function mapCode(row: CodeRow): BrandDiscountCode {
  return {
    id: String(row.id),
    code: String(row.code),
    percent: Number(row.percent),
    invoicesTotal: row.invoices_total === null ? null : Number(row.invoices_total),
    maxRedemptions: row.max_redemptions === null ? null : Number(row.max_redemptions),
    redeemedCount: Number(row.redeemed_count),
    validUntil: stamp(row.valid_until),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    memo: String(row.memo ?? ''),
    disabled: Boolean(row.disabled),
    disabledBy: row.disabled_by ? String(row.disabled_by) : null,
    disabledAt: stamp(row.disabled_at),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: stamp(row.created_at) ?? new Date(0).toISOString(),
  };
}

export async function loadActiveBrandDiscount(sql: SqlRunner, organizationId: string): Promise<BrandDiscount | null> {
  if (!UUID.safeParse(organizationId).success) return null;
  if (!(await hasTable(sql, 'brand_discounts'))) return null;
  const row = (
    await sql.query<DiscountRow>("select * from brand_discounts where organization_id = $1 and status = 'active' limit 1", [
      organizationId,
    ])
  ).rows[0];
  return row ? mapDiscount(row) : null;
}

export async function listBrandDiscounts(sql: SqlRunner, organizationId: string): Promise<BrandDiscount[]> {
  if (!UUID.safeParse(organizationId).success) return [];
  if (!(await hasTable(sql, 'brand_discounts'))) return [];
  const { rows } = await sql.query<DiscountRow>(
    'select * from brand_discounts where organization_id = $1 order by created_at desc, id desc',
    [organizationId],
  );
  return rows.map(mapDiscount);
}

const GrantDiscountInput = z.object({
  organizationId: UUID,
  percent: z.number().int().min(1).max(100),
  invoicesTotal: z.number().int().min(1).max(36).nullable().default(null),
  memo: z.string().trim().max(500).default(''),
});

/**
 * Grant a count-based monthly fee discount to an organization (admin only).
 * At most one discount may be active per organization: granting a new one ends any currently active
 * discount and records who replaced it and when.
 */
export async function grantBrandDiscount(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ discount: BrandDiscount; replacedDiscountId: string | null }>> {
  const parsed = GrantDiscountInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const now = (deps.now?.() ?? new Date()).toISOString();
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_discounts'))) return { ok: false as const, code: 'unavailable' as const };
      if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0]) {
        return { ok: false as const, code: 'not_found' as const };
      }

      const active = (
        await sql.query<{ id: string }>(
          "select id from brand_discounts where organization_id = $1 and status = 'active' for update",
          [v.organizationId],
        )
      ).rows[0];
      let replacedDiscountId: string | null = null;
      if (active) {
        replacedDiscountId = String(active.id);
        await sql.query(
          `update brand_discounts
              set status = 'ended', ended_at = $2::timestamptz, ended_by = $3, end_reason = 'replaced'
            where id = $1`,
          [replacedDiscountId, now, adminId],
        );
      }

      const id = randomUUID();
      const inserted = (
        await sql.query<DiscountRow>(
          `insert into brand_discounts (
             id, organization_id, percent, invoices_total, invoices_used, status, memo, source, code_id, created_by, created_at
           ) values ($1, $2, $3, $4, 0, 'active', $5, 'admin', null, $6, $7::timestamptz)
           returning *`,
          [id, v.organizationId, v.percent, v.invoicesTotal, v.memo, adminId, now],
        )
      ).rows[0]!;

      return { ok: true as const, discount: mapDiscount(inserted), replacedDiscountId };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const EndDiscountInput = z.object({
  organizationId: UUID,
  discountId: UUID.optional(),
  reason: z.string().trim().max(500).default('ended_by_admin'),
});

/** End the organization's active discount immediately (admin only). */
export async function endBrandDiscount(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ discount: BrandDiscount }>> {
  const parsed = EndDiscountInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const now = (deps.now?.() ?? new Date()).toISOString();
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_discounts'))) return { ok: false as const, code: 'unavailable' as const };
      const active = (
        await sql.query<DiscountRow>(
          v.discountId
            ? "select * from brand_discounts where organization_id = $1 and id = $2 and status = 'active' for update"
            : "select * from brand_discounts where organization_id = $1 and status = 'active' for update",
          v.discountId ? [v.organizationId, v.discountId] : [v.organizationId],
        )
      ).rows[0];
      if (!active) return { ok: false as const, code: 'not_found' as const };
      const updated = (
        await sql.query<DiscountRow>(
          `update brand_discounts
              set status = 'ended', ended_at = $2::timestamptz, ended_by = $3, end_reason = $4
            where id = $1
            returning *`,
          [active.id, now, adminId, v.reason || 'ended_by_admin'],
        )
      ).rows[0]!;
      return { ok: true as const, discount: mapDiscount(updated) };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

/* ------------------------------------------------------------------ discount codes */

/** Generate an unambiguous random code (>=12 chars from the 31-symbol alphabet without 0/O/1/I/L). */
export function generateBrandDiscountCode(length: number = BRAND_DISCOUNT_AUTO_CODE_LENGTH): string {
  const safeLen = Math.max(BRAND_DISCOUNT_AUTO_CODE_LENGTH, Math.min(24, Math.floor(length)));
  let out = '';
  for (let i = 0; i < safeLen; i++) {
    out += BRAND_DISCOUNT_CODE_ALPHABET[randomInt(0, BRAND_DISCOUNT_CODE_ALPHABET.length)]!;
  }
  return out;
}

const CreateCodeInput = z.object({
  code: z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? '' : normalizeDiscountCode(raw)))
    .refine((s) => s === '' || BRAND_DISCOUNT_CODE_PATTERN.test(s), 'code must be 10-24 chars A-Z, 0-9, or hyphen'),
  percent: z.number().int().min(1).max(100),
  invoicesTotal: z.number().int().min(1).max(36).nullable().default(null),
  maxRedemptions: z.number().int().min(1).max(100_000).nullable().default(1),
  validUntil: z.iso.datetime({ offset: true }).nullable().default(null),
  organizationId: UUID.nullable().default(null),
  memo: z.string().trim().max(500).default(''),
});

export async function createBrandDiscountCode(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ discountCode: BrandDiscountCode }>> {
  const parsed = CreateCodeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const now = (deps.now?.() ?? new Date()).toISOString();
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_discount_codes'))) return { ok: false as const, code: 'unavailable' as const };
      if (
        v.organizationId &&
        !(await sql.query('select id from brand_organizations where id = $1', [v.organizationId])).rows[0]
      ) {
        return { ok: false as const, code: 'not_found' as const };
      }
      let finalCode = v.code;
      if (!finalCode) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = generateBrandDiscountCode();
          const taken = (await sql.query('select 1 from brand_discount_codes where code = $1', [candidate])).rows[0];
          if (!taken) {
            finalCode = candidate;
            break;
          }
        }
        if (!finalCode) return { ok: false as const, code: 'conflict' as const };
      } else {
        const existing = (await sql.query('select 1 from brand_discount_codes where code = $1', [finalCode])).rows[0];
        if (existing) return { ok: false as const, code: 'conflict' as const };
      }
      const id = randomUUID();
      const inserted = (
        await sql.query<CodeRow>(
          `insert into brand_discount_codes (
             id, code, percent, invoices_total, max_redemptions, redeemed_count, valid_until,
             organization_id, memo, disabled, created_by, created_at
           ) values ($1, $2, $3, $4, $5, 0, $6::timestamptz, $7, $8, false, $9, $10::timestamptz)
           returning *`,
          [id, finalCode, v.percent, v.invoicesTotal, v.maxRedemptions, v.validUntil, v.organizationId, v.memo, adminId, now],
        )
      ).rows[0]!;
      return { ok: true as const, discountCode: mapCode(inserted) };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const DisableCodeInput = z.object({
  codeId: UUID.optional(),
  code: z.string().transform(normalizeDiscountCode).optional(),
}).refine((v) => Boolean(v.codeId || v.code), { message: 'codeId or code is required' });

export async function disableBrandDiscountCode(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ discountCode: BrandDiscountCode }>> {
  const parsed = DisableCodeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const now = (deps.now?.() ?? new Date()).toISOString();
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_discount_codes'))) return { ok: false as const, code: 'unavailable' as const };
      const row = (
        await sql.query<CodeRow>(
          v.codeId
            ? 'select * from brand_discount_codes where id = $1 for update'
            : 'select * from brand_discount_codes where code = $1 for update',
          [v.codeId ?? v.code],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      if (row.disabled) return { ok: true as const, discountCode: mapCode(row) };
      const updated = (
        await sql.query<CodeRow>(
          `update brand_discount_codes
              set disabled = true, disabled_by = $2, disabled_at = $3::timestamptz
            where id = $1
            returning *`,
          [row.id, adminId, now],
        )
      ).rows[0]!;
      return { ok: true as const, discountCode: mapCode(updated) };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function listBrandDiscountCodes(
  sql: SqlRunner,
  options: { organizationId?: string } = {},
): Promise<BrandDiscountCode[]> {
  if (!(await hasTable(sql, 'brand_discount_codes'))) return [];
  if (options.organizationId) {
    if (!UUID.safeParse(options.organizationId).success) return [];
    const { rows } = await sql.query<CodeRow>(
      'select * from brand_discount_codes where organization_id = $1 order by created_at desc, id desc',
      [options.organizationId],
    );
    return rows.map(mapCode);
  }
  const { rows } = await sql.query<CodeRow>('select * from brand_discount_codes order by created_at desc, id desc');
  return rows.map(mapCode);
}

const RedeemCodeInput = z.object({
  organizationId: UUID,
  code: z.string().trim().min(1).max(64),
});

async function recordAttempt(
  sql: SqlRunner,
  organizationId: string,
  actorId: string,
  succeeded: boolean,
  nowIso: string,
): Promise<void> {
  await sql.query(
    `insert into brand_discount_code_attempts (organization_id, actor_id, succeeded, created_at)
       values ($1, $2, $3, $4::timestamptz)`,
    [organizationId, actorId, succeeded, nowIso],
  );
}

/**
 * Bounded retention cleanup for old discount-code attempt logs (> 1 day) from the 10-minute cron.
 * Preserves the entire 10-minute per-org and 1-hour per-user rate-limit windows.
 */
export async function pruneExpiredDiscountCodeAttempts(
  sql: SqlRunner,
  now: Date = new Date(),
  batchSize: number = 1000,
): Promise<number> {
  if (!(await hasTable(sql, 'brand_discount_code_attempts'))) return 0;
  const safeBatch = Math.min(5000, Math.max(1, Math.floor(batchSize)));
  const { rows } = await sql.query<{ id: string }>(
    `with stale as (
       select id
         from brand_discount_code_attempts
        where created_at < $1::timestamptz - interval '1 day'
        order by created_at asc
        limit $2
     )
     delete from brand_discount_code_attempts a
      using stale
      where a.id = stale.id
     returning a.id`,
    [now.toISOString(), safeBatch],
  );
  return rows.length;
}

/**
 * Atomic conditional SQL guard for consuming one discount-code redemption slot.
 * Returns null (0 rows updated) if the code was concurrently disabled, expired, already redeemed
 * by this org, or exhausted (`redeemed_count < max_redemptions`), without relying on JS ordering.
 */
export async function tryConsumeDiscountCodeRedemption(
  sql: SqlRunner,
  codeId: string,
  organizationId: string,
  nowIso: string,
): Promise<CodeRow | null> {
  return (
    (
      await sql.query<CodeRow>(
        `update brand_discount_codes
            set redeemed_count = redeemed_count + 1
          where id = $1
            and disabled = false
            and (valid_until is null or valid_until > $2::timestamptz)
            and (organization_id is null or organization_id = $3)
            and (max_redemptions is null or redeemed_count < max_redemptions)
            and not exists (
              select 1 from brand_discount_redemptions r
               where r.code_id = brand_discount_codes.id
                 and r.organization_id = $3
            )
          returning *`,
        [codeId, nowIso, organizationId],
      )
    ).rows[0] ?? null
  );
}

/**
 * Redeem a discount code for an organization (owner/admin only).
 *
 * Single transaction lock order (MUST match studio job/allowance paths to avoid deadlocks):
 *   1. `brand_organizations` (`FOR UPDATE`) — matches `lockOrganization` in `lib/brand-studio/access.ts`
 *   2. `profiles` (`FOR NO KEY UPDATE`) — compatible with `FOR KEY SHARE` FK checks from `createStudioJob`
 *   3. `brand_discount_codes` (`FOR UPDATE`)
 *   4. `brand_discounts` (`FOR UPDATE`)
 *
 * - DB-backed rate limits: 5 attempts / 10 min per organization AND 10 attempts / 1 hour per user.
 * - Executes the exact same SQL queries (same query count & index probes) for missing, malformed,
 *   expired, exhausted, already-redeemed, and ineligible codes and returns uniform `'code_unavailable'`.
 */
export async function redeemBrandDiscountCode(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ discount: BrandDiscount; replacedDiscountId: string | null }>> {
  const parsed = RedeemCodeInput.safeParse(input);
  if (!parsed.success) {
    const orgField = typeof (input as { organizationId?: unknown } | null)?.organizationId === 'string'
      ? (input as { organizationId: string }).organizationId
      : '';
    if (UUID.safeParse(orgField).success) {
      // Check seat first so outsiders never distinguish validation errors from 404.
      try {
        await deps.sql.transaction(async (sql) => {
          await requireBrandBillingSeat(sql, viewer, orgField);
        });
      } catch (error) {
        return outcomeError(error);
      }
    }
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }

  const normalizedCode = normalizeDiscountCode(parsed.data.code);
  const orgId = parsed.data.organizationId;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();

  try {
    return await deps.sql.transaction(async (sql) => {
      const seat = await requireBrandBillingSeat(sql, viewer, orgId);
      const ready = await hasTables(sql, [
        'brand_discount_codes',
        'brand_discounts',
        'brand_discount_redemptions',
        'brand_discount_code_attempts',
      ]);
      if (!ready) return { ok: false as const, code: 'unavailable' as const };

      // Strict lock order: brand_organizations (FOR UPDATE) -> profiles (FOR NO KEY UPDATE).
      await sql.query('select id from brand_organizations where id = $1 for update', [orgId]);
      await sql.query('select id from profiles where id = $1 for no key update', [seat.userId]);

      const orgWindowStart = new Date(nowDate.getTime() - BRAND_DISCOUNT_ATTEMPTS_WINDOW_MINUTES * 60_000).toISOString();
      const userWindowStart = new Date(
        nowDate.getTime() - BRAND_DISCOUNT_USER_ATTEMPTS_WINDOW_MINUTES * 60_000,
      ).toISOString();

      const rateRow = (
        await sql.query<{ org_n: number; user_n: number }>(
          `select
             (select count(*)::int from brand_discount_code_attempts where organization_id = $1 and created_at > $2::timestamptz) as org_n,
             (select count(*)::int from brand_discount_code_attempts where actor_id = $3 and created_at > $4::timestamptz) as user_n`,
          [orgId, orgWindowStart, seat.userId, userWindowStart],
        )
      ).rows[0];
      if (
        Number(rateRow?.org_n ?? 0) >= BRAND_DISCOUNT_ATTEMPTS_LIMIT ||
        Number(rateRow?.user_n ?? 0) >= BRAND_DISCOUNT_USER_ATTEMPTS_LIMIT
      ) {
        return { ok: false as const, code: 'rate_limited' as const };
      }

      // Run the exact same query sequence unconditionally (missing/malformed vs existing codes).
      const codeRow = (
        await sql.query<CodeRow>('select * from brand_discount_codes where code = $1 for update', [normalizedCode])
      ).rows[0];
      const probeCodeId = codeRow ? codeRow.id : ZERO_UUID;
      const already = (
        await sql.query('select 1 from brand_discount_redemptions where code_id = $1 and organization_id = $2', [
          probeCodeId,
          orgId,
        ])
      ).rows[0];
      const active = (
        await sql.query<DiscountRow>(
          "select * from brand_discounts where organization_id = $1 and status = 'active' for update",
          [orgId],
        )
      ).rows[0];

      const syntaxValid = BRAND_DISCOUNT_CODE_PATTERN.test(normalizedCode);

      const expired =
        codeRow !== undefined &&
        codeRow.valid_until !== null &&
        new Date(String(codeRow.valid_until)).getTime() <= nowDate.getTime();
      const boundElsewhere =
        codeRow !== undefined && codeRow.organization_id !== null && String(codeRow.organization_id) !== orgId;
      const exhausted =
        codeRow !== undefined &&
        codeRow.max_redemptions !== null &&
        Number(codeRow.redeemed_count) >= Number(codeRow.max_redemptions);
      const notHigherThanActive =
        codeRow !== undefined && active !== undefined && Number(codeRow.percent) <= Number(active.percent);

      if (
        !syntaxValid ||
        !codeRow ||
        codeRow.disabled ||
        expired ||
        boundElsewhere ||
        exhausted ||
        already ||
        notHigherThanActive
      ) {
        await recordAttempt(sql, orgId, seat.userId, false, nowIso);
        return { ok: false as const, code: 'code_unavailable' as const };
      }

      // Consume the code slot via SQL conditional UPDATE BEFORE altering brand_discounts!
      const consumedCode = await tryConsumeDiscountCodeRedemption(sql, codeRow.id, orgId, nowIso);
      if (!consumedCode) {
        await recordAttempt(sql, orgId, seat.userId, false, nowIso);
        return { ok: false as const, code: 'code_unavailable' as const };
      }

      let replacedDiscountId: string | null = null;
      if (active) {
        replacedDiscountId = String(active.id);
        await sql.query(
          `update brand_discounts
              set status = 'ended', ended_at = $2::timestamptz, ended_by = $3, end_reason = 'replaced_by_code'
            where id = $1 and status = 'active'`,
          [replacedDiscountId, nowIso, seat.userId],
        );
      }

      const discountId = randomUUID();
      const inserted = (
        await sql.query<DiscountRow>(
          `insert into brand_discounts (
             id, organization_id, percent, invoices_total, invoices_used, status, memo, source, code_id, created_by, created_at
           ) values ($1, $2, $3, $4, 0, 'active', $5, 'code', $6, $7, $8::timestamptz)
           returning *`,
          [
            discountId,
            orgId,
            Number(consumedCode.percent),
            consumedCode.invoices_total === null ? null : Number(consumedCode.invoices_total),
            String(consumedCode.memo ?? ''),
            consumedCode.id,
            seat.userId,
            nowIso,
          ],
        )
      ).rows[0]!;

      await sql.query(
        `insert into brand_discount_redemptions (code_id, organization_id, discount_id, redeemed_by, redeemed_at)
           values ($1, $2, $3, $4, $5::timestamptz)`,
        [consumedCode.id, orgId, discountId, seat.userId, nowIso],
      );
      await recordAttempt(sql, orgId, seat.userId, true, nowIso);

      return { ok: true as const, discount: mapDiscount(inserted), replacedDiscountId };
    });
  } catch (error) {
    return outcomeError(error);
  }
}
