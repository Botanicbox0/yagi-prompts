import { describe, expect, it } from 'vitest';
import { costFloor, costTable, IMAGE_MIN_PRICE_KRW, imageCostFloor, imageCostTable, roundUpToHundred } from '@/lib/twings/cost-model';
import {
  arkModelForVideo,
  chargeKrwFor,
  chooseResolution,
  formatResolutionPrice,
  offeredResolutions,
  renderResolution,
  renderableResolution,
} from '@/lib/twings/resolution';

/** docs/CREATOR-RESOLUTION.md — 720p by default, 1080p only when priced, money only from the row. */
const film = (overrides: Partial<Parameters<typeof offeredResolutions>[0]> = {}) => ({
  medium: 'video' as const,
  engine: 'seedance-2.0',
  runtimeSeconds: 15,
  priceCents: 400,
  priceKrw: 5900,
  price1080Cents: 900,
  price1080Krw: 11900,
  ...overrides,
});
const image = film({ medium: 'image', engine: 'gpt-image-2', runtimeSeconds: null, price1080Cents: 0, price1080Krw: 0 });

describe('which resolutions a creator template sells', () => {
  it('offers 720p first, and 1080p only with a price in both currencies', () => {
    expect(offeredResolutions(film())).toEqual(['720p', '1080p']);
    expect(offeredResolutions(film({ price1080Krw: 0 }))).toEqual(['720p']);
    expect(offeredResolutions(film({ price1080Cents: 0 }))).toEqual(['720p']);
    expect(offeredResolutions(film({ priceCents: 0 }))).toEqual([]);
    expect(offeredResolutions(image)).toEqual([]);
  });

  it('defaults an empty request to 720p and never downgrades an unavailable choice', () => {
    expect(chooseResolution(film(), '')).toEqual({ ok: true, resolution: '720p' });
    expect(chooseResolution(film(), undefined)).toEqual({ ok: true, resolution: '720p' });
    expect(chooseResolution(film(), '1080p')).toEqual({ ok: true, resolution: '1080p' });
    expect(chooseResolution(film({ price1080Krw: 0 }), '1080p')).toEqual({ ok: false });
    for (const bad of ['4k', '480p', '1080P', '1080p ', 'x'.repeat(200)]) {
      expect(chooseResolution(film(), bad).ok, bad).toBe(bad === '1080p ');
    }
    expect(chooseResolution(image, '')).toEqual({ ok: true, resolution: null });
    expect(chooseResolution(image, '720p')).toEqual({ ok: false });
  });

  it('lets an authorized render (paid, operator) use what the engine can do, with no price gate', () => {
    expect(renderableResolution(film({ price1080Krw: 0 }), '1080p')).toEqual({ ok: true, resolution: '1080p' });
    expect(renderableResolution(film(), null)).toEqual({ ok: true, resolution: '720p' });
    expect(renderableResolution(film(), '4k')).toEqual({ ok: false });
    expect(renderableResolution(image, null)).toEqual({ ok: true, resolution: null });
    expect(renderableResolution(image, '1080p')).toEqual({ ok: false });
  });

  it('charges the row’s own won price for the resolution, and the base price for a legacy order', () => {
    expect(chargeKrwFor(film(), '720p')).toBe(5900);
    expect(chargeKrwFor(film(), null)).toBe(5900);
    expect(chargeKrwFor(film(), '1080p')).toBe(11900);
    expect(chargeKrwFor(film({ price1080Cents: 0 }), '1080p')).toBeNull();
    expect(chargeKrwFor(film({ priceKrw: 0 }), '720p')).toBeNull();
  });

  it('prints each resolution’s price in the reader’s currency', () => {
    expect(formatResolutionPrice(film(), '720p', 'ko')).toBe('5,900원');
    expect(formatResolutionPrice(film(), '1080p', 'ko')).toBe('11,900원');
    expect(formatResolutionPrice(film(), '720p', 'en')).toBe('$4');
    expect(formatResolutionPrice(film(), '1080p', 'en')).toBe('$9');
  });

  it('reads NULL (legacy, image, brand production) as 720p at the provider', () => {
    expect(renderResolution(null)).toBe('720p');
    expect(renderResolution(undefined)).toBe('720p');
    expect(renderResolution('1080p')).toBe('1080p');
    expect(renderResolution('4k')).toBe('720p');
  });

  it('moves a film longer than one 2.0 task onto 2.5, as the render pass does', () => {
    expect(arkModelForVideo('seedance-2.0', 15)).toEqual({ model: 'seedance-2.0', seconds: 15 });
    expect(arkModelForVideo('seedance-2.0', 30)).toEqual({ model: 'seedance-2.5', seconds: 30 });
    expect(arkModelForVideo(null, 2)).toEqual({ model: 'seedance-2.0', seconds: 4 });
    expect(arkModelForVideo('seedance-2.5', 14)).toEqual({ model: 'seedance-2.5', seconds: 14 });
  });
});

describe('the cost floor under a creator price (a proposal, not a price)', () => {
  it('rounds up only to the next 100 won, without a hidden x,900 markup', () => {
    expect(roundUpToHundred(4909)).toBe(5000);
    expect(roundUpToHundred(4900)).toBe(4900);
    expect(roundUpToHundred(4901)).toBe(5000);
    expect(roundUpToHundred(10)).toBe(100);
  });

  it('prices exact output tokens at 1,400원 without a remake reserve', () => {
    const floor = costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 10 })!;
    expect(floor.providerUsd).toBeCloseTo(2.3112, 6);
    expect(floor.providerKrw).toBe(3236);
    expect(costFloor({ model: 'seedance-2.5', resolution: '1080p', seconds: 10 })!.providerKrw).toBe(7961);
  });

  // Founder decision 2026-10-21: the template floor targets 5%, down from 10%. The subscription
  // allowance keeps 10% of its own (SUBSCRIPTION_TARGET_MARGIN) and is asserted separately.
  it('meets a 5% revenue margin after VAT and PG, with no cost markup or overhead allocation', () => {
    const floor = costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 15 })!;
    const revenue = floor.proposedKrw / 1.1;
    const variable = floor.providerUsd * 1400 + 0.033 * floor.proposedKrw;
    expect((revenue - variable) / revenue).toBeGreaterThanOrEqual(0.05);
    const lowerRevenue = (floor.proposedKrw - 100) / 1.1;
    const lowerVariable = floor.providerUsd * 1400 + 0.033 * (floor.proposedKrw - 100);
    expect((lowerRevenue - lowerVariable) / lowerRevenue).toBeLessThan(0.05);
  });

  it('accounts for the real output aspect ratio instead of adding a blanket contingency', () => {
    const wide = costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 15, aspect: '4:3' })!;
    const portrait = costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 15, aspect: '9:16' })!;
    expect(wide.providerUsd).toBeCloseTo(3.4886480625, 8);
    expect(wide.providerUsd).toBeGreaterThan(portrait.providerUsd);
    expect(costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 30 })!.proposedKrw).toBe(11700);
  });

  it('proposes these floors (the table in docs/CREATOR-RESOLUTION.md)', () => {
    const table = Object.fromEntries(costTable([10, 14, 15, 30]).map((row) => [`${row.model} ${row.resolution} ${row.seconds}s`, row.proposedKrw]));
    expect(table).toEqual({
      'seedance-2.0 720p 10s': 2600,
      'seedance-2.0 720p 14s': 3600,
      'seedance-2.0 720p 15s': 3900,
      'seedance-2.0 1080p 10s': 6400,
      'seedance-2.0 1080p 14s': 8900,
      'seedance-2.0 1080p 15s': 9500,
      'seedance-2.5 720p 10s': 3900,
      'seedance-2.5 720p 14s': 5500,
      'seedance-2.5 720p 15s': 5900,
      'seedance-2.5 720p 30s': 11700,
      'seedance-2.5 1080p 10s': 9600,
      'seedance-2.5 1080p 14s': 13500,
      'seedance-2.5 1080p 15s': 14400,
      'seedance-2.5 1080p 30s': 28800,
    });
  });
});

describe('image cost floor — one price per engine (founder, 2026-10-21)', () => {
  it('prices each image model from its own official per-image cost at a 5% margin', () => {
    const floors = Object.fromEntries(imageCostTable().map((row) => [row.engine, row.proposedKrw]));
    expect(floors).toEqual({
      'gpt-image-2': 500,
      // Measured 2026-10-24 ($0.094 with the selfie): the 5% floor is 159원, lifted to the 200원 minimum.
      'gpt-image-2.5-flare': 200,
      'gpt-image-2.5-sunburst': 1100,
      'seedream-5.0-pro': 200,
      // The 5% floor is 100원; the founder's 200원 minimum per image lifts it (2026-10-21).
      'seedream-5.0-lite': 200,
      // R2: ≈73원 at 2K with one reference — the same 200원 minimum applies (PLATFORM-2.0 §9.2).
      'nano-banana-2.1': 200,
    });
  });

  it('never proposes an image below the 200원 minimum, and leaves pricier engines on their own floor', () => {
    for (const row of imageCostTable()) expect(row.proposedKrw, row.engine).toBeGreaterThanOrEqual(IMAGE_MIN_PRICE_KRW);
    expect(imageCostFloor({ engine: 'gpt-image-2.5-sunburst' }).proposedKrw).toBe(1100);
  });

  it('meets the 5% revenue margin and no more than a 100-won rounding above it', () => {
    for (const row of imageCostTable()) {
      const revenue = row.proposedKrw / 1.1;
      const margin = (revenue - row.providerKrw - 0.033 * row.proposedKrw) / revenue;
      expect(margin, row.engine).toBeGreaterThanOrEqual(0.05);
      if (row.proposedKrw > IMAGE_MIN_PRICE_KRW) {
        const lower = (row.proposedKrw - 100) / 1.1;
        expect((lower - row.providerKrw - 0.033 * (row.proposedKrw - 100)) / lower, row.engine).toBeLessThan(0.05);
      }
    }
  });

  it('charges Seedream Pro nothing for the first reference and $0.003 from the second', () => {
    expect(imageCostFloor({ engine: 'seedream-5.0-pro', referenceImages: 1 }).providerUsd).toBe(0.09);
    expect(imageCostFloor({ engine: 'seedream-5.0-pro', referenceImages: 3 }).providerUsd).toBe(0.096);
  });
});
