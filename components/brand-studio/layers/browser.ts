/**
 * The browser side of the editor's pure modules: real font families, text measuring, picture loading
 * and the canvas. Nothing here runs on the server; every function touches `document` lazily.
 */
import { FONTS, fontChoice, type FontId, type TextLayer } from "./model";
import type { CanvasLike, ExportPlan, RenderDeps } from "./export";
import { fontShorthand, type Measure } from "./text-layout";

const families = new Map<FontId, string>();

/**
 * The font list with `var(--font-…)` replaced by the real (hashed) family names next/font generated,
 * read back from the computed style of a probe element. The canvas cannot read CSS variables.
 */
export function resolveFamily(font: FontId): string {
  const cached = families.get(font);
  if (cached) return cached;
  const stack = fontChoice(font).stack;
  if (typeof document === "undefined" || !stack.includes("var(")) return stack;
  const probe = document.createElement("span");
  probe.style.fontFamily = stack;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).fontFamily || stack;
  probe.remove();
  families.set(font, resolved);
  return resolved;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width of a string at a layer's font, no letter spacing (text-layout.ts adds it). */
export function measurerFor(layer: Pick<TextLayer, "font" | "weight" | "size">): Measure {
  if (typeof document === "undefined") return (text) => text.length * layer.size * 0.55;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  if (!ctx) return (text) => text.length * layer.size * 0.55;
  const font = fontShorthand(layer, resolveFamily(layer.font));
  return (text) => {
    if (ctx.font !== font) ctx.font = font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    return ctx.measureText(text).width;
  };
}

/** Asks the browser for every face and character the plan draws, then waits for all loads. */
export async function waitForFonts(plan: ExportPlan): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const loads: Promise<unknown>[] = [];
  for (const op of plan.ops) {
    if (op.kind !== "text") continue;
    const text = op.layout.lines.map((l) => l.text).join("") || "A";
    loads.push(document.fonts.load(fontShorthand(op, resolveFamily(op.font)), text).catch(() => undefined));
  }
  await Promise.all(loads);
  await document.fonts.ready;
}

/** Loads the faces (and the characters) the text layers use, before they are laid out for export. */
export async function waitForLayerFonts(layers: readonly TextLayer[]): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(layers.map((layer) => document.fonts.load(fontShorthand(layer, resolveFamily(layer.font)), layer.text || "A").catch(() => undefined)));
  await document.fonts.ready;
}

/** Fonts the editor offers, preloaded so the first layout already uses them. */
export function warmFonts(): void {
  if (typeof document === "undefined" || !document.fonts) return;
  for (const font of FONTS) for (const weight of font.weights) void document.fonts.load(`${weight} 16px ${resolveFamily(font.id)}`, "Aa가").catch(() => undefined);
}

export function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** A studio picture's key path: `/st/<64 hex>.<png|jpg|webp>` (lib/brand-studio/media-store.ts). */
const STUDIO_IMAGE_PATH = /^\/st\/[0-9a-f]{64}\.(png|jpg|webp)$/;

/**
 * The same-origin address of a studio picture. In production studio media live on the media host,
 * which sends no CORS headers, so a canvas that drew them could not be exported. The studio's own
 * gateway (`/api/brand-studio/media/st/…`) serves the same bytes from this origin.
 */
export function drawableUrl(url: string): string {
  if (isSameOrigin(url)) return url;
  try {
    const { pathname } = new URL(url);
    return STUDIO_IMAGE_PATH.test(pathname) ? `/api/brand-studio/media${pathname}` : url;
  } catch {
    return url;
  }
}

/**
 * Loads a picture for drawing. Studio media are fetched through the same-origin gateway; anything else
 * from another origin is requested with CORS (and a separate cache entry) so it never taints the canvas.
 */
export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = drawableUrl(source);
    let src = url;
    if (!isSameOrigin(url)) {
      img.crossOrigin = "anonymous";
      src = `${url}${url.includes("?") ? "&" : "?"}canvas=1`;
    }
    img.decoding = "async";
    img.onload = () => {
      if (typeof img.decode === "function") img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => reject(new Error(`load failed: ${url}`));
    img.src = src;
  });
}

/** The natural size of a picture (for layers added from items without a stored size). Display only: no CORS needed. */
export function naturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function createCanvas(width: number, height: number): CanvasLike | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    return canvas;
  } catch {
    return null;
  }
}

export const browserRenderDeps = (onStep: RenderDeps["onStep"]): RenderDeps => ({
  loadImage,
  family: resolveFamily,
  createCanvas,
  waitForFonts,
  onStep,
});
