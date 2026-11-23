import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import {
  BillingRequestDialog,
  BillingRequestForm,
} from '@/components/brand-billing/billing-request-form';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' } as Viewer,
  deliveryCalls: [] as Array<{ sourceKind: string; sourceId: string }>,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer }));
vi.mock('@/lib/brands/team-notice-outbox', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brands/team-notice-outbox')>(
    '@/lib/brands/team-notice-outbox',
  );
  return {
    ...actual,
    runLiveTeamNoticeDeliveryPass: vi.fn(
      async (_sql: SqlRunner, opts?: { sourceKind?: string; sourceId?: string }) => {
        if (opts?.sourceKind && opts?.sourceId) {
          mocks.deliveryCalls.push({ sourceKind: opts.sourceKind, sourceId: opts.sourceId });
        }
        return { available: true, attempted: 1, sent: 1, failed: 0 };
      },
    ),
  };
});

const requestPost = await import('@/app/api/brand-billing/request/route');
const sandboxedOrgId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

function makeReq(body: unknown, origin = 'http://localhost'): NextRequest {
  return new NextRequest('http://localhost/api/brand-billing/request', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      origin,
      'sec-fetch-site': origin === 'http://localhost' ? 'same-origin' : 'cross-site',
    },
    body: JSON.stringify(body),
  });
}

let f: StudioFixture;

beforeEach(async () => {
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  mocks.deliveryCalls = [];
});

afterEach(async () => {
  await f.db.close();
});

describe('POST /api/brand-billing/request and Request Form UI', () => {
  it('registers POST /api/brand-billing/request in brand surface routing', () => {
    expect(brandRouteAllowed('/api/brand-billing/request', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-billing/request', 'GET')).toBe(false);
    expect(brandRouteAllowed('/brand/billing', 'GET')).toBe(true);
  });

  it('inserts 1 support message + 1 team notice (plan_request / allowance_request) with admin_path, triggers live pass, and is idempotent', async () => {
    const r1 = await requestPost.POST(
      makeReq({
        organizationId: f.orgId,
        intent: 'plan_request',
        desiredPlan: 'b2b_49',
        note: '월 30컷 제품 화보 제작 희망',
        contactPreference: 'workspace',
        surface: 'billing_page',
        requestId: randomUUID(),
      }),
    );
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as { ok: boolean; id: string; noticeKind: string };
    expect(j1.ok).toBe(true);
    expect(j1.noticeKind).toBe('plan_request');

    const msgs1 = await f.sql.query<{ id: string; body: string; author_role: string }>(
      'select id, body, author_role from brand_support_messages where organization_id = $1',
      [f.orgId],
    );
    expect(msgs1.rows).toHaveLength(1);
    expect(msgs1.rows[0]!.author_role).toBe('brand');
    expect(msgs1.rows[0]!.body).toContain('[이용 신청]');
    expect(msgs1.rows[0]!.body).toContain('49 플랜');

    const outbox1 = await f.sql.query<{ kind: string; admin_path: string; source_id: string }>(
      "select kind, admin_path, source_id from team_notice_deliveries where organization_id = $1 and kind in ('plan_request','allowance_request')",
      [f.orgId],
    );
    expect(outbox1.rows).toHaveLength(1);
    expect(outbox1.rows[0]!).toEqual({
      kind: 'plan_request',
      admin_path: `/admin/brand-workspace/organizations/${f.orgId}`,
      source_id: j1.id,
    });
    expect(mocks.deliveryCalls).toEqual([{ sourceKind: 'plan_request', sourceId: j1.id }]);

    // Allowance request from studio -> allowance_request notice kind + single row + idempotent retry
    const reqId2 = randomUUID();
    const r2 = await requestPost.POST(
      makeReq({
        organizationId: f.orgId,
        intent: 'allowance_request',
        note: '이번 달 영상 추가 필요',
        contactPreference: 'email',
        neededCredits: 120,
        remainingCredits: 15,
        surface: 'studio_video',
        requestId: reqId2,
      }),
    );
    expect(r2.status).toBe(200);
    const j2 = (await r2.json()) as { ok: boolean; id: string; noticeKind: string };
    expect(j2.noticeKind).toBe('allowance_request');

    const r2Retry = await requestPost.POST(
      makeReq({
        organizationId: f.orgId,
        intent: 'allowance_request',
        note: '이번 달 영상 추가 필요',
        contactPreference: 'email',
        requestId: reqId2,
      }),
    );
    expect(r2Retry.status).toBe(200);
    const j2Retry = (await r2Retry.json()) as { ok: boolean; id: string };
    expect(j2Retry.id).toBe(j2.id);

    const outboxAll = await f.sql.query<{ kind: string; admin_path: string }>(
      "select kind, admin_path from team_notice_deliveries where organization_id = $1 and kind in ('plan_request','allowance_request') order by created_at",
      [f.orgId],
    );
    expect(outboxAll.rows).toHaveLength(2);
    expect(outboxAll.rows[1]!).toEqual({
      kind: 'allowance_request',
      admin_path: `/admin/brand-workspace/organizations/${f.orgId}`,
    });
  });

  it('enforces auth boundaries (401/403/404) and DB-backed 5-per-hour org rate limit', async () => {
    // Unauthenticated -> 401
    mocks.viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' };
    const unauthRes = await requestPost.POST(
      makeReq({ organizationId: f.orgId, intent: 'plan_request', requestId: randomUUID() }),
    );
    expect(unauthRes.status).toBe(401);

    // Outsider -> 404
    mocks.viewer = viewerOf(f.ids.outsider);
    const outsiderRes = await requestPost.POST(
      makeReq({ organizationId: f.orgId, intent: 'plan_request', requestId: randomUUID() }),
    );
    expect(outsiderRes.status).toBe(404);

    // Sandboxed org -> 404
    mocks.viewer = viewerOf(f.ids.owner);
    await f.sql.query(
      "insert into brand_organizations (id, name, created_by, request_id) values ($1, 'Demo', $2, $3) on conflict (id) do nothing",
      [sandboxedOrgId, f.ids.owner, randomUUID()],
    );
    await f.sql.query(
      "insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active') on conflict do nothing",
      [sandboxedOrgId, f.ids.owner],
    );
    const sandboxedRes = await requestPost.POST(
      makeReq({
        organizationId: sandboxedOrgId,
        intent: 'plan_request',
        requestId: randomUUID(),
      }),
    );
    expect(sandboxedRes.status).toBe(404);

    // Viewer member -> 403
    mocks.viewer = viewerOf(f.ids.viewer);
    const viewerRes = await requestPost.POST(
      makeReq({ organizationId: f.orgId, intent: 'plan_question', requestId: randomUUID() }),
    );
    expect(viewerRes.status).toBe(403);

    // Studio non-member staff -> 403
    mocks.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    const staffRes = await requestPost.POST(
      makeReq({ organizationId: f.orgId, intent: 'plan_question', requestId: randomUUID() }),
    );
    expect(staffRes.status).toBe(403);

    // DB-backed 5/hour org limit (owner + editor share the same org cap)
    mocks.viewer = viewerOf(f.ids.owner);
    for (let i = 0; i < 5; i += 1) {
      if (i === 4) mocks.viewer = viewerOf(f.ids.editor);
      const okRes = await requestPost.POST(
        makeReq({
          organizationId: f.orgId,
          intent: i % 2 === 0 ? 'plan_request' : 'allowance_request',
          note: `request-${i}`,
          requestId: randomUUID(),
        }),
      );
      expect(okRes.status).toBe(200);
    }

    const sixthRes = await requestPost.POST(
      makeReq({
        organizationId: f.orgId,
        intent: 'plan_question',
        note: 'sixth request blocked',
        requestId: randomUUID(),
      }),
    );
    expect(sixthRes.status).toBe(429);
    const sixthJson = (await sixthRes.json()) as { ok: boolean; code: string };
    expect(sixthJson).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('renders Request Form without native select, SLA time promises, or contact preference pills, linking to #billing-profile', () => {
    const dict = getDictionary('ko');
    const c = dict.brandBilling.customer;
    const html = renderToStaticMarkup(
      <BillingRequestDialog
        open
        onClose={() => {}}
        organizationId={f.orgId}
        copy={c.requestForm}
        tierNames={c.planSection.tierNames}
        planCatalogue={[
          { id: 'b2b_29', monthlyKrw: 290_000, rank: 1 },
          { id: 'b2b_49', monthlyKrw: 490_000, rank: 2 },
          { id: 'b2b_69', monthlyKrw: 690_000, rank: 3 },
        ]}
        locale="ko"
        initialIntent="plan_request"
        profileCompleteness={{ filled: 3, total: 7, complete: false }}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('<select');
    expect(html).toContain('#billing-profile');
    expect(html).toContain('4개 항목');
    expect(html).toContain('이용 신청');
    expect(html).toContain('추가 크레딧 요청');
    expect(html).toContain('플랜 문의');
    expect(html).toContain('부가세 별도');
    expect(html).not.toContain('preferredContact');
    expect(html).not.toMatch(/Slack|슬랙|webhook|1시간|24시간|선호 연락/);

    const allowanceModalHtml = renderToStaticMarkup(
      <BillingRequestDialog
        open
        onClose={() => {}}
        organizationId={f.orgId}
        copy={c.requestForm}
        tierNames={c.planSection.tierNames}
        planCatalogue={[
          { id: 'b2b_29', monthlyKrw: 290_000, rank: 1 },
          { id: 'b2b_49', monthlyKrw: 490_000, rank: 2 },
          { id: 'b2b_69', monthlyKrw: 690_000, rank: 3 },
        ]}
        locale="ko"
        initialIntent="allowance_request"
        allowIntentSwitch={false}
      />,
    );
    expect(allowanceModalHtml).not.toMatch(/Slack|슬랙|webhook|1시간|24시간|원|₩|KRW/);

    const completeFormHtml = renderToStaticMarkup(
      <BillingRequestForm
        organizationId={f.orgId}
        copy={c.requestForm}
        tierNames={c.planSection.tierNames}
        planCatalogue={[
          { id: 'b2b_29', monthlyKrw: 290_000, rank: 1 },
          { id: 'b2b_49', monthlyKrw: 490_000, rank: 2 },
          { id: 'b2b_69', monthlyKrw: 690_000, rank: 3 },
        ]}
        locale="ko"
        profileCompleteness={{ filled: 7, total: 7, complete: true }}
      />,
    );
    expect(completeFormHtml).toContain(c.requestForm.profileStatusComplete);
    expect(completeFormHtml).not.toContain('<select');
  });

  it('F5 & F8: enforces same-origin CSRF (403), body cap (413), and stores English request message using BRAND_PLANS pricing when caller locale is en', async () => {
    // 1) Cross-origin CSRF -> 403
    const crossOrigin = await requestPost.POST(
      makeReq(
        {
          organizationId: f.orgId,
          intent: 'plan_request',
          requestId: randomUUID(),
        },
        'https://evil.example',
      ),
    );
    expect(crossOrigin.status).toBe(403);

    // 2) Oversized body -> 413
    const huge = await requestPost.POST(
      new NextRequest('http://localhost/api/brand-billing/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'localhost',
          origin: 'http://localhost',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          organizationId: f.orgId,
          intent: 'plan_request',
          note: 'x'.repeat(10_000),
          requestId: randomUUID(),
        }),
      }),
    );
    expect(huge.status).toBe(413);

    // 3) English locale writes English body with BRAND_PLANS price
    mocks.viewer = { ...viewerOf(f.ids.owner), locale: 'en' };
    const enRes = await requestPost.POST(
      makeReq({
        organizationId: f.orgId,
        intent: 'plan_request',
        desiredPlan: 'b2b_49',
        note: 'Launching 40 product shots',
        requestId: randomUUID(),
      }),
    );
    expect(enRes.status).toBe(200);
    const msgs = await f.sql.query<{ body: string }>(
      'select body from brand_support_messages where organization_id = $1',
      [f.orgId],
    );
    expect(msgs.rows[0]!.body).toContain('[Plan Request]');
    expect(msgs.rows[0]!.body).toContain('KRW 490,000');
    expect(msgs.rows[0]!.body).not.toContain('[이용 신청]');
  });

  it('F11 & F12: dialog traps focus, closes & restores focus on Esc, submits request, and regenerates requestId after editing following an error', async () => {
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const dict = getDictionary('ko');
    const c = dict.brandBilling.customer;
    const onClose = vi.fn();

    const trigger = globalThis.document?.createElement('button') ?? null;
    void trigger;

    let calls = 0;
    const payloads: Array<{ intent: string; desiredPlan?: string; note?: string; requestId: string }> = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? '{}'));
      payloads.push(body);
      if (calls === 1) {
        return { ok: false, status: 500, json: async () => ({ ok: false, code: 'unavailable' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, id: 'm-1', noticeKind: 'plan_request' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const dom = await mountDom(
      <BillingRequestDialog
        open
        onClose={onClose}
        organizationId={f.orgId}
        copy={c.requestForm}
        tierNames={c.planSection.tierNames}
        planCatalogue={[
          { id: 'b2b_29', monthlyKrw: 290_000, rank: 1 },
          { id: 'b2b_49', monthlyKrw: 490_000, rank: 2 },
          { id: 'b2b_69', monthlyKrw: 690_000, rank: 3 },
        ]}
        locale="ko"
        initialIntent="plan_request"
      />,
    );

    try {
      const dialog = dom.query('[role="dialog"]');
      expect(dialog).toBeTruthy();
      expect(dialog!.contains(dom.document.activeElement)).toBe(true);

      // Submit #1 -> server 500
      await dom.setValue('textarea', '첫 번째 메모');
      await dom.submit('[data-billing-request-form] form, [data-billing-request-form]');
      expect(calls).toBe(1);
      expect(payloads[0]).not.toHaveProperty('contactPreference');

      // Edit note after error -> Submit #2 must send a DIFFERENT requestId!
      await dom.setValue('textarea', '수정한 두 번째 메모');
      await dom.submit('[data-billing-request-form]');
      expect(calls).toBe(2);
      expect(payloads[1]!.requestId).not.toBe(payloads[0]!.requestId);

      // Escape closes modal
      await dom.keyDown('Escape', { target: dialog! });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      await dom.unmount();
    }
  });

  it('Round 2 (4): uses non-speed workspaceReplyNote, dictionary request headers/labels, and intent-accurate team notice label for plan_question', async () => {
    const { formatTeamNoticeSlackText } = await import('@/lib/brands/team-notice-outbox');
    const { formatBillingRequestBody } = await import('@/lib/brands/billing-request');
    const dictKo = getDictionary('ko');
    const dictEn = getDictionary('en');

    // No speed words in workspaceReplyNote
    expect(dictKo.brandBilling.customer.requestForm.workspaceReplyNote).not.toMatch(/바로|즉시/);
    expect(dictEn.brandBilling.customer.requestForm.workspaceReplyNote).not.toMatch(/immediately|right away|directly/i);

    // Dictionary requestThread holds request headers & labels (no inline English/Korean branches)
    const threadKo = (dictKo.brandBilling as { requestThread?: Record<string, unknown> }).requestThread;
    const threadEn = (dictEn.brandBilling as { requestThread?: Record<string, unknown> }).requestThread;
    expect(threadKo).toBeDefined();
    expect(threadEn).toBeDefined();

    const bodyKo = formatBillingRequestBody(
      {
        organizationId: f.orgId,
        intent: 'plan_question',
        desiredPlan: 'b2b_29',
        neededCredits: 12,
        remainingCredits: 5,
        note: '세금계산서 발급일 문의',
        requestId: randomUUID(),
      },
      'ko',
    );
    expect(bodyKo).toContain('[플랜 문의]');

    // Team-channel notice label matches plan_question vs plan_request
    const questionSlack = formatTeamNoticeSlackText({
      kind: 'plan_request',
      organizationName: 'Atelier Monet',
      actorDisplayName: 'Owner',
      surface: 'billing:plan_question:studio_image',
      preview: bodyKo,
      adminPath: `/admin/brand-workspace/organizations/${f.orgId}`,
      transport: 'webhook',
    });
    expect(questionSlack).toContain('B2B 플랜 문의');
    expect(questionSlack).not.toContain('B2B 플랜 요청');

    const requestSlack = formatTeamNoticeSlackText({
      kind: 'plan_request',
      organizationName: 'Atelier Monet',
      actorDisplayName: 'Owner',
      surface: 'billing:plan_request:studio_image',
      preview: '[이용 신청]',
      adminPath: `/admin/brand-workspace/organizations/${f.orgId}`,
      transport: 'webhook',
    });
    expect(requestSlack).toContain('B2B 플랜 요청');
  });
});
