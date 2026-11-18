/**
 * Project room invitations (docs/BRAND-ROOMS-FEEDBACK.md §12) — behind `BRAND_ROOM_INVITES`.
 *
 * A brand owner or editor invites people by e-mail to ONE project room. An invitee who accepts becomes a
 * project guest (`brand_project_members`, the 0031 seat the team's invitations already make): they open
 * that project's room only, never another project, the general channel, settings or the studio. They may
 * view only or also comment (`can_comment`, enforced in rooms by `canTalkIn`). The inviter manages who has
 * access: the brand's members (read-only here), guests (permission, remove) and pending invitations
 * (re-send, cancel).
 *
 * Gate, every call: the room seat (sign-in, membership, the sandbox hardline and the generation policy —
 * a closed brand answers `not_found`, exactly like a missing one), this project (client-visible, in this
 * brand), then owners and editors only. The route checks the flags first.
 *
 * Rows are written by `storeInvitation` (lib/brands/workspace/service.ts), the one writer the team's
 * invitations use too; acceptance is `acceptBrandInvitation` there. The invitation mail goes out after the
 * transaction commits, through the existing mailer and the transactional sheet; its outcome is stored on
 * the row (`mail_state`, 0097). No mailer configured: nothing is sent, the state is 'skipped' and the
 * inviter gets the link to pass on. A token is in memory only for the length of one response.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Mailer } from '@/lib/notify/mailer';
import { sheet, sheetText, type SheetArgs } from '@/lib/notify/sheet';
import { companyLine } from '@/lib/notify/company-line';
import { brandSiteUrl } from '@/lib/seo/site-url';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { BRAND_INVITES_PER_DAY, storeInvitation } from '@/lib/brands/workspace/service';
import { RoomDenied, requireRoomProject, roomSeat, type RoomSeat } from './access';
import {
  ROOM_INVITE_LIMITS,
  ROOM_PEOPLE_OPERATIONS,
  RoomGuestPermissionSchema,
  RoomGuestRemoveSchema,
  RoomInviteRefSchema,
  RoomInviteSendSchema,
  inviteAcceptPath,
  type RoomInviteFailure,
  type RoomInviteErrorCode,
  type RoomInviteMailState,
  type RoomInviteResult,
  type RoomInviteSent,
  type RoomInviteTarget,
  type RoomPeople,
  type RoomPeopleDone,
  type RoomPeopleOperation,
} from './invite-contracts';

export interface RoomInviteDeps {
  sql: SqlRunner;
  /** `getMailer()`; null when no mailer is configured here (nothing is sent, the link is handed back). */
  mailer: Mailer | null;
  env?: NodeJS.ProcessEnv;
}

export class InviteDenied extends Error {
  constructor(
    readonly code: RoomInviteErrorCode,
    readonly email?: string,
  ) {
    super(code);
    this.name = 'InviteDenied';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stamp = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

async function guard<T>(fn: () => Promise<T>): Promise<T | RoomInviteFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof InviteDenied) return error.email ? { ok: false, code: error.code, email: error.email } : { ok: false, code: error.code };
    if (error instanceof RoomDenied) return { ok: false, code: error.code };
    if ((error as { code?: string }).code === '23505') return { ok: false, code: 'rate_limited' };
    throw error;
  }
}

/** Seat, project, then owners and editors. Returns the seat and the project title. */
async function managerSeat(sql: SqlRunner, viewer: Viewer, organizationId: string, projectId: string): Promise<{ seat: RoomSeat; title: string }> {
  const seat = await roomSeat(sql, viewer.userId, organizationId);
  const project = await requireRoomProject(sql, seat, projectId);
  if (!seat.canEdit) throw new InviteDenied('forbidden');
  return { seat, title: project.title };
}

/* ------------------------------------------------------------------ read */

/** This project's guests (the account that got in, and the address it was invited at) and waiting invitations. */
async function accessLists(sql: SqlRunner, organizationId: string, projectId: string): Promise<Pick<RoomPeople, 'guests' | 'pending'>> {
  const query = { organizationId, projectId };
  const guests = (
    await sql.query<{ user_id: string; display_name: string | null; email: string | null; can_comment: boolean; created_at: Date | string; invited_email: string | null }>(
      `select g.user_id::text as user_id, p.display_name, p.email, g.can_comment, g.created_at,
              (select i.email from brand_invites i
                where i.organization_id = g.organization_id and i.project_id = g.project_id and i.accepted_by = g.user_id
                order by i.accepted_at desc nulls last limit 1) as invited_email
         from brand_project_members g join profiles p on p.id = g.user_id
        where g.organization_id = $1 and g.project_id = $2 and g.status = 'active'
          and not exists (select 1 from brand_memberships m where m.organization_id = g.organization_id and m.user_id = g.user_id and m.status = 'active')
        order by g.created_at, g.user_id`,
      [query.organizationId, query.projectId],
    )
  ).rows;
  const pending = (
    await sql.query<{ id: string; email: string; can_comment: boolean; expires_at: Date | string; mail_state: RoomInviteMailState }>(
      `select id::text as id, email, can_comment, expires_at, mail_state from brand_invites
        where organization_id = $1 and project_id = $2 and accepted_at is null and revoked_at is null and expires_at > now()
        order by created_at desc, id`,
      [query.organizationId, query.projectId],
    )
  ).rows;
  const lower = (v: string | null) => (v ? v.trim().toLowerCase() : null);
  return {
    guests: guests.map((g) => {
      const email = lower(g.email);
      const invited = lower(g.invited_email);
      return {
        userId: String(g.user_id),
        name: g.display_name?.trim() || null,
        email,
        invitedEmail: invited && invited !== email ? invited : null,
        canComment: g.can_comment === true,
        joinedAt: stamp(g.created_at),
      };
    }),
    pending: pending.map((i) => ({
      id: String(i.id),
      email: String(i.email),
      canComment: i.can_comment === true,
      expiresAt: stamp(i.expires_at),
      mailState: i.mail_state ?? null,
    })),
  };
}

/** `GET /api/brand-rooms/people?organizationId=&projectId=` — who has access to this project room. */
export async function loadRoomAccess(deps: Pick<RoomInviteDeps, 'sql'>, viewer: Viewer, query: { organizationId: string; projectId: string }): Promise<RoomPeople | RoomInviteFailure> {
  if (!UUID.test(query.organizationId) || !UUID.test(query.projectId)) return { ok: false, code: 'not_found' };
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const { seat } = await managerSeat(sql, viewer, query.organizationId, query.projectId);
      const members = (
        await sql.query<{ user_id: string; display_name: string | null; email: string | null; role: string }>(
          `select m.user_id::text as user_id, p.display_name, p.email, m.role
             from brand_memberships m join profiles p on p.id = m.user_id
            where m.organization_id = $1 and m.status = 'active'
            order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, m.created_at, m.user_id`,
          [query.organizationId],
        )
      ).rows;
      const lists = await accessLists(sql, query.organizationId, query.projectId);
      const lower = (v: string | null) => (v ? v.trim().toLowerCase() : null);
      return {
        ok: true as const,
        canManage: true,
        members: members.map((m) => ({
          userId: String(m.user_id),
          name: m.display_name?.trim() || null,
          email: m.role !== 'owner' || m.user_id === seat.userId ? lower(m.email) : null,
          role: m.role as 'owner' | 'editor' | 'viewer',
          self: m.user_id === seat.userId,
        })),
        guests: lists.guests,
        pending: lists.pending,
      } satisfies RoomPeople;
    }),
  );
}

/**
 * The team's desk (`/admin/brand-rooms/[organizationId]/[projectId]`, share links tab): this project's guests
 * and waiting invitations, read-only. The admin flag is re-read from the profile row inside the transaction;
 * the desk page has already 404'd a closed brand and a project outside it, and this re-checks the project.
 */
export async function staffProjectGuests(
  deps: Pick<RoomInviteDeps, 'sql'>,
  viewer: Viewer,
  scope: { organizationId: string; projectId: string },
): Promise<{ ok: true; guests: RoomPeople['guests']; pending: RoomPeople['pending'] } | RoomInviteFailure> {
  if (!viewer.userId || !UUID.test(viewer.userId) || !UUID.test(scope.organizationId) || !UUID.test(scope.projectId)) return { ok: false, code: 'not_found' };
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const admin = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [viewer.userId])).rows[0];
      if (admin?.is_admin !== true) throw new InviteDenied('forbidden');
      const project = (await sql.query('select id from brand_projects where id = $1 and organization_id = $2', [scope.projectId, scope.organizationId])).rows[0];
      if (!project) throw new InviteDenied('not_found');
      const list = await accessLists(sql, scope.organizationId, scope.projectId);
      return { ok: true as const, guests: list.guests, pending: list.pending };
    }),
  );
}

/* ------------------------------------------------------------------ writes */

interface Issued {
  email: string;
  inviteId: string;
  token: string;
  canComment: boolean;
}

interface MailContext {
  organizationName: string;
  projectTitle: string;
  inviterName: string;
  locale: 'ko' | 'en';
}

/** One address's request id, derived from the send's, so a retried send never issues a second token. */
function derivedRequestId(requestId: string, email: string): string {
  const h = createHash('sha256').update(`${requestId.toLowerCase()}:${email}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function inviterName(sql: SqlRunner, userId: string): Promise<string> {
  const row = (await sql.query<{ display_name: string | null; email: string | null }>('select display_name, email from profiles where id = $1', [userId])).rows[0];
  return row?.display_name?.trim() || row?.email?.trim() || '';
}

async function targetInProject(sql: SqlRunner, organizationId: string, projectId: string, target: RoomInviteTarget): Promise<boolean> {
  const row =
    target.kind === 'review'
      ? (await sql.query('select id from brand_studio_reviews where id = $1 and organization_id = $2 and project_id = $3 and deleted_at is null', [target.id, organizationId, projectId])).rows[0]
      : (await sql.query('select id from brand_storyboards where id = $1 and organization_id = $2 and project_id = $3 and deleted_at is null', [target.id, organizationId, projectId])).rows[0];
  return Boolean(row);
}

/** Lock the organization (the issue/accept/revoke lock order) and check today's count plus `adding`. */
async function lockAndCount(sql: SqlRunner, organizationId: string, projectId: string, adding: number, refreshing: string[]): Promise<void> {
  await sql.query('select id from brand_organizations where id = $1 for update', [organizationId]);
  const today = (await sql.query<{ n: number }>("select count(*)::int as n from brand_invites where organization_id = $1 and created_at > now() - interval '1 day'", [organizationId])).rows[0]!;
  if (Number(today.n) + adding > BRAND_INVITES_PER_DAY) throw new InviteDenied('rate_limited');
  // Re-inviting an address that is already waiting refreshes it, so it does not count twice.
  const waiting = (
    await sql.query<{ n: number }>(
      `select count(*)::int as n from brand_invites
        where organization_id = $1 and project_id = $2 and accepted_at is null and revoked_at is null and expires_at > now()
          and not (email = any($3::text[]))`,
      [organizationId, projectId, refreshing],
    )
  ).rows[0]!;
  if (Number(waiting.n) + adding > ROOM_INVITE_LIMITS.pendingPerProject) throw new InviteDenied('project_limit');
}

async function sendInvite(sql: SqlRunner, viewer: Viewer, raw: unknown): Promise<{ results: RoomInviteResult[]; issued: Issued[]; mail: MailContext; organizationId: string; projectId: string }> {
  const parsed = RoomInviteSendSchema.safeParse(raw);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.path[0] === 'emails' && i.code === 'too_big');
    throw new InviteDenied(tooMany ? 'too_many' : 'invalid');
  }
  const v = parsed.data;
  const emails = [...new Set(v.emails)];
  const { seat, title } = await managerSeat(sql, viewer, v.organizationId, v.projectId);
  if (v.target && !(await targetInProject(sql, v.organizationId, v.projectId, v.target))) throw new InviteDenied('not_found');
  // A retried send (same request id) hands back what the first one stored, never a second token.
  const requestIds = emails.map((email) => derivedRequestId(v.requestId, email));
  const prior = (
    await sql.query<{ id: string; email: string; mail_state: RoomInviteMailState }>(
      'select id::text as id, email, mail_state from brand_invites where organization_id = $1 and created_by = $2 and request_id = any($3::uuid[])',
      [v.organizationId, seat.userId, requestIds],
    )
  ).rows;
  const mail: MailContext = { organizationName: seat.organizationName, projectTitle: title, inviterName: await inviterName(sql, seat.userId), locale: v.locale };
  if (prior.length) {
    return {
      results: prior.map((p) => ({ email: String(p.email), state: p.mail_state ?? 'skipped', inviteId: String(p.id), link: null })),
      issued: [],
      mail,
      organizationId: v.organizationId,
      projectId: v.projectId,
    };
  }
  const members = new Set(
    (
      await sql.query<{ email: string }>(
        `select lower(p.email) as email from brand_memberships m join profiles p on p.id = m.user_id
          where m.organization_id = $1 and m.status = 'active' and lower(p.email) = any($2::text[])`,
        [v.organizationId, emails],
      )
    ).rows.map((r) => String(r.email)),
  );
  const guests = new Set(
    (
      await sql.query<{ email: string }>(
        `select lower(p.email) as email from brand_project_members g join profiles p on p.id = g.user_id
          where g.organization_id = $1 and g.project_id = $2 and g.status = 'active' and lower(p.email) = any($3::text[])`,
        [v.organizationId, v.projectId, emails],
      )
    ).rows.map((r) => String(r.email)),
  );
  const fresh = emails.filter((e) => !members.has(e) && !guests.has(e));
  if (fresh.length) await lockAndCount(sql, v.organizationId, v.projectId, fresh.length, fresh);
  const results: RoomInviteResult[] = [];
  const issued: Issued[] = [];
  for (const email of emails) {
    if (members.has(email)) {
      results.push({ email, state: 'already_member', inviteId: null, link: null });
      continue;
    }
    if (guests.has(email)) {
      results.push({ email, state: 'already_guest', inviteId: null, link: null });
      continue;
    }
    const stored = await storeInvitation(sql, {
      organizationId: v.organizationId,
      projectId: v.projectId,
      email,
      role: 'viewer',
      canComment: v.canComment,
      issuedByStudio: false,
      createdBy: seat.userId,
      requestId: derivedRequestId(v.requestId, email),
      target: v.target,
    });
    issued.push({ email, inviteId: stored.id, token: stored.token, canComment: v.canComment });
    results.push({ email, state: 'skipped', inviteId: stored.id, link: null });
  }
  return { results, issued, mail, organizationId: v.organizationId, projectId: v.projectId };
}

async function resendInvite(sql: SqlRunner, viewer: Viewer, raw: unknown): Promise<{ results: RoomInviteResult[]; issued: Issued[]; mail: MailContext; organizationId: string; projectId: string }> {
  const parsed = RoomInviteRefSchema.safeParse(raw);
  if (!parsed.success) throw new InviteDenied('invalid');
  const v = parsed.data;
  const { seat, title } = await managerSeat(sql, viewer, v.organizationId, v.projectId);
  const old = (
    await sql.query<{ email: string; can_comment: boolean; target_kind: string | null; target_id: string | null }>(
      `select email, can_comment, target_kind, target_id::text as target_id from brand_invites
        where id = $1 and organization_id = $2 and project_id = $3 and accepted_at is null and revoked_at is null`,
      [v.inviteId, v.organizationId, v.projectId],
    )
  ).rows[0];
  if (!old) throw new InviteDenied('not_found');
  await lockAndCount(sql, v.organizationId, v.projectId, 1, [String(old.email)]);
  const kind: RoomInviteTarget['kind'] | null = old.target_kind === 'review' || old.target_kind === 'storyboard' ? old.target_kind : null;
  const target = kind && old.target_id ? { kind, id: old.target_id } : null;
  const stored = await storeInvitation(sql, {
    organizationId: v.organizationId,
    projectId: v.projectId,
    email: String(old.email),
    role: 'viewer',
    canComment: old.can_comment === true,
    issuedByStudio: false,
    createdBy: seat.userId,
    requestId: randomUUID(),
    target,
  });
  const mail: MailContext = { organizationName: seat.organizationName, projectTitle: title, inviterName: await inviterName(sql, seat.userId), locale: v.locale };
  return {
    results: [{ email: String(old.email), state: 'skipped', inviteId: stored.id, link: null }],
    issued: [{ email: String(old.email), inviteId: stored.id, token: stored.token, canComment: old.can_comment === true }],
    mail,
    organizationId: v.organizationId,
    projectId: v.projectId,
  };
}

async function cancelInvite(sql: SqlRunner, viewer: Viewer, raw: unknown): Promise<RoomPeopleDone> {
  const parsed = RoomInviteRefSchema.safeParse(raw);
  if (!parsed.success) throw new InviteDenied('invalid');
  const v = parsed.data;
  await managerSeat(sql, viewer, v.organizationId, v.projectId);
  await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId]);
  const gone = await sql.query(
    'update brand_invites set revoked_at = now() where id = $1 and organization_id = $2 and project_id = $3 and accepted_at is null and revoked_at is null returning id',
    [v.inviteId, v.organizationId, v.projectId],
  );
  if (!gone.rows[0]) throw new InviteDenied('not_found');
  return { ok: true };
}

async function guestRow(sql: SqlRunner, organizationId: string, projectId: string, userId: string): Promise<void> {
  const row = (
    await sql.query(
      `select g.user_id from brand_project_members g
        where g.organization_id = $1 and g.project_id = $2 and g.user_id = $3 and g.status = 'active'
          and not exists (select 1 from brand_memberships m where m.organization_id = g.organization_id and m.user_id = g.user_id and m.status = 'active')
        for update`,
      [organizationId, projectId, userId],
    )
  ).rows[0];
  if (!row) throw new InviteDenied('not_found');
}

async function setGuestPermission(sql: SqlRunner, viewer: Viewer, raw: unknown): Promise<RoomPeopleDone> {
  const parsed = RoomGuestPermissionSchema.safeParse(raw);
  if (!parsed.success) throw new InviteDenied('invalid');
  const v = parsed.data;
  await managerSeat(sql, viewer, v.organizationId, v.projectId);
  await guestRow(sql, v.organizationId, v.projectId, v.userId);
  await sql.query('update brand_project_members set can_comment = $4 where organization_id = $1 and project_id = $2 and user_id = $3', [
    v.organizationId,
    v.projectId,
    v.userId,
    v.canComment,
  ]);
  return { ok: true };
}

/**
 * Removing a guest revokes their seat at once (every later request answers 404) and the invitations that
 * brought them in, so an old link cannot bring them back. Notices are decided at send time from
 * `roomAudience`, which reads only active seats, so nothing more reaches them either.
 */
async function removeGuest(sql: SqlRunner, viewer: Viewer, raw: unknown): Promise<RoomPeopleDone> {
  const parsed = RoomGuestRemoveSchema.safeParse(raw);
  if (!parsed.success) throw new InviteDenied('invalid');
  const v = parsed.data;
  await managerSeat(sql, viewer, v.organizationId, v.projectId);
  await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId]);
  await guestRow(sql, v.organizationId, v.projectId, v.userId);
  await sql.query("update brand_project_members set status = 'revoked' where organization_id = $1 and project_id = $2 and user_id = $3", [
    v.organizationId,
    v.projectId,
    v.userId,
  ]);
  await sql.query(
    `update brand_invites set revoked_at = now()
      where organization_id = $1 and project_id = $2 and revoked_at is null
        and (accepted_by = $3 or (accepted_at is null and email = (select lower(email) from profiles where id = $3)))`,
    [v.organizationId, v.projectId, v.userId],
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ mail */

export interface RoomInviteMailInput {
  locale: 'ko' | 'en';
  token: string;
  organizationName: string;
  projectTitle: string;
  inviterName: string;
  canComment: boolean;
  expiresAt: Date;
  env?: NodeJS.ProcessEnv;
}

export interface RoomInviteMail {
  subject: string;
  html: string;
  text: string;
  buttonUrl: string;
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k]! : m));

function longDate(at: Date, locale: 'ko' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(at);
}

/**
 * The invitation mail, on the transactional sheet: who invited, the brand and the project, one button to
 * the acceptance page (the token rides in the fragment, as on every invitation link), the expiry date and
 * that the link is for the recipient only, then why they got it and the company line. No marketing and
 * no unsubscribe: it is a one-off mail someone asked to send. Every sentence is in messages/rooms-share.ts.
 */
export function buildRoomInviteEmail(input: RoomInviteMailInput): RoomInviteMail {
  const env = input.env ?? process.env;
  const copy = getDictionary(input.locale).roomsShare.mail;
  const vars = {
    inviter: input.inviterName,
    organization: input.organizationName,
    project: input.projectTitle,
    date: longDate(input.expiresAt, input.locale),
  };
  const buttonUrl = `${brandSiteUrl(env)}${inviteAcceptPath(input.token)}`;
  const args: SheetArgs = {
    title: fill(copy.heading, vars),
    paragraphs: [fill(copy.body, vars), ...(input.canComment ? [copy.bodyComment] : []), fill(copy.expiry, vars), copy.personal],
    button: { label: copy.button, url: buttonUrl },
    note: { text: fill(copy.why, vars) },
    footer: companyLine(input.locale, { address: true }),
  };
  return { subject: fill(copy.subject, vars), html: sheet(args), text: sheetText(args), buttonUrl };
}

async function deliver(deps: RoomInviteDeps, issued: Issued[], mail: MailContext, results: RoomInviteResult[]): Promise<RoomInviteResult[]> {
  const out = results.map((r) => ({ ...r }));
  for (const one of issued) {
    const row = (await deps.sql.query<{ expires_at: Date | string }>('select expires_at from brand_invites where id = $1', [one.inviteId])).rows[0];
    const expiresAt = row ? new Date(stamp(row.expires_at)) : new Date(Date.now() + ROOM_INVITE_LIMITS.expiryDays * 86_400_000);
    let state: Exclude<RoomInviteMailState, null> = 'skipped';
    if (deps.mailer) {
      const built = buildRoomInviteEmail({ locale: mail.locale, token: one.token, organizationName: mail.organizationName, projectTitle: mail.projectTitle, inviterName: mail.inviterName, canComment: one.canComment, expiresAt, env: deps.env });
      try {
        const outcome = await deps.mailer.send({ to: one.email, subject: built.subject, html: built.html, text: built.text, idempotencyKey: `room-invite:${one.inviteId}`, unsubscribeUrl: '' });
        state = outcome.ok ? 'sent' : 'failed';
      } catch {
        state = 'failed';
      }
    }
    await deps.sql.query("update brand_invites set mail_state = $2, mail_sent_at = case when $2 = 'sent' then now() else null end where id = $1", [one.inviteId, state]);
    const result = out.find((r) => r.inviteId === one.inviteId);
    if (result) {
      result.state = state;
      // The link travels back only when the mail did not go out, so the inviter can pass it on.
      result.link = state === 'sent' ? null : `${brandSiteUrl(deps.env ?? process.env)}${inviteAcceptPath(one.token)}`;
    }
  }
  return out;
}

/** One `POST /api/brand-rooms/people` operation. Unknown names are `invalid`. */
export async function runRoomPeopleOperation(deps: RoomInviteDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<RoomInviteSent | RoomPeopleDone | RoomInviteFailure> {
  if (typeof operation !== 'string' || !(ROOM_PEOPLE_OPERATIONS as readonly string[]).includes(operation)) return { ok: false, code: 'invalid' };
  const op = operation as RoomPeopleOperation;
  if (op === 'invite.send' || op === 'invite.resend') {
    const stored = await guard(() => deps.sql.transaction((sql) => (op === 'invite.send' ? sendInvite(sql, viewer, input) : resendInvite(sql, viewer, input))));
    if ('ok' in stored) return stored;
    const results = await deliver(deps, stored.issued, stored.mail, stored.results);
    return { ok: true, results };
  }
  return guard(() =>
    deps.sql.transaction((sql) => {
      switch (op) {
        case 'invite.cancel':
          return cancelInvite(sql, viewer, input);
        case 'guest.permission':
          return setGuestPermission(sql, viewer, input);
        default:
          return removeGuest(sql, viewer, input);
      }
    }),
  );
}
