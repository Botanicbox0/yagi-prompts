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

export function lanesUp(input: { apiConfigured: boolean; heartbeats: Record<StudioLane, Date | null>; now: Date }): Record<StudioLane, boolean> {
  return {
    sunra_api: input.apiConfigured,
    sunra_mcp: heartbeatFresh(input.heartbeats.sunra_mcp, input.now),
  };
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
  const json = JSON.stringify(info);
  await sql.query(
    `insert into brand_studio_lanes (lane, seen_at, info) values ($1, $2, $3::jsonb)
     on conflict (lane) do update set seen_at = excluded.seen_at, info = excluded.info`,
    [lane, now.toISOString(), json.length <= 2000 ? json : '{}'],
  );
}

/** Slots in use on each lane. */
export async function laneLoad(sql: SqlRunner): Promise<Record<StudioLane, number>> {
  const rows = (
    await sql.query<{ lane: string; n: number }>(
      `select lane, count(*)::int as n from brand_studio_jobs
        where lane is not null and status in ('queued','running','finishing') group by lane`,
    )
  ).rows;
  const out: Record<StudioLane, number> = { sunra_api: 0, sunra_mcp: 0 };
  for (const row of rows) if ((STUDIO_LANES as readonly string[]).includes(row.lane)) out[row.lane as StudioLane] = Number(row.n);
  return out;
}
