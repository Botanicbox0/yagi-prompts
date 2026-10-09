import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { adminHarness, ADMIN_VIEWER, type AdminHarness } from '@/tests/helpers/admin';
import { runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { seedPrompts } from '../../scripts/seed';
import { FIXTURE_USERS } from '../../scripts/fixtures';

/**
 * P2-6 / P2-7 / P2-8 / hidden-campaign invite (P2-3 UI) / H1, through the real seams: the admin
 * dispatcher on PGlite, the outcome URL, and server-rendered markup of the pages and components.
 */
const page = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock('@/lib/auth/viewer', async () => {
  const { ADMIN_VIEWER: viewer } = await import('@/tests/helpers/admin');
  return { requireAdmin: async () => viewer, getViewer: async () => viewer };
});
// The page mounts client islands (ManagedForm) that call useRouter; there is no app router in vitest.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => '/admin/brand-workspace',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => page.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (path: string, admin: boolean) => (admin ? `https://twings.app${path}` : path),
}));

import * as s from '@/lib/brands/workspace/service';
import { outcomeUrl } from '@/lib/admin/dispatch';
import { OutcomeBanner, ConfirmCheck } from '@/components/admin/chrome';
import { BrandStatusForms, brandRefusals } from '@/components/admin/brand-status';
import { invitationOrigin, managedErrorMessage } from '@/components/brand-workspace/managed-form';
import { brandFailure } from '@/lib/admin/brand-workspace-operations';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { adminPromptPath } from '@/lib/prompts/links';
import { getDictionary } from '@/lib/i18n/dictionaries';
import StudioBrandProject from '@/app/(admin)/admin/brand-workspace/[id]/page';
import AdminCampaignPage from '@/app/(admin)/admin/campaigns/[id]/page';
import { loadCampaignBySlug } from '@/lib/campaigns/repo';

const ko = getDictionary('ko');
async function html(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

let h: AdminHarness;
let orgId: string;
let projectId: string;
beforeEach(async () => {
  h = await adminHarness();
  const sql = runner(h.db);
  page.sql = sql;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, email: ADMIN_VIEWER.email!, isAdmin: true });
  const org = await s.createStudioOrganization({ sql }, ADMIN_VIEWER, { name: 'Fixture brand', requestId: randomUUID() });
  if (!org.ok) throw Error(org.code);
  orgId = org.id;
  const p = await s.createStudioProject({ sql }, ADMIN_VIEWER, { organizationId: orgId, title: 'Fixture campaign', objective: 'Prepare a report', budgetKrw: null, productionMode: 'creator', requestId: randomUUID() });
  if (!p.ok) throw Error(p.code);
  projectId = p.id;
});
afterEach(async () => h.close());

describe('P2-6 brand refusals carry brand wording and the service code', () => {
  it('an impossible status move is brandConflict, not the contest stale-entry sentence', async () => {
    const outcome = await h.run('brandWorkspace.status', { projectId, requestId: randomUUID(), expectedRevision: '0', status: 'completed' });
    expect(outcome).toEqual({ ok: false, code: 'brandConflict', detail: 'conflict' });
    const url = outcomeUrl(`/admin/brand-workspace/${projectId}`, outcome);
    expect(url).toBe(`/admin/brand-workspace/${projectId}?err=brandConflict&detail=conflict`);
    const banner = renderToStaticMarkup(<OutcomeBanner dict={ko.admin} err="brandConflict" detail="conflict" />);
    expect(banner).toContain(ko.admin.errBrandConflict);
    expect(banner).toContain('conflict');
    expect(banner).not.toContain('출품자');
  });

  it('content on a campaign that is not active is brandNotActive', async () => {
    const outcome = await h.run('brandWorkspace.content', { projectId, requestId: randomUUID(), expectedRevision: '0', slotKey: 'hero', title: 'Hero', attachmentId: randomUUID(), caption: '', usageRights: 'Organic social' });
    expect(outcome).toMatchObject({ ok: false, code: 'brandNotActive', detail: 'not_active' });
  });

  it('maps the remaining service codes, including the campaign-only invite refusal', () => {
    expect(brandFailure('consent_required')).toEqual({ ok: false, code: 'brandConsentRequired', detail: 'consent_required' });
    expect(brandFailure('not_shared')).toEqual({ ok: false, code: 'brandNotShared', detail: 'not_shared' });
    expect(brandFailure('not_found')).toMatchObject({ code: 'notFound' });
    expect(brandFailure('rate_limited')).toMatchObject({ code: 'invalid', detail: 'rate_limited' });
  });

  it('the project page banner renders the detail from the URL', async () => {
    const markup = await html(await StudioBrandProject({ params: Promise.resolve({ id: projectId }), searchParams: Promise.resolve({ err: 'brandConflict', detail: 'conflict' }) }));
    expect(markup).toContain(ko.admin.errBrandConflict);
    expect(markup.replace(/<!-- -->/g, '')).toContain(`${ko.admin.detailLabel}: conflict`);
  });
});

describe('P2-7 confirmations', () => {
  it('ConfirmCheck is a required box, so the browser refuses the first press', () => {
    const markup = renderToStaticMarkup(<ConfirmCheck label="확인" />);
    const input = markup.match(/<input[^>]*>/)?.[0] ?? '';
    expect(input).toContain('type="checkbox"');
    expect(input).toContain('name="_confirm"');
    expect(input).toMatch(/\srequired(=""|\s|\/|>)/);
  });

  it('a requested campaign offers activate and cancel only; cancel needs the box', () => {
    const markup = renderToStaticMarkup(<BrandStatusForms projectId={projectId} status="requested" revision={0} b={ko.brandWorkspace} admin={ko.admin} />);
    expect(markup).toContain('data-brand-status-moves="active cancelled"');
    expect(markup).not.toContain('value="completed"');
    expect(markup).not.toContain('<select');
    const forms = markup.split('</form>');
    expect(forms.find((f) => f.includes('value="active"'))).not.toContain('_confirm');
    expect(forms.find((f) => f.includes('value="cancelled"'))).toContain(ko.admin.confirmBrandCancel);
  });

  it('an active campaign offers complete and cancel, each confirmed; a finished one offers nothing', () => {
    const active = renderToStaticMarkup(<BrandStatusForms projectId={projectId} status="active" revision={1} b={ko.brandWorkspace} admin={ko.admin} />);
    expect(active).toContain('data-brand-status-moves="completed cancelled"');
    expect(active.match(/name="_confirm"/g)).toHaveLength(2);
    for (const status of ['completed', 'cancelled'] as const) {
      const done = renderToStaticMarkup(<BrandStatusForms projectId={projectId} status={status} revision={2} b={ko.brandWorkspace} admin={ko.admin} />);
      expect(done).not.toContain('<form');
      expect(done).toContain(ko.admin.brandStatusFinal);
    }
  });

  it('opening recruitment (outbound mail) needs the box; the other lifecycle moves do not', async () => {
    const created = await h.run('campaign.create', {
      slug: 'confirm-check', titleEn: 'T', titleKo: 'T', summaryEn: 'S', summaryKo: 'S', briefEn: 'B', briefKo: 'B', hostName: 'X', hostKind: 'brand',
      platforms: ['instagram'], deliverable: 'reel', slots: '1', applicationsCloseAt: '2026-12-01T18:00', postDeadlineAt: '2026-12-05T18:00',
      payoutModel: 'flat', payoutFlat: '10000', holdDays: '7',
    });
    expect(created.ok).toBe(true);
    const row = (await loadCampaignBySlug(runner(h.db), 'confirm-check'))!;
    const markup = await html(await AdminCampaignPage({ params: Promise.resolve({ id: row.id }), searchParams: Promise.resolve({}) }));
    const forms = markup.split('</form>').filter((f) => f.includes('value="campaign.status"'));
    const recruiting = forms.find((f) => f.includes('value="recruiting"'))!;
    expect(recruiting).toContain(ko.admin.confirmRecruiting);
    expect(recruiting).toContain('name="_confirm"');
    for (const other of forms.filter((f) => !f.includes('value="recruiting"'))) expect(other).not.toContain('_confirm');
  });

  it('the project page confirms report publishing', async () => {
    const markup = await html(await StudioBrandProject({ params: Promise.resolve({ id: projectId }), searchParams: Promise.resolve({}) }));
    const report = markup.split('</form>').find((f) => f.includes('value="brandWorkspace.report"'))!;
    expect(report).toContain(ko.admin.confirmReportPublish);
    expect(report).toContain('name="_confirm"');
  });
});

describe('hidden-campaign invite (P2-3 UI)', () => {
  it('turns the campaign-scope invite off while the campaign is not shared, and on once it is', async () => {
    const hidden = await html(await StudioBrandProject({ params: Promise.resolve({ id: projectId }), searchParams: Promise.resolve({}) }));
    expect(hidden).toContain('data-invite-hidden-campaign');
    expect(hidden).toContain(ko.admin.inviteHiddenCampaign);
    expect(hidden).not.toContain('value="brandWorkspace.invite"');
    const shared = await s.setBrandProjectVisibility({ sql: runner(h.db) }, ADMIN_VIEWER, { projectId, visible: true, expectedRevision: 0 });
    expect(shared.ok).toBe(true);
    const visible = await html(await StudioBrandProject({ params: Promise.resolve({ id: projectId }), searchParams: Promise.resolve({}) }));
    expect(visible).not.toContain('data-invite-hidden-campaign');
    expect(visible).toContain('value="brandWorkspace.invite"');
  });

  it('ManagedForm names the not_shared refusal with the admin sentence', () => {
    const refusals = brandRefusals(ko.admin);
    expect(managedErrorMessage(ko.brandWorkspace, 'brandNotShared', refusals)).toBe(ko.admin.errBrandNotShared);
    expect(managedErrorMessage(ko.brandWorkspace, 'brandConflict')).toBe(ko.brandWorkspace.conflict);
    expect(managedErrorMessage(ko.brandWorkspace, 'brandNotShared')).toBe(ko.brandWorkspace.errors.adminInvalid);
  });
});

describe('H1 invitation link origin', () => {
  it('production admin hands out brand.twings.app; local and preview keep their own origin', () => {
    expect(invitationOrigin({ hostname: 'admin.twings.app', origin: 'https://admin.twings.app' })).toBe('https://brand.twings.app');
    expect(invitationOrigin({ hostname: 'localhost', origin: 'http://localhost:3000' })).toBe('http://localhost:3000');
    expect(invitationOrigin({ hostname: 'yagi-prompts-git-x.vercel.app', origin: 'https://yagi-prompts-git-x.vercel.app' })).toBe('https://yagi-prompts-git-x.vercel.app');
  });
});

describe('P2-8 in-place prompt edits return to the page they were pressed on', () => {
  it('feature / visibility / update keep the prompt page, and the list keeps its tab', async () => {
    const sql = runner(h.db);
    for (const user of Object.values(FIXTURE_USERS)) {
      await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [user.id]);
      await sql.query(
        'insert into profiles (id, email, display_name, locale, plan, is_admin) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing',
        [user.id, user.email, user.displayName, user.locale, user.plan, user.isAdmin],
      );
    }
    await seedPrompts({ sql, storage: h.storage });
    const live = (await loadPromptBySlug(sql, 'kitchen-tutorial-overhead'))!;
    const back = adminPromptPath(live.id);
    const featured = await h.run('prompt.feature', { id: live.id, featured: 'true' });
    expect(outcomeUrl(back, featured)).toBe(`${back}?ok=saved`);
    expect(outcomeUrl('/admin/prompts?tab=published', featured)).toBe('/admin/prompts?tab=published&ok=saved');
    expect(outcomeUrl('/admin/prompts?tab=published#queue', featured)).toBe('/admin/prompts?tab=published&ok=saved#queue');
    const visibility = await h.run('prompt.visibility', { id: live.id, textVisibility: 'public' });
    expect(outcomeUrl(back, visibility)).toBe(`${back}?ok=saved`);
  });
});

describe('campaign operation keeps the validated list return context', () => {
  it('preserves returnTo only for the same campaign after a real message operation', async () => {
    const path = `/admin/brand-workspace/${projectId}`;
    const returnTo = '/admin/brand-workspace?status=requested&q=Fixture';
    const back = `${path}?${new URLSearchParams({ returnTo })}`;
    const result = await h.run('brandWorkspace.message', { projectId, requestId: randomUUID(), body: 'Fixture operation note' });
    expect(result).toMatchObject({ ok: true, to: path });
    const markup = await html(await StudioBrandProject({ params: Promise.resolve({ id: projectId }), searchParams: Promise.resolve({ returnTo }) }));
    expect(markup).toContain(`name="_back" value="${back.replaceAll('&', '&amp;')}"`);
    expect(new URL(outcomeUrl(back, result), 'https://admin.example.test').searchParams.get('returnTo')).toBe(returnTo);
    expect(new URL(outcomeUrl(back, { ok: false, code: 'invalid' }), 'https://admin.example.test').searchParams.get('returnTo')).toBe(returnTo);
    const other = `/admin/brand-workspace/${randomUUID()}`;
    expect(new URL(outcomeUrl(back, { ok: true, code: 'saved', to: other }), 'https://admin.example.test').searchParams.has('returnTo')).toBe(false);
    for (const invalid of ['https://outside.example', '/brand', '/admin/policy']) {
      expect(new URL(outcomeUrl(`${path}?${new URLSearchParams({ returnTo: invalid })}`, result), 'https://admin.example.test').searchParams.has('returnTo')).toBe(false);
    }
  });
});
