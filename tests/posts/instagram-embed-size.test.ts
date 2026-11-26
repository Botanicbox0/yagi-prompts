import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_EMBED_MAX_HEIGHT,
  INSTAGRAM_EMBED_MIN_HEIGHT,
  INSTAGRAM_EMBED_ORIGIN,
  instagramEmbedHeight,
} from '@/lib/posts/instagram-embed-size';

describe('instagramEmbedHeight', () => {
  it('accepts an object MEASURE payload from https://www.instagram.com and rounds height', () => {
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: 742.6 },
      }),
    ).toBe(743);
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: 610.2 },
      }),
    ).toBe(610);
  });

  it('accepts a JSON string MEASURE payload from https://www.instagram.com', () => {
    expect(
      instagramEmbedHeight(
        INSTAGRAM_EMBED_ORIGIN,
        JSON.stringify({ type: 'MEASURE', details: { height: 896 } }),
      ),
    ).toBe(896);
  });

  it('clamps measured heights to 240..1600', () => {
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: 80 },
      }),
    ).toBe(INSTAGRAM_EMBED_MIN_HEIGHT);
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: -50 },
      }),
    ).toBe(INSTAGRAM_EMBED_MIN_HEIGHT);
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: 2400 },
      }),
    ).toBe(INSTAGRAM_EMBED_MAX_HEIGHT);
  });

  it('rejects any origin other than https://www.instagram.com', () => {
    const payload = { type: 'MEASURE', details: { height: 800 } };
    expect(instagramEmbedHeight('https://instagram.com', payload)).toBeNull();
    expect(instagramEmbedHeight('http://www.instagram.com', payload)).toBeNull();
    expect(instagramEmbedHeight('https://evil.example', payload)).toBeNull();
    expect(instagramEmbedHeight('', payload)).toBeNull();
  });

  it('rejects non-MEASURE message types', () => {
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'LOADED',
        details: { height: 800 },
      }),
    ).toBeNull();
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'measure',
        details: { height: 800 },
      }),
    ).toBeNull();
  });

  it('rejects non-numeric, non-finite, or missing heights', () => {
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: '800' },
      }),
    ).toBeNull();
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: Number.NaN },
      }),
    ).toBeNull();
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: { height: Number.POSITIVE_INFINITY },
      }),
    ).toBeNull();
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
        details: {},
      }),
    ).toBeNull();
    expect(
      instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, {
        type: 'MEASURE',
      }),
    ).toBeNull();
    expect(instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, null)).toBeNull();
    expect(instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, [1, 2, 3])).toBeNull();
  });

  it('returns null without throwing on malformed JSON strings', () => {
    expect(() => instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, '{not-json')).not.toThrow();
    expect(instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, '{not-json')).toBeNull();
    expect(instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, '')).toBeNull();
    expect(instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, 'null')).toBeNull();
    expect(instagramEmbedHeight(INSTAGRAM_EMBED_ORIGIN, '42')).toBeNull();
  });
});
