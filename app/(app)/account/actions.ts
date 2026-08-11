'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { loadSubscription } from '@/lib/billing/reconcile';
import { getSqlRunner } from '@/lib/db/connect';
import { savePreferences } from '@/lib/notify/preferences';

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
 *   · it never grants a preference to a reader who is not entitled. Notifications are Pro (§3.5),
 *     and the entitlement rule is the §3.4 one, re-derived here rather than passed in from a page;
 *   · it never creates a profile. `savePreferences` updates or does nothing.
 *
 * A missing checkbox is `false`, not "unchanged" — that is how an HTML checkbox works with no
 * JavaScript, and the form posts both switches together so the absence is meaningful.
 */
export async function saveNotificationPreferences(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (viewer.userId === null) redirect('/account');

  const sql = await getSqlRunner();
  if (sql === null) redirect('/account?notif=err');

  const subscription = await loadSubscription(sql, viewer.userId);
  const entitled = subscription?.entitled === true || viewer.tier === 'pro';
  // Not an error the UI needs to explain: a free reader is never shown this form, so reaching here
  // means a hand-crafted POST. Bounce it silently rather than reporting on the gate.
  if (!entitled) redirect('/account');

  const saved = await savePreferences(sql, viewer.userId, {
    newPlaybook: form.get('notifNewPlaybook') !== null,
    updates: form.get('notifUpdates') !== null,
  });

  redirect(saved ? '/account?notif=saved' : '/account');
}
