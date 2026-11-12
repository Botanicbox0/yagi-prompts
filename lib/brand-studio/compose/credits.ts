/**
 * TWINGS credit calculation for Brand Studio Video Composer 1080p final render
 * (`docs/BRAND-VIDEO-COMPOSE-D.md`, Founder Decision 3).
 *
 * Timeline/caption chat instructions are free (`0` credits) with a per-minute server rate limit;
 * credits are deducted only when running a high-resolution 1080p final MP4 render (and refunded 100%
 * automatically if encoding fails).
 *
 * Client-safe: pure math + `creditsOf` (`1 credit = 10 KRW` internal unit; UI displays credits only).
 */
import { creditsOf } from '@/lib/brand-studio/credits';

export const COMPOSE_FINAL_RENDER_MODEL = 'compose-1080p' as const;

/** Internal KRW allowance unit reserved for one 1080p final MP4 render (`10` base + `2` credits/sec). */
export function composeFinalRenderKrw(durationSec: number): number {
  const wholeSeconds = Math.max(1, Math.min(300, Math.ceil(Number.isFinite(durationSec) ? durationSec : 1)));
  return 100 + wholeSeconds * 20;
}

/** Customer-facing TWINGS credits required for one 1080p final MP4 render. */
export function composeFinalRenderCredits(durationSec: number): number {
  return creditsOf(composeFinalRenderKrw(durationSec));
}
