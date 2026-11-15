import { describe, expect, it } from 'vitest';
import { COLLECT_LEASE_MINUTES, liveCollectors } from '@/lib/renders/collect';

/**
 * Who counts as still copying a finished film (lib/renders/collect.ts). The passes themselves, and the
 * order their endings land in, are exercised on a real database in tests/renders/service.test.ts.
 */

const NOW = new Date('2026-09-06T12:00:00.000Z');
const ago = (ms: number) => NOW.getTime() - ms;
const LEASE_MS = COLLECT_LEASE_MINUTES * 60_000;

describe('liveCollectors', () => {
  it('lists the passes whose stamp is inside the lease, whichever way the driver hands the column over', () => {
    const value = { fresh: ago(0), recent: ago(60_000), expired: ago(LEASE_MS), old: ago(LEASE_MS + 1) };
    expect(liveCollectors(value, NOW).sort()).toEqual(['fresh', 'recent']);
    expect(liveCollectors(JSON.stringify(value), NOW).sort()).toEqual(['fresh', 'recent']);
  });

  it('reads nothing from an empty, missing or malformed value', () => {
    for (const value of [null, undefined, {}, '', 'not json', '[]', [], 7, { a: 'soon', b: null, c: Number.NaN }]) {
      expect(liveCollectors(value, NOW)).toEqual([]);
    }
  });

  it('keeps the lease longer than any function can run', () => {
    expect(LEASE_MS).toBeGreaterThan(300_000);
  });
});
