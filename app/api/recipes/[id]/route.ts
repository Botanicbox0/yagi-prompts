import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { loadPublicRecipe, recordRecipeOpen } from '@/lib/recipes/public';

/**
 * `GET /api/recipes/{templateId}?locale=ko` — a template's full recipe for a signed-in member
 * (docs/PLATFORM-2.0.md §20.3): the prompts in reader form, the creative's notes and, where they
 * chose so, their source files. The static template page only ever carries the outline; this is
 * the one door to the rest, and it is never cached anywhere but the member's own browser tab.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ code: 'not_found' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ code: 'unavailable' }, 503);
    const raw = new URL(request.url).searchParams.get('locale');
    const t = getDictionary(isLocale(raw) ? raw : viewer.locale ?? DEFAULT_LOCALE).makerRecipe;
    const recipe = await loadPublicRecipe(sql, id, { selfie: t.selfieLabel, reference: t.referenceLabel, step: t.stepResultLabel });
    if (!recipe) return json({ code: 'not_found' }, 404);
    const userId = viewer.userId;
    after(() => recordRecipeOpen(sql, id, userId));
    return json({ ok: true, recipe });
  } catch {
    return json({ code: 'unavailable' }, 503);
  }
}
