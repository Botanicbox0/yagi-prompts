import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { assetLibraryMode, identityStatusFor, needsLiveness } from '@/lib/identity/service';
import { resolveEngine } from '@/lib/images/engines';
import { loadPreferences } from '@/lib/notify/preferences';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { canStartRender } from '@/lib/renders/service';
import { portraitEnabled } from '@/lib/identity/portrait-runtime';

/**
 * `GET /api/renders/access?template=slug` — what THIS viewer's make button should do on THIS
 * template. The template page is static (one HTML for everyone), so the studio asks at mount:
 *
 *   live              may this viewer start a real render at all (the same rule the enqueue route applies)
 *   charge            will a payment be taken — false for operators (@yagiworkshop.xyz admins test for
 *                     free, founder 2026-09-10) and, until payment is wired, for everyone
 *   identityRequired  does the template's engine need a verified face (ModelArk) — docs §8.2
 *   identity          where this viewer stands on that: none · pending · active · failed · not_needed
 *
 * A viewer who forges any of this only reaches the refusals the enqueue route already carries.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  const live = canStartRender(viewer);
  const slug = new URL(request.url).searchParams.get('template');
  const signedIn = viewer.userId !== null;

  let identityRequired = false;
  let identity: string = 'not_needed';
  // The closed studio's one question: has this person already asked to be told when it opens?
  let interest = false;
  const portraits = portraitEnabled() && !viewer.isAdmin;
  let portraitId: string | null = null;
  if (viewer.userId !== null) {
    const sql = await getSqlRunner();
    if (sql !== null) {
      if (portraits) portraitId = (await sql.query<{attempt_id:string}>('select attempt_id from identity_portrait_selections where user_id=$1',[viewer.userId])).rows[0]?.attempt_id ?? null;
      interest = (await loadPreferences(sql, viewer.userId))?.newPlaybook === true;
      const candidate = live && slug ? await loadPromptBySlug(sql, slug) : null;
      const template = candidate?.audience === 'brand' ? null : candidate;
      if (template !== null) {
        // Only the liveness mode has a camera step to announce; the virtual library needs nothing from the person.
        const mode = assetLibraryMode();
        identityRequired = needsLiveness(resolveEngine(template.engine, template.medium), mode);
        if (identityRequired) identity = await identityStatusFor(sql, viewer.userId, mode);
      }
    }
  }

  return NextResponse.json({ live, charge: live && !viewer.isAdmin, identityRequired, identity, signedIn, interest, portraitEnabled: portraits && signedIn, portraitId }, { headers: HEADERS });
}
