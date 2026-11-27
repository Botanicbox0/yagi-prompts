import { studioModelOrLegacy } from './models';

/** Sentinel `brand_studio_jobs.model` for a LayerEditor save without a generated source image (`studioModelOrLegacy` -> `null`). */
export const EDITED_NO_MODEL = 'detail-edit' as const;

export interface TileModelLabelInput {
  model: string | null | undefined;
  edited?: boolean;
  /** Dictionary key `brandStudio.gallery.editedMark` (required so no literal default leaks in). */
  editedMark: string;
}

export interface TileModelParts {
  /** Known model label (e.g. `"Seedream 5.5"`), or `null` when missing / `detail-edit`. */
  name: string | null;
  /** Non-empty `editedMark` when `edited` is true, else `null`. */
  edited: string | null;
}

/**
 * Structured two-part model chip data so UI chips can truncate `name` while keeping ` · <edited>` intact,
 * or drop `name` at ultra-narrow widths to keep `edited` alone legible.
 */
export function tileModelParts({ model, edited = false, editedMark }: TileModelLabelInput): TileModelParts | null {
  const name = model ? (studioModelOrLegacy(model)?.label ?? null) : null;
  const trimmed = editedMark.trim();
  const mark = edited && trimmed ? trimmed : null;
  if (!name && !mark) return null;
  return { name, edited: mark };
}

/**
 * Display label for an image result on wall tiles, viewer meta and the assets page.
 * - known model, not edited         -> `<model label>`
 * - known model, edited             -> `<model label> · <editedMark>`
 * - unknown/missing model, edited   -> `<editedMark>`
 * - unknown/missing model, unedited -> `null`
 */
export function tileModelLabel(input: TileModelLabelInput): string | null {
  const parts = tileModelParts(input);
  if (!parts) return null;
  if (parts.name && parts.edited) return `${parts.name} · ${parts.edited}`;
  return parts.name ?? parts.edited;
}
