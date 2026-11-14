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

/**
 * "셀카 → 장면" — the home hero's proof (docs/PLATFORM-2.0.md §15.3-2): a front-facing selfie and a
 * still of the scene that same face went into. Two URLs, both required: half a pair is not proof,
 * so with either one missing the hero renders as it always has. Which person may appear here is a
 * founder decision (§15.5-16); until then production leaves both unset.
 */
export interface EvidencePair {
  before: string;
  after: string;
  /** Optional looping video shown in the "장면 속 나" output frame. */
  afterVideo?: string;
}

/**
 * Founder-approved default Selfie → Scene static photo proof pair (2026-11-14):
 * Compact static comparison card in the hero left column so only the right-side featured film plays.
 */
export const DEFAULT_HERO_EVIDENCE: EvidencePair = {
  before: '/reel/studio-demo/reference-selfie.jpeg',
  after: '/reel/studio-demo/different-person.jpg',
};

export function heroEvidence(env: Record<string, string | undefined> = process.env): EvidencePair | null {
  const before = slotValue(env.NEXT_PUBLIC_HERO_EVIDENCE_BEFORE);
  const after = slotValue(env.NEXT_PUBLIC_HERO_EVIDENCE_AFTER);
  return before && after ? { before, after } : null;
}

export const HERO_REEL: MediaSlot = {
  src: slotValue(process.env.NEXT_PUBLIC_HERO_REEL_SRC),
  type: slotValue(process.env.NEXT_PUBLIC_HERO_REEL_TYPE) ?? 'video/mp4',
  poster: slotValue(process.env.NEXT_PUBLIC_HERO_REEL_POSTER),
};
