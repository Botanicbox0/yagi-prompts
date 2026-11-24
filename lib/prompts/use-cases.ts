/**
 * The use-case vocabulary: eight, fixed, bilingual at the UI layer.
 *
 * Small on purpose. A free-text tag field on a community submission is a moderation queue that
 * grows forever and a filter rail that never converges; eight chips cover what Seedance is used
 * for and can be extended by a migration when the tenth one earns its place.
 *
 * Its own module (2026-11-24) so the list filter, a client island, reads the order without pulling
 * the zod schemas of `./schemas` into the browser. `./schemas` re-exports both names.
 */
export const USE_CASES = [
  'cinematic',
  'short-film',
  'mv',
  'vlog',
  'brand-ad',
  'ugc',
  'tutorial',
  'game',
] as const;
export type UseCase = (typeof USE_CASES)[number];
