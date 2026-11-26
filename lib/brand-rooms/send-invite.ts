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
 *     초대하고 보내기 is open, only as a viewer, only if 보내기 itself CREATED it (the waiting row's `created_invite`),
 *     and only while the editor still holds an owner or editor seat (`honoursEditorInvitation`).
 *  2. The role is always viewer; a request cannot name one (the strict schemas refuse a `role` field).
 *  3. Open: `BRAND_SEND_INVITE=on`, 보내기 open for the organization (`brandSendOpenFor`) and 0202 applied (a remembered
 *     probe). Closed: the send and invitation operations answer exactly as on origin/main.
 *  4. At most `SEND_LIMITS.invitesPerMessage` addresses per line; the organization's daily invitation cap
 *     (`BRAND_INVITES_PER_DAY`, shared with the members page) and one invitation's waiting lines
 *     (`SEND_LIMITS.linesPerInvitation`) are checked before anything is written (`invite_limit`).
 *  5. Each address (`classify`, one statement for all of them): an active member is named like any mention; a live
 *     organization VIEWER invitation the team did not issue is reused (nothing new is sent); the sender's own address is
 *     refused (`invalid`); an address with any other live invitation (an owner's editor or owner invitation, the team's),
 *     and for an editor an address of someone an owner removed, is refused with one answer, `invite_refused` (nothing is
 *     written, mailed or counted); anything else gets a new invitation. All in the line's transaction, under the
 *     organization row `for key share` (which holds off every invitation writer's `for update`) and the organization's
 *     invitation lock (an advisory lock that queues inviting lines; ./send.ts), so two lines inviting one new address make
 *     one invitation, and an address that joined meanwhile is named instead.
 *  7. Delivery (`deliverWaitingLines`) takes the lines it can lock now (`skip locked`) and leaves the rest waiting; the
 *     next `send.inbox` or bell read of that member delivers what was left (`deliverLeftovers`), so a line never silently
 *     stops short of the person.
 *  9. The invited address is personal data: in a line's answer only its writer and the organization's owners see it
 *     (`inviteChips`); it is never in a log, a notice, the bell, or a line's text (a body that carries an invited address
 *     is refused).
 * 10. `send.lookup` answers member / invitable / not_allowed, with the same statements whatever the address, and nothing
 *     about accounts outside this organization.
 */
import { createHash } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Mailer } from '@/lib/notify/mailer';
import { brandOrgInviteEmailOpen, brandProjectSpineFor, brandSendInviteOpen } from '@/lib/flags';
import { spineColumnsKnown } from '@/lib/brands/project-origin';
import { deliverOrgInviteEmail, type OrgInviteMailState } from '@/lib/brands/workspace/invite-mail';
import { BRAND_INVITES_PER_DAY, storeInvitation, type BrandSendInviteHooks } from '@/lib/brands/workspace/service';
import type { RoomSeat } from './access';
import { brandSendOpenFor, brandSendSwitchesOn, MEMBERS_LINE, membersAudience } from './members-channel';
import { brandSendInviteTableReady, brandSendProbesKnown } from './members-schema';
import { ROOM_LIMITS, type RoomErrorCode } from './message-contracts';
import { roomAuthorName } from './names';
import { enqueueNotices } from './notices';
import { SEND_LIMITS, SendLookupSchema, type SendInviteChip, type SendInviteOutcome, type SendLookup } from './send-contracts';

type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refusal of 초대하고 보내기, answered by ./send.ts like its own (the rooms' codes; `refused` for `invite_refused`). */
export class SendInviteDenied extends Error {
  constructor(
    readonly code: RoomErrorCode,
    readonly refused?: string[],
  ) {
    super(code);
    this.name = 'SendInviteDenied';
  }
}

/** A database error's SQLSTATE only (never its text, which can quote values). */
const sqlState = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
};

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

/**
 * What can be known to be CLOSED without a statement: the switches and the spine's organization list (the environment),
 * then the remembered probes (0194's columns, 0200, 0202) when they remember a miss. False means "maybe open: ask".
 */
function knownClosedFor(organizationId: string, env: Env): boolean {
  if (!brandSendInviteOpen(env) || !brandSendSwitchesOn(env) || !brandProjectSpineFor(organizationId, env)) return true;
  const probes = brandSendProbesKnown();
  return spineColumnsKnown() === false || probes.send === false || probes.invite === false;
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

/* ------------------------------------------------------------------ what an address is */

interface AddressFacts {
  email: string;
  /** Active members with this address (named like any mention). */
  members: string[];
  /** The first active member's name, as `send.people` names them. */
  memberName: string | null;
  /** Someone with this address holds a membership here that is not active (an owner removed them). */
  removed: boolean;
  /** A live organization invitation exists that is not 보내기's to reuse (not a viewer's, or the team's). */
  heldElsewhere: boolean;
  /** The newest live organization viewer invitation the team did not issue: the one a line may wait for. */
  reusable: string | null;
}

/**
 * Everything 초대하고 보내기 needs to know about `emails`, in ONE statement whatever they turn out to be (a member, a
 * removed member, an address with an owner's invitation, an unknown address): so neither the answer's timing nor the
 * number of statements tells them apart. Reads this organization's memberships and invitations only.
 */
async function classify(sql: SqlRunner, organizationId: string, emails: readonly string[]): Promise<Map<string, AddressFacts>> {
  const rows = (
    await sql.query<{ email: string; members: string[] | null; member_name: string | null; member_email: string | null; removed: boolean; held: boolean; reusable: string | null }>(
      `select e.email,
              (select array_agg(m.user_id::text order by m.created_at, m.user_id) from brand_memberships m join profiles p on p.id = m.user_id
                where m.organization_id = $1 and m.status = 'active' and lower(p.email) = e.email) as members,
              (select p.display_name from brand_memberships m join profiles p on p.id = m.user_id
                where m.organization_id = $1 and m.status = 'active' and lower(p.email) = e.email order by m.created_at, m.user_id limit 1) as member_name,
              (select p.email from brand_memberships m join profiles p on p.id = m.user_id
                where m.organization_id = $1 and m.status = 'active' and lower(p.email) = e.email order by m.created_at, m.user_id limit 1) as member_email,
              exists (select 1 from brand_memberships m join profiles p on p.id = m.user_id
                       where m.organization_id = $1 and m.status <> 'active' and lower(p.email) = e.email) as removed,
              exists (select 1 from brand_invites i
                       where i.organization_id = $1 and i.project_id is null and i.email = e.email
                         and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
                         and (i.role <> 'viewer' or i.issued_by_studio)) as held,
              (select i.id::text from brand_invites i
                where i.organization_id = $1 and i.project_id is null and i.email = e.email
                  and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
                  and i.role = 'viewer' and not i.issued_by_studio
                order by i.created_at desc, i.id desc limit 1) as reusable
         from unnest($2::text[]) with ordinality as e(email, n)
        order by e.n`,
      [organizationId, [...emails]],
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      String(row.email),
      {
        email: String(row.email),
        members: (row.members ?? []).map((id) => String(id).toLowerCase()),
        memberName: row.members && row.members.length > 0 ? roomAuthorName('brand', row.member_name, row.member_email) : null,
        removed: row.removed === true,
        heldElsewhere: row.held === true,
        reusable: row.reusable ? String(row.reusable).toLowerCase() : null,
      },
    ]),
  );
}

/**
 * Whether this sender may not invite this (non-member) address through 보내기: it already has a live invitation that is
 * not 보내기's to reuse (whoever sends), or, for an editor, it belongs to someone an owner removed (an owner may invite
 * them again, as from the members page). One answer for both (`invite_refused`).
 */
const refusedFor = (facts: AddressFacts, seat: Pick<RoomSeat, 'role'>): boolean => facts.members.length === 0 && (facts.heldElsewhere || (facts.removed && seat.role !== 'owner'));

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
 * Before the line is written (`send.post`/`send.reply` with `invites`), under the organization's locks: what each
 * address becomes (decision 5), and every refusal, so that a refused request writes, mails and counts nothing. Answers
 * the line's mentions with the members' ids added. Refusals, in this order: a viewer (`forbidden`); a body carrying an
 * invited address, or the sender's own address (`invalid`); the sender no longer an owner or editor (`forbidden`); an
 * address this sender may not invite (`invite_refused`, all such addresses named); more people than a line may name
 * (`invalid`); the daily cap or one invitation's waiting lines (`invite_limit`).
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
  const seat = { role: me.role } as Pick<RoomSeat, 'role'>;
  const facts = await classify(sql, ctx.organizationId, emails);
  const refused = emails.filter((email) => refusedFor(facts.get(email)!, seat));
  if (refused.length > 0) throw new SendInviteDenied('invite_refused', refused);
  const members = new Map<string, string[]>();
  const reuse = new Map<string, string>();
  const create: string[] = [];
  for (const email of emails) {
    const fact = facts.get(email)!;
    if (fact.members.length > 0) members.set(email, fact.members);
    else if (fact.reusable) reuse.set(email, fact.reusable);
    else create.push(email);
  }
  const mentions = [...new Set([...line.mentions.map((id) => id.toLowerCase()), ...[...members.values()].flat()])];
  // Everyone who joins later is added to this line's mentions: the line must still fit the rooms' limit then.
  if (mentions.length + reuse.size + create.length > ROOM_LIMITS.mentionsMax) throw new SendInviteDenied('invalid');
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
  if (create.length > 0) {
    // The organization's daily cap, the members page's invitations and the team's counted together (as they count it).
    const today = (await sql.query<{ n: number }>("select count(*)::int as n from brand_invites where organization_id = $1 and created_at > now() - interval '1 day'", [ctx.organizationId])).rows[0]!;
    if (Number(today.n) + create.length > BRAND_INVITES_PER_DAY) throw new SendInviteDenied('invite_limit');
  }
  return { plan: { emails, members, reuse, create }, mentions };
}

/** One address's invitation request id, derived from the line's, so a retried line never issues a second token. */
export function inviteRequestId(requestId: string, email: string): string {
  const h = createHash('sha256').update(`send-invite:${requestId.toLowerCase()}:${email}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * After the line is written, in its transaction: a new invitation for each address that needs one (the existing writer,
 * `storeInvitation`: role viewer, the sender as inviter, 7 days), and the line's waiting rows. The row of an invitation
 * this line CREATED says so (`created_invite`); a reused one's never does. A failure here throws and the whole request
 * (the line included) is rolled back. Answers the outcome of every address and the new tokens (for the mail after the
 * commit and the writer's copy-the-link answer).
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
  const created = issued.map((one) => one.inviteId);
  const waitFor = [...plan.reuse.values(), ...created];
  if (waitFor.length > 0) {
    await sql.query(
      `insert into brand_room_pending_mentions (message_id, invite_id, organization_id, created_invite)
         select $1, i.id, $3, i.id = any($4::uuid[]) from unnest($2::uuid[]) as i(id) order by i.id`,
      [line.messageId, waitFor, ctx.organizationId, created],
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
    // The writer typed it. An owner sees it too, except an owner-role invitation's (0202's guard keeps a line from waiting
    // for one; kept as a second wall, as the members page hides those from owners).
    const sees = authors.get(id) === reader.me || (reader.owner && row.role !== 'owner');
    const state: SendInviteChip['state'] = row.revoked ? 'expired' : row.accepted ? 'accepted' : row.expired ? 'expired' : 'pending';
    chips.get(id)?.push({ state, email: sees ? String(row.email) : null });
  }
  return chips;
}

/**
 * `send.lookup` (decision 10; ./send.ts answers `invalid` for it before the seat while the switch is closed). A caller who
 * may not invite (a viewer): `not_allowed`, nothing read. Else, at most `SEND_LIMITS.lookupsPerMinute` per person per
 * organization (the studio's sliding-window limiter, `takeFreeIntelSlot`, per server instance), then ONE statement
 * (`classify`) whatever the address: an active member of this organization is `member`; an address this caller may not
 * invite (another live invitation that is not 보내기's, or for an editor someone an owner removed) is `not_allowed`, the
 * same answer as a viewer's; anything else is `invitable`. An address with an account elsewhere on TWINGS, a project guest,
 * an address with a reusable invitation and one never seen answer alike.
 */
export async function lookupAddress(
  sql: SqlRunner,
  ctx: { organizationId: string; me: string; seat: Pick<RoomSeat, 'role'> },
  input: unknown,
  now = Date.now(),
): Promise<SendLookup> {
  const parsed = SendLookupSchema.safeParse(input);
  if (!parsed.success) throw new SendInviteDenied('invalid');
  const email = parsed.data.email;
  // A viewer names colleagues from `send.people`; an address -> member answer is only for those who may invite (it is what
  // turns a typed address into a mention instead of an invitation).
  if (!mayInvite(ctx.seat)) return { ok: true, email, status: 'not_allowed', member: null };
  const { takeFreeIntelSlot } = await import('@/lib/brand-studio/jobs');
  if (!takeFreeIntelSlot(`send-lookup:${ctx.organizationId}:${ctx.me}`, SEND_LIMITS.lookupsPerMinute, now)) throw new SendInviteDenied('rate_limited');
  const fact = (await classify(sql, ctx.organizationId, [email])).get(email)!;
  if (fact.members.length > 0) return { ok: true, email, status: 'member', member: { id: fact.members[0]!, name: fact.memberName ?? '' } };
  if (refusedFor(fact, ctx.seat)) return { ok: true, email, status: 'not_allowed', member: null };
  return { ok: true, email, status: 'invitable', member: null };
}

/* ------------------------------------------------------------------ delivery */

/**
 * The lines waiting for one ACCEPTED invitation reach `userId` (decision 7), in the caller's transaction and savepoint:
 * every waiting line that is still a live members line of the organization and that nobody holds right now (`for update
 * skip locked`: a room operation that holds a line and waits for the organization row is never waited for) names them
 * (added to its mentions) and tells them by slice 4a's rule (a `mention` notice: today's mention mail and push in a
 * project's members channel, in-app only for an unfiled file); the thread is then in their 알림함, unread. The rows of
 * the delivered lines and of lines that are gone are deleted; a skipped line's row stays for `deliverLeftovers`. At most
 * `SEND_LIMITS.linesPerInvitation` lines per call. A closed organization (sandboxed, generation or self_studio denied) has
 * nobody: nothing is delivered and the rows stay. Answers how many lines were delivered.
 */
async function deliverWaitingLines(sql: SqlRunner, organizationId: string, inviteId: string, userId: string, env: Env): Promise<number> {
  const me = userId.toLowerCase();
  if (!(await membersAudience(sql, organizationId)).includes(me)) return 0;
  const lines = (
    await sql.query<{ id: string; parent_id: string | null; project_id: string | null; channel: string; author_id: string | null }>(
      `select m.id::text as id, m.parent_id::text as parent_id, m.project_id::text as project_id, m.channel, m.author_id::text as author_id
         from brand_room_pending_mentions pm
         join brand_room_messages m on m.id = pm.message_id and m.organization_id = pm.organization_id
        where pm.invite_id = $1 and pm.organization_id = $2 and m.deleted_at is null and ${MEMBERS_LINE('m')}
        order by m.id
        limit $3
        for update of m skip locked`,
      [inviteId, organizationId, SEND_LIMITS.linesPerInvitation],
    )
  ).rows;
  const delivered = lines.map((line) => String(line.id).toLowerCase());
  if (delivered.length > 0) {
    await sql.query(
      `update brand_room_messages set mentions = array_append(mentions, $3::uuid)
        where organization_id = $1 and id = any($2::uuid[]) and not (mentions @> array[$3::uuid])`,
      [organizationId, delivered, me],
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
  // The delivered lines' rows, and those of lines that are gone (deleted, or no longer a members line); a line that was
  // held by someone else keeps its row.
  await sql.query(
    `delete from brand_room_pending_mentions pm
      where pm.invite_id = $1 and pm.organization_id = $2
        and (pm.message_id = any($3::uuid[])
             or exists (select 1 from brand_room_messages m where m.id = pm.message_id and (m.deleted_at is not null or not (${MEMBERS_LINE('m')}))))`,
    [inviteId, organizationId, delivered],
  );
  return delivered.length;
}

/** Invitations of one member whose waiting lines one read delivers at most (`deliverLeftovers`). */
const LEFTOVER_INVITATIONS = 5;

/**
 * Lines that waited for an invitation `userId` has ACCEPTED but that did not reach them (delivery skipped a line someone
 * held, or failed, or the acceptance happened while 초대하고 보내기 was closed): delivered once on their next `send.inbox`
 * or bell read while it is open, before the read is answered. Its own savepoint; it never fails the read (a failure rolls
 * this part back and is logged without text). When there is nothing left, it costs the savepoint, one read and the
 * release; with leftovers, it takes the organization row `for key share` first (the lock order of every write here).
 */
export async function deliverLeftovers(sql: SqlRunner, organizationId: string, userId: string, env: Env = process.env): Promise<number> {
  await sql.query('savepoint brand_send_invite_leftovers');
  try {
    const invites = (
      await sql.query<{ id: string }>(
        `select distinct pm.invite_id::text as id from brand_room_pending_mentions pm
           join brand_invites i on i.id = pm.invite_id and i.organization_id = pm.organization_id
          where pm.organization_id = $1 and i.accepted_by = $2 and i.accepted_at is not null and i.revoked_at is null
          order by 1 limit $3`,
        [organizationId, userId, LEFTOVER_INVITATIONS],
      )
    ).rows.map((row) => String(row.id));
    let delivered = 0;
    if (invites.length > 0) {
      await sql.query('select id from brand_organizations where id = $1 for key share', [organizationId]);
      for (const inviteId of invites) delivered += await deliverWaitingLines(sql, organizationId, inviteId, userId, env);
    }
    await sql.query('release savepoint brand_send_invite_leftovers');
    return delivered;
  } catch (error) {
    await sql.query('rollback to savepoint brand_send_invite_leftovers').catch(() => undefined);
    console.warn('[brand-send] invite_leftovers_failed', JSON.stringify({ code: sqlState(error) }));
    return 0;
  }
}

/* ------------------------------------------------------------------ acceptance */

/**
 * The acceptance's part (lib/brands/workspace/service.ts `acceptBrandInvitation`, set by the route), in the acceptance's
 * own transaction. Each hook first asks what is known without a statement (the switches, the spine's organization list,
 * a remembered miss of a probe): closed, it returns before any statement and the acceptance is exactly what it was before
 * slice 4c. Otherwise EVERY statement it runs, the open check included, runs inside its own savepoint: whatever fails
 * there (a timeout, a missing relation) is rolled back alone, logged without text, and the acceptance goes on.
 */
export function sendInviteAcceptHooks(env: Env = process.env): BrandSendInviteHooks {
  return {
    /**
     * An organization invitation issued by an EDITOR (the members page lets only owners issue one) is honoured only if
     * 보내기 CREATED it (a waiting row says so: `created_invite`, set only when the line's own send wrote the invitation,
     * never by a line that reused one), while 초대하고 보내기 and the organization are open. The caller has already
     * checked the role (viewer) and that the editor still holds an owner or editor seat. And never for someone an owner
     * removed from this organization. Anything else: not honoured (`not_found`, as before slice 4c).
     */
    async honoursEditorInvitation(sql, invite, userId) {
      if (knownClosedFor(invite.organizationId, env)) return false;
      await sql.query('savepoint brand_send_invite_honour');
      try {
        let honoured = false;
        if (await brandSendInviteOpenFor(sql, invite.organizationId, env)) {
          const created = (
            await sql.query<{ n: number }>(
              'select count(*)::int as n from brand_room_pending_mentions where invite_id = $1 and organization_id = $2 and created_invite',
              [invite.id, invite.organizationId],
            )
          ).rows[0]!;
          const removed =
            Number(created.n) > 0 &&
            (await sql.query("select 1 from brand_memberships where organization_id = $1 and user_id = $2 and status <> 'active'", [invite.organizationId, userId])).rows.length > 0;
          honoured = Number(created.n) > 0 && !removed && (await membersAudience(sql, invite.organizationId)).length > 0;
        }
        await sql.query('release savepoint brand_send_invite_honour');
        return honoured;
      } catch (error) {
        await sql.query('rollback to savepoint brand_send_invite_honour').catch(() => undefined);
        console.warn('[brand-send] invite_honour_failed', JSON.stringify({ code: sqlState(error) }));
        return false;
      }
    },

    /**
     * Decision 7: after the membership is written, the lines waiting for this invitation reach the new member
     * (`deliverWaitingLines`); a line someone holds right now stays waiting and is delivered on their next read
     * (`deliverLeftovers`). Never throws.
     */
    async deliver(sql, invite, userId) {
      if (knownClosedFor(invite.organizationId, env)) return;
      await sql.query('savepoint brand_send_invite_accept');
      try {
        if (await brandSendInviteOpenFor(sql, invite.organizationId, env)) {
          await deliverWaitingLines(sql, invite.organizationId.toLowerCase(), invite.id, userId, env);
        }
        await sql.query('release savepoint brand_send_invite_accept');
      } catch (error) {
        await sql.query('rollback to savepoint brand_send_invite_accept').catch(() => undefined);
        console.warn('[brand-send] invite_delivery_failed', JSON.stringify({ code: sqlState(error) }));
      }
    },
  };
}
