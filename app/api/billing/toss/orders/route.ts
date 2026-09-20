import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import {
  getTossContext,
  isSameOrigin,
  TOSS_HEADERS,
} from '@/lib/billing/toss-runtime';
import { createTossOrder } from '@/lib/billing/toss-service';
import { canStartRender } from '@/lib/renders/service';

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
    const photo = form.get('photo');
    const result = await createTossOrder(deps, viewer, {
      templateSlug: String(form.get('template') ?? ''),
      aspect: String(form.get('aspect') ?? ''),
      locale: String(form.get('locale') ?? ''),
      photo:
        photo instanceof File
          ? {
              bytes: new Uint8Array(await photo.arrayBuffer()),
              mime: photo.type,
            }
          : null,
    });
    return result.ok
      ? json({ ok: true, href: `/billing/toss/${result.order.id}` }, 201)
      : json(result, 400);
  } catch {
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
