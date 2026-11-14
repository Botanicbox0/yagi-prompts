import { describe, expect, it } from 'vitest';
import {
  HOUSE_MARQUEE_ITEMS,
  MARQUEE_DURATION_SECONDS,
  MARQUEE_MAX_ITEMS,
  marqueeItems,
} from '@/lib/marquee';

describe('marquee strip (§5.3-5)', () => {
  it('loops in 40s and names only what the studio actually runs (founder, 2026-09-11)', () => {
    expect(MARQUEE_DURATION_SECONDS).toBe(40);
    for (const name of ['SEEDANCE 2.5', 'SEEDREAM 5.5', 'GPT IMAGE 2']) {
      expect(HOUSE_MARQUEE_ITEMS).toContain(name);
    }
    // Tools the front door used to advertise and TWINGS never ran.
    for (const name of ['KLING', 'VEO', 'COMFYUI', 'ELEVENLABS', 'RUNWAY', 'HIGGSFIELD']) {
      expect(HOUSE_MARQUEE_ITEMS).not.toContain(name);
    }
  });

  it('leads with the catalog’s own models and tools, upper-cased', () => {
    const items = marqueeItems({ models: ['Kling 3.0', 'Qwen3-TTS'], tools: ['ComfyUI'] });
    expect(items.slice(0, 3)).toEqual(['KLING 3.0', 'QWEN3-TTS', 'COMFYUI']);
  });

  it('de-duplicates case-insensitively across catalog and house names', () => {
    const items = marqueeItems({ models: ['kling'], tools: ['Kling'] }, 20);
    expect(items.filter((item) => item === 'KLING')).toHaveLength(1);
  });

  it('tops up from the house list so a thin catalog still reads as a ticker', () => {
    const items = marqueeItems({ models: ['Kling 3.0'], tools: [] });
    expect(items).toHaveLength(MARQUEE_MAX_ITEMS);
    expect(items[0]).toBe('KLING 3.0');
    expect(items).toContain('REELS');
  });

  it('still renders a full strip with an empty catalog', () => {
    const items = marqueeItems({ models: [], tools: [] });
    expect(items).toEqual(HOUSE_MARQUEE_ITEMS.slice(0, MARQUEE_MAX_ITEMS));
  });

  it('drops blanks and honours the cap', () => {
    expect(marqueeItems({ models: ['  ', ''], tools: [] }, 3)).toHaveLength(3);
    expect(marqueeItems({ models: ['a', 'b', 'c', 'd'], tools: [] }, 2)).toEqual(['A', 'B']);
  });
});
