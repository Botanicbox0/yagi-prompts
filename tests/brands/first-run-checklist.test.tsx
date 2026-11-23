import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { homeChecklistDismissCookieName, readChecklistDismissedFromCookie } from '@/lib/brands/workspace/home-checklist-cookie';
import { loadFirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeLayout } from '@/lib/brands/workspace/home';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';
import { setPlanAssignment } from '@/lib/brands/plans';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  studioOpen: true,
}));

vi.mock('@/lib/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/flags')>()),
  brandStudioV2Open: () => mocks.studioOpen,
}));

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
});
