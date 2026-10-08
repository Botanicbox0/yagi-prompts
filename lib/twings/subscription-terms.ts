import type { SqlRunner } from '@/lib/db/sql-runner';
import { getCreatorPlanVersion, type CreatorPlanVersion } from './subscription-versions';

/** Server-side archive lookup. Never authorizes a charge or grants credits. */
export async function loadCreatorSubscriptionTerms(sql: SqlRunner, userId: string, agreementId: string) {
  const { rows } = await sql.query<{
    snapshot: CreatorPlanVersion; legal_version: string; agreed_at: Date | string;
  }>(`select p.snapshot, t.legal_version, t.agreed_at
      from creator_subscription_terms t join creator_plan_versions p on p.version_id = t.plan_version_id
      where t.id = $1 and t.user_id = $2`, [agreementId, userId]);
  const row = rows[0];
  if (!row) return null;
  const known = getCreatorPlanVersion(row.snapshot.id);
  // Unknown or rewritten source versions fail closed; never substitute the current plan.
  if (!known || Object.keys(row.snapshot).length !== Object.keys(known).length ||
    Object.entries(known).some(([key, value]) => row.snapshot[key as keyof CreatorPlanVersion] !== value)) {
    throw new Error('Creator plan archive mismatch');
  }
  return { agreementId, plan: known, legalVersion: row.legal_version, agreedAt: new Date(row.agreed_at).toISOString() };
}
