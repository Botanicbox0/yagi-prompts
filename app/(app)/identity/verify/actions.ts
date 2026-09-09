'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { liveIdentityDeps } from '@/lib/identity/runtime';
import { startIdentityVerification } from '@/lib/identity/service';
import { IDENTITY_VERIFY_PATH, identityVerifyHref, safeNextPath } from '@/lib/identity/links';

/**
 * "인증 시작하기" — opens a liveness session at the bank and sends the person to its page. One
 * server action, the same shape as the account toggles: identity from the session, never the form.
 */
export async function startVerificationAction(form: FormData): Promise<void> {
  const next = safeNextPath(form.get('next'));
  const viewer = await getViewer();
  if (viewer.userId === null) redirect(IDENTITY_VERIFY_PATH);

  const sql = await getSqlRunner();
  if (sql === null) redirect(identityVerifyHref(next, { err: 'unavailable' }));

  const outcome = await startIdentityVerification(liveIdentityDeps(sql), viewer, { nextPath: next, language: 'en' });
  if (!outcome.ok) redirect(identityVerifyHref(next, { err: outcome.code }));
  // An absolute URL on the bank's host: the liveness page itself.
  redirect(outcome.h5Link);
}
