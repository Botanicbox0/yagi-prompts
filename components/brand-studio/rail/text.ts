/**
 * Copy and small pure helpers for the library rail. The rail's strings live in `messages/studio-library.ts`
 * (`dict.studioLibrary`); nothing here invents text.
 */
import { STUDIO_LIMITS, type StudioAssetRole, type StudioAssetView, type StudioErrorCode, type StudioOutputView } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { LibraryItemView } from "../seams";

export type LibraryCopy = Dictionary["studioLibrary"];
export type RailTab = "folders" | "liked" | "uploads";
export const RAIL_TABS: readonly RailTab[] = ["folders", "liked", "uploads"];

/** `{name}` placeholders, left as written when a value is missing. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** "0:06", "1:12" (tabular in the UI). */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** What a write was doing when it was refused, so a limit reads as the right limit. */
export type WriteContext = "like" | "create" | "rename" | "delete" | "add" | "remove" | "asset";

export function writeError(copy: LibraryCopy, code: StudioErrorCode | null | undefined, context: WriteContext): string {
  const e = copy.errors;
  switch (code) {
    case "forbidden":
      return e.forbidden;
    case "conflict":
      return context === "create" || context === "rename" ? e.conflict : e.failed;
    case "asset_limit":
      return context === "create" ? e.folderLimit : context === "add" ? e.folderFull : e.failed;
    case "reference_missing":
      return e.missing;
    case "invalid":
      return context === "create" || context === "rename" ? e.invalid : e.failed;
    case "not_found":
      return context === "asset" ? e.missing : e.notFound;
    default:
      return e.failed;
  }
}

/** The name a thumbnail is announced by: its own, else its kind. */
export const itemName = (item: Pick<LibraryItemView, "name" | "kind">, copy: LibraryCopy): string => item.name ?? copy.item[item.kind];

export function itemOfAsset(asset: StudioAssetView): LibraryItemView {
  return {
    key: `a:${asset.id}`,
    ref: { assetId: asset.id },
    kind: asset.kind,
    url: asset.url,
    thumbUrl: asset.thumbUrl,
    name: asset.name,
    width: asset.width,
    height: asset.height,
    seconds: asset.seconds,
    createdAt: asset.createdAt,
  };
}

export function itemOfOutput(output: StudioOutputView): LibraryItemView {
  return {
    key: `o:${output.id}`,
    ref: { outputId: output.id },
    kind: output.kind,
    url: output.url,
    thumbUrl: output.thumbUrl,
    name: null,
    width: output.width,
    height: output.height,
    seconds: output.seconds,
    createdAt: output.createdAt,
  };
}

/** Search by name and tag, filter by role (the upload tab). */
export function filterUploads(assets: readonly StudioAssetView[], query: string, role: StudioAssetRole | "all"): StudioAssetView[] {
  const needle = query.trim().toLowerCase();
  return assets.filter(
    (asset) =>
      (role === "all" || asset.role === role) &&
      (!needle || asset.name.toLowerCase().includes(needle) || asset.tags.some((tag) => tag.toLowerCase().includes(needle))),
  );
}

/** "봄, 신제품 ,  " -> ["봄", "신제품"], each within the contract's length, at most `tagsMax`. */
export function tagsFrom(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，]/)) {
    const tag = part.trim().slice(0, STUDIO_LIMITS.tagMax);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, STUDIO_LIMITS.tagsMax);
}

export const RAIL_STORAGE_KEY = "twings_brand_library_rail_v1";

export interface RailPrefs {
  collapsed: boolean;
  tab: RailTab;
}

export function readRailPrefs(raw: string | null | undefined): RailPrefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RailPrefs>;
    return {
      collapsed: value.collapsed === true,
      tab: RAIL_TABS.includes(value.tab as RailTab) ? (value.tab as RailTab) : "uploads",
    };
  } catch {
    return null;
  }
}
