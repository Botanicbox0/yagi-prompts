/**
 * Who may enter a project room (docs/BRAND-ROOMS.md §9).
 *
 * Order, every time: sign-in -> the organization exists -> membership, or an invitation to THIS project
 * -> the sandbox hardline and the generation policy (a closed brand answers exactly like a missing one,
 * `not_found`) -> role. The route checks the flag (`brandRoomsOpen()`) before calling this.
 *
 * Roles: owner and editor write everything a brand may write; a viewer reads and may talk; a project
 * guest (campaign-only invitee) gets only the room of a project they were invited to.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { assertBrandFeature, BrandFeatureDenied, isSandboxedClientOrganization } from '@/lib/brands/entitlements';

export type RoomRole = 'owner' | 'editor' | 'viewer' | 'guest';
export type RoomDeniedCode = 'sign_in_required' | 'not_found' | 'forbidden';

export class RoomDenied extends Error {
  constructor(readonly code: RoomDeniedCode) {
    super(code);
    this.name = 'RoomDenied';
  }
}

export interface RoomSeat {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: RoomRole;
  /** Owners and editors: storyboards, review status, shares. */
  canEdit: boolean;
  /** Everyone seated may post messages and comments. */
  canTalk: boolean;
  /** For a guest: the only projects they may open. Null for members (every client-visible project). */
  projectIds: string[] | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function roomSeat(sql: SqlRunner, userId: string | null | undefined, organizationId: string): Promise<RoomSeat> {
  if (!userId || !UUID.test(userId)) throw new RoomDenied('sign_in_required');
  if (!UUID.test(organizationId)) throw new RoomDenied('not_found');
  if (!(await sql.query('select id from profiles where id = $1', [userId])).rows[0]) throw new RoomDenied('sign_in_required');
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org) throw new RoomDenied('not_found');
  const member = (
    await sql.query<{ role: string }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active'",
      [organizationId, userId],
    )
  ).rows[0];
  let role: RoomRole | null = member ? (member.role as RoomRole) : null;
  let projectIds: string[] | null = null;
  if (!role) {
    const guest = (
      await sql.query<{ project_id: string }>(
        `select g.project_id from brand_project_members g join brand_projects p on p.id = g.project_id
          where g.organization_id = $1 and g.user_id = $2 and g.status = 'active' and p.client_visible`,
        [organizationId, userId],
      )
    ).rows;
    if (guest.length) {
      role = 'guest';
      projectIds = guest.map((row) => String(row.project_id));
    }
  }
  if (!role) throw new RoomDenied('not_found');
  // The hardline first (id or name), then the policy. Never weakened, never reordered after the role.
  if (isSandboxedClientOrganization(org)) throw new RoomDenied('not_found');
  try {
    await assertBrandFeature(sql, organizationId, 'generative_media');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) throw new RoomDenied('not_found');
    throw error;
  }
  return {
    userId,
    organizationId,
    organizationName: String(org.name),
    role,
    canEdit: role === 'owner' || role === 'editor',
    canTalk: true,
    projectIds,
  };
}

/** The project belongs to the organization, the brand may see it, and this seat may open it. Throws `not_found` otherwise. */
export async function requireRoomProject(sql: SqlRunner, seat: RoomSeat, projectId: string): Promise<{ id: string; title: string }> {
  if (!UUID.test(projectId)) throw new RoomDenied('not_found');
  if (seat.projectIds && !seat.projectIds.includes(projectId)) throw new RoomDenied('not_found');
  const project = (
    await sql.query<{ id: string; title: string }>(
      'select id, title from brand_projects where id = $1 and organization_id = $2 and client_visible',
      [projectId, seat.organizationId],
    )
  ).rows[0];
  if (!project) throw new RoomDenied('not_found');
  return { id: String(project.id), title: String(project.title) };
}

export function requireEdit(seat: RoomSeat): void {
  if (!seat.canEdit) throw new RoomDenied('forbidden');
}

export const roomStatus = (code: RoomDeniedCode): number => (code === 'sign_in_required' ? 401 : code === 'forbidden' ? 403 : 404);
