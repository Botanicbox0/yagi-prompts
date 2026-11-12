/**
 * Brand-side product capability groups (docs/BRAND-PRODUCT.md §4).
 *
 * Founder decision (2026-11-03): every organization gets every feature by default; an exception is a
 * per-organization DENY list, stored in `brand_feature_policies` and read through
 * lib/brands/entitlements.ts. Keys name what a customer buys and sees, never an engine or a route, so
 * a new screen in a group is covered the day it ships and the admin form never has to change.
 *
 * Client-safe on purpose (no db, no env): the sidebar and the section visibility rules read it.
 */
export const BRAND_FEATURES = [
  /** Image and video generation, the self-serve studio, remix, partial edits, upscaling. */
  'generative_media',
  /** Self-serve studio (image/video creation). Closing it alone keeps Project Rooms & Asset Hub open for commissioned-only clients. */
  'self_studio',
  /** Sound finishing: music, effects, mix, mastering. */
  'sound',
  /** Colour grading: reference matching and saved brand looks. */
  'color_grading',
  /** The fixed layer: identity, hard rules, memory. */
  'brand_learning',
  /** Campaign requests, progress and reports. */
  'campaigns',
  /** The creator pool: shortlist and invitations. */
  'creator_pool',
  /** A team agent connected through a token. */
  'agent_access',
] as const;

export type BrandFeature = (typeof BRAND_FEATURES)[number];

export function isBrandFeature(value: unknown): value is BrandFeature {
  return typeof value === 'string' && (BRAND_FEATURES as readonly string[]).includes(value);
}

/** True when `denied` (an organization's policy, possibly absent) closes `feature`. */
export function featureDenied(denied: readonly string[] | null | undefined, feature: BrandFeature): boolean {
  return Array.isArray(denied) && denied.includes(feature);
}

/** Known features only, each once, in catalogue order: the shape every row and form carries. */
export function normalizeDenied(values: readonly unknown[]): BrandFeature[] {
  const chosen = new Set(values.filter(isBrandFeature));
  return BRAND_FEATURES.filter((feature) => chosen.has(feature));
}

/**
 * Hardline sandboxed client organization IDs (Morphic production & local fixture IDs).
 * Even if `brand_feature_policies` is not yet migrated or populated on a surface, these
 * organizations ALWAYS close self-serve AI studio, sound, color grading, and brand learning,
 * and operate in strict Campaign Sandbox Mode (zero showcase, zero self-serve AI exposure).
 */
export const SANDBOXED_CLIENT_ORG_IDS: ReadonlySet<string> = new Set([
  'd425c3b1-4066-4970-8a3b-93c52b3eef70',
  'deb648e9-c2df-43d4-b2a7-7f9eff8180d9',
]);

export const DEFAULT_SANDBOX_DENIED: readonly BrandFeature[] = [
  'generative_media',
  'sound',
  'color_grading',
  'brand_learning',
];

export function isSandboxedClientOrganization(
  org: { id?: string | null; name?: string | null } | null | undefined,
): boolean {
  if (!org) return false;
  if (typeof org.id === 'string' && SANDBOXED_CLIENT_ORG_IDS.has(org.id.toLowerCase())) return true;
  if (typeof org.name === 'string' && /\bmorphic\b|모픽/i.test(org.name)) return true;
  return false;
}
