/**
 * Region edit v2 paste-back (./window.ts plans): keep only what the model changed near the customer's
 * box. Every pixel outside the paste zone is the original by construction (the mask exists only inside
 * the zone), and inside the zone a pixel the model did not change keeps the original too.
 *
 * The engine re-renders the whole window. On a sharp, grainy subject (a frosted bottle) that leaves
 * small differences everywhere: outlines a pixel over, grain, highlights a shade off. Those must not be
 * pasted, or the paste spreads over the subject and brings it back softer (production, 2026-11-17).
 *
 *   1. How much changed: the aligned, tone-matched window against the original, both low-passed
 *      (Gaussian, sigma `clamp(selShort * 0.007, 1, 3)`), with the same per-pixel measure as
 *      `computeDiffMask`. Grain and sub-pixel outline shifts mostly cancel; a real content change stays.
 *   2. The core of the edit: pixels at `CORE_LEVEL` or more, joined by a small bridge into components.
 *      A component is kept only when at least `INSIDE_SHARE` of its core pixels lie in the customer's
 *      box. Touching the box is not enough: highlights right at the box's edge were pulled in that way.
 *   3. Its extent: pixels at `CHANGED_LEVEL` or more within `reach` of a kept core and connected to it,
 *      then holes filled. A weak change away from the core (the re-render) stays the original.
 *   4. The edge: grown and softened by `feather` pixels; a zone side on the picture's border gets no
 *      feather (nothing lies beyond it), an inner side fades to the original.
 *
 * When no core is kept (a very subtle edit), the box itself is pasted with a feather inside it, as the
 * crop method does. `reachesEdge` tells the compositor that what is kept runs into an inner side of the
 * zone; it then widens the zone once (window.ts `widestZone`) and runs again.
 *
 * Trade: a change the model made away from the box (the mark's floor reflection) is not pasted, so the
 * old one stays. That leaves no cut line where the zone ends.
 */
import type { Tone } from './composite';
import type { RgbaImage } from './pixels';
import type { PixelRect, RegionPlan } from './plan';

/** Same measure and threshold as align.ts `computeDiffMask` ("active" pixels), on low-passed pictures. */
export const CHANGED_LEVEL = 10;
/** A low-passed change at least this large is content the model changed, not re-render noise. */
export const CORE_LEVEL = 24;
/** Share of a core component's pixels that must lie in the customer's box for it to be pasted. */
export const INSIDE_SHARE = 0.2;

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

/** One (2r+1) running mean along every row or every column, edge replicated; linear in pixels. */
function runningMean(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, alongRows: boolean): void {
  const len = alongRows ? w : h;
  const lines = alongRows ? h : w;
  const step = alongRows ? 1 : w;
  const n = 2 * r + 1;
  for (let l = 0; l < lines; l += 1) {
    const base = alongRows ? l * w : l;
    let s = 0;
    for (let k = -r; k <= r; k += 1) s += src[base + clamp(k, 0, len - 1) * step]!;
    for (let i = 0; i < len; i += 1) {
      dst[base + i * step] = s / n;
      s += src[base + Math.min(i + r + 1, len - 1) * step]! - src[base + Math.max(i - r, 0) * step]!;
    }
  }
}

/** Mean over a (2r+1)² square with edge replication, separable, running sums. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  runningMean(src, tmp, w, h, r, true);
  runningMean(tmp, out, w, h, r, false);
  return out;
}

/** Radii of three box passes that together approximate a Gaussian of `sigma`. */
export function gaussBoxRadii(sigma: number): number[] {
  const passes = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl -= 1;
  const m = Math.round((12 * sigma * sigma - passes * wl * wl - 4 * passes * wl - 3 * passes) / (-4 * wl - 4));
  return Array.from({ length: passes }, (_, i) => ((i < m ? wl : wl + 2) - 1) / 2);
}

/** Approximate Gaussian blur in place: three running-mean passes each way, linear in pixels. */
function gaussBlur(buf: Float32Array, tmp: Float32Array, w: number, h: number, sigma: number): void {
  for (const r of gaussBoxRadii(sigma)) {
    if (r <= 0) continue;
    runningMean(buf, tmp, w, h, r, true);
    runningMean(tmp, buf, w, h, r, false);
  }
}

/** Label the 8-connected components of `on` (1..count, 0 = off). */
function labelComponents(on: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let seed = 0; seed < on.length; seed += 1) {
    if (!on[seed] || labels[seed]) continue;
    count += 1;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = count;
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
          if (on[q] && !labels[q]) {
            labels[q] = count;
            stack[top++] = q;
          }
        }
      }
    }
  }
  return { labels, count };
}

/** Keep the 8-connected components of `on` that hold a pixel set in `seeds`. */
function componentsFrom(on: Uint8Array, seeds: Uint8Array, w: number, h: number): Uint8Array {
  const keep = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let seed = 0; seed < on.length; seed += 1) {
    if (!seeds[seed] || !on[seed] || keep[seed]) continue;
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
  /** False when no core of a change lay in the box and the box itself was pasted. */
  changeFound: boolean;
  /** Share of the zone pasted at full weight (0..1). */
  pasted: number;
  /** True when what is kept runs into a side of the zone that lies inside the picture (it may be cut off). */
  reachesEdge: boolean;
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
  const n = zw * zh;
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

  // 1. How much changed, on low-passed pictures. Blurring is linear, so blurring the signed difference
  //    of one channel equals differencing the two blurred pictures.
  const sigma = clamp(selShort * 0.007, 1, 3);
  const diff = new Float32Array(n);
  const tmp = new Float32Array(n);
  const maxD = new Float32Array(n);
  const sumD = new Float32Array(n);
  for (let c = 0; c < 3; c += 1) {
    for (let zy = 0; zy < zh; zy += 1) {
      const y = zone.top + zy;
      for (let zx = 0; zx < zw; zx += 1) {
        const x = zone.left + zx;
        const oi = (y * src.width + x) * 4;
        const ei = ((y - roi.top) * roi.width + (x - roi.left)) * channels;
        const a = src.hasAlpha ? src.data[oi + 3]! : 255;
        const o = a === 255 ? src.data[oi + c]! : (src.data[oi + c]! * a + 255 * (255 - a)) / 255;
        const e = clamp(edit[ei + c]! * tone.gain[c]! + tone.offset[c]!, 0, 255);
        diff[zy * zw + zx] = e - o;
      }
    }
    gaussBlur(diff, tmp, zw, zh, sigma);
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(diff[i]!);
      if (d > maxD[i]!) maxD[i] = d;
      sumD[i] += d;
    }
  }
  const core = new Uint8Array(n);
  const weak = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const m = 0.5 * maxD[i]! + 0.5 * (sumD[i]! / 3);
    if (m >= CORE_LEVEL) core[i] = 1;
    if (m >= CHANGED_LEVEL) weak[i] = 1;
  }

  // 2. The core of the edit: bridged core components with enough of their core pixels in the box.
  const bridge = clamp(Math.round(selShort * 0.015), 2, 6);
  const { labels, count } = labelComponents(dilateBinary(core, zw, zh, bridge), zw, zh);
  const total = new Int32Array(count + 1);
  const inBox = new Int32Array(count + 1);
  for (let zy = 0; zy < zh; zy += 1) {
    const rowIn = zy >= sel.top && zy < sel.top + sel.height;
    for (let zx = 0; zx < zw; zx += 1) {
      const i = zy * zw + zx;
      if (!core[i]) continue;
      const l = labels[i]!;
      total[l] += 1;
      if (rowIn && zx >= sel.left && zx < sel.left + sel.width) inBox[l] += 1;
    }
  }
  const coreKept = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i += 1) {
    const l = labels[i]!;
    if (core[i] && inBox[l]! >= INSIDE_SHARE * total[l]!) {
      coreKept[i] = 1;
      any = true;
    }
  }

  const mask = new Uint8Array(n);
  if (!any) {
    // No core of a change in the box: paste the box itself, feathered inside it.
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
    return { mask, changeFound: false, pasted: (sel.width * sel.height) / n, reachesEdge: false };
  }

  // 3. Its extent: changed pixels near a kept core and connected to it, holes filled.
  const reach = clamp(Math.round(selShort * 0.04), 4, 16);
  const near = dilateBinary(coreKept, zw, zh, reach);
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) cand[i] = coreKept[i] || (weak[i] && near[i]) ? 1 : 0;
  const kept = componentsFrom(cand, coreKept, zw, zh);
  fillHoles(kept, zw, zh);
  // Does the kept change run into an inner side of the zone (two or more pixels on it)?
  let edgeHits = 0;
  for (let zx = 0; zx < zw; zx += 1) {
    if (!open.top && kept[zx]) edgeHits += 1;
    if (!open.bottom && kept[(zh - 1) * zw + zx]) edgeHits += 1;
  }
  for (let zy = 0; zy < zh; zy += 1) {
    if (!open.left && kept[zy * zw]) edgeHits += 1;
    if (!open.right && kept[zy * zw + zw - 1]) edgeHits += 1;
  }

  // 4. The edge.
  const grown = dilateBinary(kept, zw, zh, feather);
  const soft = new Float32Array(n);
  for (let i = 0; i < n; i += 1) soft[i] = grown[i]!;
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
  return { mask, changeFound: true, pasted: full / n, reachesEdge: edgeHits >= 2 };
}
