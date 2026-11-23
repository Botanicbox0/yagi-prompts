import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  resolveTeamNoticeConfig,
  tableExists,
  type TeamNoticeConfig,
  type TeamNoticeKind,
  type TeamNoticeStatus,
  type TeamNoticeTransport,
} from './team-notice-outbox';

export interface TeamNoticeInboxItem {
  id: string;
  kind: TeamNoticeKind;
  organizationId: string | null;
  organizationName: string | null;
  sourceTable: string;
  sourceId: string;
  surface: string;
  actorUserId: string | null;
  actorName: string | null;
  preview: string;
  adminPath: string;
  status: TeamNoticeStatus;
  transport: TeamNoticeTransport | null;
  attempts: number;
  lastErrorCode: string | null;
  slackChannel: string | null;
  slackTs: string | null;
  sentAt: string | null;
  createdAt: string;
  awaitingReply: boolean;
  replySyncMode: 'bot_sync' | 'admin_only';
  latestStaffReply: string | null;
  latestStaffReplyAt: string | null;
}

export interface TeamNoticeInboxData {
  available: boolean;
  rows: TeamNoticeInboxItem[];
  failedCount: number;
  awaitingCount: number;
  pendingWaitingCount: number;
  totalFiltered: number;
  page: number;
  totalPages: number;
  runtimeConfig: TeamNoticeConfig;
}

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/**
 * Loads the unified team notice & support delivery inbox for `/admin/inquiries`.
 * Safe when 0178 has not been applied yet (`available: false`, zero queries on missing tables).
 */
export async function loadTeamNoticeInbox(
  sql: SqlRunner | null,
  options?: {
    noticeKind?: 'all' | TeamNoticeKind;
    deliveryStatus?: 'all' | 'sent' | 'pending' | 'failed' | 'skipped';
    awaitingOnly?: boolean;
    query?: string;
    page?: number;
    pageSize?: number;
    limit?: number;
    env?: Record<string, string | undefined>;
  },
): Promise<TeamNoticeInboxData> {
  const runtimeConfig = resolveTeamNoticeConfig(options?.env ?? process.env);
  if (!sql || typeof sql.query !== 'function' || !(await tableExists(sql, 'team_notice_deliveries'))) {
    return {
      available: false,
      rows: [],
      failedCount: 0,
      awaitingCount: 0,
      pendingWaitingCount: 0,
      totalFiltered: 0,
      page: 1,
      totalPages: 1,
      runtimeConfig,
    };
  }

  const hasConsumerTable = await tableExists(sql, 'consumer_support_messages');
  const pageSize = Math.max(1, Math.min(200, Math.floor(options?.pageSize ?? options?.limit ?? 50)));
  const requestedPage = Math.max(1, Math.floor(options?.page ?? 1));

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.noticeKind && options.noticeKind !== 'all') {
    params.push(options.noticeKind);
    conditions.push(`d.kind = $${params.length}`);
  }
  if (options?.deliveryStatus && options.deliveryStatus !== 'all') {
    if (options.deliveryStatus === 'pending') {
      conditions.push(`d.status in ('pending', 'sending')`);
    } else {
      params.push(options.deliveryStatus);
      conditions.push(`d.status = $${params.length}`);
    }
  }
  if (options?.awaitingOnly) {
    const consumerClause = hasConsumerTable
      ? `or (d.kind = 'concierge_escalation' and d.actor_user_id is not null and (
            select c.author_role
              from consumer_support_messages c
             where c.user_id = d.actor_user_id
             order by c.created_at desc, c.id desc
             limit 1
          ) = 'customer')`
      : '';
    conditions.push(
      `(
        (d.kind = 'support_message' and d.organization_id is not null and (
          select m.author_role
            from brand_support_messages m
           where m.organization_id = d.organization_id
           order by m.created_at desc, m.id desc
           limit 1
        ) = 'brand')
        ${consumerClause}
      )`,
    );
  }
  const q = (options?.query ?? '').trim();
  if (q) {
    const escaped = q.replace(/[!%_]/g, '!$&');
    params.push(`%${escaped}%`);
    const pIdx = `$${params.length}`;
    conditions.push(
      `(
        coalesce(o.name, '') ilike ${pIdx} escape '!'
        or coalesce(p.display_name, '') ilike ${pIdx} escape '!'
        or coalesce(d.actor_label, '') ilike ${pIdx} escape '!'
        or coalesce(d.preview, '') ilike ${pIdx} escape '!'
        or coalesce(d.surface, '') ilike ${pIdx} escape '!'
        or d.kind ilike ${pIdx} escape '!'
        or coalesce(d.last_error_code, '') ilike ${pIdx} escape '!'
        or d.source_id::text ilike ${pIdx} escape '!'
      )`,
    );
  }

  const whereSql = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  const totalFiltered = Number(
    (
      await sql.query<{ n: number }>(
        `select count(*)::int as n
           from team_notice_deliveries d
           left join brand_organizations o on o.id = d.organization_id
           left join profiles p on p.id = d.actor_user_id
          ${whereSql}`,
        params,
      )
    ).rows[0]?.n ?? 0,
  );
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const { rows: rawRows } = await sql.query<{
    id: string;
    kind: TeamNoticeKind;
    organization_id: string | null;
    organization_name: string | null;
    source_table: string;
    source_id: string;
    surface: string;
    actor_user_id: string | null;
    actor_display_name: string | null;
    actor_label: string;
    preview: string;
    admin_path: string;
    status: TeamNoticeStatus;
    transport: TeamNoticeTransport | null;
    attempts: number;
    last_error_code: string | null;
    slack_channel: string | null;
    slack_ts: string | null;
    sent_at: Date | string | null;
    created_at: Date | string;
  }>(
    `select d.id::text as id, d.kind, d.organization_id::text as organization_id,
            o.name as organization_name, d.source_table, d.source_id::text as source_id,
            d.surface, d.actor_user_id::text as actor_user_id, p.display_name as actor_display_name,
            d.actor_label, d.preview, d.admin_path, d.status, d.transport, d.attempts,
            d.last_error_code, d.slack_channel, d.slack_ts, d.sent_at, d.created_at
       from team_notice_deliveries d
       left join brand_organizations o on o.id = d.organization_id
       left join profiles p on p.id = d.actor_user_id
      ${whereSql}
      order by d.created_at desc, d.id desc
      limit $${limitIdx}::int offset $${offsetIdx}::int`,
    [...params, pageSize, offset],
  );

  const countRow = (
    await sql.query<{ failed_count: number; pending_waiting_count: number }>(
      `select coalesce(sum(case when status = 'failed' then 1 else 0 end), 0)::int as failed_count,
              coalesce(sum(case when status in ('pending', 'sending') then 1 else 0 end), 0)::int as pending_waiting_count
         from team_notice_deliveries`,
    )
  ).rows[0];
  const failedCount = Number(countRow?.failed_count ?? 0);
  const pendingWaitingCount = Number(countRow?.pending_waiting_count ?? 0);

  const brandLatestMap = new Map<string, { role: string; body: string; createdAt: string }>();
  const brandOrgIds = [
    ...new Set(
      rawRows
        .filter((r) => r.kind === 'support_message' && r.organization_id)
        .map((r) => r.organization_id!),
    ),
  ];
  if (brandOrgIds.length > 0) {
    const { rows: brandMsgs } = await sql.query<{
      organization_id: string;
      author_role: string;
      body: string;
      created_at: Date | string;
    }>(
      `select distinct on (organization_id)
              organization_id::text as organization_id, author_role, body, created_at
         from brand_support_messages
        where organization_id = any($1::uuid[])
        order by organization_id, created_at desc, id desc`,
      [brandOrgIds],
    );
    for (const m of brandMsgs) {
      brandLatestMap.set(m.organization_id, {
        role: m.author_role,
        body: m.body,
        createdAt: iso(m.created_at),
      });
    }
  }

  const consumerLatestMap = new Map<string, { role: string; body: string; createdAt: string }>();
  if (hasConsumerTable) {
    const consumerIds = [
      ...new Set(
        rawRows
          .filter((r) => r.kind === 'concierge_escalation' && r.actor_user_id)
          .map((r) => r.actor_user_id!),
      ),
    ];
    if (consumerIds.length > 0) {
      const { rows: consumerMsgs } = await sql.query<{
        user_id: string;
        author_role: string;
        body: string;
        created_at: Date | string;
      }>(
        `select distinct on (user_id)
                user_id::text as user_id, author_role, body, created_at
           from consumer_support_messages
          where user_id = any($1::uuid[])
          order by user_id, created_at desc, id desc`,
        [consumerIds],
      );
      for (const m of consumerMsgs) {
        consumerLatestMap.set(m.user_id, {
          role: m.author_role,
          body: m.body,
          createdAt: iso(m.created_at),
        });
      }
    }
  }

  const brandWaitingTotal = Number(
    (
      await sql.query<{ n: number }>(
        `select count(*)::int as n
           from (select distinct on (organization_id) organization_id, author_role
                   from brand_support_messages
                  order by organization_id, created_at desc, id desc) t
          where t.author_role = 'brand'`,
      )
    ).rows[0]?.n ?? 0,
  );
  const consumerWaitingTotal = hasConsumerTable
    ? Number(
        (
          await sql.query<{ n: number }>(
            `select count(*)::int as n
               from (select distinct on (user_id) user_id, author_role
                       from consumer_support_messages
                      order by user_id, created_at desc, id desc) t
              where t.author_role = 'customer'`,
          )
        ).rows[0]?.n ?? 0,
      )
    : 0;
  const awaitingCount = brandWaitingTotal + consumerWaitingTotal;

  const items: TeamNoticeInboxItem[] = [];

  for (const r of rawRows) {
    const actorName = r.actor_display_name?.trim() || r.actor_label?.trim() || null;
    let awaitingReply = false;
    let latestStaffReply: string | null = null;
    let latestStaffReplyAt: string | null = null;

    if (r.kind === 'support_message' && r.organization_id) {
      const latest = brandLatestMap.get(r.organization_id);
      if (latest) {
        awaitingReply = latest.role === 'brand';
        if (latest.role === 'studio') {
          latestStaffReply = latest.body;
          latestStaffReplyAt = latest.createdAt;
        }
      }
    } else if (r.kind === 'concierge_escalation' && r.actor_user_id) {
      const latest = consumerLatestMap.get(r.actor_user_id);
      if (latest) {
        awaitingReply = latest.role === 'customer';
        if (latest.role === 'studio') {
          latestStaffReply = latest.body;
          latestStaffReplyAt = latest.createdAt;
        }
      }
    }

    const replySyncMode: 'bot_sync' | 'admin_only' =
      r.transport === 'bot' && Boolean(r.slack_ts) ? 'bot_sync' : 'admin_only';

    items.push({
      id: r.id,
      kind: r.kind,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      sourceTable: r.source_table,
      sourceId: r.source_id,
      surface: r.surface,
      actorUserId: r.actor_user_id,
      actorName,
      preview: r.preview,
      adminPath: r.admin_path,
      status: r.status,
      transport: r.transport,
      attempts: Number(r.attempts),
      lastErrorCode: r.last_error_code,
      slackChannel: r.slack_channel,
      slackTs: r.slack_ts,
      sentAt: r.sent_at ? iso(r.sent_at) : null,
      createdAt: iso(r.created_at),
      awaitingReply,
      replySyncMode,
      latestStaffReply,
      latestStaffReplyAt,
    });
  }

  return {
    available: true,
    rows: items,
    failedCount,
    awaitingCount,
    pendingWaitingCount,
    totalFiltered,
    page,
    totalPages,
    runtimeConfig,
  };
}

/** Reports per-organization support thread sync posture for `/admin/brand-workspace/organizations/[id]`. */
export async function loadOrganizationSupportSyncMode(
  sql: SqlRunner | null,
  organizationId: string,
): Promise<{ available: boolean; mode: 'bot_sync' | 'admin_only'; runtime: TeamNoticeConfig }> {
  const runtime = resolveTeamNoticeConfig(process.env);
  if (!sql || typeof sql.query !== 'function' || !(await tableExists(sql, 'team_notice_deliveries'))) {
    return {
      available: false,
      mode: runtime.status === 'configured' && runtime.transport === 'bot' ? 'bot_sync' : 'admin_only',
      runtime,
    };
  }
  const latest = (
    await sql.query<{ transport: string | null; slack_ts: string | null }>(
      `select transport, slack_ts
         from team_notice_deliveries
        where organization_id = $1::uuid and kind = 'support_message' and status = 'sent'
        order by sent_at desc
        limit 1`,
      [organizationId],
    )
  ).rows[0];
  const mode: 'bot_sync' | 'admin_only' = latest
    ? latest.transport === 'bot' && Boolean(latest.slack_ts)
      ? 'bot_sync'
      : 'admin_only'
    : runtime.status === 'configured' && runtime.transport === 'bot'
      ? 'bot_sync'
      : 'admin_only';
  return { available: true, mode, runtime };
}
