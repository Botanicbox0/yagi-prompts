import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { heartbeatFresh, laneLoad, lanesUp, loadLaneHeartbeats, pickLane, recordLaneHeartbeat, type LaneRouteInput } from '@/lib/brand-studio/lanes';
import { studioModel } from '@/lib/brand-studio/models';
import { freshDb, runner } from '@/tests/helpers/pglite';

/** docs/BRAND-STUDIO-V2.md §7: preferred -> other -> held; a final sticks to its draft's lane. */
const withMcp = studioModel('seedream-5.5')!;
const noMcp = studioModel('seedream-5-flash')!;
const base = (over: Partial<LaneRouteInput> = {}): LaneRouteInput => ({
  preferred: 'sunra_api',
  model: withMcp,
  counts: { sunra_api: 0, sunra_mcp: 0 },
  caps: { sunra_api: 20, sunra_mcp: 20 },
  laneUp: { sunra_api: true, sunra_mcp: true },
  ...over,
});

describe('pickLane', () => {
  it.each([
    ['preferred api, room on both', base(), 'sunra_api'],
    ['preferred mcp, room on both', base({ preferred: 'sunra_mcp' }), 'sunra_mcp'],
    ['preferred api full -> overflow to mcp', base({ counts: { sunra_api: 20, sunra_mcp: 3 } }), 'sunra_mcp'],
    ['preferred mcp full -> overflow to api', base({ preferred: 'sunra_mcp', counts: { sunra_api: 0, sunra_mcp: 20 } }), 'sunra_api'],
    ['both full -> held', base({ counts: { sunra_api: 20, sunra_mcp: 20 } }), null],
    ['preferred mcp down (stale heartbeat) -> api', base({ preferred: 'sunra_mcp', laneUp: { sunra_api: true, sunra_mcp: false } }), 'sunra_api'],
    ['api not configured, mcp up -> mcp', base({ laneUp: { sunra_api: false, sunra_mcp: true } }), 'sunra_mcp'],
    ['both down -> held', base({ laneUp: { sunra_api: false, sunra_mcp: false } }), null],
    ['model without an account-lane mapping never goes to mcp', base({ preferred: 'sunra_mcp', model: noMcp }), 'sunra_api'],
    ['... and is held when the api lane is full', base({ model: noMcp, counts: { sunra_api: 20, sunra_mcp: 0 } }), null],
    ['final sticks to its draft lane (mcp) even when api is preferred and free', base({ stick: 'sunra_mcp' }), 'sunra_mcp'],
    ['final on a full draft lane waits instead of moving', base({ stick: 'sunra_mcp', counts: { sunra_api: 0, sunra_mcp: 20 } }), null],
    ['final on a dead draft lane waits', base({ stick: 'sunra_mcp', laneUp: { sunra_api: true, sunra_mcp: false } }), null],
    ['final made on api stays on api', base({ preferred: 'sunra_mcp', stick: 'sunra_api' }), 'sunra_api'],
    ['a cap of 0 closes a lane', base({ caps: { sunra_api: 0, sunra_mcp: 20 } }), 'sunra_mcp'],
  ] as const)('%s', (_name, input, expected) => {
    expect(pickLane(input)).toBe(expected);
  });
});

describe('lane liveness', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  it('counts the account lane as up only within 90 seconds of its heartbeat', () => {
    expect(heartbeatFresh(null, now)).toBe(false);
    expect(heartbeatFresh(new Date(now.getTime() - 89_000), now)).toBe(true);
    expect(heartbeatFresh(new Date(now.getTime() - 90_000), now)).toBe(true);
    expect(heartbeatFresh(new Date(now.getTime() - 91_000), now)).toBe(false);
    expect(lanesUp({ apiConfigured: true, heartbeats: { sunra_api: null, sunra_mcp: new Date(now.getTime() - 120_000) }, now })).toEqual({ sunra_api: true, sunra_mcp: false });
  });

  let db: PGlite | null = null;
  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it('records and reads heartbeats, and counts slots in use per lane', async () => {
    db = await freshDb();
    const sql = runner(db);
    expect(await loadLaneHeartbeats(sql)).toEqual({ sunra_api: null, sunra_mcp: null });
    await recordLaneHeartbeat(sql, 'sunra_mcp', { host: 'workstation' }, now);
    const beats = await loadLaneHeartbeats(sql);
    expect(beats.sunra_mcp?.toISOString()).toBe(now.toISOString());
    expect(await laneLoad(sql)).toEqual({ sunra_api: 0, sunra_mcp: 0 });
  });
});
