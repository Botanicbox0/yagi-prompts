import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import {
  BRAND_NEWS_CLOSED,
  countBrandNewsReach,
  dismissHomeAnnouncement,
  loadHomeAnnouncement,
  resetBrandNewsProbe,
} from '@/lib/brand-news/service';
import { studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §6, slice 3b (server half): the home's news slot as a member meets it. Pinned:
 *  - the read answers null, without reading a single announcement row, for every closed door: the switch off (no
 *    statement at all), the tables missing, a sandboxed organization, generation closed, 직접 만들기 closed (policy or
 *    a project-only plan), a project guest, TWINGS staff who are not members, an outsider, a made-up organization;
 *  - members get the live announcement inside its period whose audience takes them (modes, plans, orgs), that they
 *    have not closed themselves; among several, the most recently started; past its end it is gone, pressed or not;
 *  - the answer is the line and nothing else: no audience, author or other organization, in the viewer's language with
 *    a fallback, an internal link scoped to this organization, a banner only where its picture has an address;
 *  - a constant number of statements;
 *  - closing: idempotent, for that person only, and every id they could not have been shown gets the unknown id's
 *    answer; while the slot is closed the route answers exactly like an unknown operation.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));
const workspaceRoute = await import('@/app/api/brand-workspace/route');

let f: StudioFixture;
const media = (key: string) => `https://media.example.test/${key}`;

beforeEach(async () => {
  resetBrandNewsProbe();
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  open();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  await f.db.close();
  mocks.sql = null;
  mocks.viewer = null;
});

function open() {
  vi.stubEnv('BRAND_NEWS', 'on');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_ROOMS', 'off');
}
const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

/** Records every statement sent through it. */
function recording(inner: SqlRunner) {
  const texts: string[] = [];
  const wrap = (runner: SqlRunner): SqlRunner => ({
    query: (text, params) => {
      texts.push(text.replace(/\s+/g, ' ').trim());
      return runner.query(text, params);
    },
    transaction: (fn) => runner.transaction((tx) => fn(wrap(tx))),
  });
  return { texts, sql: wrap(inner) };
}
const readsAnnouncements = (texts: string[]) => texts.some((t) => /brand_announcement/.test(t) && !/information_schema/.test(t));

interface Over {
  status?: 'draft' | 'live' | 'ended';
  startsAt?: string;
  endsAt?: string;
  audience?: unknown;
  kickerKo?: string;
  kickerEn?: string;
  titleKo?: string;
  titleEn?: string;
  ctaLabelKo?: string;
  ctaLabelEn?: string;
  href?: string;
  shape?: 'line' | 'banner';
  imageKey?: string | null;
}
/** An announcement written straight into the table (the admin operations have their own tests). */
async function announce(over: Over = {}): Promise<string> {
  const id = randomUUID();
  const status = over.status ?? 'live';
  const banner = over.shape === 'banner';
  const imageKey = banner ? (over.imageKey === undefined ? `${'b'.repeat(64)}.webp` : over.imageKey) : null;
  await f.sql.query(
    `insert into brand_announcements (id, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, image_key, image_w, image_h,
       starts_at, ends_at, audience, status, created_by, published_at, ended_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19)`,
    [
      id,
      over.kickerKo ?? '새 기능',
      over.kickerEn ?? 'New',
      over.titleKo ?? '영상 스튜디오에 참고 영상 모드가 생겼습니다',
      over.titleEn ?? 'The video studio can start from a reference film',
      over.ctaLabelKo ?? '써 보기',
      over.ctaLabelEn ?? 'Try it',
      over.href ?? '/brand/studio/video?start=reverse',
      over.shape ?? 'line',
      imageKey,
      imageKey ? 1600 : null,
      imageKey ? 400 : null,
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
const read = (viewer: Viewer = owner(), organizationId = f.orgId, extra: { mode?: 'make' | 'team'; locale?: 'ko' | 'en'; sql?: SqlRunner } = {}) =>
  loadHomeAnnouncement({ sql: extra.sql ?? f.sql, imageUrl: media }, viewer, { organizationId, mode: extra.mode ?? 'make', locale: extra.locale ?? 'ko' });
const idOf = async (viewer?: Viewer, organizationId?: string, extra?: Parameters<typeof read>[2]) => (await read(viewer, organizationId, extra))?.id ?? null;

async function memberOrg(id: string = randomUUID(), name = 'Second fixture brand'): Promise<string> {
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  return id;
}
const deny = (organizationId: string, features: string[]) =>
  f.sql.query('insert into brand_feature_policies (organization_id, denied_features) values ($1, $2)', [organizationId, features]);
const plan = (organizationId: string, planId: string) =>
  f.sql.query("insert into brand_plan_assignments (organization_id, plan_id, started_on) values ($1, $2, ((now() at time zone 'Asia/Seoul')::date - 1))", [
    organizationId,
    planId,
  ]);

/* ------------------------------------------------------------ closed doors */

describe('who never gets an announcement (and no announcement row is read for them)', () => {
  it('nobody while the switch is off: no statement at all', async () => {
    await announce();
    vi.stubEnv('BRAND_NEWS', 'off');
    const r = recording(f.sql);
    expect(await read(owner(), f.orgId, { sql: r.sql })).toBeNull();
    expect(r.texts).toEqual([]);
    vi.stubEnv('BRAND_NEWS', 'ON');
    expect(await read(owner(), f.orgId, { sql: r.sql })).toBeNull();
    expect(r.texts).toEqual([]);
  });

  it('nobody while the tables are missing (the code may ship before 0196): the probe only, looked up again after a minute', async () => {
    await f.sql.query('drop table brand_announcement_dismissals');
    await f.sql.query('drop table brand_announcements');
    const r = recording(f.sql);
    expect(await read(owner(), f.orgId, { sql: r.sql })).toBeNull();
    expect(r.texts).toHaveLength(1);
    expect(r.texts[0]).toContain('information_schema.tables');
    expect(readsAnnouncements(r.texts)).toBe(false);
    // Remembered: a second read inside the minute asks nothing.
    expect(await read(owner(), f.orgId, { sql: r.sql })).toBeNull();
    expect(r.texts).toHaveLength(1);
  });

  it('closed organizations: sandboxed, generation closed, 직접 만들기 closed by policy or by a project-only plan', async () => {
    await announce();
    const sandboxed = await memberOrg([...SANDBOXED_CLIENT_ORG_IDS][0]!);
    const noGeneration = await memberOrg();
    await deny(noGeneration, ['generative_media']);
    const noSelfStudio = await memberOrg();
    await deny(noSelfStudio, ['self_studio']);
    const projectOnly = await memberOrg();
    await plan(projectOnly, 'project_only');
    // Even an audience that names them does not open the door.
    await f.sql.query("update brand_announcements set audience = $1::jsonb where status = 'live'", [JSON.stringify({ orgs: [sandboxed, noGeneration, noSelfStudio, projectOnly] })]);
    for (const organizationId of [sandboxed, noGeneration, noSelfStudio, projectOnly]) {
      const r = recording(f.sql);
      expect(await read(owner(), organizationId, { sql: r.sql }), organizationId).toBeNull();
      expect(readsAnnouncements(r.texts), organizationId).toBe(false);
    }
  });

  it('people who are not members: a project guest, TWINGS staff, an outsider, nobody signed in', async () => {
    await announce();
    for (const viewer of [viewerOf(f.ids.guest), staff(), viewerOf(f.ids.outsider), { ...owner(), userId: null }]) {
      const r = recording(f.sql);
      expect(await read(viewer, f.orgId, { sql: r.sql }), String(viewer.userId)).toBeNull();
      expect(readsAnnouncements(r.texts)).toBe(false);
    }
    // A membership that ended is no membership.
    await f.sql.query("update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2", [f.orgId, f.ids.editor]);
    expect(await read(viewerOf(f.ids.editor))).toBeNull();
  });

  it('a made-up organization, an organization of someone else, malformed ids', async () => {
    await announce();
    const other = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other fixture brand', f.ids.outsider, randomUUID()]);
    for (const organizationId of [randomUUID(), other, 'not-a-uuid', '', f.orgId.replace(/-/g, '')]) {
      const r = recording(f.sql);
      expect(await read(owner(), organizationId, { sql: r.sql }), organizationId).toBeNull();
      expect(readsAnnouncements(r.texts)).toBe(false);
    }
  });

  it('nobody while the studio is off (the home itself is 404 then), and the 야기 팀과 home only while rooms are open', async () => {
    const id = await announce({ audience: { modes: ['make', 'team'] } });
    expect(await idOf(owner(), f.orgId, { mode: 'team' })).toBeNull();
    vi.stubEnv('BRAND_ROOMS', 'on');
    expect(await idOf(owner(), f.orgId, { mode: 'team' })).toBe(id);
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect(await read()).toBeNull();
    expect(await read(owner(), f.orgId, { mode: 'team' })).toBeNull();
  });
});

/* ---------------------------------------------------------------- audience */

describe('members, by audience', () => {
  it('every member of an open organization, on the 직접 만들기 home, by default', async () => {
    const id = await announce();
    for (const user of [f.ids.owner, f.ids.editor, f.ids.viewer]) expect(await idOf(viewerOf(user)), user).toBe(id);
    vi.stubEnv('BRAND_ROOMS', 'on');
    expect(await idOf(owner(), f.orgId, { mode: 'team' })).toBeNull(); // the default audience is the 직접 만들기 home only
  });

  it('modes: the homes it names, and only those', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const teamOnly = await announce({ audience: { modes: ['team'] } });
    expect(await idOf()).toBeNull();
    expect(await idOf(owner(), f.orgId, { mode: 'team' })).toBe(teamOnly);
    await f.sql.query("update brand_announcements set audience = '{\"modes\":[\"make\"]}' where id = $1", [teamOnly]);
    expect(await idOf()).toBe(teamOnly);
    expect(await idOf(owner(), f.orgId, { mode: 'team' })).toBeNull();
  });

  it('plans: only organizations on one of them today (none = no active plan)', async () => {
    const id = await announce({ audience: { plans: ['b2b_49'] } });
    expect(await idOf()).toBeNull(); // no plan
    await plan(f.orgId, 'b2b_29');
    expect(await idOf()).toBeNull();
    await f.sql.query("update brand_plan_assignments set plan_id = 'b2b_49' where organization_id = $1", [f.orgId]);
    expect(await idOf()).toBe(id);
    // A plan that has ended, or not started yet, is no plan.
    await f.sql.query("update brand_plan_assignments set ends_on = (now() at time zone 'Asia/Seoul')::date where organization_id = $1", [f.orgId]);
    expect(await idOf()).toBeNull();
    await f.sql.query("update brand_announcements set audience = '{\"plans\":[\"none\"]}' where id = $1", [id]);
    expect(await idOf()).toBe(id);
    await f.sql.query("update brand_plan_assignments set ends_on = null, started_on = (now() at time zone 'Asia/Seoul')::date + 1 where organization_id = $1", [f.orgId]);
    expect(await idOf()).toBe(id);
  });

  it('orgs: ONLY the organizations listed (how one is tried on a test organization first)', async () => {
    const test = await memberOrg();
    const id = await announce({ audience: { orgs: [test.toUpperCase()] } });
    expect(await idOf(owner(), test)).toBe(id);
    expect(await idOf(owner(), f.orgId)).toBeNull();
    await f.sql.query('update brand_announcements set audience = $2::jsonb where id = $1', [id, JSON.stringify({ orgs: [f.orgId, test], plans: ['b2b_69'] })]);
    expect(await idOf(owner(), f.orgId)).toBeNull(); // every key narrows
    await plan(f.orgId, 'b2b_69');
    expect(await idOf(owner(), f.orgId)).toBe(id);
  });

  it('an audience written by hand with a key the server does not know is never shown (fail closed)', async () => {
    await announce({ audience: { orgs: [f.orgId], region: ['kr'] } });
    expect(await read()).toBeNull();
    await f.sql.query("update brand_announcements set audience = '{\"modes\":\"make\"}'");
    expect(await read()).toBeNull();
    await f.sql.query("update brand_announcements set audience = '{\"modes\":[]}'");
    expect(await read()).toBeNull();
  });
});

/* ------------------------------------------------------- time and choice */

describe('which one, and when', () => {
  it('before, within and after its period; a past period ends it for the read even if nobody pressed end', async () => {
    const id = await announce({ startsAt: minutes(10), endsAt: minutes(60) });
    expect(await read()).toBeNull();
    await f.sql.query('update brand_announcements set starts_at = $2 where id = $1', [id, minutes(-1)]);
    expect(await idOf()).toBe(id);
    await f.sql.query('update brand_announcements set starts_at = $2, ends_at = $3 where id = $1', [id, minutes(-120), minutes(-1)]);
    expect(await read()).toBeNull();
    expect((await f.sql.query<{ status: string }>('select status from brand_announcements where id = $1', [id])).rows[0]!.status).toBe('live');
  });

  it('drafts and ended ones never show', async () => {
    await announce({ status: 'draft' });
    await announce({ status: 'ended' });
    expect(await read()).toBeNull();
  });

  it('closed by me: gone for me, not for a colleague', async () => {
    const id = await announce();
    await f.sql.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [id, f.ids.owner]);
    expect(await read()).toBeNull();
    expect(await idOf(viewerOf(f.ids.editor))).toBe(id);
  });

  it('two candidates: the one started later (the unique index normally keeps it to one; dropped here to prove the order)', async () => {
    await f.sql.query('drop index brand_announcements_one_live');
    const earlier = await announce({ startsAt: minutes(-120) });
    const later = await announce({ startsAt: minutes(-30) });
    expect(await idOf()).toBe(later);
    // Closing the later one shows the earlier one; one the audience refuses is skipped.
    await f.sql.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [later, f.ids.owner]);
    expect(await idOf()).toBe(earlier);
    await f.sql.query('update brand_announcements set audience = $2::jsonb where id = $1', [earlier, JSON.stringify({ orgs: [randomUUID()] })]);
    expect(await read()).toBeNull();
    expect(earlier).not.toBe(later);
  });

  it('a stored link the rule refuses is never drawn (the table check lets a dot segment through; the server does not)', async () => {
    await announce({ href: '/brand/../admin' });
    expect(await read()).toBeNull();
  });
});

/* ------------------------------------------------------------------ answer */

describe('the answer', () => {
  it('is the line and nothing else, in the viewer’s language', async () => {
    const other = await memberOrg();
    const id = await announce({ audience: { orgs: [f.orgId, other], plans: ['none'], modes: ['make'] } });
    const ko = (await read()) as HomeAnnouncement;
    expect(ko).toEqual({
      id,
      kicker: '새 기능',
      title: '영상 스튜디오에 참고 영상 모드가 생겼습니다',
      ctaLabel: '써 보기',
      href: `/brand/studio/video?start=reverse&organizationId=${f.orgId}`,
      external: false,
      shape: 'line',
      image: null,
    });
    const en = (await read(viewerOf(f.ids.viewer, 'en'), f.orgId, { locale: 'en' })) as HomeAnnouncement;
    expect(en).toMatchObject({ kicker: 'New', title: 'The video studio can start from a reference film', ctaLabel: 'Try it' });
    // Nothing about the audience, the author, another organization or the period.
    for (const answer of [ko, en]) {
      const text = JSON.stringify(answer);
      for (const secret of [other, f.ids.admin, 'audience', 'orgs', 'plans', 'created', 'starts', 'ends', 'status']) expect(text).not.toContain(secret);
    }
  });

  it('falls back to the other language, and to the screen’s defaults when both are empty', async () => {
    await announce({ kickerKo: '', kickerEn: 'New', ctaLabelKo: '', ctaLabelEn: '' });
    expect(await read()).toMatchObject({ kicker: 'New', ctaLabel: null });
    await f.sql.query("update brand_announcements set kicker_en = ''");
    expect(await read()).toMatchObject({ kicker: null });
  });

  it('keeps an https address on twings.app as it is, marked external', async () => {
    await announce({ href: 'https://twings.app/ko/templates?from=brand#top' });
    expect(await read()).toMatchObject({ href: 'https://twings.app/ko/templates?from=brand#top', external: true });
  });

  it('a banner carries its picture’s address and size; where nothing serves the picture it is drawn as a line', async () => {
    const key = `${'c'.repeat(64)}.webp`;
    await announce({ shape: 'banner', imageKey: key });
    expect(await read()).toMatchObject({ shape: 'banner', image: { url: `https://media.example.test/${key}`, width: 1600, height: 400 } });
    const local = await loadHomeAnnouncement({ sql: f.sql, imageUrl: () => null }, owner(), { organizationId: f.orgId, mode: 'make', locale: 'ko' });
    expect(local).toMatchObject({ shape: 'line', image: null });
  });

  it('asks the database a fixed number of times, whatever is stored', async () => {
    const count = async () => {
      const r = recording(f.sql);
      await read(owner(), f.orgId, { sql: r.sql });
      return r.texts.length;
    };
    await count(); // warm the table probe
    await announce();
    const one = await count();
    for (let i = 0; i < 6; i += 1) await announce({ status: i % 2 ? 'ended' : 'draft' });
    for (const user of [f.ids.editor, f.ids.viewer]) {
      const id = (await f.sql.query<{ id: string }>("select id from brand_announcements where status = 'live'")).rows[0]!.id;
      await f.sql.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [id, user]);
    }
    expect(await count()).toBe(one);
    expect(one).toBeLessThanOrEqual(8);
  });
});

/* ---------------------------------------------------------------- dismiss */

const post = (body: unknown) =>
  workspaceRoute.POST(
    new NextRequest('https://brand.twings.app/api/brand-workspace', {
      method: 'POST',
      headers: { origin: 'https://brand.twings.app', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(body),
    }),
  );
const dismiss = (announcementId: unknown, organizationId: unknown = f.orgId) => post({ operation: 'news.dismiss', input: { organizationId, announcementId } });
const answerOf = async (response: Response) => ({ status: response.status, body: await response.json() });

describe('closing an announcement', () => {
  it('records it for that person, once, and answers the same again', async () => {
    const id = await announce();
    expect(await answerOf(await dismiss(id))).toEqual({ status: 200, body: { ok: true } });
    expect(await answerOf(await dismiss(id.toUpperCase()))).toEqual({ status: 200, body: { ok: true } });
    expect((await f.sql.query('select user_id from brand_announcement_dismissals where announcement_id = $1', [id])).rows).toEqual([{ user_id: f.ids.owner }]);
    expect(await read()).toBeNull();
    expect(await idOf(viewerOf(f.ids.editor))).toBe(id);
  });

  it('answers everything this person could not have been shown exactly like a made-up id', async () => {
    const madeUp = await answerOf(await dismiss(randomUUID()));
    expect(madeUp).toEqual({ status: 404, body: { ok: false, code: 'not_found' } });
    const other = await memberOrg();
    /** A live one, after ending whatever was live (one per slot). */
    const liveOne = async (over: Over = {}) => {
      await f.sql.query("update brand_announcements set status = 'ended', ended_at = now() where status = 'live'");
      return announce(over);
    };
    const cases: Array<[string, () => Promise<Response>]> = [
      ['malformed', () => dismiss('not-a-uuid')],
      ['missing', () => post({ operation: 'news.dismiss', input: { organizationId: f.orgId } })],
      ['draft', async () => dismiss(await announce({ status: 'draft' }))],
      ['ended', async () => dismiss(await announce({ status: 'ended' }))],
      ['not started', async () => dismiss(await liveOne({ startsAt: minutes(30) }))],
      ['another audience', async () => dismiss(await liveOne({ audience: { orgs: [other] } }))],
      ['another plan', async () => dismiss(await liveOne({ audience: { plans: ['b2b_69'] } }))],
    ];
    for (const [name, call] of cases) expect(await answerOf(await call()), name).toEqual(madeUp);

    // A live one, asked about from the wrong place or by the wrong person.
    const id = await liveOne({ audience: { orgs: [f.orgId] } });
    expect(await answerOf(await dismiss(id, other)), 'other organization').toEqual(madeUp);
    expect(await answerOf(await dismiss(id, 'nope')), 'malformed organization').toEqual(madeUp);
    for (const viewer of [viewerOf(f.ids.guest), staff(), viewerOf(f.ids.outsider)]) {
      mocks.viewer = viewer;
      expect(await answerOf(await dismiss(id)), String(viewer.userId)).toEqual(madeUp);
    }
    mocks.viewer = owner();
    // Past its end, team-only while rooms are off, or in a closed organization: same.
    await f.sql.query('update brand_announcements set audience = $2::jsonb where id = $1', [id, JSON.stringify({ modes: ['team'] })]);
    expect(await answerOf(await dismiss(id)), 'team only, rooms off').toEqual(madeUp);
    await f.sql.query("update brand_announcements set audience = '{}', starts_at = $2, ends_at = $3 where id = $1", [id, minutes(-120), minutes(-1)]);
    expect(await answerOf(await dismiss(id)), 'past its end').toEqual(madeUp);
    await f.sql.query('update brand_announcements set starts_at = $2, ends_at = $3 where id = $1', [id, minutes(-120), minutes(120)]);
    await deny(f.orgId, ['generative_media']);
    expect(await answerOf(await dismiss(id)), 'generation closed').toEqual(madeUp);
    expect((await f.sql.query('select count(*)::int as n from brand_announcement_dismissals')).rows[0]).toEqual({ n: 0 });
  });

  it('a team-only announcement can be closed while rooms are open (any home the organization has)', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const id = await announce({ audience: { modes: ['team'] } });
    expect(await answerOf(await dismiss(id))).toEqual({ status: 200, body: { ok: true } });
  });

  it('while the slot is closed, answers exactly what an unknown operation answers', async () => {
    const id = await announce();
    const unknown = await answerOf(await post({ operation: 'news.nothing', input: {} }));
    expect(unknown).toEqual({ status: 400, body: { ok: false, code: 'invalid' } });
    vi.stubEnv('BRAND_NEWS', 'off');
    expect(await answerOf(await dismiss(id))).toEqual(unknown);
    expect(await answerOf(await dismiss(randomUUID()))).toEqual(unknown);
    vi.stubEnv('BRAND_NEWS', 'on');
    await f.sql.query('drop table brand_announcement_dismissals');
    await f.sql.query('drop table brand_announcements');
    resetBrandNewsProbe();
    expect(await answerOf(await dismiss(id))).toEqual(unknown);
    // Signed out, the route answers before any operation is looked at, as for every operation.
    mocks.viewer = null;
    expect((await dismiss(id)).status).toBe(401);
    expect((await post({ operation: 'news.nothing', input: {} })).status).toBe(401);
  });

  it('the service says closed without a statement while the switch is off', async () => {
    vi.stubEnv('BRAND_NEWS', 'off');
    const r = recording(f.sql);
    expect(await dismissHomeAnnouncement({ sql: r.sql }, owner(), { organizationId: f.orgId, announcementId: randomUUID() })).toBe(BRAND_NEWS_CLOSED);
    expect(r.texts).toEqual([]);
  });
});

/* ------------------------------------------------------------------ reach */

describe('the admin’s count follows the same rule', () => {
  it('equals the number of organizations whose member gets the announcement, for every kind of audience', async () => {
    const sandboxed = await memberOrg([...SANDBOXED_CLIENT_ORG_IDS][0]!);
    const closed = await memberOrg();
    await deny(closed, ['self_studio']);
    const on49 = await memberOrg();
    await plan(on49, 'b2b_49');
    const empty = randomUUID(); // no member at all
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [empty, 'Empty fixture brand', f.ids.owner, randomUUID()]);
    const orgs = [f.orgId, sandboxed, closed, on49, empty];
    const audiences = [{}, { plans: ['b2b_49'] }, { plans: ['none'] }, { orgs: [on49, closed, sandboxed] }, { modes: ['team'] }, { modes: ['make', 'team'], orgs: [f.orgId] }];
    for (const rooms of ['off', 'on']) {
      vi.stubEnv('BRAND_ROOMS', rooms);
      for (const audience of audiences) {
        await f.sql.query("delete from brand_announcement_dismissals");
        await f.sql.query("update brand_announcements set status = 'ended', ended_at = now() where status = 'live'");
        await announce({ audience });
        let shown = 0;
        for (const organizationId of orgs) {
          const make = await read(owner(), organizationId, { mode: 'make' });
          const team = await read(owner(), organizationId, { mode: 'team' });
          if (make || team) shown += 1;
        }
        expect(await countBrandNewsReach(f.sql, audience as never), `${rooms} ${JSON.stringify(audience)}`).toBe(shown);
      }
    }
    // No home without studio v2: the read answers null and the count is 0.
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect(await read()).toBeNull();
    expect(await countBrandNewsReach(f.sql, {})).toBe(0);
  });
});
