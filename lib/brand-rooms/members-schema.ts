/**
 * The members channel's storage facts (docs/BRAND-PROJECT-SPINE.md §8.3, §8.6; slice 4a), in a leaf module so the spine's
 * move (lib/brand-studio/brand-projects.ts) can carry a file's threads without importing the rooms' gates:
 *  - whether migration 0200 is applied (`brandSendTablesReady`, a remembered probe);
 *  - the SQL predicate for "a members line" (`MEMBERS_LINE`, the form the 0200 partial indexes use);
 *  - moving a file's threads with the file (`moveFileThreads`).
 * Nothing here reads who may see what, and nothing here sends anything.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { membersChannelOf } from './send-contracts';

/** The members channels, as a SQL predicate on `alias.channel` (the 0200 checks allow only `members` and `members:<uuid>`). */
export const MEMBERS_LINE = (alias: string): string => {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(alias)) throw new Error('bad alias');
  return `${alias}.channel like 'members%'`;
};

const RECHECK_MS = 60_000;
let probe: { ready: boolean; at: number } | null = null;

/**
 * True once migration 0200 is applied: `brand_room_thread_reads` exists and `brand_room_notices.channel` exists (the
 * table is the file's last statement). A miss is looked up again after a minute, so applying the migration needs no
 * redeploy; a hit is kept (the spine's column probe and the news slot's table probe do the same).
 */
export async function brandSendTablesReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (probe && (probe.ready || now - probe.at < RECHECK_MS)) return probe.ready;
  const found = await sql.query<{ n: number }>(
    `select ((select count(*) from information_schema.tables
                where table_schema = current_schema() and table_name = 'brand_room_thread_reads')
           + (select count(*) from information_schema.columns
                where table_schema = current_schema() and table_name = 'brand_room_notices' and column_name = 'channel'))::int as n`,
  );
  probe = { ready: Number(found.rows[0]?.n ?? 0) === 2, at: now };
  return probe.ready;
}

/** Forget the lookups, this one and 0202's (tests change the schema under one process). */
export function resetBrandSendProbe(): void {
  probe = null;
  inviteProbe = null;
}

let inviteProbe: { ready: boolean; at: number } | null = null;

/**
 * True once migration 0202 is applied (초대하고 보내기, slice 4c): `brand_room_pending_mentions` exists. Remembered the
 * same way as 0200's probe: a miss is looked up again after a minute, a hit is kept.
 */
export async function brandSendInviteTableReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (inviteProbe && (inviteProbe.ready || now - inviteProbe.at < RECHECK_MS)) return inviteProbe.ready;
  const found = await sql.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = current_schema() and table_name = 'brand_room_pending_mentions'`,
  );
  inviteProbe = { ready: Number(found.rows[0]?.n ?? 0) === 1, at: now };
  return inviteProbe.ready;
}

const known = (state: { ready: boolean; at: number } | null, now: number): boolean | null =>
  state && (state.ready || now - state.at < RECHECK_MS) ? state.ready : null;

/**
 * What the two probes above would answer without asking the database (0200's and 0202's): the remembered answers while
 * still trusted, else null. For callers that must not run a statement just to learn "closed".
 */
export function brandSendProbesKnown(now = Date.now()): { send: boolean | null; invite: boolean | null } {
  return { send: known(probe, now), invite: known(inviteProbe, now) };
}

/**
 * A file moved (docs/BRAND-PROJECT-SPINE.md §4.3, §8.3): its threads follow it, in the caller's transaction (the spine's
 * `project.move`, after its own updates). The files are the results of `jobIds` (every result, deleted or not: a thread
 * about a deleted result stays with its run) and the library entries `assetIds`; their roots on a members channel of
 * this organization and those roots' replies move to `projectId`'s members channel (`members` when null), and so do the
 * notices about those lines. The roots are locked first, so a reply being written to one of them either commits before
 * this update reads (and moves with it) or waits for the move and lands in the new channel. Runs whenever 0200 is
 * applied, whatever the switch says: a thread is never left behind its file. Returns the number of lines moved.
 */
export async function moveFileThreads(
  sql: SqlRunner,
  organizationId: string,
  input: { jobIds: readonly string[]; assetIds: readonly string[]; projectId: string | null },
): Promise<number> {
  if (input.jobIds.length === 0 && input.assetIds.length === 0) return 0;
  if (!(await brandSendTablesReady(sql))) return 0;
  const roots = (
    await sql.query<{ id: string }>(
      `select r.id::text as id from brand_room_messages r
        where r.organization_id = $1 and r.parent_id is null and ${MEMBERS_LINE('r')}
          and r.ref_key = any(
            array(select 'output:' || o.id::text from brand_studio_outputs o where o.organization_id = $1 and o.job_id = any($2::uuid[]))
            || array(select 'asset:' || a::text from unnest($3::uuid[]) a)
          )
        order by r.id
        for update`,
      [organizationId, [...input.jobIds], [...input.assetIds]],
    )
  ).rows.map((row) => String(row.id));
  if (roots.length === 0) return 0;
  const projectId = input.projectId ? input.projectId.toLowerCase() : null;
  const channel = membersChannelOf(projectId);
  const moved = (
    await sql.query<{ id: string }>(
      `update brand_room_messages m set project_id = $3, channel = $4
        where m.organization_id = $1 and ${MEMBERS_LINE('m')} and (m.id = any($2::uuid[]) or m.parent_id = any($2::uuid[]))
        returning m.id::text as id`,
      [organizationId, roots, projectId, channel],
    )
  ).rows.map((row) => String(row.id));
  await sql.query(
    `update brand_room_notices n set project_id = $3, channel = $4
      where n.organization_id = $1 and n.message_id = any($2::uuid[]) and ${MEMBERS_LINE('n')}`,
    [organizationId, moved, projectId, channel],
  );
  return moved.length;
}
