import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roomPulse, staffRoomPulse, type RoomPulse } from '@/lib/brand-rooms/pulse';
import { runRoomOperation, type RoomMessageDeps } from '@/lib/brand-rooms/messages';
import { createShare, guestComment, revokeShare, sharePulse, unlockShare } from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import { staffAddComment, staffResolveComment } from '@/lib/brand-studio/review';
import type { ReviewCommentAdded } from '@/lib/brand-studio/review-contracts';
import { memoryStaging, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, roomDraft, roomOp, seedProject } from './review/fixtures';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the room pulse against a real PGlite database. Each door lets in only
 * who may read what it summarises; a stamp moves when its part moves; a team note moves the team's stamp and
 * never the brand's or a share link's.
 */
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
const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const brandStamp = async (viewer = owner(), projectId = f.projectId) => roomPulse({ sql: f.sql }, viewer, { organizationId: f.orgId, projectId });
const teamStamp = async (scope: { projectId?: string; reviewId?: string } = { projectId: f.projectId }) => staffRoomPulse({ sql: f.sql }, admin(), { organizationId: f.orgId, ...scope });
const stamp = (r: unknown) => (r as RoomPulse).stamp;
const mdeps = (): RoomMessageDeps => ({ sql: f.sql, media: deps.media, staging: memoryStaging() });

describe("the brand member's door", () => {
  it('answers every seat of the room, with the share links only for owners and editors', async () => {
    for (const id of [f.ids.owner, f.ids.editor, f.ids.viewer, f.ids.guest]) {
      const r = await brandStamp(viewerOf(id));
      expect(r).toMatchObject({ ok: true, stamp: { chat: expect.any(String), reviews: expect.any(String), storyboards: expect.any(String) } });
      expect(stamp(r).shares === null).toBe(id === f.ids.viewer || id === f.ids.guest);
    }
  });

  it('is not found for an outsider, another or unshared project, a guest outside their project, and closed rooms', async () => {
    expect(await brandStamp(viewerOf(f.ids.outsider))).toEqual({ ok: false, code: 'not_found' });
    expect(await brandStamp({ userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } as never)).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await brandStamp(owner(), randomUUID())).toEqual({ ok: false, code: 'not_found' });
    expect(await brandStamp(owner(), 'not-a-uuid')).toEqual({ ok: false, code: 'not_found' });
    const other = await seedProject(f);
    expect(await brandStamp(owner(), other)).toMatchObject({ ok: true });
    expect(await brandStamp(viewerOf(f.ids.guest), other)).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [other]);
    expect(await brandStamp(owner(), other)).toEqual({ ok: false, code: 'not_found' });
    // An organization this person is not in at all.
    expect(await roomPulse({ sql: f.sql }, owner(), { organizationId: randomUUID(), projectId: f.projectId })).toEqual({ ok: false, code: 'not_found' });
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect(await brandStamp()).toEqual({ ok: false, code: 'rooms_closed' });
  });

  it('is the same while nothing changes, and moves the part that changed', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    const a = stamp(await brandStamp());
    expect(stamp(await brandStamp())).toEqual(a);

    const added = (await roomOp(f, deps, owner(), 'comment.add', { reviewId, body: 'Logo smaller', atMs: 500 })).result as ReviewCommentAdded;
    const b = stamp(await brandStamp());
    expect(b.reviews).not.toBe(a.reviews);
    expect(b.storyboards).toBe(a.storyboards);

    // Resolving a public note moves it again.
    await roomOp(f, deps, owner(), 'comment.resolve', { reviewId, commentId: added.comment.id });
    const c = stamp(await brandStamp());
    expect(c.reviews).not.toBe(b.reviews);

    // A chat line moves the chat part and nothing else.
    const sent = await runRoomOperation(mdeps(), owner(), 'message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'Hi team' });
    expect(sent.result).toMatchObject({ ok: true });
    const d = stamp(await brandStamp());
    expect(d.chat).not.toBe(c.chat);
    expect(d.reviews).toBe(c.reviews);

    // A share link moves the owner's share part.
    expect(await createShare({ sql: f.sql, media: deps.media }, owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId })).toMatchObject({ ok: true });
    const e = stamp(await brandStamp());
    expect(e.shares).not.toBe(d.shares);
  });

  it('never moves for a team note, written or resolved; the team stamp does', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    await roomOp(f, deps, owner(), 'comment.add', { reviewId, body: 'Public note', atMs: 200 });
    const brandBefore = stamp(await brandStamp());
    const guestBefore = stamp(await brandStamp(viewerOf(f.ids.guest)));
    const teamBefore = stamp(await teamStamp());
    const stackBefore = stamp(await teamStamp({ reviewId }));

    const team = (await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'internal only', atMs: 900, visibility: 'team' })) as ReviewCommentAdded;
    expect(team).toMatchObject({ ok: true, comment: { team: true } });
    expect(stamp(await brandStamp())).toEqual(brandBefore);
    expect(stamp(await brandStamp(viewerOf(f.ids.guest)))).toEqual(guestBefore);
    const teamAfter = stamp(await teamStamp());
    expect(teamAfter.reviews).not.toBe(teamBefore.reviews);
    expect(stamp(await teamStamp({ reviewId })).reviews).not.toBe(stackBefore.reviews);

    expect(await staffResolveComment(reviewDeps(deps), admin(), { reviewId, commentId: team.comment.id })).toEqual({ ok: true });
    expect(stamp(await brandStamp())).toEqual(brandBefore);
    expect(stamp(await teamStamp()).reviews).not.toBe(teamAfter.reviews);

    // A team reply under the team note is a team note too: still nothing for the brand.
    await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'and more', parentId: team.comment.id });
    expect(stamp(await brandStamp())).toEqual(brandBefore);
  });
});

describe("a share link's door", () => {
  async function linked(extra: Record<string, unknown> = {}) {
    const reviewId = await roomDraft(f, deps, 'video');
    const created = (await createShare({ sql: f.sql, media: deps.media }, owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId, ...extra })) as ShareCreated;
    expect(created.ok).toBe(true);
    return { reviewId, created };
  }
  const noCookies = { get: () => undefined };

  it('stamps the one shared item and moves with public notes only', async () => {
    const { reviewId, created } = await linked({ allowComments: true });
    const a = await sharePulse({ sql: f.sql }, { token: created.token }, noCookies);
    expect(a).toMatchObject({ ok: true, stamp: { item: expect.any(String) } });
    const item = (a as { stamp: { item: string } }).stamp.item;

    await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'internal', visibility: 'team' });
    expect(await sharePulse({ sql: f.sql }, { token: created.token }, noCookies)).toEqual({ ok: true, stamp: { item } });

    // Another draft in the same project does not move this link's stamp.
    const other = await roomDraft(f, deps, 'video', 'Other film');
    await roomOp(f, deps, owner(), 'comment.add', { reviewId: other, body: 'Elsewhere' });
    expect(await sharePulse({ sql: f.sql }, { token: created.token }, noCookies)).toEqual({ ok: true, stamp: { item } });

    expect(await guestComment({ sql: f.sql, media: deps.media }, { token: created.token, name: 'Jin', body: 'Nice cut' }, noCookies)).toMatchObject({ ok: true });
    const moved = await sharePulse({ sql: f.sql }, { token: created.token }, noCookies);
    expect((moved as { stamp: { item: string } }).stamp.item).not.toBe(item);
  });

  it('answers nothing for a bad, revoked or still-locked link', async () => {
    const { created } = await linked({ passphrase: 'spring-2026' });
    expect(await sharePulse({ sql: f.sql }, { token: 'x'.repeat(43) }, noCookies)).toEqual({ ok: false, code: 'not_found' });
    expect(await sharePulse({ sql: f.sql }, { token: 'short' }, noCookies)).toEqual({ ok: false, code: 'invalid' });
    expect(await sharePulse({ sql: f.sql }, { token: created.token }, noCookies)).toEqual({ ok: false, code: 'forbidden' });
    const unlocked = (await unlockShare({ sql: f.sql, media: deps.media }, { token: created.token, passphrase: 'spring-2026' })) as { cookie: { name: string; value: string } };
    expect(await sharePulse({ sql: f.sql }, { token: created.token }, { get: (n) => (n === unlocked.cookie.name ? unlocked.cookie.value : undefined) })).toMatchObject({ ok: true });
    expect(await revokeShare({ sql: f.sql, media: deps.media }, owner(), { organizationId: f.orgId, shareId: created.share.id })).toMatchObject({ ok: true });
    expect(await sharePulse({ sql: f.sql }, { token: created.token }, { get: (n) => (n === unlocked.cookie.name ? unlocked.cookie.value : undefined) })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe("the team's door", () => {
  it('lets in an admin only, for a client-visible project or a live review of an open organization', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    expect(await teamStamp()).toMatchObject({ ok: true, stamp: { shares: expect.any(String) } });
    expect(await teamStamp({ reviewId })).toMatchObject({ ok: true, stamp: { reviews: expect.any(String), chat: '' } });
    expect(await staffRoomPulse({ sql: f.sql }, owner(), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'not_found' });
    expect(await staffRoomPulse({ sql: f.sql }, admin(), { organizationId: f.orgId })).toEqual({ ok: false, code: 'not_found' });
    expect(await staffRoomPulse({ sql: f.sql }, admin(), { organizationId: f.orgId, projectId: f.projectId, reviewId })).toEqual({ ok: false, code: 'not_found' });
    expect(await staffRoomPulse({ sql: f.sql }, admin(), { organizationId: f.orgId, reviewId: randomUUID() })).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [f.projectId]);
    expect(await teamStamp()).toEqual({ ok: false, code: 'not_found' });
  });

  it('follows the whole stack on a review page: a new version moves it', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    const before = stamp(await teamStamp({ reviewId }));
    const { seedOutput } = await import('./review/fixtures');
    const v2 = await roomOp(f, deps, owner(), 'review.version', { reviewId, outputId: await seedOutput(deps, f.orgId, f.ids.owner, 'video') });
    expect(v2.result).toMatchObject({ ok: true });
    expect(stamp(await teamStamp({ reviewId })).reviews).not.toBe(before.reviews);
  });
});
