import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isLocale } from '@/lib/i18n/config';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { createRenderJob, type CreateRenderFailure } from '@/lib/renders/service';
import { renderHref } from '@/lib/renders/share';
import { identityVerifyHref } from '@/lib/identity/links';
import { getRenderStore } from '@/lib/renders/store';
import { savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { castFormPhotos } from '@/lib/renders/cast-form';

/**
 * `POST /api/renders` — the studio hands over the photo, the template and the aspect; the
 * answer is the result page's address (docs/TEMPLATES-IA.md §8).
 *
 * The request does not wait for the render. It stores the photo, queues the job, answers 201,
 * and THEN runs the pass in `after()` — the same function invocation, after the response, inside
 * the function's own time budget. An image finishes there (a minute or two); a film is handed to
 * ModelArk and finished by a later pass (callback, result-page poll or cron).
 *
 * The photo is the viewer's saved selfie (`selfieId`, docs/IDENTITY-SELFIE.md); an operator's
 * tooling may still post a `photo` file directly. Vercel refuses request bodies above ~4.5MB
 * before any of this code runs, so the size discipline lives in the browser.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const STATUS: Record<CreateRenderFailure, number> = {
  sign_in_required: 401,
  not_open: 403,
  not_found: 404,
  not_for_sale: 409,
  bad_aspect: 400,
  bad_resolution: 400,
  bad_photo: 400,
  photo_too_large: 413,
  rate_limited: 429,
  identity_required: 403,
  slot_missing: 400,
  bad_slot_photo: 400,
  partner_consent_required: 400,
  not_a_pet: 400,
  pet_check_unavailable: 503,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ ok: false, code: 'sign_in_required' }, 401);

  const sql = await getSqlRunner();
  if (sql === null) return json({ ok: false, code: 'unavailable' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, code: 'bad_request' }, 400);
  }
  const photo = form.get('photo');
  const rawLocale = form.get('locale');
  const store = await getRenderStore();
  const selfieId = String(form.get('selfieId') ?? '');
  const saved = !(photo instanceof File) && selfieId ? await savedSelfiePhoto(sql, store, viewer.userId, selfieId) : null;
  if (selfieId && !saved && !(photo instanceof File)) return json({ ok: false, code: 'selfie_required' }, 400);
  // docs/CAST-CATEGORIES.md §3: the pet or partner photo. A pet-only template has no selfie: its pet
  // is the one photo. The service checks the template's cast (couples 404 while their flag is off).
  const cast = await castFormPhotos(form);
  const primary = saved ?? (photo instanceof File ? { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type } : null) ?? (selfieId ? null : cast.slots.pet ?? null);

  const outcome = await createRenderJob({ sql, store }, viewer, {
    templateSlug: String(form.get('template') ?? ''),
    aspect: String(form.get('aspect') ?? ''),
    photo: primary,
    selfieId: saved ? selfieId : undefined,
    slots: cast.slots,
    partnerConsent: cast.partnerConsent,
    locale: typeof rawLocale === 'string' && isLocale(rawLocale) ? rawLocale : null,
    holdForIdentity: form.get('hold') === '1',
    // Read only on an operator's free render; a paid render takes the order's own value.
    resolution: typeof form.get('resolution') === 'string' ? String(form.get('resolution')) : null,
  });
  if (!outcome.ok) return json(outcome, STATUS[outcome.code]);

  // Held behind the face check: nothing to run yet. The verify page brings the person back to
  // this job's page, and the identity callback releases it the moment they are verified.
  if (outcome.held) {
    return json({ ok: true, id: outcome.id, href: renderHref(outcome.id), held: true, verifyHref: identityVerifyHref(renderHref(outcome.id)) }, 201);
  }

  after(async () => {
    try {
      await runLiveRenderPass(sql, { jobId: outcome.id, limit: 1 });
    } catch (error) {
      // The job stays queued; the next tick or the owner's page picks it up.
      console.error(`[renders] pass after enqueue failed for ${outcome.id}`, error);
    }
  });

  return json({ ok: true, id: outcome.id, href: renderHref(outcome.id), held: false }, 201);
}
