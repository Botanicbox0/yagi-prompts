import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { submitBrandBillingRequest } from '@/lib/brands/billing-request';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadUsageRequestSent } from '@/lib/brands/workspace/home-checklist';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

/**
 * The closed studio's "was an access request already sent" answer: the shared helper (the same rule
 * `/brand/home`'s checklist uses) and `GET /api/brand-workspace/access-request`, which reads it for a
 * member and refuses everyone else exactly like the sibling `GET /api/brand-workspace`.
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' } as Viewer,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => undefined }));

const accessRequest = await import('@/app/api/brand-workspace/access-request/route');
const workspace = await import('@/app/api/brand-workspace/route');

const ANON: Viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' };
const sandboxedOrgId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

const fixtures: StudioFixture[] = [];
async function fixture(options: Parameters<typeof studioFixture>[0] = {}): Promise<StudioFixture> {
  const f = await studioFixture(options);
  fixtures.push(f);
  mocks.sql = f.sql;
  return f;
}

afterEach(async () => {
  mocks.sql = null;
  mocks.viewer = ANON;
  while (fixtures.length > 0) await fixtures.pop()!.db.close();
});

const host = { host: 'brand.twings.app' };
const getAccess = (organizationId: string) =>
  accessRequest.GET(
    new NextRequest(
      `https://brand.twings.app/api/brand-workspace/access-request?organizationId=${encodeURIComponent(organizationId)}`,
      { headers: host },
    ),
  );
const getSibling = (organizationId: string) =>
  workspace.GET(
    new NextRequest(`https://brand.twings.app/api/brand-workspace?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: host,
    }),
  );

async function answer(res: Response) {
  return { status: res.status, body: await res.json(), cacheControl: res.headers.get('cache-control') };
}

async function request(f: StudioFixture, organizationId: string, intent: 'plan_request' | 'allowance_request' | 'plan_question') {
  const outcome = await submitBrandBillingRequest({ sql: f.sql }, viewerOf(f.ids.owner), {
    organizationId,
    intent,
    note: intent === 'plan_question' ? 'invoice question' : '',
    surface: 'studio_image',
    requestId: randomUUID(),
  });
  expect(outcome.ok).toBe(true);
}

describe('loadUsageRequestSent (shared with the first-run checklist)', () => {
  it('is false with no rows, ignores plan questions and other organizations, and turns true on a plan request', async () => {
    const f = await fixture({ capKrw: null });
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(false);

    // A plain plan question is stored as a plan_request notice whose surface starts with billing:plan_question.
    await request(f, f.orgId, 'plan_question');
    const rows = (
      await f.sql.query<{ kind: string; surface: string }>(
        'select kind, surface from team_notice_deliveries where organization_id = $1',
        [f.orgId],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('plan_request');
    expect(rows[0]!.surface.startsWith('billing:plan_question')).toBe(true);
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(false);

    // Another organization's request never counts for this one.
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      otherOrg,
      'Second fixture brand',
      f.ids.owner,
      randomUUID(),
    ]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      otherOrg,
      f.ids.owner,
    ]);
    await request(f, otherOrg, 'plan_request');
    expect(await loadUsageRequestSent(f.sql, otherOrg)).toBe(true);
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(false);

    await request(f, f.orgId, 'plan_request');
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(true);
  });

  it('turns true on an allowance request', async () => {
    const f = await fixture({ capKrw: null });
    await request(f, f.orgId, 'allowance_request');
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(true);
  });
});

describe('GET /api/brand-workspace/access-request', () => {
  it('answers a member with only { ok, requested } for both values, private and uncached', async () => {
    const f = await fixture({ capKrw: null });
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      const before = await answer(await getAccess(f.orgId));
      expect(before).toEqual({ status: 200, body: { ok: true, requested: false }, cacheControl: 'private, no-store' });
    }

    await request(f, f.orgId, 'plan_question');
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await answer(await getAccess(f.orgId))).body).toEqual({ ok: true, requested: false });

    await request(f, f.orgId, 'plan_request');
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      const after = await answer(await getAccess(f.orgId));
      expect(after).toEqual({ status: 200, body: { ok: true, requested: true }, cacheControl: 'private, no-store' });
    }
  });

  it('refuses signed-out callers, outsiders, project guests, unknown organizations and bad ids exactly like the sibling route', async () => {
    const f = await fixture({ capKrw: null });
    await request(f, f.orgId, 'plan_request');

    const cases: Array<{ name: string; viewer: Viewer; organizationId: string }> = [
      { name: 'signed out', viewer: ANON, organizationId: f.orgId },
      { name: 'outsider', viewer: viewerOf(f.ids.outsider), organizationId: f.orgId },
      { name: 'project guest only', viewer: viewerOf(f.ids.guest), organizationId: f.orgId },
      { name: 'unknown organization', viewer: viewerOf(f.ids.owner), organizationId: randomUUID() },
      { name: 'bad id', viewer: viewerOf(f.ids.owner), organizationId: 'not-a-uuid' },
      { name: 'empty id', viewer: viewerOf(f.ids.owner), organizationId: '' },
    ];
    for (const c of cases) {
      mocks.viewer = c.viewer;
      const mine = await answer(await getAccess(c.organizationId));
      const sibling = await answer(await getSibling(c.organizationId));
      expect(mine.status, c.name).toBe(404);
      expect(mine.body, c.name).toEqual({ ok: false });
      expect({ status: mine.status, body: mine.body }, c.name).toEqual({ status: sibling.status, body: sibling.body });
      expect(mine.cacheControl, c.name).toBe('private, no-store');
    }
  });

  it('refuses a sandboxed organization with the same 404 a non-member gets, even for its owner', async () => {
    const f = await fixture({ capKrw: null, orgId: sandboxedOrgId });
    await f.sql.query(
      `insert into team_notice_deliveries (kind, organization_id, source_table, source_id, surface)
       values ('allowance_request', $1, 'brand_support_messages', $2, 'billing:allowance_request')`,
      [f.orgId, randomUUID()],
    );
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(true);

    mocks.viewer = viewerOf(f.ids.owner);
    const sandboxed = await answer(await getAccess(f.orgId));
    mocks.viewer = viewerOf(f.ids.outsider);
    const outsider = await answer(await getAccess(f.orgId));
    expect(sandboxed).toEqual({ status: 404, body: { ok: false }, cacheControl: 'private, no-store' });
    expect(sandboxed).toEqual(outsider);
  });
});

/**
 * The banner's answer must mean "a request is waiting", not "a request was ever sent". The banner shows
 * whenever the allowance is closed, long after the first-run checklist is gone, so a request the team
 * already answered (the workspace was approved, a plan was assigned) or one from weeks ago must not make
 * a workspace whose credits ran out read "we received your request".
 */
describe('a request that is no longer waiting', () => {
  const backdate = (f: StudioFixture, days: number) =>
    f.sql.query("update team_notice_deliveries set created_at = now() - make_interval(days => $2::int) where organization_id = $1", [f.orgId, days]);
  const requested = async (f: StudioFixture) => {
    mocks.viewer = viewerOf(f.ids.owner);
    return (await answer(await getAccess(f.orgId))).body.requested as boolean;
  };

  it('stops counting after 30 days, while the checklist rule is unchanged', async () => {
    const f = await fixture({ capKrw: null });
    await request(f, f.orgId, 'plan_request');
    await backdate(f, 29);
    expect(await requested(f)).toBe(true);
    await backdate(f, 31);
    expect(await requested(f)).toBe(false);
    expect(await loadUsageRequestSent(f.sql, f.orgId)).toBe(true);

    // A fresh request counts again.
    await request(f, f.orgId, 'allowance_request');
    expect(await requested(f)).toBe(true);
  });

  it('does not count a request sent before the workspace was approved', async () => {
    const f = await fixture({ capKrw: null });
    await request(f, f.orgId, 'plan_request');
    await backdate(f, 3);
    expect(await requested(f)).toBe(true);
    await f.sql.query("insert into brand_workspace_approvals (organization_id, approved_at) values ($1, now() - interval '2 days')", [f.orgId]);
    expect(await requested(f)).toBe(false);

    await request(f, f.orgId, 'allowance_request');
    expect(await requested(f)).toBe(true);
  });

  it('does not count a request sent before the current plan assignment was written', async () => {
    const f = await fixture({ capKrw: null });
    await request(f, f.orgId, 'plan_request');
    await backdate(f, 3);
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, updated_at) values ($1, 'b2b_29', 'invoice', current_date - 2, now() - interval '2 days')",
      [f.orgId],
    );
    expect(await requested(f)).toBe(false);

    await request(f, f.orgId, 'plan_request');
    expect(await requested(f)).toBe(true);
  });
});
