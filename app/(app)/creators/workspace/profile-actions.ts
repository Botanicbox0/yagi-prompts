'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { revalidateMakerProfile } from '@/lib/cache';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { MakerProfileError, loadMakerSettings, saveMakerProfile, type MakerProfileInput } from '@/lib/makers/profile';
import { MAKER_LINKS_MAX } from '@/lib/makers/fields';

export type MakerProfileResult = { ok: true } | { ok: false; code: string };

/**
 * docs/PLATFORM-2.0.md §7.5·§20 — the creative's public profile. A plain form POST, so it works
 * before hydration and without JavaScript. Identity comes from the session, the gate from the
 * server env, and every field is re-validated by `saveMakerProfile`; the redirect carries only a
 * result code, never what was typed.
 */
export async function saveMakerProfileForm(form: FormData): Promise<void> {
  const value = (name: string) => { const raw = form.get(name); return typeof raw === 'string' ? raw : ''; };
  const result = await run({
    handle: value('handle'), bio: value('bio'), publicProfile: value('publicProfile') === 'on',
    // The 0065 fields are read only when the form carried them (it does once 0065 is applied).
    ...(form.has('displayName') ? {
      displayName: value('displayName'), headline: value('headline'), country: value('country'), city: value('city'),
      links: Array.from({ length: MAKER_LINKS_MAX }, (_, i) => value(`link${i}`)), publicEmail: value('publicEmail'),
      tools: value('tools'), openToBrands: value('openToBrands') === 'on',
    } : {}),
  });
  redirect(result.ok ? `${CREATOR_WORKSPACE_PATH}?ok=profile#profile` : `${CREATOR_WORKSPACE_PATH}?profile=${encodeURIComponent(result.code)}#profile`);
}

async function run(input: MakerProfileInput): Promise<MakerProfileResult> {
  const viewer = await getViewer();
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const sql = await getSqlRunner();
  if (sql === null) return { ok: false, code: 'unavailable' };
  try {
    if (!(await platformAccess(sql)).creators) return { ok: false, code: 'not_maker' };
    const before = await loadMakerSettings(sql, viewer.userId);
    // A form without the 0065 fields (the database is behind) keeps whatever is saved.
    const after = await saveMakerProfile(sql, viewer.userId, 'displayName' in input ? input : {
      ...input, displayName: before?.displayName, headline: before?.headline, country: before?.country, city: before?.city,
      links: before?.links, publicEmail: before?.publicEmail, tools: before?.tools, openToBrands: before?.openToBrands,
    });
    revalidateMakerProfile([before?.handle, after.handle].filter((handle): handle is string => !!handle));
    return { ok: true };
  } catch (error) {
    if (error instanceof MakerProfileError) return { ok: false, code: error.code };
    return { ok: false, code: 'unavailable' };
  }
}
