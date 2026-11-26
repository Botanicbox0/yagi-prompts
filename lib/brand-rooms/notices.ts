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
 *          first, then corrected to `sent` / `failed`. One push per "now" notice; the team's lines of
 *          one recipient × place in one pass are one push that counts them.
 *   mail   one mail is one kind (§10.1). A `now` row (new draft, storyboard, mention, receipt) is a mail
 *          of its own; `bundle` rows (the team's lines and draft replies) wait 10 minutes, are dropped
 *          when the person has read that channel since (`read`), and go out as one mail per recipient ×
 *          place at most every 30 minutes. A muted person (`brand_room_notice_prefs`) is skipped. The
 *          provider's idempotency key is the batch id, kept across the 3 attempts.
 *
 * Off unless `BRAND_ROOM_NOTIFY=on` and rooms are open (`BRAND_ROOMS=on`). The rules (§2.1), the
 * intervals (§8-3) and every string (messages/rooms-notices.ts) are the founder's, confirmed 2026-11-18
 * (§10). Nothing is sent with the flag off.
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
import { sheet, sheetText, type SheetArgs } from '@/lib/notify/sheet';
import { ROOM_EMAIL_SCOPE, unsubscribePath } from '@/lib/notify/unsubscribe';
import { brandSiteUrl, siteUrl } from '@/lib/seo/site-url';
import { roomAudience } from './access';
import { TEAM_PROJECTS } from '@/lib/brands/project-origin';
import type { RoomEventKind } from './events';
import { brandSendOpenFor, MEMBERS_LINE, membersAudience, shownProjectTitles } from './members-channel';
import { isMembersChannel, membersChannelOf, sendThreadHref } from './send-contracts';

/* ------------------------------------------------------------------ rules (§2.1) */

export const ROOM_NOTICE_KINDS = ['new_version', 'storyboard', 'team_message', 'team_reply', 'mention', 'intake_received', 'member_reply'] as const;
export type RoomNoticeKind = (typeof ROOM_NOTICE_KINDS)[number];

export interface RoomNoticeRule {
  /** `now`: the next pass mails it. `bundle`: 10 minutes later, if still unread. `none`: no mail. */
  email: 'now' | 'bundle' | 'none';
  push: boolean;
  /** Whose action it has to be. Anything else queues nothing. */
  actor: 'studio' | 'brand' | 'any';
}

/** §2.1 as data. Confirmed by the founder with the wording (§10, 2026-11-18). */
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
  /**
   * A new reply in a members thread (보내기, docs/BRAND-PROJECT-SPINE.md §8.4), to the thread's other participants who
   * are not named in it. In-app only: no existing mail or push sentence is true for it (each says the YAGI team wrote),
   * so it is queued already skipped (`rule`) and never pushed, until the founder approves words of its own.
   */
  member_reply: { email: 'none', push: false, actor: 'brand' },
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
  /** Quote lines in one bundled mail (§10.1). There is no "and N more" line; `{count}` says how many. */
  maxLines: 5,
  /** How much of a line a mail quotes. */
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
  | { type: 'intake'; organizationId: string; projectId: string; actorId: string }
  | {
      /**
       * A line on a members channel (보내기, ./send.ts): its root (`reply: false`) or a reply. Only the organization's
       * active members hear about it (./members-channel.ts `membersAudience`), never a guest and never the team.
       */
      type: 'member';
      organizationId: string;
      /** The file's project, or null for an unfiled file (channel `members`). */
      projectId: string | null;
      /** `members:<projectId>` or `members`. */
      channel: string;
      messageId: string;
      rootId: string;
      actorId: string;
      mentions: readonly string[];
      reply: boolean;
    };

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
  /** A members-channel notice's own timing (the rule's otherwise). */
  timing?: RoomNoticeRule['email'];
  push?: boolean;
}

/** The place a notice is about: a project id, or null for the organization's general channel (or an unfiled file's members channel). */
function placeOf(source: RoomNoticeSource): string | null | undefined {
  if ((source.type === 'message' || source.type === 'member') && source.projectId === null) return null;
  return source.projectId && UUID.test(source.projectId) ? source.projectId.toLowerCase() : undefined;
}

/**
 * A members-channel line (docs/BRAND-PROJECT-SPINE.md §8.4). Only the organization's active members are ever planned.
 *  - Everyone the line names (but the writer) gets `mention`. In a project's members channel that is today's mention
 *    mail and push, whose words are all true there ("[project] … called you in the project conversation"); for an
 *    unfiled file there is no project to name and no sentence that fits, so the row is in-app only (skipped `rule`,
 *    no push).
 *  - A reply: every other participant of the thread (the root's writer, everyone named in it, everyone who replied)
 *    gets `member_reply`, in-app only, except the writer and those who got `mention` for this very line.
 *  - Everyone else: nothing. Staff who are not members, guests and other organizations are never in the audience.
 */
async function planMemberNotices(sql: SqlRunner, source: Extract<RoomNoticeSource, { type: 'member' }>): Promise<PlannedNotice[]> {
  if (!UUID.test(source.messageId ?? '') || !UUID.test(source.rootId ?? '') || !isMembersChannel(source.channel)) return [];
  if (source.channel !== membersChannelOf(source.projectId)) return [];
  const actor = UUID.test(source.actorId ?? '') ? source.actorId.toLowerCase() : null;
  const audience = new Set(await membersAudience(sql, source.organizationId));
  const messageId = source.messageId.toLowerCase();
  const mentioned = new Set((source.mentions ?? []).map((id) => String(id).toLowerCase()).filter((id) => audience.has(id) && id !== actor));
  const filed = source.projectId !== null;
  const planned: PlannedNotice[] = [...mentioned].map((recipientId) => ({
    recipientId,
    kind: 'mention' as const,
    messageId,
    timing: filed ? ROOM_NOTICE_RULES.mention.email : ('none' as const),
    push: filed && ROOM_NOTICE_RULES.mention.push,
  }));
  if (!source.reply) return planned;
  const participants = (
    await sql.query<{ user_id: string }>(
      `select distinct u.user_id::text as user_id from (
         select x.author_id as user_id from brand_room_messages x
          where x.organization_id = $1 and (x.id = $2 or x.parent_id = $2) and x.deleted_at is null and ${MEMBERS_LINE('x')}
         union all
         select unnest(x.mentions) from brand_room_messages x
          where x.organization_id = $1 and (x.id = $2 or x.parent_id = $2) and x.deleted_at is null and ${MEMBERS_LINE('x')}
       ) u where u.user_id is not null`,
      [source.organizationId, source.rootId],
    )
  ).rows.map((row) => String(row.user_id).toLowerCase());
  for (const recipientId of new Set(participants)) {
    if (recipientId === actor || mentioned.has(recipientId) || !audience.has(recipientId)) continue;
    planned.push({ recipientId, kind: 'member_reply', messageId, timing: ROOM_NOTICE_RULES.member_reply.email, push: ROOM_NOTICE_RULES.member_reply.push });
  }
  return planned;
}

async function planNotices(sql: SqlRunner, source: RoomNoticeSource): Promise<PlannedNotice[]> {
  // `undefined` = no valid place. Only a chat line can be in the general channel (null).
  if (!source || !UUID.test(source.organizationId ?? '') || placeOf(source) === undefined) return [];
  if (source.type === 'member') return planMemberNotices(sql, source);
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
    let outbound = 0;
    for (const notice of planned) {
      const rule = ROOM_NOTICE_RULES[notice.kind];
      const timing = notice.timing ?? rule.email;
      const push = notice.push ?? rule.push;
      const dueAt = new Date(now.getTime() + (timing === 'bundle' ? ROOM_NOTICE_LIMITS.bundleDelayMinutes * MINUTE : 0));
      const values = [
        source.organizationId.toLowerCase(),
        placeOf(source) ?? null,
        notice.recipientId,
        notice.kind,
        notice.messageId,
        timing,
        dueAt.toISOString(),
        timing === 'none' ? 'skipped' : 'pending',
        timing === 'none' ? 'rule' : null,
        push ? 'pending' : 'none',
      ];
      // A team-channel notice keeps exactly the statement it always had (it also runs before migration 0200); a
      // members-channel notice carries its channel (0200's column), so the pass never reads it as a team channel's.
      const { rows } =
        source.type === 'member'
          ? await sql.query<{ id: string }>(
              `insert into brand_room_notices (organization_id, project_id, recipient_id, kind, message_id, timing, due_at, state, skip_reason, push_state, channel)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               on conflict do nothing
               returning id`,
              [...values, source.channel],
            )
          : await sql.query<{ id: string }>(
              `insert into brand_room_notices (organization_id, project_id, recipient_id, kind, message_id, timing, due_at, state, skip_reason, push_state)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               on conflict do nothing
               returning id`,
              values,
            );
      queued += rows.length;
      if (rows.length && (timing !== 'none' || push)) outbound += 1;
    }
    if (savepoint) await sql.query('release savepoint brand_room_notice');
    if (outbound > 0 && options.kick !== false) kickRoomNoticePass(env);
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

/* ------------------------------------------------------------------ mail and push (§10) */

export interface RoomNoticeLine {
  kind: RoomNoticeKind;
  /** The draft's or storyboard's title (event lines). Missing: the place's name. */
  title?: string | null;
  /** Missing: 1. */
  version?: number | null;
  /** Who wrote it, labelled as §10.1 says for a quote line ("야기 팀 · 이름", "야기 팀", or a brand member's name). */
  name?: string | null;
  /**
   * The same person by plain name, for a mention's `{name}`: their display name (a team member's too); a
   * brand member without one as the conversation shows them; a team member without one as "야기 팀".
   * Missing: `name`.
   */
  person?: string | null;
  /** The quoted text, already cut to 120 characters. Empty: a line with no text (only files). */
  excerpt?: string | null;
}

export interface RoomNoticeMailInput {
  locale: Locale;
  recipientId: string;
  organizationId: string;
  /** Null: the organization's general channel. */
  projectId: string | null;
  /** The project's title; unused for the general channel (it is named `roomsChat.inbox.general`). */
  projectTitle: string;
  /** One "now" notice, or every row of one bundled mail, oldest first. */
  lines: readonly RoomNoticeLine[];
  env?: NodeJS.ProcessEnv;
  /**
   * Where the button opens, as a same-origin path, when it is not the room (`roomNoticePath`): a members thread opens
   * the 알림함 on that thread (`sendThreadHref`), never `/brand/rooms*`.
   */
  href?: string;
}

export interface RoomNoticeMail {
  subject: string;
  html: string;
  text: string;
  buttonUrl: string;
  unsubscribeUrl: string;
}

type Dict = ReturnType<typeof getDictionary>;

/** The two kinds one bundled mail (and one counted push) carries. Every other kind is one notice, one mail. */
const BUNDLED: ReadonlySet<RoomNoticeKind> = new Set<RoomNoticeKind>(['team_message', 'team_reply']);

/** What a mail or push is about: the bundle (`replies`), or the one "now" notice it carries. `member_reply` has no mail. */
export type RoomNoticeMailKind = 'replies' | 'new_version' | 'storyboard' | 'mention' | 'intake_received';

/** Kinds that never become a mail or a push (in-app only); the pass skips them before anything is built. */
const IN_APP_ONLY: ReadonlySet<RoomNoticeKind> = new Set<RoomNoticeKind>(['member_reply']);

const KIND_COPY = {
  replies: 'replies',
  new_version: 'newVersion',
  storyboard: 'storyboard',
  mention: 'mention',
  intake_received: 'intakeReceived',
} as const satisfies Record<RoomNoticeMailKind, keyof Dict['roomsNotices']['kinds']>;

export function roomNoticeMailKind(lines: readonly RoomNoticeLine[]): RoomNoticeMailKind {
  const single = lines.find((line) => !BUNDLED.has(line.kind) && !IN_APP_ONLY.has(line.kind));
  return single ? (single.kind as Exclude<RoomNoticeKind, 'team_message' | 'team_reply' | 'member_reply'>) : 'replies';
}

const flat = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

/** `{project}`: the project's title, or the general conversation's own name (§10.1). */
function placeName(dict: Dict, projectId: string | null, projectTitle: string): string {
  return projectId === null ? dict.roomsChat.inbox.general : flat(projectTitle);
}

/** The type word at the end of a storyboard's title, in either language, with what joined it to the rest. */
const STORYBOARD_WORD_AT_END = /(?:스토리보드|(?<![\p{L}\p{N}])storyboard)$/iu;
const TRAILING_SEPARATOR = /[\s\-–—·•:|/,_]+$/u;

/**
 * A storyboard's title without one trailing "스토리보드" / "storyboard" (any case), for the storyboard
 * notice strings, which already name the kind ("{title} 스토리보드를 확인해 보세요.", "Your storyboard
 * for {title} is ready."): "가을 캠페인 스토리보드" would otherwise read "가을 캠페인 스토리보드
 * 스토리보드를 …". The separator left dangling ("가을 캠페인 - 스토리보드") goes with it. The word
 * anywhere else in the title stays. A title that is only the word is kept as it is.
 */
export function storyboardNoticeTitle(title: string): string {
  const whole = flat(title);
  const match = STORYBOARD_WORD_AT_END.exec(whole);
  if (!match) return whole;
  const rest = whole.slice(0, match.index).replace(TRAILING_SEPARATOR, '');
  return rest === '' ? whole : rest;
}

/** Every placeholder a kind's strings use, with the fallbacks an event line without them gets. */
function noticeVars(dict: Dict, kind: RoomNoticeMailKind, lines: readonly RoomNoticeLine[], project: string): Record<string, string | number> {
  const line = kind === 'replies' ? undefined : lines.find((l) => l.kind === kind);
  const title = flat(line?.title) || project;
  return {
    project,
    title: kind === 'storyboard' ? storyboardNoticeTitle(title) : title,
    version: line?.version && line.version > 0 ? line.version : 1,
    name: flat(line?.person) || flat(line?.name) || dict.roomsChat.author.someone,
    count: kind === 'replies' ? lines.length : 1,
  };
}

/**
 * The strings of one kind. The bundle's count-bearing English sentences have a singular form used only
 * when exactly one row is carried (docs §10.3); Korean has one form and its `one` repeats it.
 */
interface KindStrings {
  subject: string;
  heading: string;
  body: string;
  button: string;
  /** Absent for the receipt, which has no push. */
  pushTitle?: string;
  pushBody?: string;
}

function kindStrings(dict: Dict, kind: RoomNoticeMailKind, count: number): KindStrings {
  const kinds = dict.roomsNotices.kinds;
  if (kind === 'replies') {
    const { one, ...plural } = kinds.replies;
    return count === 1 ? { ...plural, ...one } : plural;
  }
  return kinds[KIND_COPY[kind]];
}

/**
 * The quote lines under the body (§10.1): "author: first 120 characters". The bundle quotes up to five
 * of its rows, oldest first, skipping rows with no text (a file-only message, a reply whose note is not
 * readable); the mention quotes its one line. Other kinds quote nothing.
 */
function quoteRows(dict: Dict, kind: RoomNoticeMailKind, lines: readonly RoomNoticeLine[]): Array<[string, string]> {
  if (kind !== 'replies' && kind !== 'mention') return [];
  const source = kind === 'replies' ? lines : lines.filter((l) => l.kind === 'mention').slice(0, 1);
  return source
    .filter((line) => flat(line.excerpt) !== '')
    .slice(0, ROOM_NOTICE_LIMITS.maxLines)
    .map((line) => [flat(line.name) || dict.roomsChat.author.someone, flat(line.excerpt)]);
}

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

/**
 * One mail of one kind (§10.1): the subject, the heading and the body of that kind, the quote lines
 * under it (the bundle and the mention only), one button into the room on the brand host (the general
 * conversation's opens the inbox on it), the confirmed footer sentence with the unsubscribe link (signed,
 * no login) and the company line. Every sentence is the founder's (messages/rooms-notices.ts); nothing
 * else is written here.
 */
export function buildRoomNoticeEmail(input: RoomNoticeMailInput): RoomNoticeMail {
  const env = input.env ?? process.env;
  const dict = getDictionary(input.locale);
  const copy = dict.roomsNotices;
  const kind = roomNoticeMailKind(input.lines);
  const vars = noticeVars(dict, kind, input.lines, placeName(dict, input.projectId, input.projectTitle));
  const strings = kindStrings(dict, kind, Number(vars.count));
  const buttonUrl = `${brandSiteUrl(env)}${input.href ?? roomNoticePath(input.organizationId, input.projectId)}`;
  const unsubscribeUrl = `${siteUrl(env)}${unsubscribePath({ userId: input.recipientId, toggle: ROOM_EMAIL_SCOPE, organizationId: input.organizationId })}`;
  const args: SheetArgs = {
    title: interpolate(strings.heading, vars),
    paragraphs: [interpolate(strings.body, vars)],
    rows: quoteRows(dict, kind, input.lines),
    button: { label: strings.button, url: buttonUrl },
    note: { text: copy.footer.text, link: { label: copy.footer.stop, url: unsubscribeUrl } },
    footer: companyLine(input.locale, { address: true }),
  };
  return { subject: interpolate(strings.subject, vars), html: sheet(args), text: sheetText(args), buttonUrl, unsubscribeUrl };
}

export interface RoomNoticePushInput {
  locale: Locale;
  organizationId: string;
  /** Null: the organization's general channel. */
  projectId: string | null;
  projectTitle: string;
  /** One "now" notice, or the team's lines of one recipient × place pushed together in one pass. */
  lines: readonly RoomNoticeLine[];
  /** A members thread: where the push opens (`sendThreadHref`) and its tag (the thread), instead of the room's. */
  href?: string;
  tag?: string;
}

/**
 * The push of one kind (§10.1): its confirmed title and body; the team's lines use the replies strings
 * with how many are pushed together (1 when single). Opens the same place as the mail's button, as a
 * same-origin path. `tag` is the place, so a newer notice about it replaces the older one on the device.
 * Null for the receipt, which has no push (§2.1).
 */
export function buildRoomNoticePush(input: RoomNoticePushInput): PushMessage | null {
  const kind = roomNoticeMailKind(input.lines);
  if (kind === 'intake_received' || input.lines.length === 0) return null;
  const dict = getDictionary(input.locale);
  const vars = noticeVars(dict, kind, input.lines, placeName(dict, input.projectId, input.projectTitle));
  const strings = kindStrings(dict, kind, Number(vars.count));
  if (!strings.pushTitle || !strings.pushBody) return null;
  const organizationId = input.organizationId.toLowerCase();
  const projectId = input.projectId ? input.projectId.toLowerCase() : null;
  const tag = input.tag?.toLowerCase() ?? projectId ?? organizationId;
  return {
    title: interpolate(strings.pushTitle, vars),
    body: interpolate(strings.pushBody, vars),
    url: input.href ?? roomNoticePath(organizationId, projectId),
    tag,
    topic: tag.replace(/-/g, ''),
    lang: input.locale,
  };
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

type SkipReason = 'read' | 'muted' | 'no_mailer' | 'no_access' | 'no_email' | 'deleted' | 'rule';

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
  /** The line's channel now (a members thread moves with its file, and its notices with it). */
  channel: string;
  /** A reply's thread; null for a root or a team-channel line without one. */
  parentId: string | null;
  body: string;
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
  /** Members threads (보내기): `<organization>:<project>` -> the title members are shown, only while the project can take work. */
  memberProjects: Map<string, string>;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(String(v)));
const GENERAL = 'general';
/** A row's channel, as `brand_room_reads` names it: its project id, or 'general'. */
const channelOf = (projectId: string | null): string => (projectId ? projectId.toLowerCase() : GENERAL);

/** The members thread a notice row is about (its line is on a members channel now), or null for a team-channel notice. */
function memberThreadOf(row: NoticeRow, facts: Facts): { message: MessageFacts; rootId: string } | null {
  const message = row.message_id ? facts.messages.get(row.message_id.toLowerCase()) : undefined;
  if (!message || !isMembersChannel(message.channel)) return null;
  return { message, rootId: (message.parentId ?? message.id).toLowerCase() };
}

/** A row's channel for grouping and read marks: a members line's own channel, else the team channel of its project. */
function rowChannel(row: NoticeRow, facts: Facts): string {
  return memberThreadOf(row, facts)?.message.channel ?? channelOf(row.project_id);
}
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
  const messages = new Map<string, MessageFacts>();
  if (messageIds.length) {
    const found = (
      await sql.query<{
        id: string;
        channel: string;
        parent_id: string | null;
        kind: string;
        body: string | null;
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
        `select m.id::text as id, m.channel, m.parent_id::text as parent_id, m.kind, m.body, m.detail, m.deleted_at, m.created_at, m.author_role,
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
        parentId: m.parent_id ? String(m.parent_id).toLowerCase() : null,
        body: m.body ?? '',
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
    // Team projects only (lib/brands/project-origin.ts). The ids come from notice rows, written only after the
    // audience check (client_visible), so a brand's own project is never among them; the predicate is a belt.
    for (const p of (await sql.query<{ id: string; title: string }>(`select tp.id::text as id, tp.title from brand_projects tp where tp.id = any($1::uuid[]) and ${TEAM_PROJECTS('tp')}`, [projectIds])).rows) {
      projects.set(String(p.id).toLowerCase(), String(p.title));
    }
  }
  // Members threads: the project members are shown, by the spine's rule (./members-channel.ts), one statement per
  // organization that has one; a hidden, finished or archived project has no title here (its mail is then skipped).
  const memberProjects = new Map<string, string>();
  const byOrganization = new Map<string, Set<string>>();
  for (const row of rows) {
    const message = row.message_id ? messages.get(row.message_id.toLowerCase()) : undefined;
    if (!message || !isMembersChannel(message.channel) || !row.project_id) continue;
    const organizationId = row.organization_id.toLowerCase();
    byOrganization.set(organizationId, (byOrganization.get(organizationId) ?? new Set()).add(row.project_id.toLowerCase()));
  }
  for (const [organizationId, ids] of byOrganization) {
    for (const [id, title] of await shownProjectTitles(sql, organizationId, [...ids])) memberProjects.set(`${organizationId}:${id}`, title);
  }
  return { messages, recipients, projects, memberProjects };
}

/**
 * What a mail or a push about a members thread may say, or why it may not go out: a kind that is in-app only, or a
 * thread whose file is unfiled or in a project members are not shown (no true `{project}` for the mention words).
 */
function memberDelivery(row: NoticeRow, facts: Facts): { ok: true; projectId: string; projectTitle: string; href: string; tag: string } | { ok: false } {
  const thread = memberThreadOf(row, facts);
  if (!thread || IN_APP_ONLY.has(row.kind) || row.kind !== 'mention' || !row.project_id) return { ok: false };
  if (thread.message.channel !== membersChannelOf(row.project_id)) return { ok: false };
  const projectTitle = facts.memberProjects.get(`${row.organization_id.toLowerCase()}:${row.project_id.toLowerCase()}`);
  if (!projectTitle) return { ok: false };
  return { ok: true, projectId: row.project_id.toLowerCase(), projectTitle, href: sendThreadHref(row.organization_id, thread.rootId), tag: thread.rootId };
}

/** The project's title; the general channel is named by the mail itself (`roomsChat.inbox.general`). */
function projectTitleOf(facts: Facts, projectId: string | null): string {
  return projectId ? (facts.projects.get(projectId.toLowerCase()) ?? '') : '';
}

/**
 * The author as §10.1 labels them: "야기 팀 · name" (just "야기 팀" without a name) for the team, a brand
 * member by their name (the address's local part when they set none, as the conversation shows them).
 */
function authorName(dict: Dict, message: MessageFacts): string {
  const name = flat(message.displayName).slice(0, 60) || null;
  if (message.role === 'studio') return name ? interpolate(dict.roomsNotices.author.teamMember, { name }) : dict.roomsNotices.author.team;
  return personName(dict, message);
}

/**
 * The same person by plain name, for a mention's `{name}`: the display name, a team member's too; a
 * brand member without one by the address's local part; a team member without one as "야기 팀".
 */
function personName(dict: Dict, message: MessageFacts): string {
  const name = flat(message.displayName).slice(0, 60) || null;
  if (name) return name;
  if (message.role === 'studio') return dict.roomsNotices.author.team;
  return message.email?.split('@')[0]?.trim().slice(0, 60) || dict.roomsChat.author.someone;
}

function lineOf(row: NoticeRow, facts: Facts, locale: Locale): RoomNoticeLine {
  const dict = getDictionary(locale);
  const message = row.message_id ? facts.messages.get(row.message_id.toLowerCase()) : undefined;
  if (!message) return { kind: row.kind };
  const detail = message.detail ?? {};
  const title = typeof detail.title === 'string' ? detail.title : null;
  const version = typeof detail.version === 'number' ? detail.version : null;
  const name = authorName(dict, message);
  // A reply quotes the draft note itself (a note the team keeps to itself never comes back); a line
  // quotes its own text. No text (only files, a note no longer readable): no quote line (§10.1).
  if (row.kind === 'team_reply') return { kind: row.kind, title, version, name, excerpt: noticeExcerpt(message.replyBody) };
  if (row.kind === 'team_message') return { kind: row.kind, name, excerpt: noticeExcerpt(message.body) };
  // A mention's `{name}` is the plain name; its quote line keeps the author label (§10.1).
  if (row.kind === 'mention') return { kind: row.kind, name, person: personName(dict, message), excerpt: noticeExcerpt(message.body) };
  return { kind: row.kind, title, version, name };
}

/**
 * Per pass: who may still open which room (an organization closed or a member removed since the line). A members
 * thread (`members: true`) belongs to the organization's active members while 보내기 is open for it; the project does
 * not change who that is.
 */
function audienceCache(sql: SqlRunner, env: NodeJS.ProcessEnv) {
  const cache = new Map<string, Promise<Set<string>>>();
  return (organizationId: string, projectId: string | null, userId: string, members = false): Promise<boolean> => {
    const key = members ? `${organizationId.toLowerCase()}:members` : `${organizationId.toLowerCase()}:${channelOf(projectId)}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = members
        ? brandSendOpenFor(sql, organizationId, env).then(async (open) => new Set(open ? await membersAudience(sql, organizationId) : []))
        : roomAudience(sql, organizationId, projectId).then((people) => new Set(people.map((p) => p.userId)));
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
  await pushPhase(deps, now, limit, report, env);
  await mailPhase(deps, now, limit, report, env);
  return report;
}

async function pushPhase(deps: RoomNoticePassDeps, now: Date, limit: number, report: RoomNoticePassReport, env: NodeJS.ProcessEnv): Promise<void> {
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
  const seated = audienceCache(deps.sql, env);
  // One push per "now" notice; the team's lines of one recipient × place are one push that counts them.
  const groups = new Map<string, NoticeRow[]>();
  for (const row of rows) {
    const message = row.message_id ? facts.messages.get(row.message_id.toLowerCase()) : undefined;
    if (row.message_id && (!message || message.deleted)) continue;
    const place = placeKey(row.recipient_id, row.organization_id, rowChannel(row, facts));
    const key = BUNDLED.has(row.kind) ? `${place}:replies` : `${place}:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  // Same tag per place: the newest event goes last, so it is the one left on the device.
  const newest = (group: NoticeRow[]) => Math.max(...group.map((row) => toDate(row.created_at).getTime()));
  for (const group of [...groups.values()].sort((a, b) => newest(a) - newest(b))) {
    const first = group[0]!;
    try {
      // A members thread (보내기): its own audience and its own address; nothing goes out when no true words fit.
      const member = memberThreadOf(first, facts) ? memberDelivery(first, facts) : null;
      if (member && !member.ok) continue;
      if (!(await seated(first.organization_id, first.project_id, first.recipient_id, member !== null))) continue;
      const locale = facts.recipients.get(first.recipient_id.toLowerCase())?.locale ?? DEFAULT_LOCALE;
      const message = buildRoomNoticePush({
        locale,
        organizationId: first.organization_id,
        projectId: first.project_id,
        projectTitle: member?.ok ? member.projectTitle : projectTitleOf(facts, first.project_id),
        lines: group.map((row) => lineOf(row, facts, locale)),
        ...(member?.ok ? { href: member.href, tag: member.tag } : {}),
      });
      if (!message) continue;
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
  /** A members thread: the title members are shown and the 알림함 address (./send-contracts.ts `sendThreadHref`). */
  projectTitle?: string;
  href?: string;
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
        [recipientIds, organizationIds, [...new Set(rows.map((r) => rowChannel(r, facts)))]],
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
    const seated = audienceCache(tx, env);
    // One mail is one kind (§10.1). A retried batch keeps its id (the provider's idempotency key); a new
    // "now" row is a batch of its own; new bundled rows group by recipient × place.
    const groups = new Map<string, NoticeRow[]>();
    for (const row of rows) {
      const key = row.batch_id
        ? `b:${row.batch_id}`
        : row.timing === 'bundle'
          ? `g:${placeKey(row.recipient_id, row.organization_id, rowChannel(row, facts))}`
          : `n:${row.id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const batches: Batch[] = [];
    const deferred = new Map<string, string[]>();
    for (const group of groups.values()) {
      const first = group[0]!;
      const recipientId = first.recipient_id.toLowerCase();
      const projectId = first.project_id ? first.project_id.toLowerCase() : null;
      const organizationId = first.organization_id.toLowerCase();
      const place = placeKey(recipientId, organizationId, rowChannel(first, facts));
      const retry = first.batch_id !== null;
      // A members thread (보내기): in-app only unless today's mention words are all true for it (a project members are
      // shown); then its own audience, and the button opens the 알림함 on the thread.
      const member = memberThreadOf(first, facts) ? memberDelivery(first, facts) : null;
      if (member && !member.ok) {
        skip('rule', group.map((r) => r.id));
        continue;
      }
      if (!(await seated(organizationId, projectId, recipientId, member !== null))) {
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
      batches.push({
        batchId: first.batch_id ?? randomUUID(),
        rows: remaining,
        recipientId,
        organizationId,
        projectId,
        ...(member?.ok ? { projectTitle: member.projectTitle, href: member.href } : {}),
      });
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
      projectTitle: batch.projectTitle ?? projectTitleOf(claimed.facts, batch.projectId),
      lines: [...batch.rows].sort((a, b) => toDate(a.created_at).getTime() - toDate(b.created_at).getTime()).map((row) => lineOf(row, claimed.facts!, recipient.locale)),
      env,
      ...(batch.href ? { href: batch.href } : {}),
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
