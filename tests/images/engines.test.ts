import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_ASPECT,
  GPT_IMAGE_25,
  GPT_IMAGE_MAX,
  IMAGE_ASPECTS,
  IMAGE_ENGINES,
  IMAGE_ENGINE_IDS,
  SEEDREAM_PIXELS_MAX,
  SEEDREAM_PIXELS_MIN,
  SEEDREAM_PRO_CHEAP_PIXELS_MAX,
  aspectsForMedium,
  defaultAspect,
  defaultEngine,
  engineLabel,
  enginesForMedium,
  estimateImageUsd,
  imageSizeFor,
  isEngineId,
  isGoogleEngine,
  isOpenAiEngine,
  sizeString,
} from '@/lib/images/engines';

/**
 * The size tables are the contract with two paid APIs. Every entry must be a size the engine will
 * accept AND the shape the visitor asked for — an off-by-one here is a refused render or a
 * cropped face, so the constraints are pinned from the documentation rather than trusted.
 */

function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number) as [number, number];
  return w / h;
}

describe('image engines (docs/TEMPLATES-IA.md §7)', () => {
  it('names the two founder-chosen families and defaults images to GPT Image 2.5 Flare (founder, 2026-10-24, after its real-selfie smoke)', () => {
    expect(IMAGE_ENGINE_IDS).toEqual(['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'seedream-5.0-pro', 'seedream-5.0-lite', 'nano-banana-2.1']);
    expect(defaultEngine('image')).toBe('gpt-image-2.5-flare');
    expect(defaultEngine('video')).toBe('seedance-2.0');
    expect(enginesForMedium('video')).toEqual(['seedance-2.0', 'seedance-2.5', 'kling-omni']);
    expect(isEngineId('kling-3.0')).toBe(false);
    expect(isEngineId('kling-omni')).toBe(true);
    expect(engineLabel('kling-omni')).toBe('KLING OMNI');
    expect(engineLabel('seedance-2.5')).toBe('SEEDANCE 2.5');
    expect(isOpenAiEngine('gpt-image-2.5-sunburst')).toBe(true);
    expect(isOpenAiEngine('seedream-5.0-pro')).toBe(false);
    for (const id of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2'] as const) {
      expect(IMAGE_ENGINES[id].provider).toBe('openai');
      expect(IMAGE_ENGINES[id].model).toBe(id);
    }
  });

  it('renders every OpenAI engine at its top tier — never below high (founder, 2026-09-06)', () => {
    expect(IMAGE_ENGINES['gpt-image-2'].quality).toBe('high');
    for (const id of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const) {
      expect(['high', 'xhigh', 'max']).toContain(IMAGE_ENGINES[id].quality);
    }
    for (const id of ['seedream-5.0-pro', 'seedream-5.0-lite', 'nano-banana-2.1'] as const) expect(IMAGE_ENGINES[id].quality).toBeUndefined();
  });

  it('renders Nano Banana 2.1 at Gemini’s own 2K sizes and prices it at the 2K rate (PLATFORM-2.0 §9.2, R2)', () => {
    const spec = IMAGE_ENGINES['nano-banana-2.1'];
    expect(spec).toMatchObject({ provider: 'google', model: 'gemini-nano-banana-2.1', usdPerRender: 0.0504, maxReferenceImages: 14 });
    expect(isGoogleEngine('nano-banana-2.1')).toBe(true);
    expect(isGoogleEngine('gpt-image-2')).toBe(false);
    expect(isOpenAiEngine('nano-banana-2.1')).toBe(false);
    // The guide's table: 4:5 → 1856×2304, 9:16 → 1536×2752, 16:9 → 2752×1536, 3:4 → 1792×2400, 1:1 → 2048².
    expect(sizeString(imageSizeFor('nano-banana-2.1', '4:5'))).toBe('1856x2304');
    expect(sizeString(imageSizeFor('nano-banana-2.1', '9:16'))).toBe('1536x2752');
    expect(sizeString(imageSizeFor('nano-banana-2.1', '1:1'))).toBe('2048x2048');
    expect(estimateImageUsd('nano-banana-2.1', 1)).toBe(0.052);
    expect(estimateImageUsd('nano-banana-2.1', 0)).toBe(0.05);
  });

  it('keeps the GPT Image 2.5 sizes inside the documented window (16-grid, 1:3–3:1, ≤3840 edge, 655,360–8,294,400 px)', () => {
    for (const engine of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const) {
      for (const aspect of IMAGE_ASPECTS) {
        const { width, height } = imageSizeFor(engine, aspect);
        expect(width % 16, `${engine} ${aspect}`).toBe(0);
        expect(height % 16, `${engine} ${aspect}`).toBe(0);
        expect(Math.max(width, height)).toBeLessThanOrEqual(GPT_IMAGE_25.maxEdge);
        expect(width * height).toBeGreaterThanOrEqual(GPT_IMAGE_25.minPixels);
        expect(width * height).toBeLessThanOrEqual(GPT_IMAGE_25.maxPixels);
        expect(width / height).toBeGreaterThanOrEqual(1 / 3);
        expect(width / height).toBeLessThanOrEqual(3);
      }
    }
  });

  it('defaults the picker to the Instagram feed ratio', () => {
    expect(DEFAULT_IMAGE_ASPECT).toBe('4:5');
    expect(defaultAspect('image')).toBe('4:5');
    expect(defaultAspect('video')).toBe('9:16');
    expect(aspectsForMedium('image')[0]).toBe('4:5');
  });

  it('keeps every size within 3% of the aspect it stands for', () => {
    for (const engine of IMAGE_ENGINE_IDS) {
      for (const aspect of IMAGE_ASPECTS) {
        const { width, height } = imageSizeFor(engine, aspect);
        expect(Math.abs(width / height / ratioOf(aspect) - 1), `${engine} ${aspect}`).toBeLessThan(0.03);
      }
    }
  });

  it('keeps Seedream sizes inside the documented explicit-size window', () => {
    for (const engine of ['seedream-5.0-pro', 'seedream-5.0-lite'] as const) {
      for (const aspect of IMAGE_ASPECTS) {
        const { width, height } = imageSizeFor(engine, aspect);
        const pixels = width * height;
        expect(pixels, `${engine} ${aspect}`).toBeGreaterThanOrEqual(SEEDREAM_PIXELS_MIN);
        expect(pixels, `${engine} ${aspect}`).toBeLessThanOrEqual(SEEDREAM_PIXELS_MAX);
        expect(width / height).toBeGreaterThanOrEqual(1 / 16);
        expect(width / height).toBeLessThanOrEqual(16);
      }
    }
  });

  it('renders Seedream Pro at 2K — above the $0.045 step, priced at the $0.09 rate (founder, 2026-09-06)', () => {
    for (const aspect of IMAGE_ASPECTS) {
      const { width, height } = imageSizeFor('seedream-5.0-pro', aspect);
      expect(width * height, aspect).toBeGreaterThan(SEEDREAM_PRO_CHEAP_PIXELS_MAX);
    }
    expect(IMAGE_ENGINES['seedream-5.0-pro'].usdPerRender).toBe(0.09);
    expect(sizeString(imageSizeFor('seedream-5.0-pro', '4:5'))).toBe('1728x2160');
  });

  it('keeps GPT Image 2 sizes on the 16-pixel grid, within the ceiling and the 1:3–3:1 band', () => {
    for (const aspect of IMAGE_ASPECTS) {
      const { width, height } = imageSizeFor('gpt-image-2', aspect);
      expect(width % 16, aspect).toBe(0);
      expect(height % 16, aspect).toBe(0);
      expect(width).toBeLessThanOrEqual(GPT_IMAGE_MAX.width);
      expect(height).toBeLessThanOrEqual(GPT_IMAGE_MAX.height);
      expect(width / height).toBeGreaterThanOrEqual(1 / 3);
      expect(width / height).toBeLessThanOrEqual(3);
    }
    expect(sizeString(imageSizeFor('gpt-image-2', '4:5'))).toBe('1024x1280');
  });

  it('prices a render with the visitor photo counted as one reference', () => {
    // Official ModelArk pricing (2026-10-21): Pro's first reference is free, $0.003 from the second;
    // Lite's reference input is free.
    expect(estimateImageUsd('seedream-5.0-pro', 1)).toBe(0.09);
    expect(estimateImageUsd('seedream-5.0-pro', 2)).toBe(0.093);
    expect(estimateImageUsd('seedream-5.0-lite', 0)).toBe(0.035);
    expect(estimateImageUsd('seedream-5.0-lite', 1)).toBe(0.035);
    expect(estimateImageUsd('gpt-image-2', 1)).toBe(0.24);
    // Measured 2026-10-24: $0.082 a render + $0.012 for the selfie — below gpt-image-2 high, the token count sets the bill.
    expect(estimateImageUsd('gpt-image-2.5-flare', 1)).toBe(0.094);
    expect(estimateImageUsd('gpt-image-2.5-sunburst', 1)).toBeGreaterThanOrEqual(estimateImageUsd('gpt-image-2.5-flare', 1));
    expect(IMAGE_ENGINES['gpt-image-2'].maxReferenceImages).toBe(16);
    expect(IMAGE_ENGINES['seedream-5.0-pro'].model).toBe('dola-seedream-5-0-pro-260628');
    expect(IMAGE_ENGINES['seedream-5.0-lite'].model).toBe('seedream-5-0-260128');
  });
});
