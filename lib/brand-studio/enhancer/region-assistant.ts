/**
 * Client-safe Prompt Assistant & Box Geometry / Contour Advisor for Region Edit
 * (docs/BRAND-STUDIO-REGION-LAYERS.md §1–§4).
 *
 * Pure module (zero server/sharp/db imports):
 * - 5 task presets (`remove_mark`, `place_mark`, `swap_person`, `enhance_detail`, `custom`) with
 *   verified numbered prompts ("1번 이미지…", "2번 이미지…") in Korean and English.
 * - Reference-2 validation (`missingRefWarning` for `swap_person`, `refAdvisory` for `place_mark`).
 * - Box size (`box.w * box.h > 0.28`) & boundary contour-crossing (`measureBoxBoundaryEdges`) tips.
 */
import type { RegionBox } from '@/lib/brand-studio/contracts';

export const REGION_ASSISTANT_TASK_IDS = [
  'remove_mark',
  'place_mark',
  'swap_person',
  'enhance_detail',
  'custom',
] as const;

export type RegionAssistantTaskId = (typeof REGION_ASSISTANT_TASK_IDS)[number];

export interface RegionAssistantTaskResult {
  task: RegionAssistantTaskId;
  label: string;
  prompt: string;
  requiresRef2: boolean;
  /** Blocking warning when Reference 2 is required (`swap_person`) and absent. */
  missingRefWarning: string | null;
  /** Gentle advisory tip when Reference 2 improves accuracy (`place_mark`) and is absent. */
  refAdvisory: string | null;
}

export const MAX_RECOMMENDED_BOX_AREA = 0.28;
export const CONTOUR_EDGE_THRESHOLD = 0.16;

const TASK_LABELS: Record<'ko' | 'en', Record<RegionAssistantTaskId, string>> = {
  ko: {
    remove_mark: '로고 지우기',
    place_mark: '로고·글자 넣기',
    swap_person: '인물 바꾸기',
    enhance_detail: '디테일 보강',
    custom: '직접 쓰기',
  },
  en: {
    remove_mark: 'Remove logo',
    place_mark: 'Place logo or text',
    swap_person: 'Swap person',
    enhance_detail: 'Enhance detail',
    custom: 'Write custom',
  },
};

const PROMPTS = {
  ko: {
    remove_mark:
      '1번 이미지의 모든 배경, 사물 윤곽, 조명과 질감을 픽셀 그대로 유지한 채, 선택한 부위의 로고·글자만 흔적 없이 자연스럽게 지워줘.',
    place_mark_with_ref:
      '1번 이미지의 구도, 사물 크기·윤곽, 조명과 질감을 픽셀 그대로 유지한 채, 2번 이미지의 로고 모양만 가져와 1번 이미지의 해당 표면에 같은 비율로 자연스럽게 인쇄해줘. 병이나 사물 크기는 절대 키우지 마.',
    place_mark_text_only:
      '1번 이미지의 구도, 사물 크기·윤곽, 조명과 질감을 픽셀 그대로 유지한 채, 선택한 표면에 요청한 글자·로고만 같은 비율로 자연스럽게 인쇄해줘. 병이나 사물 크기는 절대 키우지 마.',
    swap_person:
      '1번 이미지에서 모든 배경과 얼굴 각도, 표정, 조명, 옷과 나머지 모든 요소를 그대로 유지한 채 1번 이미지의 인물을 2번 이미지의 인물로 자연스럽게 변경해줘.',
    enhance_detail:
      '1번 이미지는 큰 사진에서 잘라 확대한 작은 얼굴·디테일 조각이야. 이목구비 비율, 표정, 시선, 머리 모양, 조명과 구도를 픽셀 그대로 유지한 채 피부 결과 속눈썹·머리카락·소재의 미세한 실사 디테일만 선명하게 복원해줘. 성형 느낌이나 과한 보정은 하지 마.',
    custom_with_ref:
      '1번 이미지의 사물 크기와 배경은 그대로 두고, 2번 이미지의 요소를 선택한 위치에 자연스럽게 반영해줘.',
    custom_no_ref:
      '1번 이미지의 배경과 사물 윤곽은 그대로 두고, 선택한 부분만 자연스럽게 고쳐줘.',
  },
  en: {
    remove_mark:
      'In image 1, keep every background pixel, object contour, lighting direction, and surface texture completely unchanged, and cleanly remove only the logo or text inside the selected area without leaving a trace.',
    place_mark_with_ref:
      'Keep image 1’s exact framing, object scale, silhouette, lighting, and surface texture pixel-identical, and print only the exact logo shape from image 2 onto that surface in image 1 at a natural proportion. Never enlarge or redraw the bottle or object.',
    place_mark_text_only:
      'Keep image 1’s exact framing, object scale, silhouette, lighting, and surface texture pixel-identical, and print only the requested text or mark onto the selected surface in image 1 at a natural proportion. Never enlarge or redraw the bottle or object.',
    swap_person:
      'In image 1, keep the entire background, head angle, expression, lighting, clothing, and every surrounding element unchanged, and naturally replace the person in image 1 with the person from image 2.',
    enhance_detail:
      'Image 1 is a small face or detail crop enlarged from a larger photograph. Keep the exact facial proportions, expression, gaze, hair shape, lighting, and framing pixel-identical, and restore crisp, natural photographic detail in skin texture, eyelashes, hair, and fabric without plastic or over-smoothed retouching.',
    custom_with_ref:
      'Keep image 1’s object scale and background unchanged, and apply the element from image 2 naturally to the selected spot.',
    custom_no_ref:
      'Keep image 1’s background and object contours unchanged, and adjust only the selected part naturally.',
  },
} as const;

const WARNINGS = {
  ko: {
    swapPersonNeedRef2: '바꿀 인물 사진을 2번 참조 이미지로 먼저 추가해 주세요.',
    placeMarkRef2Advisory: '로고 원본 이미지를 2번 참조로 추가하면 모양이 정확히 유지돼요.',
    boxTooLarge: '선택 영역이 넓어요. 고칠 부분만 더 작게 고르면 주변 어긋남이 줄어들어요.',
    contourCrossing:
      '상자 테두리가 사물 윤곽선을 가로질러요. 더 안쪽으로 작게 고르거나, 생성 뒤 지우개로 가장자리를 살살 지우면 감쪽같아요.',
  },
  en: {
    swapPersonNeedRef2: 'Add a photo of the new person as reference 2 first.',
    placeMarkRef2Advisory: 'Add the original logo image as reference 2 to preserve its exact shape.',
    boxTooLarge:
      'This selection is wide. Selecting a tighter box around just the part to change reduces seam drift.',
    contourCrossing:
      'The box border crosses an object contour. Draw a tighter box inside, or softly erase the outer edge afterward.',
  },
} as const;

const ALL_PRESET_PROMPTS = new Set<string>([
  ...Object.values(PROMPTS.ko),
  ...Object.values(PROMPTS.en),
]);

/** Whether `text` is empty or matches one of the built-in assistant templates verbatim. */
export function isPresetRegionPrompt(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || ALL_PRESET_PROMPTS.has(trimmed);
}

export function regionAssistantTaskLabel(task: RegionAssistantTaskId, locale: 'ko' | 'en' = 'ko'): string {
  return TASK_LABELS[locale][task];
}

export function buildRegionAssistantTask(input: {
  task: RegionAssistantTaskId;
  locale?: 'ko' | 'en';
  referenceCount?: number;
  currentText?: string;
}): RegionAssistantTaskResult {
  const locale = input.locale ?? 'ko';
  const refCount = Math.max(0, input.referenceCount ?? 0);
  const hasRef2 = refCount >= 1;
  const label = TASK_LABELS[locale][input.task];
  const p = PROMPTS[locale];
  const w = WARNINGS[locale];

  switch (input.task) {
    case 'remove_mark':
      return {
        task: 'remove_mark',
        label,
        prompt: p.remove_mark,
        requiresRef2: false,
        missingRefWarning: null,
        refAdvisory: null,
      };
    case 'place_mark':
      return {
        task: 'place_mark',
        label,
        prompt: hasRef2 ? p.place_mark_with_ref : p.place_mark_text_only,
        requiresRef2: false,
        missingRefWarning: null,
        refAdvisory: hasRef2 ? null : w.placeMarkRef2Advisory,
      };
    case 'swap_person':
      return {
        task: 'swap_person',
        label,
        prompt: p.swap_person,
        requiresRef2: true,
        missingRefWarning: hasRef2 ? null : w.swapPersonNeedRef2,
        refAdvisory: null,
      };
    case 'enhance_detail':
      return {
        task: 'enhance_detail',
        label,
        prompt: p.enhance_detail,
        requiresRef2: false,
        missingRefWarning: null,
        refAdvisory: null,
      };
    case 'custom': {
      const existing = (input.currentText ?? '').trim();
      const starter = hasRef2 ? p.custom_with_ref : p.custom_no_ref;
      const keepUserText = existing.length > 0 && !ALL_PRESET_PROMPTS.has(existing);
      return {
        task: 'custom',
        label,
        prompt: keepUserText ? existing : starter,
        requiresRef2: false,
        missingRefWarning: null,
        refAdvisory: null,
      };
    }
  }
}

export interface RegionBoxAssessment {
  area: number;
  tooLarge: boolean;
  crossesContour: boolean;
  sizeTip: string | null;
  contourTip: string | null;
  warnings: string[];
}

export function assessRegionBox(
  box: RegionBox | null | undefined,
  edgeScore?: number,
  locale: 'ko' | 'en' = 'ko',
): RegionBoxAssessment {
  if (!box) {
    return {
      area: 0,
      tooLarge: false,
      crossesContour: false,
      sizeTip: null,
      contourTip: null,
      warnings: [],
    };
  }
  const area = Math.max(0, box.w * box.h);
  const tooLarge = area > MAX_RECOMMENDED_BOX_AREA;
  const crossesContour = typeof edgeScore === 'number' && Number.isFinite(edgeScore) && edgeScore > CONTOUR_EDGE_THRESHOLD;
  const w = WARNINGS[locale];
  const sizeTip = tooLarge ? w.boxTooLarge : null;
  const contourTip = crossesContour ? w.contourCrossing : null;
  const warnings: string[] = [];
  if (sizeTip) warnings.push(sizeTip);
  if (contourTip) warnings.push(contourTip);
  return { area, tooLarge, crossesContour, sizeTip, contourTip, warnings };
}

/**
 * Pure RGBA buffer evaluator (`width x height x 4`) for normalized gradient contrast (`0..1`)
 * along the 4 edges of `box`. Used by `measureBoxBoundaryEdges` on a 128x128 offscreen canvas.
 */
export function measureBoundaryEdgesFromRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: RegionBox,
): number {
  if (width < 4 || height < 4 || rgba.length < width * height * 4) return 0;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const lum = (x: number, y: number): number => {
    const cx = clamp(x, 0, width - 1);
    const cy = clamp(y, 0, height - 1);
    const i = (cy * width + cx) * 4;
    const a = rgba[i + 3] ?? 255;
    const r = a === 255 ? rgba[i]! : (rgba[i]! * a + 255 * (255 - a)) / 255;
    const g = a === 255 ? rgba[i + 1]! : (rgba[i + 1]! * a + 255 * (255 - a)) / 255;
    const b = a === 255 ? rgba[i + 2]! : (rgba[i + 2]! * a + 255 * (255 - a)) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  const gradAt = (x: number, y: number): number => {
    const gx = lum(x + 1, y) - lum(x - 1, y);
    const gy = lum(x, y + 1) - lum(x, y - 1);
    return Math.min(1, Math.hypot(gx, gy) / 180);
  };

  const x0 = clamp(Math.round(box.x * (width - 1)), 1, width - 2);
  const x1 = clamp(Math.round((box.x + box.w) * (width - 1)), x0 + 1, width - 2);
  const y0 = clamp(Math.round(box.y * (height - 1)), 1, height - 2);
  const y1 = clamp(Math.round((box.y + box.h) * (height - 1)), y0 + 1, height - 2);

  const samples: number[] = [];
  for (let x = x0; x <= x1; x += 1) {
    samples.push(gradAt(x, y0));
    samples.push(gradAt(x, y1));
  }
  for (let y = y0 + 1; y < y1; y += 1) {
    samples.push(gradAt(x0, y));
    samples.push(gradAt(x1, y));
  }
  if (samples.length === 0) return 0;

  // Top-decile mean captures crisp bottle/collar walls crossing the box boundary even on two points,
  // while smooth backgrounds remain near 0.
  samples.sort((a, b) => b - a);
  const topK = Math.max(2, Math.ceil(samples.length * 0.12));
  let sum = 0;
  for (let i = 0; i < topK && i < samples.length; i += 1) {
    sum += samples[i]!;
  }
  return sum / Math.min(topK, samples.length);
}

/**
 * Lightweight client canvas helper (`128x128` offscreen canvas) that measures normalized gradient
 * contrast along the 4 edges of `box`. Safe `try/catch` returns `0` if tainted or unavailable.
 */
export function measureBoxBoundaryEdges(
  imageEl: HTMLImageElement | HTMLCanvasElement | ImageBitmap | null | undefined,
  box: RegionBox | null | undefined,
): number {
  if (!imageEl || !box || typeof document === 'undefined') return 0;
  try {
    if (typeof HTMLImageElement !== 'undefined' && imageEl instanceof HTMLImageElement) {
      if (!imageEl.complete || imageEl.naturalWidth < 2 || imageEl.naturalHeight < 2) return 0;
    }
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    ctx.drawImage(imageEl as CanvasImageSource, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size);
    return measureBoundaryEdgesFromRgba(data.data, size, size, box);
  } catch {
    return 0;
  }
}
