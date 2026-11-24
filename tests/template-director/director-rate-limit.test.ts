import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMock = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  loadPromptBySlug: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: routeMock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: routeMock.sql }));
vi.mock('@/lib/prompts/repo', async (original) => ({
  ...(await original<typeof import('@/lib/prompts/repo')>()),
  loadPromptBySlug: routeMock.loadPromptBySlug,
}));

import { POST as directorPOST } from '@/app/api/template-director/route';
import {
  DIRECTOR_TURNS_PER_DAY,
  DIRECTOR_TURNS_PER_MINUTE,
  resetDirectorTurnLimitsForTest,
  takeDirectorTurnSlot,
} from '@/lib/template-director/rate-limit';

/** docs/PERSONAL-STUDIO.md §3.1 — the director conversation gets a call limit (there was none). */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('takeDirectorTurnSlot', () => {
  beforeEach(() => resetDirectorTurnLimitsForTest());

  it('allows 10 turns in a rolling minute, refuses the 11th with a retry time, and frees the slot after the window', () => {
    const t0 = 1_800_000_000_000;
    expect(DIRECTOR_TURNS_PER_MINUTE).toBe(10);
    for (let i = 0; i < 10; i += 1) {
      expect(takeDirectorTurnSlot('u-1', t0 + i * 1000)).toEqual({ ok: true });
    }
    const refused = takeDirectorTurnSlot('u-1', t0 + 10_000);
    expect(refused).toEqual({ ok: false, retryAfterSec: 50 });
    // A refused call does not take a slot: the first slot frees at t0 + 60 s.
    expect(takeDirectorTurnSlot('u-1', t0 + MINUTE - 1).ok).toBe(false);
    expect(takeDirectorTurnSlot('u-1', t0 + MINUTE + 1)).toEqual({ ok: true });
  });

  it('allows 100 turns in a rolling day', () => {
    const t0 = 1_800_000_000_000;
    expect(DIRECTOR_TURNS_PER_DAY).toBe(100);
    // 10 per minute, spaced so the minute window never binds.
    for (let i = 0; i < 100; i += 1) {
      expect(takeDirectorTurnSlot('u-day', t0 + i * 7_000).ok).toBe(true);
    }
    const refused = takeDirectorTurnSlot('u-day', t0 + 100 * 7_000);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.retryAfterSec).toBe(Math.ceil((t0 + DAY - (t0 + 100 * 7_000)) / 1000));
    }
    expect(takeDirectorTurnSlot('u-day', t0 + DAY + 1).ok).toBe(true);
  });

  it('keeps users apart and resets for tests', () => {
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 10; i += 1) takeDirectorTurnSlot('u-a', t0);
    expect(takeDirectorTurnSlot('u-a', t0).ok).toBe(false);
    expect(takeDirectorTurnSlot('u-b', t0).ok).toBe(true);
    resetDirectorTurnLimitsForTest();
    expect(takeDirectorTurnSlot('u-a', t0).ok).toBe(true);
  });
});

describe('POST /api/template-director call limit', () => {
  function post(): Promise<Response> {
    const form = new FormData();
    form.set('template', 'runway-arrival');
    form.set('locale', 'ko');
    form.set('message', '블랙 레더 자켓으로 바꿔줘');
    return directorPOST(new Request('https://twings.app/api/template-director', { method: 'POST', body: form }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDirectorTurnLimitsForTest();
    delete process.env.GEMINI_API_KEY;
    routeMock.viewer.mockResolvedValue({ userId: 'u-111', isAdmin: false, tier: 'free', locale: 'ko' });
    routeMock.sql.mockResolvedValue({ query: vi.fn() });
    routeMock.loadPromptBySlug.mockResolvedValue({
      id: 'tpl-1',
      slug: 'runway-arrival',
      status: 'published',
      audience: 'public',
      medium: 'video',
      title: 'Runway Arrival',
      titleKo: '런웨이 도착',
      processMd: 'Smooth street dolly-in',
      processMdKo: '도심 야간 워킹 원테이크',
    });
  });

  it('answers 429 rate_limited with Retry-After on call N+1, and another user is unaffected', async () => {
    for (let i = 0; i < DIRECTOR_TURNS_PER_MINUTE; i += 1) {
      expect((await post()).status).toBe(200);
    }
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, code: 'rate_limited' });
    const retryAfter = Number(limited.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(limited.headers.get('Cache-Control')).toBe('private, no-store');

    routeMock.viewer.mockResolvedValue({ userId: 'u-222', isAdmin: false, tier: 'free', locale: 'ko' });
    expect((await post()).status).toBe(200);
  });

  it('does not take a slot for a signed-out call', async () => {
    routeMock.viewer.mockResolvedValue({ userId: null, isAdmin: false, tier: 'anon' });
    for (let i = 0; i < DIRECTOR_TURNS_PER_MINUTE + 5; i += 1) {
      expect((await post()).status).toBe(401);
    }
    routeMock.viewer.mockResolvedValue({ userId: 'u-111', isAdmin: false, tier: 'free', locale: 'ko' });
    for (let i = 0; i < DIRECTOR_TURNS_PER_MINUTE; i += 1) {
      expect((await post()).status).toBe(200);
    }
  });

  it('does not limit an admin', async () => {
    routeMock.viewer.mockResolvedValue({ userId: 'u-admin', isAdmin: true, tier: 'free', locale: 'ko' });
    for (let i = 0; i < DIRECTOR_TURNS_PER_MINUTE + 3; i += 1) {
      expect((await post()).status).toBe(200);
    }
  });
});
