/**
 * Execution lanes (docs/BRAND-STUDIO-V2.md §7). Never shown to a customer.
 *
 *   sunra_api  `SUNRA_API_KEY` on api.sunra.ai's queue, from the Vercel function (webhook + polling).
 *   sunra_mcp  the Sunra account (subscription credits), run by the workstation worker
 *              (scripts/brand-studio-lane-worker.mjs) through /api/brand-studio/lane.
 *
 * `pickLane` is pure: preferred lane if it is up and under its cap, else the other one, else null
 * (the job stays `held`). A `video_final` sticks to the lane that made its draft: a draft id only
 * finalizes on the upstream account that produced it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STUDIO_LANES, type StudioLane, type StudioModel } from './models';

/** The account lane counts as up while its worker said so within this window. */
export const LANE_HEARTBEAT_MAX_AGE_MS = 90_000;

export interface LaneRouteInput {
  preferred: StudioLane;
  model: Pick<StudioModel, 'mcp'>;
  /** Jobs currently holding a slot on each lane (queued, running or finishing). */
  counts: Record<StudioLane, number>;
  caps: Record<StudioLane, number>;
  laneUp: Record<StudioLane, boolean>;
  /** `video_final`: the lane its draft ran on. No other lane is acceptable. */
  stick?: StudioLane | null;
}

export function otherLane(lane: StudioLane): StudioLane {
  return lane === 'sunra_api' ? 'sunra_mcp' : 'sunra_api';
}

/** Up, the model exists on that lane, and a slot is free. */
export function laneAvailable(lane: StudioLane, input: Omit<LaneRouteInput, 'preferred' | 'stick'>): boolean {
  if (!input.laneUp[lane]) return false;
  if (lane === 'sunra_mcp' && input.model.mcp === null) return false;
  return input.counts[lane] < input.caps[lane];
}

export function pickLane(input: LaneRouteInput): StudioLane | null {
  if (input.stick) return laneAvailable(input.stick, input) ? input.stick : null;
  for (const lane of [input.preferred, otherLane(input.preferred)]) {
    if (laneAvailable(lane, input)) return lane;
  }
  return null;
}

export function heartbeatFresh(seenAt: Date | null, now: Date): boolean {
  if (!seenAt) return false;
  const age = now.getTime() - seenAt.getTime();
  return age >= -5_000 && age <= LANE_HEARTBEAT_MAX_AGE_MS;
}

export function lanesUp(input: {
  apiConfigured: boolean;
  heartbeats: Record<StudioLane, Date | null>;
  now: Date;
  /** A lane that could not pay is closed until this instant (`closeLane`). */
  closedUntil?: Record<StudioLane, Date | null>;
}): Record<StudioLane, boolean> {
  const open = (lane: StudioLane) => !laneClosed(input.closedUntil?.[lane] ?? null, input.now);
  return {
    sunra_api: input.apiConfigured && open('sunra_api'),
    sunra_mcp: heartbeatFresh(input.heartbeats.sunra_mcp, input.now) && open('sunra_mcp'),
  };
}

/* ------------------------------------------------------- closing a lane that cannot pay */

/** How long a lane that reported no balance stays closed before it is tried again. */
export const LANE_CLOSE_MS = 10 * 60_000;

export function laneClosed(until: Date | null, now: Date): boolean {
  return until !== null && until.getTime() > now.getTime();
}

/** `closedUntil` per lane, kept in the lane row's `info` (a heartbeat keeps it). */
export async function loadLaneClosures(sql: SqlRunner): Promise<Record<StudioLane, Date | null>> {
  const rows = (await sql.query<{ lane: string; closed_until: string | null }>("select lane, info ->> 'closedUntil' as closed_until from brand_studio_lanes")).rows;
  const out: Record<StudioLane, Date | null> = { sunra_api: null, sunra_mcp: null };
  for (const row of rows) {
    const at = row.closed_until ? new Date(row.closed_until) : null;
    if ((STUDIO_LANES as readonly string[]).includes(row.lane) && at && !Number.isNaN(at.getTime())) out[row.lane as StudioLane] = at;
  }
  return out;
}

/** The lane ran out of money: nothing new goes there for `LANE_CLOSE_MS`. Never marks a worker alive. */
export async function closeLane(sql: SqlRunner, lane: StudioLane, now: Date): Promise<void> {
  const until = new Date(now.getTime() + LANE_CLOSE_MS).toISOString();
  await sql.query(
    `insert into brand_studio_lanes (lane, seen_at, info) values ($1, null, jsonb_build_object('closedUntil', $2::text))
     on conflict (lane) do update set info = brand_studio_lanes.info || jsonb_build_object('closedUntil', $2::text)`,
    [lane, until],
  );
}

const asDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

export async function loadLaneHeartbeats(sql: SqlRunner): Promise<Record<StudioLane, Date | null>> {
  const rows = (await sql.query<{ lane: string; seen_at: unknown }>('select lane, seen_at from brand_studio_lanes')).rows;
  const out: Record<StudioLane, Date | null> = { sunra_api: null, sunra_mcp: null };
  for (const row of rows) if ((STUDIO_LANES as readonly string[]).includes(row.lane)) out[row.lane as StudioLane] = asDate(row.seen_at);
  return out;
}

/** The worker's liveness signal. `info` is a small object the worker chooses (version, host); capped. */
export async function recordLaneHeartbeat(sql: SqlRunner, lane: StudioLane, info: Record<string, unknown> = {}, now: Date = new Date()): Promise<void> {
  // A closure is the studio's decision, not the worker's: never taken from `info`, kept across heartbeats.
  const { closedUntil: _ignored, ...own } = info;
  const json = JSON.stringify(own);
  await sql.query(
    `insert into brand_studio_lanes (lane, seen_at, info) values ($1, $2, $3::jsonb)
     on conflict (lane) do update set seen_at = excluded.seen_at,
       info = excluded.info || jsonb_strip_nulls(jsonb_build_object('closedUntil', brand_studio_lanes.info -> 'closedUntil'))`,
    [lane, now.toISOString(), json.length <= 2000 ? json : '{}'],
  );
}

/**
 * The lane a job should take now, or null to wait (`held`). Used when a job is created (so a free lane
 * means it starts as `queued`) and by the engine for held jobs. First come, first served: every held
 * job older than this one is ahead of it on whichever lane frees up.
 */
export async function routeJob(
  sql: SqlRunner,
  input: {
    organizationId: string;
    model: Pick<StudioModel, 'mcp'>;
    defaultLane: StudioLane;
    caps: Record<StudioLane, number>;
    /** The API lane can submit (a key is configured, or the fake provider is on). */
    apiUp: boolean;
    now: Date;
    stick: StudioLane | null;
    /** This job's place in the line; null for one not inserted yet (every held job is ahead of it). */
    place: { createdAt: string; id: string } | null;
    /** Lanes this job already failed on for want of balance: never again (no ping-pong). */
    exclude?: readonly StudioLane[];
  },
): Promise<StudioLane | null> {
  const pref = (
    await sql.query<{ preferred_lane: StudioLane | null }>('select preferred_lane from brand_studio_allowances where organization_id = $1', [input.organizationId])
  ).rows[0]?.preferred_lane;
  const counts = await laneLoad(sql);
  const ahead = Number(
    (
      await sql.query<{ n: number }>(
        input.place
          ? "select count(*)::int as n from brand_studio_jobs where status = 'held' and (created_at, id) < ($1::timestamptz, $2::uuid)"
          : "select count(*)::int as n from brand_studio_jobs where status = 'held'",
        input.place ? [input.place.createdAt, input.place.id] : [],
      )
    ).rows[0]?.n ?? 0,
  );
  return pickLane({
    preferred: pref ?? input.defaultLane,
    model: input.model,
    counts: { sunra_api: counts.sunra_api + ahead, sunra_mcp: counts.sunra_mcp + ahead },
    caps: input.caps,
    laneUp: withoutLanes(
      lanesUp({ apiConfigured: input.apiUp, heartbeats: await loadLaneHeartbeats(sql), now: input.now, closedUntil: await loadLaneClosures(sql) }),
      input.exclude ?? [],
    ),
    stick: input.stick,
  });
}

function withoutLanes(up: Record<StudioLane, boolean>, exclude: readonly StudioLane[]): Record<StudioLane, boolean> {
  return { sunra_api: up.sunra_api && !exclude.includes('sunra_api'), sunra_mcp: up.sunra_mcp && !exclude.includes('sunra_mcp') };
}

/**
 * A lane could not pay for a job (docs/BRAND-STUDIO-V2.md §7). The caller has closed `from`; this
 * decides where the job goes: `fail` when it is a 1080p final (its draft lives on one route), when the
 * other lane was already tried, is closed too, cannot run the model, or (leaving the account lane) when
 * the API lane is not configured. Otherwise `route`: `queued` on the other lane, or `held` (lane null)
 * while that lane is merely busy or its worker is quiet.
 */
export async function failoverLane(
  sql: SqlRunner,
  input: {
    from: StudioLane;
    kind: string;
    tried: readonly StudioLane[];
    organizationId: string;
    model: Pick<StudioModel, 'mcp'>;
    defaultLane: StudioLane;
    caps: Record<StudioLane, number>;
    apiUp: boolean;
    now: Date;
    createdAt: string;
    id: string;
  },
): Promise<{ action: 'fail' } | { action: 'route'; lane: StudioLane | null; tried: StudioLane[] }> {
  if (input.kind === 'video_final') return { action: 'fail' };
  const tried = [...new Set<StudioLane>([...input.tried, input.from])];
  const other = otherLane(input.from);
  if (tried.includes(other)) return { action: 'fail' };
  if (laneClosed((await loadLaneClosures(sql))[other], input.now)) return { action: 'fail' };
  if (other === 'sunra_mcp' && input.model.mcp === null) return { action: 'fail' };
  if (other === 'sunra_api' && !input.apiUp) return { action: 'fail' };
  const lane = await routeJob(sql, {
    organizationId: input.organizationId,
    model: input.model,
    defaultLane: input.defaultLane,
    caps: input.caps,
    apiUp: input.apiUp,
    now: input.now,
    stick: null,
    place: { createdAt: input.createdAt, id: input.id },
    exclude: tried,
  });
  return { action: 'route', lane, tried };
}

/** Slots in use on each lane (sum of pending output slots per active job, at least 1 per job). */
export async function laneLoad(sql: SqlRunner): Promise<Record<StudioLane, number>> {
  const rows = (
    await sql.query<{ lane: string; n: number }>(
      `select j.lane,
              coalesce(sum(greatest(coalesce(o.cnt, 1), 1)), 0)::int as n
         from brand_studio_jobs j
         left join (
           select job_id, count(*)::int as cnt
             from brand_studio_outputs
            where status = 'pending'
            group by job_id
         ) o on o.job_id = j.id
        where j.lane is not null and j.status in ('queued','running','finishing')
        group by j.lane`,
    )
  ).rows;
  const out: Record<StudioLane, number> = { sunra_api: 0, sunra_mcp: 0 };
  for (const row of rows) if ((STUDIO_LANES as readonly string[]).includes(row.lane)) out[row.lane as StudioLane] = Number(row.n);
  return out;
}
