'use server';

import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/viewer';
import { revalidateCatalog, revalidateContests, revalidatePrompts } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { getStorage } from '@/lib/storage';
import { fail, type AdminOutcome } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { BACK_FIELD, OP_FIELD, str } from '@/lib/admin/form';

/**
 * The ONE admin server action (§3.8 "All mutations = server actions: `requireAdmin()` first").
 *
 * Every form in `/admin` posts here with a hidden `_op` naming an entry in
 * `lib/admin/operations.ts`. One guarded door rather than twenty is the point: `requireAdmin()`
 * cannot be forgotten on the twenty-first operation, and the acceptance test that enumerates the
 * registry and asserts a non-admin is refused covers the whole surface by construction.
 *
 * `requireAdmin()` throwing means the same thing here as in the `(admin)` layout — **404, not 403**
 * (§3.7): the admin surface does not confirm its own existence. The dispatcher then refuses again
 * on the resolved viewer, so the guard is not load-bearing in one place only.
 */
export async function runAdminOperation(form: FormData): Promise<void> {
  try {
    await requireAdmin();
  } catch {
    notFound();
  }

  const name = str(form, OP_FIELD);
  const back = str(form, BACK_FIELD) || '/admin';

  const outcome = await execute(name, form);
  // Outside the try/catch above on purpose: `redirect()` works by throwing.
  redirect(outcomeUrl(back, outcome));
}

async function execute(name: string, form: FormData): Promise<AdminOutcome> {
  const viewer = await requireAdmin();
  const [sql, storage] = await Promise.all([getSqlRunner(), getStorage()]);
  if (sql === null) {
    // No database configured (§11) — every mutation is a no-op, and saying so is better than a 500.
    return fail('unknown', 'no database is configured on this deployment');
  }
  return dispatchAdmin(name, form, {
    sql,
    storage,
    viewer,
    revalidate: revalidateCatalog,
    revalidatePrompts,
    revalidateContests,
  });
}
