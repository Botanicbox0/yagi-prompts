import { after } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSubscriptionContext, premiumEditingOperational } from '@/lib/creator-subscriptions/runtime';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { MAX_SUBSCRIPTION_FORM_BYTES, readBoundedBody, subscriptionFailure, subscriptionJson } from '@/lib/creator-subscriptions/http';
import { createSubscriptionRenderJob } from '@/lib/renders/service';
import { getRenderStore } from '@/lib/renders/store';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { renderHref } from '@/lib/renders/share';
import { identityVerifyHref } from '@/lib/identity/links';
import { isStoreRequest } from '@/lib/mobile/store-bridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const FIELDS = new Set(['requestId', 'template', 'locale', 'ownFaceConsent', 'selfieId', 'photo', 'editText', 'references', 'referencesConsent']);

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return subscriptionFailure('forbidden');
  if (isStoreRequest(request.headers)) return subscriptionFailure('store_companion');
  const viewer = await getViewer();
  if (!viewer.userId) return subscriptionFailure('sign_in_required');
  try {
    const deps = await getSubscriptionContext();
    if (!deps) return subscriptionFailure('unavailable');
    if (deps.environment === 'test' && !subscriptionQaAllowed(viewer)) return subscriptionFailure('forbidden');
    const body = await readBoundedBody(request, MAX_SUBSCRIPTION_FORM_BYTES);
    if (!body) return subscriptionJson({ ok: false, code: 'references_too_large' }, 413);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data;')) return subscriptionFailure('bad_request');
    let form: FormData;
    try { form = await new Response(body as BodyInit, { headers: { 'Content-Type': contentType } }).formData(); }
    catch { return subscriptionFailure('bad_request'); }
    if ([...form.keys()].some(key => !FIELDS.has(key)) || [...FIELDS].some(key => key !== 'references' && form.getAll(key).length > 1)) return subscriptionFailure('bad_request');
    if (form.get('ownFaceConsent') !== '1') return subscriptionFailure('consent_required');
    const photos = form.get('photo');
    const rawReferences = form.getAll('references');
    if (rawReferences.length > 3) return subscriptionFailure('too_many_references');
    if (rawReferences.some(reference => !(reference instanceof File))) return subscriptionFailure('bad_reference');
    const rawEdit = form.get('editText');
    if (rawEdit !== null && typeof rawEdit !== 'string') return subscriptionFailure('bad_edit');
    const editText = typeof rawEdit === 'string' ? rawEdit : undefined;
    if ((editText?.trim() || rawReferences.length) && !await premiumEditingOperational(deps.sql, deps.environment)) return subscriptionFailure('editing_unavailable');
    const selfie = form.get('selfieId');
    const outcome = await createSubscriptionRenderJob({ sql: deps.sql, environment: deps.environment, store: await getRenderStore() }, viewer, {
      requestId: String(form.get('requestId') ?? ''), templateSlug: String(form.get('template') ?? ''),
      ownFaceConsent: true, locale: String(form.get('locale') ?? ''),
      selfieId: typeof selfie === 'string' && selfie ? selfie : undefined,
      photo: photos instanceof File ? { bytes: new Uint8Array(await photos.arrayBuffer()), mime: photos.type } : null,
      editText, references: await Promise.all(rawReferences.map(async reference => ({ bytes: new Uint8Array(await (reference as File).arrayBuffer()), mime: (reference as File).type }))),
      referencesConsent: form.get('referencesConsent') === '1',
    });
    if (!outcome.ok) return subscriptionFailure(outcome.code);
    if (outcome.held) return subscriptionJson({ ok: true, id: outcome.id, href: renderHref(outcome.id), held: true, verifyHref: identityVerifyHref(renderHref(outcome.id)) }, 201);
    after(async () => {
      try { await runLiveRenderPass(deps.sql, { jobId: outcome.id, limit: 1 }); }
      catch { /* The owned job remains queued for the authenticated polling/worker path. */ }
    });
    return subscriptionJson({ ok: true, id: outcome.id, href: renderHref(outcome.id), held: false }, 201);
  } catch { return subscriptionFailure('unavailable'); }
}
