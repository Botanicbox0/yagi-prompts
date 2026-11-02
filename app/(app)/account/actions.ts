'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { savePreferences } from '@/lib/notify/preferences';
import { saveCreatorDisplayName } from '@/lib/creators/profile';

/**
 * PLAN §3.5 — the two `/account` toggles, as one server action.
 *
 * The same shape as the admin surface's single guarded dispatcher (§3.8), for the same reason: one
 * door means one place the guard can be forgotten, and there is nothing here that a second action
 * would express better.
 *
 * Three things it will not do:
 *   · it never trusts the form for identity — the user id comes from `getViewer()`, which resolves
 *     a server-verified session;
 *   · signed-in free creators can save the same switches the account page offers them;
 *   · it never creates a profile. `savePreferences` updates or does nothing.
 *
 * A missing checkbox is `false`, not "unchanged" — that is how an HTML checkbox works with no
 * JavaScript, and the form posts both switches together so the absence is meaningful.
 */
export async function saveNotificationPreferences(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (viewer.userId === null) redirect('/account');

  let saved = false;
  try {
    const sql = await getSqlRunner();
    if (sql) saved = await savePreferences(sql, viewer.userId, {
      newPlaybook: form.get('notifNewPlaybook') !== null,
      updates: form.get('notifUpdates') !== null,
    });
  } catch { /* Keep the error visible without logging notification or account data. */ }
  redirect(saved ? '/account?notif=saved' : '/account?notif=err');
}

/** Name only. SNS is confirmed with campaign participation; identity and roles are never form inputs. */
export async function saveCreatorProfile(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer.userId) redirect('/account');
  let saved = false;
  try {
    const sql = await getSqlRunner();
    saved = sql ? await saveCreatorDisplayName(sql, viewer.userId, form.get('displayName')) : false;
  } catch { /* Keep the failure visible without logging personal form values. */ }
  redirect(saved ? '/account?profile=saved' : '/account?profile=err');
}
