/**
 * The reference tray as data (docs/BRAND-STUDIO-V2.md §5.2). Order is meaning: the Nth picture is
 * "이미지 N" on the chip, in the prompt and in `references[]` sent to the server.
 */
import {
  STUDIO_LIMITS,
  type StudioAssetKind,
  type StudioAssetRole,
  type StudioAssetView,
  type StudioOutputView,
  type StudioReference,
} from "@/lib/brand-studio/contracts";
import type { MentionKind } from "@/lib/brand-studio/enhancer/mentions";
import { fill, type StudioCopy } from "./copy";

export interface TrayItem {
  /** `a:<assetId>` or `o:<outputId>`: one chip per source. */
  key: string;
  assetId?: string;
  outputId?: string;
  kind: StudioAssetKind;
  name: string;
  url: string;
  thumbUrl: string | null;
  seconds: number | null;
  /** Slides of a PPTX document, when known for certain. */
  pages?: number;
  /** Measured size, when known (a reference video's limits use it). */
  width?: number | null;
  height?: number | null;
  role?: StudioAssetRole;
  use?: string;
  avoid?: string;
  frame?: "start" | "end";
}

export type RefSource = { assetId: string } | { outputId: string };

export function trayItemFromAsset(asset: StudioAssetView): TrayItem {
  return {
    key: `a:${asset.id}`,
    assetId: asset.id,
    kind: asset.kind,
    name: asset.name,
    url: asset.url,
    thumbUrl: asset.thumbUrl,
    seconds: asset.seconds,
    width: asset.width,
    height: asset.height,
    ...(asset.pages ? { pages: asset.pages } : {}),
    ...(asset.role ? { role: asset.role } : {}),
  };
}

export function trayItemFromOutput(output: StudioOutputView, name: string): TrayItem {
  return {
    key: `o:${output.id}`,
    outputId: output.id,
    kind: output.kind,
    name,
    url: output.url,
    thumbUrl: output.thumbUrl,
    seconds: output.seconds,
    width: output.width,
    height: output.height,
  };
}

/** Per-kind numbering in tray order: ["이미지 1", "영상 1", "이미지 2"]. */
export function trayLabels(items: readonly Pick<TrayItem, "kind">[], copy: StudioCopy): string[] {
  const seen: Record<StudioAssetKind, number> = { image: 0, video: 0, audio: 0, document: 0 };
  return items.map((item) => fill(copy.tray[item.kind], { n: ++seen[item.kind] }));
}

/** The number under each thumbnail: per kind, in tray order (an image run reads 1, 2, 3 …). */
export function trayNumbers(items: readonly Pick<TrayItem, "kind">[]): number[] {
  const seen: Record<StudioAssetKind, number> = { image: 0, video: 0, audio: 0, document: 0 };
  return items.map((item) => ++seen[item.kind]);
}

/** Moves one item to another place in the tray (drag to reorder, or the arrow keys). */
export function moveInTray<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item!);
  return next;
}

/** The library's key for a tray item (`a:<id>` / `o:<id>`), so the tray can tell which source it holds. */
export function refSourceOf(item: Pick<TrayItem, "assetId" | "outputId">): RefSource {
  return item.assetId ? { assetId: item.assetId } : { outputId: item.outputId! };
}

export function mentionLabel(kind: MentionKind | "any", n: number, copy: StudioCopy): string {
  return fill(kind === "any" ? copy.tray.any : copy.tray[kind], { n });
}

/** Adds at the end (or at the front when `first`), never twice, never past the run limit. */
export function addToTray(items: readonly TrayItem[], item: TrayItem, first = false): { items: TrayItem[]; full: boolean } {
  // A document is material for a revision, never a reference: the tray never takes one.
  if (item.kind === "document") return { items: [...items], full: false };
  if (items.some((i) => i.key === item.key)) return { items: [...items], full: false };
  if (items.length >= STUDIO_LIMITS.referencesMax) return { items: [...items], full: true };
  return { items: first ? [item, ...items] : [...items, item], full: false };
}

export function updateTrayItem(items: readonly TrayItem[], key: string, patch: Partial<Omit<TrayItem, "key" | "kind">>): TrayItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

export function removeFromTray(items: readonly TrayItem[], key: string): TrayItem[] {
  return items.filter((item) => item.key !== key);
}

/** "영상으로": this picture opens the shot; no other picture keeps the opening role. */
export function withStartFrame(items: readonly TrayItem[], item: TrayItem): TrayItem[] {
  const rest = items.filter((i) => i.key !== item.key).map((i) => (i.frame === "start" ? { ...i, frame: undefined } : i));
  return [{ ...item, frame: "start" as const }, ...rest].slice(0, STUDIO_LIMITS.referencesMax);
}

/** The contract shape. Empty notes are dropped; `frame` is sent only for pictures in a video run. */
export function toReferences(items: readonly TrayItem[], medium: "image" | "video"): StudioReference[] {
  return items.map((item) => {
    const ref: StudioReference = item.assetId ? { assetId: item.assetId } : { outputId: item.outputId! };
    if (item.role) ref.role = item.role;
    const use = item.use?.trim().slice(0, STUDIO_LIMITS.noteMax);
    const avoid = item.avoid?.trim().slice(0, STUDIO_LIMITS.noteMax);
    if (use) ref.use = use;
    if (avoid) ref.avoid = avoid;
    if (medium === "video" && item.kind === "image" && item.frame) ref.frame = item.frame;
    return ref;
  });
}

/** Rebuilds a tray from a job's references; sources that no longer exist are left out. */
export function trayFromReferences(
  refs: readonly StudioReference[],
  lookup: { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null },
  outputName: string,
): TrayItem[] {
  const items: TrayItem[] = [];
  for (const ref of refs) {
    const asset = ref.assetId ? lookup.asset(ref.assetId) : null;
    const output = ref.outputId ? lookup.output(ref.outputId) : null;
    const base = asset ? trayItemFromAsset(asset) : output ? trayItemFromOutput(output, outputName) : null;
    if (!base) continue;
    items.push({
      ...base,
      ...(ref.role ? { role: ref.role } : {}),
      ...(ref.use ? { use: ref.use } : {}),
      ...(ref.avoid ? { avoid: ref.avoid } : {}),
      ...(ref.frame ? { frame: ref.frame } : {}),
    });
  }
  return items.slice(0, STUDIO_LIMITS.referencesMax);
}

/* ------------------------------------------------------------- dragging */

/** The typed payload assets and results carry when dragged into the tray. */
export const REF_DRAG_TYPE = "application/x-twings-studio-ref";
/** A tray thumbnail being moved inside its own row (never accepted as a new reference). */
export const TRAY_MOVE_TYPE = "application/x-twings-tray-move";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeRefDrag(source: RefSource): string {
  return JSON.stringify(source);
}

export function decodeRefDrag(raw: string | null | undefined): RefSource | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.assetId === "string" && UUID.test(value.assetId) && value.outputId === undefined) return { assetId: value.assetId };
    if (typeof value.outputId === "string" && UUID.test(value.outputId) && value.assetId === undefined) return { outputId: value.outputId };
  } catch {
    return null;
  }
  return null;
}

/** Starts a copy-drag of an asset or a result. */
export function startRefDrag(event: { dataTransfer: DataTransfer | null }, source: RefSource): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(REF_DRAG_TYPE, encodeRefDrag(source));
  event.dataTransfer.effectAllowed = "copy";
}

/** True while a drag carries something the tray accepts (a studio reference or files). */
export function acceptsDrag(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!types) return false;
  const list = Array.from(types as ArrayLike<string>);
  return list.includes(REF_DRAG_TYPE) || list.includes("Files");
}
