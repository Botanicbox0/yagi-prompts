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
  /**
   * Members may post messages and comments. A project guest may too, except in a project they were
   * invited to view only (`readOnlyProjectIds`): there `canTalkIn` is false.
   */
  canTalk: boolean;
  /** For a guest: the only projects they may open. Null for members (every client-visible project). */
  projectIds: string[] | null;
  /** For a guest: the projects they were invited to view only (`brand_project_members.can_comment = false`). */
  readOnlyProjectIds?: string[];
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
  let readOnlyProjectIds: string[] = [];
  if (!role) {
    const guest = (
      await sql.query<{ project_id: string; can_comment: boolean | null }>(
        `select g.project_id, g.can_comment from brand_project_members g join brand_projects p on p.id = g.project_id
          where g.organization_id = $1 and g.user_id = $2 and g.status = 'active' and p.client_visible`,
        [organizationId, userId],
      )
    ).rows;
    if (guest.length) {
      role = 'guest';
      projectIds = guest.map((row) => String(row.project_id));
      // A guest invited to view only reads but never writes (docs/BRAND-ROOMS-FEEDBACK.md §12), whatever
      // `BRAND_ROOM_INVITES` says: the team's view-only invitations (0034) mean the same in rooms.
      readOnlyProjectIds = guest.filter((row) => row.can_comment !== true).map((row) => String(row.project_id));
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
    canTalk: !projectIds || readOnlyProjectIds.length < projectIds.length,
    projectIds,
    readOnlyProjectIds,
  };
}

/**
 * May this seat post in this project's room (messages, reactions, attachments, draft notes)? Members:
 * `canTalk`. A guest: not in a project they were invited to view only. `projectId` null is the general
 * channel, which a guest never opens.
 */
export function canTalkIn(seat: Pick<RoomSeat, 'canTalk' | 'readOnlyProjectIds'>, projectId: string | null): boolean {
  if (!seat.canTalk) return false;
  if (!projectId || !seat.readOnlyProjectIds?.length) return true;
  const id = projectId.toLowerCase();
  return !seat.readOnlyProjectIds.some((p) => p.toLowerCase() === id);
}

/** The seat as it stands in one project: `canTalk` narrowed by `canTalkIn`. */
export function seatInProject(seat: RoomSeat, projectId: string): RoomSeat {
  return { ...seat, canTalk: canTalkIn(seat, projectId) };
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

export interface RoomAudienceMember {
  userId: string;
  role: RoomRole;
}

/**
 * Everyone who may open one project room, by the rules `roomSeat` + `requireRoomProject` apply to one
 * person (docs/BRAND-ROOMS-FEEDBACK.md §2.1): the organization exists and is open (the sandbox hardline,
 * then the generation policy), the project is the organization's and client-visible, and the person is
 * an active member, or an active guest invited to THIS project. `projectId` null is the organization's
 * general channel: active members only, as `brandReader` in ./messages.ts keeps guests out of it.
 * Empty when any of that fails. For notices only; it never opens a door.
 */
export async function roomAudience(sql: SqlRunner, organizationId: string, projectId: string | null): Promise<RoomAudienceMember[]> {
  if (!UUID.test(organizationId) || (projectId !== null && !UUID.test(projectId))) return [];
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) return [];
  try {
    await assertBrandFeature(sql, organizationId, 'generative_media');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) return [];
    throw error;
  }
  if (projectId !== null) {
    const project = (await sql.query('select id from brand_projects where id = $1 and organization_id = $2 and client_visible', [projectId, organizationId])).rows[0];
    if (!project) return [];
  }
  const rows = (
    await sql.query<{ user_id: string; role: string }>(
      `select m.user_id::text as user_id, m.role
         from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active'
       union all
       select g.user_id::text, 'guest'
         from brand_project_members g join profiles p on p.id = g.user_id
        where $2::uuid is not null and g.organization_id = $1 and g.project_id = $2::uuid and g.status = 'active'
          and not exists (select 1 from brand_memberships m where m.organization_id = $1 and m.user_id = g.user_id and m.status = 'active')`,
      [organizationId, projectId],
    )
  ).rows;
  const seen = new Set<string>();
  const audience: RoomAudienceMember[] = [];
  for (const row of rows) {
    const userId = String(row.user_id).toLowerCase();
    if (seen.has(userId)) continue;
    seen.add(userId);
    audience.push({ userId, role: row.role as RoomRole });
  }
  return audience;
}

export function requireEdit(seat: RoomSeat): void {
  if (!seat.canEdit) throw new RoomDenied('forbidden');
}

export const roomStatus = (code: RoomDeniedCode): number => (code === 'sign_in_required' ? 401 : code === 'forbidden' ? 403 : 404);
