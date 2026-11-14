'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { cancelAccountDeletion, requestAccountDeletion } from '@/lib/account/deletion';
import { ACCOUNT_DELETE_PATH } from '@/lib/account/links';

/**
 * docs/RUNBOOK-deletion.md — the confirmation step's one button. The box must be ticked; the
 * account is the session's, never a form field. A second press lands on the request already open.
 *
 * Both actions return to `/account/delete`, where the request's status is the first thing on the
 * page; `/account` shows it too, but at the bottom of a long page.
 */
export async function requestDeletion(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(ACCOUNT_DELETE_PATH)}`);
  let to = `${ACCOUNT_DELETE_PATH}?deletion=unavailable`;
  try {
    const sql = await getSqlRunner();
    if (sql) {
      const result = await requestAccountDeletion(sql, viewer, form.get('confirm') === 'yes');
      to = result.ok ? ACCOUNT_DELETE_PATH : `${ACCOUNT_DELETE_PATH}?deletion=${result.code}`;
    }
  } catch { /* Keep the failure visible without logging account data. */ }
  redirect(to);
}

/** Withdraw the request. Possible until the account itself has been deleted. */
export async function cancelDeletion(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(ACCOUNT_DELETE_PATH)}`);
  let cancelled = false;
  try {
    const sql = await getSqlRunner();
    cancelled = sql ? await cancelAccountDeletion(sql, viewer.userId) : false;
  } catch { /* Same as above. */ }
  redirect(`${ACCOUNT_DELETE_PATH}?deletion=${cancelled ? 'cancelled' : 'cancelFailed'}`);
}
