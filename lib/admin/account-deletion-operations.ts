import type { AdminOperation } from './operations';
import { fail, ok } from './context';
import { ADMIN_NAV_PATHS } from './workflow';
import { decideDeletion, type DeletionMove } from '@/lib/account/deletion';
import { liveDeletionDeps } from '@/lib/account/deletion-runtime';

/**
 * docs/RUNBOOK-deletion.md — the account deletion queue's three buttons, in the one registry so the
 * admin auth enumeration covers them.
 *
 *   run      — delete now (skips the grace period, never a hold; the operator types the account's
 *              address first), or retry an unfinished cleanup.
 *   complete — mark done by hand; refused while the account still exists.
 *   cancel   — close a request the member withdrew by mail; refused once the account is gone.
 */
export const ADMIN_ACCOUNT_DELETIONS_PATH = ADMIN_NAV_PATHS.accountDeletions;
const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};
type Input = { id: string; note?: string; confirm?: string };
const input = (form: FormData): Input => {
  const note = str(form, 'note').trim();
  // "Delete now" only: the account's address, typed by the operator.
  const confirm = str(form, 'confirm').trim();
  return { id: str(form, 'id'), ...(note ? { note } : {}), ...(confirm ? { confirm } : {}) };
};

function mark(move: DeletionMove): AdminOperation<Input> {
  return {
    parse(form) {
      const value = input(form);
      if (move === 'cancel' && !value.note) return { ok: false, detail: 'note: required' };
      return { ok: true, value };
    },
    async run(ctx, value) {
      const r = await decideDeletion(await liveDeletionDeps(ctx.sql), ctx.viewer, move, value);
      if (r.ok) return ok(r.status === 'completed' ? 'deleted' : 'saved', { to: ADMIN_ACCOUNT_DELETIONS_PATH });
      switch (r.code) {
        case 'held': return fail('badTransition', `held: ${r.hold.join(', ')}`);
        case 'cleanupLeft': return fail('badTransition', `account deleted; ${r.left} cleanup item(s) left — see the request's last error`);
        case 'accountExists': return fail('badTransition', `${r.from} → completed: the account still exists`);
        case 'unavailable': return fail('badTransition', 'storage or sign-in removal is not configured in this environment');
        case 'badTransition': return fail('badTransition', `${r.from} → ${move}`);
        case 'notDue': return fail('badTransition', 'not due');
        case 'unconfirmed': return fail('invalid', 'confirm: type the address of the account to delete it before its grace period ends');
        case 'removedElsewhere': return fail('badTransition', 'the account was removed outside this flow — check storage and the provider by hand, then mark done with a note');
        default: return fail(r.code);
      }
    },
  };
}

export const ACCOUNT_DELETION_OPERATIONS = {
  'account.deletion.run': mark('run'),
  'account.deletion.complete': mark('complete'),
  'account.deletion.cancel': mark('cancel'),
} as const;
