/** docs/CAST-CATEGORIES.md §3 — the four shapes a creative picks from; each fixes the customer's photo slots. */
export const EDITOR_CASTS = ['solo', 'pet', 'pet_with_me', 'couple'] as const;
export type EditorCast = (typeof EDITOR_CASTS)[number];

/** The casts a creative may pick, by the server's flags (pet and couple templates stay off until opened). */
export function editorCasts(open: { pet: boolean; couple: boolean }): EditorCast[] {
  return EDITOR_CASTS.filter((c) => c === 'solo' || (c === 'couple' ? open.couple : open.pet));
}
