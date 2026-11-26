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
 *  - which projects a member is shown (`shownProjects`, the spine's `VISIBLE_PROJECTS`, spine rules
 *    R-A): a finished project keeps its files and its title; a file in a team project the staff hid reads as 미분류, and
 *    nothing of that project (not its title) is in any answer. The file card, the bell row and the notices name a file's
 *    project by ONE decision (`shownProjectOfFile`): a role-tagged library entry of a finished project names none.
 * Nothing here sends a mail, a push, a team notice or a Slack message.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRoomNotifyOpen, brandRoomsOpen, brandSendOpen } from '@/lib/flags';
import { assertBrandFeature, BrandFeatureDenied, isSandboxedClientOrganization } from '@/lib/brands/entitlements';
import { brandProjectSpineOpen, isBrandMaterial, SELECTABLE_PROJECTS, VISIBLE_PROJECTS } from '@/lib/brand-studio/brand-projects';
import { IMAGE_RUNS, LIBRARY_ASSETS, SOUND_RUNS, VIDEO_RUNS, VISIBLE_OUTPUT, liveRunsFilter } from '@/lib/brand-studio/repo';
import { RoomDenied, roomSeat, type RoomSeat } from './access';
import { brandSendTablesReady } from './members-schema';
import { fileRefKeyOf, type SendFileRef, type SendProject } from './send-contracts';

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
 * The projects members are shown, among `projectIds` of this organization (spine rules R-A): a project members may see
 * (`VISIBLE_PROJECTS`: finished ones too), with its title and whether it can still take new work (a role-tagged library
 * entry of a finished project reads as 브랜드 자료 on the assets page, so its card names no project). A team project the
 * staff hid is absent (the file then reads as 미분류), exactly as on the assets page. One statement.
 */
export async function shownProjects(sql: SqlRunner, organizationId: string, projectIds: readonly string[]): Promise<Map<string, { title: string; selectable: boolean }>> {
  const ids = [...new Set(projectIds.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const rows = (
    await sql.query<{ id: string; title: string; selectable: boolean }>(
      `select sp.id::text as id, sp.title, ${SELECTABLE_PROJECTS('sp')} as selectable from brand_projects sp
        where sp.organization_id = $1 and sp.id = any($2::uuid[]) and ${VISIBLE_PROJECTS('sp')}`,
      [organizationId, ids],
    )
  ).rows;
  return new Map(rows.map((row) => [String(row.id).toLowerCase(), { title: String(row.title), selectable: row.selectable === true }]));
}


/* ------------------------------------------------------------------ files */

/** One file a members thread can be about, as the file card and the notices read it. */
export interface MemberFileRow {
  type: 'output' | 'asset';
  id: string;
  kind: string | null;
  name: string | null;
  storage_key: string | null;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  visible: boolean;
  stored_project_id: string | null;
  /** A library entry's role (null for a result). */
  role: string | null;
}

/**
 * The files of this organization named by `refs`, one statement: a run's result (with its run's project) and a library
 * entry. `visible` is the spine's own rule for what a member can open (the assets page's): a result that is ready, not
 * deleted and stored, of a run a member has not removed, of an image, video or sound run (never a fill strip or the
 * editor's export); a library entry that is ready and not deleted. Another organization's file is simply not found.
 */
export async function memberFileRows(sql: SqlRunner, organizationId: string, refs: readonly SendFileRef[]): Promise<MemberFileRow[]> {
  const outputIds = [...new Set(refs.filter((r) => r.kind === 'output').map((r) => (r as { outputId: string }).outputId.toLowerCase()))];
  const assetIds = [...new Set(refs.filter((r) => r.kind === 'asset').map((r) => (r as { assetId: string }).assetId.toLowerCase()))];
  if (outputIds.length === 0 && assetIds.length === 0) return [];
  const live = await liveRunsFilter(sql, 'j');
  return (
    await sql.query<MemberFileRow>(
      `select 'output'::text as type, o.id::text as id, o.kind, null::text as name, o.storage_key, o.thumb_key, o.width, o.height,
              (${VISIBLE_OUTPUT('o')} and ((${IMAGE_RUNS('j')}) or (${VIDEO_RUNS('j')}) or (${SOUND_RUNS('j')})) ${live}) as visible,
              j.brand_project_id::text as stored_project_id, null::text as role
         from brand_studio_outputs o
         join brand_studio_jobs j on j.id = o.job_id and j.organization_id = o.organization_id
        where o.organization_id = $1 and o.id = any($2::uuid[])
       union all
       select 'asset'::text, a.id::text, a.kind, a.name, a.storage_key, a.thumb_key, a.width, a.height,
              (${LIBRARY_ASSETS('a')}) as visible,
              a.brand_project_id::text, a.role
         from brand_studio_assets a
        where a.organization_id = $1 and a.id = any($3::uuid[])`,
      [organizationId, outputIds, assetIds],
    )
  ).rows;
}

/**
 * THE decision of which project members are shown a file in (spine rules R-A), for the file card, the bell row and the
 * notices alike: its stored project while members may see it (`shownProjects`: finished projects too), except a library
 * entry with a brand-material role in a project that can no longer take work (the assets page shows it under 브랜드 자료),
 * and none for an unfiled file or a team project the staff hid. `projects` is `shownProjects` of the stored ids.
 */
export function shownProjectOfFile(row: Pick<MemberFileRow, 'type' | 'stored_project_id' | 'role'>, projects: ReadonlyMap<string, { title: string; selectable: boolean }>): SendProject | null {
  const id = row.stored_project_id ? String(row.stored_project_id).toLowerCase() : null;
  const project = id ? projects.get(id) : undefined;
  if (!id || !project) return null;
  if (row.type === 'asset' && !project.selectable && isBrandMaterial(row.role)) return null;
  return { id, title: project.title };
}

/**
 * The shown project of each file named by `refs` (keyed `output:<id>` / `asset:<id>`), by `shownProjectOfFile`, whether the
 * file still exists or not (the notices name the project a thread lives in; the card blanks a deleted file itself). Two
 * statements: the files and their projects.
 */
export async function shownProjectsOfFiles(sql: SqlRunner, organizationId: string, refs: readonly SendFileRef[]): Promise<Map<string, SendProject | null>> {
  const rows = await memberFileRows(sql, organizationId, refs);
  const projects = await shownProjects(sql, organizationId, rows.flatMap((row) => (row.stored_project_id ? [String(row.stored_project_id)] : [])));
  const shown = new Map<string, SendProject | null>(refs.map((ref) => [fileRefKeyOf(ref), null]));
  for (const row of rows) shown.set(`${row.type}:${String(row.id).toLowerCase()}`, shownProjectOfFile(row, projects));
  return shown;
}
