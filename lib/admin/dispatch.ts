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
 * The longest `detail` the outcome URL carries, in characters (R3 item 1). It used to be 200, set with the first admin
 * CMS to keep the redirect short; the step-1 previews of the billing operations travel in this field to their confirm
 * form (the plan upgrade's is ~300 characters), and a cut preview cannot be parsed, so the confirm never appeared.
 * Every preview a registered operation returns fits (tests/admin/outcome-detail-roundtrip.test.ts builds the worst
 * case of each); a database error sentence longer than this is still cut.
 */
export const OUTCOME_DETAIL_MAX_CHARS = 1000;

/**
 * ...and the most its URL-encoded form may take. The detail rides in a 303 `Location` header and then in the request
 * line of the GET that follows, which shares the server's header budget (16 KB on Node, cookies included) with
 * everything else. A detail of non-ASCII text can encode to 9 bytes a character, so the encoded length is bounded too.
 */
export const OUTCOME_DETAIL_MAX_ENCODED = 3000;

/** The detail cut to both bounds, on code points (a surrogate pair is never split). */
export function boundOutcomeDetail(detail: string): string {
  let points = Array.from(detail);
  if (points.length > OUTCOME_DETAIL_MAX_CHARS) points = points.slice(0, OUTCOME_DETAIL_MAX_CHARS);
  let out = points.join('');
  // Review m6: measured as `URLSearchParams` encodes it (it also escapes `!'()~`).
  while (new URLSearchParams({ d: out }).toString().length - 2 > OUTCOME_DETAIL_MAX_ENCODED && points.length > 0) {
    points = points.slice(0, Math.max(0, points.length - Math.max(1, Math.ceil(points.length / 20))));
    out = points.join('');
  }
  return out;
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
  if (outcome.detail) params.set('detail', boundOutcomeDetail(outcome.detail));

  const query = params.toString();
  return `${target.pathname}${query.length > 0 ? `?${query}` : ''}${target.hash}`;
}
