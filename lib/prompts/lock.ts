import type { Visibility } from '@/lib/content/visibility';

/**
 * What a reader must DO to see the prompt text — the card's chip, and the detail panel's copy.
 *
 * Founder report (2026-08-15): "90s interview는 free인데 왜 cookie 요구?" The card carried a
 * boolean (`hasLock`) and the chip was hardcoded to COOKIE, so a `free` prompt advertised a price
 * it does not charge — a reader would decide not to click, on a lie.
 *
 * The mapping is deliberately about the ACTION rather than the tier:
 *   public  → null       nothing to say
 *   free    → 'signin'   sign in; no cookie is spent, and `unlockPrompt` refuses to spend one
 *   pro     → 'cookie'   one cookie, permanently, on this account
 *   hidden  → 'cookie'   admin-only, and never listed publicly — the safest chip if it ever were
 *
 * One function, used by the card projection and the detail panel, so the two can never disagree
 * about what pressing the button costs.
 */
export type PromptLock = 'signin' | 'cookie' | null;

export function promptLock(visibility: Visibility): PromptLock {
  if (visibility === 'public') return null;
  return visibility === 'free' ? 'signin' : 'cookie';
}
