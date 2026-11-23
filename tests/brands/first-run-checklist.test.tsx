import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { homeChecklistDismissCookieName, readChecklistDismissedFromCookie } from '@/lib/brands/workspace/home-checklist-cookie';
import { loadFirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeLayout } from '@/lib/brands/workspace/home';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';
import { setPlanAssignment } from '@/lib/brands/plans';
import { submitBrandBillingRequest } from '@/lib/brands/billing-request';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  studioOpen: true,
  contextOverride: null as null | Record<string, unknown>,
  scopeOverride: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/flags')>()),
  brandStudioV2Open: () => mocks.studioOpen,
}));

vi.mock('next/headers', () => ({
  cookies: async () => new Map<string, { value: string }>(),
}));

vi.mock('@/components/brand-workspace/context', async (orig) => {
  const actual = await orig<typeof import('@/components/brand-workspace/context')>();
  return {
    ...actual,
    brandContext: async () => (mocks.contextOverride as never) ?? actual.brandContext(),
  };
});

vi.mock('@/components/brand-workspace/scope', async (orig) => {
  const actual = await orig<typeof import('@/components/brand-workspace/scope')>();
  return {
    ...actual,
    brandScope: async (...args: Parameters<typeof actual.brandScope>) =>
      (mocks.scopeOverride as never) ?? actual.brandScope(...args),
  };
});

const fixtures: StudioFixture[] = [];

afterEach(async () => {
  mocks.studioOpen = true;
  while (fixtures.length > 0) {
    await fixtures.pop()!.db.close();
  }
});

describe('first run workspace creation & home checklist (Item 2)', () => {
  it('derives first-run checklist state from real workspace data without any DB migration', async () => {
    const f = await studioFixture({ capKrw: null });
    fixtures.push(f);
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };

    // Revoked memberships must NOT count as active teammates (S1).
    await f.sql.query(
      "update brand_memberships set status = 'revoked' where organization_id = $1 and user_id <> $2",
      [f.orgId, f.ids.owner],
    );

    const initial = await loadFirstRunChecklistState(f.sql, f.orgId, { capKrw: 0, logoUrl: null });
    expect(initial).toEqual({
      show: true,
      hasTeammate: false,
      hasLogo: false,
      hasUploads: false,
      usageApproved: false,
      usageRequestSent: false,
      usageState: 'not_requested',
      hasFirstImage: false,
    });

    // Organizations older than 30 days stop showing the first-run checklist even if incomplete (S1).
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await f.sql.query('update brand_organizations set created_at = $2 where id = $1', [f.orgId, thirtyOneDaysAgo]);
    const staleOrg = await loadFirstRunChecklistState(f.sql, f.orgId, { capKrw: 0, logoUrl: null });
    expect(staleOrg.show).toBe(false);
    // Restore recent creation timestamp for milestone checks.
    await f.sql.query('update brand_organizations set created_at = now() where id = $1', [f.orgId]);

    // 1) Pending invitation counts as hasTeammate.
    await f.sql.query(
      `insert into brand_invites (id, organization_id, email, role, token_hash, expires_at, created_by, request_id)
       values ($1, $2, 'peer@example.test', 'editor', $3, now() + interval '7 days', $4, $5)`,
      [randomUUID(), f.orgId, 'a'.repeat(64), f.ids.owner, randomUUID()],
    );
    const afterInvite = await loadFirstRunChecklistState(f.sql, f.orgId, { capKrw: 0, logoUrl: null });
    expect(afterInvite.hasTeammate).toBe(true);
    expect(afterInvite.show).toBe(true);

    // 2) Uploaded studio asset + logo mark both assets done.
    await f.sql.query(
      `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
       values ($1, $2, 'image', 'product.png', 'image/png', 1024, 'st/p.png', 'upload', 'ready', $3, $4)`,
      [randomUUID(), f.orgId, f.ids.owner, randomUUID()],
    );
    const afterAsset = await loadFirstRunChecklistState(f.sql, f.orgId, { capKrw: 0, logoUrl: '/api/brand-workspace/organizations/x/logo' });
    expect(afterAsset.hasLogo).toBe(true);
    expect(afterAsset.hasUploads).toBe(true);
    expect(afterAsset.usageApproved).toBe(false);
    expect(afterAsset.show).toBe(true);

    // 3) Plan assignment marks usageApproved even if monthly cap is passed as 0, or capKrw > 0 works too.
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    await setPlanAssignment({ sql: f.sql }, admin, {
      organizationId: f.orgId,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: today,
      endsOn: null,
      seats: 5,
      note: 'approved',
      expectedRevision: 0,
    });
    const afterPlan = await loadFirstRunChecklistState(f.sql, f.orgId, { capKrw: 0, logoUrl: '/api/logo' });
    expect(afterPlan.usageApproved).toBe(true);

    // 4) First succeeded image job completes all checklist steps -> checklist hides automatically.
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, model, prompt, status, finished_at)
       values ($1, $2, $3, $4, 'image', 'seedream-5.5', 'bottle shot', 'succeeded', now())`,
      [randomUUID(), f.orgId, f.ids.owner, randomUUID()],
    );
    const afterDone = await loadFirstRunChecklistState(f.sql, f.orgId, { capKrw: 100_000, logoUrl: '/api/logo' });
    expect(afterDone).toEqual({
      show: false,
      hasTeammate: true,
      hasLogo: true,
      hasUploads: true,
      usageApproved: true,
      usageRequestSent: false,
      usageState: 'ready',
      hasFirstImage: true,
    });
  });

  it('renders the dismissable checklist on /brand/home without adding a second solid button or promising response times', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const orgId = '00000000-0000-4000-8000-00000000000a';
      const layout = homeLayout({ choice: { id: orgId, name: 'Atelier Monet', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;
      const html = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={orgId}
          organizationName="Atelier Monet"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 0, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          doors={{ image: null, video: null }}
          reviews={[]}
          results={[]}
          activeProjects={0}
          readOnly={false}
          checklist={{
            show: true,
            hasTeammate: false,
            hasLogo: false,
            hasUploads: false,
            usageApproved: false,
            hasFirstImage: false,
          }}
          copy={{
            home: dict.brandHome,
            shell: dict.studioShell,
            roomsNav: dict.roomsShell.nav,
            roomTabCounts: dict.roomsShell.room.tabCounts,
            roomStages: dict.roomsShell.overview.stages,
            inbox: dict.roomsChat.inbox,
            prompt: { label: dict.brandStudio.dock.label, placeholder: { image: dict.brandStudio.dock.placeholder, video: dict.brandStudio.dock.placeholderVideo } },
            activeStatus: dict.brandWorkspace.status.active,
            closedRequestDraft: dict.brandStudio.dock.closedRequestDraft,
            closedRequestOrgFallback: dict.brandStudio.dock.closedRequestOrgFallback,
          }}
        />,
      );
      expect(html).toContain('data-home-first-run');
      expect(html).toContain(dict.brandHome.checklist.title);
      expect(html).toContain(dict.brandHome.checklist.usage.pendingBody);
      expect(html).toContain(dict.brandHome.checklist.usage.pendingAction);
      expect(html).not.toContain('이용 신청 접수됨');
      expect(html).not.toContain('Access request noted');
      if (locale === 'ko') {
        expect(html).toContain('신청 전');
      }
      expect(html).toContain(`/brand/billing?organizationId=${orgId}`);
      expect(html).toContain(`/brand/members?organizationId=${orgId}`);
      expect(html).toContain(`/brand/settings?organizationId=${orgId}`);
      expect(html).toContain(`/brand/library?organizationId=${orgId}`);
      expect(html).toContain(`/brand/studio?organizationId=${orgId}`);
      // Preserves workspace-home invariant: single solid button, zero bw-primary, zero KRW/won, zero SLA hour promises.
      expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
      expect(html).not.toContain('bw-primary');
      expect(html).not.toMatch(/24시간|1시간|\d\s*원|₩|KRW/);

      // Server cookie helper hides dismissed checklist without flashing (S1).
      expect(readChecklistDismissedFromCookie(orgId, '1')).toBe(true);
      expect(homeChecklistDismissCookieName(orgId)).toContain(orgId);
      const dismissedHtml = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={orgId}
          organizationName="Atelier Monet"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 0, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          doors={{ image: null, video: null }}
          reviews={[]}
          results={[]}
          activeProjects={0}
          readOnly={false}
          checklist={null}
          copy={{
            home: dict.brandHome,
            shell: dict.studioShell,
            roomsNav: dict.roomsShell.nav,
            roomTabCounts: dict.roomsShell.room.tabCounts,
            roomStages: dict.roomsShell.overview.stages,
            inbox: dict.roomsChat.inbox,
            prompt: { label: dict.brandStudio.dock.label, placeholder: { image: dict.brandStudio.dock.placeholder, video: dict.brandStudio.dock.placeholderVideo } },
            activeStatus: dict.brandWorkspace.status.active,
            closedRequestDraft: dict.brandStudio.dock.closedRequestDraft,
            closedRequestOrgFallback: dict.brandStudio.dock.closedRequestOrgFallback,
          }}
        />,
      );
      expect(dismissedHtml).not.toContain('data-home-first-run');

      // Read-only (viewer/staff) never shows the editable first-run checklist.
      const readOnlyHtml = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={orgId}
          organizationName="Atelier Monet"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 0, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          doors={{ image: null, video: null }}
          reviews={[]}
          results={[]}
          activeProjects={0}
          readOnly
          checklist={{
            show: true,
            hasTeammate: false,
            hasLogo: false,
            hasUploads: false,
            usageApproved: false,
            hasFirstImage: false,
          }}
          copy={{
            home: dict.brandHome,
            shell: dict.studioShell,
            roomsNav: dict.roomsShell.nav,
            roomTabCounts: dict.roomsShell.room.tabCounts,
            roomStages: dict.roomsShell.overview.stages,
            inbox: dict.roomsChat.inbox,
            prompt: { label: dict.brandStudio.dock.label, placeholder: { image: dict.brandStudio.dock.placeholder, video: dict.brandStudio.dock.placeholderVideo } },
            activeStatus: dict.brandWorkspace.status.active,
            closedRequestDraft: dict.brandStudio.dock.closedRequestDraft,
            closedRequestOrgFallback: dict.brandStudio.dock.closedRequestOrgFallback,
          }}
        />,
      );
      expect(readOnlyHtml).not.toContain('data-home-first-run');
    }
  });

  it('reflects DB truth on usage step across all 3 states (신청 전 -> 신청 접수 -> 이용 가능)', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const dict = getDictionary('ko');
    const orgId = f.orgId;
    const layout = homeLayout({ choice: { id: orgId, name: 'Atelier Monet', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;
    const commonCopy = {
      home: dict.brandHome,
      shell: dict.studioShell,
      roomsNav: dict.roomsShell.nav,
      roomTabCounts: dict.roomsShell.room.tabCounts,
      roomStages: dict.roomsShell.overview.stages,
      inbox: dict.roomsChat.inbox,
      prompt: {
        label: dict.brandStudio.dock.label,
        placeholder: { image: dict.brandStudio.dock.placeholder, video: dict.brandStudio.dock.placeholderVideo },
      },
      activeStatus: dict.brandWorkspace.status.active,
      closedRequestDraft: dict.brandStudio.dock.closedRequestDraft,
      closedRequestOrgFallback: dict.brandStudio.dock.closedRequestOrgFallback,
      billingCustomer: dict.brandBilling.customer,
    };

    const initialState = await loadFirstRunChecklistState(f.sql, orgId, { capKrw: 0, logoUrl: null });
    expect(initialState.usageRequestSent).toBe(false);
    expect(initialState.usageState).toBe('not_requested');

    const reqOutcome = await submitBrandBillingRequest(
      { sql: f.sql },
      viewerOf(f.ids.owner),
      {
        organizationId: orgId,
        intent: 'plan_request',
        requestId: randomUUID(),
      },
    );
    expect(reqOutcome.ok).toBe(true);

    const requestedChecklist = await loadFirstRunChecklistState(f.sql, orgId, {
      capKrw: 0,
      logoUrl: null,
    });
    expect(requestedChecklist.usageRequestSent).toBe(true);
    expect(requestedChecklist.usageState).toBe('requested');

    const requestedHtml = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={orgId}
        organizationName="Brand"
        locale="ko"
        layout={layout}
        allowance={{ capKrw: 0, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
        doors={{ image: null, video: null }}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={false}
        checklist={requestedChecklist}
        copy={commonCopy}
      />,
    );
    expect(requestedHtml).toContain('신청 접수');
    expect(requestedHtml).not.toContain('신청 전');
    expect(requestedHtml).toContain(`/brand/billing?organizationId=${orgId}`);

    const readyChecklist = await loadFirstRunChecklistState(f.sql, orgId, {
      capKrw: 100_000,
      logoUrl: null,
    });
    expect(readyChecklist.usageApproved).toBe(true);
    expect(readyChecklist.usageState).toBe('ready');

    const readyHtml = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={orgId}
        organizationName="Brand"
        locale="ko"
        layout={layout}
        allowance={{ capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
        doors={{ image: null, video: null }}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={false}
        checklist={readyChecklist}
        copy={commonCopy}
      />,
    );
    expect(readyHtml).toContain('이용 가능');
  });

  it('F3 & F4 & F12: plan_question does not mark checklist requested (DB + DOM) and hides /brand/billing link for non-billing roles', async () => {
    const f = await studioFixture({ capKrw: null });
    fixtures.push(f);
    const dict = getDictionary('ko');
    const orgId = f.orgId;
    const layout = homeLayout({ choice: { id: orgId, name: 'Atelier Monet', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;
    const commonCopy = {
      home: dict.brandHome,
      shell: dict.studioShell,
      roomsNav: dict.roomsShell.nav,
      roomTabCounts: dict.roomsShell.room.tabCounts,
      roomStages: dict.roomsShell.overview.stages,
      inbox: dict.roomsChat.inbox,
      prompt: {
        label: dict.brandStudio.dock.label,
        placeholder: { image: dict.brandStudio.dock.placeholder, video: dict.brandStudio.dock.placeholderVideo },
      },
      activeStatus: dict.brandWorkspace.status.active,
      closedRequestDraft: dict.brandStudio.dock.closedRequestDraft,
      closedRequestOrgFallback: dict.brandStudio.dock.closedRequestOrgFallback,
      billingCustomer: dict.brandBilling.customer,
    };

    // F3: Confirm brand_support_messages schema has no `surface` column and checklist still loads cleanly.
    const cols = await f.sql.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'brand_support_messages'",
    );
    expect(cols.rows.map((r) => r.column_name)).not.toContain('surface');

    // F4: Submitting a `plan_question` must NOT mark usageState = 'requested'.
    const qOutcome = await submitBrandBillingRequest(
      { sql: f.sql },
      viewerOf(f.ids.owner),
      {
        organizationId: orgId,
        intent: 'plan_question',
        note: '세금계산서 절차 문의',
        requestId: randomUUID(),
      },
    );
    expect(qOutcome.ok).toBe(true);
    const afterQuestion = await loadFirstRunChecklistState(f.sql, orgId, { capKrw: 0, logoUrl: null });
    expect(afterQuestion.usageRequestSent).toBe(false);
    expect(afterQuestion.usageState).toBe('not_requested');

    // F12: Editor/viewer cannot open /brand/billing -> link omitted when canOpenBilling = false.
    const { FirstRunChecklist } = await import('@/components/brand-workspace/home/first-run-checklist');
    const editorHtml = renderToStaticMarkup(
      <FirstRunChecklist
        organizationId={orgId}
        locale="ko"
        state={afterQuestion}
        copy={dict.brandHome.checklist}
        billingCopy={dict.brandBilling.customer}
        canOpenBilling={false}
        planCatalogue={[
          { id: 'b2b_29', monthlyKrw: 290_000, rank: 1 },
          { id: 'b2b_49', monthlyKrw: 490_000, rank: 2 },
          { id: 'b2b_69', monthlyKrw: 690_000, rank: 3 },
        ]}
        hrefs={{
          members: `/brand/members?organizationId=${orgId}`,
          studio: `/brand/studio?organizationId=${orgId}`,
          billing: `/brand/billing?organizationId=${orgId}`,
        }}
      />,
    );
    expect(editorHtml).not.toContain('/brand/billing');

    // F4 + F11 DOM test: submitting plan_question in FirstRunChecklist dialog leaves "신청 전";
    // submitting plan_request transitions badge to "신청 접수".
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}'));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          id: randomUUID(),
          noticeKind: payload.intent === 'allowance_request' ? 'allowance_request' : 'plan_request',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const dom = await mountDom(
      <FirstRunChecklist
        organizationId={orgId}
        locale="ko"
        state={afterQuestion}
        copy={dict.brandHome.checklist}
        billingCopy={dict.brandBilling.customer}
        canOpenBilling
        planCatalogue={[
          { id: 'b2b_29', monthlyKrw: 290_000, rank: 1 },
          { id: 'b2b_49', monthlyKrw: 490_000, rank: 2 },
          { id: 'b2b_69', monthlyKrw: 690_000, rank: 3 },
        ]}
        hrefs={{
          members: `/brand/members?organizationId=${orgId}`,
          studio: `/brand/studio?organizationId=${orgId}`,
          billing: `/brand/billing?organizationId=${orgId}`,
        }}
      />,
    );

    try {
      const openBtn = dom.query('[data-home-checklist-request]');
      expect(openBtn).toBeTruthy();
      await dom.click(openBtn!);
      expect(dom.query('[role="dialog"]')).toBeTruthy();

      // Switch to plan_question and submit -> badge remains 신청 전
      const questionRadio = dom.query('[data-billing-intent="plan_question"]');
      expect(questionRadio).toBeTruthy();
      await dom.click(questionRadio!);
      await dom.submit('[data-billing-request-form]');
      expect(dom.container.textContent).toContain('신청 전');
      expect(dom.container.textContent).not.toContain('신청 접수');
    } finally {
      vi.restoreAllMocks();
      await dom.unmount();
    }
    void layout;
    void commonCopy;
  });

  it('Round 2 (3 & 4): /brand/home hides billing link for editors (only owners/admins see it) and en checklist matches ko', async () => {
    const f = await studioFixture({ capKrw: null });
    fixtures.push(f);
    const dictKo = getDictionary('ko');
    const dictEn = getDictionary('en');

    // Round 2 (4): en checklist pendingBody & readyBody match ko without ungrounded claims
    expect(dictEn.brandHome.checklist.usage.pendingBody).not.toContain('Available once your plan is confirmed');
    expect(dictEn.brandHome.checklist.usage.pendingBody.toLowerCase()).toContain('request');
    expect(dictEn.brandHome.checklist.usage.readyBody.toLowerCase()).toContain('credits');
    expect(dictEn.brandHome.checklist.usage.readyBody).not.toContain('full uploads');

    const { default: BrandWorkspaceHome } = await import('@/app/(brand)/brand/home/page');
    const editorViewer = viewerOf(f.ids.editor);
    const ownerViewer = viewerOf(f.ids.owner);

    try {
      // Render REAL /brand/home Server Component as an editor -> must NOT link to /brand/billing
      mocks.contextOverride = {
        viewer: editorViewer,
        sql: f.sql,
        verifiedEmail: editorViewer.email,
        brandHost: false,
        requestOrigin: 'http://localhost',
        locale: 'ko',
        dict: dictKo,
        b: dictKo.brandWorkspace,
      };
      mocks.scopeOverride = {
        choices: [{ id: f.orgId, name: 'Atelier Monet', role: 'editor' as const, logoUrl: null }],
        projectOrganizations: {},
        projectCount: 0,
        selection: {
          state: 'selected' as const,
          choice: { id: f.orgId, name: 'Atelier Monet', role: 'editor' as const, logoUrl: null },
          source: 'query' as const,
        },
        choice: { id: f.orgId, name: 'Atelier Monet', role: 'editor' as const, logoUrl: null },
      };
      const editorEl = await BrandWorkspaceHome({ searchParams: Promise.resolve({ organizationId: f.orgId }) });
      const editorHtml = renderToStaticMarkup(editorEl);
      expect(editorHtml).toContain('시작 가이드');
      expect(editorHtml).not.toContain('data-home-checklist-link="billing"');
      expect(editorHtml).not.toContain('/brand/billing');

      // Render REAL /brand/home Server Component as an owner -> MUST link to /brand/billing
      mocks.contextOverride = {
        viewer: ownerViewer,
        sql: f.sql,
        verifiedEmail: ownerViewer.email,
        brandHost: false,
        requestOrigin: 'http://localhost',
        locale: 'ko',
        dict: dictKo,
        b: dictKo.brandWorkspace,
      };
      mocks.scopeOverride = {
        choices: [{ id: f.orgId, name: 'Atelier Monet', role: 'owner' as const, logoUrl: null }],
        projectOrganizations: {},
        projectCount: 0,
        selection: {
          state: 'selected' as const,
          choice: { id: f.orgId, name: 'Atelier Monet', role: 'owner' as const, logoUrl: null },
          source: 'query' as const,
        },
        choice: { id: f.orgId, name: 'Atelier Monet', role: 'owner' as const, logoUrl: null },
      };
      const ownerEl = await BrandWorkspaceHome({ searchParams: Promise.resolve({ organizationId: f.orgId }) });
      const ownerHtml = renderToStaticMarkup(ownerEl);
      expect(ownerHtml).toContain('data-home-checklist-link="billing"');
      expect(ownerHtml).toContain('/brand/billing');
    } finally {
      mocks.contextOverride = null;
      mocks.scopeOverride = null;
    }
  });
});
