import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/lib/recipes/schema';
import {
  parseSelectedFrames,
  selectiveOrderKrw,
  sliceCarouselRecipe,
  templateImageSetInfo,
} from '@/lib/twings/selective-frames';

const FIVE_FRAME_RECIPE: Recipe = {
  version: 2,
  slots: {
    selfie: { kind: 'image', source: 'user', required: true },
  },
  steps: [
    {
      id: 'style_anchor',
      kind: 'image',
      engine: 'gpt-image-2',
      inputs: ['selfie'],
      prompt: 'Clean daylight reference lighting portrait of {{selfie}}.',
      params: { aspect: '4:5' },
    },
    {
      id: 'frame1',
      kind: 'image',
      engine: 'gpt-image-2',
      inputs: ['selfie', 'style_anchor'],
      prompt: 'Frame 1 full-body runway look featuring {{selfie}} matching {{style_anchor}}.',
      params: { aspect: '4:5' },
    },
    {
      id: 'frame2',
      kind: 'image',
      engine: 'gpt-image-2',
      inputs: ['selfie'],
      prompt: 'Frame 2 medium editorial portrait featuring {{selfie}} in daylight.',
      params: { aspect: '4:5' },
    },
    {
      id: 'frame3',
      kind: 'image',
      engine: 'gpt-image-2',
      inputs: ['selfie', 'style_anchor'],
      prompt: 'Frame 3 close-up editorial portrait of {{selfie}} referencing {{style_anchor}}.',
      params: { aspect: '4:5' },
    },
    {
      id: 'frame4',
      kind: 'image',
      engine: 'gpt-image-2',
      inputs: ['selfie'],
      prompt: 'Frame 4 street candid motion shot featuring {{selfie}}.',
      params: { aspect: '4:5' },
    },
    {
      id: 'frame5',
      kind: 'image',
      engine: 'gpt-image-2',
      inputs: ['selfie'],
      prompt: 'Frame 5 dusk wide editorial shot featuring {{selfie}}.',
      params: { aspect: '4:5' },
    },
  ],
  output: {
    frames: ['frame1', 'frame2', 'frame3', 'frame4', 'frame5'],
  },
};

const TEMPLATE_META = {
  medium: 'image' as const,
  engine: 'gpt-image-2' as const,
  media: {},
  runtimeSeconds: null,
  priceCents: 0,
  priceKrw: 5900,
  price1080Cents: 0,
  price1080Krw: 0,
};

describe('selective image set parsing, KRW pricing, and carousel slicing', () => {
  it('parses comma/JSON selections, bounds indices, and normalizes full selection to null', () => {
    expect(parseSelectedFrames('[0, 2, 4]', 5)).toEqual([0, 2, 4]);
    expect(parseSelectedFrames('3,1,3,99,-1', 5)).toEqual([1, 3]);
    expect(parseSelectedFrames([0, 1, 2, 3, 4], 5)).toBeNull();
    expect(parseSelectedFrames('', 5)).toBeNull();
    expect(parseSelectedFrames('not-valid-json[', 5)).toBeNull();
  });

  it('computes consistent selective KRW prices < full price and keeps video orders un-sliced', () => {
    const info = templateImageSetInfo(TEMPLATE_META, FIVE_FRAME_RECIPE);
    expect(info.totalFrames).toBe(5);

    const twoCutQuote = selectiveOrderKrw(TEMPLATE_META, FIVE_FRAME_RECIPE, [0, 2], null);
    expect(twoCutQuote.normalizedFrames).toEqual([0, 2]);
    expect(twoCutQuote.amountKrw).not.toBeNull();
    expect(twoCutQuote.amountKrw!).toBeGreaterThanOrEqual(200);
    expect(twoCutQuote.amountKrw!).toBeLessThan(TEMPLATE_META.priceKrw);

    const oneCutQuote = selectiveOrderKrw(TEMPLATE_META, FIVE_FRAME_RECIPE, [2], null);
    expect(oneCutQuote.normalizedFrames).toEqual([2]);
    expect(oneCutQuote.amountKrw!).toBeLessThan(twoCutQuote.amountKrw!);

    const fullQuote = selectiveOrderKrw(TEMPLATE_META, FIVE_FRAME_RECIPE, [0, 1, 2, 3, 4], null);
    expect(fullQuote).toEqual({ amountKrw: TEMPLATE_META.priceKrw, normalizedFrames: null });

    const videoQuote1080 = selectiveOrderKrw(
      { ...TEMPLATE_META, medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 8, priceCents: 790, priceKrw: 9900, price1080Cents: 1190, price1080Krw: 14900 },
      null,
      [0],
      '1080p',
    );
    expect(videoQuote1080).toEqual({ amountKrw: 14900, normalizedFrames: null });

    const videoQuoteDefault = selectiveOrderKrw(
      { ...TEMPLATE_META, medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 8, priceCents: 790, priceKrw: 9900, price1080Cents: 1190, price1080Krw: 14900 },
      null,
      [0],
      null,
    );
    expect(videoQuoteDefault).toEqual({ amountKrw: 9900, normalizedFrames: null });
  });

  it('slices carousel recipes while preserving transitive setup dependencies', () => {
    const singleSlice = sliceCarouselRecipe(FIVE_FRAME_RECIPE, [2]);
    expect(singleSlice.output).toEqual({ from: 'frame3' });
    expect(singleSlice.steps.map((s) => s.id)).toEqual(['style_anchor', 'frame3']);

    const multiSlice = sliceCarouselRecipe(FIVE_FRAME_RECIPE, [1, 3]);
    expect(multiSlice.output).toEqual({ frames: ['frame2', 'frame4'] });
    expect(multiSlice.steps.map((s) => s.id)).toEqual(['frame2', 'frame4']);

    const allSlice = sliceCarouselRecipe(FIVE_FRAME_RECIPE, [0, 1, 2, 3, 4]);
    expect(allSlice).toBe(FIVE_FRAME_RECIPE);
  });
});
