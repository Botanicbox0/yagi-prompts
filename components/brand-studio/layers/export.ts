/**
 * Export of a decorated picture (docs/BRAND-STUDIO-V3.md §5): the base and every visible layer drawn
 * onto one canvas at the base's stored pixel size, encoded as PNG. Planning is pure (testable without a
 * browser); drawing takes any 2D context; `renderPlan` wires loading, drawing and encoding through
 * injected dependencies so the failure paths can be tested too.
 */
import { STUDIO_LIMITS } from "@/lib/brand-studio/contracts";
import { boundsOf } from "./geometry";
import { MIN_SIDE, canMergeDown, type Box, type FontId, type Frame, type Layer, type LayerDoc, type ShapeKind, type TextLayer } from "./model";
import { layoutText, fontShorthand, graphemes, type Measure, type TextLayout } from "./text-layout";

export const BASE_OP_ID = "base";

interface OpBase {
  layerId: string;
  /** Shown in the failure line ("‘로고 1’을 불러오지 못했어요"). */
  name: string;
  frame: Frame;
  opacity: number;
}

export interface ImageOp extends OpBase {
  kind: "image";
  url: string;
  maskUrl?: string;
}

export interface ShapeOp extends OpBase {
  kind: "shape";
  shape: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export interface TextOp extends OpBase {
  kind: "text";
  font: FontId;
  weight: number;
  size: number;
  color: string;
  spacingPx: number;
  layout: TextLayout;
  plate: { color: string; radius: number } | null;
}

export type DrawOp = ImageOp | ShapeOp | TextOp;

export interface ExportPlan {
  width: number;
  height: number;
  ops: DrawOp[];
}

export interface ExportBase {
  url: string;
  width: number;
  height: number;
  name: string;
}

function layerToOp(layer: Layer, measureFor: (layer: TextLayer) => Measure): DrawOp {
  const common = { layerId: layer.id, name: layer.name, opacity: layer.opacity };
  if (layer.kind === "image") {
    return {
      ...common,
      kind: "image",
      url: layer.src.url,
      frame: frameOf(layer),
      ...(layer.maskDataUrl ? { maskUrl: layer.maskDataUrl } : {}),
    };
  }
  if (layer.kind === "shape") {
    return {
      ...common,
      kind: "shape",
      frame: frameOf(layer),
      shape: layer.shape,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      radius: layer.radius,
    };
  }
  const layout = layoutText(layer, measureFor(layer));
  return {
    ...common,
    kind: "text",
    frame: { ...frameOf(layer), h: layout.height },
    font: layer.font,
    weight: layer.weight,
    size: layer.size,
    color: layer.color,
    spacingPx: layer.letterSpacing * layer.size,
    layout,
    plate: layer.plate ? { color: layer.plate.color, radius: layer.plate.radius * layer.size } : null,
  };
}

/** What gets drawn, in order: the base, then every visible layer bottom to top. Text is laid out here. */
export function planExport(doc: LayerDoc, base: ExportBase, measureFor: (layer: TextLayer) => Measure): ExportPlan {
  const ops: DrawOp[] = [
    { kind: "image", layerId: BASE_OP_ID, name: base.name, url: base.url, frame: { x: 0, y: 0, w: base.width, h: base.height, rotation: 0 }, opacity: 1 },
  ];
  for (const layer of doc.layers) {
    if (layer.hidden || layer.opacity <= 0) continue;
    ops.push(layerToOp(layer, measureFor));
  }
  return { width: base.width, height: base.height, ops };
}

/**
 * Plans merging the selected layer (`id`) into the layer right beneath it (`index > 0`),
 * or baking `layers[0]` onto the base region beneath it (`index === 0`) as a flattened layer above base.
 */
export function planMergeDown(
  doc: LayerDoc,
  id: string,
  base: ExportBase,
  measureFor: (layer: TextLayer) => Measure,
): { plan: ExportPlan; box: Box } | null {
  if (!canMergeDown(doc, id)) return null;
  const index = doc.layers.findIndex((l) => l.id === id);
  const upperOp = layerToOp(doc.layers[index]!, measureFor);

  if (index > 0) {
    const lowerOp = layerToOp(doc.layers[index - 1]!, measureFor);
    const b1 = boundsOf(lowerOp.frame);
    const b2 = boundsOf(upperOp.frame);
    const x = Math.floor(Math.min(b1.x, b2.x));
    const y = Math.floor(Math.min(b1.y, b2.y));
    const right = Math.ceil(Math.max(b1.x + b1.w, b2.x + b2.w));
    const bottom = Math.ceil(Math.max(b1.y + b1.h, b2.y + b2.h));
    const w = Math.max(MIN_SIDE, right - x);
    const h = Math.max(MIN_SIDE, bottom - y);
    const shift = (op: DrawOp): DrawOp => ({
      ...op,
      frame: { ...op.frame, x: op.frame.x - x, y: op.frame.y - y },
    });
    const ops: DrawOp[] = [];
    if (lowerOp.opacity > 0) ops.push(shift(lowerOp));
    if (upperOp.opacity > 0) ops.push(shift(upperOp));
    return { plan: { width: w, height: h, ops }, box: { x, y, w, h } };
  }

  const ub = boundsOf(upperOp.frame);
  const x = Math.max(0, Math.floor(ub.x));
  const y = Math.max(0, Math.floor(ub.y));
  const right = Math.min(base.width, Math.ceil(ub.x + ub.w));
  const bottom = Math.min(base.height, Math.ceil(ub.y + ub.h));
  const w = Math.max(MIN_SIDE, right - x);
  const h = Math.max(MIN_SIDE, bottom - y);
  const ops: DrawOp[] = [
    {
      kind: "image",
      layerId: BASE_OP_ID,
      name: base.name,
      url: base.url,
      frame: { x: -x, y: -y, w: base.width, h: base.height, rotation: 0 },
      opacity: 1,
    },
  ];
  if (upperOp.opacity > 0) {
    ops.push({
      ...upperOp,
      frame: { ...upperOp.frame, x: upperOp.frame.x - x, y: upperOp.frame.y - y },
    });
  }
  return { plan: { width: w, height: h, ops }, box: { x, y, w, h } };
}

const frameOf = (f: Frame): Frame => ({ x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation });

/** Unique picture addresses (including layer alpha masks) with the names of the layers that use them. */
export function imageSources(plan: ExportPlan): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const op of plan.ops) {
    if (op.kind !== "image") continue;
    map.set(op.url, [...(map.get(op.url) ?? []), op.name]);
    if (op.maskUrl) map.set(op.maskUrl, [...(map.get(op.maskUrl) ?? []), op.name]);
  }
  return map;
}

/* --------------------------------------------------------------- geometry */

export interface ShapeGeometry {
  kind: ShapeKind;
  /** Fill and stroke follow one path, inset by half the stroke so the stroke stays inside the box. */
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  strokeWidth: number;
}

/** Shared by the stage (SVG) and the export (canvas), so both draw the same outline. */
export function shapeGeometry(shape: { shape: ShapeKind; stroke: string | null; strokeWidth: number; radius: number }, w: number, h: number): ShapeGeometry {
  const stroke = shape.stroke && shape.strokeWidth > 0 ? Math.min(shape.strokeWidth, Math.min(w, h) / 2) : 0;
  const inset = stroke / 2;
  const iw = Math.max(0, w - stroke);
  const ih = Math.max(0, h - stroke);
  return { kind: shape.shape, x: inset, y: inset, w: iw, h: ih, radius: Math.max(0, Math.min(shape.radius - inset, iw / 2, ih / 2)), strokeWidth: stroke };
}

/** Where line `index` of a text layer puts its alphabetic baseline, from the top of the layer box. */
export function baselineY(layout: TextLayout, index: number, ascent: number, descent: number): number {
  const top = layout.pad + index * layout.lineHeightPx;
  return top + (layout.lineHeightPx - (ascent + descent)) / 2 + ascent;
}

/* ------------------------------------------------------------------ drawing */

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (!radius) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawLine(ctx: Ctx, text: string, x: number, y: number, spacing: number): void {
  if (!text) return;
  if (!spacing) {
    ctx.fillText(text, x, y);
    return;
  }
  const spaced = ctx as Ctx & { letterSpacing?: string };
  if (typeof spaced.letterSpacing === "string") {
    spaced.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    spaced.letterSpacing = "0px";
    return;
  }
  // Older engines: place each character where CSS would, keeping the font's own advances.
  let prefix = "";
  graphemes(text).forEach((g, i) => {
    ctx.fillText(g, x + (prefix ? ctx.measureText(prefix).width : 0) + spacing * i, y);
    prefix += g;
  });
}

function defaultOffscreen(ctx: Ctx, width: number, height: number): CanvasLike | null {
  try {
    const doc = (ctx as { canvas?: { ownerDocument?: Document } }).canvas?.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
    if (!doc) return null;
    const canvas = doc.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  } catch {
    return null;
  }
}

/** Draws a plan onto a context whose canvas is `plan.width` × `plan.height`. */
export function drawPlan(
  ctx: Ctx,
  plan: ExportPlan,
  images: ReadonlyMap<string, CanvasImageSource>,
  family: (font: FontId) => string,
  createOffscreen?: (width: number, height: number) => CanvasLike | null,
): void {
  for (const op of plan.ops) {
    const f = op.frame;
    ctx.save();
    ctx.globalAlpha = op.opacity;
    ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
    if (f.rotation) ctx.rotate((f.rotation * Math.PI) / 180);
    ctx.translate(-f.w / 2, -f.h / 2);
    if (op.kind === "image") {
      const image = images.get(op.url);
      const mask = op.maskUrl ? images.get(op.maskUrl) : undefined;
      if (image && mask) {
        const mw = Math.max(1, Math.round(f.w));
        const mh = Math.max(1, Math.round(f.h));
        const off = createOffscreen ? createOffscreen(mw, mh) : defaultOffscreen(ctx, mw, mh);
        const offCtx = off?.getContext("2d") ?? null;
        if (off && offCtx) {
          offCtx.clearRect?.(0, 0, mw, mh);
          offCtx.globalCompositeOperation = "source-over";
          offCtx.drawImage(image, 0, 0, mw, mh);
          offCtx.globalCompositeOperation = "destination-in";
          offCtx.drawImage(mask, 0, 0, mw, mh);
          offCtx.globalCompositeOperation = "source-over";
          ctx.drawImage(off as unknown as CanvasImageSource, 0, 0, f.w, f.h);
        } else {
          ctx.drawImage(image, 0, 0, f.w, f.h);
        }
      } else if (image) {
        ctx.drawImage(image, 0, 0, f.w, f.h);
      }
    } else if (op.kind === "shape") {
      const g = shapeGeometry(op, f.w, f.h);
      if (g.kind === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
      } else roundRect(ctx, g.x, g.y, g.w, g.h, g.radius);
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill();
      }
      if (op.stroke && g.strokeWidth > 0) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = g.strokeWidth;
        ctx.stroke();
      }
    } else {
      if (op.plate) {
        roundRect(ctx, 0, 0, f.w, f.h, op.plate.radius);
        ctx.fillStyle = op.plate.color;
        ctx.fill();
      }
      ctx.font = fontShorthand(op, family(op.font));
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = op.color;
      const metrics = ctx.measureText("Hg한");
      const ascent = metrics.fontBoundingBoxAscent ?? op.size * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? op.size * 0.2;
      op.layout.lines.forEach((line, i) => drawLine(ctx, line.text, op.layout.pad + line.x, baselineY(op.layout, i, ascent, descent), op.spacingPx));
    }
    ctx.restore();
  }
}

/* --------------------------------------------------------------- rendering */

export type ExportStep = "fonts" | "images" | "drawing" | "saving";
export const EXPORT_STEPS: readonly ExportStep[] = ["fonts", "images", "drawing", "saving"];

export type ExportMime = "image/png" | "image/webp" | "image/jpeg";

export interface CanvasLike {
  getContext(type: "2d"): CanvasRenderingContext2D | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface RenderDeps {
  loadImage(url: string): Promise<CanvasImageSource>;
  family(font: FontId): string;
  createCanvas(width: number, height: number): CanvasLike | null;
  waitForFonts?(plan: ExportPlan): Promise<void>;
  onStep?(step: ExportStep): void;
}

export type RenderResult =
  | { ok: true; blob: Blob; mime: ExportMime }
  | { ok: false; reason: "image"; names: string[] }
  | { ok: false; reason: "canvas" | "blocked" | "too-big" };

function encode(canvas: CanvasLike, type: ExportMime, quality?: number): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Loads every picture, draws, and encodes PNG. A PNG over the upload limit falls back to WebP, then
 * JPEG, so a large photo can still be stored. Nothing is returned when any picture failed to load:
 * a file with a hole in it is worse than no file.
 */
export async function renderPlan(plan: ExportPlan, deps: RenderDeps, maxBytes: number = STUDIO_LIMITS.imageBytesMax): Promise<RenderResult> {
  deps.onStep?.("fonts");
  if (deps.waitForFonts) await deps.waitForFonts(plan).catch(() => undefined);

  deps.onStep?.("images");
  const sources = imageSources(plan);
  const urls = [...sources.keys()];
  const settled = await Promise.allSettled(urls.map((url) => deps.loadImage(url)));
  const images = new Map<string, CanvasImageSource>();
  const failed: string[] = [];
  settled.forEach((result, i) => {
    const url = urls[i]!;
    if (result.status === "fulfilled") images.set(url, result.value);
    else failed.push(...(sources.get(url) ?? []));
  });
  if (failed.length) return { ok: false, reason: "image", names: [...new Set(failed)] };

  deps.onStep?.("drawing");
  const canvas = deps.createCanvas(plan.width, plan.height);
  const ctx = canvas?.getContext("2d") ?? null;
  if (!canvas || !ctx) return { ok: false, reason: "canvas" };
  drawPlan(ctx, plan, images, deps.family, (w, h) => deps.createCanvas(w, h));

  deps.onStep?.("saving");
  const attempts: Array<[ExportMime, number | undefined]> = [
    ["image/png", undefined],
    ["image/webp", 0.95],
    ["image/jpeg", 0.92],
  ];
  try {
    for (const [mime, quality] of attempts) {
      const blob = await encode(canvas, mime, quality);
      if (!blob) return { ok: false, reason: "canvas" };
      // Some engines answer a WebP request with PNG; only accept what was asked for.
      if (blob.type && blob.type !== mime) continue;
      if (blob.size <= maxBytes) return { ok: true, blob, mime };
    }
  } catch (error) {
    // A picture from another site without permission taints the canvas; the browser then refuses to encode.
    if (error instanceof Error && error.name === "SecurityError") return { ok: false, reason: "blocked" };
    return { ok: false, reason: "canvas" };
  }
  return { ok: false, reason: "too-big" };
}

/* ---------------------------------------------------------------- naming */

const EXTENSION: Record<ExportMime, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

/** "<name>-<suffix>.png": the base's name without its extension or unsafe characters. */
export function exportFileName(name: string | null, suffix: string, mime: ExportMime = "image/png"): string {
  const stem = (name ?? "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/^[-.\s]+|[-.\s]+$/g, "");
  return `${stem || "twings"}-${suffix}.${EXTENSION[mime]}`;
}
