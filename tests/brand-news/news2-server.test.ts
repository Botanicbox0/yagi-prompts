import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { ADMIN_OPERATION_NAMES, ADMIN_OPERATIONS } from '@/lib/admin/operations';
import {
  BRAND_NEWS_OPERATIONS,
  parseExpectedUpdatedAt,
} from '@/lib/admin/brand-news-operations';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import {
  BRAND_NEWS_SLOTS,
  audienceAdmits,
} from '@/lib/brand-news/contracts';
import {
  brandNewsSlotsReady,
  countBrandNewsReach,
  loadBrandNewsAdmin,
  loadBrandNewsReach,
  loadHomeAnnouncement,
  resetBrandNewsProbe,
  resetBrandNewsSlotsProbe,
} from '@/lib/brand-news/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { PGlite } from '@electric-sql/pglite';
import { ADMIN_VIEWER, adminHarness, formOf, viewerOf as adminViewerOf, type AdminHarness, type FormFields } from '../helpers/admin';
import { seedProfile } from '../helpers/billing';
import { runner } from '../helpers/pglite';
import { studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
const workspaceRoute = await import('@/app/api/brand-workspace/route');

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('Slice N2 server: two slots, home read, dismiss, reach', () => {
  let f: StudioFixture;
  const media = (key: string) => `https://media.example.test/${key}`;

  beforeEach(async () => {
    resetBrandNewsProbe();
    f = await studioFixture();
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
    vi.stubEnv('BRAND_NEWS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetBrandNewsProbe();
    await f.db.close();
    mocks.sql = null;
    mocks.viewer = null;
  });

  function recording(inner: SqlRunner) {
    const texts: string[] = [];
    const wrap = (r: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(text.replace(/\s+/g, ' ').trim());
        return r.query(text, params);
      },
      transaction: (fn) => r.transaction((tx) => fn(wrap(tx))),
    });
    return { texts, sql: wrap(inner) };
  }
  const readsAnnouncements = (texts: string[]) =>
    texts.some((t) => /brand_announcement/.test(t) && !/information_schema|pg_constraint/.test(t));

  async function announce(
    over: {
      slot?: 'home' | 'team_home';
      status?: 'draft' | 'live' | 'ended';
      startsAt?: string;
      endsAt?: string;
      audience?: unknown;
      titleKo?: string;
      titleEn?: string;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const status = over.status ?? 'live';
    await f.sql.query(
      `insert into brand_announcements (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape,
         starts_at, ends_at, audience, status, created_by, published_at, ended_at)
       values ($1, $2, '새 기능', 'New', $3, $4, '보기', 'View', '/brand/home', 'line', $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        id,
        over.slot ?? 'home',
        over.titleKo ?? '슬롯 안내 문구',
        over.titleEn ?? 'Slot announcement line',
        over.startsAt ?? minutes(-60),
        over.endsAt ?? minutes(60 * 24),
        JSON.stringify(over.audience ?? {}),
        status,
        f.ids.admin,
        status === 'draft' ? null : minutes(-60),
        status === 'ended' ? minutes(-1) : null,
      ],
    );
    return id;
  }

  async function memberOrg(id: string = randomUUID(), name = 'Second N2 brand'): Promise<string> {
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      id,
      name,
      f.ids.owner,
      randomUUID(),
    ]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      id,
      f.ids.owner,
    ]);
    return id;
  }

  const deny = (organizationId: string, features: string[]) =>
    f.sql.query('insert into brand_feature_policies (organization_id, denied_features) values ($1, $2)', [
      organizationId,
      features,
    ]);
  const plan = (organizationId: string, planId: string) =>
    f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, started_on) values ($1, $2, ((now() at time zone 'Asia/Seoul')::date - 1))",
      [organizationId, planId],
    );

  const postDismiss = (announcementId: unknown, organizationId: unknown = f.orgId) =>
    workspaceRoute.POST(
      new NextRequest('https://brand.twings.app/api/brand-workspace', {
        method: 'POST',
        headers: { origin: 'https://brand.twings.app', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ operation: 'news.dismiss', input: { organizationId, announcementId } }),
      }),
    );

  it('contracts list both slots and slot-specific audience defaults', () => {
    expect(BRAND_NEWS_SLOTS).toEqual(['home', 'team_home']);
    expect(audienceAdmits({}, { organizationId: f.orgId, plan: 'none', modes: ['make'] }, 'home')).toBe(true);
    expect(audienceAdmits({}, { organizationId: f.orgId, plan: 'none', modes: ['team'] }, 'home')).toBe(false);
    expect(audienceAdmits({}, { organizationId: f.orgId, plan: 'none', modes: ['team'] }, 'team_home')).toBe(true);
    expect(audienceAdmits({}, { organizationId: f.orgId, plan: 'none', modes: ['make'] }, 'team_home')).toBe(false);
    expect(audienceAdmits({ modes: ['make'] }, { organizationId: f.orgId, plan: 'none', modes: ['team'] }, 'team_home')).toBe(false);
  });

  it('shows each slot only its own live announcement, and keeps both live independently', async () => {
    const homeId = await announce({ slot: 'home', titleKo: '직접 만들기 소식', titleEn: 'Make home news' });
    const teamId = await announce({ slot: 'team_home', titleKo: '야기 팀과 소식', titleEn: 'Team home news' });

    const makeDefault = await loadHomeAnnouncement(
      { sql: f.sql, imageUrl: media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, mode: 'make', locale: 'ko' },
    );
    const makeExplicit = await loadHomeAnnouncement(
      { sql: f.sql, imageUrl: media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, mode: 'make', locale: 'ko' },
      'home',
    );
    const teamExplicit = await loadHomeAnnouncement(
      { sql: f.sql, imageUrl: media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, mode: 'team', locale: 'ko' },
      'team_home',
    );
    const teamWithWrongMode = await loadHomeAnnouncement(
      { sql: f.sql, imageUrl: media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, mode: 'make', locale: 'ko' },
      'team_home',
    );

    expect(makeDefault?.id).toBe(homeId);
    expect(makeExplicit?.id).toBe(homeId);
    expect(teamExplicit?.id).toBe(teamId);
    expect(teamWithWrongMode).toBeNull();

    // Closing one slot's announcement leaves the other slot's announcement visible.
    const res = await postDismiss(homeId);
    expect(res.status).toBe(200);
    expect(
      await loadHomeAnnouncement(
        { sql: f.sql, imageUrl: media },
        viewerOf(f.ids.owner),
        { organizationId: f.orgId, mode: 'make', locale: 'ko' },
        'home',
      ),
    ).toBeNull();
    expect(
      (
        await loadHomeAnnouncement(
          { sql: f.sql, imageUrl: media },
          viewerOf(f.ids.owner),
          { organizationId: f.orgId, mode: 'team', locale: 'ko' },
          'team_home',
        )
      )?.id,
    ).toBe(teamId);
  });

  it('defaults team_home to team-mode organizations, narrows by plans/orgs, and returns null when BRAND_ROOMS is off', async () => {
    const teamOrg = await memberOrg();
    await plan(teamOrg, 'b2b_49');
    const teamId = await announce({ slot: 'team_home', audience: { plans: ['b2b_49'], orgs: [teamOrg] } });

    expect(
      (
        await loadHomeAnnouncement(
          { sql: f.sql, imageUrl: media },
          viewerOf(f.ids.owner),
          { organizationId: teamOrg, mode: 'team', locale: 'ko' },
          'team_home',
        )
      )?.id,
    ).toBe(teamId);
    expect(
      await loadHomeAnnouncement(
        { sql: f.sql, imageUrl: media },
        viewerOf(f.ids.owner),
        { organizationId: f.orgId, mode: 'team', locale: 'ko' },
        'team_home',
      ),
    ).toBeNull();

    vi.stubEnv('BRAND_ROOMS', 'off');
    expect(
      await loadHomeAnnouncement(
        { sql: f.sql, imageUrl: media },
        viewerOf(f.ids.owner),
        { organizationId: teamOrg, mode: 'team', locale: 'ko' },
        'team_home',
      ),
    ).toBeNull();
    expect((await postDismiss(teamId, teamOrg)).status).toBe(404);
  });

  it('returns null without reading announcements for closed orgs, guests, staff, and outsiders in team_home too', async () => {
    const sandboxed = await memberOrg([...SANDBOXED_CLIENT_ORG_IDS][0]!);
    const noGen = await memberOrg();
    await deny(noGen, ['generative_media']);
    const noSelf = await memberOrg();
    await deny(noSelf, ['self_studio']);
    const projectOnly = await memberOrg();
    await plan(projectOnly, 'project_only');

    await announce({
      slot: 'team_home',
      audience: { orgs: [f.orgId, sandboxed, noGen, noSelf, projectOnly] },
    });

    for (const orgId of [sandboxed, noGen, noSelf, projectOnly]) {
      const r = recording(f.sql);
      expect(
        await loadHomeAnnouncement(
          { sql: r.sql, imageUrl: media },
          viewerOf(f.ids.owner),
          { organizationId: orgId, mode: 'team', locale: 'ko' },
          'team_home',
        ),
        orgId,
      ).toBeNull();
      expect(readsAnnouncements(r.texts), orgId).toBe(false);
    }

    const staffViewer: Viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    for (const viewer of [viewerOf(f.ids.guest), staffViewer, viewerOf(f.ids.outsider), { ...viewerOf(f.ids.owner), userId: null }]) {
      const r = recording(f.sql);
      expect(
        await loadHomeAnnouncement(
          { sql: r.sql, imageUrl: media },
          viewer,
          { organizationId: f.orgId, mode: 'team', locale: 'ko' },
          'team_home',
        ),
        String(viewer.userId),
      ).toBeNull();
      expect(readsAnnouncements(r.texts)).toBe(false);
    }
  });

  it('counts reach by slot and returns 0 for team_home when BRAND_ROOMS is off', async () => {
    const sandboxed = await memberOrg([...SANDBOXED_CLIENT_ORG_IDS][0]!);
    const projectOnly = await memberOrg();
    await plan(projectOnly, 'project_only');
    const open49 = await memberOrg();
    await plan(open49, 'b2b_49');

    const teamDraft = await announce({ slot: 'team_home', status: 'draft', audience: {} });
    const team49Draft = await announce({ slot: 'team_home', status: 'draft', audience: { plans: ['b2b_49'] } });
    expect(sandboxed).toBeTruthy();

    expect(await loadBrandNewsReach({ sql: f.sql }, { ...viewerOf(f.ids.admin), isAdmin: true }, teamDraft)).toEqual({
      ok: true,
      organizations: 2,
    });
    expect(await loadBrandNewsReach({ sql: f.sql }, { ...viewerOf(f.ids.admin), isAdmin: true }, team49Draft)).toEqual({
      ok: true,
      organizations: 1,
    });

    vi.stubEnv('BRAND_ROOMS', 'off');
    expect(await countBrandNewsReach(f.sql, {}, process.env, 'team_home')).toBe(0);
    expect(await loadBrandNewsReach({ sql: f.sql }, { ...viewerOf(f.ids.admin), isAdmin: true }, teamDraft)).toEqual({
      ok: true,
      organizations: 0,
    });
  });

  it('Fix 1: counts home reach using mode make only (never team mode)', async () => {
    const adminViewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    const homeTeamDraft = await announce({ slot: 'home', status: 'draft', audience: { modes: ['team'] } });
    const teamTeamDraft = await announce({ slot: 'team_home', status: 'draft', audience: { modes: ['team'] } });

    expect(await countBrandNewsReach(f.sql, { modes: ['team'] }, process.env, 'home')).toBe(0);
    expect(await loadBrandNewsReach({ sql: f.sql }, adminViewer, homeTeamDraft)).toEqual({
      ok: true,
      organizations: 0,
    });
    expect(await countBrandNewsReach(f.sql, { modes: ['team'] }, process.env, 'team_home')).toBe(1);
    expect(await loadBrandNewsReach({ sql: f.sql }, adminViewer, teamTeamDraft)).toEqual({
      ok: true,
      organizations: 1,
    });
  });

  it('treats pre-0204 DB gracefully: team_home read returns null and home read keeps working', async () => {
    const preDb = new PGlite();
    await preDb.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
    for (const file of coreMigrationFiles()) {
      if (Number(file.split('_')[0]) <= 203) await preDb.exec(readMigration(file));
    }
    const preSql = runner(preDb);
    const adminId = randomUUID();
    const ownerId = randomUUID();
    const orgId = randomUUID();
    await seedProfile(preSql, { id: adminId, isAdmin: true, email: 'admin@n2.test' });
    await seedProfile(preSql, { id: ownerId, isAdmin: false, email: 'owner@n2.test' });
    await preSql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      orgId,
      'Pre0204 Brand',
      ownerId,
      randomUUID(),
    ]);
    await preSql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      orgId,
      ownerId,
    ]);
    await preSql.query(
      `insert into brand_announcements (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience, status, created_by, published_at)
       values ($1, 'home', '새', 'New', '기존 홈 소식', 'Home line', '보기', 'View', '/brand/home', 'line', $2, $3, '{}'::jsonb, 'live', $4, $2)`,
      [randomUUID(), minutes(-60), minutes(60 * 24), adminId],
    );

    try {
      expect(await brandNewsSlotsReady(preSql)).toBe(false);
      expect(
        await loadHomeAnnouncement(
          { sql: preSql },
          viewerOf(ownerId),
          { organizationId: orgId, mode: 'team', locale: 'ko' },
          'team_home',
        ),
      ).toBeNull();
      expect(
        (
          await loadHomeAnnouncement(
            { sql: preSql },
            viewerOf(ownerId),
            { organizationId: orgId, mode: 'make', locale: 'ko' },
            'home',
          )
        )?.title,
      ).toBe('기존 홈 소식');
    } finally {
      await preDb.close();
    }
  });
});

describe('Slice N2 admin operations: slots, brandNews.delete, and publish fingerprint check', () => {
  let h: AdminHarness;
  let sql: SqlRunner;

  beforeEach(async () => {
    resetBrandNewsProbe();
    vi.stubEnv('BRAND_NEWS', 'on');
    h = await adminHarness();
    sql = runner(h.db);
    await h.db.query('insert into auth.users (id) values ($1) on conflict do nothing', [ADMIN_VIEWER.userId]);
    await h.db.query('insert into profiles (id, email, is_admin) values ($1, $2, true) on conflict do nothing', [
      ADMIN_VIEWER.userId,
      ADMIN_VIEWER.email,
    ]);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetBrandNewsProbe();
    await h.close();
  });

  const DRAFT: FormFields = {
    slot: 'team_home',
    kickerKo: '새 기능',
    kickerEn: 'New',
    titleKo: '팀 홈 소식 문구',
    titleEn: 'Team home announcement line',
    ctaLabelKo: '열기',
    ctaLabelEn: 'Open',
    ctaHref: '/brand/rooms',
    startsAt: minutes(-5),
    endsAt: minutes(60 * 24 * 7),
  };

  async function createDraft(over: FormFields = {}): Promise<string> {
    const out = await h.run('brandNews.save', { ...DRAFT, ...over });
    if (!out.ok || !out.detail) throw new Error(JSON.stringify(out));
    return out.detail;
  }

  async function updatedAtOf(id: string): Promise<string> {
    const row = (await sql.query<{ updated_at: Date | string }>('select updated_at from brand_announcements where id = $1', [id])).rows[0];
    return new Date(row!.updated_at).toISOString();
  }

  it('registers brandNews.delete and gates it to admins and BRAND_NEWS flag', async () => {
    expect(ADMIN_OPERATION_NAMES).toContain('brandNews.delete');
    expect(ADMIN_OPERATIONS['brandNews.delete']).toBe(BRAND_NEWS_OPERATIONS['brandNews.delete']);

    const id = await createDraft();
    for (const tier of ['anon', 'free', 'pro'] as const) {
      expect(await h.run('brandNews.delete', { id }, adminViewerOf(tier))).toEqual({ ok: false, code: 'forbidden' });
    }

    vi.stubEnv('BRAND_NEWS', 'off');
    expect(await h.run('brandNews.delete', { id: 'not-a-uuid' })).toEqual({
      ok: false,
      code: 'disabled',
      detail: 'BRAND_NEWS',
    });
    expect((await sql.query('select count(*)::int as n from brand_announcements where id = $1', [id])).rows[0]).toEqual({ n: 1 });
  });

  it('saves team_home drafts, keeps slot immutable on edit, and publishes per slot without ending the other slot', async () => {
    expect(await h.run('brandNews.save', { ...DRAFT, slot: 'studio' })).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:slot',
    });

    const homeDraft = await createDraft({ slot: 'home', titleKo: '직접 홈 소식', titleEn: 'Make home' });
    const teamDraft1 = await createDraft({ slot: 'team_home', titleKo: '팀 홈 소식 1', titleEn: 'Team home 1' });
    const teamDraft2 = await createDraft({ slot: 'team_home', titleKo: '팀 홈 소식 2', titleEn: 'Team home 2' });

    expect(
      await h.run('brandNews.save', { ...DRAFT, id: teamDraft1, slot: 'home', titleKo: '변경 시도' }),
    ).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:slot:immutable',
    });

    // Editing without changing slot (either matching or omitted) succeeds.
    expect(
      await h.run('brandNews.save', { ...DRAFT, id: teamDraft1, slot: 'team_home', titleKo: '팀 홈 수정됨' }),
    ).toEqual({
      ok: true,
      code: 'saved',
      detail: teamDraft1,
    });

    expect(
      await h.run('brandNews.publish', { id: homeDraft, expectedUpdatedAt: await updatedAtOf(homeDraft) }),
    ).toMatchObject({ ok: true, code: 'published' });
    expect(
      await h.run('brandNews.publish', { id: teamDraft1, expectedUpdatedAt: await updatedAtOf(teamDraft1) }),
    ).toMatchObject({ ok: true, code: 'published' });

    // Both slots are live simultaneously.
    const live = (
      await sql.query<{ id: string; slot: string }>("select id::text as id, slot from brand_announcements where status = 'live' order by slot")
    ).rows;
    expect(live).toEqual([
      { id: homeDraft, slot: 'home' },
      { id: teamDraft1, slot: 'team_home' },
    ]);

    // Publishing teamDraft2 ends teamDraft1 ONLY, leaving homeDraft live!
    expect(
      await h.run('brandNews.publish', { id: teamDraft2, expectedUpdatedAt: await updatedAtOf(teamDraft2) }),
    ).toMatchObject({ ok: true, code: 'published' });
    const after = (
      await sql.query<{ id: string; slot: string; status: string }>(
        'select id::text as id, slot, status from brand_announcements where id = any($1::uuid[]) order by slot, id',
        [[homeDraft, teamDraft1, teamDraft2]],
      )
    ).rows;
    expect(after).toEqual(
      expect.arrayContaining([
        { id: homeDraft, slot: 'home', status: 'live' },
        { id: teamDraft1, slot: 'team_home', status: 'ended' },
        { id: teamDraft2, slot: 'team_home', status: 'live' },
      ]),
    );
  });

  it('deletes drafts permanently with audit row, and refuses live, ended, unknown, or malformed ids', async () => {
    const draftId = await createDraft();
    const endedId = await createDraft({ titleKo: '끝난 소식', titleEn: 'Ended news' });
    await h.run('brandNews.publish', { id: endedId, expectedUpdatedAt: await updatedAtOf(endedId) });
    await h.run('brandNews.end', { id: endedId });
    const liveId = await createDraft({ titleKo: '켜진 소식', titleEn: 'Live news' });
    await h.run('brandNews.publish', { id: liveId, expectedUpdatedAt: await updatedAtOf(liveId) });

    expect(await h.run('brandNews.delete', { id: 'bad-id' })).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:id',
    });
    expect(await h.run('brandNews.delete', { id: randomUUID() })).toEqual({
      ok: false,
      code: 'notFound',
      detail: 'brandNews:id',
    });
    expect(await h.run('brandNews.delete', { id: liveId })).toEqual({
      ok: false,
      code: 'notDraft',
      detail: 'brandNews:live',
    });
    expect(await h.run('brandNews.delete', { id: endedId })).toEqual({
      ok: false,
      code: 'notDraft',
      detail: 'brandNews:ended',
    });

    const deleted = await h.run('brandNews.delete', { id: draftId });
    expect(deleted).toEqual({ ok: true, code: 'deleted', detail: draftId, to: '/admin/brand-news' });
    expect((await sql.query('select 1 from brand_announcements where id = $1', [draftId])).rows).toEqual([]);

    const audit = (
      await sql.query<{ actor_id: string; action: string; reason: string; details: Record<string, unknown> }>(
        "select actor_id, action, reason, details from platform_audit where entity_id = $1 and action = 'brandNews.delete'",
        [draftId],
      )
    ).rows;
    expect(audit).toEqual([
      {
        actor_id: ADMIN_VIEWER.userId,
        action: 'brandNews.delete',
        reason: 'brand_news_draft_deleted',
        details: { slot: 'team_home', shape: 'line', image: null },
      },
    ]);
  });

  it('requires expectedUpdatedAt on publish and refuses stale or racing edits before publishing', async () => {
    expect(parseExpectedUpdatedAt('2026-11-27T01:00:00.123Z')).toBe('2026-11-27T01:00:00.123Z');
    expect(parseExpectedUpdatedAt('2026-11-27T10:00')).toBeNull();
    expect(parseExpectedUpdatedAt('not-a-date')).toBeNull();

    const id = await createDraft({ titleKo: '초안 v1', titleEn: 'Draft v1' });
    const list1 = await loadBrandNewsAdmin({ sql }, ADMIN_VIEWER);
    if (!list1.ok) throw new Error(list1.code);
    const t1 = list1.items.find((i) => i.id === id)!.updatedAt;

    // Missing or malformed fingerprint refused.
    expect(await h.run('brandNews.publish', { id })).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:expectedUpdatedAt',
    });
    expect(await h.run('brandNews.publish', { id, expectedUpdatedAt: 'bad-timestamp' })).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:expectedUpdatedAt',
    });

    // Wrong (stale) fingerprint refused without side effects.
    expect(await h.run('brandNews.publish', { id, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })).toEqual({
      ok: false,
      code: 'staleReview',
      detail: 'brandNews:stale',
    });
    expect((await sql.query<{ status: string }>('select status from brand_announcements where id = $1', [id])).rows[0]!.status).toBe('draft');

    // Race simulation: Admin A read t1, Admin B saves an edit immediately, Admin A tries to publish with t1 -> refused!
    expect(await h.run('brandNews.save', { ...DRAFT, id, titleKo: '다른 관리자 수정', titleEn: 'Other admin edit' })).toMatchObject({
      ok: true,
      code: 'saved',
    });
    expect(await h.run('brandNews.publish', { id, expectedUpdatedAt: t1 })).toEqual({
      ok: false,
      code: 'staleReview',
      detail: 'brandNews:stale',
    });
    expect((await sql.query<{ status: string }>('select status from brand_announcements where id = $1', [id])).rows[0]!.status).toBe('draft');

    // Re-reading updatedAt t2 and publishing with t2 succeeds.
    const list2 = await loadBrandNewsAdmin({ sql }, ADMIN_VIEWER);
    if (!list2.ok) throw new Error(list2.code);
    const t2 = list2.items.find((i) => i.id === id)!.updatedAt;
    expect(t2).not.toBe(t1);
    expect(await h.run('brandNews.publish', { id, expectedUpdatedAt: t2 })).toEqual({
      ok: true,
      code: 'published',
      detail: id,
    });
  });

  it('refuses slot=team_home save and brandNews.delete when migration 0204 is not yet applied', async () => {
    const preDb = new PGlite();
    await preDb.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
    for (const file of coreMigrationFiles()) {
      if (Number(file.split('_')[0]) <= 203) await preDb.exec(readMigration(file));
    }
    const preSql = runner(preDb);
    await seedProfile(preSql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    const draftId = randomUUID();
    await preSql.query(
      `insert into brand_announcements (id, slot, title_ko, title_en, cta_href, starts_at, ends_at, created_by)
       values ($1, 'home', '초안', 'Draft', '/brand/home', $2, $3, $4)`,
      [draftId, minutes(-10), minutes(60), ADMIN_VIEWER.userId!],
    );

    try {
      const ctx = { ...h.ctx(), sql: preSql };
      expect(await dispatchAdmin('brandNews.save', formOf('brandNews.save', { ...DRAFT, slot: 'team_home' }), ctx)).toEqual({
        ok: false,
        code: 'disabled',
        detail: 'brandNews:migration 0204/0205 not applied',
      });
      expect(await dispatchAdmin('brandNews.delete', formOf('brandNews.delete', { id: draftId }), ctx)).toEqual({
        ok: false,
        code: 'disabled',
        detail: 'brandNews:migration 0204/0205 not applied',
      });

      // Fix 2: staleness check still compares expectedUpdatedAt on pre-0204 DB whenever caller sends it,
      // while omitted expectedUpdatedAt continues to publish as before.
      const rowBefore = (
        await preSql.query<{ updated_at: Date | string }>('select updated_at from brand_announcements where id = $1', [draftId])
      ).rows[0]!;
      expect(
        await dispatchAdmin(
          'brandNews.publish',
          formOf('brandNews.publish', { id: draftId, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }),
          ctx,
        ),
      ).toEqual({
        ok: false,
        code: 'staleReview',
        detail: 'brandNews:stale',
      });
      expect(
        await dispatchAdmin('brandNews.publish', formOf('brandNews.publish', { id: draftId }), ctx),
      ).toEqual({
        ok: true,
        code: 'published',
        detail: draftId,
      });
      expect(new Date(rowBefore.updated_at).toISOString()).toBeTruthy();
    } finally {
      await preDb.close();
    }
  });

  it('Fix 1: refuses non-make modes on home slot for both save and publish, and surfaces stored legacy rows cleanly', async () => {
    const adminViewer = adminViewerOf('admin');
    for (const bad of [{ audienceModes: ['team'] }, { audienceModes: ['make', 'team'] }, { audience: '{"modes":["team"]}' }] as FormFields[]) {
      expect(await h.run('brandNews.save', { ...DRAFT, slot: 'home', ...bad })).toEqual({
        ok: false,
        code: 'invalid',
        detail: 'brandNews:audience:modes',
      });
      // Default omitted slot -> 'home'
      expect(await h.run('brandNews.save', { ...DRAFT, slot: '', ...bad })).toEqual({
        ok: false,
        code: 'invalid',
        detail: 'brandNews:audience:modes',
      });
    }

    // Stored legacy home draft containing 'team' loads cleanly in admin list with publish refusal, and publish refuses.
    const homeDraft = await createDraft({ slot: 'home', audienceModes: ['make'] });
    await sql.query('update brand_announcements set audience = $2::jsonb where id = $1', [
      homeDraft,
      JSON.stringify({ modes: ['make', 'team'] }),
    ]);

    // Saving edits to that home draft with team mode still refused (even when slot omitted on edit).
    expect(
      await h.run('brandNews.save', { ...DRAFT, id: homeDraft, slot: '', audienceModes: ['team'] }),
    ).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:audience:modes',
    });

    const list = await loadBrandNewsAdmin({ sql }, adminViewer);
    if (!list.ok) throw new Error(list.code);
    const item = list.items.find((i) => i.id === homeDraft)!;
    expect(item.audience).toEqual({ modes: ['make', 'team'] });
    expect(item.publishable).toEqual({ ok: false, reasons: ['audienceModes'] });

    expect(await h.run('brandNews.publish', { id: homeDraft, expectedUpdatedAt: await updatedAtOf(homeDraft) })).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'brandNews:audience:modes',
    });
  });

  it('Fix 3: catches 23514 on brand_announcements_slot after probe cache, resets probe, and returns disabled', async () => {
    // Prime cached slotsReady = true against migrated DB.
    expect(await brandNewsSlotsReady(sql)).toBe(true);

    let failNextInsert = true;
    const queries: string[] = [];
    const rollbackSql = (inner: SqlRunner): SqlRunner => ({
      query: async <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
        queries.push(text.replace(/\s+/g, ' ').trim());
        if (failNextInsert && /insert into brand_announcements/i.test(text)) {
          failNextInsert = false;
          throw Object.assign(
            new Error('new row for relation "brand_announcements" violates check constraint "brand_announcements_slot"'),
            { code: '23514', constraint: 'brand_announcements_slot' },
          );
        }
        return inner.query<T>(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(rollbackSql(tx))),
    });

    const outcome = await dispatchAdmin(
      'brandNews.save',
      formOf('brandNews.save', { ...DRAFT, slot: 'team_home' }),
      { ...h.ctx(), sql: rollbackSql(sql) },
    );
    expect(outcome).toEqual({
      ok: false,
      code: 'disabled',
      detail: 'brandNews:migration 0204/0205 not applied',
    });

    // Cached slots probe was reset, so the next check re-queries pg_constraint.
    queries.length = 0;
    await brandNewsSlotsReady(rollbackSql(sql));
    expect(queries.some((q) => /pg_constraint/.test(q))).toBe(true);
    resetBrandNewsSlotsProbe();
  });
});
