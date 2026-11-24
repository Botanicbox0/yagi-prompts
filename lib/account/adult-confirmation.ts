import type { SqlRunner } from '@/lib/db/sql-runner';
import { personalSunraFacesOpen } from '@/lib/flags';
import { isAdultAnswer, parseAdultAnswer, type AdultAnswer } from './adult-age';

/**
 * docs/PERSONAL-STUDIO.md §6.1 — the stored 19+ answer (`adult_confirmations`, migration 0188; server only,
 * deny-all RLS in 0189). One row per account, written ONCE when the person first answers: a first failing
 * answer is kept like a passing one, and a later answer changes nothing. The only way to change it is the
 * audited admin operation (`account.adultConfirmation.correct`, `correctAdultBirthYear` below).
 *
 * Asked and enforced only while `TWINGS_PERSONAL_SUNRA_FACES=on`, and only for a template with a partner slot
 * (lib/renders/partner-rules.ts). With the switch off nothing here is called on the make path.
 *
 * Refusals:
 *   adult_confirmation_required  no stored row and no usable answer sent
 *   adult_only                   the stored row (or the answer just stored) fails the rule (./adult-age.ts)
 *   adult_check_unavailable      the table is missing or unreadable — the gate fails closed
 */

export type AdultRefusal = 'adult_confirmation_required' | 'adult_only' | 'adult_check_unavailable';

export interface AdultConfirmation extends AdultAnswer {
  attestedAt: Date;
}

export const ADULT_CORRECTION_AUDIT_ACTION = 'account.adultConfirmation.correct';

/** True when migration 0188's table is there. Quietly false on an older or unreadable database. */
export async function adultConfirmationTableReady(sql: SqlRunner): Promise<boolean> {
  try {
    const { rows } = await sql.query<{ ready: boolean }>(`select to_regclass('public.adult_confirmations') is not null as ready`);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export async function readAdultConfirmation(sql: SqlRunner, userId: string): Promise<AdultConfirmation | null> {
  const { rows } = await sql.query<{ birth_year: number; attested: boolean; attested_at: Date | string }>(
    'select birth_year, attested, attested_at from adult_confirmations where user_id = $1',
    [userId],
  );
  const row = rows[0];
  return row ? { birthYear: Number(row.birth_year), attested: row.attested === true, attestedAt: new Date(row.attested_at) } : null;
}

/** Writes the first answer; true when this call wrote it, false when an answer was already on file (kept). */
export async function recordAdultAnswer(sql: SqlRunner, userId: string, answer: AdultAnswer, now: Date): Promise<boolean> {
  const { rows } = await sql.query<{ user_id: string }>(
    `insert into adult_confirmations (user_id, birth_year, attested, attested_at)
     values ($1, $2, $3, $4)
     on conflict (user_id) do nothing
     returning user_id`,
    [userId, answer.birthYear, answer.attested === true, now],
  );
  return rows.length > 0;
}

/**
 * The gate for a partner slot. An answer sent with the request is stored first if none is on file (and
 * ignored if one is); then the stored row decides. Never throws for a missing table: it refuses.
 */
export async function requireAdult(
  sql: SqlRunner,
  userId: string,
  answer: AdultAnswer | null,
  now: Date,
): Promise<{ ok: true } | { ok: false; code: AdultRefusal }> {
  if (!(await adultConfirmationTableReady(sql))) return { ok: false, code: 'adult_check_unavailable' };
  let stored = await readAdultConfirmation(sql, userId);
  if (stored === null && answer !== null) {
    await recordAdultAnswer(sql, userId, answer, now);
    stored = await readAdultConfirmation(sql, userId);
  }
  if (stored === null) return { ok: false, code: 'adult_confirmation_required' };
  return isAdultAnswer(stored, now) ? { ok: true } : { ok: false, code: 'adult_only' };
}

/** For the access call: is this account confirmed right now. False (never a throw) on a database without the table. */
export async function isAdultConfirmed(sql: SqlRunner, userId: string, now: Date = new Date()): Promise<boolean> {
  try {
    if (!(await adultConfirmationTableReady(sql))) return false;
    const stored = await readAdultConfirmation(sql, userId);
    return stored !== null && isAdultAnswer(stored, now);
  } catch {
    return false;
  }
}

/**
 * The entry routes that hand a posted partner photo straight to the render service (the operator's
 * `/api/renders` and the store-credit route) record the answer here, OUTSIDE the service's transaction,
 * so a failing first answer is kept even when that transaction rolls back on the refusal. The service then
 * reads the stored row. With the switch off this does nothing. A failure to write is swallowed on purpose:
 * the gate then finds no row and refuses (fail-closed), which is the safe outcome.
 */
export async function recordAdultAnswerFromForm(
  sql: SqlRunner,
  userId: string,
  form: FormData,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!personalSunraFacesOpen(env)) return;
  const answer = parseAdultAnswer(form, now);
  if (answer === null) return;
  try {
    if (await adultConfirmationTableReady(sql)) await recordAdultAnswer(sql, userId, answer, now);
  } catch {
    // See above: no row means the gate refuses.
  }
}

/**
 * The admin correction (docs/PERSONAL-STUDIO.md §6.1): rewrites the birth year only — never the person's own
 * "19 or older" box — and writes an immutable `platform_audit` row with the operator, the reason, and the
 * year before and after. An account that never answered has nothing to correct.
 */
export async function correctAdultBirthYear(
  sql: SqlRunner,
  input: { userId: string; birthYear: number; actorId: string; reason: string; now: Date },
): Promise<{ ok: true; before: number; after: number } | { ok: false; code: 'notFound' | 'unavailable' }> {
  if (!(await adultConfirmationTableReady(sql))) return { ok: false, code: 'unavailable' };
  return sql.transaction(async (tx) => {
    const { rows } = await tx.query<{ birth_year: number; attested: boolean }>(
      'select birth_year, attested from adult_confirmations where user_id = $1 for update',
      [input.userId],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, code: 'notFound' as const };
    const before = Number(row.birth_year);
    await tx.query('update adult_confirmations set birth_year = $2 where user_id = $1', [input.userId, input.birthYear]);
    await tx.query(
      `insert into platform_audit (actor_id, entity_id, action, reason, details, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [input.actorId, input.userId, ADULT_CORRECTION_AUDIT_ACTION, input.reason, JSON.stringify({ before, after: input.birthYear, attested: row.attested === true }), input.now],
    );
    return { ok: true as const, before, after: input.birthYear };
  });
}
