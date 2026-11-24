import { BIRTH_YEAR_FLOOR, kstYear } from '@/lib/account/adult-age';
import { correctAdultBirthYear } from '@/lib/account/adult-confirmation';
import type { AdminOperation } from './operations';
import { fail, ok } from './context';
import { str } from './form';

/**
 * docs/PERSONAL-STUDIO.md §6.1 — the only way to change a stored 19+ answer (`adult_confirmations`). The person
 * writes it once; an operator corrects the birth year after a support request (and, where there is doubt, the
 * person's own verification, §6.1). The ticked box is never changed by an operator. Every correction writes an
 * immutable `platform_audit` row with the operator, the reason and the year before and after.
 *
 * Form: `userId` (the account), `birthYear` (four digits), `reason` (3–2000 characters, required).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Input = { userId: string; birthYear: number; reason: string };

const correct: AdminOperation<Input> = {
  parse(form) {
    const userId = str(form, 'userId').trim();
    if (!UUID_RE.test(userId)) return { ok: false, detail: 'userId: valid UUID required' };
    const raw = str(form, 'birthYear').trim();
    const birthYear = Number(raw);
    if (!/^\d{4}$/.test(raw) || birthYear < BIRTH_YEAR_FLOOR || birthYear > kstYear(new Date())) return { ok: false, detail: 'birthYear: a four-digit year' };
    const reason = str(form, 'reason').trim();
    if (reason.length < 3 || reason.length > 2000) return { ok: false, detail: 'reason: required (3–2000 characters)' };
    return { ok: true, value: { userId, birthYear, reason } };
  },
  async run(ctx, input) {
    if (ctx.viewer.isAdmin !== true || !ctx.viewer.userId) return fail('forbidden');
    const result = await correctAdultBirthYear(ctx.sql, { ...input, actorId: ctx.viewer.userId, now: new Date() });
    if (result.ok) return ok('saved', { detail: `${result.before} → ${result.after}` });
    return result.code === 'notFound'
      ? fail('notFound', 'this account has no stored answer to correct')
      : fail('not_available_yet', 'adult_confirmations is not applied in this environment');
  },
};

export const ADULT_CONFIRMATION_OPERATIONS = {
  'account.adultConfirmation.correct': correct,
} as const;
