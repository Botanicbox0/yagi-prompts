import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, expectReject, freshDb, glueMigrationFiles } from '../helpers/pglite';

/**
 * docs/BRAND-PROJECT-SPINE.md §6, slice 3b — migrations 0196 (core) and 0197 (glue). Pinned:
 *  - 0196 applies on the full chain, twice, and every rule the design fixes is a table check that refuses a bad row
 *    written by hand (slot, lengths per language, shape, the banner's picture, the period, the state, one live row per
 *    slot, the audience's top-level type, the link's backstop, what a live row must carry);
 *  - a dismissal is one row per (announcement, person), and goes with either;
 *  - 0197 closes both tables to browser roles and gives the server role only select, insert and the update columns.
 */
const CORE = '0196_core_brand_news.sql';
const GLUE = '0197_glue_brand_news.sql';

let db: PGlite;
let admin: string;
let member: string;

beforeEach(async () => {
  db = await freshDb();
  admin = randomUUID();
  member = randomUUID();
  for (const id of [admin, member]) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into profiles (id, email) values ($1, $2)', [id, `${id}@fixture.invalid`]);
  }
});
afterEach(async () => {
  await db.close();
});

const START = '2026-12-01T00:00:00Z';
const END = '2026-12-15T00:00:00Z';

/** A valid draft; `over` replaces columns. Returns its id. */
async function insert(over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    id: randomUUID(),
    title_ko: '새 소식',
    title_en: 'News',
    cta_href: '/brand/home',
    starts_at: START,
    ends_at: END,
    created_by: admin,
    ...over,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into brand_announcements (${keys.join(', ')}) values (${keys.map((k, i) => (k === 'audience' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})`,
    keys.map((k) => row[k]),
  );
  return String(row.id);
}
const live = (over: Record<string, unknown> = {}) => insert({ status: 'live', published_at: START, ...over });
/** The insert is refused, by the named check (so a test cannot pass on another rule's refusal). */
async function refused(over: Record<string, unknown>, constraint: RegExp): Promise<void> {
  expect(await expectReject(() => insert(over)), JSON.stringify(over)).toMatch(constraint);
}

describe('0196 — the tables', () => {
  it('applies after every earlier core file, and a second time without error', async () => {
    const files = coreMigrationFiles();
    expect(files).toContain(CORE);
    expect(files.indexOf(CORE)).toBeGreaterThan(files.indexOf('0194_core_brand_project_spine.sql'));
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
    const draft = await insert();
    expect((await db.query('select slot, shape, status, audience, kicker_ko, published_at from brand_announcements where id = $1', [draft])).rows[0]).toEqual({
      slot: 'home',
      shape: 'line',
      status: 'draft',
      audience: {},
      kicker_ko: '',
      published_at: null,
    });
  });

  it('says on the first line that the cloud needs it applied', () => {
    for (const file of [CORE, GLUE]) expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').startsWith('-- 클라우드 적용 필요'), file).toBe(true);
  });

  it('refuses a slot, shape or state the design does not name', async () => {
    await refused({ slot: 'studio' }, /brand_announcements_slot/);
    await refused({ shape: 'card' }, /brand_announcements_shape/);
    await refused({ status: 'archived' }, /brand_announcements_(status|lifecycle)/);
  });

  it('holds the words to 12 / 60 / 12 characters per language, trimmed, on one line', async () => {
    await insert({ kicker_ko: '가'.repeat(12), kicker_en: 'k'.repeat(12), title_ko: '나'.repeat(60), title_en: 't'.repeat(60), cta_label_ko: '다'.repeat(12), cta_label_en: 'c'.repeat(12) });
    for (const [column, value] of [
      ['kicker_ko', '가'.repeat(13)],
      ['kicker_en', 'k'.repeat(13)],
      ['title_ko', '나'.repeat(61)],
      ['title_en', 't'.repeat(61)],
      ['cta_label_ko', '다'.repeat(13)],
      ['cta_label_en', 'c'.repeat(13)],
      ['title_ko', ' 앞에 공백'],
      ['kicker_en', 'trailing '],
      ['title_en', 'two\nlines'],
      ['cta_label_ko', 'tab\there'],
      ['title_ko', 'line\u2028separator'],
      ['kicker_en', 'para\u2029separator'],
    ] as const) {
      await refused({ [column]: value }, /brand_announcements_(kicker|title|cta_label)/);
    }
  });

  it('keeps the link to /brand/ paths and https on twings.app (the backstop of the server rule)', async () => {
    for (const ok of ['', '/brand/', '/brand/studio/video?start=reverse', 'https://twings.app', 'https://twings.app/ko', 'https://brand.twings.app/brand/billing#plans']) {
      await insert({ cta_href: ok });
    }
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '//evil.example',
      '/brand//evil.example',
      '/admin',
      '/brand',
      'http://twings.app/x',
      'HTTPS://twings.app/x',
      'https://TWINGS.app/x',
      'https://twings.app.evil.example',
      'https://evil.example/twings.app',
      'https://twings.app@evil.example',
      'https://user@twings.app/',
      'https://twings.app:8443/',
      ' /brand/x',
      '/brand/x y',
      '/brand/x\u0001',
      '/brand/x\u007f',
      '/brand/\\x',
      '/brand/한글',
      `/brand/${'x'.repeat(500)}`,
    ]) {
      await refused({ cta_href: bad }, /brand_announcements_cta_href/);
    }
  });

  it('takes a picture only on a banner, all three fields together, at 1600×400', async () => {
    const key = `${'a'.repeat(64)}.webp`;
    await insert({ shape: 'banner', image_key: key, image_w: 1600, image_h: 400 });
    await insert({ shape: 'banner' }); // a banner draft may wait for its picture
    const image = /brand_announcements_image/;
    await refused({ shape: 'line', image_key: key, image_w: 1600, image_h: 400 }, image);
    await refused({ shape: 'banner', image_key: key }, image);
    await refused({ shape: 'banner', image_key: key, image_w: 1600 }, image);
    await refused({ shape: 'banner', image_key: key, image_w: 1601, image_h: 400 }, image);
    await refused({ shape: 'banner', image_key: 'landing/x.webp', image_w: 1600, image_h: 400 }, image);
    await refused({ shape: 'banner', image_key: `${'A'.repeat(64)}.webp`, image_w: 1600, image_h: 400 }, image);
  });

  it('needs both ends of the period, the start first, at most 60 days apart', async () => {
    await insert({ starts_at: START, ends_at: '2027-01-30T00:00:00Z' }); // exactly 60 days
    await refused({ starts_at: START, ends_at: '2027-01-30T00:00:01Z' }, /brand_announcements_period/);
    await refused({ starts_at: START, ends_at: START }, /brand_announcements_period/);
    await refused({ starts_at: END, ends_at: START }, /brand_announcements_period/);
    await refused({ starts_at: null }, /starts_at/);
    await refused({ ends_at: null }, /ends_at/);
  });

  it('stores the audience as an object (its keys are the server’s to judge)', async () => {
    await insert({ audience: JSON.stringify({ orgs: [randomUUID()] }) });
    for (const bad of ['[]', '"make"', '1']) await refused({ audience: bad }, /brand_announcements_audience/);
    await refused({ audience: 'null' }, /audience/);
  });

  it('keeps the lifecycle’s footprints and what a live row must carry', async () => {
    await insert({ status: 'ended', published_at: START, ended_at: END });
    const lifecycle = /brand_announcements_lifecycle/;
    await refused({ status: 'draft', published_at: START }, lifecycle);
    await refused({ status: 'live' }, lifecycle);
    await refused({ status: 'ended', published_at: START }, lifecycle);
    await refused({ status: 'ended', ended_at: END }, lifecycle);
    await refused({ status: 'live', published_at: START, ended_at: END }, lifecycle);
    // What publishing requires, written by hand: both titles, a link, a banner's picture.
    for (const over of [{ title_en: '' }, { title_ko: '' }, { cta_href: '' }, { shape: 'banner' }]) {
      await refused({ status: 'ended', published_at: START, ended_at: END, ...over }, /brand_announcements_publishable/);
      await refused({ status: 'live', published_at: START, ...over }, /brand_announcements_publishable/);
    }
    await insert({ title_en: '', cta_href: '', shape: 'banner' }); // a draft may lack all three
    await live(); // and a complete one goes live
  });

  it('allows one live announcement per slot, any number of drafts and ended ones', async () => {
    const first = await live();
    const message = await expectReject(() => live());
    expect(message).toMatch(/brand_announcements_one_live|duplicate key/);
    await insert();
    await insert();
    await insert({ status: 'ended', published_at: START, ended_at: END });
    await db.query("update brand_announcements set status = 'ended', ended_at = now() where id = $1", [first]);
    await live();
  });

  it('records a dismissal once per person, and lets it go with its announcement or its person', async () => {
    const a = await live();
    await db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [a, member]);
    await expectReject(() => db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [a, member]));
    await expectReject(() => db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [randomUUID(), member]));
    await expectReject(() => db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [a, randomUUID()]));
    await db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [a, admin]);

    // The person's account goes: their dismissal goes, the announcement stays and forgets its author.
    await db.query('delete from profiles where id = $1', [admin]);
    expect((await db.query('select count(*)::int as n from brand_announcement_dismissals where user_id = $1', [admin])).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select created_by from brand_announcements where id = $1', [a])).rows[0]).toEqual({ created_by: null });

    // 0204 blocks deleting an ended announcement even by hand; a draft's dismissals still cascade with its announcement.
    await db.query("update brand_announcements set status = 'ended', ended_at = now() where id = $1", [a]);
    expect(
      await expectReject(() => db.query('delete from brand_announcements where id = $1', [a])),
    ).toMatch(/brand_announcements: only a draft can be deleted/);
    const draft = await insert({ created_by: member });
    await db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [draft, member]);
    await db.query('delete from brand_announcements where id = $1', [draft]);
    expect(
      (await db.query('select count(*)::int as n from brand_announcement_dismissals where announcement_id = $1', [draft])).rows[0],
    ).toEqual({ n: 0 });
  });
});

describe('0197 — glue', () => {
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');
  const statements = glue.replace(/--[^\n]*/g, '');

  it('pairs with 0196 and is a glue file', () => {
    expect(glueMigrationFiles()).toContain(GLUE);
  });

  it('0196 already turns row level security on and forces it, so nothing is open before 0197 lands', () => {
    const core = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
    for (const table of ['brand_announcements', 'brand_announcement_dismissals']) {
      expect(core).toContain(`alter table ${table} enable row level security;`);
      expect(core).toContain(`alter table ${table} force row level security;`);
      expect(core).toContain(`revoke all on ${table} from public;`);
    }
  });

  it('closes both tables to browser roles, with no policy', () => {
    for (const table of ['brand_announcements', 'brand_announcement_dismissals']) expect(glue, table).toContain(`'${table}'`);
    expect(glue).toContain('enable row level security');
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated,service_role');
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/to\s+(anon|authenticated|public)\b/i);
  });

  it('gives the server role select and insert, the announcement columns it updates, and never delete', () => {
    const grants = statements.match(/grant[^;]*;/gi)!.map((g) => g.replace(/\s+/g, ' ').trim());
    expect(grants).toEqual([
      "grant select,insert on public.%I to service_role',t);",
      'grant update(kicker_ko,kicker_en,title_ko,title_en,cta_label_ko,cta_label_en,cta_href,shape,image_key,image_w,image_h,starts_at,ends_at,audience,status,updated_at,published_at,ended_at) on public.brand_announcements to service_role;',
    ]);
    expect(statements).not.toMatch(/delete/i);
    // The columns that never change are not granted: id, slot, author, creation time.
    for (const fixed of ['(id', ',id', 'slot', 'created_by', 'created_at']) expect(grants[1]).not.toContain(fixed);
  });
});
