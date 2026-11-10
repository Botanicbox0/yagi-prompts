import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import {
  loadReviewDetail,
  loadRoomReviewDetail,
  loadRoomReviews,
  runReviewOperation,
  staffDeliveryProjects,
  staffProjectStacks,
  staffResolveComment,
} from '@/lib/brand-studio/review';
import type { ReviewCommentAdded, ReviewCreated, RoomReviewDetail, RoomReviewList } from '@/lib/brand-studio/review-contracts';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, roomDraft, roomOp, seedOutput, seedProject, teamDelivery } from './fixtures';

/**
 * docs/BRAND-ROOMS.md §6 — deliverables in a project room against a real PGlite database: the room seat
 * guards every read and write, a version stack grows v1 -> v2 and carries the open notes, a carried note is
 * read-only and resolving it closes the original, ranges and drawings are stored and read back, the team
 * delivers files as `source = 'delivery'`, and every room line goes out after the write.
 */
const events = vi.hoisted(() => ({ calls: [] as Array<{ event: string; ref: unknown; actorRole: string; detail?: unknown }> }));
vi.mock('@/lib/brand-rooms/events', async (original) => ({
  ...(await original<typeof import('@/lib/brand-rooms/events')>()),
  postRoomEvent: async (_sql: unknown, input: { event: string; ref: unknown; actorRole: string; detail?: unknown }) => {
    events.calls.push(input);
  },
}));

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  events.calls = [];
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const list = async (viewer = owner()) => (await loadRoomReviews(reviewDeps(deps), viewer, f.orgId, f.projectId)) as RoomReviewList;
const detail = async (id: string, viewer = owner()) => (await loadRoomReviewDetail(reviewDeps(deps), viewer, f.orgId, f.projectId, id)) as RoomReviewDetail;

describe('a deliverable stack', () => {
  it('puts studio work into the room as v1 and posts v2 on the same stack', async () => {
    const v1 = await roomDraft(f, deps);
    expect(events.calls.map((e) => e.event)).toEqual(['review_posted']);
    const next = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const { result } = await roomOp(f, deps, owner(), 'review.version', { reviewId: v1, outputId: next });
    expect(result).toMatchObject({ ok: true, existing: false, review: { version: 2, stackId: v1, projectId: f.projectId, source: 'studio', title: 'Spring film' } });
    expect(events.calls.map((e) => [e.event, (e.detail as { version: number }).version])).toEqual([
      ['review_posted', 1],
      ['review_version', 2],
    ]);
    const stacks = (await list()).stacks;
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.versions.map((v) => v.version)).toEqual([2, 1]);
    const d = await detail((result as ReviewCreated).review.id);
    expect(d).toMatchObject({ ok: true, extended: true, canEdit: true, canTalk: true });
    expect(d.versions!.map((v) => v.version)).toEqual([2, 1]);
  });

  it('carries the open notes of the previous version, read-only, and resolving one closes the original', async () => {
    const v1 = await roomDraft(f, deps);
    const open = (await roomOp(f, deps, owner(), 'comment.add', { reviewId: v1, body: 'Logo too small', atMs: 1200, endMs: 2400 })).result as ReviewCommentAdded;
    const done = (await roomOp(f, deps, owner(), 'comment.add', { reviewId: v1, body: 'Fixed already' })).result as ReviewCommentAdded;
    await roomOp(f, deps, owner(), 'comment.resolve', { reviewId: v1, commentId: done.comment.id });
    const v2 = ((await roomOp(f, deps, owner(), 'review.version', { reviewId: v1, outputId: await seedOutput(deps, f.orgId, f.ids.owner, 'video') })).result as ReviewCreated).review.id;

    const d2 = await detail(v2);
    const carried = d2.comments.filter((c) => c.carriedFrom);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ body: 'Logo too small', atMs: 1200, endMs: 2400, carriedFrom: { version: 1 }, resolved: false });
    expect(d2.review.commentsOpen).toBe(1);

    // Read-only on the new version: no reply, no delete.
    expect((await roomOp(f, deps, owner(), 'comment.add', { reviewId: v2, body: 'reply', parentId: carried[0]!.id })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await roomOp(f, deps, owner(), 'comment.delete', { reviewId: v2, commentId: carried[0]!.id })).result).toEqual({ ok: false, code: 'forbidden' });

    await roomOp(f, deps, owner(), 'comment.resolve', { reviewId: v2, commentId: carried[0]!.id });
    const d1 = await detail(v1);
    expect(d1.comments.find((c) => c.id === open.comment.id)!.resolved).toBe(true);

    // v3 carries nothing that is resolved.
    const v3 = ((await roomOp(f, deps, owner(), 'review.version', { reviewId: v2, outputId: await seedOutput(deps, f.orgId, f.ids.owner, 'video') })).result as ReviewCreated).review.id;
    expect((await detail(v3)).comments.filter((c) => c.carriedFrom)).toHaveLength(0);
  });

  it('keeps ranges and drawings, and drops a range on a still', async () => {
    const film = await roomDraft(f, deps, 'video');
    const strokes = [
      { tool: 'pen', color: 'blue', points: [[0.1, 0.1], [0.2, 0.25], [0.3, 0.2]] },
      { tool: 'arrow', color: 'white', points: [[0.5, 0.5], [0.7, 0.4]] },
    ];
    const added = (await roomOp(f, deps, owner(), 'comment.add', { reviewId: film, body: 'Move this', atMs: 500, endMs: 1500, strokes })).result as ReviewCommentAdded;
    expect(added.comment).toMatchObject({ atMs: 500, endMs: 1500, strokes });
    expect((await detail(film)).comments[0]).toMatchObject({ endMs: 1500, strokes, guest: false, carriedFrom: null });

    const still = await roomDraft(f, deps, 'image', 'Key visual');
    const onStill = (await roomOp(f, deps, owner(), 'comment.add', { reviewId: still, body: 'Here', atMs: 500, endMs: 900, x: 0.4, y: 0.5, strokes })).result as ReviewCommentAdded;
    expect(onStill.comment).toMatchObject({ atMs: null, endMs: null, x: 0.4, strokes });

    for (const bad of [
      { atMs: 900, endMs: 900 },
      { endMs: 900 },
      { strokes: [{ tool: 'arrow', color: 'blue', points: [[0, 0], [0.5, 0.5], [1, 1]] }] },
      { strokes: [{ tool: 'pen', color: 'red', points: [[0, 0], [1, 1]] }] },
      { strokes: [{ tool: 'pen', color: 'blue', points: [[0, 0], [1.2, 1]] }] },
      { strokes: Array.from({ length: 25 }, () => ({ tool: 'pen', color: 'blue', points: [[0, 0], [1, 1]] })) },
    ]) {
      expect((await roomOp(f, deps, owner(), 'comment.add', { reviewId: film, body: 'x', ...bad })).result, JSON.stringify(bad)).toEqual({ ok: false, code: 'invalid' });
    }
  });
});

describe('who may do what in a room', () => {
  it('lets a viewer and an invited guest read and comment, but not version, move the status, resolve or share', async () => {
    const v1 = await roomDraft(f, deps);
    for (const who of [f.ids.viewer, f.ids.guest]) {
      const viewer = viewerOf(who);
      expect(await list(viewer)).toMatchObject({ ok: true, canEdit: false, canTalk: true });
      expect((await roomOp(f, deps, viewer, 'comment.add', { reviewId: v1, body: 'Looks good' })).result.ok).toBe(true);
      expect((await roomOp(f, deps, viewer, 'review.status', { reviewId: v1, status: 'approved' })).result).toEqual({ ok: false, code: 'forbidden' });
      expect((await roomOp(f, deps, viewer, 'review.version', { reviewId: v1, outputId: await seedOutput(deps, f.orgId, f.ids.owner) })).result).toEqual({ ok: false, code: 'forbidden' });
    }
    const note = (await detail(v1)).comments[0]!;
    expect((await roomOp(f, deps, viewerOf(f.ids.viewer), 'comment.resolve', { reviewId: v1, commentId: note.id })).result).toEqual({ ok: false, code: 'forbidden' });
  });

  it('keeps a guest to the project they were invited to, and outsiders out', async () => {
    const other = await seedProject(f);
    expect(await loadRoomReviews(reviewDeps(deps), viewerOf(f.ids.guest), f.orgId, other)).toEqual({ ok: false, code: 'not_found' });
    expect(await loadRoomReviews(reviewDeps(deps), viewerOf(f.ids.outsider), f.orgId, f.projectId)).toEqual({ ok: false, code: 'not_found' });
    expect(await loadRoomReviews(reviewDeps(deps), { ...viewerOf(f.ids.owner), userId: null }, f.orgId, f.projectId)).toEqual({ ok: false, code: 'sign_in_required' });
  });

  it('never shows a draft of another project through this one', async () => {
    const v1 = await roomDraft(f, deps);
    const other = await seedProject(f);
    expect(await loadRoomReviewDetail(reviewDeps(deps), owner(), f.orgId, other, v1)).toEqual({ ok: false, code: 'not_found' });
    expect((await runRoomReviewOp(other, 'comment.add', { reviewId: v1, body: 'x' })).result).toEqual({ ok: false, code: 'not_found' });
  });

  it('approves with a room line, and joins an existing studio review to the room', async () => {
    const v1 = await roomDraft(f, deps);
    events.calls = [];
    await roomOp(f, deps, owner(), 'review.status', { reviewId: v1, status: 'approved' });
    expect(events.calls.map((e) => [e.event, e.actorRole])).toEqual([['review_approved', 'brand']]);

    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'image');
    const studio = (await runReviewOperation(reviewDeps(deps), owner(), 'review.create', { organizationId: f.orgId, outputId, title: 'From the studio' })).result as ReviewCreated;
    expect(studio.review.projectId).toBeNull();
    const joined = (await roomOp(f, deps, owner(), 'review.create', { outputId, title: 'ignored' })).result as ReviewCreated;
    expect(joined.review).toMatchObject({ id: studio.review.id, projectId: f.projectId });
  });

  it('answers the sandboxed brand with the same 404 everywhere', async () => {
    const sandboxed = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]! });
    try {
      const d = studioDeps(sandboxed.sql);
      expect(await loadRoomReviews(reviewDeps(d), viewerOf(sandboxed.ids.owner), sandboxed.orgId, sandboxed.projectId)).toEqual({ ok: false, code: 'not_found' });
      const outputId = await seedOutput(d, sandboxed.orgId, sandboxed.ids.owner);
      const out = await runRoomReviewOpFor(sandboxed, d, 'review.create', { outputId, title: 'x' });
      expect(out.result).toEqual({ ok: false, code: 'not_found' });
      expect((await sandboxed.sql.query('select count(*)::int as n from brand_studio_reviews')).rows[0]).toEqual({ n: 0 });
    } finally {
      await sandboxed.db.close();
    }
  });
});

describe('the YAGI team delivers', () => {
  it('makes a delivery asset and a draft, then v2 on the same stack, and refuses the sandboxed brand', async () => {
    const first = await teamDelivery(f, deps);
    expect(first).toMatchObject({ ok: true, created: { existing: false, review: { source: 'delivery', version: 1, projectId: f.projectId, kind: 'image' } } });
    const v1 = (first as { created: ReviewCreated }).created.review.id;
    const asset = (await f.sql.query("select source, created_by from brand_studio_assets where source = 'delivery'")).rows;
    expect(asset).toEqual([{ source: 'delivery', created_by: f.ids.admin }]);
    const second = await teamDelivery(f, deps, { stackReviewId: v1, colour: 90 });
    expect(second).toMatchObject({ ok: true, created: { review: { version: 2, stackId: v1, source: 'delivery' } } });
    expect(events.calls.map((e) => [e.event, e.actorRole])).toEqual([
      ['review_posted', 'studio'],
      ['review_version', 'studio'],
    ]);
    // The same bytes again reuse the library file and its review.
    const again = await teamDelivery(f, deps, { colour: 90 });
    expect(again).toMatchObject({ ok: true, created: { existing: true } });
    expect((again as { unusedKeys: string[] }).unusedKeys.length).toBeGreaterThan(0);

    const stacks = await staffProjectStacks(reviewDeps(deps), { ...viewerOf(f.ids.admin), isAdmin: true }, { organizationId: f.orgId, projectId: f.projectId });
    expect(stacks).toMatchObject({ ok: true, stacks: [{ versions: [{ version: 2 }, { version: 1 }] }] });
    expect(await teamDelivery(f, deps, { colour: 10 }).then((r) => r.ok)).toBe(true);
    // A brand member is not the team.
    expect(await staffProjectStacks(reviewDeps(deps), owner(), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'forbidden' });
    const projects = await staffDeliveryProjects(reviewDeps(deps), { ...viewerOf(f.ids.admin), isAdmin: true });
    expect(projects).toMatchObject({ ok: true, projects: [{ projectId: f.projectId }] });
  });

  it('lets the team resolve a carried note like the brand does', async () => {
    const first = (await teamDelivery(f, deps)) as { created: ReviewCreated };
    const v1 = first.created.review.id;
    const note = (await roomOp(f, deps, owner(), 'comment.add', { reviewId: v1, body: 'Too dark' })).result as ReviewCommentAdded;
    const v2 = ((await teamDelivery(f, deps, { stackReviewId: v1, colour: 120 })) as { created: ReviewCreated }).created.review.id;
    const carried = (await detail(v2)).comments.find((c) => c.carriedFrom)!;
    expect(await staffResolveComment(reviewDeps(deps), { ...viewerOf(f.ids.admin), isAdmin: true }, { reviewId: v2, commentId: carried.id })).toEqual({ ok: true });
    expect((await detail(v1)).comments.find((c) => c.id === note.comment.id)!.resolved).toBe(true);
  });
});

describe('the studio review screen', () => {
  it('stays the v3 screen while rooms are off, and gains versions when on', async () => {
    const v1 = await roomDraft(f, deps);
    vi.stubEnv('BRAND_ROOMS', 'off');
    const off = await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, v1);
    expect(off.ok && 'extended' in off).toBe(false);
    vi.stubEnv('BRAND_ROOMS', 'on');
    const on = await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, v1);
    expect(on).toMatchObject({ ok: true, extended: true, versions: [{ id: v1, version: 1 }] });
  });
});

function runRoomReviewOp(projectId: string, operation: string, input: Record<string, unknown>) {
  return import('@/lib/brand-studio/review').then(({ runRoomReviewOperation }) =>
    runRoomReviewOperation(reviewDeps(deps), owner(), operation, { organizationId: f.orgId, projectId, ...input }),
  );
}

function runRoomReviewOpFor(fx: StudioFixture, d: ReturnType<typeof studioDeps>, operation: string, input: Record<string, unknown>) {
  return import('@/lib/brand-studio/review').then(({ runRoomReviewOperation }) =>
    runRoomReviewOperation(reviewDeps(d), viewerOf(fx.ids.owner), operation, { organizationId: fx.orgId, projectId: fx.projectId, ...input }),
  );
}
