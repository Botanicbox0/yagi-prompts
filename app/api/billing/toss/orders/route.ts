import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import {
  getTossContext,
  isSameOrigin,
  TOSS_HEADERS,
} from '@/lib/billing/toss-runtime';
import { createTossOrder } from '@/lib/billing/toss-service';
import { canStartRender } from '@/lib/renders/service';
import { savedSelfiePhoto } from '@/lib/identity/selfie-service';

/**
 * `POST /api/billing/toss/orders` — an order for one template, paid with the saved selfie.
 *
 * The photo never travels with the order any more (founder, 2026-10-22): the studio names the
 * selfie it showed (`selfieId`) and the server copies the CURRENT selfie's bytes into the order,
 * so a selfie replaced in another tab answers `selfie_required` instead of being charged for.
 */
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: TOSS_HEADERS });
  if (!isSameOrigin(request))
    return json({ ok: false, code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);
  if (!canStartRender(viewer))
    return json({ ok: false, code: 'not_open' }, 403);
  try {
    const deps = await getTossContext();
    if (!deps) return json({ ok: false, code: 'unavailable' }, 503);
    const form = await request.formData();
    const selfieId = String(form.get('selfieId') ?? '');
    const saved = selfieId ? await savedSelfiePhoto(deps.sql, deps.store, viewer.userId, selfieId) : null;
    if (!saved) return json({ ok: false, code: 'selfie_required' }, 400);
    const result = await createTossOrder(deps, viewer, {
      templateSlug: String(form.get('template') ?? ''),
      aspect: String(form.get('aspect') ?? ''),
      // A name, never a price: the service prices it from the template row (lib/twings/resolution.ts).
      resolution: String(form.get('resolution') ?? ''),
      locale: String(form.get('locale') ?? ''),
      selfieId,
      photo: saved,
    });
    return result.ok
      ? json({ ok: true, href: `/billing/toss/${result.order.id}` }, 201)
      : json(result, 400);
  } catch {
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
