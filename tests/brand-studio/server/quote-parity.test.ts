import { describe, expect, it } from 'vitest';
import { STUDIO_CREDIT_KRW, creditsLeft, creditsOf } from '@/lib/brand-studio/credits';
import { billedUsd, estimateImageUsd, estimateVideoUsd, type StudioVideoResolution } from '@/lib/brand-studio/models';
import { imageRunKrw, regionEditRun, remixRunUsd, usageKrw } from '@/lib/brand-studio/usage-rate';
import { regionCredits } from '@/components/brand-studio/dock-model';

/**
 * The figure a screen shows before a press has to be the figure a finished run takes. A run on the
 * account lane reports the provider's own credits (one credit = one US cent), so the estimates are held
 * here against what the provider quoted and charged on 2026-11-18:
 *
 *   - `estimate_cost` on the account (free, nothing generated) for every setting below, and
 *   - the account's usage history for the production jobs named in each case.
 */
const cents = (usd: number) => Math.round(usd * 100);

describe('a price is billed in whole cents', () => {
  it('rounds a list price up to the cent and leaves a whole cent alone', () => {
    expect(billedUsd(0.043)).toBe(0.05);
    expect(billedUsd(0.035)).toBe(0.04);
    expect(billedUsd(0.134)).toBe(0.14);
    expect(billedUsd(0.02)).toBe(0.02);
    expect(billedUsd(0.24)).toBe(0.24);
    expect(billedUsd(0)).toBe(0);
    expect(billedUsd(Number.NaN)).toBe(0);
  });
});

describe('pictures: the provider quote, to the credit', () => {
  // [resolution, credits with 0, 1, 2, 3, 4 input images]
  const seedream: Array<[string, number[]]> = [
    ['1K', [2, 3, 4, 5, 6]],
    ['2K', [4, 5, 6, 6, 7]],
  ];
  it.each(seedream)('Seedream 5.5 at %s', (resolution, quoted) => {
    expect(quoted.map((_, references) => cents(estimateImageUsd({ model: 'seedream-5.5', resolution, references })))).toEqual(quoted);
  });

  it('Nano Banana Pro: 14 credits up to 2K and 24 at 4K, whatever the references', () => {
    for (const references of [0, 1, 3]) {
      expect(cents(estimateImageUsd({ model: 'nano-banana-pro', resolution: '1K', references }))).toBe(14);
      expect(cents(estimateImageUsd({ model: 'nano-banana-pro', resolution: '2K', references }))).toBe(14);
      expect(cents(estimateImageUsd({ model: 'nano-banana-pro', resolution: '4K', references }))).toBe(24);
    }
  });

  it('Nano Banana 2.1: 4, 5 and 12 credits at 1K, 2K and 4K, whatever the references (estimate_cost 2026-11-19)', () => {
    for (const references of [0, 1, 3]) {
      expect(cents(estimateImageUsd({ model: 'nano-banana-2.1', resolution: '1K', references }))).toBe(4);
      expect(cents(estimateImageUsd({ model: 'nano-banana-2.1', resolution: '2K', references }))).toBe(5);
      expect(cents(estimateImageUsd({ model: 'nano-banana-2.1', resolution: '4K', references }))).toBe(12);
    }
  });

  it('a model with no account lane keeps its exact list price', () => {
    expect(estimateImageUsd({ model: 'seedream-5-flash', resolution: '1K', references: 0 })).toBe(0.027);
  });
});

describe('video: the provider quote, to the credit, with no allowance on top', () => {
  // seconds -> credits, no reference video (any aspect ratio, sound on or off, a first frame or reference images)
  const plain: Record<StudioVideoResolution, Record<number, number>> = {
    '480p': { 4: 42, 5: 52, 8: 83, 10: 104, 12: 124, 15: 155 },
    '720p': { 4: 94, 5: 117, 8: 186, 10: 233, 12: 279, 15: 348 },
    '1080p': { 4: 230, 5: 287, 8: 458, 10: 571, 12: 685, 15: 856 },
  };
  // seconds -> credits with a 10 s reference video attached
  const withTenSecondVideo: Record<StudioVideoResolution, Record<number, number>> = {
    '480p': { 4: 87, 5: 93, 8: 111, 10: 124, 12: 136, 15: 154 },
    '720p': { 4: 195, 5: 208, 8: 250, 10: 278, 12: 305, 15: 347 },
    '1080p': { 4: 478, 5: 512, 8: 614, 10: 682, 12: 750, 15: 852 },
  };

  it.each(Object.keys(plain) as StudioVideoResolution[])('%s without a reference video', (resolution) => {
    for (const [seconds, quoted] of Object.entries(plain[resolution])) {
      expect(cents(estimateVideoUsd({ resolution, seconds: Number(seconds), referenceVideoSeconds: 0 })), `${resolution} ${seconds}s`).toBe(quoted);
    }
  });

  it.each(Object.keys(withTenSecondVideo) as StudioVideoResolution[])('%s with a 10 s reference video', (resolution) => {
    for (const [seconds, quoted] of Object.entries(withTenSecondVideo[resolution])) {
      expect(cents(estimateVideoUsd({ resolution, seconds: Number(seconds), referenceVideoSeconds: 10 })), `${resolution} ${seconds}s`).toBe(quoted);
    }
  });

  it('bills a short reference for at least two thirds of the output', () => {
    // 23 s at 480p with a 10 s reference: the input counts as ceil(23 x 2/3) = 16 s.
    expect(cents(estimateVideoUsd({ resolution: '480p', seconds: 23, referenceVideoSeconds: 10 }))).toBe(241);
  });

  it('bills a reference for its real length, not a whole number of seconds (charged runs)', () => {
    // 23 s with a 22.5 s reference was charged 281; 14 s with a 14.125 s one, 174.
    expect(cents(estimateVideoUsd({ resolution: '480p', seconds: 23, referenceVideoSeconds: 22.5 }))).toBe(281);
    const model = { minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 };
    const run = remixRunUsd({ model, resolution: '480p', method: 'reference', seconds: 14, referenceSeconds: 14.125 });
    expect(cents(run.usd)).toBe(174);
  });

  it('an edit follows its source: a 10 s source at 720p is the 10 s run with that reference', () => {
    const model = { minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 };
    const run = remixRunUsd({ model, resolution: '720p', method: 'edit', seconds: null, referenceSeconds: 10 });
    expect(run.outputSeconds).toBe(10);
    expect(cents(run.usd)).toBe(278);
  });

  /*
   * A run that follows its source (`duration: -1`) is priced on the source's length rounded up, 4 to 30 s
   * (CLI help for `create_video.duration`), and the source itself for its real length. Quoted free on
   * 2026-11-18 with the source uploaded to the account, on public TWINGS films whose stored length
   * (`duration_ms`, read from the file's movie header as the studio does) is:
   *
   *   15,042 ms (15.04 s, 361 frames at 24 fps, like every clip we generate): 192 credits = 16 s out + 15.042 s in
   *   11,100 ms: 143 = 12 s out + 11.1 s in
   *   20,067 ms: 253 = 21 s out + 20.067 s in, past the 15 s a new take can pick
   *
   * Priced from the exact milliseconds when they are known; from the tenths a screen shows only when not.
   */
  it('prices the exact source length: a 15,042 ms source is 16 s out and 192 credits', () => {
    const model = { minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 };
    for (const [ms, out, quoted] of [[15_042, 16, 192], [11_100, 12, 143], [20_067, 21, 253]] as const) {
      for (const method of ['edit', 'reference'] as const) {
        const run = remixRunUsd({ model, resolution: '480p', method, seconds: null, referenceSeconds: Math.round(ms / 100) / 10, referenceMs: ms });
        expect(run.outputSeconds, `${ms} ${method}`).toBe(out);
        expect(cents(run.usd), `${ms} ${method}`).toBe(quoted);
      }
    }
    // A new take with a length of its own bills that source for its real length too.
    expect(cents(remixRunUsd({ model, resolution: '480p', method: 'reference', seconds: 8, referenceSeconds: 15, referenceMs: 15_042 }).usd))
      .toBe(cents(estimateVideoUsd({ resolution: '480p', seconds: 8, referenceVideoSeconds: 15.042 })));
  });

  it('falls back to the tenths a screen shows when the exact length is not known', () => {
    const model = { minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 };
    // 15.0 shown: 15 s out, 185 credits, one output second short of the provider's 192.
    const shown = remixRunUsd({ model, resolution: '480p', method: 'edit', seconds: null, referenceSeconds: 15 });
    expect(shown.outputSeconds).toBe(15);
    expect(cents(shown.usd)).toBe(185);
    for (const referenceMs of [null, undefined, Number.NaN, 0, -5]) {
      expect(remixRunUsd({ model, resolution: '480p', method: 'edit', seconds: null, referenceSeconds: 15, referenceMs }).outputSeconds).toBe(15);
    }
    // A blueprint keeps the length it is planned at from the tenths (reference-video.ts `remakeSeconds`).
    expect(remixRunUsd({ model, resolution: '480p', method: 'blueprint', seconds: null, referenceSeconds: 7.5, referenceMs: 7_451 }).outputSeconds).toBe(8);
  });

  it('a run that follows its source counts the source rounded up (an 11.1 s source is 12 s out)', () => {
    const model = { minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 };
    for (const method of ['edit', 'reference'] as const) {
      const run = remixRunUsd({ model, resolution: '480p', method, seconds: null, referenceSeconds: 11.1 });
      expect(run.outputSeconds, method).toBe(12);
      expect(cents(run.usd), method).toBe(143);
    }
    // The figure a screen has, in tenths, gives the same: 11.14 s is shown 11.1.
    expect(remixRunUsd({ model, resolution: '480p', method: 'edit', seconds: null, referenceSeconds: 11.14 }).outputSeconds).toBe(12);
  });

  it('a source longer than a new take can be still sets the length it follows, up to 30 s', () => {
    const model = { minSeconds: 4, maxSeconds: 15, defaultSeconds: 5 };
    const run = remixRunUsd({ model, resolution: '480p', method: 'edit', seconds: null, referenceSeconds: 20.07 });
    expect(run.outputSeconds).toBe(21);
    expect(cents(run.usd)).toBe(253);
    // And never under 4 s: a 2.5 s reference followed by a new take.
    expect(remixRunUsd({ model, resolution: '480p', method: 'reference', seconds: null, referenceSeconds: 2.5 }).outputSeconds).toBe(4);
    // A blueprint never sends its video: it runs at a length of its own, inside the model's range.
    expect(remixRunUsd({ model, resolution: '480p', method: 'blueprint', seconds: null, referenceSeconds: 20.07 }).outputSeconds).toBe(15);
  });

  it('the production draft of 2026-11-15 (4 s, 480p) is quoted what it was charged', () => {
    const usd = estimateVideoUsd({ resolution: '480p', seconds: 4, referenceVideoSeconds: 0 });
    expect(cents(usd)).toBe(42);
    // Settled at 653 KRW under the old rule (66 credits on the tile); the quote said 80.
    expect(creditsOf(usageKrw(usd, 'video'))).toBe(66);
  });
});

describe('the amount on the button is the amount taken', () => {
  it('the partial edit of 2026-11-17: quoted 7, taken 8, now 8 and 8', () => {
    // One edit call at 2K with the picture as its one input image: $0.043 list, 5 account credits.
    const quoted = regionCredits('seedream-5.5', 0, null, true);
    const reported = 5 / 100;
    expect(regionEditRun('seedream-5.5', 0, null, true).usd).toBe(reported);
    expect(quoted).toBe(8);
    expect(creditsOf(usageKrw(reported, 'image'))).toBe(quoted);
  });

  it('with one and two more references, as charged (6 credits each)', () => {
    expect(cents(regionEditRun('seedream-5.5', 1, null, true).usd)).toBe(6);
    expect(cents(regionEditRun('seedream-5.5', 2, null, true).usd)).toBe(6);
    expect(regionCredits('seedream-5.5', 1, null, true)).toBe(creditsOf(usageKrw(0.06, 'image')));
  });
});

describe('usage is counted in whole credits', () => {
  it('a result never takes a fraction of a credit', () => {
    for (const usd of [0.02, 0.04, 0.05, 0.06, 0.14, 0.24, 0.42, 1.24, 5.71]) {
      for (const medium of ['image', 'video'] as const) {
        const krw = usageKrw(usd, medium);
        expect(krw % STUDIO_CREDIT_KRW, `${usd} ${medium}`).toBe(0);
        expect(creditsOf(krw) * STUDIO_CREDIT_KRW).toBe(krw);
      }
    }
    expect(usageKrw(0, 'image')).toBe(0);
    expect(usageKrw(Number.NaN, 'video')).toBe(0);
  });

  it('several pictures in one run take what the same pictures take one by one', () => {
    const one = imageRunKrw({ model: 'seedream-5.5', resolution: '2K', references: 0, count: 1 });
    expect(one).toBe(70);
    expect(imageRunKrw({ model: 'seedream-5.5', resolution: '2K', references: 0, count: 4 })).toBe(4 * one);
  });

  it('the amounts on the results add up to what the balance lost', () => {
    const cap = 100_000;
    const runs = [usageKrw(0.05, 'image'), usageKrw(0.04, 'image'), usageKrw(0.04, 'image'), usageKrw(0.06, 'image'), usageKrw(0.42, 'video')];
    const shown = runs.reduce((sum, krw) => sum + creditsOf(krw), 0);
    const used = runs.reduce((sum, krw) => sum + krw, 0);
    expect(creditsLeft(cap, 0) - creditsLeft(cap, used)).toBe(shown);
  });
});
