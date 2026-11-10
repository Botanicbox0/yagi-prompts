import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import {
  countShareView,
  createShare,
  guestComment,
  hashPassphrase,
  hashShareToken,
  listShares,
  loadSharePage,
  resolveShare,
  revokeShare,
  staffListShares,
  staffRevokeShare,
  unlockCookieName,
  unlockShare,
  verifyPassphrase,
  VISITOR_COOKIE,
} from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { roomDraft, seedOutput } from './fixtures';

/**
 * docs/BRAND-ROOMS.md §6, §9-3 — share links against a real PGlite database: the token is shown once and
 * stored only as its SHA-256; lists never carry it; revoked, expired, unknown and malformed tokens all
 * resolve to nothing; a passphrase is checked on the server, pauses the link after repeated misses, and
 * unlocks with an http-only proof; guests comment only when allowed, under their name and a rate; a view
 * counts once per visitor per hour; a sandboxed brand can never make a link.
 */
vi.mock('@/lib/brand-rooms/events', async (original) => ({ ...(await original<typeof import('@/lib/brand-rooms/events')>()), postRoomEvent: async () => undefined }));

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const sdeps = () => ({ sql: f.sql, media: deps.media });
const noCookies = { get: () => undefined };
const jar = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] });

async function share(input: Record<string, unknown> = {}) {
  const reviewId = await roomDraft(f, deps);
  const created = (await createShare(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId, ...input })) as ShareCreated;
  expect(created.ok).toBe(true);
  return { reviewId, created };
}

describe('making a link', () => {
  it('returns the token once, stores only its hash, and never lists it', async () => {
    const { reviewId, created } = await share();
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.share).toMatchObject({ kind: 'review', targetId: reviewId, allowComments: true, allowDownload: false, hasPassphrase: false, state: 'live', views: 0 });
    const days = (Date.parse(created.share.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const row = (await f.sql.query<{ token_hash: string }>('select token_hash from brand_room_shares')).rows[0]!;
    expect(row.token_hash).toBe(hashShareToken(created.token));
    expect(JSON.stringify((await f.sql.query('select * from brand_room_shares')).rows)).not.toContain(created.token);
    const listed = await listShares(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId });
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(JSON.stringify(listed)).not.toContain(row.token_hash);
    expect(listed).toMatchObject({ ok: true, shares: [{ id: created.share.id }] });
  });

  it('is for owners and editors of a seated brand, on a live item of a room they may open', async () => {
    const reviewId = await roomDraft(f, deps);
    for (const who of [f.ids.viewer, f.ids.guest]) {
      expect(await createShare(sdeps(), viewerOf(who), { organizationId: f.orgId, kind: 'review', targetId: reviewId })).toEqual({ ok: false, code: 'forbidden' });
    }
    expect(await createShare(sdeps(), viewerOf(f.ids.outsider), { organizationId: f.orgId, kind: 'review', targetId: reviewId })).toEqual({ ok: false, code: 'not_found' });
    expect(await createShare(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: f.orgId })).toEqual({ ok: false, code: 'not_found' });
    expect(await createShare(sdeps(), owner(), { organizationId: f.orgId, kind: 'storyboard', targetId: reviewId })).toEqual({ ok: false, code: 'not_found' });
    expect(await createShare(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId, expiresInDays: 91 })).toEqual({ ok: false, code: 'invalid' });
    expect(await createShare(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId, passphrase: 'abc' })).toEqual({ ok: false, code: 'invalid' });
    expect((await createShare(sdeps(), viewerOf(f.ids.editor), { organizationId: f.orgId, kind: 'review', targetId: reviewId, expiresInDays: 90 })).ok).toBe(true);
  });

  it('is never possible for a sandboxed brand', async () => {
    const sandboxed = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]! });
    try {
      const d = studioDeps(sandboxed.sql);
      const outputId = await seedOutput(d, sandboxed.orgId, sandboxed.ids.owner);
      const reviewId = (
        await sandboxed.sql.query<{ id: string }>(
          `insert into brand_studio_reviews (organization_id, output_id, title, created_role, project_id) values ($1, $2, 'x', 'studio', $3) returning id`,
          [sandboxed.orgId, outputId, sandboxed.projectId],
        )
      ).rows[0]!.id;
      expect(await createShare({ sql: sandboxed.sql, media: d.media }, viewerOf(sandboxed.ids.owner), { organizationId: sandboxed.orgId, kind: 'review', targetId: reviewId })).toEqual({ ok: false, code: 'not_found' });
      // A link that somehow exists for it still opens nothing.
      await sandboxed.sql.query(
        `insert into brand_room_shares (token_hash, organization_id, kind, target_id, expires_at, created_role) values ($1, $2, 'review', $3, now() + interval '1 day', 'studio')`,
        [hashShareToken('A'.repeat(43)), sandboxed.orgId, reviewId],
      );
      expect(await resolveShare(sandboxed.sql, 'A'.repeat(43))).toBeNull();
    } finally {
      await sandboxed.db.close();
    }
  });
});

describe('opening a link', () => {
  it('shows only the item, and nothing for unknown, malformed, revoked or expired tokens, or rooms off', async () => {
    const { reviewId, created } = await share();
    await f.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body) values ($1, $2, $3, 'brand', 'A note')`, [reviewId, f.orgId, f.ids.owner]);
    const page = await loadSharePage(sdeps(), created.token, noCookies);
    expect(page).toMatchObject({ state: 'open', share: { kind: 'review', allowComments: true, allowDownload: false }, review: { review: { id: reviewId, title: 'Spring film', organizationId: '' } } });
    const comments = page && 'review' in page ? page.review.comments : [];
    // A member's email never shows, not even its first half.
    expect(comments[0]!.authorName).toBeNull();
    expect(JSON.stringify(page)).not.toContain('owner@example.test');
    expect(JSON.stringify(page)).not.toContain(f.orgId);
    expect(JSON.stringify(page)).not.toContain(f.projectId);

    expect(await loadSharePage(sdeps(), 'B'.repeat(43), noCookies)).toBeNull();
    expect(await loadSharePage(sdeps(), 'short', noCookies)).toBeNull();
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect(await loadSharePage(sdeps(), created.token, noCookies)).toBeNull();
    vi.stubEnv('BRAND_ROOMS', 'on');

    expect(await revokeShare(sdeps(), owner(), { organizationId: f.orgId, shareId: created.share.id })).toEqual({ ok: true });
    expect(await loadSharePage(sdeps(), created.token, noCookies)).toBeNull();

    const second = await share();
    await f.sql.query("update brand_room_shares set expires_at = created_at + interval '1 second' where id = $1", [second.created.share.id]);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await loadSharePage(sdeps(), second.created.token, noCookies)).toBeNull();
    const listed = await listShares(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: second.reviewId });
    expect(listed).toMatchObject({ ok: true, shares: [{ state: 'expired' }] });
  });

  it('hides a deleted item', async () => {
    const { reviewId, created } = await share();
    await f.sql.query('update brand_studio_reviews set deleted_at = now() where id = $1', [reviewId]);
    expect(await loadSharePage(sdeps(), created.token, noCookies)).toBeNull();
  });
});

describe('a passphrase', () => {
  it('is checked on the server, unlocks with a proof cookie, and pauses the link after repeated misses', async () => {
    const { created } = await share({ passphrase: 'spring-2026' });
    expect(created.share.hasPassphrase).toBe(true);
    const stored = (await f.sql.query<{ passphrase_hash: string }>('select passphrase_hash from brand_room_shares')).rows[0]!.passphrase_hash;
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('spring-2026');
    expect(await loadSharePage(sdeps(), created.token, noCookies)).toEqual({ state: 'locked', kind: 'review' });

    expect(await unlockShare(sdeps(), { token: created.token, passphrase: 'wrong' })).toEqual({ ok: false, code: 'wrong_passphrase' });
    const ok = await unlockShare(sdeps(), { token: created.token, passphrase: 'spring-2026' });
    expect(ok).toMatchObject({ ok: true, cookie: { name: unlockCookieName(created.share.id) } });
    const cookie = (ok as { cookie: { name: string; value: string } }).cookie;
    expect(cookie.value).not.toContain('spring');
    expect(await loadSharePage(sdeps(), created.token, jar({ [cookie.name]: cookie.value }))).toMatchObject({ state: 'open' });
    expect(await loadSharePage(sdeps(), created.token, jar({ [cookie.name]: `${cookie.value}x` }))).toEqual({ state: 'locked', kind: 'review' });

    for (let i = 0; i < 8; i += 1) expect(await unlockShare(sdeps(), { token: created.token, passphrase: `nope-${i}` })).toEqual({ ok: false, code: 'wrong_passphrase' });
    expect(await unlockShare(sdeps(), { token: created.token, passphrase: 'spring-2026' })).toEqual({ ok: false, code: 'locked' });
  });

  it('hashes with scrypt and compares in constant time', async () => {
    const hash = await hashPassphrase('한글 암호');
    expect(await verifyPassphrase('한글 암호', hash)).toBe(true);
    expect(await verifyPassphrase('한글 암호 ', hash)).toBe(false);
    expect(await verifyPassphrase('x', 'plain')).toBe(false);
  });
});

describe('guests', () => {
  it('comment under a name when the link allows it, never when it does not', async () => {
    const { reviewId, created } = await share();
    const added = await guestComment(sdeps(), { token: created.token, name: '  Jin  Park ', body: 'Love the second cut', atMs: 900, endMs: 1800, strokes: [{ tool: 'arrow', color: 'blue', points: [[0.1, 0.1], [0.4, 0.4]] }] }, noCookies);
    expect(added).toMatchObject({ ok: true, comment: { authorName: 'Jin Park', guest: true, authorRole: 'brand', endMs: 1800, mine: false } });
    const row = (await f.sql.query<{ author_id: string | null; guest_name: string; share_id: string }>('select author_id, guest_name, share_id from brand_studio_review_comments where review_id = $1', [reviewId])).rows[0]!;
    expect(row).toEqual({ author_id: null, guest_name: 'Jin Park', share_id: created.share.id });

    const closed = await share({ allowComments: false });
    expect(await guestComment(sdeps(), { token: closed.created.token, name: 'Jin', body: 'x' }, noCookies)).toEqual({ ok: false, code: 'comments_closed' });
    expect(await guestComment(sdeps(), { token: created.token, name: '', body: 'x' }, noCookies)).toEqual({ ok: false, code: 'invalid' });
    expect(await guestComment(sdeps(), { token: created.token, name: 'Jin', body: 'x'.repeat(1001) }, noCookies)).toEqual({ ok: false, code: 'invalid' });
  });

  it('are limited per link and need the passphrase proof', async () => {
    const { created } = await share();
    for (let i = 0; i < 5; i += 1) expect((await guestComment(sdeps(), { token: created.token, name: 'Jin', body: `note ${i}` }, noCookies)).ok).toBe(true);
    expect(await guestComment(sdeps(), { token: created.token, name: 'Jin', body: 'one more' }, noCookies)).toEqual({ ok: true, comment: expect.anything() });
    expect(await guestComment(sdeps(), { token: created.token, name: 'Jin', body: 'too many' }, noCookies)).toEqual({ ok: false, code: 'rate_limited' });

    const locked = await share({ passphrase: 'pass-word' });
    expect(await guestComment(sdeps(), { token: locked.created.token, name: 'Jin', body: 'x' }, noCookies)).toEqual({ ok: false, code: 'forbidden' });
  });
});

describe('views', () => {
  it('count once per visitor per hour', async () => {
    const { reviewId, created } = await share();
    const first = await countShareView(sdeps(), { token: created.token }, noCookies);
    expect(first).toMatchObject({ ok: true });
    const visitor = (first as { visitor: string }).visitor;
    await countShareView(sdeps(), { token: created.token }, jar({ [VISITOR_COOKIE]: visitor }));
    await countShareView(sdeps(), { token: created.token }, jar({ [VISITOR_COOKIE]: visitor }));
    await countShareView(sdeps(), { token: created.token }, noCookies);
    const listed = await listShares(sdeps(), owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId });
    expect(listed).toMatchObject({ ok: true, shares: [{ views: 2 }] });
    expect(JSON.stringify((await f.sql.query('select * from brand_room_share_visits')).rows)).not.toContain(visitor);
  });
});

describe('the team', () => {
  it('sees every link of a draft and can turn one off; a brand member cannot use the team door', async () => {
    const { reviewId, created } = await share();
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    expect(await staffListShares(sdeps(), admin, { kind: 'review', targetId: reviewId })).toMatchObject({ ok: true, shares: [{ id: created.share.id, createdRole: 'brand' }] });
    expect(await staffRevokeShare(sdeps(), owner(), { shareId: created.share.id })).toEqual({ ok: false, code: 'forbidden' });
    expect(await staffRevokeShare(sdeps(), admin, { shareId: created.share.id })).toEqual({ ok: true, kind: 'review', targetId: reviewId });
    expect((await f.sql.query('select revoked_by from brand_room_shares')).rows[0]).toEqual({ revoked_by: f.ids.admin });
    expect(await resolveShare(f.sql, created.token)).toBeNull();
  });
});
