/**
 * A7: the export record (`render.reserve`) refused every film over 300 s, and the old editor turned that refusal
 * into "check your clips". The 300 s came from the per-second export price (capped at 300 s), which went away
 * when export became free (docs/BRAND-EDITING-STUDIO.md §8-3); nothing else (export code, catalogue) has a
 * length limit. The record now takes any film a timeline built from library footage can be, and a longer one is recorded at the
 * bound instead of being refused, so no export is ever stopped by its length.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetCompleteSchema, STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import { runComposeOperation } from '@/lib/brand-studio/compose/service';
import {
  COMPOSE_FILM_MAX_SEC,
  COMPOSE_SLOWEST_SPEED,
  COMPOSE_SOURCE_MAX_SEC,
  MAX_COMPOSE_CLIPS,
  normalizeClipBounds,
} from '@/lib/brand-studio/compose/timeline';
import { MIN_SPEED } from '@/lib/brand-studio/editor-v2/speed-curve';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

describe('the longest film the export record takes', () => {
  it('is every cut at the longest library footage, played at the slowest speed of any screen that edits it', () => {
    expect(COMPOSE_FILM_MAX_SEC).toBe((MAX_COMPOSE_CLIPS * COMPOSE_SOURCE_MAX_SEC) / COMPOSE_SLOWEST_SPEED);
    expect(COMPOSE_FILM_MAX_SEC).toBe(144_000);
    // This editor and the video studio share the timeline's clamp (0.25×); the new editor goes to MIN_SPEED.
    const slowest = normalizeClipBounds({
      id: 'c',
      label: 'c',
      sourceKind: 'asset',
      srcUrl: '/x',
      durationSec: 10,
      trimStartSec: 0,
      trimEndSec: 10,
      volume: 1,
      muted: false,
      playbackRate: 0.01,
    }).playbackRate!;
    expect(slowest).toBe(0.25);
    expect(MIN_SPEED).toBe(0.1);
    expect(COMPOSE_SLOWEST_SPEED).toBe(Math.min(slowest, MIN_SPEED));
    // The library takes a video up to this many seconds: the same constant the upload checks.
    expect(COMPOSE_SOURCE_MAX_SEC).toBe(STUDIO_LIMITS.mediaSecondsMax);
    const complete = (seconds: number) =>
      AssetCompleteSchema.safeParse({ organizationId: randomUUID(), assetId: randomUUID(), seconds }).success;
    expect(complete(COMPOSE_SOURCE_MAX_SEC)).toBe(true);
    expect(complete(COMPOSE_SOURCE_MAX_SEC + 0.01)).toBe(false);
  });
});

describe('render.reserve records films of any length', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture();
    deps = studioDeps(f.sql, { now: () => new Date('2026-11-15T03:00:00.000Z') });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  async function reserve(durationSec: unknown) {
    return runComposeOperation(deps, viewerOf(f.ids.owner), 'render.reserve', {
      organizationId: f.orgId,
      requestId: `cmp_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      durationSec,
    });
  }

  async function recordedSeconds(jobId: string): Promise<number> {
    const row = (await f.sql.query<{ params: unknown }>('select params from brand_studio_jobs where id = $1', [jobId])).rows[0]!;
    const params = (typeof row.params === 'string' ? JSON.parse(row.params) : row.params) as { seconds: number };
    return params.seconds;
  }

  it.each([
    ['the audit film (5 s + 300 s)', 305, 305],
    ['the old limit', 300, 300],
    ['an hour', 3600, 3600],
    ['24 cuts of 600 s at this editor’s 0.25×', 57_600, 57_600],
    ['the bound itself', COMPOSE_FILM_MAX_SEC, COMPOSE_FILM_MAX_SEC],
  ])('%s: recorded, free, with its own length', async (_name, sec, expected) => {
    const result = await reserve(sec);
    expect(result.ok).toBe(true);
    if (!result.ok || !('jobId' in result)) throw new Error('reserve failed');
    expect(result.creditsUsed).toBe(0);
    expect(await recordedSeconds(result.jobId)).toBe(expected);
  });

  it('a film longer than the bound (only device files over 10 minutes can make one) is recorded at the bound, not refused', async () => {
    const result = await reserve(COMPOSE_FILM_MAX_SEC * 3);
    expect(result.ok).toBe(true);
    if (!result.ok || !('jobId' in result)) throw new Error('reserve failed');
    expect(await recordedSeconds(result.jobId)).toBe(COMPOSE_FILM_MAX_SEC);
  });

  it('still refuses what is not a film length', async () => {
    for (const bad of [0.2, -1, Number.NaN, Number.POSITIVE_INFINITY, '305', null]) {
      const result = await reserve(bad);
      expect(result).toEqual({ ok: false, code: 'invalid' });
    }
  });
});
