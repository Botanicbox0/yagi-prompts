import { describe, expect, it } from 'vitest';
import { estimateImageUsd } from '@/lib/images/engines';
import { quoteVideo } from '@/lib/video/models';
import { baseCredits, baseKrw, creditsToKrw, isRaise, makeEarning, NET_SHARE } from '@/lib/twings/template-price';

/** docs/PLATFORM-2.0.md §19.2 (founder, 2026-11-02): the numbers the founder agreed to, as a contract. */

const film = (seconds: number) => quoteVideo({ model: 'seedance-2.5', seconds, resolution: '720p', aspect: '9:16' })!.providerUsd;
const set = (engine: 'nano-banana-2.1' | 'seedream-5.0-pro', n: number) => estimateImageUsd(engine, 1) * n;

describe('template price', () => {
  it('puts an image set at cost × 1.12 and a film at a 6% margin, in 10원 credits', () => {
    expect(baseCredits({ medium: 'image', providerUsd: set('nano-banana-2.1', 5) })).toBe(41);
    expect(baseCredits({ medium: 'image', providerUsd: set('seedream-5.0-pro', 5) })).toBe(71);
    expect(baseCredits({ medium: 'video', providerUsd: film(10) })).toBe(345);
    expect(baseCredits({ medium: 'video', providerUsd: film(15) })).toBe(517);
  });

  it('keeps the live film prices at the lower edge of the 5~7% band', () => {
    expect(baseKrw({ medium: 'video', providerUsd: film(10) }, 'min')).toBe(3900);
    expect(baseKrw({ medium: 'video', providerUsd: film(15) }, 'min')).toBe(5900);
    expect(baseKrw({ medium: 'video', providerUsd: film(10) })).toBe(4000);
  });

  it('sells credits in won after VAT and the contract card fee, never an image under 200원', () => {
    expect(NET_SHARE).toBeCloseTo(0.8751, 4);
    expect(creditsToKrw(41, 'image')).toBe(500);
    expect(creditsToKrw(6, 'image')).toBe(200);
  });

  it('gives the creative 80% of the whole margin, and nothing on a company account', () => {
    const providerUsd = set('nano-banana-2.1', 5);
    const at1000 = makeEarning({ medium: 'image', providerUsd, priceKrw: 1000 });
    expect(at1000.creator).toBe(Math.floor(at1000.margin * 0.8));
    expect(at1000.creator).toBeGreaterThan(400);
    const raised = makeEarning({ medium: 'image', providerUsd, priceKrw: 2000 });
    expect(raised.creator).toBeGreaterThan(at1000.creator);
    expect(makeEarning({ medium: 'image', providerUsd, priceKrw: 1000, company: true })).toMatchObject({ creator: 0, platform: at1000.margin });
  });

  it('never splits a loss', () => {
    expect(makeEarning({ medium: 'video', providerUsd: film(10), priceKrw: 1000 })).toEqual({ margin: 0, creator: 0, platform: 0 });
  });

  it('takes a raise in whole hundreds from 0 to 5,000원', () => {
    expect([0, 100, 5000].every(isRaise)).toBe(true);
    expect([-100, 50, 5100, 1.5].some(isRaise)).toBe(false);
  });
});
