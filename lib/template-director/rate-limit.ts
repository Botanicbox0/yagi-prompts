/**
 * docs/PERSONAL-STUDIO.md §3.1 — the call limit of the template director conversation
 * (`/api/template-director`). Every turn can call the Stage-1 model, so each signed-in customer gets
 * 10 turns per rolling minute and 100 per rolling day. In memory per server instance, the same pattern
 * as the brand compose chat (`lib/brand-studio/compose/service.ts`); a refused call takes no slot.
 */

export const DIRECTOR_TURNS_PER_MINUTE = 10;
export const DIRECTOR_TURNS_PER_DAY = 100;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Above this many tracked users, stale entries are swept on the next call. */
const SWEEP_ABOVE = 10_000;

const turnBuckets = new Map<string, number[]>();

export function resetDirectorTurnLimitsForTest(): void {
  turnBuckets.clear();
}

function sweep(nowMs: number): void {
  const cutoff = nowMs - DAY_MS;
  for (const [key, stamps] of turnBuckets) {
    if (!stamps.some((ts) => ts > cutoff)) turnBuckets.delete(key);
  }
}

export function takeDirectorTurnSlot(
  userId: string,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (turnBuckets.size > SWEEP_ABOVE) sweep(nowMs);

  const dayCutoff = nowMs - DAY_MS;
  const minuteCutoff = nowMs - MINUTE_MS;
  const day = (turnBuckets.get(userId) ?? []).filter((ts) => ts > dayCutoff);
  const minute = day.filter((ts) => ts > minuteCutoff);

  const minuteFull = minute.length >= DIRECTOR_TURNS_PER_MINUTE;
  const dayFull = day.length >= DIRECTOR_TURNS_PER_DAY;
  if (minuteFull || dayFull) {
    // The wait is until the slot that frees first under every full window.
    let waitMs = 0;
    if (minuteFull) waitMs = Math.max(waitMs, minute[minute.length - DIRECTOR_TURNS_PER_MINUTE]! + MINUTE_MS - nowMs);
    if (dayFull) waitMs = Math.max(waitMs, day[day.length - DIRECTOR_TURNS_PER_DAY]! + DAY_MS - nowMs);
    if (day.length > 0) turnBuckets.set(userId, day);
    else turnBuckets.delete(userId);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  day.push(nowMs);
  turnBuckets.set(userId, day);
  return { ok: true };
}
