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
import { renumberReferenceMentions, type MentionKind } from "@/lib/brand-studio/enhancer/mentions";
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
  /** Length in tenths, as shown. */
  seconds: number | null;
  /** Exact stored length in milliseconds, when known: a run that follows this clip is priced from it. */
  durationMs?: number;
  /** Measured size, when known (a reference video's limits use it). */
  width?: number | null;
  height?: number | null;
  role?: StudioAssetRole;
  /**
   * Attached while the library was still recognising this upload's role: the role is filled in once it
   * arrives (`withRecognisedRoles`), unless a role is picked here first. Never sent to the server.
   */
  roleCheck?: true;
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
    ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    width: asset.width,
    height: asset.height,
    ...(asset.role ? { role: asset.role } : {}),
    ...(!asset.role && !asset.roleSource && asset.kind === "image" && asset.source === "upload" ? { roleCheck: true as const } : {}),
  };
}

/**
 * Pictures attached before their recognised role arrived get it now; one already given a role in the tray
 * keeps it. The same array comes back when nothing changed.
 */
export function withRecognisedRoles(items: TrayItem[], assets: readonly StudioAssetView[]): TrayItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (!item.roleCheck || !item.assetId) return item;
    const asset = assets.find((a) => a.id === item.assetId);
    if (!asset?.roleSource) return item;
    changed = true;
    const { roleCheck: _answered, ...rest } = item;
    return asset.role && !rest.role ? { ...rest, role: asset.role } : rest;
  });
  return changed ? next : items;
}

/** Shared thumbnail image URL used by both the tray and the video confirm card (no second fetch). */
export function trayThumbSrc(item: Pick<TrayItem, "thumbUrl" | "url">): string {
  return item.thumbUrl ?? item.url;
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
    ...(output.durationMs !== undefined ? { durationMs: output.durationMs } : {}),
    width: output.width,
    height: output.height,
  };
}

/** Per-kind numbering in tray order: ["이미지 1", "영상 1", "이미지 2"]. */
export function trayLabels(items: readonly Pick<TrayItem, "kind">[], copy: StudioCopy): string[] {
  const seen: Record<StudioAssetKind, number> = { image: 0, video: 0, audio: 0 };
  return items.map((item) => fill(copy.tray[item.kind], { n: ++seen[item.kind] }));
}

/** The number under each thumbnail: per kind, in tray order (an image run reads 1, 2, 3 …). */
export function trayNumbers(items: readonly Pick<TrayItem, "kind">[]): number[] {
  const seen: Record<StudioAssetKind, number> = { image: 0, video: 0, audio: 0 };
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

/**
 * The typed words after a reference moved in the tray: every mention keeps naming the picture it named
 * (`@image1` for a picture now third reads `@image3`). Kind words count among their own kind, a bare "@N"
 * counts every chip; a mention of nothing stays as typed.
 */
export function renumberAfterMove(
  text: string,
  before: readonly Pick<TrayItem, "key" | "kind">[],
  after: readonly Pick<TrayItem, "key" | "kind">[],
): string {
  if (!text) return text;
  const was = trayNumbers(before);
  const now = trayNumbers(after);
  const at = new Map(after.map((item, i) => [item.key, i]));
  return renumberReferenceMentions(text, (kind, n) => {
    const from = kind === "any" ? n - 1 : before.findIndex((item, i) => item.kind === kind && was[i] === n);
    const item = before[from];
    const to = item ? at.get(item.key) : undefined;
    if (to === undefined) return null;
    return kind === "any" ? to + 1 : now[to]!;
  });
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
  if (items.some((i) => i.key === item.key)) return { items: [...items], full: false };
  if (items.length >= STUDIO_LIMITS.referencesMax) return { items: [...items], full: true };
  return { items: first ? [item, ...items] : [...items, item], full: false };
}

export function updateTrayItem(items: readonly TrayItem[], key: string, patch: Partial<Omit<TrayItem, "key" | "kind">>): TrayItem[] {
  return items.map((item) => {
    // One picture opens the shot and one closes it: choosing 시작 장면 (or 마지막 장면) here takes it off the others.
    if (item.key !== key) return patch.frame && item.frame === patch.frame ? { ...item, frame: undefined } : item;
    // A role picked (or cleared) here is the customer's: a recognised one arriving later does not replace it.
    if (!("role" in patch)) return { ...item, ...patch };
    const { roleCheck: _picked, ...rest } = item;
    return { ...rest, ...patch };
  });
}

export function removeFromTray(items: readonly TrayItem[], key: string): TrayItem[] {
  return items.filter((item) => item.key !== key);
}

/** The tray key of a source (`a:<assetId>` / `o:<outputId>`), as `trayItemFromAsset` / `trayItemFromOutput` set it. */
export function refKeyOf(source: RefSource): string {
  return "assetId" in source ? `a:${source.assetId}` : `o:${source.outputId}`;
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
