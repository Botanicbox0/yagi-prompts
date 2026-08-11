/**
 * PLAN §3.3 — what `/api/media/[blockId]` accepts.
 *
 * The gateway is named after block ids because blocks are what it mostly serves, but a revision's
 * hero is an asset with the same lifecycle and the same authorization chain, and it has no block to
 * hang off. Rather than a second route with a second copy of the chain, the segment carries a
 * REF: either a bare block id, or `{revisionId}:hero`.
 *
 * Pure and dependency-free so the shaper (which must stay pure), the renderers and the route
 * handler all speak the same grammar.
 */

export const HERO_SUFFIX = ':hero';

export type MediaRef =
  | { kind: 'block'; blockId: string }
  | { kind: 'hero'; revisionId: string };

export function heroRef(revisionId: string): string {
  return `${revisionId}${HERO_SUFFIX}`;
}

/** `null` for anything that is not a well-formed ref — the caller answers 404, never a guess. */
export function parseMediaRef(raw: string): MediaRef | null {
  const ref = raw.trim();
  if (ref.length === 0) return null;
  if (ref.endsWith(HERO_SUFFIX)) {
    const revisionId = ref.slice(0, -HERO_SUFFIX.length);
    return revisionId.length > 0 ? { kind: 'hero', revisionId } : null;
  }
  if (ref.includes(':') || ref.includes('/')) return null;
  return { kind: 'block', blockId: ref };
}

/** The path the shaper emits for a gated object. Encoded: hero refs carry a colon. */
export function mediaGatewayPath(ref: string): string {
  return `/api/media/${encodeURIComponent(ref)}`;
}
