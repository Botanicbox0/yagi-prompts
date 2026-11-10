/**
 * Credits: the unit a customer sees (docs/BRAND-STUDIO-V3.md §2).
 *
 * The allowance, the estimates and the settled usage stay in KRW in the database; a screen never
 * shows them as money. One credit is `STUDIO_CREDIT_KRW` of usage, rounded up so a run never reads as
 * free. The unit is provisional until the founder fixes credits per plan — change it here only.
 *
 * Client-safe: no env, no db.
 */
export const STUDIO_CREDIT_KRW = 10;

/** Credits a KRW amount of usage reads as. 0 stays 0; anything above rounds up. */
export function creditsOf(krw: number): number {
  if (!Number.isFinite(krw) || krw <= 0) return 0;
  return Math.ceil(krw / STUDIO_CREDIT_KRW);
}

/** Credits left of a monthly allowance (never negative). Rounds the remainder down so it is never overstated. */
export function creditsLeft(capKrw: number, usedKrw: number): number {
  const left = Math.max(0, capKrw - Math.max(0, usedKrw));
  return Math.floor(left / STUDIO_CREDIT_KRW);
}

/** "12,340" / "12,340" — the number only; the word "크레딧" comes from the dictionary. */
export function formatCredits(credits: number, locale: 'ko' | 'en'): string {
  return new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(credits)),
  );
}
