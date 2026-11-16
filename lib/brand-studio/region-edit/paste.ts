/**
 * Region edit v2 paste-back (./window.ts plans): keep only what the model changed near the customer's
 * box. Every pixel outside the paste zone is the original by construction (the mask exists only inside
 * the zone), and inside the zone a pixel the model did not change keeps the original too.
 *
 *   1. What changed: the aligned, tone-matched window against the original, per pixel (the same measure
 *      as `computeDiffMask`), then an opening (3x3) so resampling specks and one-pixel edge seams drop out.
 *   2. What belongs to the edit: the changed areas, bridged by a few pixels, that touch the customer's
 *      box. A change elsewhere in the zone is not pasted. Holes inside a kept area are filled.
 *   3. The edge: grown and softened by `feather` pixels; a zone side on the picture's border gets no
 *      feather (nothing lies beyond it), an inner side fades to the original.
 *
 * When nothing that changed touches the box (a very subtle edit), the box itself is pasted with a
 * feather inside it, as the crop method does.
 */
import type { Tone } from './composite';
import type { RgbaImage } from './pixels';
import type { PixelRect, RegionPlan } from './plan';

/** Same measure and threshold as align.ts `computeDiffMask` ("active" pixels). */
const CHANGED_LEVEL = 10;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function smoothstep(d: number, f: number): number {
  if (f <= 0 || d > f) return 1;
  const t = d / (f + 1);
  return t * t * (3 - 2 * t);
}

/** Binary dilation by a (2r+1)² square, separable, with prefix counts. */
export function dilateBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return Uint8Array.from(src);
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const row = new Int32Array(w + 1);
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    row[0] = 0;
    for (let x = 0; x < w; x += 1) row[x + 1] = row[x]! + (src[o + x] ? 1 : 0);
    for (let x = 0; x < w; x += 1) tmp[o + x] = row[Math.min(w, x + r + 1)]! - row[Math.max(0, x - r)]! > 0 ? 1 : 0;
  }
  const col = new Int32Array(h + 1);
  for (let x = 0; x < w; x += 1) {
    col[0] = 0;
    for (let y = 0; y < h; y += 1) col[y + 1] = col[y]! + tmp[y * w + x]!;
    for (let y = 0; y < h; y += 1) out[y * w + x] = col[Math.min(h, y + r + 1)]! - col[Math.max(0, y - r)]! > 0 ? 1 : 0;
  }
  return out;
}

/** Binary erosion: a pixel stays only when its whole (2r+1)² square is set (outside the image counts as set). */
export function erodeBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i += 1) inv[i] = src[i] ? 0 : 1;
  const grown = dilateBinary(inv, w, h, r);
  for (let i = 0; i < grown.length; i += 1) grown[i] = grown[i] ? 0 : 1;
  return grown;
}

/** Mean over a (2r+1)² square with edge replication, separable. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return Float32Array.from(src);
  const n = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let k = -r; k <= r; k += 1) s += src[o + clamp(x + k, 0, w - 1)]!;
      tmp[o + x] = s / n;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let s = 0;
      for (let k = -r; k <= r; k += 1) s += tmp[clamp(y + k, 0, h - 1) * w + x]!;
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Keep the 8-connected components of `on` that have a pixel inside `rect` (zone coordinates). */
function componentsTouching(on: Uint8Array, w: number, h: number, rect: PixelRect): Uint8Array {
  const keep = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const seed = y * w + x;
      if (!on[seed] || keep[seed]) continue;
      let top = 0;
      stack[top++] = seed;
      keep[seed] = 1;
      while (top > 0) {
        const p = stack[--top]!;
        const px = p % w;
        const py = (p - px) / w;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = px + dx;
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (on[q] && !keep[q]) {
              keep[q] = 1;
              stack[top++] = q;
            }
          }
        }
      }
    }
  }
  return keep;
}

/** Set every pixel not reachable (4-connected, through unset pixels) from the zone's edge. */
function fillHoles(on: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (p: number) => {
    if (!on[p] && !outside[p]) {
      outside[p] = 1;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (top > 0) {
    const p = stack[--top]!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  for (let i = 0; i < on.length; i += 1) if (!outside[i]) on[i] = 1;
}

export interface ChangeMask {
  /** 0..255, `plan.box.width * plan.box.height`, row-major over the paste zone. */
  mask: Uint8Array;
  /** False when nothing that changed touched the box and the box itself was pasted. */
  changeFound: boolean;
  /** Share of the zone pasted at full weight (0..1). */
  pasted: number;
}

export function computeChangeMask(input: {
  original: RgbaImage;
  /** RGB(A), `channels` wide, the size of `plan.roi`. */
  alignedRoi: Buffer;
  channels: number;
  plan: RegionPlan;
  tone: Tone;
  feather?: number;
}): ChangeMask {
  const { original: src, alignedRoi: edit, channels, plan, tone } = input;
  const { roi, box: zone } = plan;
  const select = plan.select ?? plan.box;
  const zw = zone.width;
  const zh = zone.height;
  const selShort = Math.min(select.width, select.height);
  const feather = input.feather === undefined ? clamp(Math.round(selShort * 0.04), 3, 16) : Math.max(0, Math.round(input.feather));
  const open = {
    left: zone.left === 0,
    top: zone.top === 0,
    right: zone.left + zw === src.width,
    bottom: zone.top + zh === src.height,
  };
  const sideWeight = (onBorder: boolean, d: number) => (onBorder ? 1 : smoothstep(d, feather));
  // The customer's box in zone coordinates.
  const sel: PixelRect = { left: select.left - zone.left, top: select.top - zone.top, width: select.width, height: select.height };

  // 1. What changed.
  const changed = new Uint8Array(zw * zh);
  for (let zy = 0; zy < zh; zy += 1) {
    const y = zone.top + zy;
    for (let zx = 0; zx < zw; zx += 1) {
      const x = zone.left + zx;
      const oi = (y * src.width + x) * 4;
      const ei = ((y - roi.top) * roi.width + (x - roi.left)) * channels;
      const a = src.hasAlpha ? src.data[oi + 3]! : 255;
      let maxD = 0;
      let sumD = 0;
      for (let c = 0; c < 3; c += 1) {
        const o = a === 255 ? src.data[oi + c]! : (src.data[oi + c]! * a + 255 * (255 - a)) / 255;
        const e = clamp(edit[ei + c]! * tone.gain[c]! + tone.offset[c]!, 0, 255);
        const d = Math.abs(e - o);
        if (d > maxD) maxD = d;
        sumD += d;
      }
      if (0.5 * maxD + 0.5 * (sumD / 3) >= CHANGED_LEVEL) changed[zy * zw + zx] = 1;
    }
  }
  const opened = dilateBinary(erodeBinary(changed, zw, zh, 1), zw, zh, 1);

  // 2. What belongs to the edit.
  const bridge = clamp(Math.round(selShort * 0.03), 2, 10);
  const bridged = dilateBinary(opened, zw, zh, bridge);
  const kept = componentsTouching(bridged, zw, zh, sel);
  let any = false;
  for (let i = 0; i < kept.length; i += 1) {
    if (kept[i]) {
      any = true;
      break;
    }
  }

  const mask = new Uint8Array(zw * zh);
  if (!any) {
    // Nothing that changed touches the box: paste the box itself, feathered inside it.
    const f = Math.max(0, Math.min(feather, Math.floor((selShort - 1) / 2)));
    const selOpen = {
      left: select.left === 0,
      top: select.top === 0,
      right: select.left + select.width === src.width,
      bottom: select.top + select.height === src.height,
    };
    const w = (onBorder: boolean, d: number) => (onBorder ? 1 : smoothstep(d, f));
    for (let by = 0; by < sel.height; by += 1) {
      for (let bx = 0; bx < sel.width; bx += 1) {
        const v = Math.min(w(selOpen.left, bx + 1), w(selOpen.right, sel.width - bx), w(selOpen.top, by + 1), w(selOpen.bottom, sel.height - by));
        mask[(sel.top + by) * zw + sel.left + bx] = Math.round(v * 255);
      }
    }
    return { mask, changeFound: false, pasted: (sel.width * sel.height) / (zw * zh) };
  }
  fillHoles(kept, zw, zh);

  // 3. The edge.
  const grown = dilateBinary(kept, zw, zh, feather);
  const soft = new Float32Array(zw * zh);
  for (let i = 0; i < soft.length; i += 1) soft[i] = grown[i]!;
  const blurred = boxBlur(soft, zw, zh, feather);
  let full = 0;
  for (let zy = 0; zy < zh; zy += 1) {
    const wT = sideWeight(open.top, zy + 1);
    const wB = sideWeight(open.bottom, zh - zy);
    for (let zx = 0; zx < zw; zx += 1) {
      const i = zy * zw + zx;
      const env = Math.min(wT, wB, sideWeight(open.left, zx + 1), sideWeight(open.right, zw - zx));
      const v = Math.round(clamp(blurred[i]! * env, 0, 1) * 255);
      mask[i] = v;
      if (v === 255) full += 1;
    }
  }
  return { mask, changeFound: true, pasted: full / (zw * zh) };
}
