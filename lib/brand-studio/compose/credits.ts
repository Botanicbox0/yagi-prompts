/**
 * Ledger constants for the editing studio's browser MP4 export (`docs/BRAND-VIDEO-COMPOSE-D.md`,
 * docs/BRAND-EDITING-STUDIO.md §8-3).
 *
 * Export is free: the browser encodes the 1080p MP4, so `render.reserve` records a 0-KRW row and charges
 * nothing. Timeline/caption chat is free too (per-minute server rate limit). Credits are taken only by
 * generation (upscale, sound effects, and music while `BRAND_STUDIO_MUSIC_GENERATION` is on), which
 * share the ledger model below and refund themselves server-side.
 *
 * Client-safe: constants only.
 */

export const COMPOSE_FINAL_RENDER_MODEL = 'compose-1080p' as const;

/**
 * How long after `render.reserve` a failed client MP4 export that was still charged (pages loaded before
 * export became free) can be refunded through `render.refund`. Older reservations stay charged.
 */
export const COMPOSE_RENDER_REFUND_WINDOW_MS = 30 * 60 * 1000;
