'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { unlockPrompt } from '@/lib/cookies/repo';
import { loadPromptById } from '@/lib/prompts/repo';
import { promptHref, promptsHref } from '@/lib/prompts/links';
import { signInHref } from '@/lib/billing/links';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

/**
 * PLAN §15.3 — the ONE unlock action, on the detail page it serves.
 *
 * The same shape as the submission action: a thin `'use server'` wrapper that resolves the viewer
 * and the database and hands the decision to `unlockPrompt`, which owns every rule (§15.1-6 —
 * profile lock, idempotency, lazy grant, balance guard, one transaction). Nothing is trusted from
 * the form: the prompt id names the OBJECT of the action and is re-verified against the row
 * (published, YAGI, gated) inside the same transaction that spends; the locale only picks a
 * redirect target. Identity comes from the session and from nowhere else.
 *
 * Every outcome lands back on the prompt page, which is dynamic + no-store and therefore renders
 * the truth: 'unlocked' arrives as the text, 'needCookies' as the wallet panel, 'alreadyUnlocked'
 * as the text it already had. No outcome needs a query-string to explain itself.
 */
export async function unlockPromptAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const rawLocale = form.get('locale');
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  const sql = await getSqlRunner();
  // No database ⇒ nothing is published ⇒ there is no page to return to. Fail closed.
  if (sql === null) redirect(promptsHref(locale));

  // Resolve the row FIRST so every exit below can land on the page the reader pressed.
  const row = await loadPromptById(sql, id);
  if (row === null || row.status !== 'published') redirect(promptsHref(locale));
  const back = promptHref(locale, row.slug);

  const viewer = await getViewer();
  // A signed-out POST (expired session, crafted form) starts Journey A and returns here.
  if (viewer.userId === null) redirect(signInHref(back, locale));

  await unlockPrompt(sql, viewer.userId, id);
  redirect(back);
}
