'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { revalidateContests } from '@/lib/cache';
import { submitEntry } from '@/lib/contests/submit';
import { contestSubmitPath } from '@/lib/contests/links';
import { bool, str, text } from '@/lib/admin/form';

/**
 * PLAN §14.1/§14.2 — the ONE contest-entry action.
 *
 * The same shape as `app/(app)/prompts/submit/actions.ts`: a thin `'use server'` wrapper that
 * resolves its two dependencies (viewer, database) and hands them to an injectable service which
 * owns every decision. Nothing is trusted from the form except the four fields an entrant is
 * allowed to choose — the author id, the contest, the status and the placement are all supplied or
 * cleared by the server (`lib/contests/submit.ts`), so there is no field a caller could add to
 * approve their own entry or award themselves a medal.
 *
 * The slug comes from the URL rather than a hidden input for the same reason: a form field naming
 * the contest would be a field an attacker could point at a different one.
 *
 * JS-free (plain POST + `?ok/err` codes), like the admin editor and the prompts form, so the entry
 * path keeps working with scripts blocked and there is no client-side validation to mistake for a
 * gate.
 */
export async function submitEntryAction(form: FormData): Promise<void> {
  const slug = str(form, 'slug');
  const outcome = await run(slug, form);
  redirect(`${contestSubmitPath(slug)}?${outcome}`);
}

async function run(slug: string, form: FormData): Promise<string> {
  const viewer = await getViewer();
  if (viewer.userId === null) return 'err=sign_in_required';

  const sql = await getSqlRunner();
  if (sql === null) return 'err=invalid&detail=no+database+configured';

  const result = await submitEntry({ sql }, viewer, slug, {
    title: str(form, 'title'),
    videoUrl: str(form, 'videoUrl'),
    snsUrl: str(form, 'snsUrl'),
    note: text(form, 'note') || null,
    consent: bool(form, 'consent'),
  });

  if (!result.ok) {
    const detail =
      'detail' in result && result.detail ? `&detail=${encodeURIComponent(String(result.detail))}` : '';
    // §14.2 / M9 review, finding 5: the refusal names the field, so the form can mark it rather
    // than printing a banner over five identical boxes. The value is a closed enum
    // (`ENTRY_FIELDS`), re-validated when it is read back off the URL.
    const field = 'field' in result && result.field ? `&field=${result.field}` : '';
    return `err=${result.code}${detail}${field}`;
  }

  // A new entry does not change the public page (it is pending), but the contest card's approved
  // count and the entries rail are both cached — and a RESUBMIT can pull an already-approved entry
  // off the rail. Invalidating on both is one call and removes the need to reason about which.
  revalidateContests();
  return `ok=1&resubmitted=${result.resubmitted ? '1' : '0'}`;
}
