import { sqlCacheRoot, type SqlRunner } from '@/lib/db/sql-runner';
import { hasColumn, hasTables } from './schema-guard';

/**
 * Readiness of migration 0184 (workspace approvals, grant `kind` / `carried_from` / `trial_carry_checked_at`), and the one read the upload gate
 * needs. Kept apart from ./workspace-approval.ts so the gate does not pull the service in.
 *
 * Callers check `brandWorkspaceApprovalOpen()` first: with the flag off nothing here runs. A positive probe is cached
 * per database root; a negative one is not, so applying the migration takes effect at once.
 */
const READY = new WeakMap<object, true>();

export async function loadWorkspaceApprovalSchemaReady(sql: SqlRunner): Promise<boolean> {
  const root = sqlCacheRoot(sql);
  if (READY.get(root) === true) return true;
  if (!(await hasTables(sql, ['brand_workspace_approvals', 'brand_allowance_grants']))) return false;
  if (!(await hasColumn(sql, 'brand_allowance_grants', 'kind'))) return false;
  if (!(await hasColumn(sql, 'brand_allowance_grants', 'carried_from'))) return false;
  if (!(await hasColumn(sql, 'brand_allowance_grants', 'trial_carry_checked_at'))) return false;
  READY.set(root, true);
  return true;
}

/** True when an admin approved this organization's workspace. Call only once the schema is ready. */
export async function hasWorkspaceApproval(sql: SqlRunner, organizationId: string): Promise<boolean> {
  const row = (await sql.query('select 1 from brand_workspace_approvals where organization_id = $1', [organizationId])).rows[0];
  return Boolean(row);
}
