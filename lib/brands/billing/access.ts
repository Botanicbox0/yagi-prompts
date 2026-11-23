import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { isSandboxedClientOrganization } from '../features';
import type { BrandBillingFailureCode } from './types';

const UUID = z.string().uuid();

export class BrandBillingDenied extends Error {
  constructor(
    readonly code: BrandBillingFailureCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}:${detail}` : code);
    this.name = 'BrandBillingDenied';
  }
}

export interface BrandBillingSeat {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: 'owner' | 'admin';
}

/**
 * Verify that `viewer` is a DB-confirmed administrator (`profiles.is_admin === true`).
 * Never trusts `viewer.isAdmin` alone; always reads the `profiles` row inside the transaction.
 */
export async function requireDbAdmin(sql: SqlRunner, viewer: Viewer): Promise<string> {
  if (!viewer.userId || !UUID.safeParse(viewer.userId).success) {
    throw new BrandBillingDenied('sign_in_required');
  }
  const profile = (
    await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for key share', [viewer.userId])
  ).rows[0];
  if (!profile) throw new BrandBillingDenied('sign_in_required');
  if (profile.is_admin !== true) throw new BrandBillingDenied('forbidden');
  return viewer.userId;
}

/**
 * Customer billing seat check, strictly ordered:
 *   1. Authenticated user + valid organization UUID
 *   2. Membership or project-guest check (`not_found` for outsiders so org existence is never leaked)
 *   3. Sandboxed organization hardline (`not_found` — same 404 sandboxed organizations get elsewhere)
 *   4. Role check: only `owner` or `admin` (`forbidden` 403 for `editor`, `viewer`, `guest`)
 */
export async function requireBrandBillingSeat(
  sql: SqlRunner,
  viewer: Viewer,
  organizationId: string,
): Promise<BrandBillingSeat> {
  if (!viewer.userId || !UUID.safeParse(viewer.userId).success) {
    throw new BrandBillingDenied('sign_in_required');
  }
  if (!UUID.safeParse(organizationId).success) {
    throw new BrandBillingDenied('not_found');
  }
  const profile = (await sql.query('select id from profiles where id = $1', [viewer.userId])).rows[0];
  if (!profile) throw new BrandBillingDenied('sign_in_required');

  const org = (
    await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])
  ).rows[0];
  if (!org) throw new BrandBillingDenied('not_found');

  const member = (
    await sql.query<{ role: string }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active' for share",
      [organizationId, viewer.userId],
    )
  ).rows[0];

  let role: string | null = member ? String(member.role) : null;
  if (!role) {
    const guest = (
      await sql.query(
        `select 1 from brand_project_members g
           join brand_projects p on p.id = g.project_id
          where g.organization_id = $1 and g.user_id = $2 and g.status = 'active' and p.client_visible
          limit 1`,
        [organizationId, viewer.userId],
      )
    ).rows[0];
    if (guest) role = 'guest';
  }
  if (!role) throw new BrandBillingDenied('not_found');

  // Sandboxed organizations receive the exact same 404 they get elsewhere in the studio/workspace.
  if (isSandboxedClientOrganization(org)) {
    throw new BrandBillingDenied('not_found');
  }

  if (role !== 'owner' && role !== 'admin') {
    throw new BrandBillingDenied('forbidden');
  }

  return {
    userId: viewer.userId,
    organizationId: String(org.id),
    organizationName: String(org.name),
    role,
  };
}
