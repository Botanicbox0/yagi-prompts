/**
 * The members channel's gates (docs/BRAND-PROJECT-SPINE.md §8.2–§8.4; slice 4a). What the send module (./send.ts), the
 * notices (./notices.ts) and the bell (./bell.ts) must all answer the same way:
 *  - whether 보내기 is open for an organization (`brandSendOpenFor`): the switch, the rooms and notices switches, the
 *    spine for that organization, and migration 0200 (a remembered probe, ./members-schema.ts). The environment is read
 *    first; while it says closed the database is not asked anything;
 *  - who the members channel belongs to (`sendSeat`, `membersAudience`): the organization's ACTIVE workspace members,
 *    every role. Never a project guest, never staff as staff (a staff account that is also an active member is a
 *    member), never anyone of another organization. The organization's hardline gates (sandboxed client, generation
 *    closed) and `self_studio` come first; a closed organization has nobody;
 *  - which projects a member is shown (`shownProjectTitles`, the spine's `SELECTABLE_PROJECTS`): a file in a project that
 *    can no longer take work reads as 미분류, and nothing of that project (not its title) is in any answer.
 * Nothing here sends a mail, a push, a team notice or a Slack message.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRoomNotifyOpen, brandRoomsOpen, brandSendOpen } from '@/lib/flags';
import { assertBrandFeature, BrandFeatureDenied, isSandboxedClientOrganization } from '@/lib/brands/entitlements';
import { brandProjectSpineOpen, SELECTABLE_PROJECTS } from '@/lib/brand-studio/brand-projects';
import { RoomDenied, roomSeat, type RoomSeat } from './access';
import { brandSendTablesReady } from './members-schema';

export { brandSendTablesReady, MEMBERS_LINE, moveFileThreads, resetBrandSendProbe } from './members-schema';

type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ readiness */

/** The switches alone (no database): `BRAND_SEND`, `BRAND_ROOMS` and `BRAND_ROOM_NOTIFY` all on. */
export function brandSendSwitchesOn(env: Env = process.env): boolean {
  return brandSendOpen(env) && brandRoomsOpen(env as NodeJS.ProcessEnv) && brandRoomNotifyOpen(env as NodeJS.ProcessEnv);
}

/**
 * Is 보내기 open for this organization (the coordinator's decision 1): the three switches, the spine open for it (switch,
 * organization list, columns), and migration 0200. Reads nothing of the organization: the environment first, then the
 * two remembered schema probes. Who may use it is `sendSeat`'s question.
 */
export async function brandSendOpenFor(sql: SqlRunner, organizationId: string, env: Env = process.env): Promise<boolean> {
  if (!brandSendSwitchesOn(env) || !UUID.test(organizationId)) return false;
  if (!(await brandProjectSpineOpen(sql, organizationId, env))) return false;
  return brandSendTablesReady(sql);
}

/* ------------------------------------------------------------------ who */

/**
 * The seat of a 보내기 caller: the rooms' own gate (sign-in -> the organization exists -> an active membership or a
 * project invitation -> the sandbox hardline -> the generation policy; `not_found` for an outsider, for staff who are
 * not members and for a closed organization), then a project guest is refused like an outsider, then `self_studio`
 * (a project-only plan included) is refused the same way. Every role of an active member passes: today's rule for
 * writing in a project's conversation lets a viewer talk (lib/brand-rooms/access.ts `roomSeat`: `canTalk` is true
 * for every member), so a viewer may send and reply too.
 */
export async function sendSeat(sql: SqlRunner, viewer: Viewer, organizationId: string): Promise<RoomSeat> {
  const seat = await roomSeat(sql, viewer.userId, organizationId);
  if (seat.role === 'guest') throw new RoomDenied('not_found');
  try {
    await assertBrandFeature(sql, organizationId, 'self_studio');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) throw new RoomDenied('not_found');
    throw error;
  }
  return seat;
}

/**
 * Everyone the members channel of this organization belongs to: its active workspace members (every role), while the
 * organization is open (not sandboxed, generation and `self_studio` not denied). Empty when any of that fails. For
 * notices and the notice pass only; it never opens a door (`sendSeat` does).
 */
export async function membersAudience(sql: SqlRunner, organizationId: string): Promise<string[]> {
  if (!UUID.test(organizationId)) return [];
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) return [];
  try {
    await assertBrandFeature(sql, organizationId, 'generative_media');
    await assertBrandFeature(sql, organizationId, 'self_studio');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) return [];
    throw error;
  }
  const rows = (
    await sql.query<{ user_id: string }>(
      `select m.user_id::text as user_id from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active'`,
      [organizationId],
    )
  ).rows;
  return [...new Set(rows.map((row) => String(row.user_id).toLowerCase()))];
}

/** Of `ids`, those that are active members of the organization (one statement; a made-up id is simply not among them). */
export async function activeMembersAmong(sql: SqlRunner, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
  if (wanted.length === 0) return new Set();
  const rows = (
    await sql.query<{ user_id: string }>(
      `select m.user_id::text as user_id from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active' and m.user_id = any($2::uuid[])`,
      [organizationId, wanted],
    )
  ).rows;
  return new Set(rows.map((row) => String(row.user_id).toLowerCase()));
}

/* ------------------------------------------------------------------ projects */

/**
 * The titles of the projects members are shown, among `projectIds` of this organization: a project that can take new
 * work (`SELECTABLE_PROJECTS`). A hidden, completed or cancelled team project and an archived own project are absent
 * (the file then reads as 미분류), exactly as on the assets page.
 */
export async function shownProjectTitles(sql: SqlRunner, organizationId: string, projectIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const rows = (
    await sql.query<{ id: string; title: string }>(
      `select sp.id::text as id, sp.title from brand_projects sp
        where sp.organization_id = $1 and sp.id = any($2::uuid[]) and ${SELECTABLE_PROJECTS('sp')}`,
      [organizationId, ids],
    )
  ).rows;
  return new Map(rows.map((row) => [String(row.id).toLowerCase(), String(row.title)]));
}
