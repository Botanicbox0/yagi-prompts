import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOutcome } from '@/lib/admin/context';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { ADMIN_OPERATIONS, ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { BRAND_NEWS_OPERATIONS, parseBrandNewsInstant } from '@/lib/admin/brand-news-operations';
import { BRAND_NEWS_LIMITS, judgeBrandNewsLink, type BrandNewsAdminItem } from '@/lib/brand-news/contracts';
import { loadBrandNewsAdmin, loadBrandNewsReach, resetBrandNewsProbe } from '@/lib/brand-news/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, formOf, viewerOf, type AdminHarness, type FormFields } from '../helpers/admin';
import { runner } from '../helpers/pglite';

/**
 * docs/BRAND-PROJECT-SPINE.md §6, slice 3b (server half): the admin side of the home's news slot. Pinned:
 *  - the three operations are registered, admin-only through the one door, and refuse with `disabled` while the
 *    switch is off or the tables are missing; every other registered operation is exactly origin/main's;
 *  - `brandNews.save` validates every rule of the table and the link rule (hostile links included), edits drafts only,
 *    stores a banner picture by landing media's path at 1600×400 WebP ≤ 400 KB;
 *  - `brandNews.publish` checks what a live row needs, ends the slot's live row in the same transaction, and a publish
 *    that loses a race for the slot is refused cleanly with exactly one live row left;
 *  - `brandNews.end` ends a live row and is idempotent on an ended one;
 *  - each change writes its `platform_audit` row as the other operations do;
 *  - the admin list and the reach count serve `/admin/brand-news` without naming an organization.
 */
let h: AdminHarness;
let sql: SqlRunner;

beforeEach(async () => {
  resetBrandNewsProbe();
  vi.stubEnv('BRAND_NEWS', 'on');
  h = await adminHarness();
  sql = runner(h.db);
  await h.db.query('insert into auth.users (id) values ($1) on conflict do nothing', [ADMIN_VIEWER.userId]);
  await h.db.query('insert into profiles (id, email, is_admin) values ($1, $2, true) on conflict do nothing', [ADMIN_VIEWER.userId, ADMIN_VIEWER.email]);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  await h.close();
});

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const DRAFT: FormFields = {
  kickerKo: '새 기능',
  kickerEn: 'New',
  titleKo: '영상 스튜디오에 참고 영상 모드가 생겼습니다',
  titleEn: 'The video studio can start from a reference film',
  ctaLabelKo: '써 보기',
  ctaLabelEn: 'Try it',
  ctaHref: '/brand/studio/video?start=reverse',
  startsAt: minutes(-5),
  endsAt: minutes(60 * 24 * 7),
};
const save = (fields: FormFields = {}) => h.run('brandNews.save', { ...DRAFT, ...fields });
async function created(fields: FormFields = {}): Promise<string> {
  const outcome = await save(fields);
  if (!outcome.ok || outcome.code !== 'created' || !outcome.detail) throw new Error(JSON.stringify(outcome));
  return outcome.detail;
}
const rowOf = async (id: string) =>
  (await sql.query<Record<string, unknown>>('select * from brand_announcements where id = $1', [id])).rows[0]!;
const publish = async (id: string, fields: FormFields = {}) => {
  const row = (await sql.query<{ updated_at: Date | string }>('select updated_at from brand_announcements where id = $1', [id])).rows[0];
  return h.run('brandNews.publish', {
    id,
    expectedUpdatedAt: row ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    ...fields,
  });
};
const statusOf = async (id: string) => (await rowOf(id)).status;
const liveIds = async () => (await sql.query<{ id: string }>("select id from brand_announcements where status = 'live'")).rows.map((r) => r.id);
const audits = async (entityId?: string) =>
  (
    await sql.query<{ actor_id: string; entity_id: string; action: string; reason: string; details: Record<string, unknown> }>(
      `select actor_id, entity_id, action, reason, details from platform_audit where action like 'brandNews.%' ${entityId ? 'and entity_id = $1' : ''} order by created_at, id`,
      entityId ? [entityId] : [],
    )
  ).rows;
const refused = (outcome: AdminOutcome, code: string, detail?: RegExp | string) => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(false);
  expect(outcome).toMatchObject({ code });
  if (detail !== undefined) expect((outcome as { detail?: string }).detail).toMatch(detail);
};

async function banner(width = 1600, height = 400, noisy = false): Promise<File> {
  const bytes = noisy
    ? await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 90 } } }).png().toBuffer()
    : await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], 'banner.png', { type: 'image/png' });
}

/* ---------------------------------------------------------------- registry */

describe('the registry', () => {
  it('adds the four operations under names no other module uses, so every other entry is untouched', () => {
    // At this commit the other 186 names equal origin/main's list, in order (checked once against fa208c6e; see the
    // slice report). What is pinned here stays true when later work adds operations of its own.
    const names = ['brandNews.save', 'brandNews.publish', 'brandNews.end', 'brandNews.delete'] as const;
    expect(ADMIN_OPERATION_NAMES.filter((name) => name.startsWith('brandNews.'))).toEqual([...names]);
    for (const name of names) expect(ADMIN_OPERATIONS[name]).toBe(BRAND_NEWS_OPERATIONS[name]);
    const adminDir = join(process.cwd(), 'lib', 'admin');
    for (const file of readdirSync(adminDir).filter((f) => /\.tsx?$/.test(f) && f !== 'brand-news-operations.ts')) {
      expect(readFileSync(join(adminDir, file), 'utf8'), file).not.toMatch(/['"]brandNews\./);
    }
  });

  it('is admin-only: a member, a free viewer and nobody signed in are refused before anything is parsed', async () => {
    for (const name of ['brandNews.save', 'brandNews.publish', 'brandNews.end', 'brandNews.delete']) {
      for (const tier of ['anon', 'free', 'pro'] as const) {
        expect(await h.run(name, { ...DRAFT, id: randomUUID() }, viewerOf(tier)), `${name} ${tier}`).toEqual({ ok: false, code: 'forbidden' });
      }
    }
    expect((await sql.query('select count(*)::int as n from brand_announcements')).rows[0]).toEqual({ n: 0 });
  });

  it('refuses with one clear code while the switch is off, and while the tables are missing', async () => {
    const id = await created();
    vi.stubEnv('BRAND_NEWS', 'off');
    for (const [name, fields] of [['brandNews.save', DRAFT], ['brandNews.publish', { id }], ['brandNews.end', { id }], ['brandNews.delete', { id }]] as const) {
      expect(await h.run(name, fields), name).toEqual({ ok: false, code: 'disabled', detail: 'BRAND_NEWS' });
    }
    // Whatever the form holds: the same code, not `invalid`.
    for (const [name, fields] of [['brandNews.save', { shape: 'card' }], ['brandNews.publish', { id: 'nope' }], ['brandNews.end', {}], ['brandNews.delete', { id: 'nope' }]] as const) {
      expect(await h.run(name, fields), name).toEqual({ ok: false, code: 'disabled', detail: 'BRAND_NEWS' });
    }
    expect(await statusOf(id)).toBe('draft');
    expect(await loadBrandNewsAdmin({ sql }, ADMIN_VIEWER)).toEqual({ ok: false, code: 'disabled' });
    expect(await loadBrandNewsReach({ sql }, ADMIN_VIEWER, id)).toEqual({ ok: false, code: 'disabled' });
    vi.stubEnv('BRAND_NEWS', 'on');
    await sql.query('drop table brand_announcement_dismissals');
    await sql.query('drop table brand_announcements');
    resetBrandNewsProbe();
    for (const [name, fields] of [['brandNews.save', DRAFT], ['brandNews.publish', { id }], ['brandNews.end', { id }], ['brandNews.delete', { id }]] as const) {
      refused(await h.run(name, fields), 'disabled', /0196/);
    }
    expect(await loadBrandNewsAdmin({ sql }, ADMIN_VIEWER)).toEqual({ ok: false, code: 'disabled' });
  });
});

/* -------------------------------------------------------------------- save */

describe('brandNews.save', () => {
  it('creates a draft with every field, writes its audit row, and edits it in place', async () => {
    const test = randomUUID();
    const id = await created({ audienceModes: ['make'], audiencePlans: ['b2b_49', 'none'], audienceOrgs: `${test.toUpperCase()}, ${test}\n` });
    const row = await rowOf(id);
    expect(row).toMatchObject({
      slot: 'home',
      status: 'draft',
      shape: 'line',
      kicker_ko: '새 기능',
      title_en: 'The video studio can start from a reference film',
      cta_href: '/brand/studio/video?start=reverse',
      audience: { modes: ['make'], plans: ['b2b_49', 'none'], orgs: [test] },
      created_by: ADMIN_VIEWER.userId,
      published_at: null,
      image_key: null,
    });
    expect(await audits(id)).toEqual([
      { actor_id: ADMIN_VIEWER.userId, entity_id: id, action: 'brandNews.save', reason: 'brand_news_draft_created', details: { slot: 'home', created: true, shape: 'line', image: null } },
    ]);

    expect(await h.run('brandNews.save', { ...DRAFT, id, titleKo: '고친 제목', audience: '{"orgs":["' + test + '"]}' })).toEqual({ ok: true, code: 'saved', detail: id });
    expect(await rowOf(id)).toMatchObject({ title_ko: '고친 제목', audience: { orgs: [test] } });
    expect((await audits(id)).map((a) => a.reason)).toEqual(['brand_news_draft_created', 'brand_news_draft_saved']);
  });

  it('reads a datetime-local value as Korean time and checks the calendar', () => {
    expect(parseBrandNewsInstant('2026-12-01T09:00')?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(parseBrandNewsInstant('2026-12-01T09:00:30')?.toISOString()).toBe('2026-12-01T00:00:30.000Z');
    expect(parseBrandNewsInstant('2026-12-01T00:00:00Z')?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(parseBrandNewsInstant('2026-12-01T09:00:00.000+09:00')?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    for (const bad of ['', '2026-02-30T10:00', '2026-12-01', '2026-12-01 09:00', '2026-13-01T09:00', '2026-12-01T24:00', 'tomorrow', '2026-12-01T09:00+15:00']) {
      expect(parseBrandNewsInstant(bad), bad).toBeNull();
    }
  });

  it('refuses every field the rules refuse, each with its own detail, and writes nothing', async () => {
    const cases: Array<[FormFields, string]> = [
      [{ id: 'not-a-uuid' }, 'brandNews:id'],
      [{ kickerKo: '가'.repeat(13) }, 'brandNews:kickerKo:tooLong'],
      [{ kickerEn: 'k'.repeat(13) }, 'brandNews:kickerEn:tooLong'],
      [{ titleKo: '나'.repeat(61) }, 'brandNews:titleKo:tooLong'],
      [{ titleEn: 't'.repeat(61) }, 'brandNews:titleEn:tooLong'],
      [{ ctaLabelKo: '다'.repeat(13) }, 'brandNews:ctaLabelKo:tooLong'],
      [{ ctaLabelEn: 'c'.repeat(13) }, 'brandNews:ctaLabelEn:tooLong'],
      [{ titleKo: '두 줄\n제목' }, 'brandNews:titleKo:characters'],
      [{ titleEn: 'right-to-left \u202e override' }, 'brandNews:titleEn:characters'],
      [{ kickerKo: 'tab\there' }, 'brandNews:kickerKo:characters'],
      [{ titleKo: 'line\u2028separator' }, 'brandNews:titleKo:characters'],
      [{ ctaLabelEn: 'pa\u2029ra' }, 'brandNews:ctaLabelEn:characters'],
      [{ kickerEn: 'Ne\ufeffw' }, 'brandNews:kickerEn:characters'],
      [{ titleEn: 'zero\u200bwidth' }, 'brandNews:titleEn:characters'],
      [{ shape: 'card' }, 'brandNews:shape'],
      [{ startsAt: '' }, 'brandNews:startsAt'],
      [{ endsAt: 'next week' }, 'brandNews:endsAt'],
      [{ startsAt: minutes(60), endsAt: minutes(60) }, 'brandNews:period'],
      [{ startsAt: minutes(60), endsAt: minutes(30) }, 'brandNews:period'],
      [{ startsAt: '2026-12-01T00:00:00Z', endsAt: '2027-01-30T00:00:01Z' }, 'brandNews:period'],
      [{ audience: '{"orgs":[],"x":1}' }, 'brandNews:audience'],
      [{ audience: '{"region":["kr"]}' }, 'brandNews:audience'],
      [{ audience: '[]' }, 'brandNews:audience'],
      [{ audience: '{"modes":[]}' }, 'brandNews:audience'],
      [{ audience: 'not json' }, 'brandNews:audience:json'],
      [{ audience: '{}', audienceModes: ['make'] }, 'brandNews:audience:twoWays'],
      [{ audienceRegion: 'kr' }, 'brandNews:audience:unknownKey'],
      [{ audienceModes: ['make', 'admin'] }, 'brandNews:audience'],
      [{ audiencePlans: ['b2b_99'] }, 'brandNews:audience'],
      [{ audiencePlans: ['project_only'] }, 'brandNews:audience'],
      [{ audienceOrgs: 'not-a-uuid' }, 'brandNews:audience'],
      [{ audienceOrgs: Array.from({ length: BRAND_NEWS_LIMITS.audienceOrgsMax + 1 }, () => randomUUID()).join(',') }, 'brandNews:audience'],
    ];
    for (const [fields, detail] of cases) {
      expect(await save(fields), JSON.stringify(fields)).toEqual({ ok: false, code: 'invalid', detail });
    }
    // Exactly at the limits is fine, and an empty audience field beside the JSON one is "not sent".
    await created({ kickerKo: '가'.repeat(12), titleEn: 't'.repeat(60), ctaLabelKo: '다'.repeat(12), startsAt: '2026-12-01T00:00:00Z', endsAt: '2027-01-30T00:00:00Z' });
    const id = await created({ audience: '{"plans":["none"]}', audienceOrgs: '', audienceModes: [''] });
    expect((await rowOf(id)).audience).toEqual({ plans: ['none'] });
    expect((await sql.query('select count(*)::int as n from brand_announcements')).rows[0]).toEqual({ n: 2 });
  });

  it('keeps the link to /brand/ paths and https on twings.app, whatever is tried', async () => {
    const hostile = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'https://twings.app.evil.example',
      'https://twings.app.evil.example/brand/',
      'https://evil.example/twings.app',
      'https://evil.example?x=.twings.app',
      'https://evil.example#.twings.app',
      '/brand/x%00',
      '/brand/x%0a',
      '/brand/x%0D%0Aheader',
      '/brand/x%7F',
      '/brand/x%',
      '/brand/x%2',
      '/brand/x#a#b',
      'https://twings.app/%0d%0a',
      'https://twings.app/a#b#c',
      'https://eviltwings.app',
      'https://twings.app@evil.example',
      'https://user:pass@twings.app/',
      'https://twings.app:8443/',
      'https://TWINGS.app/',
      'HTTPS://twings.app/',
      'Https://twings.app/',
      'http://twings.app/',
      'ftp://twings.app/',
      'https:/twings.app',
      'https://twings.app\\@evil.example',
      'https://-x.twings.app/',
      'https://twings.app./',
      '/brand/../admin',
      '/brand/./studio',
      '/brand/%2e%2e/admin',
      '/brand/%2E%2E/admin',
      '/brand/.%2e/admin',
      '/brand/a%2fb',
      '/brand/a%5cb',
      '/brand/%zz',
      '/brand//evil.example',
      '/brand/x?next=//evil.example',
      '/brand',
      '/Brand/home',
      '/admin',
      'brand/home',
      '/brand/x y',
      ' /brand/x',
      '/brand/x ',
      '/brand/x\ty',
      '/brand/x\ny',
      '/brand/x\u0000',
      '/brand/x\u007f',
      '/brand/x\u200b',
      '/brand/홈',
      `/brand/${'x'.repeat(BRAND_NEWS_LIMITS.hrefChars)}`,
    ];
    for (const href of hostile) {
      expect(judgeBrandNewsLink(href).ok, href).toBe(false);
      const outcome = await save({ ctaHref: href });
      expect(outcome.ok, href).toBe(false);
      expect(outcome, href).toMatchObject({ code: 'invalid' });
      expect((outcome as { detail: string }).detail, href).toMatch(/^brandNews:ctaHref:/);
    }
    expect((await sql.query('select count(*)::int as n from brand_announcements')).rows[0]).toEqual({ n: 0 });

    for (const href of [
      '/brand/',
      '/brand/home',
      '/brand/studio/video?start=reverse',
      '/brand/assets#project',
      '/brand/studio/%ED%99%88',
      'https://twings.app',
      'https://twings.app/',
      'https://twings.app/ko/templates?from=brand#top',
      'https://brand.twings.app/brand/billing',
      'https://a-b.c.twings.app/x',
    ]) {
      expect(judgeBrandNewsLink(href).ok, href).toBe(true);
      const id = await created({ ctaHref: href });
      expect((await rowOf(id)).cta_href).toBe(href);
    }
  });

  it('edits drafts only: a live or ended announcement is refused, an unknown one is not found', async () => {
    const id = await created();
    expect(await publish(id)).toMatchObject({ ok: true, code: 'published' });
    refused(await save({ id, titleKo: '바꿔 보기' }), 'notDraft', 'brandNews:live');
    expect(await h.run('brandNews.end', { id })).toMatchObject({ ok: true });
    refused(await save({ id, titleKo: '바꿔 보기' }), 'notDraft', 'brandNews:ended');
    expect((await rowOf(id)).title_ko).toBe(DRAFT.titleKo);
    refused(await save({ id: randomUUID() }), 'notFound');
  });

  it('stores a banner picture by landing media’s path: 1600×400, re-encoded to WebP, at most 400 KB, public and content-addressed', async () => {
    const id = await created({ shape: 'banner', image: await banner() });
    const row = await rowOf(id);
    expect(row).toMatchObject({ shape: 'banner', image_w: 1600, image_h: 400 });
    expect(String(row.image_key)).toMatch(/^[0-9a-f]{64}\.webp$/);
    const stored = await h.storage.read('public-content', String(row.image_key));
    expect(stored.byteLength).toBeLessThanOrEqual(BRAND_NEWS_LIMITS.image.maxBytes);
    expect(createHash('sha256').update(stored).digest('hex')).toBe(String(row.image_key).slice(0, 64));
    const meta = await sharp(stored).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 400 });

    // Edited without a new picture, a banner keeps it; turned into a line, it drops it.
    expect(await save({ id, titleKo: '배너 제목', shape: 'banner' })).toMatchObject({ ok: true, code: 'saved' });
    expect((await rowOf(id)).image_key).toBe(row.image_key);
    expect(await save({ id, shape: 'line' })).toMatchObject({ ok: true, code: 'saved' });
    expect(await rowOf(id)).toMatchObject({ shape: 'line', image_key: null, image_w: null, image_h: null });
  });

  it('refuses a picture of another size, one too heavy, one that is not a picture, and a picture on a line', async () => {
    refused(await save({ shape: 'banner', image: await banner(1601, 400) }), 'upload', 'brandNews:image:size 1601x400');
    refused(await save({ shape: 'banner', image: await banner(3200, 800) }), 'upload', 'brandNews:image:size 3200x800');
    refused(await save({ shape: 'banner', image: await banner(1600, 400, true) }), 'upload', /^brandNews:image:bytes \d+$/);
    refused(await save({ shape: 'banner', image: new File([new TextEncoder().encode('not an image')], 'x.png', { type: 'image/png' }) }), 'upload', 'brandNews:image:unreadable');
    refused(await save({ shape: 'banner', image: new File([new TextEncoder().encode('%PDF-1.4')], 'x.pdf', { type: 'application/pdf' }) }), 'upload', 'brandNews:image:type');
    expect(await save({ shape: 'line', image: await banner() })).toEqual({ ok: false, code: 'invalid', detail: 'brandNews:image:notBanner' });
    expect((await sql.query('select count(*)::int as n from brand_announcements')).rows[0]).toEqual({ n: 0 });
  });

  it('does not store a picture for an announcement it will refuse to edit', async () => {
    const id = await created();
    await publish(id);
    const file = await banner();
    const key = `${createHash('sha256').update(new Uint8Array(await (await sharp(Buffer.from(await file.arrayBuffer())).rotate().webp({ quality: 82, effort: 5, alphaQuality: 90 }).toBuffer()))).digest('hex')}.webp`;
    refused(await save({ id, shape: 'banner', image: file }), 'notDraft');
    expect(await h.storage.exists('public-content', key)).toBe(false);
    // The same picture on a draft is stored under exactly that key.
    const draft = await created({ shape: 'banner', image: file });
    expect((await rowOf(draft)).image_key).toBe(key);
    expect(await h.storage.exists('public-content', key)).toBe(true);
  });
});

/* ----------------------------------------------------------------- publish */

describe('brandNews.publish', () => {
  it('needs both titles, a link, a banner’s picture, a period not already over, and a draft', async () => {
    const missing = await created({ titleEn: '', ctaHref: '', shape: 'banner' });
    refused(await publish(missing), 'notPublishable', 'brandNews:titleEn,link,image');
    const over = await created({ startsAt: minutes(-120), endsAt: minutes(-1) });
    refused(await publish(over), 'notPublishable', 'brandNews:over');
    const noKo = await created({ titleKo: '' });
    refused(await publish(noKo), 'notPublishable', 'brandNews:titleKo');
    refused(await publish(randomUUID()), 'notFound');
    expect(await h.run('brandNews.publish', { id: 'nope' })).toEqual({ ok: false, code: 'invalid', detail: 'brandNews:id' });
    expect(await liveIds()).toEqual([]);

    // A period that starts later may be published now: it waits, live, until it starts.
    const later = await created({ startsAt: minutes(60), endsAt: minutes(120) });
    expect(await publish(later)).toEqual({ ok: true, code: 'published', detail: later });
    refused(await publish(later), 'notDraft', 'brandNews:live');
  });

  it('ends whatever was live in the slot, in the same transaction, and audits both', async () => {
    const first = await created();
    const second = await created({ titleKo: '두 번째 소식' });
    expect(await publish(first)).toEqual({ ok: true, code: 'published', detail: first });
    expect(await liveIds()).toEqual([first]);
    expect(await publish(second)).toEqual({ ok: true, code: 'published', detail: second });
    expect(await liveIds()).toEqual([second]);
    const ended = await rowOf(first);
    expect(ended.status).toBe('ended');
    expect(ended.ended_at).not.toBeNull();
    // Rows written in one transaction share its time, so they are compared as a set.
    const trail = (await audits()).map((a) => [a.entity_id, a.action, a.reason]);
    expect(trail).toHaveLength(5);
    expect(trail).toEqual(
      expect.arrayContaining([
        [first, 'brandNews.save', 'brand_news_draft_created'],
        [second, 'brandNews.save', 'brand_news_draft_created'],
        [first, 'brandNews.publish', 'brand_news_published'],
        [first, 'brandNews.end', 'brand_news_ended_by_publish'],
        [second, 'brandNews.publish', 'brand_news_published'],
      ]),
    );
    expect((await audits(second)).at(-1)!.details).toEqual({ slot: 'home', ended: [first] });
  });

  it('a publish that loses the race for the slot is refused cleanly, and exactly one row stays live', async () => {
    const live = await created();
    await publish(live);
    const mine = await created({ titleKo: '내 소식' });
    const theirs = await created({ titleKo: '다른 관리자의 소식' });
    // What a rival publish leaves behind: another row of the slot already live when ours goes live. PGlite has one
    // connection, so the rival's statement is sent right after ours ends the slot's live row, INSIDE our transaction
    // (and is rolled back with it). This proves the unique index's refusal becomes `badTransition`/`slotBusy` and that
    // nothing of the lost publish stays. The two real cross-transaction orders (READ COMMITTED: the loser waits on the
    // live row's lock or on the index entry, then gets 23505) are reasoned in the slice report, not run here.
    const racing = (inner: SqlRunner): SqlRunner => ({
      query: async <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
        const result = await inner.query<T>(text, params);
        if (/set status = 'ended'/.test(text) && /where slot = \$1/.test(text)) {
          await inner.query("update brand_announcements set status = 'live', published_at = now() where id = $1", [theirs]);
        }
        return result;
      },
      transaction: (fn) => inner.transaction((tx) => fn(racing(tx))),
    });
    const mineUpdated = new Date((await rowOf(mine)).updated_at as Date | string).toISOString();
    const outcome = await dispatchAdmin('brandNews.publish', formOf('brandNews.publish', { id: mine, expectedUpdatedAt: mineUpdated }), { ...h.ctx(), sql: racing(sql) });
    expect(outcome).toEqual({ ok: false, code: 'badTransition', detail: 'brandNews:slotBusy' });
    // Nothing of the lost publish stayed (its whole transaction rolled back): one live row, the drafts untouched.
    expect(await liveIds()).toEqual([live]);
    expect(await statusOf(mine)).toBe('draft');
    expect((await audits(mine)).map((a) => a.action)).toEqual(['brandNews.save']);
  });

  it('two publishes one right after the other: the later one is live, the earlier one ended', async () => {
    const a = await created();
    const b = await created();
    expect(await publish(a)).toMatchObject({ ok: true });
    expect(await publish(b)).toMatchObject({ ok: true });
    expect(await liveIds()).toEqual([b]);
    expect(await statusOf(a)).toBe('ended');
  });
});

/* --------------------------------------------------------------------- end */

describe('brandNews.end', () => {
  it('ends a live announcement once, answers the same for an ended one, and refuses a draft', async () => {
    const id = await created();
    refused(await h.run('brandNews.end', { id }), 'badTransition', 'brandNews:notLive');
    await publish(id);
    expect(await h.run('brandNews.end', { id })).toEqual({ ok: true, code: 'unpublished', detail: id });
    expect(await rowOf(id)).toMatchObject({ status: 'ended' });
    expect(await h.run('brandNews.end', { id })).toEqual({ ok: true, code: 'unpublished', detail: id });
    expect((await audits(id)).map((a) => a.reason)).toEqual(['brand_news_draft_created', 'brand_news_published', 'brand_news_ended']);
    refused(await h.run('brandNews.end', { id: randomUUID() }), 'notFound');
    // Ended is final: it cannot go live again.
    refused(await publish(id), 'notDraft', 'brandNews:ended');
  });
});

/* ------------------------------------------------------------- admin reads */

describe('the admin page’s reads', () => {
  it('list newest first with what the page shows, admins only', async () => {
    const old = await created({ titleEn: '' });
    const fresh = await created({ shape: 'banner', image: await banner(), audience: '{"orgs":["' + randomUUID() + '"]}' });
    await publish(fresh);
    const page = await loadBrandNewsAdmin({ sql, imageUrl: (key) => `https://media.example.test/${key}` }, ADMIN_VIEWER);
    if (!page.ok) throw new Error(page.code);
    expect(page.limit).toBe(BRAND_NEWS_LIMITS.adminList);
    expect(page.items.map((i) => i.id)).toEqual([fresh, old]);
    const [live, draft] = page.items as [BrandNewsAdminItem, BrandNewsAdminItem];
    expect(live).toMatchObject({ status: 'live', showing: true, over: false, shape: 'banner', imageWidth: 1600, publishable: { ok: false, reasons: ['notDraft'] } });
    expect(live.imageUrl).toBe(`https://media.example.test/${live.imageKey}`);
    expect(draft).toMatchObject({ status: 'draft', showing: false, publishable: { ok: false, reasons: ['titleEn'] }, audience: {}, publishedAt: null });
    expect(await loadBrandNewsAdmin({ sql }, viewerOf('free'))).toEqual({ ok: false, code: 'forbidden' });
    expect(await loadBrandNewsReach({ sql }, viewerOf('free'), old)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('counts the organizations a draft would reach, as a number only', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    const owner = randomUUID();
    await h.db.query('insert into auth.users (id) values ($1)', [owner]);
    await h.db.query('insert into profiles (id, email) values ($1, $2)', [owner, `${owner}@fixture.invalid`]);
    const orgs: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, `Reach fixture ${i}`, owner, randomUUID()]);
      await sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, owner]);
      orgs.push(id);
    }
    const everyone = await created();
    const one = await created({ audienceOrgs: orgs[0] });
    expect(await loadBrandNewsReach({ sql }, ADMIN_VIEWER, everyone)).toEqual({ ok: true, organizations: 3 });
    expect(await loadBrandNewsReach({ sql }, ADMIN_VIEWER, one)).toEqual({ ok: true, organizations: 1 });
    expect(await loadBrandNewsReach({ sql }, ADMIN_VIEWER, randomUUID())).toEqual({ ok: false, code: 'notFound' });
    expect(await loadBrandNewsReach({ sql }, ADMIN_VIEWER, 'nope')).toEqual({ ok: false, code: 'notFound' });
  });
});
