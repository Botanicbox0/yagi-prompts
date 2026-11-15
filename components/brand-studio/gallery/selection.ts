/**
 * Selecting several tiles of the wall, as pure data (docs/BRAND-STUDIO-V6-PLAN.md §7 row B).
 *
 * A key names exactly what the customer sees: `o:<outputId>` is one result, `f:<jobId>` one run that ended
 * with no result. A clip with several versions shows a single tile (./../revision-model.ts): its key is the
 * version on screen, so selecting or deleting it never reaches the versions behind it. Deleting the shown
 * version brings the one before it back to the wall.
 */
import type { StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";

export interface Selection {
  keys: ReadonlySet<string>;
  /** Where a Shift+click range starts: the tile pressed last. */
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { keys: new Set(), anchor: null };

export const resultKey = (outputId: string) => `o:${outputId}`;
export const failedKey = (jobId: string) => `f:${jobId}`;

/** One press on a tile's checkbox: in or out, and the next range starts here. */
export function toggleSelection(selection: Selection, key: string): Selection {
  const keys = new Set(selection.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key };
}

/**
 * Shift+click: everything from the last pressed tile to this one, in the order on screen, joins the
 * selection. Without a starting tile still on the wall it is a plain press.
 */
export function selectRange(selection: Selection, order: readonly string[], key: string): Selection {
  const from = selection.anchor === null ? -1 : order.indexOf(selection.anchor);
  const to = order.indexOf(key);
  if (from < 0 || to < 0) return toggleSelection(selection, key);
  const keys = new Set(selection.keys);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) keys.add(order[i]!);
  return { keys, anchor: selection.anchor };
}

/** Drops what is no longer on the wall (deleted, or replaced by a newer version). */
export function pruneSelection(selection: Selection, order: readonly string[]): Selection {
  if (selection.keys.size === 0) return selection;
  const on = new Set(order);
  const keys = new Set([...selection.keys].filter((key) => on.has(key)));
  const anchor = selection.anchor !== null && on.has(selection.anchor) ? selection.anchor : null;
  return keys.size === selection.keys.size && anchor === selection.anchor ? selection : { keys, anchor };
}

export interface SelectedTargets {
  /** Selected results, in the order on screen. */
  items: Array<{ output: StudioOutputView; job: StudioJobView }>;
  /** Selected runs that ended with no result, in the order on screen. */
  failed: StudioJobView[];
}

/** A tile of the wall as the selection sees it. */
export type SelectableTile =
  | { key: string; type: "result"; item: { output: StudioOutputView; job: StudioJobView } }
  | { key: string; type: "failed"; job: StudioJobView };

export function selectedTargets(tiles: readonly SelectableTile[], selection: Selection): SelectedTargets {
  const targets: SelectedTargets = { items: [], failed: [] };
  for (const tile of tiles) {
    if (!selection.keys.has(tile.key)) continue;
    if (tile.type === "result") targets.items.push(tile.item);
    else targets.failed.push(tile.job);
  }
  return targets;
}

/** Which actions the bar offers for what is selected (in order): what the member may do, and what applies. */
export type BulkAction = "reference" | "folder" | "download" | "delete";

export function bulkActions(targets: SelectedTargets, may: { canGenerate: boolean; canEdit: boolean; canRemove: boolean }): BulkAction[] {
  const actions: BulkAction[] = [];
  const results = targets.items.length > 0;
  if (results && may.canGenerate) actions.push("reference");
  if (results && may.canEdit) actions.push("folder");
  if (results) actions.push("download");
  if ((results && may.canEdit) || (targets.failed.length > 0 && may.canRemove)) actions.push("delete");
  return actions;
}
