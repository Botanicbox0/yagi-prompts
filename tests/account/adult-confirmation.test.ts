import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  birthYearChoices, isAdultAnswer, kstYear, parseAdultAnswer,
} from '@/lib/account/adult-age';
import {
  correctAdultBirthYear, isAdultConfirmed, readAdultConfirmation, recordAdultAnswer, recordAdultAnswerFromForm, requireAdult,
} from '@/lib/account/adult-confirmation';
import { viewerOf } from '@/tests/helpers/admin';
import { emptyPromptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * docs/PERSONAL-STUDIO.md §6.1 — the 19+ confirmation for a partner slot (P2 PR B), on a real PGlite.
 *   · the rule: the box ticked AND (KST year − birth year) ≥ 19, counted on the Korean calendar;
 *   · one row per account, written once: a first failing answer is kept, a later answer changes nothing;
 *   · a database without the table never throws for a reader, and refuses (fails closed) for the gate.
 */
const user = viewerOf('free').userId!;
const NOW = new Date('2026-11-24T03:00:00.000Z');
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('the age rule (pure)', () => {
  it('counts the year in Korea, not in UTC: 31 Dec 15:00 UTC is already 1 Jan in Seoul', () => {
    expect(kstYear(new Date('2026-12-31T14:59:59.000Z'))).toBe(2026);
    expect(kstYear(new Date('2026-12-31T15:00:00.000Z'))).toBe(2027);
    // Born 2008: 18 by year difference until the KST new year, 19 from its first second.
    const born2008 = { birthYear: 2008, attested: true };
    expect(isAdultAnswer(born2008, new Date('2026-12-31T14:59:59.000Z'))).toBe(false);
    expect(isAdultAnswer(born2008, new Date('2026-12-31T15:00:00.000Z'))).toBe(true);
    // 1 Jan 00:30 UTC is 09:30 in Seoul — the same KST year either way.
    expect(isAdultAnswer(born2008, new Date('2027-01-01T00:30:00.000Z'))).toBe(true);
  });

  it('needs the box ticked as well as the year', () => {
    expect(isAdultAnswer({ birthYear: 1990, attested: true }, NOW)).toBe(true);
    expect(isAdultAnswer({ birthYear: 1990, attested: false }, NOW)).toBe(false);
    expect(isAdultAnswer({ birthYear: 2007, attested: true }, NOW)).toBe(true);
    expect(isAdultAnswer({ birthYear: 2008, attested: true }, NOW)).toBe(false);
  });

  it('reads the two form fields; a missing or impossible year is no answer at all', () => {
    expect(parseAdultAnswer(form({ birthYear: '1994', adultAttested: 'yes' }), NOW)).toEqual({ birthYear: 1994, attested: true });
    expect(parseAdultAnswer(form({ birthYear: '1994' }), NOW)).toEqual({ birthYear: 1994, attested: false });
    expect(parseAdultAnswer(form({ adultAttested: 'yes' }), NOW)).toBeNull();
    expect(parseAdultAnswer(form({ birthYear: '94', adultAttested: 'yes' }), NOW)).toBeNull();
    expect(parseAdultAnswer(form({ birthYear: '1899', adultAttested: 'yes' }), NOW)).toBeNull();
    expect(parseAdultAnswer(form({ birthYear: '2030', adultAttested: 'yes' }), NOW)).toBeNull();
    expect(parseAdultAnswer(form({ birthYear: '1994.5', adultAttested: 'yes' }), NOW)).toBeNull();
  });

  it('offers years from 14 years ago back, newest first', () => {
    const years = birthYearChoices(NOW);
    expect(years[0]).toBe(2012);
    expect(years).toContain(2008);
    expect(years).toContain(1940);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });
});

describe('the stored confirmation', () => {
  let h: PromptHarness;
  beforeEach(async () => { h = await emptyPromptHarness(); });
  afterEach(async () => { await h.close(); });

  it('no row and no answer: confirmation required, nothing written', async () => {
    expect(await requireAdult(h.sql, user, null, NOW)).toEqual({ ok: false, code: 'adult_confirmation_required' });
    expect(await readAdultConfirmation(h.sql, user)).toBeNull();
    expect(await isAdultConfirmed(h.sql, user, NOW)).toBe(false);
  });

  it('a passing first answer is written once and confirms the account', async () => {
    expect(await requireAdult(h.sql, user, { birthYear: 1994, attested: true }, NOW)).toEqual({ ok: true });
    expect(await readAdultConfirmation(h.sql, user)).toMatchObject({ birthYear: 1994, attested: true });
    expect(await isAdultConfirmed(h.sql, user, NOW)).toBe(true);
    // Asked again with no answer: the stored row decides.
    expect(await requireAdult(h.sql, user, null, NOW)).toEqual({ ok: true });
  });

  it('a first failing answer is kept: a second, passing answer changes nothing', async () => {
    expect(await requireAdult(h.sql, user, { birthYear: 2010, attested: true }, NOW)).toEqual({ ok: false, code: 'adult_only' });
    expect(await requireAdult(h.sql, user, { birthYear: 1990, attested: true }, NOW)).toEqual({ ok: false, code: 'adult_only' });
    expect(await readAdultConfirmation(h.sql, user)).toMatchObject({ birthYear: 2010, attested: true });
    expect(await recordAdultAnswer(h.sql, user, { birthYear: 1990, attested: true }, NOW)).toBe(false);
    expect((await h.sql.query<{ n: number }>('select count(*)::int as n from adult_confirmations')).rows[0]!.n).toBe(1);
  });

  it('an unticked box is a failing answer and is kept too', async () => {
    expect(await requireAdult(h.sql, user, { birthYear: 1990, attested: false }, NOW)).toEqual({ ok: false, code: 'adult_only' });
    expect(await requireAdult(h.sql, user, { birthYear: 1990, attested: true }, NOW)).toEqual({ ok: false, code: 'adult_only' });
  });

  it('the route helper records only while the switch is on', async () => {
    await recordAdultAnswerFromForm(h.sql, user, form({ birthYear: '1994', adultAttested: 'yes' }), NOW, {});
    expect(await readAdultConfirmation(h.sql, user)).toBeNull();
    await recordAdultAnswerFromForm(h.sql, user, form({ birthYear: '1994', adultAttested: 'yes' }), NOW, { TWINGS_PERSONAL_SUNRA_FACES: 'on' });
    expect(await readAdultConfirmation(h.sql, user)).toMatchObject({ birthYear: 1994, attested: true });
  });

  it('without the table: a reader says "not confirmed" without throwing; the gate refuses', async () => {
    await h.sql.query('drop table adult_confirmations');
    expect(await isAdultConfirmed(h.sql, user, NOW)).toBe(false);
    await expect(recordAdultAnswerFromForm(h.sql, user, form({ birthYear: '1994', adultAttested: 'yes' }), NOW, { TWINGS_PERSONAL_SUNRA_FACES: 'on' })).resolves.toBeUndefined();
    expect(await requireAdult(h.sql, user, { birthYear: 1994, attested: true }, NOW)).toEqual({ ok: false, code: 'adult_check_unavailable' });
    expect(await requireAdult(h.sql, user, null, NOW)).toEqual({ ok: false, code: 'adult_check_unavailable' });
  });

  it('the correction rewrites the year only, and leaves an audit row naming who and why', async () => {
    const admin = viewerOf('admin').userId!;
    expect(await correctAdultBirthYear(h.sql, { userId: user, birthYear: 1994, actorId: admin, reason: 'support ticket: picked the wrong year', now: NOW })).toEqual({ ok: false, code: 'notFound' });
    await recordAdultAnswer(h.sql, user, { birthYear: 2012, attested: true }, NOW);
    const corrected = await correctAdultBirthYear(h.sql, { userId: user, birthYear: 1994, actorId: admin, reason: 'support ticket: picked the wrong year', now: NOW });
    expect(corrected).toEqual({ ok: true, before: 2012, after: 1994 });
    expect(await readAdultConfirmation(h.sql, user)).toMatchObject({ birthYear: 1994, attested: true });
    const audit = await h.sql.query<{ actor_id: string; entity_id: string; action: string; reason: string; details: Record<string, unknown> }>(
      "select actor_id, entity_id, action, reason, details from platform_audit where action = 'account.adultConfirmation.correct'");
    expect(audit.rows).toEqual([{ actor_id: admin, entity_id: user, action: 'account.adultConfirmation.correct', reason: 'support ticket: picked the wrong year', details: { before: 2012, after: 1994, attested: true } }]);
  });
});
