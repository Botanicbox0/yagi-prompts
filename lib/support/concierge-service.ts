import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  enqueueTeamNotice,
  formatTeamNoticeSlackText,
  resolveSlackFetcher,
  resolveTeamNoticeConfig,
  sendTeamNoticePayload,
  tableExists,
} from '@/lib/brands/team-notice-outbox';
import { supportConciergeEn, supportConciergeKo } from '@/messages/support-concierge';
import type {
  ConciergeLocale,
  ConciergeTranscriptTurn,
  EscalationReason,
  PersonalSupportReply,
} from './personal-concierge';

const EscalateInputSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().max(120).nullable().optional(),
  reason: z.enum(['user_requested_human', 'account_or_billing_check', 'ai_unanswered']),
  message: z.string().trim().min(1).max(2000),
  pagePath: z.string().max(200).optional(),
  transcript: z
    .array(
      z.object({
        role: z.enum(['user', 'ai', 'human_agent']),
        text: z.string().max(400),
      }),
    )
    .max(6)
    .optional(),
  requestId: z.uuid(),
});

export type RecordEscalationResult =
  | { ok: true; available: false }
  | { ok: true; available: true; id: string; deliveryId: string | null; duplicate: boolean }
  | { ok: false; code: 'invalid' | 'sign_in_required' | 'rate_limited' };

/**
 * Stores a consumer AI concierge escalation in `consumer_support_messages` and enqueues a durable
 * `concierge_escalation` row in `team_notice_deliveries` inside ONE transaction.
 * Deploy-order safe: returns `{ ok: true, available: false }` when `consumer_support_messages` does
 * not exist yet.
 */
export async function recordConsumerEscalation(
  sql: SqlRunner,
  rawInput: {
    userId: string;
    displayName?: string | null;
    reason: EscalationReason;
    message: string;
    pagePath?: string;
    transcript?: readonly ConciergeTranscriptTurn[];
    requestId?: string;
  },
): Promise<RecordEscalationResult> {
  const parsed = EscalateInputSchema.safeParse({
    ...rawInput,
    requestId: rawInput.requestId ?? randomUUID(),
  });
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const input = parsed.data;

  if (!(await tableExists(sql, 'consumer_support_messages'))) {
    return { ok: true, available: false };
  }

  return sql.transaction(async (tx) => {
    const profileRow = (
      await tx.query<{ id: string; display_name: string | null }>(
        'select id::text as id, display_name from profiles where id = $1 for update',
        [input.userId],
      )
    ).rows[0];
    if (!profileRow) return { ok: false as const, code: 'sign_in_required' as const };

    const existing = (
      await tx.query<{ id: string }>(
        'select id::text as id from consumer_support_messages where user_id = $1 and created_by = $2 and request_id = $3',
        [input.userId, input.userId, input.requestId],
      )
    ).rows[0];
    if (existing) {
      let existingDeliveryId: string | null = null;
      if (await tableExists(tx, 'team_notice_deliveries')) {
        existingDeliveryId =
          (
            await tx.query<{ id: string }>(
              "select id::text as id from team_notice_deliveries where kind = 'concierge_escalation' and source_id = $1::uuid",
              [existing.id],
            )
          ).rows[0]?.id ?? null;
      }
      return {
        ok: true as const,
        available: true as const,
        id: existing.id,
        deliveryId: existingDeliveryId,
        duplicate: true,
      };
    }

    const recent = (
      await tx.query<{ n: number }>(
        "select count(*)::int as n from consumer_support_messages where user_id = $1 and author_role = 'customer' and created_at > now() - interval '1 hour'",
        [input.userId],
      )
    ).rows[0]!;
    if (Number(recent.n) >= 20) return { ok: false as const, code: 'rate_limited' as const };

    const id = randomUUID();
    const safePagePath = input.pagePath && input.pagePath.startsWith('/') ? input.pagePath : '';
    const transcript = input.transcript ?? [];
    await tx.query(
      `insert into consumer_support_messages (
         id, user_id, author_role, created_by, request_id, reason, page_path, body, transcript
       ) values ($1, $2, 'customer', $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        id,
        input.userId,
        input.userId,
        input.requestId,
        input.reason,
        safePagePath,
        input.message,
        JSON.stringify(transcript),
      ],
    );

    const displayName = input.displayName?.trim() || profileRow.display_name?.trim() || '';
    const reasonLabel =
      input.reason === 'user_requested_human'
        ? '고객 직접 연결 요청'
        : input.reason === 'account_or_billing_check'
          ? '결제·환불·계정 확인 요청'
          : 'AI 미해결 에스컬레이션';
    // Privacy (Round 2): store only a short first-message preview in the outbox; multi-turn AI
    // transcript excerpts stay exclusively in `consumer_support_messages.transcript` (365-day TTL).
    const shortFirstMessage = input.message.replace(/\s+/g, ' ').trim().slice(0, 300);
    const outboxPreview = `[${reasonLabel}]\n${shortFirstMessage}`;

    const enqueued = await enqueueTeamNotice(tx, 'concierge_escalation', {
      organizationId: null,
      sourceTable: 'consumer_support_messages',
      sourceId: id,
      actorUserId: input.userId,
      actorLabel: displayName.slice(0, 120),
      surface: safePagePath || 'consumer_concierge',
      preview: outboxPreview,
      adminPath: `/admin/inquiries?kind=team&noticeKind=concierge_escalation#notice-${id}`,
    });

    return {
      ok: true as const,
      available: true as const,
      id,
      deliveryId: enqueued.id,
      duplicate: false,
    };
  });
}

// Founder / privacy decision: scrub personal AI conversation transcript excerpts after 365 days.
export const CONSUMER_TRANSCRIPT_RETENTION_DAYS = 365;

export interface ConsumerSupportThreadItem {
  id: string;
  role: 'user' | 'human_agent';
  authorLabel: string;
  text: string;
  createdAt: string;
}

export interface ConsumerSupportThreadSnapshot {
  hasEscalation: boolean;
  replies: PersonalSupportReply[];
  thread: ConsumerSupportThreadItem[];
  latestStaffReplyAt: string | null;
}

/** Loads the full consumer escalation/reply thread and unread metadata so reloads restore ongoing chats (F8). */
export async function loadConsumerSupportThread(
  sql: SqlRunner,
  userId: string,
  locale: ConciergeLocale = 'ko',
): Promise<ConsumerSupportThreadSnapshot> {
  if (!z.string().uuid().safeParse(userId).success) {
    return { hasEscalation: false, replies: [], thread: [], latestStaffReplyAt: null };
  }
  if (!(await tableExists(sql, 'consumer_support_messages'))) {
    return { hasEscalation: false, replies: [], thread: [], latestStaffReplyAt: null };
  }
  const staffAuthor = locale === 'en' ? supportConciergeEn.staffAuthor : supportConciergeKo.staffAuthor;
  const userAuthor = locale === 'en' ? 'You' : '나';
  const { rows } = await sql.query<{
    id: string;
    author_role: 'customer' | 'studio';
    body: string;
    created_at: Date | string;
  }>(
    `select id::text as id, author_role, body, created_at
       from consumer_support_messages
      where user_id = $1
      order by created_at asc, id asc
      limit 100`,
    [userId],
  );
  const thread: ConsumerSupportThreadItem[] = rows.map((r) => {
    const createdAt =
      r.created_at instanceof Date ? r.created_at.toISOString() : new Date(String(r.created_at)).toISOString();
    return {
      id: String(r.id),
      role: r.author_role === 'studio' ? 'human_agent' : 'user',
      authorLabel: r.author_role === 'studio' ? staffAuthor : userAuthor,
      text: String(r.body),
      createdAt,
    };
  });
  const replies: PersonalSupportReply[] = rows
    .filter((r) => r.author_role === 'studio')
    .map((r) => ({
      id: String(r.id),
      body: String(r.body),
      createdAt:
        r.created_at instanceof Date ? r.created_at.toISOString() : new Date(String(r.created_at)).toISOString(),
      authorLabel: staffAuthor,
    }));
  const latestStaffReplyAt = replies.at(-1)?.createdAt ?? null;
  return {
    hasEscalation: thread.length > 0,
    replies,
    thread,
    latestStaffReplyAt,
  };
}

/** Loads studio replies for a signed-in consumer user from `consumer_support_messages`. */
export async function loadConsumerSupportReplies(
  sql: SqlRunner,
  userId: string,
  locale: ConciergeLocale = 'ko',
): Promise<PersonalSupportReply[]> {
  const snapshot = await loadConsumerSupportThread(sql, userId, locale);
  return snapshot.replies;
}

/**
 * Bounded privacy retention purge (F5 + Round 2): clears AI transcript excerpts AND
 * consumer outbox previews/actor labels older than `CONSUMER_TRANSCRIPT_RETENTION_DAYS`.
 */
export async function purgeExpiredConsumerTranscripts(
  sql: SqlRunner,
  options?: { now?: Date; limit?: number; deadlineAtMs?: number },
): Promise<{ available: boolean; purged: number; scrubbedNotices: number }> {
  const hasMessages = await tableExists(sql, 'consumer_support_messages');
  const hasOutbox = await tableExists(sql, 'team_notice_deliveries');
  if (!hasMessages && !hasOutbox) {
    return { available: false, purged: 0, scrubbedNotices: 0 };
  }
  if (options?.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
    return { available: true, purged: 0, scrubbedNotices: 0 };
  }
  const nowIso = (options?.now ?? new Date()).toISOString();
  const limit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 100)));

  let purged = 0;
  if (hasMessages) {
    const { rows } = await sql.query<{ id: string }>(
      `with expired as (
         select id from consumer_support_messages
          where created_at < $1::timestamptz - make_interval(days => $2::int)
            and transcript <> '[]'::jsonb
          order by created_at asc, id asc
          limit $3::int
          for update skip locked
       )
       update consumer_support_messages m
          set transcript = '[]'::jsonb
         from expired e
        where m.id = e.id
        returning m.id::text as id`,
      [nowIso, CONSUMER_TRANSCRIPT_RETENTION_DAYS, limit],
    );
    purged = rows.length;
  }

  let scrubbedNotices = 0;
  if (hasOutbox && (options?.deadlineAtMs === undefined || Date.now() < options.deadlineAtMs)) {
    const { rows: noticeRows } = await sql.query<{ id: string }>(
      `with expired_notices as (
         select id from team_notice_deliveries
          where kind = 'concierge_escalation'
            and created_at < $1::timestamptz - make_interval(days => $2::int)
            and (preview <> '' or actor_label <> '')
          order by created_at asc, id asc
          limit $3::int
          for update skip locked
       )
       update team_notice_deliveries d
          set preview = '',
              actor_label = '',
              updated_at = $1::timestamptz
         from expired_notices e
        where d.id = e.id
        returning d.id::text as id`,
      [nowIso, CONSUMER_TRANSCRIPT_RETENTION_DAYS, limit],
    );
    scrubbedNotices = noticeRows.length;
  }

  return { available: true, purged, scrubbedNotices };
}

export type ConsumerReplyResult =
  | { ok: true; id: string }
  | { ok: false; code: 'forbidden' | 'invalid' | 'not_found' | 'unavailable' };

/** Writes a staff reply to a consumer support thread from the admin console. */
export async function sendConsumerSupportReply(
  sql: SqlRunner,
  viewer: Viewer,
  rawInput: { userId: string; body: string; requestId?: string },
): Promise<ConsumerReplyResult> {
  if (!z.string().uuid().safeParse(viewer.userId).success) return { ok: false, code: 'forbidden' };
  const parsed = z
    .object({
      userId: z.uuid(),
      body: z.string().trim().min(1).max(4000),
      requestId: z.uuid(),
    })
    .safeParse({
      userId: rawInput.userId,
      body: rawInput.body,
      requestId: rawInput.requestId ?? randomUUID(),
    });
  if (!parsed.success) return { ok: false, code: 'invalid' };
  if (!(await tableExists(sql, 'consumer_support_messages'))) return { ok: false, code: 'unavailable' };

  return sql.transaction(async (tx) => {
    const admin = (
      await tx.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])
    ).rows[0];
    if (admin?.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };

    const target = (
      await tx.query<{ id: string }>('select id::text as id from profiles where id = $1 for update', [parsed.data.userId])
    ).rows[0];
    if (!target) return { ok: false as const, code: 'not_found' as const };

    const existing = (
      await tx.query<{ id: string }>(
        'select id::text as id from consumer_support_messages where user_id = $1 and created_by = $2 and request_id = $3',
        [parsed.data.userId, viewer.userId, parsed.data.requestId],
      )
    ).rows[0];
    if (existing) return { ok: true as const, id: existing.id };

    const id = randomUUID();
    await tx.query(
      `insert into consumer_support_messages (
         id, user_id, author_role, created_by, request_id, body
       ) values ($1, $2, 'studio', $3, $4, $5)`,
      [id, parsed.data.userId, viewer.userId, parsed.data.requestId, parsed.data.body],
    );
    return { ok: true as const, id };
  });
}

const FALLBACK_DEDUPE_TTL_MS = 5 * 60_000;
const recentFallbackSends = new Map<string, number>();

/**
 * Deploy-order fallback ONLY when `consumer_support_messages` does not exist yet:
 * strictly respects production gate, explicit bot channel or webhook, never exposes email or user ids,
 * dedupes identical user + text retries for 5 minutes (F4), and never returns fake success.
 */
export async function sendDirectConsumerEscalationFallback(
  input: {
    userId: string;
    displayName?: string | null;
    message: string;
    pagePath?: string;
    now?: Date;
  },
  options?: { env?: Record<string, string | undefined>; fetcher?: typeof fetch },
): Promise<{ sent: boolean; duplicate?: boolean }> {
  const env = options?.env ?? process.env;
  const fetcher = resolveSlackFetcher(options?.fetcher, env);
  if (!fetcher) return { sent: false };
  const config = resolveTeamNoticeConfig(env);
  if (config.status !== 'configured') return { sent: false };

  const nowMs = (input.now ?? new Date()).getTime();
  for (const [k, exp] of recentFallbackSends) {
    if (exp <= nowMs) recentFallbackSends.delete(k);
  }
  const digest = createHash('sha256').update(`${input.userId}:${input.message.trim()}`).digest('hex');
  const existingExp = recentFallbackSends.get(digest);
  if (existingExp && existingExp > nowMs) {
    return { sent: true, duplicate: true };
  }

  const text = formatTeamNoticeSlackText({
    kind: 'concierge_escalation',
    actorDisplayName: input.displayName ?? null,
    noticeReference: randomUUID().slice(0, 8),
    surface: input.pagePath || 'consumer_concierge',
    preview: input.message,
    adminPath: '/admin/inquiries?kind=team&noticeKind=concierge_escalation',
    transport: config.transport,
  });
  const outcome = await sendTeamNoticePayload(config, text, { fetcher, env });
  if (outcome.status === 'sent') {
    recentFallbackSends.set(digest, nowMs + FALLBACK_DEDUPE_TTL_MS);
    return { sent: true };
  }
  return { sent: false };
}
