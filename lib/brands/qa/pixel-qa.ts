import { z } from 'zod';
import type { BrandIdentity } from '@/lib/brands/identity/schema';

/**
 * S5 Automated Result QA: Pixel Palette `ΔE`, Owned Hue Band, and Product Checklist Verification
 * (`BRAND-PRODUCT.md` §10, `knowhow-corpus.md` §10.2, §12.4, §12.5).
 */

export interface RgbTuple {
  r: number;
  g: number;
  b: number;
}

export interface LabTuple {
  L: number;
  a: number;
  b: number;
}

export interface HsvTuple {
  h: number;
  s: number;
  v: number;
}

export function hexToRgb(hex: string): RgbTuple {
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Invalid 6-digit hex colour: ${hex}`);
  }
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16)
  };
}

export function rgbToLab({ r, g, b }: RgbTuple): LabTuple {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  // D65 reference white
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) / 1.0;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;

  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

export function computeDeltaE76(hexA: string, hexB: string): number {
  const labA = rgbToLab(hexToRgb(hexA));
  const labB = rgbToLab(hexToRgb(hexB));
  const dist = Math.hypot(
    labA.L - labB.L,
    labA.a - labB.a,
    labA.b - labB.b
  );
  return Math.round(dist * 100) / 100;
}

export function rgbToHsv({ r, g, b }: RgbTuple): HsvTuple {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) {
      h = ((gn - bn) / d) % 6;
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  return {
    h,
    s: Math.round(s * 1000) / 1000,
    v: Math.round(max * 1000) / 1000
  };
}

export const SampledSwatchSchema = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  weight: z.number().min(0).max(1),
  region: z
    .enum(['background', 'accent', 'skin', 'product', 'other'])
    .default('other')
});

export type SampledSwatch = z.infer<typeof SampledSwatchSchema>;

export interface PaletteQaResult {
  passed: boolean;
  accentDeltaE: number | null;
  outOfBandHueWeight: number;
  greenCastWeight: number;
  warmElementCount: number;
  violations: string[];
}

function isHueInRange(hue: number, min: number, max: number): boolean {
  if (min <= max) return hue >= min && hue <= max;
  return hue >= min || hue <= max;
}

/**
 * Evaluates a generated image/frame's sampled colour swatches against the brand identity's
 * owned hue band (`[195, 225]`), near-neutral allowance (`s <= 0.14`), skin protection (`12..42 deg`),
 * warm element limit, and accent `ΔE` (`knowhow-corpus.md` §12.4).
 */
export function evaluatePaletteQa(input: {
  identity: Pick<BrandIdentity, 'colour' | 'world'>;
  swatches: readonly SampledSwatch[];
  warmElementCount?: number;
  maxAccentDeltaE?: number;
  maxOutOfBandWeight?: number;
}): PaletteQaResult {
  const swatches = input.swatches.map((s) => SampledSwatchSchema.parse(s));
  const [hueMin, hueMax] = input.identity.world.ownedHue;
  const maxAccentDeltaE = input.maxAccentDeltaE ?? 16.0;
  const maxOutOfBandWeight = input.maxOutOfBandWeight ?? 0.12;
  const warmElementCount = input.warmElementCount ?? 0;

  let outOfBandHueWeight = 0;
  let greenCastWeight = 0;
  let accentDeltaE: number | null = null;
  const violations: string[] = [];

  for (const sw of swatches) {
    const rgb = hexToRgb(sw.hex);
    const hsv = rgbToHsv(rgb);
    const lab = rgbToLab(rgb);

    if (sw.region === 'accent') {
      const de = computeDeltaE76(sw.hex, input.identity.colour.accent);
      accentDeltaE = accentDeltaE === null ? de : Math.min(accentDeltaE, de);
    }

    // Near-neutral pixels (s <= 0.14) are always permitted
    if (hsv.s <= 0.14) continue;

    // Protected skin tones (explicit skin region or warm skin band 12..42 deg with a* >= 6)
    const isSkinTone =
      sw.region === 'skin' ||
      (input.identity.world.skinProtected &&
        isHueInRange(hsv.h, 12, 42) &&
        lab.a >= 6);
    if (isSkinTone) continue;

    // Detect green cast leak (hue 85..155 deg)
    if (isHueInRange(hsv.h, 85, 155)) {
      greenCastWeight += sw.weight;
    }

    if (!isHueInRange(hsv.h, hueMin, hueMax)) {
      outOfBandHueWeight += sw.weight;
    }
  }

  outOfBandHueWeight = Math.round(outOfBandHueWeight * 1000) / 1000;
  greenCastWeight = Math.round(greenCastWeight * 1000) / 1000;

  if (
    accentDeltaE !== null &&
    accentDeltaE > maxAccentDeltaE
  ) {
    violations.push(
      `Accent colour ΔE (${accentDeltaE}) exceeds maximum allowed (${maxAccentDeltaE}) against brand accent ${input.identity.colour.accent}.`
    );
  }

  if (greenCastWeight > 0.02) {
    violations.push(
      `Green cast weight (${greenCastWeight}) exceeds 0.02 threshold (hue rotation leak).`
    );
  }

  if (outOfBandHueWeight > maxOutOfBandWeight) {
    violations.push(
      `Out-of-band hue weight (${outOfBandHueWeight}) exceeds ${maxOutOfBandWeight} outside owned hue band [${hueMin}, ${hueMax}] deg.`
    );
  }

  if (warmElementCount > input.identity.world.warmPerScreen) {
    violations.push(
      `Warm element count (${warmElementCount}) exceeds brand limit (${input.identity.world.warmPerScreen}).`
    );
  }

  return {
    passed: violations.length === 0,
    accentDeltaE,
    outOfBandHueWeight,
    greenCastWeight,
    warmElementCount,
    violations
  };
}

export const ProductChecklistInspectionItemSchema = z.object({
  item: z.string().trim().min(1).max(240),
  status: z.enum(['verified', 'unreadable_at_resolution', 'mismatch']),
  note: z.string().trim().max(240).optional()
});

export type ProductChecklistInspectionItem = z.infer<
  typeof ProductChecklistInspectionItemSchema
>;

export interface ProductChecklistQaResult {
  verdict: 'pass' | 'unverified_needs_local_fix' | 'fail';
  verifiedCount: number;
  unverifiedItems: string[];
  mismatchedItems: string[];
  missingChecklistItems: string[];
}

/**
 * Evaluates product checklist verification (`knowhow-corpus.md` §10.2, §12.5):
 * - Any item that is `'unreadable_at_resolution'` is NEVER marked `'pass'`; it produces `'unverified_needs_local_fix'`
 *   so the S4 local-fix crop upscaler (`180px -> 1440px`) or a PD verifies it.
 * - Any `'mismatch'` or missing checklist item fails the gate (`'fail'`).
 */
export function evaluateProductChecklistQa(input: {
  requiredChecklist: readonly string[];
  inspections: readonly ProductChecklistInspectionItem[];
}): ProductChecklistQaResult {
  const inspections = input.inspections.map((i) =>
    ProductChecklistInspectionItemSchema.parse(i)
  );
  const byItem = new Map(
    inspections.map((i) => [i.item.trim().toLowerCase(), i])
  );

  let verifiedCount = 0;
  const unverifiedItems: string[] = [];
  const mismatchedItems: string[] = [];
  const missingChecklistItems: string[] = [];

  for (const req of input.requiredChecklist) {
    const key = req.trim().toLowerCase();
    if (!key) continue;
    const found = byItem.get(key);
    if (!found) {
      missingChecklistItems.push(req);
      continue;
    }
    if (found.status === 'verified') {
      verifiedCount += 1;
    } else if (found.status === 'unreadable_at_resolution') {
      unverifiedItems.push(req);
    } else {
      mismatchedItems.push(req);
    }
  }

  const verdict =
    mismatchedItems.length > 0 || missingChecklistItems.length > 0
      ? 'fail'
      : unverifiedItems.length > 0
        ? 'unverified_needs_local_fix'
        : 'pass';

  return {
    verdict,
    verifiedCount,
    unverifiedItems,
    mismatchedItems,
    missingChecklistItems
  };
}
