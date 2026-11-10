/**
 * The working draft in localStorage, one per base picture (docs/BRAND-STUDIO-V3.md §5: "다시 열면 이어서").
 * Stored documents are small on purpose: layers keep a reference and an address for pictures, never
 * their bytes, and anything that fails validation is dropped on the way back in.
 */
import type { RefSource } from "../refs";
import {
  FONTS,
  LAYER_DOC_VERSION,
  MAX_LAYERS,
  NAME_MAX,
  TEXT_MAX,
  finite,
  normalizeLayer,
  type FontId,
  type Layer,
  type LayerDoc,
  type ShapeKind,
  type TextAlign,
} from "./model";
import { normalizeHex } from "./colors";

export const DRAFT_PREFIX = "twings_studio_layers_v1:";
export const RECENT_COLORS_KEY = "twings_studio_layers_colors_v1";
/** A draft over this many characters is not stored (it would only be that big if something went wrong). */
export const DRAFT_MAX_CHARS = 200_000;
/** Drafts kept on one device; the oldest go first. */
export const DRAFTS_KEPT = 24;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const draftKey = (baseKey: string) => `${DRAFT_PREFIX}${baseKey}`;

interface StoredDraft {
  v: typeof LAYER_DOC_VERSION;
  base: string;
  width: number;
  height: number;
  savedAt: number;
  layers: Layer[];
}

export function serializeDraft(doc: LayerDoc, baseKey: string, now = Date.now()): string {
  const stored: StoredDraft = { v: LAYER_DOC_VERSION, base: baseKey, width: doc.width, height: doc.height, savedAt: now, layers: doc.layers };
  return JSON.stringify(stored);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same-site paths and https addresses only: no data:, blob: or script URLs. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeRef(value: unknown): RefSource | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.assetId === "string" && UUID.test(v.assetId)) return { assetId: v.assetId };
  if (typeof v.outputId === "string" && UUID.test(v.outputId)) return { outputId: v.outputId };
  return null;
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const bool = (value: unknown) => value === true;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
const color = (value: unknown, fallback: string) => normalizeHex(typeof value === "string" ? value : "") ?? fallback;
const colorOrNull = (value: unknown) => (value === null ? null : normalizeHex(typeof value === "string" ? value : ""));

/** One stored layer back into a valid layer, or null when it cannot be trusted. */
export function sanitizeLayer(raw: unknown): Layer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : null;
  if (!id) return null;
  const base = {
    id,
    name: str(r.name, NAME_MAX),
    x: finite(r.x, 0),
    y: finite(r.y, 0),
    w: finite(r.w, 100),
    h: finite(r.h, 100),
    rotation: finite(r.rotation, 0),
    opacity: finite(r.opacity, 1),
    locked: bool(r.locked),
    hidden: bool(r.hidden),
  };
  if (r.kind === "image") {
    const src = (r.src ?? {}) as Record<string, unknown>;
    const url = safeUrl(src.url);
    if (!url) return null;
    return normalizeLayer({ ...base, kind: "image", src: { ref: safeRef(src.ref), url } });
  }
  if (r.kind === "text") {
    const plateRaw = r.plate as Record<string, unknown> | null | undefined;
    const plate =
      plateRaw && typeof plateRaw === "object"
        ? { color: color(plateRaw.color, "#FFFFFF"), padding: Math.min(2, Math.max(0, finite(plateRaw.padding, 0.4))), radius: Math.min(2, Math.max(0, finite(plateRaw.radius, 0.2))) }
        : null;
    return normalizeLayer({
      ...base,
      kind: "text",
      text: str(r.text, TEXT_MAX),
      font: oneOf<FontId>(r.font, FONTS.map((f) => f.id), "pretendard"),
      size: finite(r.size, 48),
      weight: finite(r.weight, 700),
      color: color(r.color, "#000000"),
      align: oneOf<TextAlign>(r.align, ["left", "center", "right"], "center"),
      letterSpacing: finite(r.letterSpacing, 0),
      lineHeight: finite(r.lineHeight, 1.2),
      plate,
    });
  }
  if (r.kind === "shape") {
    return normalizeLayer({
      ...base,
      kind: "shape",
      shape: oneOf<ShapeKind>(r.shape, ["rect", "ellipse"], "rect"),
      fill: colorOrNull(r.fill),
      stroke: colorOrNull(r.stroke),
      strokeWidth: finite(r.strokeWidth, 0),
      radius: finite(r.radius, 0),
    });
  }
  return null;
}

/** A stored draft back into a document for this base, or null (wrong version, other picture, broken). */
export function parseDraft(raw: string | null, expected: { baseKey: string; width: number; height: number }): LayerDoc | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.v !== LAYER_DOC_VERSION || v.base !== expected.baseKey || !Array.isArray(v.layers)) return null;
  const width = finite(v.width, 0);
  const height = finite(v.height, 0);
  if (width <= 0 || height <= 0) return null;
  const seen = new Set<string>();
  let layers: Layer[] = [];
  for (const item of v.layers.slice(0, MAX_LAYERS)) {
    const layer = sanitizeLayer(item);
    if (layer && !seen.has(layer.id)) {
      seen.add(layer.id);
      layers.push(layer);
    }
  }
  // The same picture stored at another size: scale the layers with it.
  if (Math.abs(width - expected.width) > 0.5 || Math.abs(height - expected.height) > 0.5) {
    const sx = expected.width / width;
    const sy = expected.height / height;
    layers = layers.map((layer) => scaleLayer(layer, sx, sy));
  }
  return { v: LAYER_DOC_VERSION, width: expected.width, height: expected.height, layers };
}

function scaleLayer(layer: Layer, sx: number, sy: number): Layer {
  const s = Math.min(sx, sy);
  const scaled = { ...layer, x: layer.x * sx, y: layer.y * sy, w: layer.w * sx, h: layer.h * sy } as Layer;
  if (scaled.kind === "text") scaled.size = scaled.size * s;
  if (scaled.kind === "shape") {
    scaled.strokeWidth = scaled.strokeWidth * s;
    scaled.radius = scaled.radius * s;
  }
  return normalizeLayer(scaled);
}

/* ------------------------------------------------------------- storage */

/** Stores the draft (an empty one is removed). False when storage refused it or it is too big. */
export function saveDraft(storage: StorageLike | null, baseKey: string, doc: LayerDoc, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    if (doc.layers.length === 0) {
      storage.removeItem(draftKey(baseKey));
      return true;
    }
    const raw = serializeDraft(doc, baseKey, now);
    if (raw.length > DRAFT_MAX_CHARS) return false;
    storage.setItem(draftKey(baseKey), raw);
    pruneDrafts(storage, DRAFTS_KEPT);
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage: StorageLike | null, expected: { baseKey: string; width: number; height: number }): LayerDoc | null {
  if (!storage) return null;
  try {
    return parseDraft(storage.getItem(draftKey(expected.baseKey)), expected);
  } catch {
    return null;
  }
}

export function clearDraft(storage: StorageLike | null, baseKey: string): void {
  try {
    storage?.removeItem(draftKey(baseKey));
  } catch {
    /* storage refused; nothing to clear */
  }
}

/** Keeps the `keep` most recently saved drafts and removes the rest. */
export function pruneDrafts(storage: StorageLike, keep: number): void {
  const drafts: Array<{ key: string; at: number }> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    let at = 0;
    try {
      at = finite((JSON.parse(storage.getItem(key) ?? "{}") as { savedAt?: unknown }).savedAt, 0);
    } catch {
      at = 0;
    }
    drafts.push({ key, at });
  }
  if (drafts.length <= keep) return;
  drafts.sort((a, b) => b.at - a.at);
  for (const old of drafts.slice(keep)) storage.removeItem(old.key);
}

/* -------------------------------------------------------- recent colours */

export const RECENT_COLORS_MAX = 8;

export function loadRecentColors(storage: StorageLike | null): string[] {
  try {
    const value = JSON.parse(storage?.getItem(RECENT_COLORS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.map((c) => normalizeHex(typeof c === "string" ? c : "")).filter((c): c is string => Boolean(c)).slice(0, RECENT_COLORS_MAX);
  } catch {
    return [];
  }
}

export function saveRecentColors(storage: StorageLike | null, colors: readonly string[]): void {
  try {
    storage?.setItem(RECENT_COLORS_KEY, JSON.stringify(colors.slice(0, RECENT_COLORS_MAX)));
  } catch {
    /* a full or blocked storage only loses the list */
  }
}

/** The browser's localStorage, or null where it is blocked. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
