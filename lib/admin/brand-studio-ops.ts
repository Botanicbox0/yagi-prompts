import type { Viewer } from '@/lib/auth/identity';
import { LANE_HEARTBEAT_MAX_AGE_MS } from '@/lib/brand-studio/lanes';
import { STUDIO_JOB_KINDS, type StudioJobKind } from '@/lib/brand-studio/contracts';
import { STUDIO_LANES, type StudioLane } from '@/lib/brand-studio/models';
import { hasTable, hasTables } from '@/lib/brands/billing/schema-guard';
import {
  deterministicNoticeSourceId,
  enqueueTeamNotice,
  opsAlertKindAllowed,
} from '@/lib/brands/team-notice-outbox';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { escapeLike, firstParam, isDbAdmin, iso } from './brand-ops-guard';

export const STUDIO_ALERT_WINDOW_MINUTES = 30;
export const STUDIO_ALERT_MIN_FAILURES = 5;
export const STUDIO_ALERT_FAILURE_RATE_THRESHOLD = 0.5;
export const STUDIO_LANE_STALE_ALERT_MINUTES = 15;
export const STUDIO_ALERT_COOLDOWN_MINUTES = 60;
export const STUDIO_OPS_PAGE_SIZE = 50;

export const STUDIO_OPS_ALERT_SURFACES = {
  massFailure: 'ops_alert:mass_failure',
  laneStale: 'ops_alert:lane_stale',
} as const;

export interface StudioOpsFilter {
  kind: StudioJobKind | null;
  lane: StudioLane | 'held' | null;
  errorCode: string;
  query: string;
  page: number;
}

export interface StudioLaneStatusRow {
  lane: StudioLane | 'held';
  runningCount: number;
  queuedCount: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeSeconds: number | null;
  seenAt: string | null;
  heartbeatAgeSeconds: number | null;
  closedUntil: string | null;
  stale: boolean;
  info: Record<string, unknown> | null;
}

export interface StudioFailedJobRow {
  id: string;
  organizationId: string;
  organizationName: string;
  createdAt: string;
  finishedAt: string | null;
  kind: string;
  model: string;
  lane: StudioLane | null;
  errorCode: string | null;
  errorDetail: string | null;
  estimateKrw: number;
  usageKrw: number | null;
  returnedKrw: number;
}

export interface BrandStudioOpsData {
  available: boolean;
  hourlyStats: {
    finished1h: number;
    failed1h: number;
    succeeded1h: number;
    failureRate1h: number | null;
    failed24h: number;
  };
  accountLaneStale: boolean;
  lanes: StudioLaneStatusRow[];
  failedJobs: StudioFailedJobRow[];
  failedTotal7d: number;
  failedFilteredTotal: number;
  availableErrorCodes: string[];
}

export function studioOpsFilter(params: Record<string, string | string[] | undefined>): StudioOpsFilter {
  const rawKind = firstParam(params.kind);
  const rawLane = firstParam(params.lane);
  const rawError = firstParam(params.errorCode).trim().slice(0, 80);
  const rawQuery = firstParam(params.q).trim().slice(0, 120);
  const rawPage = Number.parseInt(firstParam(params.page), 10);
  return {
    kind: (STUDIO_JOB_KINDS as readonly string[]).includes(rawKind) ? (rawKind as StudioJobKind) : null,
    lane:
      rawLane === 'held' || (STUDIO_LANES as readonly string[]).includes(rawLane)
        ? (rawLane as StudioLane | 'held')
        : null,
    errorCode: rawError,
    query: rawQuery,
    page: Number.isFinite(rawPage) && rawPage > 1 ? Math.min(rawPage, 10_000) : 1,
  };
}

export function studioOpsHref(
  current: StudioOpsFilter,
  patch: Partial<{
    kind: StudioJobKind | null;
    lane: StudioLane | 'held' | null;
    errorCode: string;
    query: string;
    page: number;
  }> = {},
): string {
  const next: StudioOpsFilter = {
    kind: 'kind' in patch ? (patch.kind ?? null) : current.kind,
    lane: 'lane' in patch ? (patch.lane ?? null) : current.lane,
    errorCode: 'errorCode' in patch ? (patch.errorCode ?? '') : current.errorCode,
    query: 'query' in patch ? (patch.query ?? '') : current.query,
    page: 'page' in patch ? (patch.page ?? 1) : 1,
  };
  const sp = new URLSearchParams();
  if (next.kind) sp.set('kind', next.kind);
  if (next.lane) sp.set('lane', next.lane);
  if (next.errorCode) sp.set('errorCode', next.errorCode);
  if (next.query) sp.set('q', next.query);
  if (next.page > 1) sp.set('page', String(next.page));
  const qs = sp.toString();
  return qs ? `/admin/brand-studio?${qs}` : '/admin/brand-studio';
}

/**
 * Pure detector for account-lane worker staleness.
 * Never flags an idle lane or transient short wait: always requires at least one queued/held
 * job waiting at least `minWaitingMs` (default 15 minutes) AND a missing or stale heartbeat
 * (`now - seenAt > maxAgeMs`, default `LANE_HEARTBEAT_MAX_AGE_MS` = 90 s).
 */
export function isAccountLaneStale(
  seenAt: Date | null,
  now: Date,
  options: {
    waitingCount?: number;
    oldestWaitingAt?: Date | null;
    maxAgeMs?: number;
    minWaitingMs?: number;
  } = {},
): boolean {
  const waitingCount = options.waitingCount ?? 0;
  if (waitingCount <= 0) return false;
  if (!options.oldestWaitingAt) return false;

  const minWaitingMs = options.minWaitingMs ?? STUDIO_LANE_STALE_ALERT_MINUTES * 60_000;
  if (now.getTime() - options.oldestWaitingAt.getTime() < minWaitingMs) return false;

  if (seenAt === null) return true;
  const maxAgeMs = options.maxAgeMs ?? LANE_HEARTBEAT_MAX_AGE_MS;
  const age = now.getTime() - seenAt.getTime();
  return age < -5_000 || age > maxAgeMs;
}

const asDate = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Loads cross-organization brand studio operations: 1h failure rate, 24h failures, per-lane
 * running/queued counts + oldest queued age + account-lane heartbeat, and 7-day failed job queue.
 */
export async function loadBrandStudioOps(
  sql: SqlRunner,
  viewer: Viewer,
  filter: StudioOpsFilter,
  now: Date = new Date(),
): Promise<BrandStudioOpsData | null> {
  if (!(await isDbAdmin(sql, viewer))) return null;

  const jobsReady = await hasTable(sql, 'brand_studio_jobs');
  if (!jobsReady) {
    return {
      available: false,
      hourlyStats: { finished1h: 0, failed1h: 0, succeeded1h: 0, failureRate1h: null, failed24h: 0 },
      accountLaneStale: false,
      lanes: [],
      failedJobs: [],
      failedTotal7d: 0,
      failedFilteredTotal: 0,
      availableErrorCodes: [],
    };
  }

  const lanesReady = await hasTable(sql, 'brand_studio_lanes');
  const nowIso = now.toISOString();
  const oneHourAgoIso = new Date(now.getTime() - 3_600_000).toISOString();
  const oneDayAgoIso = new Date(now.getTime() - 86_400_000).toISOString();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const whereParts = ["j.status = 'failed'", 'coalesce(j.finished_at, j.created_at) >= $1::timestamptz'];
  const params: unknown[] = [sevenDaysAgoIso];

  if (filter.kind) {
    params.push(filter.kind);
    whereParts.push(`j.kind = $${params.length}`);
  }
  if (filter.lane === 'held') {
    whereParts.push('j.lane is null');
  } else if (filter.lane) {
    params.push(filter.lane);
    whereParts.push(`j.lane = $${params.length}`);
  }
  if (filter.errorCode) {
    params.push(filter.errorCode);
    whereParts.push(`coalesce(j.error_code, 'unknown') = $${params.length}`);
  }
  if (filter.query.trim() !== '') {
    params.push(`%${escapeLike(filter.query.trim())}%`);
    const pIdx = `$${params.length}`;
    whereParts.push(
      `(o.name ilike ${pIdx} escape '!' or j.model ilike ${pIdx} escape '!' or coalesce(j.error_detail, '') ilike ${pIdx} escape '!' or j.id::text ilike ${pIdx} escape '!')`,
    );
  }
  const whereSql = `where ${whereParts.join(' and ')}`;
  const offset = (Math.max(1, Math.floor(filter.page)) - 1) * STUDIO_OPS_PAGE_SIZE;

  const [
    hourlyRes,
    laneActiveRes,
    laneHeartbeatsRes,
    errorCodesRes,
    failed7dRes,
    failedFilteredCountRes,
    failedRowsRes,
  ] = await Promise.all([
    sql.query<{
      finished_1h: number;
      failed_1h: number;
      succeeded_1h: number;
      failed_24h: number;
    }>(
      `select
         count(*) filter (where status in ('succeeded', 'failed') and coalesce(finished_at, created_at) >= $1::timestamptz)::int as finished_1h,
         count(*) filter (where status = 'failed' and coalesce(finished_at, created_at) >= $1::timestamptz)::int as failed_1h,
         count(*) filter (where status = 'succeeded' and coalesce(finished_at, created_at) >= $1::timestamptz)::int as succeeded_1h,
         count(*) filter (where status = 'failed' and coalesce(finished_at, created_at) >= $2::timestamptz)::int as failed_24h
       from brand_studio_jobs`,
      [oneHourAgoIso, oneDayAgoIso],
    ),
    sql.query<{
      lane_key: string;
      running_count: number;
      queued_count: number;
      oldest_queued_at: unknown;
    }>(
      `select
         coalesce(lane, 'held') as lane_key,
         count(*) filter (where status in ('running', 'finishing'))::int as running_count,
         count(*) filter (where status in ('queued', 'held'))::int as queued_count,
         min(created_at) filter (where status in ('queued', 'held')) as oldest_queued_at
       from brand_studio_jobs
      where status in ('held', 'queued', 'running', 'finishing')
      group by coalesce(lane, 'held')`,
    ),
    lanesReady
      ? sql.query<{ lane: string; seen_at: unknown; info: Record<string, unknown> | null }>(
          'select lane, seen_at, info from brand_studio_lanes',
        )
      : Promise.resolve({ rows: [] }),
    sql.query<{ code: string }>(
      `select distinct coalesce(error_code, 'unknown') as code
         from brand_studio_jobs
        where status = 'failed' and coalesce(finished_at, created_at) >= $1::timestamptz
        order by code asc`,
      [sevenDaysAgoIso],
    ),
    sql.query<{ n: number }>(
      `select count(*)::int as n
         from brand_studio_jobs
        where status = 'failed' and coalesce(finished_at, created_at) >= $1::timestamptz`,
      [sevenDaysAgoIso],
    ),
    sql.query<{ n: number }>(
      `select count(*)::int as n
         from brand_studio_jobs j
         join brand_organizations o on o.id = j.organization_id
        ${whereSql}`,
      params,
    ),
    sql.query<{
      id: string;
      organization_id: string;
      organization_name: string;
      created_at: unknown;
      finished_at: unknown;
      kind: string;
      model: string;
      lane: string | null;
      error_code: string | null;
      error_detail: string | null;
      estimate_krw: number;
      usage_krw: number | null;
    }>(
      `select j.id::text as id, j.organization_id::text as organization_id, o.name as organization_name,
              j.created_at, j.finished_at, j.kind, j.model, j.lane,
              j.error_code, j.error_detail, j.estimate_krw, j.usage_krw
         from brand_studio_jobs j
         join brand_organizations o on o.id = j.organization_id
        ${whereSql}
        order by coalesce(j.finished_at, j.created_at) desc, j.id desc
        limit $${params.length + 1}::int offset $${params.length + 2}::int`,
      [...params, STUDIO_OPS_PAGE_SIZE, offset],
    ),
  ]);

  const hr = hourlyRes.rows[0];
  const finished1h = Number(hr?.finished_1h ?? 0);
  const failed1h = Number(hr?.failed_1h ?? 0);
  const succeeded1h = Number(hr?.succeeded_1h ?? 0);
  const failed24h = Number(hr?.failed_24h ?? 0);

  const activeMap = new Map<
    string,
    { runningCount: number; queuedCount: number; oldestQueuedAt: Date | null }
  >();
  for (const r of laneActiveRes.rows) {
    activeMap.set(String(r.lane_key), {
      runningCount: Number(r.running_count ?? 0),
      queuedCount: Number(r.queued_count ?? 0),
      oldestQueuedAt: asDate(r.oldest_queued_at),
    });
  }

  const hbMap = new Map<string, { seenAt: Date | null; info: Record<string, unknown> | null }>();
  for (const r of laneHeartbeatsRes.rows) {
    hbMap.set(String(r.lane), {
      seenAt: asDate(r.seen_at),
      info: r.info && typeof r.info === 'object' ? r.info : null,
    });
  }

  const heldEntry = activeMap.get('held');
  const mcpEntry = activeMap.get('sunra_mcp');
  const mcpHb = hbMap.get('sunra_mcp');
  const mcpWaiting = (mcpEntry?.queuedCount ?? 0) + (heldEntry?.queuedCount ?? 0);
  const oldestMcpOrHeld =
    [mcpEntry?.oldestQueuedAt ?? null, heldEntry?.oldestQueuedAt ?? null]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const accountLaneStale = isAccountLaneStale(mcpHb?.seenAt ?? null, now, {
    waitingCount: mcpWaiting,
    oldestWaitingAt: oldestMcpOrHeld,
  });

  const lanes: StudioLaneStatusRow[] = (['sunra_api', 'sunra_mcp', 'held'] as const).map((laneKey) => {
    const active = activeMap.get(laneKey);
    const hb = hbMap.get(laneKey);
    const seenAt = hb?.seenAt ?? null;
    const closedRaw = typeof hb?.info?.closedUntil === 'string' ? hb.info.closedUntil : null;
    const closedDate = closedRaw ? asDate(closedRaw) : null;
    const closedActive = closedDate !== null && closedDate.getTime() > now.getTime();
    const oldest = active?.oldestQueuedAt ?? null;
    const oldestQueuedAgeSeconds = oldest ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000)) : null;
    const heartbeatAgeSeconds = seenAt ? Math.max(0, Math.floor((now.getTime() - seenAt.getTime()) / 1000)) : null;

    return {
      lane: laneKey,
      runningCount: active?.runningCount ?? 0,
      queuedCount: active?.queuedCount ?? 0,
      oldestQueuedAt: oldest ? oldest.toISOString() : null,
      oldestQueuedAgeSeconds,
      seenAt: seenAt ? seenAt.toISOString() : null,
      heartbeatAgeSeconds,
      closedUntil: closedActive && closedDate ? closedDate.toISOString() : null,
      stale: laneKey === 'sunra_mcp' ? accountLaneStale : false,
      info: hb?.info ?? null,
    };
  });

  const failedJobs: StudioFailedJobRow[] = failedRowsRes.rows.map((r) => {
    const estimateKrw = Number(r.estimate_krw ?? 0);
    const usageKrw = r.usage_krw === null || r.usage_krw === undefined ? null : Number(r.usage_krw);
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      organizationName: String(r.organization_name),
      createdAt: iso(r.created_at) ?? nowIso,
      finishedAt: iso(r.finished_at),
      kind: String(r.kind),
      model: String(r.model),
      lane: (r.lane as StudioLane | null) ?? null,
      errorCode: r.error_code ? String(r.error_code) : null,
      errorDetail: r.error_detail ? String(r.error_detail) : null,
      estimateKrw,
      usageKrw,
      returnedKrw: Math.max(0, estimateKrw - (usageKrw ?? 0)),
    };
  });

  return {
    available: true,
    hourlyStats: {
      finished1h,
      failed1h,
      succeeded1h,
      failureRate1h: finished1h > 0 ? failed1h / finished1h : null,
      failed24h,
    },
    accountLaneStale,
    lanes,
    failedJobs,
    failedTotal7d: Number(failed7dRes.rows[0]?.n ?? 0),
    failedFilteredTotal: Number(failedFilteredCountRes.rows[0]?.n ?? 0),
    availableErrorCodes: errorCodesRes.rows.map((r) => String(r.code)),
  };
}

export interface StudioOpsAlertResult {
  available: boolean;
  kindAllowed: boolean;
  enqueued: Array<'mass_failure' | 'lane_stale'>;
  skippedCooldown: Array<'mass_failure' | 'lane_stale'>;
  massFailure: { failed: number; total: number; rate: number } | null;
  laneStale: { staleMinutes: number | null; waitingCount: number } | null;
}

/**
 * Evaluates aggregate brand-studio health for the 10-minute cron (`/api/brand-rooms/notices/tick`):
 *   1. Mass failure: >= 5 failures AND >= 50% failure rate in the last 30 minutes.
 *   2. Account lane stale: `sunra_mcp` worker stale >= 15 minutes while jobs wait (`queued` on
 *      `sunra_mcp` or `held`).
 *
 * Enqueues at most ONE `ops_alert` per alert type with a 60-minute cooldown, carrying counts only
 * (zero organization names, IDs, or customer data). Skips quietly when pre-0180 schema does not
 * yet permit `'ops_alert'`.
 */
export async function runBrandStudioOpsAlertPass(
  sql: SqlRunner,
  now: Date = new Date(),
): Promise<StudioOpsAlertResult> {
  const ready = await hasTables(sql, ['brand_studio_jobs', 'brand_studio_lanes', 'team_notice_deliveries']);
  if (!ready) {
    return {
      available: false,
      kindAllowed: false,
      enqueued: [],
      skippedCooldown: [],
      massFailure: null,
      laneStale: null,
    };
  }

  const kindAllowed = await opsAlertKindAllowed(sql);
  if (!kindAllowed) {
    return {
      available: true,
      kindAllowed: false,
      enqueued: [],
      skippedCooldown: [],
      massFailure: null,
      laneStale: null,
    };
  }

  const enqueued: Array<'mass_failure' | 'lane_stale'> = [];
  const skippedCooldown: Array<'mass_failure' | 'lane_stale'> = [];

  const windowStartIso = new Date(now.getTime() - STUDIO_ALERT_WINDOW_MINUTES * 60_000).toISOString();
  const cooldownStartIso = new Date(now.getTime() - STUDIO_ALERT_COOLDOWN_MINUTES * 60_000).toISOString();
  const staleThresholdMs = STUDIO_LANE_STALE_ALERT_MINUTES * 60_000;

  const [failStatsRes, laneRes, waitingRes, cooldownRes] = await Promise.all([
    sql.query<{ failed_n: number; finished_n: number }>(
      `select
         count(*) filter (where status = 'failed')::int as failed_n,
         count(*) filter (where status in ('succeeded', 'failed'))::int as finished_n
       from brand_studio_jobs
      where coalesce(finished_at, created_at) >= $1::timestamptz`,
      [windowStartIso],
    ),
    sql.query<{ seen_at: unknown }>("select seen_at from brand_studio_lanes where lane = 'sunra_mcp' limit 1"),
    sql.query<{ waiting_n: number; oldest_waiting_at: unknown }>(
      `select count(*)::int as waiting_n, min(created_at) as oldest_waiting_at
         from brand_studio_jobs
        where (lane = 'sunra_mcp' and status = 'queued')
           or (lane is null and status = 'held')`,
    ),
    sql.query<{ surface: string }>(
      `select distinct surface
         from team_notice_deliveries
        where kind = 'ops_alert'
          and surface in ($1, $2)
          and created_at > $3::timestamptz`,
      [STUDIO_OPS_ALERT_SURFACES.massFailure, STUDIO_OPS_ALERT_SURFACES.laneStale, cooldownStartIso],
    ),
  ]);

  const activeCooldowns = new Set(cooldownRes.rows.map((r) => String(r.surface)));
  const bucketSlot = String(Math.floor(now.getTime() / (STUDIO_ALERT_COOLDOWN_MINUTES * 60_000)));

  const failedN = Number(failStatsRes.rows[0]?.failed_n ?? 0);
  const finishedN = Number(failStatsRes.rows[0]?.finished_n ?? 0);
  const failureRate = finishedN > 0 ? failedN / finishedN : 0;
  let massFailure: StudioOpsAlertResult['massFailure'] = null;

  if (failedN >= STUDIO_ALERT_MIN_FAILURES && finishedN > 0 && failureRate >= STUDIO_ALERT_FAILURE_RATE_THRESHOLD) {
    massFailure = { failed: failedN, total: finishedN, rate: failureRate };
    if (activeCooldowns.has(STUDIO_OPS_ALERT_SURFACES.massFailure)) {
      skippedCooldown.push('mass_failure');
    } else {
      const pct = Math.round(failureRate * 100);
      try {
        const res = await enqueueTeamNotice(sql, 'ops_alert', {
          organizationId: null,
          sourceTable: 'brand_studio_jobs',
          sourceId: deterministicNoticeSourceId('ops_alert', 'mass_failure', bucketSlot),
          surface: STUDIO_OPS_ALERT_SURFACES.massFailure,
          actorLabel: 'Brand Studio Ops',
          preview: `[운영 경보] 최근 ${STUDIO_ALERT_WINDOW_MINUTES}분 브랜드 스튜디오 실패 급증: ${failedN}건 실패 / 완료 ${finishedN}건 (${pct}%)`,
          adminPath: '/admin/brand-studio',
        });
        if (res.enqueued) enqueued.push('mass_failure');
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== '23514') throw error;
      }
    }
  }

  const waitingCount = Number(waitingRes.rows[0]?.waiting_n ?? 0);
  const oldestWaitingAt = asDate(waitingRes.rows[0]?.oldest_waiting_at);
  const seenAt = asDate(laneRes.rows[0]?.seen_at);
  const laneStaleFlag =
    waitingCount > 0 &&
    isAccountLaneStale(seenAt, now, {
      waitingCount,
      oldestWaitingAt,
      maxAgeMs: staleThresholdMs,
    });

  let laneStale: StudioOpsAlertResult['laneStale'] = null;
  if (laneStaleFlag) {
    const staleMinutes = seenAt
      ? Math.max(STUDIO_LANE_STALE_ALERT_MINUTES, Math.floor((now.getTime() - seenAt.getTime()) / 60_000))
      : oldestWaitingAt
        ? Math.max(STUDIO_LANE_STALE_ALERT_MINUTES, Math.floor((now.getTime() - oldestWaitingAt.getTime()) / 60_000))
        : null;
    laneStale = { staleMinutes, waitingCount };

    if (activeCooldowns.has(STUDIO_OPS_ALERT_SURFACES.laneStale)) {
      skippedCooldown.push('lane_stale');
    } else {
      const staleText = staleMinutes !== null ? `${staleMinutes}분 이상 응답 없음` : '하트비트 미수신';
      try {
        const res = await enqueueTeamNotice(sql, 'ops_alert', {
          organizationId: null,
          sourceTable: 'brand_studio_lanes',
          sourceId: deterministicNoticeSourceId('ops_alert', 'lane_stale', bucketSlot),
          surface: STUDIO_OPS_ALERT_SURFACES.laneStale,
          actorLabel: 'Brand Studio Ops',
          preview: `[운영 경보] 브랜드 스튜디오 계정 레인 워커 지연 (${staleText}, 대기 작업 ${waitingCount}건)`,
          adminPath: '/admin/brand-studio',
        });
        if (res.enqueued) enqueued.push('lane_stale');
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== '23514') throw error;
      }
    }
  }

  return {
    available: true,
    kindAllowed: true,
    enqueued,
    skippedCooldown,
    massFailure,
    laneStale,
  };
}
