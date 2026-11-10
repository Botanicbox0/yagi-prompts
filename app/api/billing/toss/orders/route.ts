import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import {
  getTossContext,
  isSameOrigin,
  TOSS_HEADERS,
} from '@/lib/billing/toss-runtime';
import { createTossOrder } from '@/lib/billing/toss-service';
import { canStartRender } from '@/lib/renders/service';
import { bindOrderPhotos, orderPhotos } from '@/lib/renders/cast-form';

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
    // docs/CAST-CATEGORIES.md §3: which photo the order carries — the saved selfie (solo, couple,
    // person + pet) or the pet (pet-only) — and the second photo, if the template takes one.
    // A solo template keeps exactly the old rule: the saved selfie or `selfie_required`.
    const photos = await orderPhotos(deps.sql, deps.store, viewer.userId, form);
    if (!photos.ok) return json({ ok: false, code: photos.code }, photos.code === 'not_found' ? 404 : 400);
    const result = await createTossOrder(deps, viewer, {
      templateSlug: String(form.get('template') ?? ''),
      aspect: String(form.get('aspect') ?? ''),
      // A name, never a price: the service prices it from the template row (lib/twings/resolution.ts).
      resolution: String(form.get('resolution') ?? ''),
      locale: String(form.get('locale') ?? ''),
      ...(photos.selfieId ? { selfieId: photos.selfieId } : {}),
      photo: photos.photo,
    });
    if (result.ok && photos.templateId) {
      await bindOrderPhotos(deps.sql, deps.store, { orderId: result.order.id, userId: viewer.userId, templateId: photos.templateId, extras: photos.extras, partnerConsent: photos.partnerConsent, now: new Date() });
    }
    return result.ok
      ? json({ ok: true, href: `/billing/toss/${result.order.id}` }, 201)
      : json(result, 400);
  } catch {
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
