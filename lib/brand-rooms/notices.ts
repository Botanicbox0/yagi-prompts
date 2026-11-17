/**
 * Notices to brand members about their project rooms (docs/BRAND-ROOMS-FEEDBACK.md §2): a mail, and a
 * push to the devices they turned push on for.
 *
 * Queued in three places only: every room event line (`postRoomEvent`, ./events.ts), a chat line
 * (`message.send` and `staffSendMessage`, ./messages.ts), and the receipt for a new request
 * (app/api/brand-workspace `project.create`). Queueing is best effort exactly like the event line: it
 * runs under its own savepoint, logs and swallows any failure, and never fails the write that called it.
 *
 * Sent by `runRoomNoticePass`: the 10-minute cron tick (/api/brand-rooms/notices/tick) and one pass
 * kicked after the response that queued something (`kickRoomNoticePass`, Next.js `after()`).
 *
 * A "place" is a project room, or the organization's general channel ("일반 문의", `project_id` null,
 * members only): every grouping, read check and cap below is per recipient × place.
 *
 *   push   at most once, as soon as a pass sees the row (no 10-minute wait): claimed rows are marked
 *          first, then corrected to `sent` / `failed`.
 *   mail   `now` rows of one recipient × place in one pass become one mail; `bundle` rows wait 10
 *          minutes, are dropped when the person has read that channel since (`read`), and go out at most
 *          once per recipient × place every 30 minutes. A muted person (`brand_room_notice_prefs`) is
 *          skipped. The provider's idempotency key is the batch id, kept across the 3 attempts.
 *
 * Off unless `BRAND_ROOM_NOTIFY=on` and rooms are open (`BRAND_ROOMS=on`). The rule table and every
 * string are proposals waiting for the founder (§8-1, §8-2): nothing is sent with the flag off.
 */
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRoomNotifyOpen, brandRoomsOpen } from '@/lib/flags';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { companyLine } from '@/lib/notify/company-line';
import type { Mailer, SendOutcome } from '@/lib/notify/mailer';
import { createWebPushSender, pushConfigFromEnv, sendPushToUser, type PushMessage, type PushSender } from '@/lib/notify/push';
import { getMailer } from '@/lib/notify/service';
import { sheet, sheetText } from '@/lib/notify/sheet';
import { ROOM_EMAIL_SCOPE, unsubscribePath } from '@/lib/notify/unsubscribe';
import { brandSiteUrl, siteUrl } from '@/lib/seo/site-url';
import { roomAudience } from './access';
import type { RoomEventKind } from './events';

/* ------------------------------------------------------------------ rules (§2.1) */

export const ROOM_NOTICE_KINDS = ['new_version', 'storyboard', 'team_message', 'team_reply', 'mention', 'intake_received'] as const;
export type RoomNoticeKind = (typeof ROOM_NOTICE_KINDS)[number];

export interface RoomNoticeRule {
  /** `now`: the next pass mails it. `bundle`: 10 minutes later, if still unread. `none`: no mail. */
  email: 'now' | 'bundle' | 'none';
  push: boolean;
  /** Whose action it has to be. Anything else queues nothing. */
  actor: 'studio' | 'brand' | 'any';
}

/** §2.1 as data. Proposed values, founder confirmation pending (§8-1). */
export const ROOM_NOTICE_RULES: Readonly<Record<RoomNoticeKind, RoomNoticeRule>> = {
  /** The team posted a new draft or a new version of one. */
  new_version: { email: 'now', push: true, actor: 'studio' },
  /** The team shared a storyboard or a new version of one. */
  storyboard: { email: 'now', push: true, actor: 'studio' },
  /** A team line in the project's conversation. */
  team_message: { email: 'bundle', push: true, actor: 'studio' },
  /** The team answered on a draft. */
  team_reply: { email: 'bundle', push: true, actor: 'studio' },
  /** A line that names the person, from a colleague or the team. Replaces `team_message` for that person. */
  mention: { email: 'now', push: true, actor: 'any' },
  /** The receipt for a new request, to the person who sent it only. */
  intake_received: { email: 'now', push: false, actor: 'brand' },
};

/** Which event lines notify. Approvals, change requests and the brand's own lines notify nobody (§2.1 last row). */
export const ROOM_EVENT_NOTICES: Readonly<Partial<Record<RoomEventKind, RoomNoticeKind>>> = {
  review_posted: 'new_version',
  review_version: 'new_version',
  storyboard_shared: 'storyboard',
  storyboard_version: 'storyboard',
  review_commented: 'team_reply',
};

/** A chat line: whoever it names gets `mention`; everyone else hears only about the team's lines. */
export function messageNoticeKind(actorRole: 'brand' | 'studio', mentioned: boolean): RoomNoticeKind | null {
  if (mentioned) return 'mention';
  return actorRole === 'studio' ? 'team_message' : null;
}

export const ROOM_NOTICE_LIMITS = {
  /** A bundled mail waits this long for the person to read the line in the app (§8-3). */
  bundleDelayMinutes: 10,
  /** At most one bundled mail per recipient × place (project or general) in this window (§8-3). */
  bundleCapMinutes: 30,
  maxAttempts: 3,
  /** Lines in one mail; the rest is "and N more". */
  maxLines: 5,
  /** How much of a team line a mail quotes. */
  excerptChars: 120,
  leaseMinutes: 10,
  /** Rows one pass claims, per phase. */
  passRows: 200,
} as const;

const MINUTE = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both switches: notices themselves, and the rooms they link into. */
export function roomNoticesOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return brandRoomNotifyOpen(env) && brandRoomsOpen(env);
}

const actorFits = (rule: RoomNoticeRule, role: 'brand' | 'studio'): boolean => rule.actor === 'any' || rule.actor === role;

/* ------------------------------------------------------------------ queue */

export type RoomNoticeSource =
  | {
      type: 'event';
      organizationId: string;
      projectId: string;
      event: RoomEventKind;
      /** The event line's own id (`brand_room_messages.id`). */
      messageId: string;
      actorId: string | null;
      actorRole: 'brand' | 'studio';
    }
  | {
      type: 'message';
      organizationId: string;
      /** Null for the organization's general channel ("일반 문의"): its members, no project guests. */
      projectId: string | null;
      messageId: string;
      actorId: string;
      actorRole: 'brand' | 'studio';
      mentions: readonly string[];
    }
  | { type: 'intake'; organizationId: string; projectId: string; actorId: string };

export interface EnqueueOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Default true: schedule one pass after the response (a no-op outside a request). */
  kick?: boolean;
}

interface PlannedNotice {
  recipientId: string;
  kind: RoomNoticeKind;
  messageId: string | null;
}

/** The place a notice is about: a project id, or null for the organization's general channel. */
function placeOf(source: RoomNoticeSource): string | null | undefined {
  if (source.type === 'message' && source.projectId === null) return null;
  return source.projectId && UUID.test(source.projectId) ? source.projectId.toLowerCase() : undefined;
}

async function planNotices(sql: SqlRunner, source: RoomNoticeSource): Promise<PlannedNotice[]> {
  // `undefined` = no valid place. Only a chat line can be in the general channel (null).
  if (!source || !UUID.test(source.organizationId ?? '') || placeOf(source) === undefined) return [];
  const actor = source.actorId && UUID.test(source.actorId) ? source.actorId.toLowerCase() : null;
  if (source.type === 'intake') {
    if (!actor || !actorFits(ROOM_NOTICE_RULES.intake_received, 'brand')) return [];
    const audience = await roomAudience(sql, source.organizationId, source.projectId);
    return audience.some((a) => a.userId === actor) ? [{ recipientId: actor, kind: 'intake_received', messageId: null }] : [];
  }
  if (!UUID.test(source.messageId ?? '')) return [];
  const messageId = source.messageId.toLowerCase();
  if (source.type === 'event') {
    const kind = ROOM_EVENT_NOTICES[source.event];
    if (!kind || !actorFits(ROOM_NOTICE_RULES[kind], source.actorRole)) return [];
    const audience = await roomAudience(sql, source.organizationId, source.projectId);
    return audience.filter((a) => a.userId !== actor).map((a) => ({ recipientId: a.userId, kind, messageId }));
  }
  const mentioned = new Set((source.mentions ?? []).map((id) => String(id).toLowerCase()));
  if (source.actorRole !== 'studio' && mentioned.size === 0) return [];
  const audience = await roomAudience(sql, source.organizationId, placeOf(source) ?? null);
  const planned: PlannedNotice[] = [];
  for (const person of audience) {
    if (person.userId === actor) continue;
    const kind = messageNoticeKind(source.actorRole, mentioned.has(person.userId));
    if (kind && actorFits(ROOM_NOTICE_RULES[kind], source.actorRole)) planned.push({ recipientId: person.userId, kind, messageId });
  }
  return planned;
}

/**
 * Queue the notices one room write causes. Never throws and never fails the caller: inside the caller's
 * transaction it runs under a savepoint (a failed insert is rolled back alone); outside one, a failure
 * leaves nothing. A repeat for the same line and person is ignored (the table's unique keys). Returns
 * how many rows were queued.
 */
export async function enqueueNotices(sql: SqlRunner, source: RoomNoticeSource, options: EnqueueOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  if (!roomNoticesOpen(env)) return 0;
  let savepoint = false;
  try {
    await sql.query('savepoint brand_room_notice');
    savepoint = true;
  } catch {
    // Not inside a transaction: nothing of the caller's can be poisoned by a failed insert.
  }
  try {
    const planned = await planNotices(sql, source);
    const now = options.now ?? new Date();
    let queued = 0;
    for (const notice of planned) {
      const rule = ROOM_NOTICE_RULES[notice.kind];
      const dueAt = new Date(now.getTime() + (rule.email === 'bundle' ? ROOM_NOTICE_LIMITS.bundleDelayMinutes * MINUTE : 0));
      const { rows } = await sql.query<{ id: string }>(
        `insert into brand_room_notices (organization_id, project_id, recipient_id, kind, message_id, timing, due_at, state, skip_reason, push_state)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict do nothing
         returning id`,
        [
          source.organizationId.toLowerCase(),
          placeOf(source) ?? null,
          notice.recipientId,
          notice.kind,
          notice.messageId,
          rule.email,
          dueAt.toISOString(),
          rule.email === 'none' ? 'skipped' : 'pending',
          rule.email === 'none' ? 'rule' : null,
          rule.push ? 'pending' : 'none',
        ],
      );
      queued += rows.length;
    }
    if (savepoint) await sql.query('release savepoint brand_room_notice');
    if (queued > 0 && options.kick !== false) kickRoomNoticePass(env);
    return queued;
  } catch (error) {
    if (savepoint) await sql.query('rollback to savepoint brand_room_notice').catch(() => undefined);
    console.warn(
      '[brand-rooms] room_notice_enqueue_failed',
      JSON.stringify({ type: String(source?.type ?? '').slice(0, 20), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
    return 0;
  }
}

/**
 * One pass right after the response that queued something, so a push (and a "now" mail) does not wait
 * for the 10-minute tick. Safe anywhere: outside a request scope `after()` throws, and then the tick
 * sends it.
 */
export function kickRoomNoticePass(env: NodeJS.ProcessEnv = process.env): void {
  if (!roomNoticesOpen(env)) return;
  const run = async () => {
    try {
      const { getSqlRunner } = await import('@/lib/db/connect');
      const sql = await getSqlRunner();
      if (sql) await runLiveRoomNoticePass(sql, env);
    } catch (error) {
      console.warn('[brand-rooms] room_notice_kick_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    }
  };
  try {
    after(run);
  } catch {
    // Not inside a request (a script, a test): the cron tick picks the rows up.
  }
}

/* ------------------------------------------------------------------ mail */

export interface RoomNoticeLine {
  kind: RoomNoticeKind;
  /** The draft's or storyboard's title (event lines). */
  title?: string | null;
  version?: number | null;
  /** Who wrote it, as the mail shows them. */
  name?: string | null;
  /** The quoted text, already cut to 120 characters. */
  excerpt?: string | null;
}

export interface RoomNoticeMailInput {
  locale: Locale;
  recipientId: string;
  organizationId: string;
  /** Null: the organization's general channel. */
  projectId: string | null;
  /** The project's title; unused for the general channel. */
  projectTitle: string;
  /** Names the general channel's mail and push (the brand it belongs to). */
  organizationName?: string;
  /** Every item of the batch, oldest first. The mail shows the first five. */
  lines: readonly RoomNoticeLine[];
  env?: NodeJS.ProcessEnv;
}

export interface RoomNoticeMail {
  subject: string;
  html: string;
  text: string;
  buttonUrl: string;
  unsubscribeUrl: string;
}

type NoticeCopy = ReturnType<typeof getDictionary>['roomsNotices'];

/** The first 120 characters of a line, whitespace folded. */
export function noticeExcerpt(body: string | null | undefined, chars: number = ROOM_NOTICE_LIMITS.excerptChars): string {
  const flat = (body ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > chars ? `${flat.slice(0, chars)}…` : flat;
}

/**
 * Where a notice opens, as a same-origin path (push) or after the brand host (mail): the project room, or
 * the messages inbox on the general conversation — the same `?organizationId=&channel=general` form the
 * inbox builds for itself (components/brand-rooms/chat/inbox.tsx `hrefFor`). The organization rides along
 * so a person in several brands lands in the right one (`roomRouteContext` selects by it).
 */
export function roomNoticePath(organizationId: string, projectId: string | null): string {
  const params = new URLSearchParams({ organizationId: organizationId.toLowerCase() });
  if (projectId === null) {
    params.set('channel', 'general');
    return `/brand/rooms?${params.toString()}`;
  }
  return `/brand/rooms/${projectId.toLowerCase()}?${params.toString()}`;
}

function lineText(copy: NoticeCopy, line: RoomNoticeLine, place: string): string {
  const title = line.title?.trim() || place;
  const version = line.version && line.version > 0 ? line.version : 1;
  const name = line.name?.trim() || copy.email.team;
  const excerpt = line.excerpt?.trim() ?? '';
  const lines = copy.email.lines;
  switch (line.kind) {
    case 'new_version':
      return interpolate(lines.newVersion, { title, version });
    case 'storyboard':
      return interpolate(lines.storyboard, { title, version });
    case 'team_message':
      return interpolate(lines.teamMessage, { name, excerpt });
    case 'team_reply':
      return excerpt ? interpolate(lines.teamReply, { name, title, excerpt }) : interpolate(lines.teamReplyBare, { name, title });
    case 'mention':
      return interpolate(lines.mention, { name, excerpt });
    case 'intake_received':
      return interpolate(lines.intake, { project: place });
  }
}

/** What a push shows for a batch: the one line, or the count. */
export function noticePushBody(locale: Locale, lines: readonly RoomNoticeLine[], placeName: string): string {
  const copy = getDictionary(locale).roomsNotices;
  return lines.length === 1 ? lineText(copy, lines[0]!, placeName) : interpolate(copy.push.many, { count: lines.length });
}

/**
 * One mail for one recipient × place (a project, or the general channel): what arrived (at most five
 * lines), one button into the room on the brand host, the unsubscribe link (signed, no login) and the
 * company line. No internal tool names, no prices, no promised times, no invitation to reply.
 */
export function buildRoomNoticeEmail(input: RoomNoticeMailInput): RoomNoticeMail {
  const env = input.env ?? process.env;
  const copy = getDictionary(input.locale).roomsNotices;
  const project = input.projectTitle.replace(/\s+/g, ' ').trim();
  const organization = (input.organizationName ?? '').replace(/\s+/g, ' ').trim();
  const intakeOnly = input.lines.length > 0 && input.lines.every((line) => line.kind === 'intake_received');
  const general = input.projectId === null;
  const subject = general
    ? interpolate(copy.email.subjectGeneral, { organization })
    : interpolate(intakeOnly ? copy.email.subjectIntake : copy.email.subject, { project });
  const title = general ? copy.email.titleGeneral : intakeOnly ? copy.email.titleIntake : interpolate(copy.email.title, { project });
  const shown = input.lines.slice(0, ROOM_NOTICE_LIMITS.maxLines).map((line) => lineText(copy, line, project));
  const rest = input.lines.length - shown.length;
  const paragraphs = rest > 0 ? [...shown, interpolate(copy.email.more, { count: rest })] : shown;
  const buttonUrl = `${brandSiteUrl(env)}${roomNoticePath(input.organizationId, input.projectId)}`;
  const unsubscribeUrl = `${siteUrl(env)}${unsubscribePath({ userId: input.recipientId, toggle: ROOM_EMAIL_SCOPE, organizationId: input.organizationId })}`;
  const args = {
    title,
    paragraphs,
    // The general conversation's button opens the inbox's General, so it names that, not a project.
    button: { label: general ? copy.email.ctaGeneral : copy.email.cta, url: buttonUrl },
    note: { text: general ? copy.email.noteGeneral : copy.email.note, link: { label: copy.email.stop, url: unsubscribeUrl } },
    footer: companyLine(input.locale, { address: true }),
  };
  return { subject, html: sheet(args), text: sheetText(args), buttonUrl, unsubscribeUrl };
}

/* ------------------------------------------------------------------ pass */

export interface RoomNoticePassDeps {
  sql: SqlRunner;
  /** Null when no mail provider is configured: due mails are skipped (`no_mailer`), never thrown. */
  mailer: Mailer | null;
  /** Null when push is not configured here: claimed pushes stay `skipped`. */
  push?: PushSender | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface RoomNoticePassReport {
  ran: boolean;
  /** Mails the provider accepted. */
  mails: number;
  /** Rows those mails carried. */
  sent: number;
  skipped: number;
  /** Bundled rows held back by the 30-minute cap. */
  deferred: number;
  /** Rows going back to pending after a failed send. */
  retrying: number;
  failed: number;
  /** Recipient × project pushes that reached at least one device. */
  pushes: number;
}

type SkipReason = 'read' | 'muted' | 'no_mailer' | 'no_access' | 'no_email' | 'deleted';

interface NoticeRow {
  id: string;
  organization_id: string;
  /** Null: the organization's general channel. */
  project_id: string | null;
  recipient_id: string;
  kind: RoomNoticeKind;
  message_id: string | null;
  timing: 'now' | 'bundle' | 'none';
  batch_id: string | null;
  created_at: Date | string;
}

interface MessageFacts {
  id: string;
  channel: string;
  body: string;
  files: number;
  detail: Record<string, unknown> | null;
  deleted: boolean;
  createdAt: Date;
  /** The author's side: a text line's own role, an event line's `detail.actorRole`. */
  role: 'brand' | 'studio';
  displayName: string | null;
  email: string | null;
  replyBody: string | null;
}

interface RecipientFacts {
  email: string | null;
  locale: Locale;
}

interface Facts {
  messages: Map<string, MessageFacts>;
  recipients: Map<string, RecipientFacts>;
  projects: Map<string, string>;
  organizations: Map<string, string>;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(String(v)));
const GENERAL = 'general';
/** A row's channel, as `brand_room_reads` names it: its project id, or 'general'. */
const channelOf = (projectId: string | null): string => (projectId ? projectId.toLowerCase() : GENERAL);
/** Recipient × place. 'general' exists once per organization, so the organization is part of the place. */
const placeKey = (recipientId: string, organizationId: string, channel: string): string =>
  `${recipientId.toLowerCase()}:${organizationId.toLowerCase()}:${channel}`;
const UUID_TEXT = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const NOTICE_SELECT = `select id::text as id, organization_id::text as organization_id, project_id::text as project_id,
       recipient_id::text as recipient_id, kind, message_id::text as message_id, timing, batch_id::text as batch_id, created_at
  from brand_room_notices`;

async function loadFacts(sql: SqlRunner, rows: readonly NoticeRow[]): Promise<Facts> {
  const messageIds = [...new Set(rows.map((r) => r.message_id).filter((id): id is string => Boolean(id)))];
  const recipientIds = [...new Set(rows.map((r) => r.recipient_id))];
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((id): id is string => Boolean(id)))];
  const organizationIds = [...new Set(rows.map((r) => r.organization_id))];
  const messages = new Map<string, MessageFacts>();
  if (messageIds.length) {
    const found = (
      await sql.query<{
        id: string;
        channel: string;
        kind: string;
        body: string | null;
        attachments: unknown;
        detail: Record<string, unknown> | null;
        deleted_at: Date | string | null;
        created_at: Date | string;
        author_role: string;
        display_name: string | null;
        email: string | null;
        reply_body: string | null;
      }>(
        // A team reply's text comes from the draft note itself; a note the team keeps to itself never does.
        // The note id is compared as a uuid (the primary key's index), and only after the text is checked
        // to be one: a malformed `ref` yields no text instead of a failed cast.
        `select m.id::text as id, m.channel, m.kind, m.body, m.attachments, m.detail, m.deleted_at, m.created_at, m.author_role,
                p.display_name, p.email,
                (select c.body from brand_studio_review_comments c
                  where m.event = 'review_commented'
                    and c.id = case when (m.ref ->> 'commentId') ~ $2 then (m.ref ->> 'commentId')::uuid end
                    and c.deleted_at is null
                    and coalesce(to_jsonb(c) ->> 'visibility', 'public') = 'public') as reply_body
           from brand_room_messages m left join profiles p on p.id = m.author_id
          where m.id = any($1::uuid[])`,
        [messageIds, UUID_TEXT],
      )
    ).rows;
    for (const m of found) {
      const actorRole = m.detail && (m.detail as { actorRole?: unknown }).actorRole;
      const role: 'brand' | 'studio' = m.kind === 'event' ? (actorRole === 'studio' ? 'studio' : 'brand') : m.author_role === 'studio' ? 'studio' : 'brand';
      messages.set(String(m.id).toLowerCase(), {
        id: String(m.id).toLowerCase(),
        channel: String(m.channel),
        body: m.body ?? '',
        files: Array.isArray(m.attachments) ? m.attachments.length : 0,
        detail: m.detail,
        deleted: m.deleted_at != null,
        createdAt: toDate(m.created_at),
        role,
        displayName: m.display_name,
        email: m.email,
        replyBody: m.reply_body,
      });
    }
  }
  const recipients = new Map<string, RecipientFacts>();
  for (const p of (
    await sql.query<{ id: string; email: string | null; locale: string | null }>('select id::text as id, email, locale from profiles where id = any($1::uuid[])', [recipientIds])
  ).rows) {
    recipients.set(String(p.id).toLowerCase(), { email: p.email?.trim() || null, locale: isLocale(p.locale) ? p.locale : DEFAULT_LOCALE });
  }
  const projects = new Map<string, string>();
  if (projectIds.length) {
    for (const p of (await sql.query<{ id: string; title: string }>('select id::text as id, title from brand_projects where id = any($1::uuid[])', [projectIds])).rows) {
      projects.set(String(p.id).toLowerCase(), String(p.title));
    }
  }
  const organizations = new Map<string, string>();
  for (const o of (await sql.query<{ id: string; name: string }>('select id::text as id, name from brand_organizations where id = any($1::uuid[])', [organizationIds])).rows) {
    organizations.set(String(o.id).toLowerCase(), String(o.name));
  }
  return { messages, recipients, projects, organizations };
}

/** What names a place: the project's title, or the brand's name for its general channel. */
function placeTitle(facts: Facts, organizationId: string, projectId: string | null): string {
  return projectId ? (facts.projects.get(projectId.toLowerCase()) ?? '') : (facts.organizations.get(organizationId.toLowerCase()) ?? '');
}

/** The author as a mail names them: "YAGI team · name" (or just "YAGI team"), a brand member by name. */
function authorName(copy: NoticeCopy, message: MessageFacts): string {
  const name = message.displayName?.replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  if (message.role === 'studio') return name ? interpolate(copy.email.teamAuthor, { name }) : copy.email.team;
  return name ?? message.email?.split('@')[0]?.trim().slice(0, 60) ?? copy.email.team;
}

function lineOf(row: NoticeRow, facts: Facts, locale: Locale): RoomNoticeLine {
  const copy = getDictionary(locale).roomsNotices;
  const message = row.message_id ? facts.messages.get(row.message_id.toLowerCase()) : undefined;
  if (!message) return { kind: row.kind };
  const detail = message.detail ?? {};
  const title = typeof detail.title === 'string' ? detail.title : null;
  const version = typeof detail.version === 'number' ? detail.version : null;
  const name = authorName(copy, message);
  if (row.kind === 'team_reply') return { kind: row.kind, title, version, name, excerpt: noticeExcerpt(message.replyBody) };
  if (row.kind === 'team_message' || row.kind === 'mention') {
    const excerpt = noticeExcerpt(message.body) || (message.files > 0 ? interpolate(copy.email.files, { count: message.files }) : '');
    return { kind: row.kind, name, excerpt };
  }
  return { kind: row.kind, title, version, name };
}

/** Per pass: who may still open which room (an organization closed or a member removed since the line). */
function audienceCache(sql: SqlRunner) {
  const cache = new Map<string, Promise<Set<string>>>();
  return (organizationId: string, projectId: string | null, userId: string): Promise<boolean> => {
    const key = `${organizationId.toLowerCase()}:${channelOf(projectId)}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = roomAudience(sql, organizationId, projectId).then((people) => new Set(people.map((p) => p.userId)));
      cache.set(key, entry);
    }
    return entry.then((people) => people.has(userId.toLowerCase()));
  };
}

const emptyReport = (): RoomNoticePassReport => ({ ran: false, mails: 0, sent: 0, skipped: 0, deferred: 0, retrying: 0, failed: 0, pushes: 0 });

/**
 * One pass: give back leases that ran out, push what has not been pushed, mail what is due. Returns at
 * once when notices are off. Every send is outside a transaction; the claims are `for update skip locked`,
 * so two passes at once take disjoint rows.
 */
export async function runRoomNoticePass(deps: RoomNoticePassDeps, options: { limit?: number } = {}): Promise<RoomNoticePassReport> {
  const report = emptyReport();
  const env = deps.env ?? process.env;
  if (!roomNoticesOpen(env)) return report;
  report.ran = true;
  const now = deps.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? ROOM_NOTICE_LIMITS.passRows, 1000));
  await deps.sql.query(
    `update brand_room_notices
        set state = case when attempts >= $2 then 'failed' else 'pending' end, lease_until = null
      where state = 'sending' and lease_until < $1`,
    [now.toISOString(), ROOM_NOTICE_LIMITS.maxAttempts],
  );
  await pushPhase(deps, now, limit, report);
  await mailPhase(deps, now, limit, report, env);
  return report;
}

async function pushPhase(deps: RoomNoticePassDeps, now: Date, limit: number, report: RoomNoticePassReport): Promise<void> {
  const rows = await deps.sql.transaction(async (tx) => {
    const picked = (await tx.query<NoticeRow>(`${NOTICE_SELECT} where push_state = 'pending' order by created_at, id limit $1 for update skip locked`, [limit])).rows;
    // At most once: marked before anything is sent, corrected after.
    if (picked.length) {
      await tx.query("update brand_room_notices set push_state = 'skipped', pushed_at = $2 where id = any($1::uuid[])", [picked.map((r) => r.id), now.toISOString()]);
    }
    return picked;
  });
  if (rows.length === 0 || !deps.push) return;
  const facts = await loadFacts(deps.sql, rows);
  const seated = audienceCache(deps.sql);
  const groups = new Map<string, NoticeRow[]>();
  for (const row of rows) {
    const message = row.message_id ? facts.messages.get(row.message_id.toLowerCase()) : undefined;
    if (row.message_id && (!message || message.deleted)) continue;
    const key = placeKey(row.recipient_id, row.organization_id, channelOf(row.project_id));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    try {
      if (!(await seated(first.organization_id, first.project_id, first.recipient_id))) continue;
      const locale = facts.recipients.get(first.recipient_id.toLowerCase())?.locale ?? DEFAULT_LOCALE;
      const organizationId = first.organization_id.toLowerCase();
      const projectId = first.project_id ? first.project_id.toLowerCase() : null;
      const name = placeTitle(facts, organizationId, projectId);
      const lines = group.map((row) => lineOf(row, facts, locale));
      // One notification per place (the project, or the brand's general channel): a newer one replaces it.
      const tag = projectId ?? organizationId;
      const message: PushMessage = {
        title: projectId ? name : interpolate(getDictionary(locale).roomsNotices.push.generalTitle, { organization: name }),
        body: noticePushBody(locale, lines, name),
        url: roomNoticePath(organizationId, projectId),
        tag,
        topic: tag.replace(/-/g, ''),
        lang: locale,
      };
      const fanout = await sendPushToUser({ sql: deps.sql, sender: deps.push, now }, first.recipient_id, message);
      const state = fanout.sent > 0 ? 'sent' : fanout.failed > 0 ? 'failed' : null;
      if (state) await deps.sql.query('update brand_room_notices set push_state = $2 where id = any($1::uuid[])', [group.map((r) => r.id), state]);
      if (fanout.sent > 0) report.pushes += 1;
    } catch (error) {
      console.warn('[brand-rooms] room_notice_push_failed', JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    }
  }
}

interface Batch {
  batchId: string;
  rows: NoticeRow[];
  recipientId: string;
  organizationId: string;
  /** Null: the organization's general channel. */
  projectId: string | null;
}

async function mailPhase(deps: RoomNoticePassDeps, now: Date, limit: number, report: RoomNoticePassReport, env: NodeJS.ProcessEnv): Promise<void> {
  const claimed = await deps.sql.transaction(async (tx) => {
    const rows = (
      await tx.query<NoticeRow>(`${NOTICE_SELECT} where state = 'pending' and due_at <= $1 order by created_at, id limit $2 for update skip locked`, [now.toISOString(), limit])
    ).rows;
    if (rows.length === 0) return { batches: [] as Batch[], facts: null };
    const skips = new Map<SkipReason, string[]>();
    const skip = (reason: SkipReason, ids: string[]) => skips.set(reason, [...(skips.get(reason) ?? []), ...ids]);
    if (!deps.mailer) {
      skip('no_mailer', rows.map((r) => r.id));
      await applySkips(tx, skips, report);
      return { batches: [] as Batch[], facts: null };
    }
    const facts = await loadFacts(tx, rows);
    const recipientIds = [...new Set(rows.map((r) => r.recipient_id))];
    const muted = new Set(
      (
        await tx.query<{ user_id: string; organization_id: string }>(
          'select user_id::text as user_id, organization_id::text as organization_id from brand_room_notice_prefs where user_id = any($1::uuid[]) and not email_enabled',
          [recipientIds],
        )
      ).rows.map((r) => `${String(r.user_id).toLowerCase()}:${String(r.organization_id).toLowerCase()}`),
    );
    const organizationIds = [...new Set(rows.map((r) => r.organization_id.toLowerCase()))];
    const reads = new Map<string, Date>();
    for (const r of (
      await tx.query<{ user_id: string; organization_id: string; channel: string; last_read_at: Date | string }>(
        `select user_id::text as user_id, organization_id::text as organization_id, channel, last_read_at
           from brand_room_reads where user_id = any($1::uuid[]) and organization_id = any($2::uuid[]) and channel = any($3::text[])`,
        [recipientIds, organizationIds, [...new Set(rows.map((r) => channelOf(r.project_id)))]],
      )
    ).rows) {
      reads.set(placeKey(String(r.user_id), String(r.organization_id), String(r.channel)), toDate(r.last_read_at));
    }
    // Only bundles sent inside the cap window can hold anything back.
    const capFrom = new Date(now.getTime() - ROOM_NOTICE_LIMITS.bundleCapMinutes * MINUTE).toISOString();
    const lastBundle = new Map<string, Date>();
    for (const r of (
      await tx.query<{ recipient_id: string; organization_id: string; project_id: string | null; last: Date | string }>(
        `select recipient_id::text as recipient_id, organization_id::text as organization_id, project_id::text as project_id, max(sent_at) as last
           from brand_room_notices
          where state = 'sent' and timing = 'bundle' and recipient_id = any($1::uuid[]) and sent_at > $2
          group by recipient_id, organization_id, project_id`,
        [recipientIds, capFrom],
      )
    ).rows) {
      if (r.last) lastBundle.set(placeKey(String(r.recipient_id), String(r.organization_id), channelOf(r.project_id)), toDate(r.last));
    }
    const seated = audienceCache(tx);
    // A retried batch keeps its id (the provider's idempotency key); new rows group by recipient × place.
    const groups = new Map<string, NoticeRow[]>();
    for (const row of rows) {
      const key = row.batch_id ? `b:${row.batch_id}` : `g:${placeKey(row.recipient_id, row.organization_id, channelOf(row.project_id))}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const batches: Batch[] = [];
    const deferred = new Map<string, string[]>();
    for (const group of groups.values()) {
      const first = group[0]!;
      const recipientId = first.recipient_id.toLowerCase();
      const projectId = first.project_id ? first.project_id.toLowerCase() : null;
      const organizationId = first.organization_id.toLowerCase();
      const place = placeKey(recipientId, organizationId, channelOf(projectId));
      const retry = first.batch_id !== null;
      if (!(await seated(organizationId, projectId, recipientId))) {
        skip('no_access', group.map((r) => r.id));
        continue;
      }
      if (!facts.recipients.get(recipientId)?.email) {
        skip('no_email', group.map((r) => r.id));
        continue;
      }
      if (muted.has(`${recipientId}:${organizationId}`)) {
        skip('muted', group.map((r) => r.id));
        continue;
      }
      const readAt = reads.get(place);
      const remaining: NoticeRow[] = [];
      for (const row of group) {
        const message = row.message_id ? facts.messages.get(row.message_id.toLowerCase()) : undefined;
        if (row.message_id && (!message || message.deleted)) skip('deleted', [row.id]);
        else if (!retry && row.timing === 'bundle' && message && readAt && readAt >= message.createdAt) skip('read', [row.id]);
        else remaining.push(row);
      }
      if (remaining.length === 0) continue;
      if (!retry && remaining.every((row) => row.timing === 'bundle')) {
        const last = lastBundle.get(place);
        const open = last ? new Date(last.getTime() + ROOM_NOTICE_LIMITS.bundleCapMinutes * MINUTE) : null;
        if (open && open > now) {
          deferred.set(open.toISOString(), [...(deferred.get(open.toISOString()) ?? []), ...remaining.map((r) => r.id)]);
          continue;
        }
      }
      batches.push({ batchId: first.batch_id ?? randomUUID(), rows: remaining, recipientId, organizationId, projectId });
    }
    await applySkips(tx, skips, report);
    for (const [dueAt, ids] of deferred) {
      await tx.query('update brand_room_notices set due_at = $2 where id = any($1::uuid[])', [ids, dueAt]);
      report.deferred += ids.length;
    }
    const leaseUntil = new Date(now.getTime() + ROOM_NOTICE_LIMITS.leaseMinutes * MINUTE).toISOString();
    for (const batch of batches) {
      await tx.query("update brand_room_notices set state = 'sending', batch_id = $2, attempts = attempts + 1, lease_until = $3 where id = any($1::uuid[])", [
        batch.rows.map((r) => r.id),
        batch.batchId,
        leaseUntil,
      ]);
    }
    return { batches, facts };
  });
  if (!claimed.facts || !deps.mailer) return;
  for (const batch of claimed.batches) {
    const recipient = claimed.facts.recipients.get(batch.recipientId)!;
    const mail = buildRoomNoticeEmail({
      locale: recipient.locale,
      recipientId: batch.recipientId,
      organizationId: batch.organizationId,
      projectId: batch.projectId,
      projectTitle: batch.projectId ? placeTitle(claimed.facts, batch.organizationId, batch.projectId) : '',
      organizationName: placeTitle(claimed.facts, batch.organizationId, null),
      lines: [...batch.rows].sort((a, b) => toDate(a.created_at).getTime() - toDate(b.created_at).getTime()).map((row) => lineOf(row, claimed.facts!, recipient.locale)),
      env,
    });
    let outcome: SendOutcome;
    try {
      outcome = await deps.mailer.send({ to: recipient.email!, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: batch.batchId, unsubscribeUrl: mail.unsubscribeUrl });
    } catch (error) {
      outcome = { ok: false, retryable: true, error: error instanceof Error ? error.message : 'send threw' };
    }
    if (outcome.ok) {
      const { rows } = await deps.sql.query<{ id: string }>(
        "update brand_room_notices set state = 'sent', sent_at = $2, lease_until = null where batch_id = $1 and state = 'sending' returning id",
        [batch.batchId, now.toISOString()],
      );
      report.mails += 1;
      report.sent += rows.length;
      continue;
    }
    const { rows } = await deps.sql.query<{ state: string }>(
      `update brand_room_notices
          set state = case when $2::boolean and attempts < $3 then 'pending' else 'failed' end, lease_until = null, due_at = $4
        where batch_id = $1 and state = 'sending'
        returning state`,
      [batch.batchId, outcome.retryable, ROOM_NOTICE_LIMITS.maxAttempts, now.toISOString()],
    );
    for (const row of rows) {
      if (row.state === 'failed') report.failed += 1;
      else report.retrying += 1;
    }
    // Never the address: an error from the provider can quote it.
    console.warn('[brand-rooms] room_notice_mail_failed', JSON.stringify({ batch: batch.batchId, retryable: outcome.retryable }));
  }
}

async function applySkips(sql: SqlRunner, skips: Map<SkipReason, string[]>, report: RoomNoticePassReport): Promise<void> {
  for (const [reason, ids] of skips) {
    if (ids.length === 0) continue;
    await sql.query("update brand_room_notices set state = 'skipped', skip_reason = $2, lease_until = null where id = any($1::uuid[])", [ids, reason]);
    report.skipped += ids.length;
  }
}

/** The live pass: the configured mailer (live or fake) and push when the VAPID keys are set. */
export async function runLiveRoomNoticePass(sql: SqlRunner, env: NodeJS.ProcessEnv = process.env): Promise<RoomNoticePassReport> {
  const config = pushConfigFromEnv(env);
  return runRoomNoticePass({ sql, mailer: getMailer(), push: config ? createWebPushSender(config) : null, env });
}
