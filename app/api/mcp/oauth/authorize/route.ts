import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { NONCE_HEADER } from '@/lib/security/workspace-csp';
import { requireCreate, StudioDenied, studioSeat, type StudioSeat } from '@/lib/brand-studio/access';
import { STUDIO_HEADERS } from '@/lib/brand-studio/http';
import { issueMcpAuthorizationCode, verifyMcpClientAndRedirect } from '@/lib/brand-studio/mcp';

/**
 * OAuth 2.1 browser authorization & consent screen (`/api/mcp/oauth/authorize`).
 *
 * Security & Morphic sandbox hardline:
 * - Requires `brandStudioV2Open()` (`404` when closed).
 * - Verifies `studioSeat(sql, viewer.userId, orgId, { requireSelfStudio: true })` + `requireCreate`:
 *   Morphic/sandboxed organizations (`d425c3b1...`, `deb648e9...`, `Morphic`/`모픽`) and
 *   `generative_media`-denied organizations ALWAYS receive `404`.
 */
export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function callbackDestinationLabel(redirectUri: string): string {
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
    return `${parsed.protocol}//${parsed.host || parsed.pathname}`.slice(0, 80);
  } catch {
    return redirectUri.slice(0, 80);
  }
}

function respondOAuthCallbackRedirect(request: NextRequest, target: URL, isEn: boolean): NextResponse {
  // Browser `<form method="post">` navigations on `brand.twings.app` carry `form-action 'self'` CSP,
  // which blocks cross-origin 302 redirects in Chromium. Completing the POST with a same-origin 200 HTML
  // handoff page navigates top-level cleanly under strict CSP while keeping 302 for non-document callers.
  if (request.headers.get('sec-fetch-dest') === 'document') {
    const href = target.toString();
    const escapedHref = escapeHtml(href);
    const nonce = request.headers.get(NONCE_HEADER)?.trim() || '';
    const scriptTag = nonce
      ? `<script nonce="${escapeHtml(nonce)}">window.location.replace(${JSON.stringify(href)});</script>`
      : '';
    const html = `<!doctype html>
<html lang="${isEn ? 'en' : 'ko'}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0;url=${escapedHref}" />
  <title>${isEn ? 'Redirecting…' : '연결 마무리 중…'}</title>
  <style>
    body { margin: 0; background: #FFFFFF; color: #09090B; font-family: 'Pretendard Variable', 'Geist', -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
    a { display: inline-flex; align-items: center; justify-content: center; height: 42px; padding: 0 18px; border-radius: 12px; background: #09090B; color: #FFFFFF; text-decoration: none; font-size: 14px; font-weight: 600; }
  </style>
</head>
<body>
  <main data-mcp-oauth-handoff>
    <a href="${escapedHref}">${isEn ? 'Continue to AI app' : 'AI 앱으로 돌아가기'}</a>
  </main>
  ${scriptTag}
</body>
</html>`;
    return new NextResponse(html, {
      status: 200,
      headers: {
        ...STUDIO_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'x-oauth-redirect-to': href,
      },
    });
  }
  return NextResponse.redirect(target, 302);
}

async function eligibleSeatsForUser(
  sql: SqlRunner,
  userId: string,
  explicitOrgId?: string | null,
): Promise<{ status: 'ok'; seats: StudioSeat[] } | { status: 'forbidden' } | { status: 'not_found' }> {
  if (explicitOrgId) {
    try {
      const seat = await studioSeat(sql, userId, explicitOrgId, { requireSelfStudio: true, requireAgentAccess: true });
      requireCreate(seat);
      return { status: 'ok', seats: [seat] };
    } catch (error) {
      if (error instanceof StudioDenied && error.code === 'forbidden') return { status: 'forbidden' };
      return { status: 'not_found' };
    }
  }

  const memberships = (
    await sql.query<{ organization_id: string }>(
      "select organization_id from brand_memberships where user_id = $1 and status = 'active' order by created_at asc",
      [userId],
    )
  ).rows;
  if (memberships.length === 0) return { status: 'not_found' };

  const seats: StudioSeat[] = [];
  let sawForbidden = false;
  for (const m of memberships) {
    try {
      const seat = await studioSeat(sql, userId, m.organization_id, { requireSelfStudio: true, requireAgentAccess: true });
      if (seat.canCreate) seats.push(seat);
      else sawForbidden = true;
    } catch (error) {
      if (error instanceof StudioDenied && error.code === 'forbidden') sawForbidden = true;
    }
  }
  if (seats.length > 0) return { status: 'ok', seats };
  return sawForbidden ? { status: 'forbidden' } : { status: 'not_found' };
}

function validateOAuthAuthorizeParams(params: {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}): { ok: true; clientName: string } | { ok: false; error: string } {
  if (params.responseType !== 'code') return { ok: false, error: 'unsupported_response_type' };
  if (params.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(params.codeChallenge)) {
    return { ok: false, error: 'invalid_request' };
  }
  return verifyMcpClientAndRedirect(params.clientId, params.redirectUri);
}

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: STUDIO_HEADERS });
  }
  const viewer = await getViewer();
  if (!viewer.userId) {
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const signInUrl = new URL('/auth/choose', request.url);
    signInUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(signInUrl, 302);
  }

  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'provider_unavailable' }, { status: 503, headers: STUDIO_HEADERS });
  }

  const reqUrl = new URL(request.url);
  const sp = reqUrl.searchParams;
  const explicitOrgId = sp.get('organizationId')?.trim() || null;
  const seatOutcome = await eligibleSeatsForUser(sql, viewer.userId, explicitOrgId);
  if (seatOutcome.status !== 'ok') {
    const status = seatOutcome.status === 'forbidden' ? 403 : 404;
    return NextResponse.json({ ok: false, code: seatOutcome.status }, { status, headers: STUDIO_HEADERS });
  }

  const clientId = sp.get('client_id') ?? '';
  const redirectUri = sp.get('redirect_uri') ?? '';
  const responseType = sp.get('response_type') ?? 'code';
  const codeChallenge = sp.get('code_challenge') ?? '';
  const codeChallengeMethod = sp.get('code_challenge_method') ?? 'S256';
  const state = sp.get('state') ?? '';

  const checked = validateOAuthAuthorizeParams({
    clientId,
    redirectUri,
    responseType,
    codeChallenge,
    codeChallengeMethod,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400, headers: STUDIO_HEADERS });
  }

  const isEn = viewer.locale === 'en';
  const orgOptions = seatOutcome.seats
    .map(
      (s) =>
        `<option value="${escapeHtml(s.organizationId)}">${escapeHtml(s.organizationName)}</option>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="${isEn ? 'en' : 'ko'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${isEn ? 'Connect TWINGS MCP' : 'TWINGS 스튜디오 MCP 연결 승인'}</title>
  <style>
    body { margin: 0; background: #FFFFFF; color: #09090B; font-family: 'Pretendard Variable', 'Geist', -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
    .card { width: 100%; max-width: 440px; background: #F4F4F5; border-radius: 20px; padding: 28px; box-sizing: border-box; }
    .eyebrow { font-size: 12px; font-weight: 600; color: #71717A; margin: 0 0 8px; letter-spacing: 0.04em; text-transform: uppercase; }
    h1 { font-size: 20px; line-height: 1.35; margin: 0 0 10px; font-weight: 700; }
    p { font-size: 14px; line-height: 1.55; color: #52525B; margin: 0 0 20px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #09090B; margin-bottom: 6px; }
    select { width: 100%; height: 42px; border-radius: 12px; border: 0; background: #FFFFFF; color: #09090B; padding: 0 12px; font-size: 14px; margin-bottom: 18px; }
    .perms { background: #FFFFFF; border-radius: 14px; padding: 14px 16px; margin-bottom: 22px; font-size: 13px; color: #52525B; line-height: 1.6; }
    .actions { display: flex; gap: 10px; }
    button { flex: 1; height: 44px; border: 0; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .approve { background: #0033FF; color: #FFFFFF; }
    .deny { background: #FFFFFF; color: #09090B; }
  </style>
</head>
<body>
  <main class="card" data-mcp-oauth-consent>
    <p class="eyebrow">TWINGS STUDIO MCP</p>
    <h1>${escapeHtml(checked.clientName)} ${isEn ? 'wants to connect' : '연결을 허용할까요?'}</h1>
    <p>${
      isEn
        ? 'Allow this AI client to list brand assets, run workflows such as Character Sheet Maker, and update team guides using your workspace credit balance.'
        : '선택한 브랜드 워크스페이스의 에셋 조회, 캐릭터 시트 등 워크플로우 실행, 팀 가이드 편집 권한을 연결합니다.'
    }</p>
    <form method="post" action="/api/mcp/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="response_type" value="code" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="S256" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <label for="org">${isEn ? 'Workspace' : '연결할 워크스페이스'}</label>
      <select id="org" name="organizationId">${orgOptions}</select>
      <div class="perms">
        <div style="margin-bottom:6px;color:#09090B;font-weight:600;">
          ${isEn ? 'Callback destination:' : '연결 정보를 받는 곳:'} <code>${escapeHtml(callbackDestinationLabel(redirectUri))}</code>
        </div>
        ${
          isEn
            ? 'Uses your regular workspace studio credits with no daily token cap. You can revoke this connection anytime in Workflows → Connect MCP.'
            : '별도 일일 제한 없이 조직 스튜디오 크레딧 한도 내에서 동작하며, 워크플로우 화면의 MCP 연결하기에서 언제든 폐기할 수 있습니다.'
        }
      </div>
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="deny">${isEn ? 'Cancel' : '취소'}</button>
        <button type="submit" name="decision" value="approve" class="approve">${isEn ? 'Approve & Connect' : '승인 및 연결'}</button>
      </div>
    </form>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      ...STUDIO_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return NextResponse.json({ ok: false, code: 'forbidden' }, { status: 403, headers: STUDIO_HEADERS });
  }
  if (!brandStudioV2Open()) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: STUDIO_HEADERS });
  }
  const viewer = await getViewer();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, code: 'sign_in_required' }, { status: 401, headers: STUDIO_HEADERS });
  }
  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'provider_unavailable' }, { status: 503, headers: STUDIO_HEADERS });
  }

  let fields: Record<string, string> = {};
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const json = (await request.json()) as Record<string, unknown>;
      for (const [k, val] of Object.entries(json)) {
        if (typeof val === 'string') fields[k] = val;
      }
    } else if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      form.forEach((val, key) => {
        if (typeof val === 'string') fields[key] = val;
      });
    } else {
      const sp = new URLSearchParams(await request.text());
      sp.forEach((val, key) => {
        fields[key] = val;
      });
    }
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: STUDIO_HEADERS });
  }

  const organizationId = fields.organizationId?.trim() || null;
  const seatOutcome = await eligibleSeatsForUser(sql, viewer.userId, organizationId);
  if (seatOutcome.status !== 'ok') {
    const status = seatOutcome.status === 'forbidden' ? 403 : 404;
    return NextResponse.json({ ok: false, code: seatOutcome.status }, { status, headers: STUDIO_HEADERS });
  }

  const clientId = fields.client_id ?? '';
  const redirectUri = fields.redirect_uri ?? '';
  const responseType = fields.response_type ?? 'code';
  const codeChallenge = fields.code_challenge ?? '';
  const codeChallengeMethod = fields.code_challenge_method ?? 'S256';
  const state = fields.state ?? '';
  const decision = fields.decision ?? 'approve';

  const checked = validateOAuthAuthorizeParams({
    clientId,
    redirectUri,
    responseType,
    codeChallenge,
    codeChallengeMethod,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400, headers: STUDIO_HEADERS });
  }

  const isEn = viewer.locale === 'en';
  const target = new URL(redirectUri);
  if (decision !== 'approve') {
    target.searchParams.set('error', 'access_denied');
    if (state) target.searchParams.set('state', state);
    return respondOAuthCallbackRedirect(request, target, isEn);
  }

  const chosenSeat = seatOutcome.seats[0]!;
  const code = issueMcpAuthorizationCode({
    userId: chosenSeat.userId,
    organizationId: chosenSeat.organizationId,
    clientId,
    clientName: checked.clientName,
    redirectUri,
    codeChallenge,
  });

  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);
  return respondOAuthCallbackRedirect(request, target, isEn);
}
