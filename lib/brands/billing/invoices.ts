import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { isSandboxedClientOrganization } from '../features';
import { BRAND_PLAN_IDS, BRAND_PLANS, loadPlanAssignment, type BrandPlanId } from '../plans';
import { BrandBillingDenied, requireBrandBillingSeat, requireDbAdmin } from './access';
import {
  BRAND_INVOICE_OVERDUE_DAYS,
  invoiceAmounts,
  kstDayOf,
  isInvoiceOverdue,
  isValidCalendarDay,
  isValidKoreanBusinessRegNo,
  isValidYearMonth,
  normalizeBusinessRegNo,
  proposeProration,
} from './math';
import { hasTable, hasTables, loadSubscriptionSchemaReady } from './schema-guard';
import type {
  BrandBillingFailureCode,
  BrandBillingOutcome,
  BrandBillingProfile,
  BrandInvoice,
  BrandInvoiceEvent,
  BrandInvoiceEventAction,
  BrandInvoiceStatus,
} from './types';

export type InvoiceActor = { kind: 'admin'; userId: string } | { kind: 'system' };

export interface SubscriptionInvoiceWriteMeta {
  kind: 'subscription' | 'adjustment' | 'prepay' | 'credit_pack';
  coversMonths: number;
  dueOn: string | null;
  collectionMethod: 'transfer' | 'card' | null;
  subscriptionEpoch?: number | null;
}

type PaidVoidPostCommitHook = (
  sql: SqlRunner,
  params: { organizationId: string; actor: InvoiceActor; now: Date },
) => Promise<void>;

let subscriptionReconcileHook: PaidVoidPostCommitHook | null = null;

/** Registered by `lib/brands/subscriptions/service.ts` so invoice payment/void reconciles active subscriptions AFTER commit in its own transaction. */
export function registerSubscriptionReconcileHook(hook: PaidVoidPostCommitHook): void {
  subscriptionReconcileHook = hook;
}

/**
 * Runs subscription reconciliation in its own transaction AFTER `markPaid`/`void` has already committed
 * so a lock conflict or reconcile error can never fail or roll back the admin payment/void record.
 */
async function maybeReconcileSubscriptionAfterCommit(
  sql: SqlRunner,
  env: Record<string, string | undefined> | undefined,
  organizationId: string,
  adminId: string,
  nowDate: Date,
): Promise<boolean> {
  if (!brandBillingAutoIssueOpen(env)) return false;
  try {
    if (!subscriptionReconcileHook) {
      await import('../subscriptions/service');
    }
    if (subscriptionReconcileHook) {
      await subscriptionReconcileHook(sql, {
        organizationId,
        actor: { kind: 'admin', userId: adminId },
        now: nowDate,
      });
    }
    return false;
  } catch (error) {
    console.warn(
      '[brand-billing] post_invoice_reconcile_deferred',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
    return true;
  }
}

const UUID = z.string().uuid();
const YearMonth = z.string().refine(isValidYearMonth, 'invalid YYYY-MM');
const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function outcomeError(error: unknown): { ok: false; code: BrandBillingFailureCode; detail?: string } {
  if (error instanceof BrandBillingDenied) {
    return { ok: false, code: error.code, ...(error.detail ? { detail: error.detail } : {}) };
  }
  if ((error as { code?: string } | null)?.code === '23505') return { ok: false, code: 'conflict' };
  throw error;
}

/* ------------------------------------------------------------------ billing profile */

const BillingProfileFields = z.object({
  companyLegalName: z.string().trim().max(120).default(''),
  businessRegNo: z
    .string()
    .trim()
    .transform((s) => (s === '' ? '' : normalizeBusinessRegNo(s)))
    .refine((s) => s === '' || isValidKoreanBusinessRegNo(s), 'invalid Korean business registration number')
    .default(''),
  representativeName: z.string().trim().max(80).default(''),
  businessAddress: z.string().trim().max(300).default(''),
  taxInvoiceEmail: z
    .string()
    .trim()
    .max(254)
    .refine((s) => s === '' || z.email().safeParse(s).success, 'invalid email')
    .default(''),
  contactName: z.string().trim().max(80).default(''),
  contactPhone: z.string().trim().max(40).default(''),
});

const AdminBillingProfileInput = BillingProfileFields.extend({
  organizationId: UUID,
  memo: z.string().trim().max(500).default(''),
});

const CustomerBillingProfileInput = BillingProfileFields.extend({
  organizationId: UUID,
});

type ProfileRow = {
  organization_id: string;
  company_legal_name: string;
  business_reg_no: string;
  representative_name: string;
  business_address: string;
  tax_invoice_email: string;
  contact_name: string;
  contact_phone: string;
  memo: string;
  updated_by: string | null;
  updated_at: unknown;
};

function mapProfile(row: ProfileRow): BrandBillingProfile {
  return {
    organizationId: String(row.organization_id),
    companyLegalName: String(row.company_legal_name ?? ''),
    businessRegNo: String(row.business_reg_no ?? ''),
    representativeName: String(row.representative_name ?? ''),
    businessAddress: String(row.business_address ?? ''),
    taxInvoiceEmail: String(row.tax_invoice_email ?? ''),
    contactName: String(row.contact_name ?? ''),
    contactPhone: String(row.contact_phone ?? ''),
    memo: String(row.memo ?? ''),
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: stamp(row.updated_at),
  };
}

export async function loadBrandBillingProfile(sql: SqlRunner, organizationId: string): Promise<BrandBillingProfile | null> {
  if (!UUID.safeParse(organizationId).success) return null;
  if (!(await hasTable(sql, 'brand_billing_profiles'))) return null;
  const row = (
    await sql.query<ProfileRow>('select * from brand_billing_profiles where organization_id = $1', [organizationId])
  ).rows[0];
  return row ? mapProfile(row) : null;
}

export async function saveBrandBillingProfileAdmin(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ profile: BrandBillingProfile }>> {
  const parsed = AdminBillingProfileInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_billing_profiles'))) return { ok: false as const, code: 'unavailable' as const };
      if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0]) {
        return { ok: false as const, code: 'not_found' as const };
      }
      const row = (
        await sql.query<ProfileRow>(
          `insert into brand_billing_profiles (
             organization_id, company_legal_name, business_reg_no, representative_name,
             business_address, tax_invoice_email, contact_name, contact_phone, memo, updated_by, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           on conflict (organization_id) do update
             set company_legal_name = excluded.company_legal_name,
                 business_reg_no = excluded.business_reg_no,
                 representative_name = excluded.representative_name,
                 business_address = excluded.business_address,
                 tax_invoice_email = excluded.tax_invoice_email,
                 contact_name = excluded.contact_name,
                 contact_phone = excluded.contact_phone,
                 memo = excluded.memo,
                 updated_by = excluded.updated_by,
                 updated_at = now()
           returning *`,
          [
            v.organizationId,
            v.companyLegalName,
            v.businessRegNo,
            v.representativeName,
            v.businessAddress,
            v.taxInvoiceEmail,
            v.contactName,
            v.contactPhone,
            v.memo,
            adminId,
          ],
        )
      ).rows[0]!;
      return { ok: true as const, profile: mapProfile(row) };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function saveBrandBillingProfileCustomer(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ profile: Omit<BrandBillingProfile, 'memo' | 'updatedBy'> }>> {
  const orgRaw =
    typeof (input as { organizationId?: unknown } | null)?.organizationId === 'string'
      ? (input as { organizationId: string }).organizationId
      : '';
  try {
    return await deps.sql.transaction(async (sql) => {
      // Always verify membership + sandbox hardline + owner/admin role BEFORE exposing field validation.
      const seat = await requireBrandBillingSeat(sql, viewer, orgRaw);
      if (!(await hasTable(sql, 'brand_billing_profiles'))) return { ok: false as const, code: 'unavailable' as const };

      const parsed = CustomerBillingProfileInput.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false as const,
          code: 'invalid' as const,
          field: (parsed.error.issues[0]?.path ?? []).map(String).join('.'),
        };
      }
      const v = parsed.data;
      const row = (
        await sql.query<ProfileRow>(
          `insert into brand_billing_profiles (
             organization_id, company_legal_name, business_reg_no, representative_name,
             business_address, tax_invoice_email, contact_name, contact_phone, updated_by, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           on conflict (organization_id) do update
             set company_legal_name = excluded.company_legal_name,
                 business_reg_no = excluded.business_reg_no,
                 representative_name = excluded.representative_name,
                 business_address = excluded.business_address,
                 tax_invoice_email = excluded.tax_invoice_email,
                 contact_name = excluded.contact_name,
                 contact_phone = excluded.contact_phone,
                 updated_by = excluded.updated_by,
                 updated_at = now()
           returning *`,
          [
            seat.organizationId,
            v.companyLegalName,
            v.businessRegNo,
            v.representativeName,
            v.businessAddress,
            v.taxInvoiceEmail,
            v.contactName,
            v.contactPhone,
            seat.userId,
          ],
        )
      ).rows[0]!;
      const mapped = mapProfile(row);
      const { memo: _memo, updatedBy: _updatedBy, ...customerProfile } = mapped;
      return { ok: true as const, profile: customerProfile };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

/* ------------------------------------------------------------------ invoices ledger */

type InvoiceRow = {
  id: string;
  organization_id: string;
  period: string;
  plan_id: string;
  base_list_krw: number;
  list_krw: number;
  prorated_days: number | null;
  period_days: number | null;
  discount_id: string | null;
  discount_percent: number;
  discount_krw: number;
  supply_krw: number;
  vat_krw: number;
  total_krw: number;
  manual_amounts: boolean;
  manual_reason: string;
  status: string;
  issued_at: unknown;
  issued_by: string | null;
  paid_at: unknown;
  paid_by: string | null;
  paid_method: string;
  voided_at: unknown;
  voided_by: string | null;
  void_reason: string;
  memo: string;
  created_by: string | null;
  created_at: unknown;
  updated_by: string | null;
  updated_at: unknown;
};

function mapInvoice(row: InvoiceRow, now: Date = new Date()): BrandInvoice {
  const status = row.status as BrandInvoiceStatus;
  const issuedAt = stamp(row.issued_at);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    period: String(row.period),
    planId: row.plan_id as BrandPlanId,
    baseListKrw: Number(row.base_list_krw),
    listKrw: Number(row.list_krw),
    proratedDays: row.prorated_days === null ? null : Number(row.prorated_days),
    periodDays: row.period_days === null ? null : Number(row.period_days),
    discountId: row.discount_id ? String(row.discount_id) : null,
    discountPercent: Number(row.discount_percent),
    discountKrw: Number(row.discount_krw),
    supplyKrw: Number(row.supply_krw),
    vatKrw: Number(row.vat_krw),
    totalKrw: Number(row.total_krw),
    manualAmounts: Boolean(row.manual_amounts),
    manualReason: String(row.manual_reason ?? ''),
    status,
    overdue: isInvoiceOverdue({ status, issuedAt }, now),
    issuedAt,
    issuedBy: row.issued_by ? String(row.issued_by) : null,
    paidAt: stamp(row.paid_at),
    paidBy: row.paid_by ? String(row.paid_by) : null,
    paidMethod: String(row.paid_method ?? ''),
    voidedAt: stamp(row.voided_at),
    voidedBy: row.voided_by ? String(row.voided_by) : null,
    voidReason: String(row.void_reason ?? ''),
    memo: String(row.memo ?? ''),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: stamp(row.created_at) ?? new Date(0).toISOString(),
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: stamp(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function invoiceSnapshot(row: InvoiceRow): Record<string, unknown> {
  return {
    period: row.period,
    planId: row.plan_id,
    baseListKrw: Number(row.base_list_krw),
    listKrw: Number(row.list_krw),
    proratedDays: row.prorated_days === null ? null : Number(row.prorated_days),
    periodDays: row.period_days === null ? null : Number(row.period_days),
    discountId: row.discount_id ?? null,
    discountPercent: Number(row.discount_percent),
    discountKrw: Number(row.discount_krw),
    supplyKrw: Number(row.supply_krw),
    vatKrw: Number(row.vat_krw),
    totalKrw: Number(row.total_krw),
    manualAmounts: Boolean(row.manual_amounts),
    manualReason: String(row.manual_reason ?? ''),
    status: row.status,
  };
}

function invoiceRowConsistent(row: InvoiceRow): boolean {
  const baseList = Number(row.base_list_krw);
  const listKrw = Number(row.list_krw);
  const discountPct = Number(row.discount_percent);
  const discountKrw = Number(row.discount_krw);
  const supplyKrw = Number(row.supply_krw);
  const vatKrw = Number(row.vat_krw);
  const totalKrw = Number(row.total_krw);
  if (totalKrw !== supplyKrw + vatKrw || discountKrw > listKrw) return false;
  if (Boolean(row.manual_amounts)) {
    return String(row.manual_reason ?? '').trim().length > 0;
  }
  const hasProration = row.prorated_days !== null || row.period_days !== null;
  if (hasProration && (row.prorated_days === null || row.period_days === null)) return false;
  const prorate =
    row.prorated_days !== null && row.period_days !== null
      ? { usedDays: Number(row.prorated_days), totalDays: Number(row.period_days) }
      : null;
  try {
    const derived = invoiceAmounts({ listKrw: baseList, discountPct, prorate });
    return (
      derived.listKrw === listKrw &&
      derived.discountKrw === discountKrw &&
      derived.supplyKrw === supplyKrw &&
      derived.vatKrw === vatKrw &&
      derived.totalKrw === totalKrw
    );
  } catch {
    return false;
  }
}

export async function appendInvoiceEvent(
  sql: SqlRunner,
  params: {
    invoiceId: string;
    organizationId: string;
    action: BrandInvoiceEventAction;
    fromStatus: BrandInvoiceStatus | null;
    toStatus: BrandInvoiceStatus;
    snapshot: Record<string, unknown>;
    note: string;
    actorId: string | null;
    actorKind?: 'admin' | 'system';
    createdAt: string;
  },
): Promise<void> {
  if (params.actorKind) {
    await sql.query(
      `insert into brand_invoice_events (
         invoice_id, organization_id, action, from_status, to_status, snapshot, note, actor_id, actor_kind, created_at
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::timestamptz)`,
      [
        params.invoiceId,
        params.organizationId,
        params.action,
        params.fromStatus,
        params.toStatus,
        JSON.stringify(params.snapshot),
        params.note.slice(0, 500),
        params.actorId,
        params.actorKind,
        params.createdAt,
      ],
    );
    return;
  }
  await sql.query(
    `insert into brand_invoice_events (
       invoice_id, organization_id, action, from_status, to_status, snapshot, note, actor_id, created_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz)`,
    [
      params.invoiceId,
      params.organizationId,
      params.action,
      params.fromStatus,
      params.toStatus,
      JSON.stringify(params.snapshot),
      params.note.slice(0, 500),
      params.actorId,
      params.createdAt,
    ],
  );
}

const MoneyInt = z.number().int().min(0).max(1_000_000_000);
const ProrateObj = z
  .object({
    usedDays: z.number().int().min(1).max(31),
    totalDays: z.number().int().min(28).max(31),
  })
  .refine((p) => p.usedDays <= p.totalDays, { message: 'usedDays exceeds totalDays' });

const DraftInvoiceInput = z.object({
  organizationId: UUID,
  period: YearMonth,
  planId: z.enum(BRAND_PLAN_IDS).optional(),
  prorate: z.union([z.boolean(), ProrateObj]).nullable().optional(),
  applyActiveDiscount: z.boolean().default(true),
  manualAmounts: z.boolean().default(false),
  manualReason: z.string().trim().max(500).default(''),
  baseListKrw: MoneyInt.optional(),
  listKrw: MoneyInt.optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  discountKrw: MoneyInt.optional(),
  supplyKrw: MoneyInt.optional(),
  vatKrw: MoneyInt.optional(),
  totalKrw: MoneyInt.optional(),
  memo: z.string().trim().max(500).default(''),
});

export type ValidatedDraftInvoiceInput = z.infer<typeof DraftInvoiceInput>;
export type ValidatedUpdateDraftInvoiceInput = z.infer<typeof UpdateDraftInvoiceInput>;
export type ValidatedIssueInvoiceInput = z.infer<typeof IssueInvoiceInput>;

export async function draftBrandInvoiceInTx(
  sql: SqlRunner,
  actor: InvoiceActor,
  v: ValidatedDraftInvoiceInput,
  nowDate: Date,
  subscriptionMeta?: SubscriptionInvoiceWriteMeta,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice }>> {
  const nowIso = nowDate.toISOString();
  const actorId = actor.kind === 'admin' ? actor.userId : null;
  if (!(await hasTables(sql, ['brand_invoices', 'brand_invoice_events']))) {
    return { ok: false, code: 'unavailable' };
  }
  // Subscription writers lock the organization `for no key update` (see `lockOrganizationForSubscription`);
  // the admin draft keeps origin/main's statement.
  const orgLockSql = subscriptionMeta
    ? 'select id from brand_organizations where id = $1 for no key update'
    : 'select id from brand_organizations where id = $1 for update';
  if (!(await sql.query(orgLockSql, [v.organizationId])).rows[0]) {
    return { ok: false, code: 'not_found' };
  }

  const targetKind = subscriptionMeta?.kind ?? 'subscription';
  const conflict = (
    subscriptionMeta
      ? await sql.query(
          "select 1 from brand_invoices where organization_id = $1 and period = $2 and status <> 'void' and kind = $3 limit 1",
          [v.organizationId, v.period, targetKind],
        )
      : await sql.query(
          "select 1 from brand_invoices where organization_id = $1 and period = $2 and status <> 'void' limit 1",
          [v.organizationId, v.period],
        )
  ).rows[0];
  if (conflict) return { ok: false, code: 'conflict' };

  const assignment = await loadPlanAssignment(sql, v.organizationId);
  const planId = v.planId ?? assignment?.planId;
  if (!planId) return { ok: false, code: 'invalid', field: 'planId' };

  const activeDiscount =
    v.applyActiveDiscount && (await hasTable(sql, 'brand_discounts'))
      ? (
          await sql.query<{
            id: string;
            percent: number;
            invoices_total: number | null;
            invoices_used: number;
          }>(
            "select id, percent, invoices_total, invoices_used from brand_discounts where organization_id = $1 and status = 'active' for share",
            [v.organizationId],
          )
        ).rows[0] ?? null
      : null;

  const usableDiscount =
    activeDiscount &&
    (activeDiscount.invoices_total === null ||
      Number(activeDiscount.invoices_used) < Number(activeDiscount.invoices_total))
      ? activeDiscount
      : null;

  const prorateInput =
    v.prorate === false || v.prorate === null
      ? null
      : typeof v.prorate === 'object'
        ? v.prorate
        : proposeProration(assignment?.startedOn ?? null, v.period);

  const baseListKrw = v.baseListKrw ?? BRAND_PLANS[planId].monthlyKrw;
  const zeroBase = baseListKrw === 0;
  const discountPercent = zeroBase
    ? 0
    : (v.discountPercent ?? (usableDiscount ? Number(usableDiscount.percent) : 0));
  const discountId =
    zeroBase || (v.discountPercent !== undefined && v.discountPercent === 0)
      ? null
      : usableDiscount && (v.discountPercent === undefined || v.discountPercent === Number(usableDiscount.percent))
        ? String(usableDiscount.id)
        : null;

  const calculated = invoiceAmounts({
    listKrw: baseListKrw,
    discountPct: discountPercent,
    prorate: prorateInput,
  });

  const listKrw = v.manualAmounts ? (v.listKrw ?? calculated.listKrw) : calculated.listKrw;
  const discountKrw = v.manualAmounts
    ? (v.discountKrw ?? Math.floor((listKrw * discountPercent) / 100))
    : calculated.discountKrw;
  if (discountKrw > listKrw) return { ok: false, code: 'invalid', field: 'discountKrw' };

  const supplyKrw = v.manualAmounts ? (v.supplyKrw ?? Math.max(0, listKrw - discountKrw)) : calculated.supplyKrw;
  const vatKrw = v.manualAmounts
    ? (v.vatKrw ?? invoiceAmounts({ listKrw: supplyKrw, discountPct: 0 }).vatKrw)
    : calculated.vatKrw;
  const totalKrw = supplyKrw + vatKrw;
  if (v.manualAmounts && v.totalKrw !== undefined && v.totalKrw !== totalKrw) {
    return { ok: false, code: 'invalid', field: 'totalKrw' };
  }

  const manualReason = v.manualAmounts ? v.manualReason : '';
  const id = randomUUID();
  const inserted = subscriptionMeta
    ? (
        await sql.query<InvoiceRow>(
          `insert into brand_invoices (
             id, organization_id, period, plan_id, base_list_krw, list_krw, prorated_days, period_days,
             discount_id, discount_percent, discount_krw, supply_krw, vat_krw, total_krw,
             manual_amounts, manual_reason, status, memo, created_by, created_at, updated_by, updated_at,
             kind, covers_months, due_on, collection_method, created_via, subscription_epoch
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'draft', $17, $18, $19::timestamptz, $18, $19::timestamptz,
                     $20, $21, $22::date, $23, $24, $25)
           returning *`,
          [
            id,
            v.organizationId,
            v.period,
            planId,
            baseListKrw,
            listKrw,
            calculated.proratedDays,
            calculated.periodDays,
            discountId,
            discountPercent,
            discountKrw,
            supplyKrw,
            vatKrw,
            totalKrw,
            v.manualAmounts,
            manualReason,
            v.memo,
            actorId,
            nowIso,
            subscriptionMeta.kind,
            subscriptionMeta.coversMonths,
            subscriptionMeta.dueOn,
            subscriptionMeta.collectionMethod,
            actor.kind,
            subscriptionMeta.subscriptionEpoch ?? null,
          ],
        )
      ).rows[0]!
    : (
          await sql.query<InvoiceRow>(
            `insert into brand_invoices (
               id, organization_id, period, plan_id, base_list_krw, list_krw, prorated_days, period_days,
               discount_id, discount_percent, discount_krw, supply_krw, vat_krw, total_krw,
               manual_amounts, manual_reason, status, memo, created_by, created_at, updated_by, updated_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'draft', $17, $18, $19::timestamptz, $18, $19::timestamptz)
             returning *`,
            [
              id,
              v.organizationId,
              v.period,
              planId,
              baseListKrw,
              listKrw,
              calculated.proratedDays,
              calculated.periodDays,
              discountId,
              discountPercent,
              discountKrw,
              supplyKrw,
              vatKrw,
              totalKrw,
              v.manualAmounts,
              manualReason,
              v.memo,
              actorId,
              nowIso,
            ],
          )
        ).rows[0]!;

  await appendInvoiceEvent(sql, {
    invoiceId: id,
    organizationId: v.organizationId,
    action: 'drafted',
    fromStatus: null,
    toStatus: 'draft',
    snapshot: invoiceSnapshot(inserted),
    note: v.memo,
    actorId,
    ...(subscriptionMeta ? { actorKind: actor.kind } : {}),
    createdAt: nowIso,
  });

  return { ok: true, invoice: mapInvoice(inserted, nowDate) };
}

/**
 * Draft a monthly invoice for `(organizationId, period)` (admin only).
 * Amounts are derived via `invoiceAmounts` unless `manualAmounts: true` is passed with a non-empty `manualReason`.
 */
export async function draftBrandInvoice(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice }>> {
  const parsed = DraftInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  if (!v.manualAmounts && (v.listKrw !== undefined || v.discountKrw !== undefined || v.supplyKrw !== undefined || v.vatKrw !== undefined || v.totalKrw !== undefined)) {
    return { ok: false, code: 'invalid', field: 'manualAmounts' };
  }
  if (v.manualAmounts && v.manualReason.trim().length === 0) {
    return { ok: false, code: 'invalid', field: 'manualReason' };
  }
  const nowDate = deps.now?.() ?? new Date();

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (brandBillingAutoIssueOpen(deps.env) && (await loadSubscriptionSchemaReady(sql))) {
        // Organization lock first (the job's order, `no key update` like every subscription path), so a
        // concurrent (re)start cannot change the subscription under us.
        await sql.query('select id from brand_organizations where id = $1 for no key update', [v.organizationId]);
        const sub = (
          await sql.query<{ epoch: number }>(
            "select epoch from brand_subscriptions where organization_id = $1 and status <> 'ended' limit 1",
            [v.organizationId],
          )
        ).rows[0];
        // Review rounds 4–5 (A1/A2): the job owns a subscribed organization's subscription invoices — an admin
        // drafts none, for any month (a month before the start could never be issued either).
        if (sub) {
          return { ok: false as const, code: 'conflict' as const, detail: 'subscription_owns_period' };
        }
      }
      return draftBrandInvoiceInTx(sql, { kind: 'admin', userId: adminId }, v, nowDate);
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const UpdateDraftInvoiceInput = z.object({
  invoiceId: UUID,
  planId: z.enum(BRAND_PLAN_IDS).optional(),
  manualAmounts: z.boolean().optional(),
  manualReason: z.string().trim().max(500).optional(),
  baseListKrw: MoneyInt.optional(),
  listKrw: MoneyInt.optional(),
  proratedDays: z.number().int().min(1).max(31).nullable().optional(),
  periodDays: z.number().int().min(28).max(31).nullable().optional(),
  discountId: UUID.nullable().optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  discountKrw: MoneyInt.optional(),
  supplyKrw: MoneyInt.optional(),
  vatKrw: MoneyInt.optional(),
  totalKrw: MoneyInt.optional(),
  memo: z.string().trim().max(500).optional(),
});

export async function updateDraftBrandInvoiceInTx(
  sql: SqlRunner,
  actor: InvoiceActor,
  v: ValidatedUpdateDraftInvoiceInput,
  nowDate: Date,
  subscriptionMeta?: Pick<SubscriptionInvoiceWriteMeta, 'kind' | 'coversMonths' | 'collectionMethod' | 'subscriptionEpoch'>,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice }>> {
  const nowIso = nowDate.toISOString();
  const actorId = actor.kind === 'admin' ? actor.userId : null;
  if (!(await hasTables(sql, ['brand_invoices', 'brand_invoice_events']))) {
    return { ok: false, code: 'unavailable' };
  }
  const row = (await sql.query<InvoiceRow>('select * from brand_invoices where id = $1 for update', [v.invoiceId])).rows[0];
  if (!row) return { ok: false, code: 'not_found' };
  if (row.status !== 'draft') return { ok: false, code: 'conflict' };

  const manualAmounts = v.manualAmounts ?? Boolean(row.manual_amounts);
  const hasManualAmountField =
    v.listKrw !== undefined ||
    v.discountKrw !== undefined ||
    v.supplyKrw !== undefined ||
    v.vatKrw !== undefined ||
    v.totalKrw !== undefined;
  if (!manualAmounts && hasManualAmountField) {
    return { ok: false, code: 'invalid', field: 'manualAmounts' };
  }
  const manualReason = manualAmounts ? (v.manualReason ?? String(row.manual_reason ?? '')) : '';
  if (manualAmounts && manualReason.trim().length === 0) {
    return { ok: false, code: 'invalid', field: 'manualReason' };
  }

  const planId = (v.planId ?? row.plan_id) as BrandPlanId;
  const planChanged = v.planId !== undefined && v.planId !== row.plan_id;
  const baseListKrw =
    v.baseListKrw !== undefined
      ? v.baseListKrw
      : planChanged
        ? BRAND_PLANS[planId].monthlyKrw
        : Number(row.base_list_krw);

  const proratedDays = v.proratedDays !== undefined ? v.proratedDays : row.prorated_days;
  const periodDays = v.periodDays !== undefined ? v.periodDays : row.period_days;
  if ((proratedDays === null) !== (periodDays === null)) {
    return { ok: false, code: 'invalid', field: 'proratedDays' };
  }
  if (proratedDays !== null && periodDays !== null && proratedDays > periodDays) {
    return { ok: false, code: 'invalid', field: 'proratedDays' };
  }

  const zeroBase = baseListKrw === 0;
  const discountPercent = zeroBase ? 0 : (v.discountPercent ?? Number(row.discount_percent));
  let discountId = zeroBase ? null : (v.discountId !== undefined ? v.discountId : row.discount_id);
  if (discountPercent === 0 && v.discountId === undefined) discountId = null;

  if (discountId) {
    const disc = (
      await sql.query<{ organization_id: string }>(
        'select organization_id from brand_discounts where id = $1',
        [discountId],
      )
    ).rows[0];
    if (!disc || String(disc.organization_id) !== String(row.organization_id)) {
      return { ok: false, code: 'invalid', field: 'discountId' };
    }
  }

  const prorate =
    proratedDays !== null && periodDays !== null
      ? { usedDays: proratedDays, totalDays: periodDays }
      : null;

  const derived = invoiceAmounts({ listKrw: baseListKrw, discountPct: discountPercent, prorate });

  let listKrw: number;
  let discountKrw: number;
  let supplyKrw: number;
  let vatKrw: number;
  let totalKrw: number;

  if (!manualAmounts) {
    listKrw = derived.listKrw;
    discountKrw = derived.discountKrw;
    supplyKrw = derived.supplyKrw;
    vatKrw = derived.vatKrw;
    totalKrw = derived.totalKrw;
  } else {
    const baseChanged =
      v.baseListKrw !== undefined ||
      planChanged ||
      v.proratedDays !== undefined ||
      v.periodDays !== undefined;
    listKrw = v.listKrw ?? (baseChanged ? derived.listKrw : Number(row.list_krw));
    const pctOrListChanged = v.listKrw !== undefined || baseChanged || v.discountPercent !== undefined;
    discountKrw = v.discountKrw ?? (pctOrListChanged ? Math.floor((listKrw * discountPercent) / 100) : Number(row.discount_krw));
    if (discountKrw > listKrw) return { ok: false, code: 'invalid', field: 'discountKrw' };
    const discChanged = v.discountKrw !== undefined || pctOrListChanged;
    supplyKrw = v.supplyKrw ?? (discChanged ? Math.max(0, listKrw - discountKrw) : Number(row.supply_krw));
    vatKrw =
      v.vatKrw ??
      (v.supplyKrw !== undefined || discChanged
        ? invoiceAmounts({ listKrw: supplyKrw, discountPct: 0 }).vatKrw
        : Number(row.vat_krw));
    totalKrw = supplyKrw + vatKrw;
    if (v.totalKrw !== undefined && v.totalKrw !== totalKrw) {
      return { ok: false, code: 'invalid', field: 'totalKrw' };
    }
  }

  const memo = v.memo !== undefined ? v.memo : String(row.memo ?? '');

  const updated = (
    subscriptionMeta
      ? await sql.query<InvoiceRow>(
          `update brand_invoices
              set plan_id = $2,
                  base_list_krw = $3,
                  list_krw = $4,
                  prorated_days = $5,
                  period_days = $6,
                  discount_id = $7,
                  discount_percent = $8,
                  discount_krw = $9,
                  supply_krw = $10,
                  vat_krw = $11,
                  total_krw = $12,
                  manual_amounts = $13,
                  manual_reason = $14,
                  memo = $15,
                  updated_by = $16,
                  updated_at = $17::timestamptz,
                  kind = $18,
                  covers_months = $19,
                  collection_method = $20,
                  subscription_epoch = coalesce($21, subscription_epoch)
            where id = $1 and status = 'draft'
            returning *`,
          [
            row.id,
            planId,
            baseListKrw,
            listKrw,
            proratedDays,
            periodDays,
            discountId,
            discountPercent,
            discountKrw,
            supplyKrw,
            vatKrw,
            totalKrw,
            manualAmounts,
            manualReason,
            memo,
            actorId,
            nowIso,
            subscriptionMeta.kind,
            subscriptionMeta.coversMonths,
            subscriptionMeta.collectionMethod,
            subscriptionMeta.subscriptionEpoch ?? null,
          ],
        )
      : await sql.query<InvoiceRow>(
          `update brand_invoices
              set plan_id = $2,
                  base_list_krw = $3,
                  list_krw = $4,
                  prorated_days = $5,
                  period_days = $6,
                  discount_id = $7,
                  discount_percent = $8,
                  discount_krw = $9,
                  supply_krw = $10,
                  vat_krw = $11,
                  total_krw = $12,
                  manual_amounts = $13,
                  manual_reason = $14,
                  memo = $15,
                  updated_by = $16,
                  updated_at = $17::timestamptz
            where id = $1 and status = 'draft'
            returning *`,
          [
            row.id,
            planId,
            baseListKrw,
            listKrw,
            proratedDays,
            periodDays,
            discountId,
            discountPercent,
            discountKrw,
            supplyKrw,
            vatKrw,
            totalKrw,
            manualAmounts,
            manualReason,
            memo,
            actorId,
            nowIso,
          ],
        )
  ).rows[0];
  if (!updated) return { ok: false, code: 'conflict' };

  await appendInvoiceEvent(sql, {
    invoiceId: row.id,
    organizationId: String(row.organization_id),
    action: 'edited',
    fromStatus: 'draft',
    toStatus: 'draft',
    snapshot: invoiceSnapshot(updated),
    note: memo,
    actorId,
    ...(subscriptionMeta ? { actorKind: actor.kind } : {}),
    createdAt: nowIso,
  });

  return { ok: true, invoice: mapInvoice(updated, nowDate) };
}

/**
 * Edit a `draft` invoice (admin only). In normal derived mode, only `planId`, `baseListKrw`,
 * `proratedDays`/`periodDays`, `discountPercent`/`discountId`, and `memo` are editable, and
 * switching `planId` re-proposes the plan list price. Manual supply/VAT/total overrides require
 * explicit `manualAmounts: true` and a non-empty `manualReason`.
 */
export async function updateDraftBrandInvoice(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice }>> {
  const parsed = UpdateDraftInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (brandBillingAutoIssueOpen() && (await loadSubscriptionSchemaReady(sql))) {
        const locked = await subscriptionDraftLocked(sql, v);
        if (locked) return { ok: false as const, code: 'conflict' as const, detail: 'subscription_draft_locked' };
      }
      return updateDraftBrandInvoiceInTx(sql, { kind: 'admin', userId: adminId }, v, nowDate);
    });
  } catch (error) {
    return outcomeError(error);
  }
}

/**
 * Review rounds 4–5, A2/A3: a subscription draft of a subscribed organization (any epoch) belongs to the
 * job. An admin may change its memo only; any change to plan, base/list price, proration, discount or manual
 * amounts is refused. Fields sent with their current value are not changes.
 */
async function subscriptionDraftLocked(sql: SqlRunner, v: ValidatedUpdateDraftInvoiceInput): Promise<boolean> {
  const row = (
    await sql.query<InvoiceRow & { kind: string; subscription_epoch: number | null; sub_epoch: number | null }>(
      `select i.*, s.epoch as sub_epoch
         from brand_invoices i
         left join brand_subscriptions s on s.organization_id = i.organization_id and s.status <> 'ended'
        where i.id = $1`,
      [v.invoiceId],
    )
  ).rows[0];
  // Round 5, A3: any subscription draft of a subscribed organization (null-epoch leftovers included).
  if (!row || row.kind !== 'subscription' || row.sub_epoch == null) return false;
  const differs = (value: unknown, current: unknown) => value !== undefined && String(value ?? '') !== String(current ?? '');
  const rec = row as unknown as Record<string, unknown>;
  return (
    differs(v.planId, rec.plan_id) ||
    differs(v.baseListKrw, rec.base_list_krw) ||
    differs(v.listKrw, rec.list_krw) ||
    differs(v.proratedDays, rec.prorated_days) ||
    differs(v.periodDays, rec.period_days) ||
    differs(v.discountId, rec.discount_id) ||
    differs(v.discountPercent, rec.discount_percent) ||
    differs(v.discountKrw, rec.discount_krw) ||
    differs(v.supplyKrw, rec.supply_krw) ||
    differs(v.vatKrw, rec.vat_krw) ||
    differs(v.totalKrw, rec.total_krw) ||
    (v.manualAmounts !== undefined && v.manualAmounts !== Boolean(rec.manual_amounts))
  );
}

const IssueInvoiceInput = z.object({
  invoiceId: UUID,
  memo: z.string().trim().max(500).optional(),
});

/**
 * Atomic SQL conditional UPDATE for consuming one invoice use on `brand_discounts`.
 * Returns null (0 rows) if the discount is no longer `active`, has reached `invoices_total`, or
 * belongs to another organization — without relying on JS ordering.
 */
export async function consumeBrandDiscountUse(
  sql: SqlRunner,
  discountId: string,
  nowIso: string,
  actorId: string | null,
  organizationId?: string,
): Promise<{
  id: string;
  invoices_used: number;
  invoices_total: number | null;
  status: string;
  end_reason: string;
} | null> {
  return (
    (
      await sql.query<{
        id: string;
        invoices_used: number;
        invoices_total: number | null;
        status: string;
        end_reason: string;
      }>(
        `update brand_discounts
            set invoices_used = invoices_used + 1,
                status = case
                  when invoices_total is not null and invoices_used + 1 >= invoices_total then 'ended'
                  else 'active'
                end,
                ended_at = case
                  when invoices_total is not null and invoices_used + 1 >= invoices_total then $2::timestamptz
                  else ended_at
                end,
                ended_by = case
                  when invoices_total is not null and invoices_used + 1 >= invoices_total then $3
                  else ended_by
                end,
                end_reason = case
                  when invoices_total is not null and invoices_used + 1 >= invoices_total then 'exhausted'
                  else end_reason
                end
          where id = $1
            and ($4::uuid is null or organization_id = $4)
            and status = 'active'
            and (invoices_total is null or invoices_used < invoices_total)
          returning id, invoices_used, invoices_total, status, end_reason`,
        [discountId, nowIso, actorId, organizationId ?? null],
      )
    ).rows[0] ?? null
  );
}

export async function issueBrandInvoiceInTx(
  sql: SqlRunner,
  actor: InvoiceActor,
  v: ValidatedIssueInvoiceInput,
  nowDate: Date,
  subscriptionMeta?: Pick<SubscriptionInvoiceWriteMeta, 'dueOn' | 'collectionMethod' | 'subscriptionEpoch'>,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice }>> {
  const nowIso = nowDate.toISOString();
  const actorId = actor.kind === 'admin' ? actor.userId : null;
  if (!(await hasTables(sql, ['brand_invoices', 'brand_invoice_events']))) {
    return { ok: false, code: 'unavailable' };
  }
  const row = (await sql.query<InvoiceRow>('select * from brand_invoices where id = $1 for update', [v.invoiceId])).rows[0];
  if (!row) return { ok: false, code: 'not_found' };
  if (row.status !== 'draft') return { ok: false, code: 'conflict' };
  if (!invoiceRowConsistent(row)) {
    return { ok: false, code: 'conflict', detail: 'inconsistent_amounts' };
  }
  // Review round 4, B4: a subscription draft of a month that has ended is never issued (admin or job).
  if (
    subscriptionMeta &&
    String((row as unknown as { kind?: string }).kind ?? 'subscription') === 'subscription' &&
    String(row.period) < kstDayOf(nowDate).slice(0, 7)
  ) {
    return { ok: false, code: 'conflict', detail: 'period_ended' };
  }

  const memo = v.memo !== undefined ? v.memo : String(row.memo ?? '');
  const updated = (
    subscriptionMeta
      ? await sql.query<InvoiceRow>(
          `update brand_invoices
              set status = 'issued',
                  issued_at = $2::timestamptz,
                  issued_by = $3,
                  memo = $4,
                  updated_by = $3,
                  updated_at = $2::timestamptz,
                  due_on = $5::date,
                  collection_method = $6,
                  issued_via = $7,
                  subscription_epoch = coalesce($8, subscription_epoch)
            where id = $1 and status = 'draft'
            returning *`,
          [
            row.id,
            nowIso,
            actorId,
            memo,
            subscriptionMeta.dueOn,
            subscriptionMeta.collectionMethod,
            actor.kind,
            subscriptionMeta.subscriptionEpoch ?? null,
          ],
        )
      : await sql.query<InvoiceRow>(
          `update brand_invoices
              set status = 'issued',
                  issued_at = $2::timestamptz,
                  issued_by = $3,
                  memo = $4,
                  updated_by = $3,
                  updated_at = $2::timestamptz
            where id = $1 and status = 'draft'
            returning *`,
          [row.id, nowIso, actorId, memo],
        )
  ).rows[0];
  if (!updated) return { ok: false, code: 'conflict' };

  if (row.discount_id && Number(row.list_krw) > 0 && Number(row.discount_krw) > 0) {
    const consumed = await consumeBrandDiscountUse(
      sql,
      row.discount_id,
      nowIso,
      actorId,
      String(row.organization_id),
    );
    if (!consumed) {
      // Throw inside transaction so brand_invoices update rolls back cleanly.
      throw new BrandBillingDenied('conflict', 'discount_unavailable');
    }
  }

  await appendInvoiceEvent(sql, {
    invoiceId: row.id,
    organizationId: String(row.organization_id),
    action: 'issued',
    fromStatus: 'draft',
    toStatus: 'issued',
    snapshot: invoiceSnapshot(updated),
    note: memo,
    actorId,
    ...(subscriptionMeta ? { actorKind: actor.kind } : {}),
    createdAt: nowIso,
  });

  return { ok: true, invoice: mapInvoice(updated, nowDate) };
}

/**
 * Issue a `draft` invoice: re-validates derived/manual consistency, locks amounts (`draft` -> `issued`)
 * via conditional SQL UPDATE (`WHERE status = 'draft'`), and consumes one discount use on non-zero
 * invoices (`list_krw > 0 && discount_krw > 0`).
 */
export async function issueBrandInvoice(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice; reconcileDeferred?: boolean }>> {
  const parsed = IssueInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      // Review round 5, A1: for a subscribed organization the job is the only issuer of subscription invoices
      // (`brandSubscription.reconcile` runs it now; `reissuePeriod` re-issues a voided current month).
      if (brandBillingAutoIssueOpen(deps.env) && (await loadSubscriptionSchemaReady(sql))) {
        if (await subscriptionInvoiceOfSubscribedOrg(sql, v.invoiceId)) {
          return { ok: false as const, code: 'conflict' as const, detail: 'subscription_job_issues' };
        }
      }
      return issueBrandInvoiceInTx(sql, { kind: 'admin', userId: adminId }, v, nowDate);
    });
  } catch (error) {
    return outcomeError(error);
  }
}

/** A `kind='subscription'` invoice of an organization with a non-ended subscription (any period or epoch). */
async function subscriptionInvoiceOfSubscribedOrg(sql: SqlRunner, invoiceId: string): Promise<boolean> {
  const row = (
    await sql.query<{ kind: string }>(
      `select i.kind
         from brand_invoices i
         join brand_subscriptions s on s.organization_id = i.organization_id and s.status <> 'ended'
        where i.id = $1`,
      [invoiceId],
    )
  ).rows[0];
  return Boolean(row && row.kind === 'subscription');
}

const PaidAtSchema = z
  .string()
  .trim()
  .refine(
    (s) => isValidCalendarDay(s) || z.iso.datetime({ offset: true }).safeParse(s).success,
    'paidAt must be YYYY-MM-DD or ISO datetime with offset',
  )
  .transform((s) => (isValidCalendarDay(s) ? `${s}T00:00:00+09:00` : s));

const MarkPaidInput = z.object({
  invoiceId: UUID,
  paidAt: PaidAtSchema.optional(),
  paidMethod: z.string().trim().max(200).default(''),
  memo: z.string().trim().max(500).optional(),
});

/** Mark an `issued` invoice as `paid` (admin only). Only `issued -> paid` is allowed. */
export async function markBrandInvoicePaid(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice; reconcileDeferred?: boolean }>> {
  const parsed = MarkPaidInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();
  const paidAtIso = v.paidAt ?? nowIso;

  let txResult:
    | { ok: true; invoice: BrandInvoice; organizationId: string; adminId: string }
    | { ok: false; code: BrandBillingFailureCode; detail?: string };
  try {
    txResult = await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTables(sql, ['brand_invoices', 'brand_invoice_events']))) {
        return { ok: false as const, code: 'unavailable' as const };
      }
      const row = (await sql.query<InvoiceRow>('select * from brand_invoices where id = $1 for update', [v.invoiceId])).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      if (row.status !== 'issued') return { ok: false as const, code: 'conflict' as const };
      // Review round 5, B4: a subscribed organization's payment cannot be dated after today (KST).
      if (
        v.paidAt !== undefined &&
        kstDayOf(new Date(paidAtIso)) > kstDayOf(nowDate) &&
        brandBillingAutoIssueOpen(deps.env) &&
        (await loadSubscriptionSchemaReady(sql)) &&
        (
          await sql.query("select 1 from brand_subscriptions where organization_id = $1 and status <> 'ended' limit 1", [
            row.organization_id,
          ])
        ).rows[0]
      ) {
        return { ok: false as const, code: 'invalid' as const, detail: 'paid_at_in_future' };
      }

      const memo = v.memo !== undefined ? v.memo : String(row.memo ?? '');
      const updated = (
        await sql.query<InvoiceRow>(
          `update brand_invoices
              set status = 'paid',
                  paid_at = $2::timestamptz,
                  paid_by = $3,
                  paid_method = $4,
                  memo = $5,
                  updated_by = $3,
                  updated_at = $6::timestamptz
            where id = $1
            returning *`,
          [row.id, paidAtIso, adminId, v.paidMethod, memo, nowIso],
        )
      ).rows[0]!;

      await appendInvoiceEvent(sql, {
        invoiceId: row.id,
        organizationId: String(row.organization_id),
        action: 'paid',
        fromStatus: 'issued',
        toStatus: 'paid',
        snapshot: { ...invoiceSnapshot(updated), paidAt: paidAtIso, paidMethod: v.paidMethod },
        note: v.paidMethod || memo,
        actorId: adminId,
        createdAt: nowIso,
      });

      return {
        ok: true as const,
        invoice: mapInvoice(updated, nowDate),
        organizationId: String(row.organization_id),
        adminId,
      };
    });
  } catch (error) {
    return outcomeError(error);
  }

  if (!txResult.ok) return txResult;

  const reconcileDeferred = await maybeReconcileSubscriptionAfterCommit(
    deps.sql,
    deps.env,
    txResult.organizationId,
    txResult.adminId,
    nowDate,
  );
  return {
    ok: true as const,
    invoice: txResult.invoice,
    ...(reconcileDeferred ? { reconcileDeferred: true } : {}),
  };
}

const VoidInvoiceInput = z.object({
  invoiceId: UUID,
  reason: z.string().trim().min(1).max(500),
});

export async function voidBrandInvoiceInTx(
  sql: SqlRunner,
  actor: InvoiceActor,
  v: { invoiceId: string; reason: string },
  nowDate: Date,
  options: { recordActorKind?: boolean } = {},
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice; organizationId: string }>> {
  const nowIso = nowDate.toISOString();
  const actorId = actor.kind === 'admin' ? actor.userId : null;
  if (!(await hasTables(sql, ['brand_invoices', 'brand_invoice_events']))) {
    return { ok: false, code: 'unavailable' };
  }
  const row = (await sql.query<InvoiceRow>('select * from brand_invoices where id = $1 for update', [v.invoiceId])).rows[0];
  if (!row) return { ok: false, code: 'not_found' };
  if (row.status !== 'draft' && row.status !== 'issued') {
    return { ok: false, code: 'conflict' };
  }

  const updated = (
    await sql.query<InvoiceRow>(
      `update brand_invoices
          set status = 'void',
              voided_at = $2::timestamptz,
              voided_by = $3,
              void_reason = $4,
              updated_by = $3,
              updated_at = $2::timestamptz
        where id = $1 and status = $5
        returning *`,
      [row.id, nowIso, actorId, v.reason, row.status],
    )
  ).rows[0];
  if (!updated) return { ok: false, code: 'conflict' };

  if (row.status === 'issued' && row.discount_id && Number(row.list_krw) > 0 && Number(row.discount_krw) > 0) {
    const discount = (
      await sql.query<{
        id: string;
        organization_id: string;
        status: string;
        end_reason: string;
        invoices_total: number | null;
        invoices_used: number;
      }>(
        'select id, organization_id, status, end_reason, invoices_total, invoices_used from brand_discounts where id = $1 for update',
        [row.discount_id],
      )
    ).rows[0];
    if (discount && String(discount.organization_id) === String(row.organization_id) && Number(discount.invoices_used) > 0) {
      const nextUsed = Math.max(0, Number(discount.invoices_used) - 1);
      const hasOtherActive = Boolean(
        (
          await sql.query(
            "select 1 from brand_discounts where organization_id = $1 and status = 'active' and id <> $2 limit 1",
            [row.organization_id, discount.id],
          )
        ).rows[0],
      );
      const shouldReactivate =
        discount.status === 'ended' &&
        discount.end_reason === 'exhausted' &&
        !hasOtherActive &&
        (discount.invoices_total === null || nextUsed < Number(discount.invoices_total));
      await sql.query(
        shouldReactivate
          ? `update brand_discounts
                set invoices_used = $2, status = 'active', ended_at = null, ended_by = null, end_reason = ''
              where id = $1 and invoices_used > 0`
          : 'update brand_discounts set invoices_used = $2 where id = $1 and invoices_used > 0',
        [discount.id, nextUsed],
      );
    }
  }

  await appendInvoiceEvent(sql, {
    invoiceId: row.id,
    organizationId: String(row.organization_id),
    action: 'voided',
    fromStatus: row.status as BrandInvoiceStatus,
    toStatus: 'void',
    snapshot: invoiceSnapshot(updated),
    note: v.reason,
    actorId,
    ...(options.recordActorKind ? { actorKind: actor.kind } : {}),
    createdAt: nowIso,
  });

  return { ok: true, invoice: mapInvoice(updated, nowDate), organizationId: String(row.organization_id) };
}

/**
 * Void a `draft` or `issued` invoice (admin only).
 * If an `issued` invoice consumed a discount use, decrements `invoices_used` and restores an
 * auto-exhausted discount back to `active` if no newer active discount exists for the organization.
 */
export async function voidBrandInvoice(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice; reconcileDeferred?: boolean }>> {
  const parsed = VoidInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();

  let txResult:
    | { ok: true; invoice: BrandInvoice; organizationId: string; adminId: string }
    | { ok: false; code: BrandBillingFailureCode; detail?: string };
  try {
    txResult = await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      const res = await voidBrandInvoiceInTx(sql, { kind: 'admin', userId: adminId }, v, nowDate, {
        recordActorKind: false,
      });
      if (!res.ok) return res;
      return { ok: true as const, invoice: res.invoice, organizationId: res.organizationId, adminId };
    });
  } catch (error) {
    return outcomeError(error);
  }

  if (!txResult.ok) return txResult;

  const reconcileDeferred = await maybeReconcileSubscriptionAfterCommit(
    deps.sql,
    deps.env,
    txResult.organizationId,
    txResult.adminId,
    nowDate,
  );
  return {
    ok: true as const,
    invoice: txResult.invoice,
    ...(reconcileDeferred ? { reconcileDeferred: true } : {}),
  };
}

const CalendarDaySchema = z.string().trim().refine(isValidCalendarDay, 'invalid YYYY-MM-DD');

const RecordTaxInvoiceInput = z.object({
  invoiceId: UUID,
  issuedOn: CalendarDaySchema,
  ref: z.string().trim().min(1).max(120),
});

/**
 * Record manual Hometax tax invoice issuance (`issuedOn`, `ref`) on an `issued` or `paid` transfer invoice.
 * Gated behind `BRAND_BILLING_AUTO_ISSUE=on` and migration `0182`. Editable; records an audit event.
 */
export async function recordBrandInvoiceTaxInvoice(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ invoice: BrandInvoice; taxInvoiceIssuedOn: string; taxInvoiceRef: string }>> {
  const parsed = RecordTaxInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) {
        return { ok: false as const, code: 'disabled' as const };
      }
      if (!(await loadSubscriptionSchemaReady(sql))) {
        return { ok: false as const, code: 'unavailable' as const };
      }
      const row = (
        await sql.query<InvoiceRow & { collection_method?: string | null }>(
          'select * from brand_invoices where id = $1 for update',
          [v.invoiceId],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      const orgRow = (
        await sql.query<{ id: string; name: string }>(
          'select id::text as id, name from brand_organizations where id = $1',
          [row.organization_id],
        )
      ).rows[0];
      if (!orgRow) return { ok: false as const, code: 'not_found' as const };
      if (isSandboxedClientOrganization(orgRow)) {
        return { ok: false as const, code: 'invalid' as const, field: 'organizationId', detail: 'sandboxed_org' };
      }
      if (row.status !== 'issued' && row.status !== 'paid') {
        return { ok: false as const, code: 'conflict' as const, detail: 'invoice_not_issued_or_paid' };
      }
      if (row.collection_method !== null && row.collection_method !== undefined && row.collection_method !== 'transfer') {
        return { ok: false as const, code: 'conflict' as const, detail: 'card_uses_sales_slip' };
      }

      const updated = (
        await sql.query<InvoiceRow>(
          `update brand_invoices
              set tax_invoice_issued_on = $2::date,
                  tax_invoice_ref = $3,
                  updated_by = $4,
                  updated_at = $5::timestamptz
            where id = $1
            returning *`,
          [row.id, v.issuedOn, v.ref, adminId, nowIso],
        )
      ).rows[0]!;

      await appendInvoiceEvent(sql, {
        invoiceId: row.id,
        organizationId: String(row.organization_id),
        action: 'tax_invoice_recorded',
        fromStatus: row.status as BrandInvoiceStatus,
        toStatus: row.status as BrandInvoiceStatus,
        snapshot: {
          ...invoiceSnapshot(updated),
          taxInvoiceIssuedOn: v.issuedOn,
          taxInvoiceRef: v.ref,
        },
        note: `${v.issuedOn} · ${v.ref}`,
        actorId: adminId,
        actorKind: 'admin',
        createdAt: nowIso,
      });

      return {
        ok: true as const,
        invoice: mapInvoice(updated, nowDate),
        taxInvoiceIssuedOn: v.issuedOn,
        taxInvoiceRef: v.ref,
      };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function listBrandInvoices(
  sql: SqlRunner,
  options: {
    organizationId?: string;
    status?: BrandInvoiceStatus;
    overdueOnly?: boolean;
    now?: Date;
  } = {},
): Promise<BrandInvoice[]> {
  if (!(await hasTable(sql, 'brand_invoices'))) return [];
  const nowDate = options.now ?? new Date();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.organizationId) {
    if (!UUID.safeParse(options.organizationId).success) return [];
    params.push(options.organizationId);
    clauses.push(`organization_id = $${params.length}`);
  }
  if (options.overdueOnly) {
    const cutoff = new Date(nowDate.getTime() - BRAND_INVOICE_OVERDUE_DAYS * 86_400_000).toISOString();
    params.push(cutoff);
    clauses.push(`status = 'issued' and issued_at < $${params.length}::timestamptz`);
  } else if (options.status) {
    params.push(options.status);
    clauses.push(`status = $${params.length}`);
  }

  const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
  const { rows } = await sql.query<InvoiceRow>(
    `select * from brand_invoices ${where} order by period desc, created_at desc, id desc`,
    params,
  );
  return rows.map((r) => mapInvoice(r, nowDate));
}

export async function listBrandInvoiceEvents(sql: SqlRunner, invoiceId: string): Promise<BrandInvoiceEvent[]> {
  if (!UUID.safeParse(invoiceId).success) return [];
  if (!(await hasTable(sql, 'brand_invoice_events'))) return [];
  const { rows } = await sql.query<{
    id: string;
    invoice_id: string;
    organization_id: string;
    action: string;
    from_status: string | null;
    to_status: string;
    snapshot: Record<string, unknown>;
    note: string;
    actor_id: string | null;
    created_at: unknown;
  }>('select * from brand_invoice_events where invoice_id = $1 order by created_at asc, id asc', [invoiceId]);
  return rows.map((r) => ({
    id: String(r.id),
    invoiceId: String(r.invoice_id),
    organizationId: String(r.organization_id),
    action: r.action as BrandInvoiceEventAction,
    fromStatus: r.from_status ? (r.from_status as BrandInvoiceStatus) : null,
    toStatus: r.to_status as BrandInvoiceStatus,
    snapshot: (r.snapshot && typeof r.snapshot === 'object' ? r.snapshot : {}) as Record<string, unknown>,
    note: String(r.note ?? ''),
    actorId: r.actor_id ? String(r.actor_id) : null,
    createdAt: stamp(r.created_at) ?? new Date(0).toISOString(),
  }));
}

/**
 * Recompute invoice amounts in the current DB transaction for a draft invoice if plan, proration,
 * or active discount changed since D-7. Returns null if amounts are already up-to-date.
 */
export async function computeCurrentDraftRefreshInput(
  sql: SqlRunner,
  row: {
    id: string;
    organization_id: string;
    plan_id: string;
    base_list_krw: number;
    prorated_days: number | null;
    period_days: number | null;
    discount_id: string | null;
    discount_percent: number;
    manual_amounts: boolean;
  },
  targetPlanId: BrandPlanId,
  targetProrate: { usedDays: number; totalDays: number } | null,
): Promise<ValidatedUpdateDraftInvoiceInput | null> {
  // Review round 4, A: the job owns its drafts; manual amounts left by a flag-off edit are reset to the rule.
  const activeDiscount = (await hasTable(sql, 'brand_discounts'))
    ? (
        await sql.query<{
          id: string;
          percent: number;
          invoices_total: number | null;
          invoices_used: number;
        }>(
          "select id, percent, invoices_total, invoices_used from brand_discounts where organization_id = $1 and status = 'active' for share",
          [row.organization_id],
        )
      ).rows[0] ?? null
    : null;

  const usableDiscount =
    activeDiscount &&
    (activeDiscount.invoices_total === null ||
      Number(activeDiscount.invoices_used) < Number(activeDiscount.invoices_total))
      ? activeDiscount
      : null;

  const targetBaseListKrw = BRAND_PLANS[targetPlanId].monthlyKrw;
  const zeroBase = targetBaseListKrw === 0;
  const targetDiscountId = zeroBase || !usableDiscount ? null : String(usableDiscount.id);
  const targetDiscountPercent = zeroBase || !usableDiscount ? 0 : Number(usableDiscount.percent);
  const targetProratedDays = targetProrate ? targetProrate.usedDays : null;
  const targetPeriodDays = targetProrate ? targetProrate.totalDays : null;

  const unchanged =
    !row.manual_amounts &&
    row.plan_id === targetPlanId &&
    Number(row.base_list_krw) === targetBaseListKrw &&
    (row.prorated_days === null ? null : Number(row.prorated_days)) === targetProratedDays &&
    (row.period_days === null ? null : Number(row.period_days)) === targetPeriodDays &&
    (row.discount_id ?? null) === targetDiscountId &&
    Number(row.discount_percent) === targetDiscountPercent;

  if (unchanged) return null;

  return {
    invoiceId: row.id,
    planId: targetPlanId,
    baseListKrw: targetBaseListKrw,
    proratedDays: targetProratedDays,
    periodDays: targetPeriodDays,
    discountId: targetDiscountId,
    discountPercent: targetDiscountPercent,
    ...(row.manual_amounts ? { manualAmounts: false } : {}),
  };
}
