'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { revalidateMakerProfile } from '@/lib/cache';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { MakerProfileError, loadMakerSettings, saveMakerProfile } from '@/lib/makers/profile';

export type MakerProfileResult = { ok: true } | { ok: false; code: string };

/**
 * docs/PLATFORM-2.0.md §7.5 — the maker's public profile (handle · bio · opt-in). A plain form POST,
 * so it works before hydration and without JavaScript. Identity comes from the session, the gate
 * from the server env, and every field is re-validated by `saveMakerProfile`; the redirect carries
 * only a result code, never what was typed.
 */
export async function saveMakerProfileForm(form: FormData): Promise<void> {
  const value = (name: string) => { const raw = form.get(name); return typeof raw === 'string' ? raw : ''; };
  const result = await run({ handle: value('handle'), bio: value('bio'), publicProfile: value('publicProfile') === 'on' });
  redirect(result.ok ? `${CREATOR_WORKSPACE_PATH}?ok=profile#profile` : `${CREATOR_WORKSPACE_PATH}?profile=${encodeURIComponent(result.code)}#profile`);
}

async function run(input: { handle: string; bio: string; publicProfile: boolean }): Promise<MakerProfileResult> {
  const viewer = await getViewer();
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const sql = await getSqlRunner();
  if (sql === null) return { ok: false, code: 'unavailable' };
  try {
    if (!(await platformAccess(sql)).creators) return { ok: false, code: 'not_maker' };
    const before = await loadMakerSettings(sql, viewer.userId);
    const after = await saveMakerProfile(sql, viewer.userId, input);
    revalidateMakerProfile([before?.handle, after.handle].filter((handle): handle is string => !!handle));
    return { ok: true };
  } catch (error) {
    if (error instanceof MakerProfileError) return { ok: false, code: error.code };
    return { ok: false, code: 'unavailable' };
  }
}
