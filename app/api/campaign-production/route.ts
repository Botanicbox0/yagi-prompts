import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { createCampaignRenderJob } from '@/lib/renders/service';
import { getRenderStore } from '@/lib/renders/store';
import { getStorage } from '@/lib/storage';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { renderHref } from '@/lib/renders/share';
import { identityVerifyHref } from '@/lib/identity/links';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const FIELDS = new Set(['applicationId', 'requestId', 'locale', 'portraitId', 'photo', 'ownFaceConsent']);
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: HEADERS });
function campaignFailure(code: string) {
  return json({ ok: false, code }, code === 'sign_in_required' ? 401 : code === 'not_found' ? 404 : code === 'unavailable' ? 503 : code === 'photo_too_large' ? 413 : code === 'rate_limited' ? 429 : ['forbidden', 'not_open', 'not_selected', 'contract_inactive'].includes(code) ? 403 : ['conflict', 'quota_exhausted', 'generation_used'].includes(code) ? 409 : 400);
}
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return campaignFailure('forbidden');
  const viewer = await getViewer(); if (!viewer.userId) return campaignFailure('sign_in_required');
  try {
    const sql = await getSqlRunner(); if (!sql) return campaignFailure('unavailable');
    const bytes = await readBoundedBody(request, 4_000_000); if (!bytes) return campaignFailure('photo_too_large');
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data;')) return campaignFailure('invalid');
    let form: FormData;
    try { form = await new Response(bytes as BodyInit, { headers: { 'Content-Type': contentType } }).formData(); } catch { return campaignFailure('invalid'); }
    if ([...form.keys()].some(k => !FIELDS.has(k)) || [...FIELDS].some(k => form.getAll(k).length > 1) || [...FIELDS].filter(k => k !== 'photo').some(k => form.has(k) && typeof form.get(k) !== 'string')) return campaignFailure('invalid');
    const photo = form.get('photo'); if (photo !== null && !(photo instanceof File)) return campaignFailure('bad_photo');
    const result = await createCampaignRenderJob({ sql, store: await getRenderStore(), referenceStorage: await getStorage() }, viewer, {
      applicationId: String(form.get('applicationId') ?? ''), requestId: String(form.get('requestId') ?? ''), locale: String(form.get('locale') ?? ''), ownFaceConsent: form.get('ownFaceConsent') === '1', portraitId: String(form.get('portraitId') ?? '') || undefined,
      photo: photo instanceof File ? { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type } : null,
    });
    if (!result.ok) return campaignFailure(result.code);
    if (!result.held) after(async () => { try { await runLiveRenderPass(sql, { jobId: result.id, limit: 1 }); } catch { /* The durable queue is picked up by owner polling or a later worker. */ } });
    const href = renderHref(result.id);
    return json({ ok: true, id: result.id, href, held: result.held, ...(result.held ? { verifyHref: identityVerifyHref(href) } : {}) }, 201);
  } catch { return campaignFailure('unavailable'); }
}
