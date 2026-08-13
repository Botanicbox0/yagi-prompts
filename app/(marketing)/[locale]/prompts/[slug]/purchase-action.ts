'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { startCookiePackPurchase } from '@/lib/cookies/purchase';
import { loadPromptById } from '@/lib/prompts/repo';
import { promptHref, promptsHref } from '@/lib/prompts/links';
import { signInHref } from '@/lib/billing/links';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

/**
 * PLAN §15.1-5 — the cookie-pack purchase action, one per file like the unlock beside it.
 *
 * Today `startCookiePackPurchase` can only answer 'unavailable' (no MoR is connected — see
 * lib/cookies/purchase.ts), and no surface renders a form posting here until it can answer
 * otherwise. The action exists NOW because it is the M8 seam: when a Paddle-class gateway lands,
 * the empty-wallet panel's `packReady` flips, the form renders, and this redirects the buyer to
 * the hosted checkout — with no new trust decisions to make, because the only fields read are the
 * prompt to return to and the locale. Identity is the session's; the price and the count live in
 * `lib/cookies/wallet.ts` and the gateway call, never in the request.
 */
export async function purchaseCookiePackAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const rawLocale = form.get('locale');
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  const sql = await getSqlRunner();
  if (sql === null) redirect(promptsHref(locale));

  // The pack is bought FROM a prompt page; resolve it so every exit returns the buyer there.
  const row = await loadPromptById(sql, id);
  const back = row === null || row.status !== 'published'
    ? promptsHref(locale)
    : promptHref(locale, row.slug);

  const viewer = await getViewer();
  if (viewer.userId === null) redirect(signInHref(back, locale));

  const start = await startCookiePackPurchase(viewer.userId, back);
  if (start.status === 'redirect') redirect(start.url);
  // 'unavailable' — the page re-renders the designed state; there is nothing else to say.
  redirect(back);
}
