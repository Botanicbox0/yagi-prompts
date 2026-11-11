/**
 * The layer document of the "꾸미기" editor (docs/BRAND-STUDIO-V3.md §5). Pure data and pure edits:
 * no DOM, no React. Every edit returns a new document and leaves the old one alone, so the history
 * can keep references.
 *
 * Units: every position and size is in pixels of the base picture at its stored size
 * (`base.width` × `base.height`). x, y is the top-left corner of the unrotated box; rotation (degrees,
 * clockwise) turns the box around its centre. `layers[0]` is drawn first (bottom).
 */
import { COLOUR } from "@/lib/design/identity";
import type { RefSource } from "../refs";

export const LAYER_DOC_VERSION = 1 as const;
/** More layers than this is not decoration any more; it also keeps a stored draft small. */
export const MAX_LAYERS = 80;
export const TEXT_MAX = 2000;
export const NAME_MAX = 60;
export const MIN_SIDE = 4;

export type LayerKind = "image" | "text" | "shape";
export type LayerTool = "move" | "marquee" | "eraser" | "restore";
export type TextAlign = "left" | "center" | "right";
export type ShapeKind = "rect" | "ellipse";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame extends Box {
  rotation: number;
}

interface LayerBase extends Frame {
  id: string;
  name: string;
  /** 0..1 */
  opacity: number;
  locked: boolean;
  hidden: boolean;
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  /** Where the picture comes from. Only a reference and an address are kept, never the bytes. */
  src: { ref: RefSource | null; url: string };
  /** Non-destructive alpha mask PNG Data URL (or same-origin mask URL) in layer local pixels. */
  maskDataUrl?: string | null;
}

export interface TextPlate {
  color: string;
  /** Padding around the text, in em of the font size. */
  padding: number;
  /** Corner radius, in em of the font size. */
  radius: number;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  font: FontId;
  /** Font size in base pixels. */
  size: number;
  weight: number;
  color: string;
  align: TextAlign;
  /** In em (0.05 = 5% of the font size). */
  letterSpacing: number;
  /** Multiple of the font size. */
  lineHeight: number;
  plate: TextPlate | null;
}

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  /** Corner radius in base pixels (rectangles only). */
  radius: number;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer;

export interface LayerDoc {
  v: typeof LAYER_DOC_VERSION;
  width: number;
  height: number;
  layers: Layer[];
  /** Hides the base image on stage (showing checkerboard) so patch edges can be inspected and erased. */
  baseHidden?: boolean;
}

/* ------------------------------------------------------------------ fonts */

export type FontId = "pretendard" | "helvetica" | "display" | "mono";

export interface FontChoice {
  id: FontId;
  /** A proper name, shown as is in both languages. */
  label: string;
  /** The CSS stack. Every face here is already loaded by the brand layout (app/(brand)/layout.tsx). */
  stack: string;
  weights: readonly number[];
}

export const FONTS: readonly FontChoice[] = [
  {
    id: "pretendard",
    label: "Pretendard",
    stack: "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  {
    id: "helvetica",
    label: "Helvetica Neue",
    stack: "'TWINGS Helvetica Neue', 'Pretendard Variable', 'Apple SD Gothic Neo', sans-serif",
    weights: [400, 500, 700],
  },
  {
    id: "display",
    label: "Big Shoulders",
    stack: "var(--font-big-shoulders), 'Pretendard Variable', 'Arial Narrow', sans-serif",
    weights: [700, 900],
  },
  {
    id: "mono",
    label: "Geist Mono",
    stack: "var(--font-geist-mono), 'Pretendard Variable', ui-monospace, monospace",
    weights: [400],
  },
];

export const fontChoice = (id: FontId): FontChoice => FONTS.find((f) => f.id === id) ?? FONTS[0]!;

/** The allowed weight nearest to `weight` for this font. */
export function nearestWeight(font: FontId, weight: number): number {
  const weights = fontChoice(font).weights;
  let best = weights[0]!;
  for (const w of weights) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  return best;
}

/* ----------------------------------------------------------------- colours */

/** Document colours (what a layer is painted with), not UI tokens. The blue is the identity accent. */
export const SWATCHES = {
  black: "#000000",
  white: "#FFFFFF",
  blue: COLOUR.accent.toUpperCase(),
} as const;

/* --------------------------------------------------------------- creation */

let counter = 0;
/** Unique within a document; time + counter so a duplicated draft never collides with a new layer. */
export function newLayerId(): string {
  counter = (counter + 1) % 1_000_000;
  return `l${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyDoc(width: number, height: number): LayerDoc {
  return { v: LAYER_DOC_VERSION, width, height, layers: [] };
}

const round = (value: number) => Math.round(value * 100) / 100;

function centred(doc: LayerDoc, w: number, h: number, at?: { x: number; y: number }): Box {
  const cx = at?.x ?? doc.width / 2;
  const cy = at?.y ?? doc.height / 2;
  return { x: round(cx - w / 2), y: round(cy - h / 2), w: round(w), h: round(h) };
}

export function createTextLayer(doc: LayerDoc, opts: { text: string; name: string; id?: string; at?: { x: number; y: number } }): TextLayer {
  const short = Math.min(doc.width, doc.height);
  const size = Math.max(12, Math.round(short * 0.07));
  const w = Math.round(doc.width * 0.7);
  return {
    id: opts.id ?? newLayerId(),
    kind: "text",
    name: opts.name.slice(0, NAME_MAX),
    ...centred(doc, w, size * 1.2, opts.at),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: opts.text.slice(0, TEXT_MAX),
    font: "pretendard",
    size,
    weight: 700,
    color: SWATCHES.black,
    align: "center",
    letterSpacing: -0.02,
    lineHeight: 1.2,
    plate: null,
  };
}

export function createShapeLayer(doc: LayerDoc, opts: { shape: ShapeKind; name: string; id?: string; at?: { x: number; y: number } }): ShapeLayer {
  const short = Math.min(doc.width, doc.height);
  const side = Math.round(short * 0.3);
  return {
    id: opts.id ?? newLayerId(),
    kind: "shape",
    name: opts.name.slice(0, NAME_MAX),
    ...centred(doc, side, side, opts.at),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    shape: opts.shape,
    fill: SWATCHES.blue,
    stroke: null,
    strokeWidth: Math.max(1, Math.round(short * 0.004)),
    radius: 0,
  };
}

/** Placed in the middle (or at `at`), a third of the short side across, at the picture's own ratio. */
export function createImageLayer(
  doc: LayerDoc,
  opts: { url: string; ref: RefSource | null; name: string; natural: { width: number; height: number } | null; id?: string; at?: { x: number; y: number } },
): ImageLayer {
  const nw = opts.natural?.width && opts.natural.width > 0 ? opts.natural.width : 1;
  const nh = opts.natural?.height && opts.natural.height > 0 ? opts.natural.height : 1;
  const longest = Math.min(doc.width, doc.height) * 0.4;
  const scale = Math.min(longest / Math.max(nw, nh), 1, (doc.width * 0.9) / nw, (doc.height * 0.9) / nh);
  const w = Math.max(MIN_SIDE, nw * scale);
  const h = Math.max(MIN_SIDE, nh * scale);
  return {
    id: opts.id ?? newLayerId(),
    kind: "image",
    name: opts.name.slice(0, NAME_MAX),
    ...centred(doc, w, h, opts.at),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: { ref: opts.ref, url: opts.url },
  };
}

/** Places a region-edit patch at exact pixel coordinates (`box`) on the base document, optionally pre-masked. */
export function createPatchLayer(
  _doc: LayerDoc,
  opts: {
    url: string;
    ref?: RefSource | null;
    box: Box;
    name: string;
    maskDataUrl?: string | null;
    id?: string;
  },
): ImageLayer {
  const layer: ImageLayer = {
    id: opts.id ?? newLayerId(),
    kind: "image",
    name: opts.name.slice(0, NAME_MAX),
    x: round(opts.box.x),
    y: round(opts.box.y),
    w: Math.max(MIN_SIDE, round(opts.box.w)),
    h: Math.max(MIN_SIDE, round(opts.box.h)),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: { ref: opts.ref ?? null, url: opts.url },
  };
  if (opts.maskDataUrl) layer.maskDataUrl = opts.maskDataUrl;
  return layer;
}

/* ------------------------------------------------------------------ edits */

export function findLayer(doc: LayerDoc, id: string | null): Layer | null {
  if (!id) return null;
  return doc.layers.find((l) => l.id === id) ?? null;
}

export function addLayer(doc: LayerDoc, layer: Layer): LayerDoc {
  if (doc.layers.length >= MAX_LAYERS) return doc;
  return { ...doc, layers: [...doc.layers, layer] };
}

export type LayerPatch = Partial<Omit<ImageLayer, "id" | "kind">> | Partial<Omit<TextLayer, "id" | "kind">> | Partial<Omit<ShapeLayer, "id" | "kind">>;

/** Merges a patch into one layer. A patch that changes nothing returns the same document. */
export function updateLayer(doc: LayerDoc, id: string, patch: LayerPatch): LayerDoc {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (layer.id !== id) return layer;
    const next = normalizeLayer({ ...layer, ...patch } as Layer);
    if (sameLayer(layer, next)) return layer;
    changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

function sameLayer(a: Layer, b: Layer): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Keeps values inside their ranges after any edit. */
export function normalizeLayer<T extends Layer>(layer: T): T {
  const out = { ...layer };
  out.w = Math.max(MIN_SIDE, finite(out.w, MIN_SIDE));
  out.h = Math.max(MIN_SIDE, finite(out.h, MIN_SIDE));
  out.x = finite(out.x, 0);
  out.y = finite(out.y, 0);
  out.rotation = normalizeAngle(finite(out.rotation, 0));
  out.opacity = clamp(finite(out.opacity, 1), 0, 1);
  out.name = String(out.name ?? "").slice(0, NAME_MAX);
  if (out.kind === "image") {
    const img = out as ImageLayer;
    if (img.maskDataUrl === null || img.maskDataUrl === "") delete img.maskDataUrl;
  }
  if (out.kind === "text") {
    const t = out as TextLayer;
    t.size = clamp(finite(t.size, 32), 4, 2000);
    t.weight = nearestWeight(t.font, finite(t.weight, 400));
    t.letterSpacing = clamp(finite(t.letterSpacing, 0), -0.5, 2);
    t.lineHeight = clamp(finite(t.lineHeight, 1.2), 0.5, 4);
    t.text = String(t.text ?? "").slice(0, TEXT_MAX);
  }
  if (out.kind === "shape") {
    const s = out as ShapeLayer;
    s.strokeWidth = clamp(finite(s.strokeWidth, 1), 0, Math.min(s.w, s.h) / 2);
    s.radius = clamp(finite(s.radius, 0), 0, Math.min(s.w, s.h) / 2);
  }
  return out;
}

export function removeLayer(doc: LayerDoc, id: string): LayerDoc {
  const layers = doc.layers.filter((l) => l.id !== id);
  return layers.length === doc.layers.length ? doc : { ...doc, layers };
}

/** A copy right above the original, nudged so it can be seen. Never locked. */
export function duplicateLayer(doc: LayerDoc, id: string, opts: { newId?: string; suffix: string }): { doc: LayerDoc; id: string | null } {
  const index = doc.layers.findIndex((l) => l.id === id);
  const source = doc.layers[index];
  if (!source || doc.layers.length >= MAX_LAYERS) return { doc, id: null };
  const offset = Math.max(8, Math.round(Math.min(doc.width, doc.height) * 0.02));
  const copy = {
    ...structuredCloneLayer(source),
    id: opts.newId ?? newLayerId(),
    name: `${source.name} ${opts.suffix}`.slice(0, NAME_MAX),
    x: source.x + offset,
    y: source.y + offset,
    locked: false,
  } as Layer;
  const layers = [...doc.layers];
  layers.splice(index + 1, 0, copy);
  return { doc: { ...doc, layers }, id: copy.id };
}

function structuredCloneLayer(layer: Layer): Layer {
  return JSON.parse(JSON.stringify(layer)) as Layer;
}

/** +1 brings forward one step, -1 sends backward one step. */
export function moveLayer(doc: LayerDoc, id: string, step: 1 | -1): LayerDoc {
  const index = doc.layers.findIndex((l) => l.id === id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(index, 1);
  layers.splice(target, 0, layer!);
  return { ...doc, layers };
}

export function canMove(doc: LayerDoc, id: string, step: 1 | -1): boolean {
  const index = doc.layers.findIndex((l) => l.id === id);
  return index >= 0 && index + step >= 0 && index + step < doc.layers.length;
}

/** Toggles base visibility on stage while keeping clean `emptyDoc` shape when `hidden === false`. */
export function setBaseHidden(doc: LayerDoc, hidden: boolean): LayerDoc {
  if (Boolean(doc.baseHidden) === hidden) return doc;
  if (!hidden) {
    const { baseHidden: _removed, ...rest } = doc;
    return rest;
  }
  return { ...doc, baseHidden: true };
}

/** Topmost visible unlocked `ImageLayer` id, used when hiding base or switching to a mask brush with no selection. */
export function topVisibleImageLayerId(doc: LayerDoc): string | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i]!;
    if (layer.kind === "image" && !layer.hidden && !layer.locked) return layer.id;
  }
  return null;
}

export function canMergeDown(doc: LayerDoc, id: string): boolean {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0) return false;
  const upper = doc.layers[index]!;
  if (upper.locked || upper.hidden) return false;
  if (index > 0) {
    const lower = doc.layers[index - 1]!;
    return !lower.locked && !lower.hidden;
  }
  return true;
}

/**
 * Merges the selected layer (`id`) into the layer right beneath it (`index > 0`), or flattens `layers[0]`
 * with the base beneath it into a single unmasked `ImageLayer` right above base (`index === 0`).
 */
export function mergeLayerDown(
  doc: LayerDoc,
  id: string,
  merged: { url: string; box: Box; name?: string; newId?: string },
): { doc: LayerDoc; id: string | null } {
  if (!canMergeDown(doc, id)) return { doc, id: null };
  const index = doc.layers.findIndex((l) => l.id === id);
  const upper = doc.layers[index]!;
  const replacement: ImageLayer = normalizeLayer({
    id: merged.newId ?? newLayerId(),
    kind: "image",
    name: (merged.name ?? upper.name).slice(0, NAME_MAX),
    x: round(merged.box.x),
    y: round(merged.box.y),
    w: Math.max(MIN_SIDE, round(merged.box.w)),
    h: Math.max(MIN_SIDE, round(merged.box.h)),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: { ref: null, url: merged.url },
  });
  const layers = [...doc.layers];
  if (index > 0) {
    layers.splice(index - 1, 2, replacement);
  } else {
    layers.splice(0, 1, replacement);
  }
  return { doc: { ...doc, layers }, id: replacement.id };
}

export const DEFAULT_PLATE: TextPlate = { color: SWATCHES.white, padding: 0.4, radius: 0.25 };

/**
 * Turns the background plate on or off without moving the words: the box grows (or shrinks) by the
 * padding on every side.
 */
export function withPlate(layer: TextLayer, plate: TextPlate | null): Partial<TextLayer> {
  const before = layer.plate ? layer.plate.padding * layer.size : 0;
  const after = plate ? plate.padding * layer.size : 0;
  const d = after - before;
  return { plate, x: layer.x - d, y: layer.y - d, w: Math.max(MIN_SIDE, layer.w + d * 2) };
}

/** "Layer 3" style default names: the next free number for a kind label. */
export function nextName(doc: LayerDoc, label: string): string {
  let n = 1;
  const names = new Set(doc.layers.map((l) => l.name));
  while (names.has(`${label} ${n}`)) n++;
  return `${label} ${n}`;
}

/* ----------------------------------------------------------------- helpers */

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** (-180, 180] */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return Math.round(a * 100) / 100 || 0;
}
