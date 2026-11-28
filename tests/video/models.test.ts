import { describe, expect, it } from 'vitest';
import { quoteArkVideo } from '@/lib/ark/pricing';
import { costFloor } from '@/lib/twings/cost-model';
import { offeredResolutions, renderableResolution } from '@/lib/twings/resolution';
import { UnknownVideoEngineError, arkModelForVideo, isMagi2Model, isVideoModelKey, quoteVideo, videoEngineSpec, videoModelForEngine, videoModelLabel, videoResolutions } from '@/lib/video/models';

/** One view over the video tables (lib/video/models.ts): the engine → model rule, limits and list prices. */

describe('video models', () => {
  it('keeps the Seedance rule and routes kling-omni to the configured Kling model', () => {
    expect(videoModelForEngine('seedance-2.0', 10)).toEqual(arkModelForVideo('seedance-2.0', 10));
    expect(videoModelForEngine('seedance-2.0', 30)).toEqual({ model: 'seedance-2.5', seconds: 30 });
    expect(videoModelForEngine(null, 5)).toEqual({ model: 'seedance-2.0', seconds: 5 });
    expect(videoModelForEngine('kling-omni', 10, {})).toEqual({ model: 'kling-3.0-omni', seconds: 10 });
    expect(videoModelForEngine('kling-omni', 30, {})).toEqual({ model: 'kling-3.0-omni', seconds: 15 });
    expect(videoModelForEngine('kling-omni', 30, { KLING_VIDEO_MODEL: 'kling-4.0' })).toEqual({ model: 'kling-4.0', seconds: 30 });
    expect(videoModelForEngine('magi-2', 10)).toEqual({ model: 'magi-2', seconds: 10 });
    expect(videoModelForEngine('magi-2', 2)).toEqual({ model: 'magi-2', seconds: 4 });
    expect(videoModelForEngine('magi-2', 45)).toEqual({ model: 'magi-2', seconds: 30 });
    expect(isVideoModelKey('kling-4.0')).toBe(true);
    expect(isVideoModelKey('seedance-2.0-mini')).toBe(true);
    expect(isVideoModelKey('magi-2')).toBe(true);
    expect(isMagi2Model('magi-2')).toBe(true);
    expect(isMagi2Model('seedance-2.5')).toBe(false);
    expect(isVideoModelKey('kling-omni')).toBe(false);
  });

  it('describes what a step on each engine may ask for, keeping existing engines pinned', () => {
    expect(videoEngineSpec('seedance-2.0')).toEqual({
      model: 'seedance-2.0',
      label: 'Seedance 2.0',
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      aspects: null,
      resolutions: ['480p', '720p', '1080p', '4k'],
      maxReferenceImages: 12,
    });
    expect(videoEngineSpec('seedance-2.5')).toEqual({
      model: 'seedance-2.5',
      label: 'Seedance 2.5',
      minDurationSeconds: 4,
      maxDurationSeconds: 30,
      aspects: null,
      resolutions: ['480p', '720p', '1080p'],
      maxReferenceImages: 50,
    });
    expect(videoEngineSpec('kling-omni', {})).toEqual({
      model: 'kling-3.0-omni',
      label: 'Kling 3.0 Omni',
      minDurationSeconds: 3,
      maxDurationSeconds: 15,
      aspects: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
      maxReferenceImages: 7,
    });
    expect(videoEngineSpec('kling-omni', { KLING_VIDEO_MODEL: 'kling-4.0' })).toMatchObject({ model: 'kling-4.0', maxDurationSeconds: 30, maxReferenceImages: 10 });
    expect(videoEngineSpec('magi-2')).toEqual({
      model: 'magi-2',
      label: 'MAGI-2',
      minDurationSeconds: 4,
      maxDurationSeconds: 30,
      aspects: ['9:16', '16:9', '1:1', '4:3', '3:4'],
      resolutions: ['1080p'],
      maxReferenceImages: 10,
    });
    expect(videoEngineSpec('magi-2').aspects).not.toContain('21:9');
    expect(videoResolutions('kling-3.0-omni')).toEqual(['720p', '1080p']);
    expect(videoResolutions('seedance-2.0-mini')).toEqual(['480p', '720p']);
    expect(videoResolutions('magi-2')).toEqual(['1080p']);
    expect(videoModelLabel('kling-4.0')).toBe('Kling 4.0');
    expect(videoModelLabel('seedance-2.5')).toBe('Seedance 2.5');
    expect(videoModelLabel('magi-2')).toBe('MAGI-2');
  });

  it('quotes ModelArk by tokens, Kling by the second, and MAGI-2 at $0.08/s × 1.05', () => {
    expect(quoteVideo({ model: 'seedance-2.0', resolution: '720p', seconds: 10, aspect: '9:16' })).toEqual(quoteArkVideo({ model: 'seedance-2.0', resolution: '720p', seconds: 10, aspect: '9:16' }));
    expect(quoteVideo({ model: 'seedance-2.5', resolution: '720p', seconds: 10, aspect: '9:16' })).toEqual(quoteArkVideo({ model: 'seedance-2.5', resolution: '720p', seconds: 10, aspect: '9:16' }));
    expect(quoteVideo({ model: 'kling-3.0-omni', resolution: '720p', seconds: 10, aspect: '9:16' })).toEqual({ providerUsd: 1.12, providerTokens: null });
    expect(quoteVideo({ model: 'kling-4.0', resolution: '1080p', seconds: 10, aspect: '16:9' })).toEqual({ providerUsd: 2.35, providerTokens: null });
    expect(quoteVideo({ model: 'kling-3.0-omni', resolution: '720p', seconds: 20, aspect: '9:16' })).toBeNull();
    expect(quoteVideo({ model: 'magi-2', resolution: '1080p', seconds: 10, aspect: '9:16' })).toEqual({ providerUsd: 0.84, providerTokens: null });
    expect(quoteVideo({ model: 'magi-2', resolution: '720p', seconds: 10, aspect: '9:16' })).toBeNull();
    expect(quoteVideo({ model: 'magi-2', resolution: '480p', seconds: 10, aspect: '9:16' })).toBeNull();
    expect(quoteVideo({ model: 'magi-2', resolution: '1080p', seconds: 3, aspect: '9:16' })).toBeNull();
    expect(quoteVideo({ model: 'magi-2', resolution: '1080p', seconds: 31, aspect: '9:16' })).toBeNull();
    expect(quoteVideo({ model: 'magi-2', resolution: '1080p', seconds: 10, aspect: '4:5' })).toBeNull();
    const floor = costFloor({ model: 'kling-3.0-omni', resolution: '720p', seconds: 10, aspect: '9:16' });
    // $1.12 × 1,400 = 1,568원 → / ((1 − 0.05)/1.1 − 0.033) = 1,880.6원 → 1,900원.
    expect(floor).toMatchObject({ model: 'kling-3.0-omni', providerUsd: 1.12, providerKrw: 1568, proposedKrw: 1900 });
    const magiFloor = costFloor({ model: 'magi-2', resolution: '1080p', seconds: 10, aspect: '9:16' });
    expect(magiFloor).toMatchObject({ model: 'magi-2', resolution: '1080p', seconds: 10, providerUsd: 0.84, providerKrw: 1176, proposedKrw: 1500 });
  });

  it('refuses unknown video engine/model ids instead of falling back to Seedance', () => {
    expect(() => videoModelForEngine('unknown-engine', 10)).toThrow(UnknownVideoEngineError);
    expect(() => arkModelForVideo('unknown-engine', 10)).toThrow(UnknownVideoEngineError);
    expect(() => videoEngineSpec('unknown-engine' as never)).toThrow(UnknownVideoEngineError);
    expect(() => videoResolutions('unknown-engine' as never)).toThrow(UnknownVideoEngineError);
    expect(() => quoteVideo({ model: 'unknown-engine' as never, resolution: '720p', seconds: 10, aspect: '9:16' })).toThrow(UnknownVideoEngineError);
    expect(() => videoModelLabel('unknown-engine' as never)).toThrow(UnknownVideoEngineError);
  });

  it('offers 1080p on a Kling template the same way it does on Seedance 2.5', () => {
    const film = { medium: 'video' as const, engine: 'kling-omni', runtimeSeconds: 10, priceCents: 400, priceKrw: 5000, price1080Cents: 700, price1080Krw: 9000 };
    expect(offeredResolutions(film)).toEqual(['720p', '1080p']);
    expect(offeredResolutions({ ...film, price1080Krw: 0 })).toEqual(['720p']);
    expect(renderableResolution(film, '1080p')).toEqual({ ok: true, resolution: '1080p' });
  });
});
