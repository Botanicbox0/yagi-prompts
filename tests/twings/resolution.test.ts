import { describe, expect, it } from 'vitest';
import { costFloor, costTable, roundUpToX900 } from '@/lib/twings/cost-model';
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
  it('rounds up to the catalogue’s x,900 shape', () => {
    expect(roundUpToX900(4909)).toBe(5900);
    expect(roundUpToX900(4900)).toBe(4900);
    expect(roundUpToX900(4901)).toBe(5900);
    expect(roundUpToX900(10)).toBe(900);
  });

  it('prices the provider at the ModelArk page rate, +10% failures, at 1,400원', () => {
    const floor = costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 10 })!;
    // docs/TEMPLATES-IA.md §12: "2.5 720p 10초 ≈ 3,560원, 1080p 10초 ≈ 8,760원".
    expect(floor.providerKrw).toBe(3557);
    expect(costFloor({ model: 'seedance-2.5', resolution: '1080p', seconds: 10 })!.providerKrw).toBe(8763);
  });

  it('needs ~1.52× the provider cost to clear VAT, the PG fee and a 20% margin', () => {
    const floor = costFloor({ model: 'seedance-2.5', resolution: '720p', seconds: 15 })!;
    // Over the raw provider bill (failures not yet added) the multiplier is ~1.518.
    expect(floor.floorKrw / (floor.providerUsd * 1400)).toBeCloseTo(1.518, 2);
    // Check the margin directly at the proposed price.
    const revenue = floor.proposedKrw / 1.1;
    const variable = floor.providerKrw + 0.033 * floor.proposedKrw;
    expect(revenue / variable).toBeGreaterThanOrEqual(1.2);
  });

  it('proposes these floors (the table in docs/CREATOR-RESOLUTION.md)', () => {
    const table = Object.fromEntries(costTable([10, 14, 15, 30]).map((row) => [`${row.model} ${row.resolution} ${row.seconds}s`, row.proposedKrw]));
    expect(table).toEqual({
      'seedance-2.0 720p 10s': 3900,
      'seedance-2.0 720p 14s': 4900,
      'seedance-2.0 720p 15s': 4900,
      'seedance-2.0 1080p 10s': 7900,
      'seedance-2.0 1080p 14s': 11900,
      'seedance-2.0 1080p 15s': 11900,
      'seedance-2.5 720p 10s': 5900,
      'seedance-2.5 720p 14s': 6900,
      'seedance-2.5 720p 15s': 7900,
      'seedance-2.5 720p 30s': 14900,
      'seedance-2.5 1080p 10s': 12900,
      'seedance-2.5 1080p 14s': 17900,
      'seedance-2.5 1080p 15s': 18900,
      'seedance-2.5 1080p 30s': 36900,
    });
  });
});
