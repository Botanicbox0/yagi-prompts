import { describe, expect, it } from 'vitest';
import { TIER_ORDER, type Tier, type Visibility } from '@/lib/content/visibility';
import { shapePrompt, shapePromptMedia, type PromptRowInput } from '@/lib/prompts/shape';

/**
 * PLAN §13.1 — "pro prompt text never enters any payload for non-entitled viewers".
 *
 * The `lib/content/shape.ts` truth table, for prompts. Two properties, and the second one is the
 * one that actually protects the product:
 *
 *   1. the right tiers see the text;
 *   2. for everyone else the `text` KEY DOES NOT EXIST on the object. `toBeUndefined()` would pass
 *      on `{ text: undefined }`, which JSON-serialises away but survives a Flight payload as a
 *      hole — so these assert on the key set itself.
 */

const STAGING = 'content/prompt/9a000000-0000-4000-8000-000000000001/abc.png';
const SENTINEL = 'SENTINEL_SHAPE_TEXT';

function row(overrides: Partial<PromptRowInput> = {}): PromptRowInput {
  return {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    source: 'yagi',
    authorHandle: null,
    model: 'seedance-2.5',
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    promptText: `Slow dolly-in.\n:: ${SENTINEL}`,
    textVisibility: 'pro',
    media: {
      poster: {
        staging_key: STAGING,
        sha256: 'a'.repeat(64),
        published_key: `${'a'.repeat(64)}.png`,
        bucket: 'public-content',
        mime: 'image/png',
        w: 1280,
        h: 1600,
      },
      video: {
        staging_key: STAGING.replace('.png', '.mp4'),
        sha256: 'b'.repeat(64),
        published_key: `${'b'.repeat(64)}.mp4`,
        bucket: 'public-content',
        mime: 'video/mp4',
        duration_s: 6,
      },
    },
    useCase: ['cinematic'],
    featured: true,
    publishedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('shapePrompt truth table (§13.1 gating doctrine)', () => {
  const cases: Array<[Visibility, Tier, boolean]> = [];
  for (const visibility of ['public', 'free', 'pro', 'hidden'] as Visibility[]) {
    for (const tier of TIER_ORDER) {
      const rank = ['public', 'free', 'pro', 'hidden'].indexOf(visibility);
      cases.push([visibility, tier, rank <= TIER_ORDER.indexOf(tier)]);
    }
  }

  for (const [visibility, tier, visible] of cases) {
    it(`${visibility} text × ${tier} viewer ⇒ ${visible ? 'text' : 'locked'}`, () => {
      const shaped = shapePrompt(row({ textVisibility: visibility }), tier);
      expect(shaped.locked).toBe(!visible);
      if (visible) {
        expect(shaped.locked === false && shaped.text).toContain(SENTINEL);
      } else {
        // The KEY, not the value: a hole in the object is still a hole in the payload.
        expect(Object.hasOwn(shaped, 'text')).toBe(false);
        expect(JSON.stringify(shaped)).not.toContain(SENTINEL);
      }
    });
  }

  it('publishes the gate itself, which is safe, and never what is behind it', () => {
    const shaped = shapePrompt(row(), 'anon');
    expect(shaped.visibility).toBe('pro');
    expect(shaped.tier).toBe('anon');
    expect(shaped.title).toBe('Neon alley dolly');
    expect(JSON.stringify(shaped)).not.toContain(SENTINEL);
  });
});

describe('media shaping (§13.1 lifecycle)', () => {
  it('never emits a staging key, for any tier', () => {
    for (const tier of TIER_ORDER) {
      expect(JSON.stringify(shapePrompt(row(), tier))).not.toContain('content/prompt/');
    }
  });

  it('prefers a configured CDN url and falls back to the public media route', () => {
    const cdn = shapePrompt(row(), 'anon', { publicUrl: (key) => `https://cdn.test/${key}` });
    expect(cdn.poster?.source).toBe('public');
    expect(cdn.poster?.src).toBe(`https://cdn.test/${'a'.repeat(64)}.png`);

    const fallback = shapePrompt(row(), 'anon', { publicUrl: () => null });
    expect(fallback.poster?.source).toBe('route');
    expect(fallback.poster?.src).toContain('/api/prompts/media/');
    expect(fallback.poster?.src).toContain('%3Aposter');
  });

  /**
   * An asset that has not been copied to the public bucket yet is NOT servable — a pending
   * submission's clip is exactly this case. `null` (⇒ the typographic poster) is the honest answer;
   * a URL that 404s, or worse a staging path, would not be.
   */
  it('answers null for an asset that has not been published', () => {
    const { poster, video } = shapePromptMedia('9a000000-0000-4000-8000-000000000001', {
      poster: { staging_key: STAGING, sha256: 'a'.repeat(64), mime: 'image/png' },
    });
    expect(poster).toBeNull();
    expect(video).toBeNull();
  });

  it('carries intrinsic dimensions through so the masonry does not reflow', () => {
    const shaped = shapePrompt(row(), 'pro');
    expect(shaped.poster).toMatchObject({ w: 1280, h: 1600, mime: 'image/png' });
    expect(shaped.video).toMatchObject({ duration_s: 6, mime: 'video/mp4' });
  });

  it('survives malformed media jsonb without throwing or leaking', () => {
    const shaped = shapePrompt(row({ media: 'not an object' }), 'pro');
    expect(shaped.poster).toBeNull();
    expect(shaped.video).toBeNull();
    expect(shaped.locked).toBe(false);
  });
});
