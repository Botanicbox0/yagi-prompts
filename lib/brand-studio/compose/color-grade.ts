/**
 * Client-safe Reference Color Grading & Scoped Look Engine (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Supports:
 * - 6 curated cinema & editorial brand presets (`GRADE_PRESETS`) aligned with `PRESET_BRAND_LOOKS`
 * - RGBA color profile extraction (`extractColorProfileFromRgba` / `extractColorProfileInBrowser`)
 * - 20-element `4x5` Reinhard linear color transfer matrix (`computeReinhardTransferMatrix`)
 * - Real-time `<video>` CSS filter approximation (`cssFilterForColorGrade`)
 * - Frame-accurate `<canvas>` pixel grading (`applyColorGradeToCanvasContext`) with:
 *   - Scope control: `full_timeline`, `selected_clip`, or `region` (`0..1` box with soft `6px` feather)
 *   - Skin-tone hue band protection (`15°..45°` warm skin lock)
 *   - Subtle highlight halation & luminance film grain
 *
 * Client-safe: zero Node, filesystem, database, or internal vendor strings.
 */

export type ColorGradeScope = 'full_timeline' | 'selected_clip' | 'region';

export interface ColorGradeRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ColorGradeProfile {
  lumaMean: number;
  lumaStd: number;
  rMean: number;
  gMean: number;
  bMean: number;
  rStd: number;
  gStd: number;
  bStd: number;
  warmth: number;
  contrast: number;
  saturation: number;
}

export interface ColorGradeSpec {
  enabled: boolean;
  scope: ColorGradeScope;
  targetClipId?: string | null;
  region?: ColorGradeRegion | null;
  presetId?: string | null;
  referenceLabel?: string | null;
  referenceProfile?: ColorGradeProfile | null;
  intensity: number;
  skinProtect: number;
  halation: number;
  grain: number;
}

export type GradePresetId =
  | 'twings-french-blue'
  | 'clean-high-key'
  | 'editorial-cool-porcelain'
  | 'kodak-2383-warm'
  | 'moody-teal-amber'
  | 'pastel-airy-film';

export interface GradePreset {
  id: GradePresetId;
  titleKo: string;
  titleEn: string;
  warmth: number;
  contrast: number;
  saturation: number;
  liftR: number;
  liftG: number;
  liftB: number;
  gainR: number;
  gainG: number;
  gainB: number;
}

export const GRADE_PRESETS: readonly GradePreset[] = [
  {
    id: 'twings-french-blue',
    titleKo: 'TWINGS 프렌치 블루 에디토리얼',
    titleEn: 'TWINGS French Blue Editorial',
    warmth: -0.14,
    contrast: 1.08,
    saturation: 1.04,
    liftR: -0.012,
    liftG: 0.002,
    liftB: 0.024,
    gainR: 0.98,
    gainG: 1.01,
    gainB: 1.06,
  },
  {
    id: 'clean-high-key',
    titleKo: '클린 하이키 스튜디오',
    titleEn: 'Clean High-Key Studio',
    warmth: -0.04,
    contrast: 1.04,
    saturation: 0.98,
    liftR: 0.018,
    liftG: 0.02,
    liftB: 0.024,
    gainR: 1.04,
    gainG: 1.04,
    gainB: 1.05,
  },
  {
    id: 'editorial-cool-porcelain',
    titleKo: '에디토리얼 쿨 포슬린',
    titleEn: 'Editorial Cool Porcelain',
    warmth: -0.18,
    contrast: 1.1,
    saturation: 0.92,
    liftR: -0.008,
    liftG: 0.006,
    liftB: 0.02,
    gainR: 0.97,
    gainG: 1.01,
    gainB: 1.05,
  },
  {
    id: 'kodak-2383-warm',
    titleKo: '2383 필름 프린트 웜',
    titleEn: '2383 Film Print Warm',
    warmth: 0.22,
    contrast: 1.14,
    saturation: 1.08,
    liftR: 0.014,
    liftG: 0.004,
    liftB: -0.016,
    gainR: 1.06,
    gainG: 1.02,
    gainB: 0.94,
  },
  {
    id: 'moody-teal-amber',
    titleKo: '무디 틸 앤 앰버',
    titleEn: 'Moody Teal & Amber',
    warmth: 0.06,
    contrast: 1.18,
    saturation: 1.1,
    liftR: -0.022,
    liftG: 0.008,
    liftB: 0.022,
    gainR: 1.05,
    gainG: 1.0,
    gainB: 0.95,
  },
  {
    id: 'pastel-airy-film',
    titleKo: '파스텔 에어리 필름',
    titleEn: 'Pastel Airy Film',
    warmth: 0.08,
    contrast: 0.94,
    saturation: 0.94,
    liftR: 0.026,
    liftG: 0.022,
    liftB: 0.028,
    gainR: 1.02,
    gainG: 1.02,
    gainB: 1.03,
  },
] as const;

export const DEFAULT_COLOR_GRADE_SPEC: ColorGradeSpec = {
  enabled: false,
  scope: 'full_timeline',
  targetClipId: null,
  region: null,
  presetId: 'twings-french-blue',
  referenceLabel: null,
  referenceProfile: null,
  intensity: 0.85,
  skinProtect: 0.7,
  halation: 0.04,
  grain: 1.8,
};

const NEUTRAL_PROFILE: ColorGradeProfile = {
  lumaMean: 0.5,
  lumaStd: 0.22,
  rMean: 0.5,
  gMean: 0.5,
  bMean: 0.5,
  rStd: 0.22,
  gStd: 0.22,
  bStd: 0.22,
  warmth: 0,
  contrast: 1,
  saturation: 1,
};

const IDENTITY_MATRIX_4X5: readonly number[] = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

function clamp(min: number, max: number, value: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function findGradePreset(presetId: string | null | undefined): GradePreset | null {
  if (!presetId) return null;
  return GRADE_PRESETS.find((p) => p.id === presetId) ?? null;
}

export function presetToTargetProfile(preset: GradePreset): ColorGradeProfile {
  const rMean = clamp(0.05, 0.95, 0.5 * preset.gainR + preset.liftR);
  const gMean = clamp(0.05, 0.95, 0.5 * preset.gainG + preset.liftG);
  const bMean = clamp(0.05, 0.95, 0.5 * preset.gainB + preset.liftB);
  const lumaMean = round4(0.2126 * rMean + 0.7152 * gMean + 0.0722 * bMean);
  const std = round4(clamp(0.08, 0.4, 0.22 * preset.contrast));
  return {
    lumaMean,
    lumaStd: std,
    rMean: round4(rMean),
    gMean: round4(gMean),
    bMean: round4(bMean),
    rStd: round4(std * preset.gainR),
    gStd: round4(std * preset.gainG),
    bStd: round4(std * preset.gainB),
    warmth: preset.warmth,
    contrast: preset.contrast,
    saturation: preset.saturation,
  };
}

/**
 * Extracts normalized (`0..1`) channel statistics, warmth, contrast, and saturation from RGBA pixel bytes.
 */
export function extractColorProfileFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
): ColorGradeProfile {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount <= 0) {
    return { ...NEUTRAL_PROFILE };
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let lumaSum = 0;
  let satSum = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 1e-5 ? (maxC - minC) / maxC : 0;

    rSum += r;
    gSum += g;
    bSum += b;
    lumaSum += luma;
    satSum += sat;
  }

  const rMean = rSum / pixelCount;
  const gMean = gSum / pixelCount;
  const bMean = bSum / pixelCount;
  const lumaMean = lumaSum / pixelCount;
  const meanSat = satSum / pixelCount;

  let rVar = 0;
  let gVar = 0;
  let bVar = 0;
  let lumaVar = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    const dr = r - rMean;
    const dg = g - gMean;
    const db = b - bMean;
    const dl = luma - lumaMean;

    rVar += dr * dr;
    gVar += dg * dg;
    bVar += db * db;
    lumaVar += dl * dl;
  }

  const rStd = Math.sqrt(rVar / pixelCount);
  const gStd = Math.sqrt(gVar / pixelCount);
  const bStd = Math.sqrt(bVar / pixelCount);
  const lumaStd = Math.sqrt(lumaVar / pixelCount);

  const warmth = clamp(-1, 1, (rMean - bMean) * 1.8);
  const contrast = clamp(0.5, 1.8, lumaStd > 1e-4 ? lumaStd / 0.22 : 1);
  const saturation = clamp(0, 2, meanSat / 0.35);

  return {
    lumaMean: round4(lumaMean),
    lumaStd: round4(lumaStd),
    rMean: round4(rMean),
    gMean: round4(gMean),
    bMean: round4(bMean),
    rStd: round4(rStd),
    gStd: round4(gStd),
    bStd: round4(bStd),
    warmth: round4(warmth),
    contrast: round4(contrast),
    saturation: round4(saturation),
  };
}

/**
 * Samples an image or video frame onto a `96x96` offscreen `<canvas>` in the browser and extracts its
 * `ColorGradeProfile`.
 */
export async function extractColorProfileInBrowser(
  mediaUrl: string,
  kind: 'image' | 'video',
  sampleTimeSec = 0.5,
): Promise<ColorGradeProfile> {
  if (typeof document === 'undefined' || !mediaUrl) {
    return { ...NEUTRAL_PROFILE };
  }

  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ...NEUTRAL_PROFILE };

  if (kind === 'image') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('reference_image_load_failed'));
      img.src = mediaUrl;
    });
    ctx.drawImage(img, 0, 0, size, size);
    return extractColorProfileFromRgba(ctx.getImageData(0, 0, size, size).data);
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('reference_video_timeout')), 10_000);
      video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('reference_video_load_failed'));
        },
        { once: true },
      );
      video.src = mediaUrl;
    });

    const targetTime = clamp(
      0,
      Math.max(0, (Number.isFinite(video.duration) ? video.duration : 1) - 0.05),
      sampleTimeSec,
    );
    if (targetTime > 0.02) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 1500);
        video.addEventListener(
          'seeked',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        video.currentTime = targetTime;
      });
    }

    ctx.drawImage(video, 0, 0, size, size);
    return extractColorProfileFromRgba(ctx.getImageData(0, 0, size, size).data);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * Computes a 20-element `4x5` RGBA linear color transfer matrix (`feColorMatrix` layout) mapping
 * `source` channel mean/std + saturation toward `target`, blended by `intensity` (`0..1`).
 */
export function computeReinhardTransferMatrix(
  source: ColorGradeProfile | null,
  target: ColorGradeProfile,
  intensity: number,
): number[] {
  const t = clamp(0, 1, intensity);
  if (t <= 0) {
    return [...IDENTITY_MATRIX_4X5];
  }

  const src = source ?? NEUTRAL_PROFILE;
  const rawGainR = clamp(0.55, 1.65, target.rStd / Math.max(0.04, src.rStd));
  const rawGainG = clamp(0.55, 1.65, target.gStd / Math.max(0.04, src.gStd));
  const rawGainB = clamp(0.55, 1.65, target.bStd / Math.max(0.04, src.bStd));

  const gainR = 1 + t * (rawGainR - 1);
  const gainG = 1 + t * (rawGainG - 1);
  const gainB = 1 + t * (rawGainB - 1);

  const offsetR = clamp(-0.35, 0.35, t * (target.rMean - rawGainR * src.rMean));
  const offsetG = clamp(-0.35, 0.35, t * (target.gMean - rawGainG * src.gMean));
  const offsetB = clamp(-0.35, 0.35, t * (target.bMean - rawGainB * src.bMean));

  const satRatio = clamp(0.4, 1.7, target.saturation / Math.max(0.15, src.saturation));
  const s = 1 + t * (satRatio - 1);

  const lumR = 0.2126;
  const lumG = 0.7152;
  const lumB = 0.0722;

  const sr0 = (1 - s) * lumR + s;
  const sr1 = (1 - s) * lumG;
  const sr2 = (1 - s) * lumB;

  const sg0 = (1 - s) * lumR;
  const sg1 = (1 - s) * lumG + s;
  const sg2 = (1 - s) * lumB;

  const sb0 = (1 - s) * lumR;
  const sb1 = (1 - s) * lumG;
  const sb2 = (1 - s) * lumB + s;

  return [
    round4(sr0 * gainR), round4(sr1 * gainG), round4(sr2 * gainB), 0, round4(offsetR),
    round4(sg0 * gainR), round4(sg1 * gainG), round4(sg2 * gainB), 0, round4(offsetG),
    round4(sb0 * gainR), round4(sb1 * gainG), round4(sb2 * gainB), 0, round4(offsetB),
    0, 0, 0, 1, 0,
  ];
}

/**
 * Produces a clean CSS `filter` string (`brightness(...) contrast(...) saturate(...) sepia(...) hue-rotate(...)`)
 * approximating `spec` for real-time `<video>` monitor preview.
 */
export function cssFilterForColorGrade(spec: ColorGradeSpec | null | undefined): string {
  if (!spec || !spec.enabled) return 'none';
  const t = clamp(0, 1, spec.intensity);
  if (t <= 0) return 'none';

  const preset = findGradePreset(spec.presetId);
  const ref = spec.referenceProfile ?? null;

  let targetContrast = 1;
  let targetSat = 1;
  let targetWarmth = 0;
  let targetBrightness = 1;

  if (preset) {
    targetContrast *= preset.contrast;
    targetSat *= preset.saturation;
    targetWarmth += preset.warmth;
    const meanLift = (preset.liftR + preset.liftG + preset.liftB) / 3;
    const meanGain = (preset.gainR + preset.gainG + preset.gainB) / 3;
    targetBrightness *= clamp(0.82, 1.22, meanGain + meanLift * 0.8);
  }

  if (ref) {
    targetContrast *= clamp(0.75, 1.35, ref.contrast);
    targetSat *= clamp(0.65, 1.4, ref.saturation);
    targetWarmth = clamp(-1, 1, targetWarmth + ref.warmth * 0.85);
    targetBrightness *= clamp(0.82, 1.22, 1 + (ref.lumaMean - 0.5) * 0.35);
  }

  const brightness = round4(1 + t * (targetBrightness - 1) + t * clamp(0, 0.2, spec.halation) * 0.15);
  const contrast = round4(1 + t * (targetContrast - 1));
  const saturate = round4(1 + t * (targetSat - 1));
  const sepia = round4(targetWarmth > 0 ? clamp(0, 0.28, targetWarmth * 0.32 * t) : 0);
  const hueRotateDeg = round4(
    targetWarmth < 0
      ? clamp(-14, 0, targetWarmth * 24 * t)
      : clamp(-4, 6, -targetWarmth * 6 * t),
  );

  return [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturate})`,
    `sepia(${sepia})`,
    `hue-rotate(${hueRotateDeg}deg)`,
  ].join(' ');
}

function rgbHueAndSat(r: number, g: number, b: number): { hueDeg: number; sat: number } {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const delta = maxC - minC;
  if (delta < 1e-5 || maxC < 1e-5) {
    return { hueDeg: 0, sat: 0 };
  }
  let hue = 0;
  if (maxC === r) {
    hue = ((g - b) / delta) % 6;
  } else if (maxC === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  let hueDeg = hue * 60;
  if (hueDeg < 0) hueDeg += 360;
  return { hueDeg, sat: delta / maxC };
}

/**
 * Returns `0..1` skin-hue membership across the `15°..45°` warm skin band (with smooth `8°` ramps).
 */
function skinBandWeight(r: number, g: number, b: number): number {
  const { hueDeg, sat } = rgbHueAndSat(r, g, b);
  if (sat < 0.08 || sat > 0.78) return 0;
  if (hueDeg >= 15 && hueDeg <= 45) return 1;
  if (hueDeg >= 7 && hueDeg < 15) return (hueDeg - 7) / 8;
  if (hueDeg > 45 && hueDeg <= 53) return (53 - hueDeg) / 8;
  return 0;
}

/**
 * Applies pixel-level Reinhard / preset channel transfer + `15°..45°` skin-hue protection + halation lift +
 * luminance film grain directly onto `ctx` (either across the full frame or inside `spec.region` with a
 * soft `6px` edge feather).
 */
export function applyColorGradeToCanvasContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spec: ColorGradeSpec,
  isSelectedClip: boolean,
): void {
  if (!spec.enabled || width <= 0 || height <= 0) return;
  const intensity = clamp(0, 1, spec.intensity);
  if (intensity <= 0) return;

  if (spec.scope === 'selected_clip' && !isSelectedClip) {
    return;
  }
  if (spec.scope === 'region' && spec.targetClipId && !isSelectedClip) {
    return;
  }

  let rx0 = 0;
  let ry0 = 0;
  let rw = Math.floor(width);
  let rh = Math.floor(height);
  const isRegion = spec.scope === 'region';

  if (isRegion) {
    const reg = spec.region;
    if (!reg || reg.w <= 0 || reg.h <= 0) return;
    const x0 = clamp(0, width, Math.floor(reg.x * width));
    const y0 = clamp(0, height, Math.floor(reg.y * height));
    const x1 = clamp(0, width, Math.ceil((reg.x + reg.w) * width));
    const y1 = clamp(0, height, Math.ceil((reg.y + reg.h) * height));
    rx0 = x0;
    ry0 = y0;
    rw = x1 - x0;
    rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return;
  }

  const imageData = ctx.getImageData(rx0, ry0, rw, rh);
  const data = imageData.data;

  const preset = findGradePreset(spec.presetId);
  const targetProfile =
    spec.referenceProfile ?? (preset ? presetToTargetProfile(preset) : null);

  const srcProfile = spec.referenceProfile
    ? extractColorProfileFromRgba(data)
    : NEUTRAL_PROFILE;

  const matrix = targetProfile
    ? computeReinhardTransferMatrix(srcProfile, targetProfile, intensity)
    : [...IDENTITY_MATRIX_4X5];

  const skinProtect = clamp(0, 1, spec.skinProtect);
  const halation = clamp(0, 0.2, spec.halation) * intensity;
  const grainAmp = (clamp(0, 10, spec.grain) / 255) * 2.4 * intensity;
  const featherPx = 6;

  for (let py = 0; py < rh; py += 1) {
    const yEdgeWeight = isRegion
      ? clamp(0, 1, Math.min(py + 0.5, rh - py - 0.5) / featherPx)
      : 1;

    for (let px = 0; px < rw; px += 1) {
      const regionMask = isRegion
        ? yEdgeWeight * clamp(0, 1, Math.min(px + 0.5, rw - px - 0.5) / featherPx)
        : 1;
      if (regionMask <= 0) continue;

      const idx = (py * rw + px) * 4;
      const r0 = data[idx]! / 255;
      const g0 = data[idx + 1]! / 255;
      const b0 = data[idx + 2]! / 255;

      let r1 = matrix[0]! * r0 + matrix[1]! * g0 + matrix[2]! * b0 + matrix[4]!;
      let g1 = matrix[5]! * r0 + matrix[6]! * g0 + matrix[7]! * b0 + matrix[9]!;
      let b1 = matrix[10]! * r0 + matrix[11]! * g0 + matrix[12]! * b0 + matrix[14]!;

      if (preset && spec.referenceProfile) {
        // Compose preset lift/gain subtly on top when both reference & preset are active
        const pMix = intensity * 0.35;
        r1 = r1 + pMix * ((r0 * preset.gainR + preset.liftR) - r0);
        g1 = g1 + pMix * ((g0 * preset.gainG + preset.liftG) - g0);
        b1 = b1 + pMix * ((b0 * preset.gainB + preset.liftB) - b0);
      } else if (preset && !spec.referenceProfile) {
        // Direct contrast S-pivot around 0.5 + channel lift/gain
        const pr = 0.5 + (r0 * preset.gainR + preset.liftR - 0.5) * preset.contrast;
        const pg = 0.5 + (g0 * preset.gainG + preset.liftG - 0.5) * preset.contrast;
        const pb = 0.5 + (b0 * preset.gainB + preset.liftB - 0.5) * preset.contrast;
        const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
        const satR = lum + (pr - lum) * preset.saturation;
        const satG = lum + (pg - lum) * preset.saturation;
        const satB = lum + (pb - lum) * preset.saturation;
        r1 = r0 + intensity * (satR - r0);
        g1 = g0 + intensity * (satG - g0);
        b1 = b0 + intensity * (satB - b0);
      }

      if (skinProtect > 0) {
        const skinW = skinBandWeight(r0, g0, b0);
        if (skinW > 0) {
          const protect = clamp(0, 0.9, skinW * skinProtect * 0.85);
          r1 = r1 * (1 - protect) + r0 * protect;
          g1 = g1 * (1 - protect) + g0 * protect;
          b1 = b1 * (1 - protect) + b0 * protect;
        }
      }

      if (halation > 0) {
        const luma = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
        if (luma > 0.76) {
          const glow = ((luma - 0.76) / 0.24) * halation * 0.6;
          r1 += glow * 1.15;
          g1 += glow * 0.75;
          b1 += glow * 0.45;
        }
      }

      if (grainAmp > 0) {
        // Deterministic spatial hash for repeatable luminance-only film grain
        const seed = Math.sin((px + rx0) * 12.9898 + (py + ry0) * 78.233) * 43758.5453;
        const noise = (seed - Math.floor(seed) - 0.5) * 2 * grainAmp;
        r1 += noise;
        g1 += noise;
        b1 += noise;
      }

      const finalR = r0 + regionMask * (clamp(0, 1, r1) - r0);
      const finalG = g0 + regionMask * (clamp(0, 1, g1) - g0);
      const finalB = b0 + regionMask * (clamp(0, 1, b1) - b0);

      data[idx] = Math.round(clamp(0, 255, finalR * 255));
      data[idx + 1] = Math.round(clamp(0, 255, finalG * 255));
      data[idx + 2] = Math.round(clamp(0, 255, finalB * 255));
    }
  }

  ctx.putImageData(imageData, rx0, ry0);
}
