import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { slackSafe } from '@/lib/brand-rooms/team-notice';
import { adminUrl } from '@/lib/seo/site-url';
import {
  deterministicSlackMessageUuid,
  enqueueTeamNotice,
  formatTeamNoticeSlackText,
  mirrorAdminReplyToSlackThread,
  resolveSlackFetcher,
  resolveTeamNoticeConfig,
  runLiveTeamNoticeDeliveryPass,
  runTeamNoticeDeliveryPass,
  sendTeamNoticePayload,
  syncSlackSupportReplies,
  tableExists,
  type TeamNoticeKind,
} from './team-notice-outbox';

export {
  deterministicSlackMessageUuid,
  enqueueTeamNotice,
  mirrorAdminReplyToSlackThread,
  resolveTeamNoticeConfig,
  runLiveTeamNoticeDeliveryPass,
  runTeamNoticeDeliveryPass,
  syncSlackSupportReplies,
};

/**
 * Formats an internal team notice for a new commission (legacy helper + deploy-order fallback).
 * Uses `slackSafe` and `adminUrl('https://admin.twings.app/...')`; never carries email/phone.
 */
export function formatProjectRequestAlert(input: {
  organizationName: string;
  title: string;
  track?: string | null;
  dueOn?: string | null;
  budgetBand?: string | null;
  adminUrl: string;
}): string {
  const flat = (value: string) => slackSafe(value.replace(/\s+/g, ' ').trim().slice(0, 160));
  const lines = [
    `📥 *[TWINGS · 프로젝트 의뢰]*`,
    `• *고객사:* *${flat(input.organizationName)}*`,
    `• *프로젝트:* ${flat(input.title)}`,
  ];
  if (input.track) lines.push(`• *트랙:* \`${flat(input.track)}\``);
  if (input.dueOn) lines.push(`• *납품 희망일:* ${flat(input.dueOn)}`);
  if (input.budgetBand && input.budgetBand !== 'undecided') {
    lines.push(`• *예산대:* \`${flat(input.budgetBand)}\``);
  }
  lines.push(`• *관리자 화면:* ${adminUrl(input.adminUrl)}`);
  return lines.join('\n');
}

/**
 * Deploy-order safe compatibility wrapper for routes/tests calling `notifySlackBrandConcierge`.
 * - When `team_notice_deliveries` exists, flushes the durable outbox row (`runLiveTeamNoticeDeliveryPass`)
 *   for `sourceId = input.messageId` (if not enqueued yet, behaves cleanly without duplicating).
 * - When `team_notice_deliveries` does NOT exist yet (pre-0178 deploy order), sends directly using the
 *   strict dual-transport production config (no auto-discovery, no email, `slackSafe` applied).
 */
function inferFallbackNoticeKind(body: string): TeamNoticeKind {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('[스토리보드 ')) return 'storyboard_approval';
  if (trimmed.startsWith('[리뷰 ')) return 'review_comment';
  if (trimmed.startsWith('[공유 링크 ')) return 'share_guest_note';
  if (trimmed.startsWith('[프로젝트 룸]')) return 'room_message';
  return 'support_message';
}

function unescapeLegacySlack(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function extractFallbackPreviewAndAdminPath(
  body: string,
  defaultAdminPath: string,
  kind: TeamNoticeKind,
): { preview: string; adminPath: string } {
  const match = body.match(/\r?\n관리자 화면:\s*(https?:\/\/[^\s]+)\s*$/);
  const rawPreview = match && match.index !== undefined ? body.slice(0, match.index).trim() : body;
  const preview = match || kind !== 'support_message' ? unescapeLegacySlack(rawPreview) : rawPreview;
  if (!match) return { preview, adminPath: defaultAdminPath };
  try {
    const parsed = new URL(match[1]!);
    return { preview, adminPath: `${parsed.pathname}${parsed.search}${parsed.hash}` || defaultAdminPath };
  } catch {
    return { preview, adminPath: defaultAdminPath };
  }
}

export async function notifySlackBrandConcierge(
  sql: SqlRunner,
  input: {
    organizationId: string;
    userId: string | null;
    body: string;
    messageId: string;
    kind?: TeamNoticeKind;
    sender?: { label: string; role: string } | null;
  },
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean; ts?: string; channelId?: string }> {
  const env = options?.env ?? process.env;
  if (await tableExists(sql, 'team_notice_deliveries')) {
    const existing = input.messageId
      ? (
          await sql.query<{ id: string }>(
            'select id::text as id from team_notice_deliveries where source_id = $1::uuid limit 1',
            [input.messageId],
          )
        ).rows[0]
      : undefined;
    if (existing) {
      const report = await runLiveTeamNoticeDeliveryPass(sql, {
        deliveryId: existing.id,
        env,
        fetcher: options?.fetcher,
      });
      return { sent: report.sent > 0 };
    }
  }

  if (!resolveSlackFetcher(options?.fetcher, env)) {
    return { sent: false };
  }
  const config = resolveTeamNoticeConfig(env);
  if (config.status !== 'configured') return { sent: false };

  try {
    const orgRow = (
      await sql.query<{ name: string }>('select name from brand_organizations where id = $1', [
        input.organizationId,
      ])
    ).rows[0];
    const profileRow = input.userId
      ? (
          await sql.query<{ display_name: string | null }>(
            'select display_name from profiles where id = $1',
            [input.userId],
          )
        ).rows[0]
      : undefined;
    const effectiveKind = input.kind ?? inferFallbackNoticeKind(input.body);
    const defaultAdminPath = `/admin/brand-workspace/organizations/${input.organizationId}#support`;
    const { preview, adminPath } = extractFallbackPreviewAndAdminPath(
      input.body,
      defaultAdminPath,
      effectiveKind,
    );
    const rawActorName = input.sender?.label ?? profileRow?.display_name ?? null;
    const actorDisplayName =
      rawActorName && (effectiveKind !== 'support_message' || input.sender?.role === '공유 링크 외부인')
        ? unescapeLegacySlack(rawActorName)
        : rawActorName;

    const text = formatTeamNoticeSlackText({
      kind: effectiveKind,
      organizationName: orgRow?.name ?? 'Brand Client',
      actorDisplayName,
      noticeReference: (input.messageId || randomUUID()).slice(0, 8),
      preview,
      adminPath,
      transport: config.transport,
    });
    const outcome = await sendTeamNoticePayload(config, text, {
      fetcher: options?.fetcher,
      timeoutMs: options?.timeoutMs,
      env,
    });
    return {
      sent: outcome.status === 'sent',
      ...(outcome.status === 'sent' && outcome.slackTs ? { ts: outcome.slackTs } : {}),
      ...(outcome.status === 'sent' && outcome.slackChannel ? { channelId: outcome.slackChannel } : {}),
    };
  } catch {
    return { sent: false };
  }
}

/**
 * Deploy-order safe compatibility wrapper for project request alerts.
 * Flushes the durable outbox row when 0178 exists, or falls back safely under strict dual-transport rules.
 */
export async function notifySlackBrandProjectRequest(
  sql: SqlRunner,
  input: {
    organizationId: string;
    projectId: string;
    title: string;
    track?: string | null;
    dueOn?: string | null;
    budgetBand?: string | null;
  },
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean; ts?: string; channelId?: string }> {
  const env = options?.env ?? process.env;
  if (await tableExists(sql, 'team_notice_deliveries')) {
    const existing = (
      await sql.query<{ id: string }>(
        "select id::text as id from team_notice_deliveries where kind = 'project_request' and source_id = $1::uuid limit 1",
        [input.projectId],
      )
    ).rows[0];
    if (existing) {
      const report = await runLiveTeamNoticeDeliveryPass(sql, {
        deliveryId: existing.id,
        env,
        fetcher: options?.fetcher,
      });
      return { sent: report.sent > 0 };
    }
  }

  if (!resolveSlackFetcher(options?.fetcher, env)) {
    return { sent: false };
  }
  const config = resolveTeamNoticeConfig(env);
  if (config.status !== 'configured') return { sent: false };

  try {
    const orgRow = (
      await sql.query<{ name: string }>('select name from brand_organizations where id = $1', [
        input.organizationId,
      ])
    ).rows[0];
    const path = `/admin/brand-rooms/${encodeURIComponent(input.organizationId)}?channel=${encodeURIComponent(
      input.projectId,
    )}`;
    const text = formatProjectRequestAlert({
      organizationName: orgRow?.name ?? 'Brand Client',
      title: input.title,
      track: input.track ?? null,
      dueOn: input.dueOn ?? null,
      budgetBand: input.budgetBand ?? null,
      adminUrl: adminUrl(path),
    });
    const outcome = await sendTeamNoticePayload(config, text, {
      fetcher: options?.fetcher,
      timeoutMs: options?.timeoutMs,
      env,
    });
    return {
      sent: outcome.status === 'sent',
      ...(outcome.status === 'sent' && outcome.slackTs ? { ts: outcome.slackTs } : {}),
      ...(outcome.status === 'sent' && outcome.slackChannel ? { channelId: outcome.slackChannel } : {}),
    };
  } catch {
    return { sent: false };
  }
}

export async function syncSlackConciergeReplies(
  sql: SqlRunner,
  organizationId?: string,
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    force?: boolean;
  },
): Promise<number> {
  const result = await syncSlackSupportReplies(sql, {
    organizationId,
    env: options?.env,
    fetcher: options?.fetcher,
    force: options?.force,
  });
  return result.synced;
}
