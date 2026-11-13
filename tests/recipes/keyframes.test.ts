import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('server-only', () => ({}));

const routeMock = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: routeMock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: routeMock.sql }));

import { recommendVideoKeyframes } from '@/lib/template-director/keyframes';
import { GEMINI_DIRECTOR_DEFAULT_MODEL } from '@/lib/template-director/schema';
import { POST as keyframesPOST } from '@/app/api/makers/formats/[id]/keyframes/route';
import { KeyframePicker } from '@/components/recipes/keyframe-picker';

function req(formatId: string, body: unknown, origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/makers/formats/${formatId}/keyframes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Host: 'localhost:3000',
    },
    body: JSON.stringify(body),
  });
}

describe('Maker video keyframe recommender, API route & scrubber UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMock.viewer.mockResolvedValue({ userId: 'u-maker-1', isAdmin: false, tier: 'free', locale: 'ko' });
  });

  it('uses gemini-4-hydrogen structured JSON beats with timeline clamping, and falls back deterministically offline', async () => {
    const offline = await recommendVideoKeyframes({ durationSeconds: 8, title: 'Seoul Walk' }, { env: {} });
    expect(offline.model).toBe('heuristic');
    expect(offline.keyframes).toHaveLength(4);
    expect(offline.keyframes[3]!.timeSeconds).toBeLessThanOrEqual(8);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { index: 0, timeSeconds: -1, labelKo: '등장', labelEn: 'Entrance' },
                    { index: 1, timeSeconds: 3.2, labelKo: '턴', labelEn: 'Turn' },
                    { index: 2, timeSeconds: 6.4, labelKo: '클라이맥스', labelEn: 'Peak' },
                    { index: 3, timeSeconds: 99, labelKo: '엔딩', labelEn: 'Outro' },
                  ]),
                },
              ],
            },
          },
        ],
      }),
    });

    const online = await recommendVideoKeyframes(
      { durationSeconds: 8, title: 'Seoul Walk' },
      { env: { GEMINI_API_KEY: 'test-key' }, fetch: mockFetch as unknown as typeof fetch },
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(online.model).toBe(GEMINI_DIRECTOR_DEFAULT_MODEL);
    expect(online.keyframes.map((k) => k.timeSeconds)).toEqual([0, 3.2, 6.4, 8]);
    expect(online.keyframes[0]?.labelKo).toBe('등장');
  });

  it('enforces ownership on POST /api/makers/formats/[id]/keyframes while allowing recommend before first draft save', async () => {
    const formatId = randomUUID();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    routeMock.sql.mockResolvedValue({ query });

    // Unsaved new format: 'recommend' succeeds, 'save' returns 404 until format row exists.
    const recommendRes = await keyframesPOST(req(formatId, { action: 'recommend', durationSeconds: 10, title: 'New clip' }), {
      params: Promise.resolve({ id: formatId }),
    });
    expect(recommendRes.status).toBe(200);
    const recBody = await recommendRes.json();
    expect(recBody.ok).toBe(true);
    expect(recBody.keyframes).toHaveLength(4);

    const unsavedSaveRes = await keyframesPOST(req(formatId, { action: 'save', keyframes: recBody.keyframes }), {
      params: Promise.resolve({ id: formatId }),
    });
    expect(unsavedSaveRes.status).toBe(404);

    // Owned row: 'save' normalizes index order and persists jsonb.
    query.mockResolvedValueOnce({ rows: [{ id: formatId, user_id: 'u-maker-1' }] });
    query.mockResolvedValueOnce({ rows: [] });
    const ownedSaveRes = await keyframesPOST(
      req(formatId, {
        action: 'save',
        keyframes: [
          { index: 1, timeSeconds: 7.5, labelKo: '엔딩' },
          { index: 0, timeSeconds: 1.2, labelKo: '오프닝' },
        ],
      }),
      { params: Promise.resolve({ id: formatId }) },
    );
    expect(ownedSaveRes.status).toBe(200);
    const saved = await ownedSaveRes.json();
    expect(saved.keyframes.map((k: { index: number; timeSeconds: number }) => [k.index, k.timeSeconds])).toEqual([
      [0, 1.2],
      [1, 7.5],
    ]);

    // Another user's format row: returns 404 not_found even for recommend.
    query.mockResolvedValueOnce({ rows: [{ id: formatId, user_id: 'other-user' }] });
    const stolenRes = await keyframesPOST(req(formatId, { action: 'recommend', durationSeconds: 10 }), {
      params: Promise.resolve({ id: formatId }),
    });
    expect(stolenRes.status).toBe(404);
  });

  it('renders KeyframePicker timeline range scrubber & recommend trigger for makers', () => {
    const html = renderToStaticMarkup(
      createElement(KeyframePicker, {
        formatId: randomUUID(),
        durationSeconds: 10,
        title: 'Runway',
        locale: 'ko',
      }),
    );
    expect(html).toContain('data-maker-keyframe-picker');
    expect(html).toContain('data-keyframe-recommend');
    expect(html).toContain('data-keyframe-slot="0"');
    expect(html).toContain('data-keyframe-scrubber');
    expect(html).toContain('type="range"');
    expect(html).toContain('data-keyframe-save');
  });
});
