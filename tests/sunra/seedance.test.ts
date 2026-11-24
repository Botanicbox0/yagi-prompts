import { describe, expect, it } from 'vitest';
import { buildStudioRequest } from '@/lib/brand-studio/provider/requests';
import { estimateVideoUsd } from '@/lib/brand-studio/models';
import type { StudioJobParams } from '@/lib/brand-studio/types';
import {
  SEEDANCE_REFERENCE_ENDPOINT,
  SeedanceRequestError,
  estimateSeedanceUsd,
  seedanceReferenceRequest,
  toSunraReferenceSyntax,
  unattachedReferences,
} from '@/lib/sunra/seedance';

/**
 * The personal Sunra lane's request builder (lib/sunra/seedance.ts) is a second writer of the same
 * Seedance 2.5 reference-to-video body the brand studio already sends. These tests pin it to the brand
 * builder (the one that has run against the provider) so the two cannot drift.
 */

const A = 'https://media.example.com/renders/job-1/input.png?sig=1';
const B = 'https://media.example.com/renders/job-1/slot-partner.jpg?sig=2';

function brandParams(overrides: Partial<StudioJobParams>): StudioJobParams {
  return { aspect: '9:16', resolution: '720p', seconds: 10, audio: null, count: 1, locale: 'en', ...overrides };
}

describe('seedanceReferenceRequest', () => {
  it('builds exactly the body the brand studio sends for a two-image reference run', () => {
    for (const [resolution, ratio, seconds] of [['720p', '9:16', 10], ['1080p', '16:9', 5], ['720p', '1:1', 15], ['1080p', '3:4', 4]] as const) {
      const prompt = '@Image1 and @Image2 dance in the rain.';
      const brand = buildStudioRequest({
        kind: 'video',
        model: 'seedance-2.5',
        prompt,
        params: brandParams({ resolution, aspect: ratio, seconds }),
        images: [{ url: A }, { url: B }],
        videos: [],
      });
      const personal = seedanceReferenceRequest({ prompt, resolution, ratio, seconds, referenceImages: [A, B] });
      expect(personal).toEqual(brand);
      expect(personal.endpoint).toBe(SEEDANCE_REFERENCE_ENDPOINT);
      expect(personal.endpoint).toBe('bytedance/seedance-2.5/reference-to-video');
    }
  });

  it('never sends a draft, always mp4 with sound, and never a data URL, an asset id or a plain http address', () => {
    const { body } = seedanceReferenceRequest({ prompt: 'p', resolution: '720p', ratio: '9:16', seconds: 10, referenceImages: [A] });
    expect(body).toMatchObject({ draft: false, output_format: 'mp4', generate_audio: true, duration: 10, ratio: '9:16', resolution: '720p', reference_images: [A] });
    for (const bad of ['data:image/png;base64,AAAA', 'asset://asset-123', 'http://media.example.com/a.png', 'https://127.0.0.1/a.png', 'https://2130706433/a.png', 'https://[::1]/a.png', 'https://user:pw@media.example.com/a.png', 'https://localhost/a.png', 'https://media.internal/a.png', 'not a url', '']) {
      expect(() => seedanceReferenceRequest({ prompt: 'p', resolution: '720p', ratio: '9:16', seconds: 10, referenceImages: [bad] }), bad).toThrow(SeedanceRequestError);
    }
  });

  it('refuses what the provider or the price cannot take instead of quietly changing it', () => {
    const ok = { prompt: 'p', resolution: '720p' as const, ratio: '9:16', seconds: 10, referenceImages: [A] };
    expect(() => seedanceReferenceRequest({ ...ok, referenceImages: [] })).toThrow(/at least one/);
    expect(() => seedanceReferenceRequest({ ...ok, referenceImages: Array.from({ length: 10 }, (_, i) => `${A}&n=${i}`) })).toThrow(/at most 9/);
    expect(() => seedanceReferenceRequest({ ...ok, seconds: 3 })).toThrow(/seconds/);
    expect(() => seedanceReferenceRequest({ ...ok, seconds: 31 })).toThrow(/seconds/);
    expect(() => seedanceReferenceRequest({ ...ok, seconds: 7.5 })).toThrow(/seconds/);
    expect(() => seedanceReferenceRequest({ ...ok, ratio: '4:5' })).toThrow(/ratio/);
    expect(() => seedanceReferenceRequest({ ...ok, resolution: '480p' as never })).toThrow(/resolution/);
    expect(() => seedanceReferenceRequest({ ...ok, prompt: '   ' })).toThrow(/prompt/);
  });
});

describe('toSunraReferenceSyntax', () => {
  it('turns the recipe tokens "Image N" into Sunra\'s "@ImageN" for every attached image', () => {
    const recipePrompt = 'Image 1 and Image 2 walk along the beach at dusk.\n\nImage 1, Image 2 show the two people to feature. Keep each person’s identity.';
    expect(toSunraReferenceSyntax(recipePrompt, 2)).toBe(
      '@Image1 and @Image2 walk along the beach at dusk.\n\n@Image1, @Image2 show the two people to feature. Keep each person’s identity.',
    );
  });

  it('leaves tokens beyond the attached images, lowercase prose and already-converted tokens alone', () => {
    expect(toSunraReferenceSyntax('Image 1 holds Image 3.', 2)).toBe('@Image1 holds Image 3.');
    expect(toSunraReferenceSyntax('the image 2 seconds later', 2)).toBe('the image 2 seconds later');
    expect(toSunraReferenceSyntax('@Image1 waves; @Image 2 nods; Image 2 smiles', 2)).toBe('@Image1 waves; @Image 2 nods; @Image2 smiles');
    expect(toSunraReferenceSyntax('Image 10 is not Image 1', 9)).toBe('Image 10 is not @Image1');
    expect(toSunraReferenceSyntax('XImage 1', 2)).toBe('XImage 1');
  });

  it('does not touch "Image 2" inside quoted dialogue or on-screen text (straight or curly double quotes on one line)', () => {
    const prompt = 'Image 1 points at the screen and says "Look, Image 2 is here!" while Image 2 laughs. The sign reads “Image 1 Studio”.';
    expect(toSunraReferenceSyntax(prompt, 2)).toBe(
      '@Image1 points at the screen and says "Look, Image 2 is here!" while @Image2 laughs. The sign reads “Image 1 Studio”.',
    );
  });

  it('LIMIT (documented): the text alone cannot tell a quoted line from a quoted reference', () => {
    // A slot token a maker put inside quotes reads exactly like dialogue once it is "Image 2", so it stays plain words.
    // engineStepPrompt always appends the identity line outside any quotes, so the person is still bound by "@ImageN".
    expect(toSunraReferenceSyntax('A banner shows "Image 2" in gold.', 2)).toBe('A banner shows "Image 2" in gold.');
    // An unbalanced quote (an inch mark, a stray quote) opens no span: everything after it is converted.
    expect(toSunraReferenceSyntax('A 5" screen shows Image 2.', 2)).toBe('A 5" screen shows @Image2.');
    // A quote that runs over a line break is not treated as one span either.
    expect(toSunraReferenceSyntax('She says "hello\nImage 2" and waves.', 2)).toBe('She says "hello\n@Image2" and waves.');
  });
});

describe('unattachedReferences', () => {
  it('names every reference the prompt asks for that the request does not carry, outside quotes', () => {
    expect(unattachedReferences('@Image1 and @Image2 dance.', 2)).toEqual([]);
    expect(unattachedReferences('@Image1 and @Image3 dance.', 2)).toEqual(['@Image3']);
    expect(unattachedReferences('@Image1 and Image 3 dance with Video 1 and @Audio1.', 2)).toEqual(['Image 3', 'Video 1', '@Audio1']);
    expect(unattachedReferences('@Image 4 waves.', 2)).toEqual(['@Image 4']);
    expect(unattachedReferences('She says "Image 7 and Video 2".', 2)).toEqual([]);
  });
});

describe('estimateSeedanceUsd', () => {
  it('is the brand studio estimator, moved (the brand module re-exports it)', () => {
    expect(estimateVideoUsd).toBe(estimateSeedanceUsd);
    // 720p, 10 s: 241 frames x 921,600 px / 1024 = 216,900 tokens x $10.7/M = $2.3208 -> $2.33.
    expect(estimateSeedanceUsd({ resolution: '720p', seconds: 10, referenceVideoSeconds: 0 })).toBe(2.33);
    // 1080p, 10 s: 488,025 tokens x $11.7/M = $5.7099 -> $5.71.
    expect(estimateSeedanceUsd({ resolution: '1080p', seconds: 10, referenceVideoSeconds: 0 })).toBe(5.71);
  });
});
