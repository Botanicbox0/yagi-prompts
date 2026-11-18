/**
 * Region edit v2 (`BRAND_STUDIO_REGION_V2`, docs/BRAND-STUDIO-V6-PLAN.md "부분 수정 v2"): where the edit
 * happens when the edit model sees as much of the picture as it can take at its own size. Pure.
 *
 * - The customer's box (`select`) grows into a paste zone (`box`): each side by 40% of the box's
 *   shorter side, at least 24 px, inside the picture. Only the zone may change. When what changed
 *   runs into the zone's edge, the paste widens it once (`widestZone`, up to the box's longer side).
 * - The window (`roi`) is what the model receives: the whole picture when its shape is one the model
 *   takes, else the largest rectangle of a supported shape that holds the zone, centred on the box as
 *   far as the picture allows.
 * - The model returns a fixed size per shape (`SEEDREAM_2K_SIZES`). A window larger than that is shrunk
 *   toward the zone so the customer's pixels go 1:1; when the zone plus a context margin is still
 *   larger, the window is sent smaller and `downscale` records by how much.
 * - Nothing is enlarged on our side; the window is sent at its own size.
 *
 * The bench (2026-11-16) found the whole-picture edit kept 99.2% of the untouched pixels and the one
 * failure of the crop method came from a tiny crop blown up ~10x; this plan avoids both.
 */
import type { RegionBox } from '@/lib/brand-studio/contracts';
import { boxToPixels, parseAspect, WORK_MAX_LONG, type PixelRect, type RegionPlan } from './plan';

/** Shapes Seedream 5.5's image editing takes (models.ts `SEEDREAM_ASPECTS`). */
export const SEEDREAM_EDIT_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const;

/**
 * Size Seedream 5.5 returns at 2K for each shape. Measured on the 2026-11-16 bench (16:9 2560x1440,
 * 9:16 1440x2560, 4:3 2304x1728, 3:4 1728x2304, 21:9 3024x1296); 1:1, 3:2 and 2:3 are the provider's
 * listed 2K sizes for the same family. Re-measure when the provider changes the model.
 */
export const SEEDREAM_2K_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  '1:1': [2048, 2048],
  '4:3': [2304, 1728],
  '3:4': [1728, 2304],
  '16:9': [2560, 1440],
  '9:16': [1440, 2560],
  '3:2': [2496, 1664],
  '2:3': [1664, 2496],
  '21:9': [3024, 1296],
};

/** The paste zone grows each side by this share of the box's shorter side ... */
export const ZONE_GROW = 0.4;
/** ... and by at least this many pixels. */
export const ZONE_MIN_PX = 24;
/** A picture whose shape is within 1% of a supported one is sent whole at that shape. */
const SAME_SHAPE = 0.01;
/** Context kept around the zone when a large window is shrunk: 10% of the zone's long side, at least 48 px. */
const CONTEXT_SHARE = 0.1;
const CONTEXT_MIN_PX = 48;

export function pasteZone(image: { width: number; height: number }, select: PixelRect): PixelRect {
  const grow = Math.max(ZONE_MIN_PX, Math.round(Math.min(select.width, select.height) * ZONE_GROW));
  const left = Math.max(0, select.left - grow);
  const top = Math.max(0, select.top - grow);
  const right = Math.min(image.width, select.left + select.width + grow);
  const bottom = Math.min(image.height, select.top + select.height + grow);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * The widest paste zone a change may take: each side grown by the box's longer side (never less than
 * `pasteZone`), inside the picture and the window. Used once, when what changed runs into the edge of
 * the first zone (a tulip taller than the teapot it replaced). Null when it is no wider.
 */
export function widestZone(image: { width: number; height: number }, plan: Pick<RegionPlan, 'roi' | 'box' | 'select'>): PixelRect | null {
  const s = plan.select;
  if (!s) return null;
  const grow = Math.max(ZONE_MIN_PX, Math.round(Math.min(s.width, s.height) * ZONE_GROW), Math.max(s.width, s.height));
  const { roi } = plan;
  const left = Math.max(0, roi.left, s.left - grow);
  const top = Math.max(0, roi.top, s.top - grow);
  const right = Math.min(image.width, roi.left + roi.width, s.left + s.width + grow);
  const bottom = Math.min(image.height, roi.top + roi.height, s.top + s.height + grow);
  const wide = { left: Math.min(left, plan.box.left), top: Math.min(top, plan.box.top), width: 0, height: 0 };
  wide.width = Math.max(right, plan.box.left + plan.box.width) - wide.left;
  wide.height = Math.max(bottom, plan.box.top + plan.box.height) - wide.top;
  const same = wide.left === plan.box.left && wide.top === plan.box.top && wide.width === plan.box.width && wide.height === plan.box.height;
  return same ? null : wide;
}

/** Start of a span of `size` that holds [lo, hi), centred on `centre` as far as [0, total) allows. */
function placeSpan(centre: number, size: number, lo: number, hi: number, total: number): number {
  const min = Math.max(0, hi - size);
  const max = Math.min(lo, total - size);
  return Math.min(max, Math.max(min, Math.round(centre - size / 2)));
}

function place(image: { width: number; height: number }, select: PixelRect, zone: PixelRect, width: number, height: number): PixelRect {
  return {
    left: placeSpan(select.left + select.width / 2, width, zone.left, zone.left + zone.width, image.width),
    top: placeSpan(select.top + select.height / 2, height, zone.top, zone.top + zone.height, image.height),
    width,
    height,
  };
}

/** Where the customer's box sits in the window: words and whole percentages of the window. */
export interface SelectionPlace {
  where: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const PLACES: Record<string, string> = {
  'top-left': 'top left',
  'top-': 'top middle',
  'top-right': 'top right',
  '-left': 'left side',
  '-': 'centre',
  '-right': 'right side',
  'bottom-left': 'bottom left',
  'bottom-': 'bottom middle',
  'bottom-right': 'bottom right',
};

export function describeSelection(plan: Pick<RegionPlan, 'roi' | 'select' | 'box'>): SelectionPlace {
  const s = plan.select ?? plan.box;
  const { roi } = plan;
  const pct = (v: number, of: number) => Math.min(100, Math.max(0, Math.round((v / of) * 100)));
  const left = pct(s.left - roi.left, roi.width);
  const right = pct(s.left + s.width - roi.left, roi.width);
  const top = pct(s.top - roi.top, roi.height);
  const bottom = pct(s.top + s.height - roi.top, roi.height);
  const cx = (s.left + s.width / 2 - roi.left) / roi.width;
  const cy = (s.top + s.height / 2 - roi.top) / roi.height;
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : '';
  const v = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : '';
  return { where: PLACES[`${v}-${h}`]!, left, top, right, bottom };
}

/** The sentence every v2 partial edit ends with, so the engine finds the part without a mask. */
export function selectionLine(place: SelectionPlace, target = 'Image 1'): string {
  return `The part to change is in the ${place.where} of ${target}, about ${place.left}-${place.right}% from the left edge and ${place.top}-${place.bottom}% from the top edge; change nothing outside it.`;
}

export function planRegionWindow(
  image: { width: number; height: number },
  region: RegionBox,
  options: { aspects?: readonly string[]; outputs?: Readonly<Record<string, readonly [number, number]>> } = {},
): RegionPlan {
  const W = Math.max(1, Math.round(image.width));
  const H = Math.max(1, Math.round(image.height));
  const size = { width: W, height: H };
  const outputs = options.outputs ?? SEEDREAM_2K_SIZES;
  const shapes = (options.aspects ?? SEEDREAM_EDIT_ASPECTS)
    .map((label) => ({ label, ratio: parseAspect(label) }))
    .filter((a): a is { label: string; ratio: number } => a.ratio !== null);
  const select = boxToPixels(size, region);
  const zone = pasteZone(size, select);
  const pictureRatio = W / H;
  const whole: PixelRect = { left: 0, top: 0, width: W, height: H };

  let aspect: string;
  let ratio: number;
  let roi: PixelRect;
  let stretched = false;
  const same = shapes.find((s) => Math.abs(Math.log(s.ratio / pictureRatio)) < SAME_SHAPE);
  if (same) {
    ({ label: aspect, ratio } = same);
    roi = whole;
  } else {
    let best: { label: string; ratio: number; width: number; height: number } | null = null;
    for (const s of shapes) {
      const width = pictureRatio > s.ratio ? Math.min(W, Math.round(H * s.ratio)) : W;
      const height = pictureRatio > s.ratio ? H : Math.min(H, Math.round(W / s.ratio));
      if (width < zone.width || height < zone.height) continue;
      const area = width * height;
      const better =
        !best ||
        area > best.width * best.height ||
        (area === best.width * best.height && Math.abs(Math.log(s.ratio / pictureRatio)) < Math.abs(Math.log(best.ratio / pictureRatio)));
      if (better) best = { ...s, width, height };
    }
    if (best) {
      ({ label: aspect, ratio } = best);
      roi = place(size, select, zone, best.width, best.height);
    } else {
      // No supported shape holds the zone (a very wide or tall picture with a wide box): send the whole
      // picture at the nearest shape, as the crop method does; alignment absorbs the stretch.
      const nearest = shapes.reduce((acc, s) => (Math.abs(Math.log(s.ratio / pictureRatio)) < Math.abs(Math.log(acc.ratio / pictureRatio)) ? s : acc), shapes[0]!);
      ({ label: aspect, ratio } = nearest);
      roi = whole;
      stretched = true;
    }
  }

  // Keep the customer's pixels 1:1 where the model's output allows it.
  const out = outputs[aspect];
  let work = { width: roi.width, height: roi.height };
  let downscale = 1;
  if (out && !stretched && roi.width > out[0]) {
    const margin = Math.max(CONTEXT_MIN_PX, Math.round(Math.max(zone.width, zone.height) * CONTEXT_SHARE));
    const need = Math.max(zone.width + 2 * margin, (zone.height + 2 * margin) * ratio);
    const width = Math.min(roi.width, Math.max(out[0], Math.ceil(need)));
    const height = Math.min(roi.height, Math.max(zone.height, Math.round(width / ratio)));
    roi = place(size, select, zone, Math.max(zone.width, width), height);
    if (roi.width > out[0]) {
      downscale = out[0] / roi.width;
      work = { width: out[0], height: Math.max(1, Math.round(roi.height * downscale)) };
    } else {
      work = { width: roi.width, height: roi.height };
    }
  }

  // Edit models take up to 4K: a larger window (only the stretched fallback gets here) is sent smaller.
  const long = Math.max(work.width, work.height);
  if (long > WORK_MAX_LONG) {
    const k = WORK_MAX_LONG / long;
    work = { width: Math.max(1, Math.round(work.width * k)), height: Math.max(1, Math.round(work.height * k)) };
    downscale = work.width / roi.width;
  }

  return {
    roi,
    box: zone,
    select,
    aspect,
    work,
    downscale,
    ...(out ? { output: { width: out[0], height: out[1] } } : {}),
    ...(stretched ? { stretched: true } : {}),
  };
}
