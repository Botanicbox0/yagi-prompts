import type { AdminOperation } from './operations';
import { fail, ok } from './context';
import { ADMIN_NAV_PATHS } from './workflow';
import { decideDeletion } from '@/lib/account/deletion';

/**
 * docs/APP-STORE-LAUNCH.md §3.2 — the three marks of the account deletion queue, in the one registry
 * so the admin auth enumeration covers them. They record where docs/RUNBOOK-deletion.md stands; none
 * of them deletes anything. `complete` is refused while the account still exists.
 */
export const ADMIN_ACCOUNT_DELETIONS_PATH = ADMIN_NAV_PATHS.accountDeletions;
const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};
type Input = { id: string; note?: string };
const input = (form: FormData): Input => {
  const note = str(form, 'note').trim();
  return note ? { id: str(form, 'id'), note } : { id: str(form, 'id') };
};

function mark(move: 'start' | 'complete' | 'cancel'): AdminOperation<Input> {
  return {
    parse(form) {
      const value = input(form);
      if (move === 'cancel' && !value.note) return { ok: false, detail: 'note: required' };
      return { ok: true, value };
    },
    async run(ctx, value) {
      const r = await decideDeletion(ctx.sql, ctx.viewer, move, value);
      if (r.ok) return ok(r.status === 'completed' ? 'deleted' : 'saved', { to: ADMIN_ACCOUNT_DELETIONS_PATH });
      if (r.code === 'accountExists') return fail('badTransition', `${r.from} → completed: the account still exists (RUNBOOK-deletion §2 first)`);
      return r.code === 'badTransition' ? fail('badTransition', `${r.from} → ${move}`) : fail(r.code);
    },
  };
}

export const ACCOUNT_DELETION_OPERATIONS = {
  'account.deletion.start': mark('start'),
  'account.deletion.complete': mark('complete'),
  'account.deletion.cancel': mark('cancel'),
} as const;
