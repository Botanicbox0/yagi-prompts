import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_ASPECT,
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
  enginesForMedium,
  estimateImageUsd,
  imageSizeFor,
  isEngineId,
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
  it('names the two founder-chosen families and defaults to GPT Image 2 for images', () => {
    expect(IMAGE_ENGINE_IDS).toEqual(['seedream-5.0-pro', 'seedream-5.0-lite', 'gpt-image-2']);
    expect(defaultEngine('image')).toBe('gpt-image-2');
    expect(defaultEngine('video')).toBe('seedance-2.0');
    expect(enginesForMedium('video')).toEqual(['seedance-2.0', 'seedance-2.5']);
    expect(isEngineId('kling-3.0')).toBe(false);
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
    expect(estimateImageUsd('seedream-5.0-pro', 1)).toBe(0.093);
    expect(estimateImageUsd('seedream-5.0-lite', 0)).toBe(0.035);
    expect(estimateImageUsd('gpt-image-2', 1)).toBe(0.24);
    expect(IMAGE_ENGINES['gpt-image-2'].maxReferenceImages).toBe(16);
    expect(IMAGE_ENGINES['seedream-5.0-pro'].model).toBe('dola-seedream-5-0-pro-260628');
    expect(IMAGE_ENGINES['seedream-5.0-lite'].model).toBe('seedream-5-0-260128');
  });
});
