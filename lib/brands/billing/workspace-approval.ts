/**
 * Workspace approval and trial credits (docs/BRAND-RECURRING-BILLING.md §6.5; founder decision 2026-11-23), behind
 * `BRAND_WORKSPACE_APPROVAL` (default off) and migration 0184.
 *
 * - An admin approves a workspace once (`approveWorkspace`). In one transaction: the organization row is locked, the
 *   approval is recorded, and the trial grant (`BRAND_TRIAL_CREDITS` credits for the current KST month, `kind='trial'`)
 *   is written through the same grant insert the manual operation uses (./allowance.ts), then linked.
 * - The trial is usable through the last day of the month after approval: the hourly job (`carryTrialGrants`) moves
 *   what is left of it into the next month once. Plan credits are taken first, so what is left of the month's cap is
 *   what is left of the trial, at most the trial itself.
 * - An approved organization is exempt from the pre-approval upload limit for good (lib/brands/upload-gate.ts), so the
 *   limit does not come back when the trial runs out.
 *
 * Flag off: every entry point returns before its first query. Schema not ready: they return `unavailable` /
 * `schema_not_ready` / nothing, never throw. The allowance row (`brand_studio_allowances`) is never written here: an
 * organization on an explicit override keeps `source: 'override'` and receives the trial as a grant on top.
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { creditsOf, STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { studioEnv, type StudioEnv } from '@/lib/brand-studio/env';
import { loadAllowance, studioMonthWindow } from '@/lib/brand-studio/usage';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandWorkspaceApprovalOpen } from '@/lib/flags';
import { isSandboxedClientOrganization } from '../features';
import { BrandBillingDenied, requireDbAdmin } from './access';
import { insertAllowanceGrantInTx } from './allowance';
import { daysInYearMonth, diffCalendarDays, kstDayOf, kstMonthOf } from './math';
import { BRAND_TRIAL_CREDITS } from './plan-credits';
import type { BrandBillingOutcome } from './types';
import { loadWorkspaceApprovalSchemaReady } from './workspace-approval-schema';

type Env = Record<string, string | undefined>;

/** Internal reason codes on the grant rows (admin lists only; never shown to a customer). */
export const TRIAL_GRANT_REASON = 'workspace_trial';
export const TRIAL_CARRY_REASON = 'workspace_trial_carry';

export const DEFAULT_TRIAL_CARRY_PAGE = 100 as const;
export const DEFAULT_TRIAL_CARRY_MAX_PAGES = 10 as const;
export const DEFAULT_TRIAL_CARRY_BUDGET_MS = 10_000 as const;

export interface BrandWorkspaceApproval {
  organizationId: string;
  approvedAt: string;
  /** The KST day of `approvedAt`. */
  approvedOn: string;
  approvedBy: string | null;
  trialGrantId: string | null;
  note: string;
}

export interface BrandTrialGrant {
  id: string;
  kind: 'trial';
  /** The original trial grant this one carries; null on the original. */
  carriedFrom: string | null;
  amountKrw: number;
  credits: number;
  validMonth: string;
  /** Last KST day the grant counts (the end of `validMonth`). */
  validThrough: string;
  revokedAt: string | null;
  /** When the monthly carry evaluated this original (it is evaluated once); null on a carried grant or before. */
  carryCheckedAt: string | null;
}

export interface BrandTrialGrantView extends BrandTrialGrant {
  activeNow: boolean;
  /** KST days left including today; 0 when not active. */
  daysLeft: number;
}

export interface BrandWorkspaceApprovalPanel {
  enabled: boolean;
  schemaReady: boolean;
  approval: BrandWorkspaceApproval | null;
  /** The approving admin's e-mail (admin page only). */
  approverEmail: string | null;
  trial: {
    original: BrandTrialGrantView | null;
    carried: BrandTrialGrantView | null;
    /** The last KST day the trial can be used under the rule (end of the month after approval); null when revoked or absent. */
    usableThrough: string | null;
  };
}

export type TrialCarryResult =
  | { ok: true; skipped: 'disabled' | 'schema_not_ready' }
  | {
      ok: true;
      /** The month whose original trial grants were looked at (the previous KST month). */
      fromMonth: string;
      /** The month the carried grants count in (the current KST month). */
      month: string;
      checked: number;
      carried: number;
      carriedKrw: number;
      /** Fully used, or less than one credit left. */
      nothingLeft: number;
      /** Revoked before the carry looked at it. */
      revoked: number;
      /** From a month before the previous one (the job did not run in time): never carried. */
      expired: number;
      /** Already evaluated or carried by an overlapping run between the listing and the lock. */
      skipped: number;
      errors: number;
      budgetExhausted?: true;
    };

/** The carry's share of the hourly route: it runs after the subscription pass and never takes its time (B1b fix A2). */
export const ROUTE_TRIAL_CARRY_BUDGET_MS = 5_000 as const;

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function lastDayOf(month: string): string {
  return `${month}-${String(daysInYearMonth(month)).padStart(2, '0')}`;
}

function monthAfter(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

type ApprovalRow = {
  organization_id: string;
  approved_by: string | null;
  approved_at: unknown;
  trial_grant_id: string | null;
  note: string;
};

async function selectApproval(sql: SqlRunner, organizationId: string): Promise<BrandWorkspaceApproval | null> {
  const row = (
    await sql.query<ApprovalRow>(
      `select organization_id::text as organization_id, approved_by::text as approved_by, approved_at,
              trial_grant_id::text as trial_grant_id, note
         from brand_workspace_approvals
        where organization_id = $1`,
      [organizationId],
    )
  ).rows[0];
  if (!row) return null;
  const approvedAt = stamp(row.approved_at) ?? new Date(0).toISOString();
  return {
    organizationId: String(row.organization_id),
    approvedAt,
    approvedOn: kstDayOf(new Date(approvedAt)),
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    trialGrantId: row.trial_grant_id ? String(row.trial_grant_id) : null,
    note: String(row.note ?? ''),
  };
}

type GrantRow = {
  id: string;
  carried_from: string | null;
  amount_krw: number;
  valid_month: string;
  revoked_at: unknown;
  trial_carry_checked_at: unknown;
};
const GRANT_COLUMNS =
  'id::text as id, carried_from::text as carried_from, amount_krw, valid_month, revoked_at, trial_carry_checked_at';

function trialGrantOf(row: GrantRow): BrandTrialGrant {
  const amountKrw = Number(row.amount_krw);
  const validMonth = String(row.valid_month);
  return {
    id: String(row.id),
    kind: 'trial',
    carriedFrom: row.carried_from ? String(row.carried_from) : null,
    amountKrw,
    credits: creditsOf(amountKrw),
    validMonth,
    validThrough: lastDayOf(validMonth),
    revokedAt: stamp(row.revoked_at),
    carryCheckedAt: stamp(row.trial_carry_checked_at),
  };
}

async function selectTrialGrant(sql: SqlRunner, id: string | null): Promise<BrandTrialGrant | null> {
  if (!id) return null;
  const row = (
    await sql.query<GrantRow>(`select ${GRANT_COLUMNS} from brand_allowance_grants where id = $1 and kind = 'trial'`, [id])
  ).rows[0];
  return row ? trialGrantOf(row) : null;
}

const ApproveInput = z.object({
  organizationId: z.string().uuid(),
  note: z.string().trim().max(500).default(''),
});

/**
 * Admin only (the profile row decides). Idempotent: a second call returns the existing approval and grants nothing.
 * Refuses sandboxed organizations (`forbidden`, detail `sandboxed_organization`).
 */
export async function approveWorkspace(
  deps: { sql: SqlRunner; now?: () => Date; env?: Env },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ created: boolean; approval: BrandWorkspaceApproval; trialGrant: BrandTrialGrant | null }>> {
  if (!brandWorkspaceApprovalOpen(deps.env)) return { ok: false, code: 'disabled' };
  const parsed = ApproveInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await loadWorkspaceApprovalSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };
      // The same lock strength the subscription engine takes: it waits for a reservation and for another approval.
      const org = (
        await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1 for no key update', [
          v.organizationId,
        ])
      ).rows[0];
      if (!org) return { ok: false as const, code: 'not_found' as const };
      if (isSandboxedClientOrganization({ id: String(org.id), name: String(org.name) })) {
        return { ok: false as const, code: 'forbidden' as const, detail: 'sandboxed_organization' };
      }

      const existing = await selectApproval(sql, v.organizationId);
      if (existing) {
        return { ok: true as const, created: false, approval: existing, trialGrant: await selectTrialGrant(sql, existing.trialGrantId) };
      }
      const inserted = (
        await sql.query(
          `insert into brand_workspace_approvals (organization_id, approved_by, approved_at, note)
             values ($1, $2, $3::timestamptz, $4)
           on conflict (organization_id) do nothing
           returning organization_id`,
          [v.organizationId, adminId, now.toISOString(), v.note],
        )
      ).rows[0];
      if (!inserted) {
        const raced = (await selectApproval(sql, v.organizationId))!;
        return { ok: true as const, created: false, approval: raced, trialGrant: await selectTrialGrant(sql, raced.trialGrantId) };
      }

      const grant = await insertAllowanceGrantInTx(
        sql,
        {
          organizationId: v.organizationId,
          amountKrw: BRAND_TRIAL_CREDITS * STUDIO_CREDIT_KRW,
          validMonth: kstMonthOf(now),
          reason: TRIAL_GRANT_REASON,
        },
        { createdBy: adminId, now, kind: 'trial', carriedFrom: null },
      );
      // The amount is fixed and the month is the current one, so the grant checks cannot fail.
      if (!grant.ok) throw new Error(`trial_grant_invalid:${grant.field}`);
      // `null`: an original trial grant already exists (one per organization, revoked or not): link it, grant nothing.
      const trialGrantId =
        grant.id ??
        (
          await sql.query<{ id: string }>(
            "select id::text as id from brand_allowance_grants where organization_id = $1 and kind = 'trial' and carried_from is null",
            [v.organizationId],
          )
        ).rows[0]?.id ??
        null;
      await sql.query('update brand_workspace_approvals set trial_grant_id = $2 where organization_id = $1', [v.organizationId, trialGrantId]);
      const approval = (await selectApproval(sql, v.organizationId))!;
      return { ok: true as const, created: true, approval, trialGrant: await selectTrialGrant(sql, trialGrantId) };
    });
  } catch (error) {
    if (error instanceof BrandBillingDenied) return { ok: false, code: error.code };
    throw error;
  }
}

/** The approval of one organization, or null (flag off, schema not ready, not approved). */
export async function loadWorkspaceApproval(
  sql: SqlRunner,
  organizationId: string,
  options: { env?: Env } = {},
): Promise<BrandWorkspaceApproval | null> {
  if (!brandWorkspaceApprovalOpen(options.env)) return null;
  if (!z.string().uuid().safeParse(organizationId).success) return null;
  if (!(await loadWorkspaceApprovalSchemaReady(sql))) return null;
  return selectApproval(sql, organizationId);
}

/**
 * What the admin organization page shows (the card itself is a separate task): the approval and its date, the original
 * trial grant and its carry, each with its remaining validity, and the last day the trial can be used.
 */
export async function loadWorkspaceApprovalPanel(
  sql: SqlRunner,
  organizationId: string,
  options: { now?: Date; env?: Env } = {},
): Promise<BrandWorkspaceApprovalPanel> {
  const empty = { original: null, carried: null, usableThrough: null };
  if (!brandWorkspaceApprovalOpen(options.env)) return { enabled: false, schemaReady: false, approval: null, approverEmail: null, trial: empty };
  if (!z.string().uuid().safeParse(organizationId).success || !(await loadWorkspaceApprovalSchemaReady(sql))) {
    return { enabled: true, schemaReady: false, approval: null, approverEmail: null, trial: empty };
  }
  const now = options.now ?? new Date();
  const month = kstMonthOf(now);
  const today = kstDayOf(now);
  const view = (grant: BrandTrialGrant | null): BrandTrialGrantView | null => {
    if (!grant) return null;
    const activeNow = grant.revokedAt === null && grant.validMonth === month;
    return { ...grant, activeNow, daysLeft: activeNow ? diffCalendarDays(grant.validThrough, today) + 1 : 0 };
  };
  const approval = await selectApproval(sql, organizationId);
  const originalRow = (
    await sql.query<GrantRow>(
      `select ${GRANT_COLUMNS} from brand_allowance_grants where organization_id = $1 and kind = 'trial' and carried_from is null`,
      [organizationId],
    )
  ).rows[0];
  const original = originalRow ? trialGrantOf(originalRow) : null;
  const carriedRow = original
    ? (await sql.query<GrantRow>(`select ${GRANT_COLUMNS} from brand_allowance_grants where carried_from = $1`, [original.id])).rows[0]
    : undefined;
  const carried = carriedRow ? trialGrantOf(carriedRow) : null;
  const approverEmail = approval?.approvedBy
    ? ((await sql.query<{ email: string | null }>('select email from profiles where id = $1', [approval.approvedBy])).rows[0]?.email ?? null)
    : null;
  return {
    enabled: true,
    schemaReady: true,
    approval,
    approverEmail,
    trial: { original: view(original), carried: view(carried), usableThrough: usableThrough(original, carried) },
  };
}

/**
 * The last day the trial can still be used, from whichever grant is (or may become) active: the carried grant while it
 * is not revoked; else the original while it is not revoked — through the next month while its carry is still to
 * come, through its own month once the carry found nothing left. Null when both are revoked or there is no trial.
 */
function usableThrough(original: BrandTrialGrant | null, carried: BrandTrialGrant | null): string | null {
  if (carried && carried.revokedAt === null) return carried.validThrough;
  if (!original || original.revokedAt !== null) return null;
  if (carried) return original.validThrough; // the carry was revoked on its own
  return original.carryCheckedAt === null ? lastDayOf(monthAfter(original.validMonth)) : original.validThrough;
}

/**
 * The monthly carry (hourly job, `BRAND_WORKSPACE_APPROVAL` only). Each ORIGINAL trial grant is evaluated exactly once,
 * after its month has ended, and stamped `trial_carry_checked_at` in the same transaction whatever the outcome:
 * - from the previous KST month, not revoked: remainder = max(0, min(trial, cap − used)), cap and used being
 *   `loadAllowance` at the last instant of that month; a remainder of at least one credit becomes ONE grant for the
 *   current month (`kind='trial'`, `carried_from` = the original), rounded down to whole credits; less is "nothing left";
 * - revoked: not carried; from an earlier month (the job did not run in time): expired, not carried.
 * Evaluating once is what makes a later change of the cap (an override, a new default, a plan) unable to turn "nothing
 * left" into a second trial, and keeps the job from re-locking the same organizations every hour.
 *
 * Idempotent under repeated and overlapping runs: each organization in its own transaction under its row lock, the
 * original re-read `FOR UPDATE` and re-checked, and the unique index on `carried_from` behind both. A carried grant is
 * never a candidate. Pages through the candidates in id order within a time budget; returns counts only.
 */
export async function carryTrialGrants(deps: {
  sql: SqlRunner;
  now?: () => Date;
  env?: Env;
  /** The allowance inputs `loadAllowance` needs; read from the environment when absent. */
  studio?: Pick<StudioEnv, 'defaultMonthlyKrw'> & { planGraceDays?: number };
  pageSize?: number;
  maxPages?: number;
  budgetMs?: number;
}): Promise<TrialCarryResult> {
  if (!brandWorkspaceApprovalOpen(deps.env)) return { ok: true, skipped: 'disabled' };
  const { sql } = deps;
  if (!(await loadWorkspaceApprovalSchemaReady(sql))) return { ok: true, skipped: 'schema_not_ready' };

  const now = deps.now?.() ?? new Date();
  const monthStart = studioMonthWindow(now).start;
  const lastInstant = new Date(monthStart.getTime() - 1);
  const month = kstMonthOf(now);
  const fromMonth = kstMonthOf(lastInstant);
  const studio = deps.studio ?? studioEnv(deps.env ?? process.env);
  const pageSize = Math.max(1, Math.min(500, Math.floor(deps.pageSize ?? DEFAULT_TRIAL_CARRY_PAGE)));
  const maxPages = Math.max(1, Math.floor(deps.maxPages ?? DEFAULT_TRIAL_CARRY_MAX_PAGES));
  const deadline = Date.now() + Math.max(500, deps.budgetMs ?? DEFAULT_TRIAL_CARRY_BUDGET_MS);

  const result = {
    ok: true as const,
    fromMonth,
    month,
    checked: 0,
    carried: 0,
    carriedKrw: 0,
    nothingLeft: 0,
    revoked: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
  };
  let budgetExhausted = false;
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const candidates: Array<{ id: string; organization_id: string }> = (
      await sql.query<{ id: string; organization_id: string }>(
        `select g.id::text as id, g.organization_id::text as organization_id
           from brand_allowance_grants g
          where g.kind = 'trial'
            and g.carried_from is null
            and g.trial_carry_checked_at is null
            and g.valid_month <= $1
            and ($2::uuid is null or g.id > $2::uuid)
          order by g.id asc
          limit $3`,
        [fromMonth, after, pageSize],
      )
    ).rows;
    for (const candidate of candidates) {
      if (Date.now() >= deadline) {
        budgetExhausted = true;
        break;
      }
      result.checked += 1;
      try {
        const outcome = await sql.transaction(async (tx) => {
          await tx.query('select id from brand_organizations where id = $1 for no key update', [candidate.organization_id]);
          const original = (
            await tx.query<{
              kind: string;
              carried_from: string | null;
              amount_krw: number;
              valid_month: string;
              revoked_at: unknown;
              trial_carry_checked_at: unknown;
              carried: boolean;
            }>(
              `select g.kind, g.carried_from::text as carried_from, g.amount_krw, g.valid_month, g.revoked_at,
                      g.trial_carry_checked_at,
                      exists (select 1 from brand_allowance_grants c where c.carried_from = g.id) as carried
                 from brand_allowance_grants g
                where g.id = $1
                for update`,
              [candidate.id],
            )
          ).rows[0];
          // Evaluated by an overlapping run in the meantime (or not an original any more): nothing to do, nothing to stamp.
          if (!original || original.kind !== 'trial' || original.carried_from !== null || original.trial_carry_checked_at != null) {
            return 'skipped' as const;
          }
          const stampChecked = () =>
            tx.query('update brand_allowance_grants set trial_carry_checked_at = $2::timestamptz where id = $1', [candidate.id, now.toISOString()]);
          if (original.valid_month > fromMonth) return 'skipped' as const; // its month has not ended yet
          if (original.carried) {
            await stampChecked();
            return 'skipped' as const;
          }
          if (original.revoked_at != null) {
            await stampChecked();
            return 'revoked' as const;
          }
          if (original.valid_month < fromMonth) {
            await stampChecked();
            return 'expired' as const;
          }
          const allowance = await loadAllowance(tx, candidate.organization_id, studio, lastInstant);
          const trialKrw = Number(original.amount_krw);
          const remainder = Math.max(0, Math.min(trialKrw, allowance.capKrw - allowance.usedKrw));
          const amountKrw = Math.floor(remainder / STUDIO_CREDIT_KRW) * STUDIO_CREDIT_KRW;
          if (amountKrw < STUDIO_CREDIT_KRW) {
            await stampChecked();
            return 'nothing' as const;
          }
          const grant = await insertAllowanceGrantInTx(
            tx,
            { organizationId: candidate.organization_id, amountKrw, validMonth: month, reason: TRIAL_CARRY_REASON },
            { createdBy: null, now, kind: 'trial', carriedFrom: candidate.id },
          );
          if (!grant.ok) throw new Error(`trial_carry_invalid:${grant.field}`);
          await stampChecked();
          return grant.id ? { carriedKrw: amountKrw } : ('skipped' as const);
        });
        if (typeof outcome === 'object') {
          result.carried += 1;
          result.carriedKrw += outcome.carriedKrw;
        } else if (outcome === 'nothing') {
          result.nothingLeft += 1;
        } else if (outcome === 'revoked') {
          result.revoked += 1;
        } else if (outcome === 'expired') {
          result.expired += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.errors += 1;
        // Counts-only logs: a database message can quote a row's values, so ids are masked.
        console.warn(
          '[brand-billing-tick] trial_carry_failed',
          JSON.stringify({ message: error instanceof Error ? error.message.replace(UUID_IN_TEXT, '<id>').slice(0, 120) : 'unknown' }),
        );
      }
    }
    if (budgetExhausted || candidates.length < pageSize) break;
    after = candidates[candidates.length - 1]!.id;
  }
  return budgetExhausted ? { ...result, budgetExhausted: true } : result;
}
