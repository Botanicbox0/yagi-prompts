/**
 * Content-ops media slots (PLAN §9 — "real playbook content is content-ops, not an engineering
 * gate"). Engineering wires the slot; the bytes arrive later.
 *
 * The hero reel is rendered offline with HyperFrames (§5.4: "videos are assets, not runtime
 * dependencies") and dropped in through the environment, so publishing it is a config change
 * rather than a code change. Until then `<HeroMedia>` renders the in-code poster composition.
 *
 * See `docs/CONTENT-SLOTS.md` for the swap procedure.
 */

export interface MediaSlot {
  /** Absolute or root-relative URL of the encoded reel. `null` ⇒ render the poster composition. */
  src: string | null;
  /** MIME type for the `<source>` element. */
  type: string;
  /** Poster frame shown before the video decodes. `null` ⇒ the composition stands in. */
  poster: string | null;
}

function slotValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export const HERO_REEL: MediaSlot = {
  src: slotValue(process.env.NEXT_PUBLIC_HERO_REEL_SRC),
  type: slotValue(process.env.NEXT_PUBLIC_HERO_REEL_TYPE) ?? 'video/mp4',
  poster: slotValue(process.env.NEXT_PUBLIC_HERO_REEL_POSTER),
};
