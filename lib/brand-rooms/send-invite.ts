/**
 * 초대하고 보내기, the server (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c). In 보내기's send field an owner or editor names
 * the e-mail address of someone who is not a workspace member yet. The line is posted at once; the EXISTING workspace
 * invitation goes out for that address (`storeInvitation`, the one writer of `brand_invites`: the same token, the same
 * 7 days, the same mail behind `BRAND_ORG_INVITE_EMAIL` or the same copy-the-link answer), always as a viewer; and
 * `brand_room_pending_mentions` (0202) remembers that the line waits for that invitation. When the invitation is accepted
 * (`acceptBrandInvitation`, through the hooks below), the new member is added to the line's mentions and told exactly
 * as 보내기 tells a mentioned member (./notices.ts, slice 4a's rule), and the waiting row is deleted.
 *
 * The coordinator's decisions, as code:
 *  1. Who may invite here: the organization's owners and editors (`mayInvite`). Nowhere else changes: the members page's
 *     `invitation.create` stays owner-only. An invitation an editor issues here is honoured at acceptance only while
 *     초대하고 보내기 is open, only as a viewer, only while lines wait for it, and only while the editor still holds an
 *     owner or editor seat (`honoursEditorInvitation`).
 *  2. The role is always viewer; a request cannot name one (the strict schemas refuse a `role` field).
 *  3. Open: `BRAND_SEND_INVITE=on`, 보내기 open for the organization (`brandSendOpenFor`) and 0202 applied (a remembered
 *     probe). Closed: the send and invitation operations answer exactly as on origin/main.
 *  4. At most `SEND_LIMITS.invitesPerMessage` addresses per line; the organization's daily invitation cap
 *     (`BRAND_INVITES_PER_DAY`, shared with the members page) and one invitation's waiting lines
 *     (`SEND_LIMITS.linesPerInvitation`) are checked before anything is written (`invite_limit`).
 *  5. Each address: an active member is named like any mention; a live organization invitation is reused (nothing new is
 *     sent); the sender's own address is refused; anything else gets a new invitation. All in the line's transaction,
 *     under the organization row `for update` (the lock order of every invitation writer), so two lines inviting one
 *     new address make one invitation, and an address that joined meanwhile is named instead.
 *  9. The invited address is personal data: in a line's answer only its writer and the organization's owners see it
 *     (`inviteChips`); it is never in a log, a notice, the bell, or a line's text (a body that carries an invited address
 *     is refused).
 * 10. `send.lookup` answers member / invitable / not_allowed and nothing about accounts outside this organization.
 */
import { createHash } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Mailer } from '@/lib/notify/mailer';
import { brandOrgInviteEmailOpen, brandSendInviteOpen } from '@/lib/flags';
import { deliverOrgInviteEmail, type OrgInviteMailState } from '@/lib/brands/workspace/invite-mail';
import { BRAND_INVITES_PER_DAY, storeInvitation, type BrandSendInviteHooks } from '@/lib/brands/workspace/service';
import type { RoomSeat } from './access';
import { brandSendOpenFor, MEMBERS_LINE, membersAudience } from './members-channel';
import { brandSendInviteTableReady } from './members-schema';
import { ROOM_LIMITS, type RoomErrorCode } from './message-contracts';
import { roomAuthorName } from './names';
import { enqueueNotices } from './notices';
import { SEND_LIMITS, SendLookupSchema, type SendInviteChip, type SendInviteOutcome, type SendLookup } from './send-contracts';

type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refusal of 초대하고 보내기, answered by ./send.ts like its own (the rooms' codes). */
export class SendInviteDenied extends Error {
  constructor(readonly code: RoomErrorCode) {
    super(code);
    this.name = 'SendInviteDenied';
  }
}

/* ------------------------------------------------------------------ open */

/**
 * Is 초대하고 보내기 open for this organization: `BRAND_SEND_INVITE=on`, 보내기 open (./members-channel.ts
 * `brandSendOpenFor`), migration 0202. The environment first: while it says closed the database is asked nothing.
 */
export async function brandSendInviteOpenFor(sql: SqlRunner, organizationId: string, env: Env = process.env): Promise<boolean> {
  if (!brandSendInviteOpen(env)) return false;
  if (!(await brandSendOpenFor(sql, organizationId, env))) return false;
  return brandSendInviteTableReady(sql);
}

/** The switch and 0202 only, for a caller that already knows 보내기 is open for the organization (./send.ts). */
export async function inviteSwitchOpen(sql: SqlRunner, env: Env = process.env): Promise<boolean> {
  return brandSendInviteOpen(env) && (await brandSendInviteTableReady(sql));
}

/** Whether a raw input names at least one address (the lock a send takes depends on it; the schema judges it later). */
export function carriesInvites(input: unknown): boolean {
  const invites = (input as { invites?: unknown } | null)?.invites;
  return Array.isArray(invites) && invites.length > 0;
}

/** Who may invite through 보내기 (decision 1): an owner or an editor. Never a viewer. */
export function mayInvite(seat: Pick<RoomSeat, 'role'>): boolean {
  return seat.role === 'owner' || seat.role === 'editor';
}

/* ------------------------------------------------------------------ a send */

export interface InvitePlan {
  /** Distinct addresses, in the order sent. */
  emails: string[];
  /** Address -> the active members it belongs to (named like any mention). */
  members: Map<string, string[]>;
  /** Address -> the live organization invitation the line will wait for. */
  reuse: Map<string, string>;
  /** Addresses that get a new invitation. */
  create: string[];
}

export interface IssuedInvite {
  email: string;
  inviteId: string;
  token: string;
}

const EMPTY_PLAN = (): InvitePlan => ({ emails: [], members: new Map(), reuse: new Map(), create: [] });

/**
 * Before the line is written (`send.post`/`send.reply` with `invites`), under the organization row `for update`: what each
 * address becomes (decision 5), and every refusal, so that a refused request writes and sends nothing. Answers the
 * line's mentions with the members' ids added. Refusals: a viewer (`forbidden`); a body carrying an invited address, the
 * sender's own address, or more people than a line may name (`invalid`); the daily cap or one invitation's waiting lines
 * (`invite_limit`).
 */
export async function planInvites(
  sql: SqlRunner,
  ctx: { organizationId: string; me: string; seat: Pick<RoomSeat, 'role'> },
  line: { invites: readonly string[]; body: string; mentions: readonly string[] },
): Promise<{ plan: InvitePlan; mentions: string[] }> {
  const emails = [...new Set(line.invites)];
  if (emails.length === 0) return { plan: EMPTY_PLAN(), mentions: [...line.mentions] };
  if (!mayInvite(ctx.seat)) throw new SendInviteDenied('forbidden');
  // The address must never travel in a line's text: the bell, the inbox, every reader and the mention mail quote it.
  const body = line.body.toLowerCase();
  if (emails.some((email) => body.includes(email))) throw new SendInviteDenied('invalid');
  // The sender's own address, and their seat read again now that the organization row is held (the seat was read before
  // the lock: an owner may have removed them meanwhile, and nothing they invite would be honoured).
  const me = (
    await sql.query<{ email: string | null; role: string | null }>(
      `select lower(p.email) as email, m.role from profiles p
         left join brand_memberships m on m.organization_id = $2 and m.user_id = p.id and m.status = 'active'
        where p.id = $1`,
      [ctx.me, ctx.organizationId],
    )
  ).rows[0];
  if (!me || (me.role !== 'owner' && me.role !== 'editor')) throw new SendInviteDenied('forbidden');
  if (me.email && emails.includes(me.email)) throw new SendInviteDenied('invalid');
  const members = new Map<string, string[]>();
  for (const row of (
    await sql.query<{ user_id: string; email: string }>(
      `select m.user_id::text as user_id, lower(p.email) as email from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active' and lower(p.email) = any($2::text[])
        order by m.user_id`,
      [ctx.organizationId, emails],
    )
  ).rows) {
    const email = String(row.email);
    members.set(email, [...(members.get(email) ?? []), String(row.user_id).toLowerCase()]);
  }
  const rest = emails.filter((email) => !members.has(email));
  const reuse = new Map<string, string>();
  if (rest.length > 0) {
    // A live organization-wide invitation (not accepted, not withdrawn, not past its time), the newest per address.
    for (const row of (
      await sql.query<{ id: string; email: string }>(
        `select distinct on (email) id::text as id, email from brand_invites
          where organization_id = $1 and project_id is null and email = any($2::text[])
            and accepted_at is null and revoked_at is null and expires_at > now()
          order by email, created_at desc, id desc`,
        [ctx.organizationId, rest],
      )
    ).rows)
      reuse.set(String(row.email), String(row.id).toLowerCase());
  }
  if (reuse.size > 0) {
    const waitingLines = (
      await sql.query<{ n: number }>(
        `select coalesce(max(c.n), 0)::int as n from (
           select count(*) as n from brand_room_pending_mentions where organization_id = $1 and invite_id = any($2::uuid[]) group by invite_id) c`,
        [ctx.organizationId, [...reuse.values()]],
      )
    ).rows[0]!;
    if (Number(waitingLines.n) >= SEND_LIMITS.linesPerInvitation) throw new SendInviteDenied('invite_limit');
  }
  const create = rest.filter((email) => !reuse.has(email));
  if (create.length > 0) {
    // The organization's daily cap, the members page's invitations and the team's counted together (as they count it).
    const today = (await sql.query<{ n: number }>("select count(*)::int as n from brand_invites where organization_id = $1 and created_at > now() - interval '1 day'", [ctx.organizationId])).rows[0]!;
    if (Number(today.n) + create.length > BRAND_INVITES_PER_DAY) throw new SendInviteDenied('invite_limit');
  }
  const mentions = [...new Set([...line.mentions.map((id) => id.toLowerCase()), ...[...members.values()].flat()])];
  // Everyone who joins later is added to this line's mentions: the line must still fit the rooms' limit then.
  if (mentions.length + reuse.size + create.length > ROOM_LIMITS.mentionsMax) throw new SendInviteDenied('invalid');
  return { plan: { emails, members, reuse, create }, mentions };
}

/** One address's invitation request id, derived from the line's, so a retried line never issues a second token. */
export function inviteRequestId(requestId: string, email: string): string {
  const h = createHash('sha256').update(`send-invite:${requestId.toLowerCase()}:${email}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * After the line is written, in its transaction: a new invitation for each address that needs one (the existing writer,
 * `storeInvitation`: role viewer, the sender as inviter, 7 days), and the line's waiting rows. A failure here throws and
 * the whole request (the line included) is rolled back. Answers the outcome of every address and the new tokens (for the
 * mail after the commit and the writer's copy-the-link answer).
 */
export async function attachInvites(
  sql: SqlRunner,
  ctx: { organizationId: string; me: string },
  line: { messageId: string; requestId: string },
  plan: InvitePlan,
): Promise<{ outcomes: SendInviteOutcome[]; issued: IssuedInvite[] }> {
  if (plan.emails.length === 0) return { outcomes: [], issued: [] };
  const issued: IssuedInvite[] = [];
  for (const email of plan.create) {
    const stored = await storeInvitation(sql, {
      organizationId: ctx.organizationId,
      projectId: null,
      email,
      role: 'viewer',
      canComment: false,
      issuedByStudio: false,
      createdBy: ctx.me,
      requestId: inviteRequestId(line.requestId, email),
    });
    issued.push({ email, inviteId: stored.id.toLowerCase(), token: stored.token });
  }
  const waitFor = [...plan.reuse.values(), ...issued.map((one) => one.inviteId)];
  if (waitFor.length > 0) {
    await sql.query(
      `insert into brand_room_pending_mentions (message_id, invite_id, organization_id)
         select $1, i.id, $3 from unnest($2::uuid[]) as i(id) order by i.id`,
      [line.messageId, waitFor, ctx.organizationId],
    );
  }
  const outcomes = plan.emails.map((email): SendInviteOutcome => {
    const memberIds = plan.members.get(email);
    if (memberIds) return { email, result: 'member', memberId: memberIds[0] ?? null, token: null, mailState: null };
    if (plan.reuse.has(email)) return { email, result: 'reused', memberId: null, token: null, mailState: null };
    const one = issued.find((i) => i.email === email);
    return { email, result: 'invited', memberId: null, token: one?.token ?? null, mailState: null };
  });
  return { outcomes, issued };
}

/**
 * After the commit, exactly as the members page's `invitation.create` does after its own: while `BRAND_ORG_INVITE_EMAIL`
 * is on, the existing invitation mail (./invite-mail.ts `deliverOrgInviteEmail`: the sheet, the words, the 8-second
 * wait, `mail_state` on the row) for each new invitation, in the writer's language; off, nothing is sent and the writer
 * copies the link. Answers each invitation's mail state (empty while off).
 */
export async function mailInvites(
  deps: { sql: SqlRunner; mailer: Mailer | null },
  viewer: Pick<Viewer, 'userId' | 'locale'>,
  organizationId: string,
  issued: readonly IssuedInvite[],
  env: Env = process.env,
): Promise<Map<string, OrgInviteMailState>> {
  const states = new Map<string, OrgInviteMailState>();
  if (issued.length === 0 || !brandOrgInviteEmailOpen(env) || !viewer.userId) return states;
  for (const one of issued) {
    states.set(
      one.inviteId,
      await deliverOrgInviteEmail({
        sql: deps.sql,
        mailer: deps.mailer,
        inviteId: one.inviteId,
        organizationId,
        inviterUserId: viewer.userId,
        email: one.email,
        role: 'viewer',
        token: one.token,
        locale: viewer.locale === 'en' ? 'en' : 'ko',
      }),
    );
  }
  return states;
}

/* ------------------------------------------------------------------ reads */

/**
 * The invitations each of `lines` waits for (decision 9): the state for everyone; the address only for the line's writer
 * and the organization's owners. One statement.
 */
export async function inviteChips(
  sql: SqlRunner,
  organizationId: string,
  lines: ReadonlyArray<{ id: string; authorId: string | null }>,
  reader: { me: string; owner: boolean },
): Promise<Map<string, SendInviteChip[]>> {
  const chips = new Map<string, SendInviteChip[]>(lines.map((line) => [line.id.toLowerCase(), []]));
  const ids = [...chips.keys()].filter((id) => UUID.test(id));
  if (ids.length === 0) return chips;
  const authors = new Map(lines.map((line) => [line.id.toLowerCase(), line.authorId ? line.authorId.toLowerCase() : null]));
  const rows = (
    await sql.query<{ message_id: string; email: string; role: string; revoked: boolean; accepted: boolean; expired: boolean }>(
      `select pm.message_id::text as message_id, i.email, i.role, i.revoked_at is not null as revoked, i.accepted_at is not null as accepted,
              i.expires_at <= now() as expired
         from brand_room_pending_mentions pm
         join brand_invites i on i.id = pm.invite_id and i.organization_id = pm.organization_id
        where pm.organization_id = $1 and pm.message_id = any($2::uuid[])
        order by pm.created_at, pm.invite_id`,
      [organizationId, ids],
    )
  ).rows;
  for (const row of rows) {
    const id = String(row.message_id).toLowerCase();
    // The writer typed it. An owner sees it too, except an owner-role invitation's (the TWINGS team's handover, which the
    // members page hides from owners as well).
    const sees = authors.get(id) === reader.me || (reader.owner && row.role !== 'owner');
    const state: SendInviteChip['state'] = row.revoked ? 'expired' : row.accepted ? 'accepted' : row.expired ? 'expired' : 'pending';
    chips.get(id)?.push({ state, email: sees ? String(row.email) : null });
  }
  return chips;
}

/**
 * `send.lookup` (decision 10): what a typed address becomes. While the switch is closed, and for a caller who may not
 * invite (a viewer): `not_allowed`, nothing read. Else, at most `SEND_LIMITS.lookupsPerMinute` per person per
 * organization (the studio's sliding-window limiter, `takeFreeIntelSlot`, per server instance): an ACTIVE member of this
 * organization (one statement) is `member`; anything else is `invitable`. An address with an account elsewhere on TWINGS,
 * a removed member, a project guest, an address already invited and one never seen answer alike.
 */
export async function lookupAddress(
  sql: SqlRunner,
  ctx: { organizationId: string; me: string; seat: Pick<RoomSeat, 'role'> },
  input: unknown,
  open: boolean,
  now = Date.now(),
): Promise<SendLookup> {
  const parsed = SendLookupSchema.safeParse(input);
  if (!parsed.success) throw new SendInviteDenied('invalid');
  const email = parsed.data.email;
  // Closed, or a caller who may not invite (a viewer): `not_allowed`, nothing read. A viewer names colleagues from
  // `send.people`; an address -> member answer is only for those who may invite (it is what turns a typed address into
  // a mention instead of an invitation).
  if (!open || !mayInvite(ctx.seat)) return { ok: true, email, status: 'not_allowed', member: null };
  const { takeFreeIntelSlot } = await import('@/lib/brand-studio/jobs');
  if (!takeFreeIntelSlot(`send-lookup:${ctx.organizationId}:${ctx.me}`, SEND_LIMITS.lookupsPerMinute, now)) throw new SendInviteDenied('rate_limited');
  const row = (
    await sql.query<{ user_id: string; display_name: string | null; email: string | null }>(
      `select m.user_id::text as user_id, p.display_name, p.email from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active' and lower(p.email) = $2
        order by m.created_at, m.user_id limit 1`,
      [ctx.organizationId, email],
    )
  ).rows[0];
  if (row) return { ok: true, email, status: 'member', member: { id: String(row.user_id).toLowerCase(), name: roomAuthorName('brand', row.display_name, row.email) ?? '' } };
  return { ok: true, email, status: 'invitable', member: null };
}

/* ------------------------------------------------------------------ acceptance */

const sqlState = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
};

/** The organization is open for 보내기's people (not sandboxed; generation and `self_studio` not denied). */
async function organizationOpen(sql: SqlRunner, organizationId: string): Promise<boolean> {
  return (await membersAudience(sql, organizationId)).length > 0;
}

/**
 * The acceptance's part (lib/brands/workspace/service.ts `acceptBrandInvitation`, set by the route), in the acceptance's
 * own transaction. While 초대하고 보내기 is closed for the invitation's organization both answer before reading anything,
 * and the acceptance is exactly what it was before slice 4c.
 */
export function sendInviteAcceptHooks(env: Env = process.env): BrandSendInviteHooks {
  /**
   * Open for this organization, asked before the hooks' savepoints so that a closed switch costs no statement at all
   * (the acceptance is then statement for statement what it was). Past the environment, only the remembered
   * `information_schema` probes run here; should one fail, the hook answers closed (and logs no text).
   */
  const openForAcceptance = async (sql: SqlRunner, organizationId: string): Promise<boolean> => {
    if (!brandSendInviteOpen(env)) return false;
    try {
      return await brandSendInviteOpenFor(sql, organizationId, env);
    } catch (error) {
      console.warn('[brand-send] invite_open_check_failed', JSON.stringify({ code: sqlState(error) }));
      return false;
    }
  };
  return {
    /**
     * An organization invitation issued by an EDITOR (the members page lets only owners issue one) is honoured only if
     * 보내기 issued it, while 초대하고 보내기 and the organization are open: a line written by that editor waits for it and
     * the invitation's request id is the one that line derived for this address (`inviteRequestId`), so an invitation
     * someone issued elsewhere (an owner since demoted, say) is never brought back to life by a line that reused it. The
     * caller has already checked the role (viewer) and that the editor still holds an owner or editor seat. And never
     * for someone an owner removed from this organization: an editor may invite newcomers, not bring a removed member back
     * (an owner still may, from the members page). Anything else: not honoured (`not_found`, as before slice 4c).
     */
    async honoursEditorInvitation(sql, invite, userId) {
      if (!(await openForAcceptance(sql, invite.organizationId))) return false;
      await sql.query('savepoint brand_send_invite_honour');
      try {
        const lines = (
          await sql.query<{ request_id: string }>(
            `select m.request_id::text as request_id from brand_room_pending_mentions pm
               join brand_room_messages m on m.id = pm.message_id and m.organization_id = pm.organization_id
              where pm.invite_id = $1 and pm.organization_id = $2 and m.author_id = $3`,
            [invite.id, invite.organizationId, invite.createdBy],
          )
        ).rows;
        const issuedHere = lines.some((line) => inviteRequestId(String(line.request_id), invite.email) === invite.requestId.toLowerCase());
        const removed = issuedHere
          ? (await sql.query("select 1 from brand_memberships where organization_id = $1 and user_id = $2 and status <> 'active'", [invite.organizationId, userId])).rows.length > 0
          : true;
        const honoured = issuedHere && !removed && (await organizationOpen(sql, invite.organizationId));
        await sql.query('release savepoint brand_send_invite_honour');
        return honoured;
      } catch (error) {
        await sql.query('rollback to savepoint brand_send_invite_honour').catch(() => undefined);
        console.warn('[brand-send] invite_honour_failed', JSON.stringify({ code: sqlState(error) }));
        return false;
      }
    },

    /**
     * Decision 7: after the membership is written, every line waiting for this invitation that is still a live members
     * line of the organization names the new member (added to its mentions) and tells them by slice 4a's rule (a
     * `mention` notice: today's mention mail and push in a project's members channel, in-app only for an unfiled file);
     * the thread is then in their 알림함, unread. Then the invitation's waiting rows are deleted (a deleted line's too).
     * At most `SEND_LIMITS.linesPerInvitation` lines (the send refuses more). Never throws: a failure rolls this part back
     * alone, is logged without any text, and the acceptance completes.
     */
    async deliver(sql, invite, userId) {
      if (!(await openForAcceptance(sql, invite.organizationId))) return;
      const organizationId = invite.organizationId.toLowerCase();
      const me = userId.toLowerCase();
      await sql.query('savepoint brand_send_invite_accept');
      try {
        // A closed organization (sandboxed, generation or self_studio denied) has nobody: nothing is delivered and the
        // rows stay, as they stay while the switch is off.
        if ((await membersAudience(sql, organizationId)).includes(me)) {
          const lines = (
            await sql.query<{ id: string; parent_id: string | null; project_id: string | null; channel: string; author_id: string | null }>(
              `select m.id::text as id, m.parent_id::text as parent_id, m.project_id::text as project_id, m.channel, m.author_id::text as author_id
                 from brand_room_pending_mentions pm
                 join brand_room_messages m on m.id = pm.message_id and m.organization_id = pm.organization_id
                where pm.invite_id = $1 and pm.organization_id = $2 and m.deleted_at is null and ${MEMBERS_LINE('m')}
                order by m.id
                limit $3
                for update of m`,
              [invite.id, organizationId, SEND_LIMITS.linesPerInvitation],
            )
          ).rows;
          if (lines.length > 0) {
            await sql.query(
              `update brand_room_messages set mentions = array_append(mentions, $3::uuid)
                where organization_id = $1 and id = any($2::uuid[]) and not (mentions @> array[$3::uuid])`,
              [organizationId, lines.map((line) => line.id), me],
            );
            for (const line of lines) {
              await enqueueNotices(
                sql,
                {
                  type: 'member',
                  organizationId,
                  projectId: line.project_id ? String(line.project_id).toLowerCase() : null,
                  channel: String(line.channel),
                  messageId: String(line.id).toLowerCase(),
                  rootId: String(line.parent_id ?? line.id).toLowerCase(),
                  actorId: line.author_id ? String(line.author_id).toLowerCase() : '',
                  mentions: [me],
                  // Only the new member is told about this line now; the thread's participants heard about it when it was written.
                  reply: false,
                },
                { env: env as NodeJS.ProcessEnv },
              );
            }
          }
          await sql.query('delete from brand_room_pending_mentions where invite_id = $1 and organization_id = $2', [invite.id, organizationId]);
        }
        await sql.query('release savepoint brand_send_invite_accept');
      } catch (error) {
        await sql.query('rollback to savepoint brand_send_invite_accept').catch(() => undefined);
        console.warn('[brand-send] invite_delivery_failed', JSON.stringify({ code: sqlState(error) }));
      }
    },
  };
}
