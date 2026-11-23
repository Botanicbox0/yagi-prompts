import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDIO_REMIX_METHODS } from '@/lib/brand-studio/contracts';
import { finalPrice } from '@/lib/brand-studio/final-price';
import {
  billedUsd,
  estimateImageUsd,
  estimateVideoUsd,
  STUDIO_IMAGE_QUALITIES,
  STUDIO_MODELS,
  type StudioImageModel,
  type StudioModel,
  type StudioVideoModel,
} from '@/lib/brand-studio/models';
import { MUSIC_ENGINES } from '@/lib/brand-studio/sound/engine';
import {
  billedResolution,
  FOLLOW_SOURCE_SECONDS,
  imageRunKrw,
  regionEditRun,
  remixRunUsd,
  STUDIO_USAGE_FACTORS,
  usageKrw,
  videoRunUsd,
} from '@/lib/brand-studio/usage-rate';
import { worstCostKrwPerCredit } from '@/lib/brands/billing/plan-credits';

/**
 * docs/BRAND-RECURRING-BILLING.md §6.1, §6.6-1: whatever a customer runs, the credits taken cover the provider's
 * billed cost at the smallest factor (video, 1.11). Equivalently cost / usage <= 1 / 1.11, which is the
 * `worstCostKrwPerCredit()` every plan-credit number in §6.3 is built on. Every model in the registry and every
 * option its price function reads are enumerated from the definitions, never from a short hand-written list.
 *
 * Two amounts are compared against `billedUsd(cost) x krwPerUsd x (1 + videoMargin)`: the one the server reserves (the
 * same function the plan uses, on the cost as priced) and `usageKrw(billedUsd(cost), medium)`. A tolerance of 1e-6 KRW
 * absorbs float noise only.
 */
const F = STUDIO_USAGE_FACTORS;
const floorKrw = (usd: number) => billedUsd(usd) * F.krwPerUsd * (1 + F.videoMargin);

type Violation = { what: string; usd: number; charged: number; floor: number };

function checker() {
  const violations: Violation[] = [];
  let checked = 0;
  return {
    /** `charged`: what the server reserves for `perResult` results of cost `usd` each, on its own code path. */
    check(what: string, usd: number, charged: number, medium: 'image' | 'video' | 'audio', perResult = 1) {
      checked += 1;
      const floor = floorKrw(usd) * perResult;
      // The brief's statement, on the billed cost: usageKrw(billedUsd(cost), medium) >= billedUsd(cost) x 1,400 x 1.11.
      const onBilled = usageKrw(billedUsd(usd), medium) * perResult;
      if (!(usd > 0)) violations.push({ what: `${what} (no cost)`, usd, charged, floor });
      else if (charged + 1e-6 < floor) violations.push({ what, usd, charged, floor });
      else if (onBilled + 1e-6 < floor) violations.push({ what: `${what} (billed)`, usd, charged: onBilled, floor });
      // cost / usage <= worst cost per credit / credit value, the same statement in the plan's terms
      else if ((billedUsd(usd) * F.krwPerUsd * perResult) / charged > worstCostKrwPerCredit() / 10 + 1e-12) {
        violations.push({ what: `${what} (ratio)`, usd, charged, floor });
      }
    },
    get checked() {
      return checked;
    },
    violations,
  };
}

const imageModels = (STUDIO_MODELS as readonly StudioModel[]).filter((m): m is StudioImageModel => m.medium === 'image');
const videoModels = (STUDIO_MODELS as readonly StudioModel[]).filter((m): m is StudioVideoModel => m.medium === 'video');

describe('model credit floor (§6.6-1)', () => {
  it('the registry has the models this test enumerates (a new medium needs its own price enumeration here)', () => {
    expect(imageModels.length + videoModels.length).toBe(STUDIO_MODELS.length);
    expect(imageModels.length).toBeGreaterThan(0);
    expect(videoModels.length).toBeGreaterThan(0);
  });

  it('every image model x resolution x reference count x quality x shape x count', () => {
    const c = checker();
    // Retired ids still price (history, reruns), and an unknown id takes the default branch.
    const ids = [...imageModels.map((m) => m.id), 'seedream-5-pro', 'seedream-5.0-pro', 'unknown-image-model'];
    for (const id of ids) {
      const m = imageModels.find((x) => x.id === id) ?? imageModels[0]!;
      const resolutions = [...new Set([...m.resolutions, ...imageModels.flatMap((x) => x.resolutions), 'unknown'])];
      const qualities: Array<string | null> = [null, ...(m.qualities ?? []), ...STUDIO_IMAGE_QUALITIES, 'unknown'];
      const aspects: Array<string | null> = [null, ...new Set(imageModels.flatMap((x) => x.aspects)), '5:1', 'x'];
      // A region edit sends the picture itself as one more reference than the customer attached.
      for (let references = 0; references <= m.maxReferences + 1; references++) {
        for (const resolution of resolutions) {
          for (const quality of qualities) {
            for (const aspect of aspects) {
              const usd = estimateImageUsd({ model: id, resolution, references, quality, aspect });
              for (const count of [1, 2, 4]) {
                const charged = imageRunKrw({ model: id, resolution, references, count, quality, aspect });
                c.check(`${id} ${resolution} refs=${references} q=${quality} a=${aspect} x${count}`, usd, charged, 'image', count);
              }
              c.check(`${id} ${resolution} refs=${references} q=${quality} a=${aspect} usageKrw`, usd, usageKrw(usd, 'image'), 'image');
            }
          }
        }
      }
    }
    expect(c.violations).toEqual([]);
    expect(c.checked).toBeGreaterThan(10_000);
  });

  it('every partial edit (region edit v1 and v2) for every picked model, reference count and quality', () => {
    const c = checker();
    for (const picked of [...imageModels.map((m) => m.id), 'unknown-image-model']) {
      for (const v2 of [false, true]) {
        for (const quality of [null, ...STUDIO_IMAGE_QUALITIES, 'unknown']) {
          for (let references = 0; references <= 16; references++) {
            const { usd, model, resolution } = regionEditRun(picked, references, quality, v2);
            c.check(`region ${picked} v2=${v2} q=${quality} refs=${references} -> ${model.id} ${resolution}`, usd, usageKrw(usd, 'image'), 'image');
          }
        }
      }
    }
    expect(c.violations).toEqual([]);
    expect(c.checked).toBeGreaterThan(300);
  });

  it('every video model x resolution (incl. draft) x whole seconds x reference video off / whole / fractional lengths', () => {
    const c = checker();
    for (const m of videoModels) {
      const resolutions = [...m.resolutions, ...(m.supportsDraft ? ['draft'] : [])];
      const maxSeconds = Math.max(m.maxSeconds, FOLLOW_SOURCE_SECONDS.max);
      const refLengths = [0];
      for (let s = 1; s <= m.referenceVideoSeconds.max; s++) refLengths.push(s, s + 0.04, s + 0.042, s + 0.5, s + 0.96);
      for (const resolution of resolutions) {
        for (let seconds = 1; seconds <= maxSeconds; seconds++) {
          for (const referenceVideoSeconds of refLengths) {
            const usd = estimateVideoUsd({ resolution: billedResolution(resolution), seconds, referenceVideoSeconds });
            c.check(`${m.id} ${resolution} ${seconds}s ref=${referenceVideoSeconds}`, usd, usageKrw(usd, 'video'), 'video');
          }
          const plain = videoRunUsd({ resolution, seconds });
          c.check(`${m.id} ${resolution} ${seconds}s videoRunUsd`, plain, usageKrw(plain, 'video'), 'video');
        }
      }
    }
    expect(c.violations).toEqual([]);
    expect(c.checked).toBeGreaterThan(10_000);
  });

  it('every remix (edit / reference / blueprint), with and without an exact source length', () => {
    const c = checker();
    for (const m of videoModels) {
      const resolutions = [...m.resolutions, ...(m.supportsDraft ? ['draft'] : [])];
      const secondsAsked: Array<number | null> = [null];
      for (let s = m.minSeconds; s <= m.maxSeconds; s++) secondsAsked.push(s);
      for (const method of STUDIO_REMIX_METHODS) {
        for (const resolution of resolutions) {
          for (const seconds of secondsAsked) {
            for (let tenths = 10; tenths <= m.referenceVideoSeconds.max * 10; tenths += 3) {
              const referenceSeconds = tenths / 10;
              for (const referenceMs of [null, tenths * 100, tenths * 100 + 42]) {
                const { usd, outputSeconds } = remixRunUsd({ model: m, resolution, method, seconds, referenceSeconds, referenceMs });
                c.check(`${m.id} ${method} ${resolution} asked=${seconds} ref=${referenceSeconds}/${referenceMs} out=${outputSeconds}`, usd, usageKrw(usd, 'video'), 'video');
              }
            }
            const { usd } = remixRunUsd({ model: m, resolution, method, seconds, referenceSeconds: null, referenceMs: null });
            c.check(`${m.id} ${method} ${resolution} asked=${seconds} unmeasured`, usd, usageKrw(usd, 'video'), 'video');
          }
        }
      }
    }
    expect(c.violations).toEqual([]);
    expect(c.checked).toBeGreaterThan(10_000);
  });

  it('every 1080p final of a draft (draft length, asked seconds, reference video length)', () => {
    const c = checker();
    for (const m of videoModels.filter((x) => x.supportsDraft)) {
      for (const seconds of [undefined, ...Array.from({ length: FOLLOW_SOURCE_SECONDS.max }, (_, i) => i + 1)]) {
        for (const referenceVideoSeconds of [undefined, 0, 1, 2.04, 5.04, 11.1, 15.042, 20.07, 30]) {
          for (const draftDurationMs of [null, 5_042, 15_042, 30_000]) {
            const { usd, krw } = finalPrice({ params: { seconds, referenceVideoSeconds } as never, draftDurationMs, model: m });
            c.check(`${m.id} final s=${seconds} ref=${referenceVideoSeconds} draft=${draftDurationMs}`, usd, krw, 'video');
          }
        }
      }
    }
    expect(c.violations).toEqual([]);
    expect(c.checked).toBeGreaterThan(1_000);
  });

  it('every music engine x mode x careful x vocal (one charge per request)', () => {
    const c = checker();
    for (const engine of Object.values(MUSIC_ENGINES)) {
      for (const mode of ['describe', 'custom'] as const) {
        for (const careful of [false, true]) {
          for (const vocal of [false, true]) {
            const usd = engine.quoteUsd({ mode, careful, vocal, prompt: 'x', title: 'x', lyrics: 'x' } as never);
            c.check(`${engine.id} ${mode} careful=${careful} vocal=${vocal}`, usd, usageKrw(usd, 'audio'), 'audio');
          }
        }
      }
    }
    expect(c.violations).toEqual([]);
    expect(c.checked).toBeGreaterThan(0);
  });
});

/**
 * Every chargeable operation is a caller of `reserveAllowance`. Each one is either cost-linked (its amount is a
 * price function above run through `usageKrw`, so the floor covers it) or fixed-credit with no USD cost basis in the
 * code. A new caller that is in neither list fails here until it is classified.
 */
const COST_LINKED: Record<string, { amount: RegExp; why: string }> = {
  'lib/brand-studio/jobs.ts': { amount: /^plan\.estimateKrw$/, why: 'image, region edit, video, remix, final, revision: plan.ts / revision/plan.ts / final-price.ts' },
  'lib/brand-studio/job-group.ts': { amount: /^total$/, why: 'multi-model image runs: the sum of planJob estimates' },
  'lib/brand-studio/sound/music-jobs.ts': { amount: /^plan\.estimateKrw$/, why: 'music (Suno): usageKrw(engine.quoteUsd, audio)' },
};
const FIXED_CREDIT: Record<string, { amount: RegExp; source: RegExp; why: string }> = {
  'lib/brand-studio/upscale/service.ts': {
    amount: /^krw$/,
    source: /const krw = upscaleKrw\(/,
    why: 'upscale: fixed credit schedule (upscaleCredits), runs on our own GPU; no USD cost in code',
  },
  'lib/brand-studio/music/sfx.ts': {
    amount: /^krw$/,
    source: /const krw = sfxKrw\(/,
    why: 'sound effects: fixed credits per length (sfxCredits); no USD constant in code',
  },
  'lib/brand-studio/music/service.ts': {
    amount: /^krw$/,
    source: /const krw = musicKrw\(/,
    why: 'legacy reference music: fixed credits per length (musicCredits); no USD cost basis in code',
  },
};
/** Where a cost-linked plan's `estimateKrw` is produced: each assignment must go through the usage rate. */
const PLAN_PRODUCERS = [
  'lib/brand-studio/plan.ts',
  'lib/brand-studio/revision/plan.ts',
  'lib/brand-studio/final-price.ts',
  'lib/brand-studio/sound/music-jobs.ts',
];

describe('chargeable operations are classified', () => {
  const root = process.cwd();
  const sources = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  };

  it('every reserveAllowance caller is cost-linked or on the fixed-credit allow-list', () => {
    const calls: Array<{ file: string; amount: string }> = [];
    for (const file of [...sources(join(root, 'lib')), ...sources(join(root, 'app'))]) {
      const rel = relative(root, file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/reserveAllowance\(\s*([^,]+),\s*([^,]+),\s*([^,]+),/g)) {
        if (rel === 'lib/brand-studio/usage.ts' && /^tx: SqlRunner$/.test(m[1]!.trim())) continue; // the definition
        calls.push({ file: rel, amount: m[3]!.trim() });
      }
    }
    const unclassified = calls.filter((c) => !COST_LINKED[c.file] && !FIXED_CREDIT[c.file]);
    expect(unclassified, 'a new chargeable operation: price it through usageKrw or list it as fixed-credit with a reason').toEqual([]);
    for (const c of calls) {
      const rule = COST_LINKED[c.file] ?? FIXED_CREDIT[c.file]!;
      expect(c.amount, `${c.file}: reserves ${c.amount}`).toMatch(rule.amount);
    }
    expect(new Set(calls.map((c) => c.file))).toEqual(new Set([...Object.keys(COST_LINKED), ...Object.keys(FIXED_CREDIT)]));
    for (const [file, rule] of Object.entries(FIXED_CREDIT)) {
      expect(readFileSync(join(root, file), 'utf8'), `${file}: ${rule.why}`).toMatch(rule.source);
    }
  });

  it('every cost-linked estimate is a registry price run through usageKrw / imageRunKrw', () => {
    const allowed = /^(usageKrw|imageRunKrw)\(|^krw$/;
    let seen = 0;
    for (const file of PLAN_PRODUCERS) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const m of text.matchAll(/estimateKrw:\s*([^,}\n]+)/g)) {
        const rhs = m[1]!.trim();
        if (/^number;?$/.test(rhs)) continue; // a type annotation
        seen += 1;
        expect(rhs, `${file}: estimateKrw: ${rhs}`).toMatch(allowed);
      }
      for (const m of text.matchAll(/\bkrw:\s*([^,}\n]+)/g)) {
        expect(m[1]!.trim(), `${file}: krw: ${m[1]}`).toMatch(/^(usageKrw\(|krw$|number)/);
      }
    }
    // planFinal reserves `krw`, which only ever comes from finalPrice (usageKrw of a 1080p estimate).
    expect(readFileSync(join(root, 'lib/brand-studio/plan.ts'), 'utf8')).toMatch(/const \{ usd, krw \} = finalPrice\(/);
    expect(seen).toBeGreaterThanOrEqual(10);
  });
});
