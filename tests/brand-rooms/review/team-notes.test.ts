import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { postRoomEvent } from '@/lib/brand-rooms/events';
import { loadRoomMessages, loadRoomSummary, runRoomOperation, type RoomMessageDeps } from '@/lib/brand-rooms/messages';
import type { RoomStreamPage } from '@/lib/brand-rooms/message-contracts';
import { loadRoomOverview, loadRoomProject } from '@/lib/brand-rooms/overview';
import { createShare, guestComment, loadSharePage } from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import {
  loadReviewDetail,
  loadReviewList,
  loadRoomReviewDetail,
  loadRoomReviews,
  runReviewOperation,
  staffAddComment,
  staffProjectStacks,
  staffResolveComment,
  staffReviewDetail,
  staffReviewList,
} from '@/lib/brand-studio/review';
import type { ReviewComment, ReviewCommentAdded, ReviewCreated, ReviewDetail, ReviewList, RoomReviewDetail, RoomReviewList } from '@/lib/brand-studio/review-contracts';
import { memoryStaging, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, roomDraft, roomOp, seedOutput } from './fixtures';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §5 — team notes against a real PGlite database. A note the YAGI team keeps
 * to itself (`visibility = 'team'`) is written only by the team, leaves no room line, never reaches a brand
 * member, a project guest or a share link through any read path, is not counted for them, carries over to
 * a new version still team-only, and is "not found" to anyone outside the team who tries to answer, resolve
 * or delete it. The admin page alone reads it, and counts it apart.
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
const projectGuest = () => viewerOf(f.ids.guest);
const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const SECRET = 'internal: the client hates this colour, push back gently';

async function teamNote(reviewId: string, extra: Record<string, unknown> = {}): Promise<ReviewComment> {
  const added = await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: SECRET, atMs: 1500, x: 0.4, y: 0.6, visibility: 'team', ...extra });
  expect(added).toMatchObject({ ok: true, comment: { team: true, authorRole: 'studio' } });
  return (added as ReviewCommentAdded).comment;
}

/** A room deliverable with one public brand note and one team note. */
async function roomWithNotes() {
  const reviewId = await roomDraft(f, deps, 'video');
  const brand = ((await roomOp(f, deps, owner(), 'comment.add', { reviewId, body: 'Logo smaller', atMs: 500 })).result as ReviewCommentAdded).comment;
  const team = await teamNote(reviewId);
  return { reviewId, brand, team };
}

const roomDetail = async (reviewId: string, viewer = owner()) => (await loadRoomReviewDetail(reviewDeps(deps), viewer, f.orgId, f.projectId, reviewId)) as RoomReviewDetail;
const visibility = async (id: string) => (await f.sql.query<{ visibility: string }>('select visibility from brand_studio_review_comments where id = $1', [id])).rows[0]?.visibility;
const eventLinesFor = async (commentId: string) =>
  Number(
    (
      await f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_messages where kind = 'event' and ref_key like $1", [`%${commentId.toLowerCase()}%`])
    ).rows[0]!.n,
  );

describe('writing a team note', () => {
  it('is the team only, stored as team, and leaves no room line (the public studio note does)', async () => {
    const { reviewId, team } = await roomWithNotes();
    expect(await visibility(team.id)).toBe('team');
    expect(await eventLinesFor(team.id)).toBe(0);
    const open = (await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'On it' })) as ReviewCommentAdded;
    expect(open.comment.team).toBeUndefined();
    expect(await visibility(open.comment.id)).toBe('public');
    expect(await eventLinesFor(open.comment.id)).toBe(1);
  });

  it('a brand member asking for team visibility gets an ordinary public note (the room and the studio screen)', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    const room = (await roomOp(f, deps, owner(), 'comment.add', { reviewId, body: 'Mine', visibility: 'team' })) as { result: ReviewCommentAdded; notice: unknown };
    expect(room.result.ok).toBe(true);
    expect(room.result.comment.team).toBeUndefined();
    expect(await visibility(room.result.comment.id)).toBe('public');
    // The team still hears about a brand note: that notice is the public note, never a team one.
    expect(room.notice).not.toBeNull();
    const studio = (await runReviewOperation(reviewDeps(deps), owner(), 'comment.add', { organizationId: f.orgId, reviewId, body: 'Also mine', visibility: 'team' })).result as ReviewCommentAdded;
    expect(await visibility(studio.comment.id)).toBe('public');
  });

  it('refuses a non-team author at the database: a brand role, or a guest name, cannot be team', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    await expect(
      f.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body, visibility) values ($1, $2, $3, 'brand', 'x', 'team')`, [
        reviewId,
        f.orgId,
        f.ids.owner,
      ]),
    ).rejects.toThrow(/brand_studio_review_comments_team_author/);
    await expect(
      f.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_role, body, guest_name, visibility) values ($1, $2, 'studio', 'x', 'Jin', 'team')`, [
        reviewId,
        f.orgId,
      ]),
    ).rejects.toThrow(/brand_studio_review_comments_team_author/);
    await expect(
      f.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body, visibility) values ($1, $2, $3, 'studio', 'x', 'secret')`, [
        reviewId,
        f.orgId,
        f.ids.admin,
      ]),
    ).rejects.toThrow(/brand_studio_review_comments_visibility/);
  });

  it('a team reply to a team note stays team; a team-only reply to a public note is refused', async () => {
    const { reviewId, brand, team } = await roomWithNotes();
    const reply = (await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'agreed, keep it', parentId: team.id })) as ReviewCommentAdded;
    expect(reply).toMatchObject({ ok: true, comment: { team: true, parentId: team.id } });
    expect(await visibility(reply.comment.id)).toBe('team');
    expect(await eventLinesFor(reply.comment.id)).toBe(0);
    expect(await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'hidden reply', parentId: brand.id, visibility: 'team' })).toEqual({ ok: false, code: 'invalid' });
  });

  it('is offered through the admin reply operation', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    const ctx: AdminContext = { sql: f.sql, storage: {} as never, viewer: admin() };
    const form = new FormData();
    form.set('_op', 'brand_studio.review.reply');
    form.set('reviewId', reviewId);
    form.set('body', SECRET);
    form.set('visibility', 'team');
    expect(await dispatchAdmin('brand_studio.review.reply', form, ctx)).toMatchObject({ ok: true });
    const rows = (await f.sql.query<{ visibility: string; author_role: string }>('select visibility, author_role from brand_studio_review_comments where review_id = $1', [reviewId])).rows;
    expect(rows).toEqual([{ visibility: 'team', author_role: 'studio' }]);
  });
});

describe('reading notes', () => {
  it('the room files tab (loadRoomReviewDetail) leaves the team note out for a member and for the project guest', async () => {
    const { reviewId, brand } = await roomWithNotes();
    for (const viewer of [owner(), projectGuest()]) {
      const d = await roomDetail(reviewId, viewer);
      expect(d.ok).toBe(true);
      expect(d.comments.map((c) => c.id)).toEqual([brand.id]);
      expect(JSON.stringify(d)).not.toContain(SECRET);
      expect(d.review).toMatchObject({ commentsOpen: 1, commentsTotal: 1 });
    }
  });

  it('the studio review screen (loadReviewDetail, loadReviewList) leaves it out and does not count it', async () => {
    const { reviewId, brand } = await roomWithNotes();
    const d = (await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, reviewId)) as ReviewDetail;
    expect(d.comments.map((c) => c.id)).toEqual([brand.id]);
    expect(JSON.stringify(d)).not.toContain(SECRET);
    const list = (await loadReviewList(reviewDeps(deps), owner(), f.orgId)) as ReviewList;
    expect(list.reviews.find((r) => r.id === reviewId)).toMatchObject({ commentsOpen: 1, commentsTotal: 1 });
    expect(list.reviews[0]).not.toHaveProperty('teamCommentsOpen');
  });

  it('the room deliverables list (loadRoomReviews) and the version switcher do not count it', async () => {
    const { reviewId } = await roomWithNotes();
    const stacks = ((await loadRoomReviews(reviewDeps(deps), owner(), f.orgId, f.projectId)) as RoomReviewList).stacks;
    expect(stacks[0]!.versions[0]).toMatchObject({ id: reviewId, commentsOpen: 1, commentsTotal: 1 });
    expect(stacks[0]!.versions[0]).not.toHaveProperty('teamCommentsTotal');
    const d = await roomDetail(reviewId);
    expect(d.versions?.[0]).toMatchObject({ id: reviewId, commentsOpen: 1 });
  });

  it('a share link (/s/<token>) never shows it', async () => {
    const { reviewId, brand } = await roomWithNotes();
    const created = (await createShare({ sql: f.sql, media: deps.media }, owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId })) as ShareCreated;
    const page = await loadSharePage({ sql: f.sql, media: deps.media }, created.token, { get: () => undefined });
    expect(page && 'review' in page ? page.review.comments.map((c) => c.id) : null).toEqual([brand.id]);
    expect(page && 'review' in page ? page.review.review : null).toMatchObject({ commentsOpen: 1, commentsTotal: 1 });
    expect(JSON.stringify(page)).not.toContain(SECRET);
  });

  it('the admin page (staffReviewDetail) reads it, marked team, with its replies', async () => {
    const { reviewId, brand, team } = await roomWithNotes();
    await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'reply inside', parentId: team.id });
    const d = (await staffReviewDetail(reviewDeps(deps), admin(), reviewId)) as ReviewDetail;
    expect(d.comments.map((c) => [c.body, c.team ?? false])).toEqual([
      ['Logo smaller', false],
      [SECRET, true],
      ['reply inside', true],
    ]);
    expect(d.comments.find((c) => c.id === brand.id)).not.toHaveProperty('team');
  });

  it('the admin lists count public and team notes apart', async () => {
    const { reviewId, team } = await roomWithNotes();
    await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'reply inside', parentId: team.id });
    const listed = await staffReviewList(reviewDeps(deps), admin());
    expect(listed.ok && listed.reviews.find((r) => r.id === reviewId)).toMatchObject({ commentsOpen: 1, commentsTotal: 1, teamCommentsOpen: 1, teamCommentsTotal: 2 });
    const stacks = await staffProjectStacks(reviewDeps(deps), admin(), { organizationId: f.orgId, projectId: f.projectId });
    expect(stacks.ok && stacks.stacks[0]!.versions[0]).toMatchObject({ commentsOpen: 1, commentsTotal: 1, teamCommentsOpen: 1, teamCommentsTotal: 2 });
  });

  it('the room overview counts only public open notes', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    await teamNote(reviewId);
    await f.sql.query("update brand_studio_reviews set status = 'changes_requested' where id = $1", [reviewId]);
    const project = await loadRoomProject(f.sql, f.orgId, f.projectId);
    const overview = await loadRoomOverview(f.sql, { organizationId: f.orgId, project: project!, userId: f.ids.owner });
    // Changes requested and no public note open: nothing for the brand to do on it.
    expect(overview.todos.filter((t) => t.kind === 'review')).toEqual([]);
    expect(JSON.stringify(overview)).not.toContain(SECRET);
    await roomOp(f, deps, owner(), 'comment.add', { reviewId, body: 'Logo smaller' });
    const again = await loadRoomOverview(f.sql, { organizationId: f.orgId, project: project!, userId: f.ids.owner });
    expect(again.todos.filter((t) => t.kind === 'review')).toEqual([expect.objectContaining({ id: reviewId, openNotes: 1 })]);
  });

  it('the inbox alerts count only public open notes', async () => {
    const reviewId = await roomDraft(f, deps, 'video');
    await teamNote(reviewId);
    await f.sql.query("update brand_studio_reviews set status = 'changes_requested' where id = $1", [reviewId]);
    const mdeps: RoomMessageDeps = { sql: f.sql, media: deps.media, staging: memoryStaging() };
    const quiet = await loadRoomSummary(mdeps, owner(), f.orgId);
    expect(quiet.ok && (quiet.alerts ?? []).filter((a) => a.targetId === reviewId)).toEqual([]);
    await roomOp(f, deps, owner(), 'comment.add', { reviewId, body: 'Logo smaller' });
    const loud = await loadRoomSummary(mdeps, owner(), f.orgId);
    expect(loud.ok && (loud.alerts ?? []).find((a) => a.targetId === reviewId)).toMatchObject({ openNotes: 1 });
  });

  it('a chat card never carries it, and a message cannot point at it', async () => {
    const { reviewId, team } = await roomWithNotes();
    const mdeps: RoomMessageDeps = { sql: f.sql, media: deps.media, staging: memoryStaging() };
    // A line that names the team note (none is ever written; a stale or hand-made one must still show nothing of it).
    await postRoomEvent(f.sql, {
      organizationId: f.orgId,
      projectId: f.projectId,
      event: 'review_commented',
      ref: { kind: 'review', reviewId, commentId: team.id },
      actorId: f.ids.admin,
      actorRole: 'studio',
      detail: { title: 'Spring film', version: 1 },
    });
    const page = (await loadRoomMessages(mdeps, owner(), { organizationId: f.orgId, projectId: f.projectId })) as RoomStreamPage;
    expect(JSON.stringify(page)).not.toContain(SECRET);
    const card = page.messages.find((m) => m.ref && 'commentId' in m.ref.ref && m.ref.ref.commentId === team.id.toLowerCase());
    expect(card?.ref).toBeDefined();
    expect(card!.ref).not.toHaveProperty('noteBody');
    const sent = await runRoomOperation(mdeps, owner(), 'message.send', {
      organizationId: f.orgId,
      projectId: f.projectId,
      requestId: randomUUID(),
      body: 'see this',
      ref: { kind: 'review', reviewId, commentId: team.id },
    });
    expect(sent.result).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('a new version', () => {
  it('carries an open team note over, still team: the admin sees it, the brand does not', async () => {
    const { reviewId, brand } = await roomWithNotes();
    const v2 = ((await roomOp(f, deps, owner(), 'review.version', { reviewId, outputId: await seedOutput(deps, f.orgId, f.ids.owner, 'video') })).result as ReviewCreated).review.id;
    const carried = (await f.sql.query<{ visibility: string; author_role: string }>('select visibility, author_role from brand_studio_review_comments where review_id = $1 order by created_at', [v2])).rows;
    expect(carried).toEqual([
      { visibility: 'public', author_role: 'brand' },
      { visibility: 'team', author_role: 'studio' },
    ]);
    const brandView = await roomDetail(v2);
    expect(brandView.comments.map((c) => c.carriedFrom && c.body)).toEqual([brand.body]);
    expect(brandView.review.commentsOpen).toBe(1);
    const teamView = (await staffReviewDetail(reviewDeps(deps), admin(), v2)) as ReviewDetail;
    expect(teamView.comments.map((c) => [c.body, c.team ?? false, Boolean(c.carriedFrom)])).toEqual([
      ['Logo smaller', false, true],
      [SECRET, true, true],
    ]);
  });
});

describe('outside the team', () => {
  it('a member or the project guest gets "not found" replying to, resolving or deleting a team note', async () => {
    const { reviewId, team } = await roomWithNotes();
    for (const viewer of [owner(), projectGuest()]) {
      const reply = await runRoomReviewAs(viewer, 'comment.add', { reviewId, body: 'peek', parentId: team.id });
      expect(reply).toEqual({ result: { ok: false, code: 'not_found' }, notice: null });
      expect((await runRoomReviewAs(viewer, 'comment.delete', { reviewId, commentId: team.id })).result).toEqual({ ok: false, code: 'not_found' });
    }
    expect((await runRoomReviewAs(owner(), 'comment.resolve', { reviewId, commentId: team.id })).result).toEqual({ ok: false, code: 'not_found' });
    // The same answers on the studio review screen.
    const studio = (op: string, input: Record<string, unknown>) => runReviewOperation(reviewDeps(deps), owner(), op, { organizationId: f.orgId, reviewId, ...input });
    expect((await studio('comment.add', { body: 'peek', parentId: team.id })).result).toEqual({ ok: false, code: 'not_found' });
    expect((await studio('comment.resolve', { commentId: team.id })).result).toEqual({ ok: false, code: 'not_found' });
    expect((await studio('comment.delete', { commentId: team.id })).result).toEqual({ ok: false, code: 'not_found' });
    const row = (await f.sql.query('select resolved_at, deleted_at from brand_studio_review_comments where id = $1', [team.id])).rows[0];
    expect(row).toEqual({ resolved_at: null, deleted_at: null });
    expect(Number((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_review_comments where parent_id = $1', [team.id])).rows[0]!.n)).toBe(0);
  });

  it('a guest on a share link gets "not found" replying to a team note', async () => {
    const { reviewId, team } = await roomWithNotes();
    const created = (await createShare({ sql: f.sql, media: deps.media }, owner(), { organizationId: f.orgId, kind: 'review', targetId: reviewId })) as ShareCreated;
    expect(await guestComment({ sql: f.sql, media: deps.media }, { token: created.token, name: 'Jin', body: 'peek', parentId: team.id }, { get: () => undefined })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('the team resolves a team note without moving the brand-visible activity time', async () => {
    const { reviewId, team } = await roomWithNotes();
    const before = ((await roomDetail(reviewId)) as RoomReviewDetail).review.lastActivityAt;
    await new Promise((r) => setTimeout(r, 15));
    await teamNote(reviewId, { body: 'second internal note' });
    expect(await staffResolveComment(reviewDeps(deps), admin(), { reviewId, commentId: team.id })).toEqual({ ok: true });
    expect((await f.sql.query('select resolved_by from brand_studio_review_comments where id = $1', [team.id])).rows[0]).toEqual({ resolved_by: f.ids.admin });
    expect(((await roomDetail(reviewId)) as RoomReviewDetail).review.lastActivityAt).toBe(before);
  });
});

function runRoomReviewAs(viewer: ReturnType<typeof viewerOf>, operation: string, input: Record<string, unknown>) {
  return roomOp(f, deps, viewer, operation, input);
}
