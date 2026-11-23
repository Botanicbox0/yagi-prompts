import { createHash } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { slackSafe } from '@/lib/brand-rooms/team-notice';
import { adminUrl } from '@/lib/seo/site-url';

export const TEAM_NOTICE_KINDS = [
  'support_message',
  'concierge_escalation',
  'project_request',
  'room_message',
  'storyboard_approval',
  'review_comment',
  'share_guest_note',
  'org_created',
  'allowance_request',
  'plan_request',
] as const;

export type TeamNoticeKind = (typeof TEAM_NOTICE_KINDS)[number];

export type TeamNoticeStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
export type TeamNoticeTransport = 'bot' | 'webhook';

export const TEAM_NOTICE_MAX_ATTEMPTS = 8;
export const TEAM_NOTICE_LEASE_MINUTES = 5;
export const TEAM_NOTICE_TIMEOUT_MS = 5_000;
export const TEAM_NOTICE_BACKOFF_SECONDS = [60, 120, 300, 600, 1200, 2400, 3600] as const;
export const REPLY_SYNC_LOOKBACK_DAYS = 7;

export const TEAM_NOTICE_KIND_LABELS: Record<TeamNoticeKind, string> = {
  support_message: '실시간 문의',
  concierge_escalation: '고객 상담 요청',
  project_request: '프로젝트 의뢰',
  room_message: '프로젝트 룸 메시지',
  storyboard_approval: '스토리보드 결정',
  review_comment: '시안 리뷰 의견',
  share_guest_note: '공유 링크 의견',
  org_created: '신규 브랜드 가입',
  allowance_request: '스튜디오 한도 요청',
  plan_request: 'B2B 플랜 요청',
};

const BILLING_PLAN_QUESTION_LABEL = 'B2B 플랜 문의';

export function resolveTeamNoticeKindLabel(
  kind: TeamNoticeKind,
  surface?: string | null,
): string {
  if (kind === 'plan_request' && surface?.startsWith('billing:plan_question')) {
    return BILLING_PLAN_QUESTION_LABEL;
  }
  return TEAM_NOTICE_KIND_LABELS[kind];
}

export type TeamNoticeSkipCode =
  | 'disabled'
  | 'non_production'
  | 'missing_channel_id'
  | 'invalid_channel_id'
  | 'missing_token'
  | 'invalid_token'
  | 'misconfigured_webhook'
  | 'unconfigured';

export type TeamNoticeConfig =
  | { status: 'skipped'; code: TeamNoticeSkipCode }
  | { status: 'configured'; transport: 'bot'; token: string; channelId: string }
  | { status: 'configured'; transport: 'webhook'; webhookUrl: string };

/**
 * Checks whether a table exists in the current database schema so code and migrations
 * can deploy in either order without breaking existing paths.
 */
export async function tableExists(sql: SqlRunner, tableName: string): Promise<boolean> {
  if (!sql || typeof sql.query !== 'function') return false;
  try {
    const { rows } = await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${tableName}`]);
    return Boolean(rows[0]?.t);
  } catch {
    return false;
  }
}

/** Deterministic UUID v4-shaped identifier for idempotent Slack reply ingestion. */
export function deterministicSlackMessageUuid(channelId: string, ts: string): string {
  const hex = createHash('sha256').update(`slack-concierge:${channelId}:${ts}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** Deterministic UUID v4-shaped identifier for outbox deduplication when source events lack their own row UUID. */
export function deterministicNoticeSourceId(namespace: string, ...parts: string[]): string {
  const hex = createHash('sha256').update([namespace, ...parts].join(':')).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function isValidSlackWebhookUrl(raw: string | undefined): string | null {
  const webhookUrl = raw?.trim();
  if (!webhookUrl) return null;
  try {
    const url = new URL(webhookUrl);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'hooks.slack.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

const SLACK_CHANNEL_ID_RE = /^[CG][A-Z0-9]{8,}$/;

/**
 * Dual-transport runtime resolution:
 * 1. Production gate (`VERCEL_ENV === 'production'`, unless explicitly allowed by admin test flag)
 * 2. Kill switch (`SLACK_BRAND_CONCIERGE_ENABLED=off`)
 * 3. `bot`: BOTH bot token (`SLACK_BRAND_CONCIERGE_BOT_TOKEN` -> `SLACK_BOT_TOKEN`) and explicit
 *    channel ID (`SLACK_BRAND_CONCIERGE_CHANNEL_ID`) are valid -> two-way delivery + thread reply sync.
 * 4. `webhook`: incoming webhook from `SLACK_TEAM_NOTICE_WEBHOOK_URL`, or fallback to
 *    `SLACK_BRAND_INQUIRIES_WEBHOOK_URL` when `SLACK_BRAND_INQUIRIES_ENABLED === 'on'` -> one-way delivery.
 * 5. Otherwise `skipped` with an explicit diagnostic code. Never auto-discovers or auto-creates channels.
 */
export function resolveTeamNoticeConfig(
  env: Record<string, string | undefined> = process.env,
  options?: { allowNonProduction?: boolean },
): TeamNoticeConfig {
  if (env.SLACK_BRAND_CONCIERGE_ENABLED === 'off') {
    return { status: 'skipped', code: 'disabled' };
  }
  if (!options?.allowNonProduction && env.VERCEL_ENV !== 'production') {
    return { status: 'skipped', code: 'non_production' };
  }

  const token = (env.SLACK_BRAND_CONCIERGE_BOT_TOKEN ?? env.SLACK_BOT_TOKEN)?.trim() ?? '';
  const channelId = env.SLACK_BRAND_CONCIERGE_CHANNEL_ID?.trim() ?? '';

  if (token.startsWith('xoxb-') && SLACK_CHANNEL_ID_RE.test(channelId)) {
    return { status: 'configured', transport: 'bot', token, channelId };
  }

  const dedicatedWebhook = env.SLACK_TEAM_NOTICE_WEBHOOK_URL?.trim() ?? '';
  if (dedicatedWebhook) {
    const valid = isValidSlackWebhookUrl(dedicatedWebhook);
    return valid
      ? { status: 'configured', transport: 'webhook', webhookUrl: valid }
      : { status: 'skipped', code: 'misconfigured_webhook' };
  }

  if (env.SLACK_BRAND_INQUIRIES_ENABLED === 'on') {
    const fallbackWebhook = env.SLACK_BRAND_INQUIRIES_WEBHOOK_URL?.trim() ?? '';
    if (fallbackWebhook) {
      const valid = isValidSlackWebhookUrl(fallbackWebhook);
      return valid
        ? { status: 'configured', transport: 'webhook', webhookUrl: valid }
        : { status: 'skipped', code: 'misconfigured_webhook' };
    }
  }

  if (token && !token.startsWith('xoxb-')) return { status: 'skipped', code: 'invalid_token' };
  if (token && !channelId) return { status: 'skipped', code: 'missing_channel_id' };
  if (token && channelId) return { status: 'skipped', code: 'invalid_channel_id' };
  if (channelId) return { status: 'skipped', code: 'missing_token' };
  return { status: 'skipped', code: 'unconfigured' };
}

function flatLine(value: string, maxLen: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function sanitizePreview(value: string, maxLen = 1000): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

export function formatTeamNoticeSlackText(input: {
  kind: TeamNoticeKind;
  organizationName?: string | null;
  actorDisplayName?: string | null;
  noticeReference?: string | null;
  surface?: string | null;
  preview?: string | null;
  adminPath: string;
  transport: TeamNoticeTransport;
  isRetry?: boolean;
}): string {
  const label = resolveTeamNoticeKindLabel(input.kind, input.surface);
  const lines: string[] = [`*[TWINGS · ${label}]${input.isRetry ? ' (재전송)' : ''}*`];

  if (input.organizationName) {
    lines.push(`• *조직:* *${slackSafe(flatLine(input.organizationName, 100))}*`);
  }

  if (input.kind === 'concierge_escalation') {
    const ref = flatLine(input.noticeReference ?? 'notice', 16);
    const who = slackSafe(flatLine(input.actorDisplayName || 'TWINGS 회원', 80));
    lines.push(`• *문의 번호:* \`#${slackSafe(ref)}\` (${who})`);
  } else {
    const who = slackSafe(flatLine(input.actorDisplayName || '브랜드 담당자', 80));
    lines.push(`• *작성자:* ${who}`);
  }

  if (input.surface) {
    lines.push(`• *경로:* \`${slackSafe(flatLine(input.surface, 80))}\``);
  }

  const safeBody = sanitizePreview(input.preview ?? '', 1000);
  if (safeBody) {
    lines.push('• *내용:*');
    for (const line of safeBody.split('\n').slice(0, 20)) {
      lines.push(`> ${slackSafe(line)}`);
    }
  }

  lines.push(`• *관리자 화면:* ${adminUrl(input.adminPath)}`);

  if (input.kind === 'support_message' || input.kind === 'concierge_escalation') {
    lines.push(
      input.transport === 'bot'
        ? '_이 메시지의 스레드에 답글을 남기면 고객에게 전달됩니다._'
        : '_웹훅 단방향 알림입니다. 답변은 위 관리자 화면에서 작성해 주세요._',
    );
  }

  return lines.join('\n');
}

export interface EnqueueTeamNoticeInput {
  organizationId?: string | null;
  sourceTable: string;
  sourceId: string;
  surface?: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  preview?: string | null;
  adminPath?: string | null;
}

export interface EnqueueTeamNoticeResult {
  available: boolean;
  enqueued: boolean;
  id: string | null;
}

/**
 * Enqueues one durable team notice in `team_notice_deliveries`.
 * Callers run this inside the same database transaction as the customer write so enqueueing
 * succeeds or rolls back atomically with the stored record.
 */
export async function enqueueTeamNotice(
  sql: SqlRunner,
  kind: TeamNoticeKind,
  input: EnqueueTeamNoticeInput,
): Promise<EnqueueTeamNoticeResult> {
  if (!(await tableExists(sql, 'team_notice_deliveries'))) {
    return { available: false, enqueued: false, id: null };
  }
  const safePreview = sanitizePreview(input.preview ?? '', 1400);
  const safeSurface = flatLine(input.surface ?? '', 120);
  const safeActorLabel = flatLine(input.actorLabel ?? '', 120);
  const safeAdminPath = (input.adminPath?.trim() || '/admin/inquiries').slice(0, 500);

  const { rows } = await sql.query<{ id: string }>(
    `insert into team_notice_deliveries (
       kind, organization_id, source_table, source_id, surface,
       actor_user_id, actor_label, preview, admin_path
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (kind, source_id) do nothing
     returning id::text as id`,
    [
      kind,
      input.organizationId ?? null,
      input.sourceTable.slice(0, 80),
      input.sourceId,
      safeSurface,
      input.actorUserId ?? null,
      safeActorLabel,
      safePreview,
      safeAdminPath,
    ],
  );
  return {
    available: true,
    enqueued: rows.length > 0,
    id: rows[0]?.id ?? null,
  };
}

export type TeamNoticeSendOutcome =
  | { status: 'sent'; transport: TeamNoticeTransport; slackChannel: string | null; slackTs: string | null }
  | { status: 'retry'; code: string; retryAfterSeconds?: number }
  | { status: 'failed'; code: string };

const SAFE_ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;
export function boundErrorCode(raw: string | null | undefined, fallback = 'delivery_error'): string {
  const normalized = (raw ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized || !SAFE_ERROR_CODE_RE.test(normalized)) return fallback;
  return normalized.slice(0, 64);
}

const PERMANENT_SLACK_BOT_ERRORS = new Set([
  'invalid_auth',
  'account_inactive',
  'missing_scope',
  'channel_not_found',
  'is_archived',
  'not_in_channel',
  'no_text',
  'msg_too_long',
]);

export function resolveSlackFetcher(
  explicitFetcher: typeof fetch | undefined,
  env: Record<string, string | undefined> = process.env,
): typeof fetch | null {
  if (typeof explicitFetcher === 'function') return explicitFetcher;
  const inTest =
    Boolean(env.VITEST || process.env.VITEST) ||
    env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'test';
  if (inTest) return null;
  return fetch;
}

export async function sendTeamNoticePayload(
  config: Extract<TeamNoticeConfig, { status: 'configured' }>,
  text: string,
  options?: { fetcher?: typeof fetch; timeoutMs?: number; env?: Record<string, string | undefined> },
): Promise<TeamNoticeSendOutcome> {
  const fetcher = resolveSlackFetcher(options?.fetcher, options?.env ?? process.env);
  if (!fetcher) {
    return { status: 'failed', code: 'test_env_blocked' };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TeamNoticeSendOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: 'retry', code: 'timeout' });
      controller.abort();
    }, options?.timeoutMs ?? TEAM_NOTICE_TIMEOUT_MS);
  });

  const send = async (): Promise<TeamNoticeSendOutcome> => {
    try {
      if (config.transport === 'bot') {
        const response = await fetcher('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            channel: config.channelId,
            text,
            unfurl_links: false,
            unfurl_media: false,
          }),
        });
        if (response.status === 429) {
          const sec = Number(response.headers.get('retry-after'));
          return {
            status: 'retry',
            code: 'rate_limited',
            retryAfterSeconds: Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : 60,
          };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          return { status: 'failed', code: `http_${response.status}` };
        }
        if (!response.ok) {
          return { status: 'retry', code: `http_${response.status}` };
        }
        const data = (await response.json()) as { ok?: boolean; ts?: string; channel?: string; error?: string };
        if (data.ok === true && typeof data.ts === 'string' && data.ts.length > 0) {
          return {
            status: 'sent',
            transport: 'bot',
            slackChannel: data.channel ?? config.channelId,
            slackTs: data.ts,
          };
        }
        const errCode = boundErrorCode(data.error, 'slack_api_error');
        if (errCode === 'ratelimited') {
          return { status: 'retry', code: 'rate_limited', retryAfterSeconds: 60 };
        }
        if (PERMANENT_SLACK_BOT_ERRORS.has(errCode)) {
          return { status: 'failed', code: errCode };
        }
        return { status: 'retry', code: errCode };
      }

      const response = await fetcher(config.webhookUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      if (response.status === 429) {
        const sec = Number(response.headers.get('retry-after'));
        return {
          status: 'retry',
          code: 'rate_limited',
          retryAfterSeconds: Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : 60,
        };
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        return { status: 'failed', code: `http_${response.status}` };
      }
      if (response.status !== 200) {
        return { status: 'retry', code: `http_${response.status}` };
      }
      const bodyText = (await response.text()).trim();
      return bodyText === 'ok'
        ? { status: 'sent', transport: 'webhook', slackChannel: null, slackTs: null }
        : { status: 'retry', code: 'unexpected_response' };
    } catch {
      return { status: 'retry', code: 'transport_error' };
    }
  };

  try {
    return await Promise.race([send(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface TeamNoticeDeliveryReport {
  available: boolean;
  configuration: TeamNoticeSkipCode | TeamNoticeTransport;
  transport: TeamNoticeTransport | null;
  claimed: number;
  sent: number;
  deferred: number;
  failed: number;
  skipped: number;
  recovered: number;
  budgetExhausted?: boolean;
}

interface ClaimedDeliveryRow {
  id: string;
  kind: TeamNoticeKind;
  organization_id: string | null;
  source_table: string;
  source_id: string;
  surface: string;
  actor_user_id: string | null;
  actor_label: string;
  preview: string;
  admin_path: string;
  claim_token: string;
  attempts: number;
}

export function backoffSecondsForAttempt(attemptNumber: number, retryAfterSeconds?: number): number {
  const index = Math.max(0, Math.min(TEAM_NOTICE_BACKOFF_SECONDS.length - 1, attemptNumber - 1));
  const scheduled = TEAM_NOTICE_BACKOFF_SECONDS[index]!;
  const explicit = retryAfterSeconds && Number.isFinite(retryAfterSeconds) ? Math.min(86400, Math.ceil(retryAfterSeconds)) : 0;
  return Math.max(scheduled, explicit);
}

/**
 * Processes pending rows in `team_notice_deliveries`.
 * - Recovers stale `sending` claims (> 5 min).
 * - Under `skipped` runtime config (non-production, kill switch, or missing config), marks due
 *   pending rows `skipped` with the diagnostic error code and touches no external endpoint.
 * - Under `configured` (`bot` or `webhook`), atomically claims rows with `FOR UPDATE SKIP LOCKED`,
 *   renders safe Slack mrkdwn (never emailing/exposing PII), and updates status / retry backoff
 *   up to 8 attempts before moving to `failed`.
 */
export async function runTeamNoticeDeliveryPass(args: {
  sql: SqlRunner;
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  now?: Date;
  limit?: number;
  deliveryId?: string;
  sourceKind?: TeamNoticeKind;
  sourceId?: string;
  timeoutMs?: number;
  deadlineAtMs?: number;
}): Promise<TeamNoticeDeliveryReport> {
  const { sql } = args;
  const now = args.now ?? new Date();
  if (!(await tableExists(sql, 'team_notice_deliveries'))) {
    return {
      available: false,
      configuration: 'unconfigured',
      transport: null,
      claimed: 0,
      sent: 0,
      deferred: 0,
      failed: 0,
      skipped: 0,
      recovered: 0,
    };
  }

  const config = resolveTeamNoticeConfig(args.env ?? process.env);
  const report: TeamNoticeDeliveryReport = {
    available: true,
    configuration: config.status === 'configured' ? config.transport : config.code,
    transport: config.status === 'configured' ? config.transport : null,
    claimed: 0,
    sent: 0,
    deferred: 0,
    failed: 0,
    skipped: 0,
    recovered: 0,
  };

  const nowIso = now.toISOString();
  const recovered = await sql.query<{ id: string }>(
    `update team_notice_deliveries
        set status = case when attempts >= $3::int then 'failed' else 'pending' end,
            last_error_code = 'claim_expired',
            claimed_at = null,
            claim_token = null,
            updated_at = $1::timestamptz
      where status = 'sending'
        and claimed_at <= $1::timestamptz - make_interval(mins => $2::int)
      returning id::text as id`,
    [nowIso, TEAM_NOTICE_LEASE_MINUTES, TEAM_NOTICE_MAX_ATTEMPTS],
  );
  report.recovered = recovered.rows.length;

  const targetLimit = args.deliveryId || args.sourceId ? 1 : Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));

  // F6: non-production and disabled/unconfigured states NEVER sink pending rows into `skipped`;
  // rows stay `pending` (0 attempts) so production delivers them once configured.
  if (config.status === 'skipped') {
    return report;
  }

  // Round 2 Safety: refuse outbound sends in VITEST / NODE_ENV=test unless caller injected options.fetcher.
  if (!resolveSlackFetcher(args.fetcher, args.env ?? process.env)) {
    return { ...report, configuration: 'disabled', transport: null };
  }

  for (let i = 0; i < targetLimit; i += 1) {
    if (args.deadlineAtMs !== undefined && Date.now() >= args.deadlineAtMs) {
      report.budgetExhausted = true;
      break;
    }
    const claim = await sql.query<ClaimedDeliveryRow>(
      `with candidate as (
         select id from team_notice_deliveries
          where status = 'pending'
            and attempts < $2::int
            and (next_attempt_at is null or next_attempt_at <= $1::timestamptz)
            and ($3::uuid is null or id = $3::uuid)
            and ($4::text is null or kind = $4::text)
            and ($5::uuid is null or source_id = $5::uuid)
          order by created_at asc, id asc
          limit 1
          for update skip locked
       )
       update team_notice_deliveries d
          set status = 'sending',
              claimed_at = $1::timestamptz,
              claim_token = gen_random_uuid(),
              attempts = d.attempts + 1,
              updated_at = $1::timestamptz
         from candidate c
        where d.id = c.id
        returning d.id::text as id, d.kind, d.organization_id::text as organization_id,
                  d.source_table, d.source_id::text as source_id, d.surface,
                  d.actor_user_id::text as actor_user_id, d.actor_label, d.preview,
                  d.admin_path, d.claim_token::text as claim_token, d.attempts`,
      [nowIso, TEAM_NOTICE_MAX_ATTEMPTS, args.deliveryId ?? null, args.sourceKind ?? null, args.sourceId ?? null],
    );
    const row = claim.rows[0];
    if (!row) break;
    report.claimed += 1;

    const orgName = row.organization_id
      ? (
          await sql.query<{ name: string }>('select name from brand_organizations where id = $1', [row.organization_id])
        ).rows[0]?.name ?? null
      : null;

    const actorDisplayName = row.actor_label
      ? row.actor_label
      : row.actor_user_id
        ? (
            await sql.query<{ display_name: string | null }>(
              'select display_name from profiles where id = $1',
              [row.actor_user_id],
            )
          ).rows[0]?.display_name ?? null
        : null;

    const text = formatTeamNoticeSlackText({
      kind: row.kind,
      organizationName: orgName,
      actorDisplayName,
      noticeReference: row.id.slice(0, 8),
      surface: row.surface || null,
      preview: row.preview,
      adminPath: row.admin_path,
      transport: config.transport,
      isRetry: row.attempts > 1,
    });

    let outcome: TeamNoticeSendOutcome;
    try {
      outcome = await sendTeamNoticePayload(config, text, {
        fetcher: args.fetcher,
        timeoutMs: args.timeoutMs,
        env: args.env,
      });
    } catch {
      outcome = { status: 'retry', code: 'sender_error' };
    }

    const completedAt = (args.now ?? new Date()).toISOString();
    if (outcome.status === 'sent') {
      const updated = await sql.query<{ id: string }>(
        `update team_notice_deliveries
            set status = 'sent',
                transport = $3,
                slack_channel = $4,
                slack_ts = $5,
                last_error_code = null,
                sent_at = $6::timestamptz,
                next_attempt_at = null,
                claimed_at = null,
                claim_token = null,
                updated_at = $6::timestamptz
          where id = $1::uuid and claim_token = $2::uuid and status = 'sending'
          returning id::text as id`,
        [row.id, row.claim_token, outcome.transport, outcome.slackChannel, outcome.slackTs, completedAt],
      );
      if (updated.rows.length > 0) report.sent += 1;
      continue;
    }

    const exhausted = outcome.status === 'failed' || row.attempts >= TEAM_NOTICE_MAX_ATTEMPTS;
    const nextStatus: TeamNoticeStatus = exhausted ? 'failed' : 'pending';
    const errCode =
      outcome.status === 'retry' && row.attempts >= TEAM_NOTICE_MAX_ATTEMPTS && outcome.code !== 'rate_limited'
        ? boundErrorCode(outcome.code, 'attempt_limit')
        : boundErrorCode(outcome.code);
    const delaySecs =
      nextStatus === 'pending'
        ? backoffSecondsForAttempt(row.attempts, outcome.status === 'retry' ? outcome.retryAfterSeconds : undefined)
        : null;

    const updated = await sql.query<{ id: string }>(
      `update team_notice_deliveries
          set status = $3,
              transport = coalesce(transport, $4),
              last_error_code = $5,
              next_attempt_at = case when $3 = 'pending' then $6::timestamptz + make_interval(secs => $7::double precision) else null end,
              claimed_at = null,
              claim_token = null,
              updated_at = $6::timestamptz
        where id = $1::uuid and claim_token = $2::uuid and status = 'sending'
        returning id::text as id`,
      [row.id, row.claim_token, nextStatus, config.transport, errCode, completedAt, delaySecs],
    );
    if (updated.rows.length > 0) {
      if (nextStatus === 'failed') report.failed += 1;
      else report.deferred += 1;
    }
    if (outcome.code === 'rate_limited') break;
  }

  return report;
}

export async function runLiveTeamNoticeDeliveryPass(
  sql: SqlRunner,
  options?: {
    deliveryId?: string;
    sourceKind?: TeamNoticeKind;
    sourceId?: string;
    limit?: number;
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    now?: Date;
    deadlineAtMs?: number;
  },
): Promise<TeamNoticeDeliveryReport> {
  const env = options?.env ?? process.env;
  if (!resolveSlackFetcher(options?.fetcher, env)) {
    return {
      available: await tableExists(sql, 'team_notice_deliveries'),
      configuration: 'disabled',
      transport: null,
      claimed: 0,
      sent: 0,
      deferred: 0,
      failed: 0,
      skipped: 0,
      recovered: 0,
    };
  }
  return runTeamNoticeDeliveryPass({ sql, ...options, env });
}

export interface SlackReplySyncResult {
  available: boolean;
  skipped: boolean;
  checked: number;
  synced: number;
  errors: Array<{ deliveryId: string; code: string }>;
  budgetExhausted?: boolean;
}

const UUID_SIMPLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compareSlackTs(a: string, b: string): number {
  const [secA = '0', subA = '0'] = a.split('.');
  const [secB = '0', subB = '0'] = b.split('.');
  const sDiff = Number(secA) - Number(secB);
  if (sDiff !== 0) return sDiff;
  return Number(subA.padEnd(6, '0')) - Number(subB.padEnd(6, '0'));
}

async function resolveSystemSyncAuthorId(
  sql: SqlRunner,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  const configured = env.SLACK_SYNC_SYSTEM_USER_ID?.trim();
  if (configured && UUID_SIMPLE_RE.test(configured)) {
    const designated = (
      await sql.query<{ id: string }>(
        'select id::text as id from profiles where id = $1::uuid and is_admin = true limit 1',
        [configured],
      )
    ).rows[0]?.id;
    if (designated) return designated;
  }
  return (
    (
      await sql.query<{ id: string }>(
        'select id::text as id from profiles where is_admin = true order by created_at asc, id asc limit 1',
      )
    ).rows[0]?.id ?? null
  );
}

const lastReplySyncAt = new Map<string, number>();

/**
 * Syncs staff replies typed inside Slack threads of bot-delivered support/escalation messages
 * back into `brand_support_messages` and `consumer_support_messages`.
 *
 * - Strictly matches by `(slack_channel, slack_ts)` on `team_notice_deliveries` (NEVER `@handle` or
 *   organization name guessing).
 * - F7: Round-robins across ALL 7-day active threads (`reply_synced_at asc nulls first`) and pages
 *   `conversations.replies` from each thread's stored `reply_sync_cursor`.
 * - F13: Inserts with `on conflict do nothing` (independent of `created_by`), uses a stable staff
 *   author rule, and records synced IDs in `support_synced_replies` so synced messages never count
 *   toward a person's 30/hr rate limit.
 * - Ignores bot messages and non-thread messages. Records errors instead of swallowing them.
 */
export async function syncSlackSupportReplies(
  sql: SqlRunner,
  options?: {
    organizationId?: string;
    userId?: string;
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    now?: Date;
    force?: boolean;
    limit?: number;
    deadlineAtMs?: number;
  },
): Promise<SlackReplySyncResult> {
  const env = options?.env ?? process.env;
  if (!(await tableExists(sql, 'team_notice_deliveries'))) {
    return { available: false, skipped: true, checked: 0, synced: 0, errors: [] };
  }
  const fetcher = resolveSlackFetcher(options?.fetcher, env);
  if (!fetcher) {
    return { available: true, skipped: true, checked: 0, synced: 0, errors: [] };
  }

  const config = resolveTeamNoticeConfig(env);
  if (config.status !== 'configured' || config.transport !== 'bot') {
    return { available: true, skipped: true, checked: 0, synced: 0, errors: [] };
  }
  if (options?.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
    return { available: true, skipped: false, checked: 0, synced: 0, errors: [], budgetExhausted: true };
  }

  const now = options?.now ?? new Date();
  const scopeKey = `${config.channelId}:${options?.organizationId ?? ''}:${options?.userId ?? ''}`;
  const lastRun = lastReplySyncAt.get(scopeKey) ?? 0;
  if (!options?.force && now.getTime() - lastRun < 4_000) {
    return { available: true, skipped: true, checked: 0, synced: 0, errors: [] };
  }
  lastReplySyncAt.set(scopeKey, now.getTime());

  const errors: Array<{ deliveryId: string; code: string }> = [];
  const limit = Math.max(1, Math.min(50, Math.floor(options?.limit ?? 20)));
  const lookbackIso = new Date(now.getTime() - REPLY_SYNC_LOOKBACK_DAYS * 86_400_000).toISOString();

  const parents = (
    await sql.query<{
      id: string;
      kind: 'support_message' | 'concierge_escalation';
      organization_id: string | null;
      actor_user_id: string | null;
      slack_channel: string;
      slack_ts: string;
      reply_sync_cursor: string | null;
    }>(
      `select id::text as id, kind, organization_id::text as organization_id,
              actor_user_id::text as actor_user_id, slack_channel, slack_ts, reply_sync_cursor
         from team_notice_deliveries
        where status = 'sent'
          and transport = 'bot'
          and kind in ('support_message', 'concierge_escalation')
          and slack_channel is not null
          and slack_ts is not null
          and sent_at >= $1::timestamptz
          and ($2::uuid is null or organization_id = $2::uuid)
          and ($3::uuid is null or actor_user_id = $3::uuid)
        order by reply_synced_at asc nulls first, sent_at desc, id desc
        limit $4::int`,
      [lookbackIso, options?.organizationId ?? null, options?.userId ?? null, limit],
    )
  ).rows;

  if (parents.length === 0) {
    return { available: true, skipped: false, checked: 0, synced: 0, errors: [] };
  }

  const staffAuthorId = await resolveSystemSyncAuthorId(sql, env);
  if (!staffAuthorId) {
    const code = 'no_staff_profile';
    errors.push({ deliveryId: 'global', code });
    console.warn('[support-slack] reply_sync_error', JSON.stringify({ code }));
    return { available: true, skipped: false, checked: 0, synced: 0, errors };
  }
  const hasConsumerTable = await tableExists(sql, 'consumer_support_messages');
  const hasSyncedLedger = await tableExists(sql, 'support_synced_replies');

  let checked = 0;
  let synced = 0;
  let budgetExhausted = false;

  for (const parent of parents) {
    if (options?.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
      budgetExhausted = true;
      break;
    }
    checked += 1;
    type ThreadMessage = {
      ts?: string;
      thread_ts?: string;
      text?: string;
      subtype?: string;
      bot_id?: string;
      app_id?: string;
    };
    const collectedMessages: ThreadMessage[] = [];
    let threadFetchFailed = false;
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      if (page > 0 && options?.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
        budgetExhausted = true;
        break;
      }
      try {
        const params = new URLSearchParams({
          channel: parent.slack_channel,
          ts: parent.slack_ts,
          limit: '100',
        });
        if (parent.reply_sync_cursor) params.set('oldest', parent.reply_sync_cursor);
        if (cursor) params.set('cursor', cursor);
        const url = `https://slack.com/api/conversations.replies?${params.toString()}`;
        const response = await fetcher(url, {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(4000),
          headers: { Authorization: `Bearer ${config.token}` },
        });
        if (!response.ok) {
          const code = `http_${response.status}`;
          errors.push({ deliveryId: parent.id, code });
          console.warn('[support-slack] reply_sync_http_error', JSON.stringify({ deliveryId: parent.id, code }));
          threadFetchFailed = true;
          break;
        }
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          messages?: ThreadMessage[];
          response_metadata?: { next_cursor?: string };
        };
        if (!data.ok || !Array.isArray(data.messages)) {
          const code = boundErrorCode(data.error, 'slack_replies_error');
          errors.push({ deliveryId: parent.id, code });
          console.warn('[support-slack] reply_sync_api_error', JSON.stringify({ deliveryId: parent.id, code }));
          threadFetchFailed = true;
          break;
        }
        collectedMessages.push(...data.messages);
        const nextCursor = data.response_metadata?.next_cursor?.trim();
        if (!nextCursor) break;
        cursor = nextCursor;
      } catch {
        errors.push({ deliveryId: parent.id, code: 'transport_error' });
        console.warn('[support-slack] reply_sync_transport_error', JSON.stringify({ deliveryId: parent.id }));
        threadFetchFailed = true;
        break;
      }
    }

    let maxCursor = parent.reply_sync_cursor ?? parent.slack_ts;
    let threadInsertErrored = false;

    for (const msg of collectedMessages) {
      if (!msg.ts || !msg.text) continue;
      if (msg.ts === parent.slack_ts || compareSlackTs(msg.ts, parent.slack_ts) <= 0) continue;
      if (parent.reply_sync_cursor && compareSlackTs(msg.ts, parent.reply_sync_cursor) <= 0) continue;
      if (msg.thread_ts !== parent.slack_ts) continue;
      if (msg.bot_id || msg.app_id || msg.subtype === 'bot_message') continue;
      if (msg.subtype && msg.subtype !== 'thread_broadcast') continue;

      const cleaned = msg.text.replace(/^(?:<@[A-Z0-9]+>\s*)+/, '').trim().slice(0, 4000);
      if (!cleaned) continue;

      const messageId = deterministicSlackMessageUuid(parent.slack_channel, msg.ts);
      const sec = Number(msg.ts.split('.')[0]);
      const createdAt =
        Number.isFinite(sec) && sec > 0 ? new Date(Math.floor(sec * 1000)).toISOString() : now.toISOString();

      try {
        if (parent.kind === 'support_message' && parent.organization_id) {
          const inserted = await sql.query<{ id: string }>(
            `insert into brand_support_messages (id, organization_id, body, author_role, created_by, request_id, created_at)
             values ($1, $2, $3, 'studio', $4, $5, $6)
             on conflict do nothing
             returning id::text as id`,
            [messageId, parent.organization_id, cleaned, staffAuthorId, messageId, createdAt],
          );
          if (hasSyncedLedger) {
            await sql.query(
              `insert into support_synced_replies (message_id, delivery_id, slack_channel, slack_ts)
               values ($1, $2, $3, $4)
               on conflict (message_id) do nothing`,
              [messageId, parent.id, parent.slack_channel, msg.ts],
            );
          }
          if (inserted.rows.length > 0) synced += 1;
          if (compareSlackTs(msg.ts, maxCursor) > 0) maxCursor = msg.ts;
        } else if (parent.kind === 'concierge_escalation' && parent.actor_user_id && hasConsumerTable) {
          const inserted = await sql.query<{ id: string }>(
            `insert into consumer_support_messages (id, user_id, author_role, created_by, request_id, body, created_at)
             values ($1, $2, 'studio', $3, $4, $5, $6)
             on conflict do nothing
             returning id::text as id`,
            [messageId, parent.actor_user_id, staffAuthorId, messageId, cleaned, createdAt],
          );
          if (hasSyncedLedger) {
            await sql.query(
              `insert into support_synced_replies (message_id, delivery_id, slack_channel, slack_ts)
               values ($1, $2, $3, $4)
               on conflict (message_id) do nothing`,
              [messageId, parent.id, parent.slack_channel, msg.ts],
            );
          }
          if (inserted.rows.length > 0) synced += 1;
          if (compareSlackTs(msg.ts, maxCursor) > 0) maxCursor = msg.ts;
        }
      } catch (err) {
        threadInsertErrored = true;
        const code = boundErrorCode((err as { code?: string })?.code, 'db_insert_failed');
        errors.push({ deliveryId: parent.id, code });
        console.warn('[support-slack] reply_sync_insert_error', JSON.stringify({ deliveryId: parent.id, code }));
      }
    }

    const syncAtIso = (options?.now ?? new Date()).toISOString();
    const nextSavedCursor =
      !threadFetchFailed && !threadInsertErrored && compareSlackTs(maxCursor, parent.slack_ts) > 0
        ? maxCursor
        : parent.reply_sync_cursor;
    await sql.query(
      `update team_notice_deliveries
          set reply_sync_cursor = coalesce($2, reply_sync_cursor),
              reply_synced_at = $3::timestamptz,
              updated_at = $3::timestamptz
        where id = $1::uuid`,
      [parent.id, nextSavedCursor, syncAtIso],
    );
  }

  return {
    available: true,
    skipped: false,
    checked,
    synced,
    errors,
    ...(budgetExhausted ? { budgetExhausted: true } : {}),
  };
}

/**
 * Posts a reply written by staff in the admin console into the matching Slack thread (when that
 * thread was delivered via `bot` transport and has a stored `slack_ts`), so Slack stays in sync.
 */
export async function mirrorAdminReplyToSlackThread(
  sql: SqlRunner,
  input: {
    targetType: 'brand' | 'consumer';
    organizationId?: string;
    userId?: string;
    deliveryId?: string;
    body: string;
  },
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ mirrored: boolean; code?: string }> {
  const env = options?.env ?? process.env;
  const fetcher = resolveSlackFetcher(options?.fetcher, env);
  if (!fetcher) {
    return { mirrored: false, code: 'test_env_blocked' };
  }
  if (!(await tableExists(sql, 'team_notice_deliveries'))) {
    return { mirrored: false, code: 'table_unavailable' };
  }
  const config = resolveTeamNoticeConfig(env);
  if (config.status !== 'configured' || config.transport !== 'bot') {
    return { mirrored: false, code: config.status === 'configured' ? 'webhook_only' : config.code };
  }

  // F12: deliveryId must strictly belong to the requested target org/user before mirroring.
  const row = input.deliveryId
    ? input.targetType === 'brand' && input.organizationId
      ? (
          await sql.query<{ slack_channel: string | null; slack_ts: string | null }>(
            `select slack_channel, slack_ts
               from team_notice_deliveries
              where id = $1::uuid
                and organization_id = $2::uuid
                and kind = 'support_message'
                and status = 'sent'
                and transport = 'bot'
                and slack_ts is not null`,
            [input.deliveryId, input.organizationId],
          )
        ).rows[0]
      : input.targetType === 'consumer' && input.userId
        ? (
            await sql.query<{ slack_channel: string | null; slack_ts: string | null }>(
              `select slack_channel, slack_ts
                 from team_notice_deliveries
                where id = $1::uuid
                  and actor_user_id = $2::uuid
                  and kind = 'concierge_escalation'
                  and status = 'sent'
                  and transport = 'bot'
                  and slack_ts is not null`,
              [input.deliveryId, input.userId],
            )
          ).rows[0]
        : undefined
    : input.targetType === 'brand' && input.organizationId
      ? (
          await sql.query<{ slack_channel: string | null; slack_ts: string | null }>(
            `select slack_channel, slack_ts
               from team_notice_deliveries
              where organization_id = $1::uuid and kind = 'support_message'
                and status = 'sent' and transport = 'bot' and slack_ts is not null
              order by sent_at desc
              limit 1`,
            [input.organizationId],
          )
        ).rows[0]
      : input.targetType === 'consumer' && input.userId
        ? (
            await sql.query<{ slack_channel: string | null; slack_ts: string | null }>(
              `select slack_channel, slack_ts
                 from team_notice_deliveries
                where actor_user_id = $1::uuid and kind = 'concierge_escalation'
                  and status = 'sent' and transport = 'bot' and slack_ts is not null
                order by sent_at desc
                limit 1`,
              [input.userId],
            )
          ).rows[0]
        : undefined;

  if (!row?.slack_channel || !row.slack_ts) {
    return { mirrored: false, code: 'no_bot_thread' };
  }

  try {
    const response = await fetcher('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(options?.timeoutMs ?? 4500),
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: row.slack_channel,
        thread_ts: row.slack_ts,
        text: `*[관리자 답변]*\n${slackSafe(input.body.trim().slice(0, 1200))}`,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    if (!response.ok) return { mirrored: false, code: `http_${response.status}` };
    const data = (await response.json()) as { ok?: boolean; error?: string };
    return data.ok ? { mirrored: true } : { mirrored: false, code: boundErrorCode(data.error) };
  } catch {
    return { mirrored: false, code: 'transport_error' };
  }
}
