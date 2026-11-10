/**
 * Who may do what in the studio (docs/BRAND-STUDIO-V2.md §3, §5.2).
 *
 * Order, every time: membership -> the Morphic hardline and the feature policy -> role. A closed
 * feature answers exactly like a missing organization (`feature_unavailable`, a 404 at the route),
 * so a sandboxed client never learns the studio exists. `isSandboxedClientOrganization` is checked
 * here by id AND name, before `assertBrandFeature` (which knows the ids and the policy rows).
 *
 * Roles: owner and editor create and upload; viewer and campaign-only guest read the board and the
 * library.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { assertBrandFeature, BrandFeatureDenied, isSandboxedClientOrganization } from '@/lib/brands/entitlements';
import type { StudioErrorCode } from './contracts';

export type StudioRole = 'owner' | 'editor' | 'viewer' | 'guest';

export class StudioDenied extends Error {
  constructor(readonly code: StudioErrorCode) {
    super(code);
    this.name = 'StudioDenied';
  }
}

export interface StudioSeat {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: StudioRole;
  canCreate: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function studioSeat(sql: SqlRunner, userId: string | null | undefined, organizationId: string): Promise<StudioSeat> {
  if (!userId || !UUID.test(userId)) throw new StudioDenied('sign_in_required');
  if (!UUID.test(organizationId)) throw new StudioDenied('not_found');
  if (!(await sql.query('select id from profiles where id = $1', [userId])).rows[0]) throw new StudioDenied('sign_in_required');
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org) throw new StudioDenied('not_found');
  const member = (
    await sql.query<{ role: string }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active'",
      [organizationId, userId],
    )
  ).rows[0];
  let role: StudioRole | null = member ? (member.role as StudioRole) : null;
  if (!role) {
    const guest = (
      await sql.query(
        `select 1 from brand_project_members g join brand_projects p on p.id = g.project_id
          where g.organization_id = $1 and g.user_id = $2 and g.status = 'active' and p.client_visible limit 1`,
        [organizationId, userId],
      )
    ).rows[0];
    if (guest) role = 'guest';
  }
  if (!role) throw new StudioDenied('not_found');
  // The hardline first (id or name), then the policy. Never weakened, never reordered after the role.
  if (isSandboxedClientOrganization(org)) throw new StudioDenied('feature_unavailable');
  try {
    await assertBrandFeature(sql, organizationId, 'generative_media');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
    throw error;
  }
  return {
    userId,
    organizationId,
    organizationName: String(org.name),
    role,
    canCreate: role === 'owner' || role === 'editor',
  };
}

export function requireCreate(seat: StudioSeat): void {
  if (!seat.canCreate) throw new StudioDenied('forbidden');
}

/** Serialize work for one organization (job reservations, uploads counting toward the library cap). */
export async function lockOrganization(sql: SqlRunner, organizationId: string): Promise<void> {
  await sql.query('select id from brand_organizations where id = $1 for update', [organizationId]);
}
