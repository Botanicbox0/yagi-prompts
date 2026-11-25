import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { hasStaffReadAccess } from '@/lib/brands/workspace/staff';
import { TEAM_PROJECTS } from '@/lib/brands/project-origin';
import { koreaMidnight, scopeSha256 } from './schemas';
import type { UsageFailureCode, UsageGrantState, UsageOutcome, UsageScope } from './types';
import { usageRuntimeFromEnv, type UsageRuntime } from './runtime';

/**
 * Shared internals of brand secondary usage: who holds which seat, the basis every quote, acceptance
 * and grant is checked against, and the activation guard. docs/SECONDARY-USAGE.md.
 */
export type Row = Record<string, unknown>;
export class Denied extends Error { constructor(readonly code: UsageFailureCode) { super(code); } }
export const uuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;
export const stamp = (v: unknown): string => v instanceof Date ? v.toISOString() : String(v);
export const nullableStamp = (v: unknown): string | null => v == null ? null : stamp(v);
export const fail = (code: UsageFailureCode) => ({ ok: false as const, code });
export const clock = (deps: { now?: Date }) => deps.now ?? new Date();

export async function profile(sql: SqlRunner, userId: string, write = false): Promise<Row> {
  const row = (await sql.query(`select id,is_admin,email from profiles where id=$1 ${write ? 'for update' : 'for share'}`, [userId])).rows[0];
  if (!row) throw new Denied('sign_in_required');
  return row;
}
export async function studio(sql: SqlRunner, userId: string): Promise<void> {
  if ((await profile(sql, userId)).is_admin !== true) throw new Denied('forbidden');
}

export async function mutation<S extends z.ZodType, T>(sql: SqlRunner, viewer: Viewer, schema: S, input: unknown,
  perform: (tx: SqlRunner, userId: string, value: z.output<S>) => Promise<T>): Promise<UsageOutcome<T>> {
  if (!uuid(viewer.userId)) return fail('sign_in_required');
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  try {
    return await sql.transaction(async tx => {
      await profile(tx, viewer.userId!, true);
      return { ok: true as const, ...await perform(tx, viewer.userId!, parsed.data) };
    });
  } catch (error) {
    if (error instanceof Denied) return fail(error.code);
    if ((error as { code?: string }).code === '23505') return fail('conflict');
    throw error;
  }
}

/**
 * The customer's seat on a campaign: an ACTIVE organization membership of the campaign's own brand,
 * on a campaign shared with the client. Campaign-only guests hold no seat here (secondary usage is a
 * commercial matter of the brand), and neither does an `is_admin` account without a membership.
 * The organization always comes from the project row, never from the request.
 */
export async function seat(sql: SqlRunner, userId: string, projectId: string, lock: 'share' | 'update' = 'share'): Promise<{ role: 'owner' | 'editor' | 'viewer'; project: Row }> {
  const project = (await sql.query(`select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id
    where p.id=$1 for ${lock} of p`, [projectId])).rows[0];
  if (!project || !project.client_visible) throw new Denied('not_found');
  const m = (await sql.query("select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active' for share", [project.organization_id, userId])).rows[0];
  if (!m) throw new Denied('not_found');
  return { role: m.role as 'owner' | 'editor' | 'viewer', project };
}
/** Owners and editors write (ask, reply, withdraw). Viewers read. */
export async function writer(sql: SqlRunner, userId: string, projectId: string) {
  const s = await seat(sql, userId, projectId);
  if (s.role === 'viewer') throw new Denied('forbidden');
  if (s.project.status === 'cancelled') throw new Denied('not_active');
  return s;
}
/**
 * Who may accept a quote and pay: the brand's active owner, or an active editor the studio recorded as
 * a buyer on documented authority (`brand_usage_buyers`). Default deny; see docs/SECONDARY-USAGE.md.
 * Never an `is_admin` account, even one holding a customer seat: the studio records the creator's
 * consent and issues the price, so it must not also accept or pay that price for the customer.
 * (Reading and the case thread keep the workspace's member-first rule.)
 */
export async function isBuyer(sql: SqlRunner, organizationId: string, userId: string, role: string): Promise<boolean> {
  if ((await profile(sql, userId)).is_admin === true) return false;
  if (role === 'owner') return true;
  if (role !== 'editor') return false;
  return (await sql.query("select 1 from brand_usage_buyers where organization_id=$1 and user_id=$2 and revoked_at is null", [organizationId, userId])).rows.length > 0;
}
export async function buyer(sql: SqlRunner, userId: string, projectId: string) {
  const s = await writer(sql, userId, projectId);
  if (!await isBuyer(sql, String(s.project.organization_id), userId, s.role)) throw new Denied('forbidden');
  return s;
}
/** Read access: the customer's seat, else the TWINGS team's read-only view (./staff.ts). */
export async function readable(sql: SqlRunner, userId: string, projectId: string, verifiedEmail?: string): Promise<{ role: 'owner' | 'editor' | 'viewer' | 'studio'; project: Row }> {
  try { return await seat(sql, userId, projectId); }
  catch (error) {
    if (!(error instanceof Denied) || error.code !== 'not_found') throw error;
    if (!await hasStaffReadAccess(sql, userId, verifiedEmail)) throw error;
    // Team projects only: a brand's own studio project answers like a missing one (lib/brands/project-origin.ts).
    const project = (await sql.query(`select tp.* from brand_projects tp where tp.id=$1 and ${TEAM_PROJECTS('tp')}`, [projectId])).rows[0];
    if (!project) throw error;
    return { role: 'studio', project };
  }
}

export async function lockCase(sql: SqlRunner, caseId: string): Promise<Row> {
  const row = (await sql.query('select * from brand_usage_cases where id=$1 for update', [caseId])).rows[0];
  if (!row) throw new Denied('not_found');
  return row;
}
export async function setStatus(sql: SqlRunner, row: Row, status: string, extra: { closeReason?: string | null; blockedReason?: string | null } = {}) {
  await sql.query(`update brand_usage_cases set status=$2,revision=revision+1,updated_at=now(),
    close_reason=$3,blocked_reason=$4 where id=$1`, [row.id, status, status === 'closed' ? extra.closeReason : null, extra.blockedReason ?? null]);
}
export async function usageEvent(sql: SqlRunner, caseId: unknown, kind: string, actor: 'brand' | 'studio' | 'system', userId: string | null, quoteId: unknown = null) {
  await sql.query('insert into brand_usage_events(case_id,kind,quote_id,actor,created_by) values($1,$2,$3,$4,$5)', [caseId, kind, quoteId, actor, userId]);
}

export async function latestScope(sql: SqlRunner, caseId: unknown): Promise<Row | null> {
  return (await sql.query('select * from brand_usage_scope_revisions where case_id=$1 order by revision desc limit 1', [caseId])).rows[0] ?? null;
}
export async function latestCompensation(sql: SqlRunner, caseId: unknown, scopeRevisionId: unknown): Promise<Row | null> {
  return (await sql.query('select * from brand_usage_compensations where case_id=$1 and scope_revision_id=$2 order by revision desc limit 1', [caseId, scopeRevisionId])).rows[0] ?? null;
}

/** Every pinned subject still resolves to exactly the bytes or post the scope named. */
export async function checkPins(sql: SqlRunner, projectId: unknown, scope: UsageScope): Promise<void> {
  for (const item of scope.items) {
    const s = item.subject;
    if (s.kind === 'content_version') {
      const r = (await sql.query('select asset_sha256 from brand_content_versions where project_id=$1 and id=$2', [projectId, s.contentVersionId])).rows[0];
      if (!r || r.asset_sha256 !== s.assetSha256) throw new Denied('subject_unpinned');
    } else if (s.kind === 'original_post') {
      const r = (await sql.query('select url,platform,platform_post_id from brand_posts where project_id=$1 and id=$2', [projectId, s.postId])).rows[0];
      if (!r || r.url !== s.url || r.platform_post_id !== s.platformPostId) throw new Denied('subject_unpinned');
    } else {
      const r = (await sql.query("select sha256 from brand_attachments where project_id=$1 and id=$2 and status='ready' and access_scope='workspace'", [projectId, s.attachmentId])).rows[0];
      if (!r || r.sha256 !== s.assetSha256) throw new Denied('subject_unpinned');
    }
  }
}
/** The customer-shared terms PDF of this campaign, unchanged since it was pinned. */
export async function checkTerms(sql: SqlRunner, projectId: unknown, contractId: unknown, sha256?: unknown): Promise<string> {
  const r = (await sql.query(`select a.sha256 from brand_contract_documents d join brand_attachments a on a.project_id=d.project_id and a.id=d.attachment_id
    where d.project_id=$1 and d.id=$2 and d.shared=true and a.status='ready' and a.mime='application/pdf'`, [projectId, contractId])).rows[0];
  if (!r || (sha256 !== undefined && r.sha256 !== sha256)) throw new Denied('terms_unavailable');
  return String(r.sha256);
}
/**
 * The basis of an issued quote, re-checked at acceptance, before charging and after payment:
 * the exact scope revision (still the latest, hash intact), the very consents snapshotted into the
 * quote (still live, on this hash, backed by the latest compensation of this revision), the pins
 * and the shared terms. It never changes a term; it only says whether the accepted terms still hold.
 */
export async function checkQuoteBasis(sql: SqlRunner, quote: Row, at?: Date): Promise<UsageScope> {
  const scopeRow = await latestScope(sql, quote.case_id);
  if (!scopeRow || scopeRow.id !== quote.scope_revision_id || scopeRow.scope_sha256 !== quote.scope_sha256 || scopeSha256(scopeRow.scope) !== quote.scope_sha256) throw new Denied('conflict');
  const scope = scopeRow.scope as UsageScope;
  const compensation = await latestCompensation(sql, quote.case_id, quote.scope_revision_id);
  const consents = (await sql.query('select * from brand_usage_consents where id=any($1::uuid[])', [quote.consent_ids])).rows;
  for (const item of scope.items) {
    const c = consents.find(x => x.item_id === item.itemId);
    if (!c || c.withdrawn_at != null || c.scope_sha256 !== quote.scope_sha256 || c.scope_revision_id !== quote.scope_revision_id || !compensation || c.compensation_id !== compensation.id) throw new Denied('consent_missing');
  }
  await checkPins(sql, quote.project_id, scope);
  await checkTerms(sql, quote.project_id, quote.terms_contract_id, quote.terms_sha256);
  // Before a charge (`at` given): a fixed window that already ended cannot be sold. After payment the
  // guard re-checks only the accepted terms, so a window ending mid-approval never rewrites them.
  if (at && !windowsOpen(scope, at)) throw new Denied('expired');
  return scope;
}

/** Exclusive end of a fixed window: 00:00 Korea time on the day after its last licensed day. */
export const fixedWindowEnd = (endsOn: string) => new Date(+koreaMidnight(endsOn) + 86400000);
/** Every fixed window still has time left at `at`. "From first use" windows have not started, so they are open. */
export function windowsOpen(scope: UsageScope, at: Date): boolean {
  return scope.items.every(i => i.timing.kind !== 'fixed' || at < fixedWindowEnd(i.timing.endsOn));
}
/** The latest instant a quote may stay acceptable: the end of its earliest fixed window (null: no fixed window). */
export function latestAcceptance(scope: UsageScope): Date | null {
  const ends = scope.items.flatMap(i => i.timing.kind === 'fixed' ? [+fixedWindowEnd(i.timing.endsOn)] : []);
  return ends.length ? new Date(Math.min(...ends)) : null;
}

export function scopeFeatures(scope: UsageScope) {
  const days = scope.items.map(i => i.timing.kind === 'first_use' ? i.timing.durationDays
    : Math.round((+koreaMidnight(i.timing.endsOn) - +koreaMidnight(i.timing.startsOn)) / 86400000) + 1);
  return {
    itemCount: scope.items.length,
    usageKinds: [...new Set(scope.items.flatMap(i => i.usageKinds))].sort(),
    channelCounts: scope.items.map(i => i.channels.length),
    territory: [...new Set(scope.items.flatMap(i => i.territory))].sort(),
    durationDays: days, timingKinds: scope.items.map(i => i.timing.kind), edits: scope.items.map(i => i.edits),
  };
}
/**
 * One comparable outcome per case, from its FINAL quote only (docs/SECONDARY-USAGE.md, future estimates).
 * Brand price only. A later refund is the only change it can take.
 */
export async function recordOutcome(sql: SqlRunner, quote: Row, outcome: 'paid' | 'declined' | 'expired' | 'closed') {
  const scope = (await sql.query('select scope from brand_usage_scope_revisions where id=$1', [quote.scope_revision_id])).rows[0]?.scope as UsageScope | undefined;
  if (!scope) return;
  await sql.query(`insert into brand_usage_outcomes(case_id,quote_id,scope_revision_id,outcome,total_krw,tax_basis,features)
    values($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict(case_id) do nothing`,
    [quote.case_id, quote.id, quote.scope_revision_id, outcome, quote.total_krw, quote.tax_basis, JSON.stringify(scopeFeatures(scope))]);
}

export function grantState(row: Row, events: Row[], now: Date): UsageGrantState {
  const mine = events.filter(e => e.grant_id === row.id).sort((a, b) => +new Date(stamp(a.created_at)) - +new Date(stamp(b.created_at)));
  if (mine.some(e => e.kind === 'terminated')) return 'terminated';
  const hold = mine.filter(e => e.kind === 'suspended' || e.kind === 'resumed').at(-1);
  if (hold?.kind === 'suspended') return 'suspended';
  if (row.starts_at == null) return 'pending_start';
  if (now < new Date(stamp(row.starts_at))) return 'scheduled';
  if (now < new Date(stamp(row.ends_at))) return 'active';
  return 'expired';
}

/**
 * The activation guard, the ONLY writer of grants. Runs after a matched, provider-confirmed payment,
 * and again from reconcile or a studio re-check. Idempotent. All or nothing per case: any failed check
 * leaves the case `blocked_after_payment` with an internal reason and no grant at all.
 */
export async function activateUsageCase(sql: SqlRunner, caseId: unknown, actor: 'system' | 'studio' = 'system', userId: string | null = null, runtime: UsageRuntime = usageRuntimeFromEnv()): Promise<string> {
  return sql.transaction(async tx => {
    const c = await lockCase(tx, String(caseId));
    if (c.status !== 'paid') return String(c.status);
    const quote = (await tx.query("select * from brand_usage_quotes where case_id=$1 and status='accepted'", [c.id])).rows[0];
    const payment = quote && (await tx.query("select * from brand_usage_payments where quote_id=$1 and status='paid'", [quote.id])).rows[0];
    let scope: UsageScope;
    try {
      if (!quote || !payment || Number(payment.amount_krw) !== Number(quote.total_krw)) throw new Denied('amount_mismatch');
      // A production deployment grants binding use only for real money. A test-key or fake approval,
      // however it reached `paid` (direct call, reconcile, studio re-check), never becomes a grant there.
      if (runtime.production && payment.environment !== 'live') throw new Denied('non_live_payment');
      if (quote.tax_basis !== 'included') throw new Denied('not_payable');
      scope = await checkQuoteBasis(tx, quote);
    } catch (error) {
      if (!(error instanceof Denied)) throw error;
      await setStatus(tx, c, 'blocked_after_payment', { blockedReason: error.code });
      await usageEvent(tx, c.id, 'blocked', actor, userId, quote?.id ?? null);
      return 'blocked_after_payment';
    }
    const consents = (await tx.query('select id,item_id from brand_usage_consents where id=any($1::uuid[])', [quote.consent_ids])).rows;
    for (const item of scope.items) {
      const fixed = item.timing.kind === 'fixed' ? item.timing : null;
      const starts = fixed ? koreaMidnight(fixed.startsOn) : null;
      // Exclusive end: the day after the last licensed day, 00:00 Korea time.
      const ends = fixed ? new Date(+koreaMidnight(fixed.endsOn) + 86400000) : null;
      await tx.query(`insert into brand_usage_grants(case_id,item_id,quote_id,payment_id,organization_id,project_id,scope_revision_id,scope_sha256,
        terms_contract_id,terms_sha256,consent_id,subject,starts_at,ends_at,duration_days)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) on conflict(quote_id,item_id) do nothing`,
        [c.id, item.itemId, quote.id, payment.id, c.organization_id, c.project_id, quote.scope_revision_id, quote.scope_sha256,
          quote.terms_contract_id, quote.terms_sha256, consents.find(x => x.item_id === item.itemId)!.id, JSON.stringify(item.subject),
          starts, ends, item.timing.kind === 'first_use' ? item.timing.durationDays : null]);
    }
    await setStatus(tx, c, 'fulfilled');
    await usageEvent(tx, c.id, 'activated', actor, userId, quote.id);
    return 'fulfilled';
  });
}
