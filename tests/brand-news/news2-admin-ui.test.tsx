import { randomUUID } from 'node:crypto';
import type { ReactElement, ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { ADMIN_NAV_GROUPS, ADMIN_NAV_PATHS } from '@/lib/admin/workflow';
import { resetBrandNewsProbe } from '@/lib/brand-news/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  locale: 'ko' as 'ko' | 'en',
  notFound: vi.fn(() => {
    const err = new Error('NEXT_NOT_FOUND') as Error & { digest?: string };
    err.digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
    throw err;
  }),
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => mocks.notFound(),
}));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true }),
  publicHref: (path: string) => `https://twings.app${path}`,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
  requireAdmin: async () => {
    if (!mocks.viewer?.isAdmin) mocks.notFound();
    return mocks.viewer!;
  },
}));
vi.mock('@/lib/i18n/server', () => ({
  getLocaleFromHeaders: async () => mocks.locale,
}));

const { AdminShell } = await import('@/components/admin/chrome');
const AdminHomePage = (await import('@/app/(admin)/admin/page')).default;
const AdminBrandNewsPage = (await import('@/app/(admin)/admin/brand-news/page')).default;
const { BrandNewsEditor } = await import('@/app/(admin)/admin/brand-news/brand-news-editor');
const { emptyDraftForm, formValuesFromItem } = await import('@/app/(admin)/admin/brand-news/model');

async function renderHtml(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

let fx: StudioFixture | null = null;
let dom: MountedDom | null = null;

afterEach(async () => {
  if (dom) await dom.unmount();
  dom = null;
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  await fx?.db.close();
  fx = null;
  mocks.sql = null;
  mocks.viewer = null;
  mocks.locale = 'ko';
  mocks.notFound.mockClear();
});

async function setupAdminFixture() {
  resetBrandNewsProbe();
  fx = await studioFixture({ orgName: 'Admin N2 Org' });
  mocks.sql = fx.sql;
  mocks.viewer = { ...viewerOf(fx.ids.admin), isAdmin: true };
  return fx;
}

async function seedRow(
  fixture: StudioFixture,
  opts: {
    slot?: 'home' | 'team_home';
    status: 'draft' | 'live' | 'ended';
    titleKo: string;
    titleEn?: string;
    updatedAt?: string;
    audience?: unknown;
  },
): Promise<string> {
  const id = randomUUID();
  const startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const endsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const updatedAt = opts.updatedAt ?? new Date().toISOString();
  const publishedAt = opts.status !== 'draft' ? updatedAt : null;
  const endedAt = opts.status === 'ended' ? updatedAt : null;
  await fixture.sql.query(
    `insert into brand_announcements
       (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience, status, created_by, created_at, updated_at, published_at, ended_at)
     values ($1, $2, '새 소식', 'New', $3, $4, '보기', 'View', '/brand/home', 'line', $5, $6, $7::jsonb, $8, $9, $10, $10, $11, $12)`,
    [
      id,
      opts.slot ?? 'home',
      opts.titleKo,
      opts.titleEn ?? 'Announcement line',
      startsAt,
      endsAt,
      JSON.stringify(opts.audience ?? {}),
      opts.status,
      fixture.ids.admin,
      updatedAt,
      publishedAt,
      endedAt,
    ],
  );
  return id;
}

describe('Slice N2 admin navigation, slots, delete, and publish staleness', () => {
  it('registers brandNews in AdminShell beside brand entries, highlights active menu item, keeps /admin link and requireAdmin guard', async () => {
    const brandsGroup = ADMIN_NAV_GROUPS.find((g) => g.key === 'brands')!;
    expect(brandsGroup.items).toContain('brandNews');
    expect((ADMIN_NAV_PATHS as Record<string, string>).brandNews).toBe('/admin/brand-news');

    const ko = getDictionary('ko');
    const en = getDictionary('en');
    expect(ko.adminConsole.nav.brandNews).toBe(ko.brandNewsAdmin.title);
    expect(en.adminConsole.nav.brandNews).toBe(en.brandNewsAdmin.title);

    const shellHtml = await renderHtml(
      <AdminShell dict={ko.admin} locale="ko" active={'brandNews' as never}>
        <p>Body</p>
      </AdminShell>,
    );
    expect(shellHtml).toContain('href="/admin/brand-news"');
    expect(shellHtml).toContain('data-admin-active="brandNews"');

    vi.stubEnv('BRAND_NEWS', 'on');
    const f = await setupAdminFixture();
    const pageHtml = await renderHtml((await AdminBrandNewsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(pageHtml).toContain('data-admin-active="brandNews"');

    // Existing /admin card link stays intact.
    mocks.sql = null;
    const homeHtml = await renderHtml((await AdminHomePage()) as ReactElement);
    expect(homeHtml).toContain('href="/admin/brand-news"');

    // Non-admin viewer hits requireAdmin -> 404.
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    await expect(AdminBrandNewsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows slot column, per-slot live summaries, slot-specific reach and audience summary on /admin/brand-news', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    const f = await setupAdminFixture();

    const homeLiveId = await seedRow(f, { slot: 'home', status: 'live', titleKo: '만들기 라이브 공지' });
    const teamLiveId = await seedRow(f, { slot: 'team_home', status: 'live', titleKo: '팀 홈 라이브 공지' });
    const teamDraftId = await seedRow(f, { slot: 'team_home', status: 'draft', titleKo: '팀 홈 다음 초안' });

    const html = await renderHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ edit: teamDraftId }) })) as ReactElement,
    );
    const ko = getDictionary('ko').brandNewsAdmin as Record<string, unknown>;

    // Both live announcements summarized with their slots.
    expect(html).toContain(`data-brand-news-live-summary="${homeLiveId}"`);
    expect(html).toContain('만들기 라이브 공지');
    expect(html).toContain(`data-brand-news-live-summary="${teamLiveId}"`);
    expect(html).toContain('팀 홈 라이브 공지');

    // Slot column and slot markers in list.
    expect(html).toContain(`data-brand-news-row="${teamDraftId}"`);
    expect(html).toContain('data-slot="team_home"');
    expect(html).toContain('data-slot="home"');
    expect(ko).toHaveProperty('slots.home.description');
    expect(ko).toHaveProperty('slots.team_home.description');

    // Saved draft locks slot and includes expectedUpdatedAt + team_home reach.
    expect(html).toContain('data-brand-news-slot-locked="team_home"');
    expect(html).not.toContain('data-brand-news-slot="home"');
    expect(html).toContain('data-brand-news-reach="1"');
    expect(html).toContain('data-brand-news-reach-slot="team_home"');
    expect(html).toContain('name="expectedUpdatedAt"');

    // Publish box replaces teamLiveId only, NOT homeLiveId!
    expect(html).toContain(`data-brand-news-publish-replaces="${teamLiveId}"`);
    expect(html).not.toContain(`data-brand-news-publish-replaces="${homeLiveId}"`);

    // Draft delete box is present and disabled on SSR.
    expect(html).toContain('data-brand-news-delete-box=""');
    expect(html).toContain('value="brandNews.delete"');
    expect(html).toMatch(/disabled=""[^>]*data-brand-news-delete=""|data-brand-news-delete=""[^>]*disabled=""/);
  });

  it('lets admin choose slot on a new draft, keeps delete disabled when dirty, and omits delete on live/ended', async () => {
    const ko = getDictionary('ko');
    const en = getDictionary('en');

    dom = await mountDom(
      <BrandNewsEditor
        selected={null}
        liveItem={null}
        initialValues={emptyDraftForm(new Date('2026-12-01T01:00:00.000Z'))}
        reach={null}
        studioV2Enabled
        outcome={null}
        copy={ko.brandNewsAdmin}
        homeCopyKo={ko.brandNews}
        homeCopyEn={en.brandNews}
      />,
    );

    const homeSlotRadio = dom.query('input[data-brand-news-slot="home"]') as { checked: boolean } | null;
    const teamSlotRadio = dom.query('input[data-brand-news-slot="team_home"]') as { checked: boolean } | null;
    expect(homeSlotRadio).not.toBeNull();
    expect(teamSlotRadio).not.toBeNull();
    expect(homeSlotRadio!.checked).toBe(true);
    expect(dom.query('[data-brand-news-delete]')).toBeNull();

    if (teamSlotRadio) teamSlotRadio.checked = true;
    await dom.click('input[data-brand-news-slot="team_home"]');
    expect(dom.query('[data-brand-news-preview-slot]')?.getAttribute('data-brand-news-preview-slot')).toBe('team_home');
    expect(dom.query('[data-brand-news-preview="ko"]')?.parentElement?.textContent ?? '').toContain('야기 팀과 홈');
    await dom.unmount();
    dom = null;

    const draft = {
      id: randomUUID(),
      slot: 'team_home' as const,
      status: 'draft' as const,
      showing: false,
      over: false,
      kickerKo: '새 소식',
      kickerEn: 'New',
      titleKo: '저장된 팀 초안',
      titleEn: 'Saved team draft',
      ctaLabelKo: '보기',
      ctaLabelEn: 'View',
      ctaHref: '/brand/rooms',
      shape: 'line' as const,
      imageKey: null,
      imageWidth: null,
      imageHeight: null,
      imageUrl: null,
      startsAt: '2026-12-01T01:00:00.000Z',
      endsAt: '2026-12-15T01:00:00.000Z',
      audience: {} as const,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-27T01:23:45.678Z',
      publishedAt: null,
      endedAt: null,
      publishable: { ok: true as const },
    };
    dom = await mountDom(
      <BrandNewsEditor
        selected={draft}
        liveItem={null}
        initialValues={formValuesFromItem(draft)}
        reach={{ ok: true, organizations: 2 }}
        studioV2Enabled
        outcome={null}
        copy={ko.brandNewsAdmin}
        homeCopyKo={ko.brandNews}
        homeCopyEn={en.brandNews}
      />,
    );

    const deleteBtn = () => dom!.query('[data-brand-news-delete]') as { disabled: boolean };
    const deleteConfirm = () => dom!.query('[data-brand-news-delete-box] input[name="_confirm"]') as { disabled: boolean };
    const updatedAtInput = dom.query('input[name="expectedUpdatedAt"]') as { value: string } | null;
    expect(updatedAtInput?.value).toBe('2026-11-27T01:23:45.678Z');

    // Clean draft: delete enabled after hydration.
    expect(deleteBtn().disabled).toBe(false);
    expect(deleteConfirm().disabled).toBe(false);
    expect(dom.query('[data-brand-news-slot="home"]')).toBeNull();
    expect(dom.query('[data-brand-news-slot-locked="team_home"]')).not.toBeNull();

    // Dirty draft disables delete and shows hint; reverting re-enables delete.
    await dom.setValue('input[name="titleKo"]', '수정 중인 초안');
    expect(deleteBtn().disabled).toBe(true);
    expect(deleteConfirm().disabled).toBe(true);
    expect(dom.query('[data-brand-news-delete-dirty-notice]')).not.toBeNull();
    await dom.setValue('input[name="titleKo"]', '저장된 팀 초안');
    expect(deleteBtn().disabled).toBe(false);
    await dom.unmount();
    dom = null;

    const liveHtml = await renderHtml(
      <BrandNewsEditor
        selected={{ ...draft, status: 'live' }}
        liveItem={{ ...draft, status: 'live' }}
        initialValues={formValuesFromItem({ ...draft, status: 'live' })}
        reach={null}
        studioV2Enabled
        outcome={null}
        copy={ko.brandNewsAdmin}
        homeCopyKo={ko.brandNews}
        homeCopyEn={en.brandNews}
      />,
    );
    expect(liveHtml).not.toContain('data-brand-news-delete-box');
  });

  it('handles ok=deleted cleanly and reloads fresh draft with plain Korean alert on err=staleReview', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const f = await setupAdminFixture();
    const deletedId = randomUUID();
    const deletedHtml = await renderHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ ok: 'deleted', detail: deletedId }) })) as ReactElement,
    );
    expect(deletedHtml).toContain('data-brand-news-outcome="ok"');
    expect(deletedHtml).not.toContain('data-outcome="error"');

    const latestUpdatedAt = '2026-11-27T02:00:00.500Z';
    const draftId = await seedRow(f, {
      slot: 'team_home',
      status: 'draft',
      titleKo: '새로 저장된 최신 초안',
      updatedAt: latestUpdatedAt,
    });
    const staleHtml = await renderHtml(
      (await AdminBrandNewsPage({
        searchParams: Promise.resolve({ edit: draftId, err: 'staleReview', detail: 'brandNews:stale' }),
      })) as ReactElement,
    );
    expect(staleHtml).toContain('data-brand-news-outcome="err"');
    expect(staleHtml).toContain('새로 저장된 최신 초안');
    expect(staleHtml).toContain(`value="${latestUpdatedAt}"`);
  });

  it('Fix 1 UI: hides team mode checkbox for home slot when slotsReady=true, while safely rendering & blocking legacy team rows', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const ko = getDictionary('ko');
    const en = getDictionary('en');

    // Clean new/saved 'home' draft does not offer 'team' checkbox when slotsReady = true.
    dom = await mountDom(
      <BrandNewsEditor
        selected={null}
        liveItem={null}
        initialValues={emptyDraftForm(new Date('2026-12-01T01:00:00.000Z'))}
        reach={null}
        studioV2Enabled
        slotsReady
        outcome={null}
        copy={ko.brandNewsAdmin}
        homeCopyKo={ko.brandNews}
        homeCopyEn={en.brandNews}
      />,
    );
    expect(dom.query('input[data-brand-news-mode="make"]')).not.toBeNull();
    expect(dom.query('input[data-brand-news-mode="team"]') === null).toBe(true);
    await dom.unmount();
    dom = null;

    // Stored legacy 'home' row whose audience.modes includes 'team': renders without crashing,
    // displays 'team' checkbox so admin can see/uncheck it, surfaces readiness/audience error, and blocks save until removed.
    const f = await setupAdminFixture();
    const legacyId = await seedRow(f, {
      slot: 'home',
      status: 'draft',
      titleKo: '옛 팀 대상 포함 초안',
      audience: { modes: ['make', 'team'] },
    });
    const legacyHtml = await renderHtml(
      (await AdminBrandNewsPage({
        searchParams: Promise.resolve({ edit: legacyId, err: 'invalid', detail: 'brandNews:audience:modes' }),
      })) as ReactElement,
    );
    expect(legacyHtml).toContain('data-brand-news-mode="team"');
    expect(legacyHtml).toContain('data-brand-news-readiness="blocked"');
    expect(legacyHtml).toContain(ko.brandNewsAdmin.outcomes.invalidAudienceModes);
    expect(legacyHtml).toMatch(/disabled=""[^>]*data-brand-news-save=""|data-brand-news-save=""[^>]*disabled=""/);
  });
});
