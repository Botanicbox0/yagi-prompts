import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isLocale } from '@/lib/i18n/config';
import { savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { identityVerifyHref } from '@/lib/identity/links';
import { detectStorePlatformFromRequest, isNativeStoreApp } from '@/lib/mobile/store-bridge';
import { castFormPhotos } from '@/lib/renders/cast-form';
import { recordAdultAnswerFromForm } from '@/lib/account/adult-confirmation';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import {
  createStoreIapRenderJob,
  type CreateStoreIapRenderFailure,
} from '@/lib/renders/service';
import { renderHref } from '@/lib/renders/share';
import { getRenderStore } from '@/lib/renders/store';
import { parseDirectorSpecInput } from '@/lib/template-director/schema';
import { parseSelectedFrames } from '@/lib/twings/selective-frames';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const STATUS: Record<CreateStoreIapRenderFailure, number> = {
  sign_in_required: 401,
  not_open: 403,
  not_found: 404,
  not_for_sale: 409,
  bad_aspect: 400,
  bad_resolution: 400,
  bad_photo: 400,
  bad_request: 400,
  photo_too_large: 413,
  rate_limited: 429,
  identity_required: 403,
  slot_missing: 400,
  bad_slot_photo: 400,
  partner_consent_required: 400,
  not_a_pet: 400,
  pet_check_unavailable: 503,
  // docs/PERSONAL-STUDIO.md §6.1–6.2 — only while the Sunra face switch is on; refused before any credit is spent.
  adult_confirmation_required: 400,
  adult_only: 403,
  adult_check_unavailable: 503,
  partner_not_one_person: 400,
  partner_unclear: 400,
  partner_minor: 400,
  partner_screen: 400,
  partner_check_unavailable: 503,
  insufficient_credits: 402,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  const platform = detectStorePlatformFromRequest(request);
  if (!isNativeStoreApp(platform)) {
    return json({ ok: false, code: 'native_store_only' }, 403);
  }

  const viewer = await getViewer();
  if (viewer.userId === null) {
    return json({ ok: false, code: 'sign_in_required' }, 401);
  }

  const sql = await getSqlRunner();
  if (sql === null) {
    return json({ ok: false, code: 'unavailable' }, 503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, code: 'bad_request' }, 400);
  }

  const photo = form.get('photo');
  const rawLocale = form.get('locale');
  const requestId = String(form.get('requestId') ?? '');
  const store = await getRenderStore();
  const selfieId = String(form.get('selfieId') ?? '');
  const saved =
    !(photo instanceof File) && selfieId
      ? await savedSelfiePhoto(sql, store, viewer.userId, selfieId)
      : null;
  if (selfieId && !saved && !(photo instanceof File)) {
    return json({ ok: false, code: 'selfie_required' }, 400);
  }

  const cast = await castFormPhotos(form);
  const primary =
    saved ??
    (photo instanceof File
      ? { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type }
      : null) ??
    (selfieId ? null : (cast.slots.pet ?? null));
  // docs/PERSONAL-STUDIO.md §6.1 — switch on only: the 19+ answer is stored once, outside the credit
  // transaction (a first failing answer is kept even though that transaction rolls back on the refusal).
  await recordAdultAnswerFromForm(sql, viewer.userId, form);

  const outcome = await createStoreIapRenderJob({ sql, store }, viewer, {
    storePlatform: platform,
    requestId,
    templateSlug: String(form.get('template') ?? ''),
    aspect: String(form.get('aspect') ?? ''),
    photo: primary,
    selfieId: saved ? selfieId : undefined,
    slots: cast.slots,
    partnerConsent: cast.partnerConsent,
    locale: typeof rawLocale === 'string' && isLocale(rawLocale) ? rawLocale : null,
    holdForIdentity: form.get('hold') === '1',
    resolution: typeof form.get('resolution') === 'string' ? String(form.get('resolution')) : null,
    selectedFrames: parseSelectedFrames(form.get('selectedFrames')),
    directorSpec: parseDirectorSpecInput(form.get('directorSpec')),
  });

  if (!outcome.ok) {
    return json(outcome, STATUS[outcome.code]);
  }

  if (outcome.held) {
    return json(
      {
        ok: true,
        id: outcome.id,
        href: renderHref(outcome.id),
        held: true,
        creditsSpent: outcome.creditsSpent,
        balance: outcome.balance,
        verifyHref: identityVerifyHref(renderHref(outcome.id)),
      },
      201,
    );
  }

  after(async () => {
    try {
      await runLiveRenderPass(sql, { jobId: outcome.id, limit: 1 });
    } catch (error) {
      console.error(`[mobile-iap-renders] pass after enqueue failed for ${outcome.id}`, error);
    }
  });

  return json(
    {
      ok: true,
      id: outcome.id,
      href: renderHref(outcome.id),
      held: false,
      creditsSpent: outcome.creditsSpent,
      balance: outcome.balance,
    },
    201,
  );
}
