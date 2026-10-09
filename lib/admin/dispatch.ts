import { fail, type AdminContext, type AdminOutcome } from './context';
import { classifyDbError, shortMessage } from './errors';
import { ADMIN_OPERATIONS, isAdminOperationName, type AdminOperation } from './operations';
import { normalizeReturnPath, safeReturnPath } from '@/lib/auth/return-path';
import { isAdminPath } from '@/lib/routing/surfaces';

/**
 * The one guarded entry point for every admin mutation (§3.8 "All mutations = server actions:
 * `requireAdmin()` first").
 *
 * `requireAdmin()` runs in the server action, which is what makes `viewer.isAdmin` trustworthy
 * here; this function refuses again on the resolved viewer, BEFORE the operation is even looked up
 * or the form is parsed. That ordering is deliberate: a non-admin must not be able to learn which
 * operation names exist, or make a zod schema run, by posting a form.
 *
 * The failure taxonomy:
 *   forbidden / unknownOperation → the caller had no business here
 *   invalid                      → zod said no at the §6.1 boundary
 *   everything else              → the DATABASE said no, classified in `errors.ts` and phrased by
 *                                  the admin dictionary. The rules stay in the database.
 */
export async function dispatchAdmin(
  name: string,
  form: FormData,
  ctx: AdminContext,
): Promise<AdminOutcome> {
  if (!ctx.viewer.isAdmin) return fail('forbidden');
  if (!isAdminOperationName(name)) return fail('unknownOperation', name.slice(0, 60));

  // Each entry is `AdminOperation<its own input>`; the pair (parse → run) is what keeps that type
  // honest, and it never escapes this function.
  const operation = ADMIN_OPERATIONS[name] as unknown as AdminOperation<unknown>;
  const parsed = operation.parse(form);
  if (!parsed.ok) return fail('invalid', parsed.detail);

  try {
    return await operation.run(ctx, parsed.value);
  } catch (error) {
    return { ok: false, code: classifyDbError(error), detail: shortMessage(error) };
  }
}

/**
 * Outcome → the URL the form returns to.
 *
 * Query params rather than `useActionState` because the editor is deliberately JS-free (§4: the
 * admin surface is a tool). A code plus an optional detail is all the banner needs, and the page
 * translates the code through the bilingual dictionary.
 */
export function outcomeUrl(back: string, outcome: AdminOutcome): string {
  // Never an open redirect: anything that is not an admin path collapses to the list. `to` is
  // constructed by the operations themselves and is checked by the same rule.
  const to = outcome.ok ? outcome.to : undefined;
  const requested = safeReturnPath(to ?? back, '/admin');
  const safe = isAdminPath(new URL(requested, 'https://path.invalid').pathname) ? requested : '/admin';

  const target = new URL(safe, 'https://path.invalid');
  // A redirect to a DIFFERENT page drops the old page's query state; returning to the same page
  // keeps it (the block-editor `?add=` affordance, for one).
  const params = new URLSearchParams(to === undefined ? target.search : '');
  // A campaign action may explicitly return to its current detail. Carry only its validated
  // list navigation context; new campaigns and other destination pages keep their old redirect.
  if (to !== undefined && /^\/admin\/brand-workspace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.pathname)) {
    const previous = new URL(safeReturnPath(back, '/admin'), 'https://path.invalid');
    const values = previous.searchParams.getAll('returnTo');
    const list = values.length === 1 ? normalizeReturnPath(values[0]) : null;
    if (previous.pathname === target.pathname && list && new URL(list, 'https://path.invalid').pathname === '/admin/brand-workspace') params.set('returnTo', list);
  }

  params.delete('ok');
  params.delete('err');
  params.delete('detail');

  params.set(outcome.ok ? 'ok' : 'err', outcome.code);
  if (outcome.detail) params.set('detail', outcome.detail.slice(0, 200));

  const query = params.toString();
  return `${target.pathname}${query.length > 0 ? `?${query}` : ''}${target.hash}`;
}
