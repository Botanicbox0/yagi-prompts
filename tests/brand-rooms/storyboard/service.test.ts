import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadStoryboardDetail,
  loadStoryboardList,
  staffCreateStoryboard,
  staffNewVersion,
  staffReplaceFrames,
  staffShareStoryboard,
  storyboardForShare,
} from '@/lib/brand-rooms/storyboards';
import type { StoryboardDetail, StoryboardList } from '@/lib/brand-rooms/storyboard-contracts';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { pngBytes, seedImageAsset, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';
import { seedOutput } from '../../brand-studio/review/fixtures';
import { boardDeps, brandBoard, op, threadMessage, uploadCut } from './fixtures';

/**
 * docs/BRAND-ROOMS.md §5, §8, §9 — the storyboard service against a real PGlite database: who may read
 * and write, pictures checked by their bytes and copied from the studio, cuts that change only while
 * their board is a draft, the team's drafts hidden from the brand, versions and "바뀐 컷", thread
 * counts read from the conversation table, the limits, the events, and the sandbox hardline.
 */
const events = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));
vi.mock('@/lib/brand-rooms/events', async (original) => ({
  ...(await original<typeof import('@/lib/brand-rooms/events')>()),
  postRoomEvent: async (_sql: unknown, input: unknown) => {
    events.calls.push(input);
    if (events.fail) throw new Error('chat is down');
  },
}));

let f: StudioFixture;
let deps: ReturnType<typeof boardDeps>;
beforeEach(async () => {
  events.calls.length = 0;
  events.fail = false;
  f = await studioFixture();
  deps = boardDeps(f);
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const list = async (viewer = owner()) => (await loadStoryboardList(deps, viewer, f.orgId, f.projectId)) as StoryboardList;
const detail = async (boardId: string, viewer = owner()) => (await loadStoryboardDetail(deps, viewer, f.orgId, f.projectId, boardId)) as StoryboardDetail;

describe('a brand making its own storyboard', () => {
  it('lets owners and editors write, and viewers and invited guests only read', async () => {
    const boardId = await brandBoard(deps, f, owner());
    expect((await op(deps, f, viewerOf(f.ids.editor), 'board.update', { storyboardId: boardId, title: '  New   title ' }))).toMatchObject({ ok: true, board: { title: 'New title' } });
    expect(await op(deps, f, viewerOf(f.ids.viewer), 'board.create', { title: 'Mine' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(deps, f, viewerOf(f.ids.guest), 'board.create', { title: 'Mine' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(deps, f, viewerOf(f.ids.outsider), 'board.create', { title: 'Mine' })).toEqual({ ok: false, code: 'not_found' });
    expect(await op(deps, f, { ...viewerOf(f.ids.owner), userId: null }, 'board.create', { title: 'x' })).toEqual({ ok: false, code: 'sign_in_required' });
    for (const who of [f.ids.viewer, f.ids.guest]) {
      expect((await loadStoryboardList(deps, viewerOf(who), f.orgId, f.projectId)) as StoryboardList).toMatchObject({ ok: true, canEdit: false, boards: [{ id: boardId }] });
    }
    expect(await loadStoryboardList(deps, viewerOf(f.ids.outsider), f.orgId, f.projectId)).toEqual({ ok: false, code: 'not_found' });
  });

  it('turns an uploaded picture into a cut: checked, measured, thumbnailed and stored under a fresh key', async () => {
    const boardId = await brandBoard(deps, f, owner());
    const saved = await uploadCut(deps, f, owner(), boardId, { bytes: await pngBytes(120, 80), text: { scene: '1', shot: '3', description: 'The bottle turns', seconds: 2.5 } });
    expect(saved.frame).toMatchObject({ idx: 0, scene: '1', shot: '3', description: 'The bottle turns', seconds: 2.5, width: 120, height: 80, threadCount: 0 });
    expect(saved.frame.url).toMatch(/\/api\/brand-studio\/media\/st\/[0-9a-f]{64}\.png$/);
    expect(saved.frame.thumbUrl).toMatch(/\.webp$/);
    expect(deps.media.objects.size).toBe(2);
    const view = await detail(boardId);
    expect(view).toMatchObject({ ok: true, editable: true, canEdit: true, previous: null, board: { status: 'draft', createdRole: 'brand', frames: [{ id: saved.frame.id }] } });
  });

  it('refuses a picture whose bytes are not what was reserved, a GIF, and anything above 25 MB', async () => {
    const boardId = await brandBoard(deps, f, owner());
    const png = await pngBytes(20, 20);
    expect(await op(deps, f, owner(), 'frame.reserve', { storyboardId: boardId, name: 'a.gif', mime: 'image/gif', sizeBytes: 10 })).toEqual({ ok: false, code: 'invalid' });
    expect(await op(deps, f, owner(), 'frame.reserve', { storyboardId: boardId, name: 'a.png', mime: 'image/png', sizeBytes: 26 * 1024 * 1024 })).toEqual({ ok: false, code: 'file_too_large' });
    const reserved = (await op(deps, f, owner(), 'frame.reserve', { storyboardId: boardId, name: 'a.png', mime: 'image/png', sizeBytes: png.byteLength + 3 })) as { frameId: string };
    await deps.staging.putStaging(`brand-rooms/storyboards/${f.orgId}/${reserved.frameId}`, png, 'image/png');
    expect(await op(deps, f, owner(), 'frame.complete', { storyboardId: boardId, frameId: reserved.frameId })).toEqual({ ok: false, code: 'unsupported_file' });
    const text = new TextEncoder().encode('not a picture at all');
    const other = (await op(deps, f, owner(), 'frame.reserve', { storyboardId: boardId, name: 'b.png', mime: 'image/png', sizeBytes: text.byteLength })) as { frameId: string };
    await deps.staging.putStaging(`brand-rooms/storyboards/${f.orgId}/${other.frameId}`, text, 'image/png');
    expect(await op(deps, f, owner(), 'frame.complete', { storyboardId: boardId, frameId: other.frameId })).toEqual({ ok: false, code: 'unsupported_file' });
    expect(deps.media.objects.size).toBe(0);
    expect((await detail(boardId)).board.frames).toEqual([]);
  });

  it('copies a studio image into its own cut and refuses another brand’s asset or a video', async () => {
    const boardId = await brandBoard(deps, f, owner());
    const assetId = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 64, height: 48 });
    const asset = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [assetId])).rows[0]!;
    const added = await op(deps, f, owner(), 'frame.add', { storyboardId: boardId, assetId, text: { description: 'From the library' } });
    expect(added).toMatchObject({ ok: true, frame: { sourceAssetId: assetId, description: 'From the library', width: 64, height: 48 } });
    expect((added as { frame: { url: string } }).frame.url).not.toContain(asset.storage_key);

    const video = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    expect(await op(deps, f, owner(), 'frame.add', { storyboardId: boardId, outputId: video })).toEqual({ ok: false, code: 'unsupported_file' });
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other', f.ids.owner, randomUUID()]);
    const foreign = await seedImageAsset(deps, otherOrg, f.ids.owner);
    expect(await op(deps, f, owner(), 'frame.add', { storyboardId: boardId, assetId: foreign })).toEqual({ ok: false, code: 'not_found' });
  });

  it('edits words in bulk, reorders only with every cut once, deletes a cut and its now-unused picture', async () => {
    const boardId = await brandBoard(deps, f, owner());
    const a = (await uploadCut(deps, f, owner(), boardId)).frame.id;
    const b = (await uploadCut(deps, f, owner(), boardId)).frame.id;
    const c = (await uploadCut(deps, f, owner(), boardId)).frame.id;
    expect(
      await op(deps, f, owner(), 'frame.update', {
        storyboardId: boardId,
        frames: [
          { frameId: a, description: 'First', camera: 'Slow push in' },
          { frameId: b, seconds: 4, audio: '' },
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(await op(deps, f, owner(), 'frame.reorder', { storyboardId: boardId, frameIds: [c, a] })).toEqual({ ok: false, code: 'conflict' });
    expect(await op(deps, f, owner(), 'frame.reorder', { storyboardId: boardId, frameIds: [c, a, b] })).toEqual({ ok: true });
    let view = await detail(boardId);
    expect(view.board.frames.map((x) => [x.id, x.idx])).toEqual([
      [c, 0],
      [a, 1],
      [b, 2],
    ]);
    expect(view.board.frames[1]).toMatchObject({ description: 'First', camera: 'Slow push in' });
    expect(view.board.frames[2]).toMatchObject({ seconds: 4, audio: null });
    const before = deps.media.objects.size;
    expect(await op(deps, f, owner(), 'frame.delete', { storyboardId: boardId, frameId: a })).toEqual({ ok: true });
    expect(deps.media.objects.size).toBe(before - 2);
    view = await detail(boardId);
    expect(view.board.frames.map((x) => x.id)).toEqual([c, b]);
  });

  it('shares once there is a cut, then changes cuts only in a new version that shares the pictures', async () => {
    const boardId = await brandBoard(deps, f, owner());
    expect(await op(deps, f, owner(), 'board.share', { storyboardId: boardId })).toEqual({ ok: false, code: 'empty' });
    const cut = (await uploadCut(deps, f, owner(), boardId, { text: { description: 'One' } })).frame;
    expect(await op(deps, f, owner(), 'board.share', { storyboardId: boardId })).toMatchObject({ ok: true, board: { status: 'shared', cuts: 1 } });
    expect(events.calls).toEqual([expect.objectContaining({ event: 'storyboard_shared', actorRole: 'brand', ref: { kind: 'storyboard', storyboardId: boardId } })]);
    expect(await op(deps, f, owner(), 'frame.update', { storyboardId: boardId, frames: [{ frameId: cut.id, description: 'Two' }] })).toEqual({ ok: false, code: 'not_editable' });
    expect(await op(deps, f, owner(), 'board.share', { storyboardId: boardId })).toEqual({ ok: false, code: 'conflict' });
    // A brand does not approve its own board: that decision is about the team's work.
    expect(await op(deps, f, owner(), 'board.status', { storyboardId: boardId, status: 'approved' })).toEqual({ ok: false, code: 'forbidden' });

    const next = await op(deps, f, owner(), 'board.version', { storyboardId: boardId });
    expect(next).toMatchObject({ ok: true, board: { version: 2, status: 'draft', cuts: 1 } });
    const v2 = (next as { board: { id: string } }).board.id;
    const keys = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_storyboard_frames where storyboard_id = any($1::uuid[])', [[boardId, v2]])).rows;
    expect(new Set(keys.map((k) => k.storage_key)).size).toBe(1);
    const copy = (await detail(v2)).board.frames[0]!;
    await op(deps, f, owner(), 'frame.update', { storyboardId: v2, frames: [{ frameId: copy.id, description: 'Two' }] });
    const view = await detail(v2);
    expect(view).toMatchObject({ editable: true, previous: { id: boardId, version: 1 }, changedFrameIds: [copy.id], removedCount: 0 });
    expect(view.versions.map((v) => v.version)).toEqual([2, 1]);
    // Deleting the copy keeps the picture the first version still shows.
    const objects = deps.media.objects.size;
    await op(deps, f, owner(), 'frame.delete', { storyboardId: v2, frameId: copy.id });
    expect(deps.media.objects.size).toBe(objects);
  });

  it('deletes only its own boards, softly', async () => {
    const boardId = await brandBoard(deps, f, owner());
    expect(await op(deps, f, owner(), 'board.delete', { storyboardId: boardId })).toEqual({ ok: true });
    expect((await list()).boards).toEqual([]);
    expect(await loadStoryboardDetail(deps, owner(), f.orgId, f.projectId, boardId)).toEqual({ ok: false, code: 'not_found' });
    expect((await f.sql.query('select deleted_at from brand_storyboards where id = $1', [boardId])).rows[0]).toMatchObject({ deleted_at: expect.anything() });
  });

  it('keeps the limits: 200 cuts per board, 50 boards per project', async () => {
    const boardId = await brandBoard(deps, f, owner());
    const key = `st/${'b'.repeat(64)}.png`;
    await f.sql.query(
      `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, storage_key) select $1, $2, g, $3 from generate_series(0, 199) g`,
      [boardId, f.orgId, key],
    );
    expect(await op(deps, f, owner(), 'frame.reserve', { storyboardId: boardId, name: 'a.png', mime: 'image/png', sizeBytes: 10 })).toEqual({ ok: false, code: 'limit_reached' });
    await f.sql.query(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, title, created_role) select $1, $2, gen_random_uuid(), 'x', 'brand' from generate_series(1, 49)`,
      [f.orgId, f.projectId],
    );
    expect(await op(deps, f, owner(), 'board.create', { title: 'One more' })).toEqual({ ok: false, code: 'limit_reached' });
  });
});

describe('a storyboard the YAGI team makes', () => {
  async function teamBoard(): Promise<{ id: string; cuts: string[] }> {
    const made = await staffCreateStoryboard(deps, admin(), { projectId: f.projectId, title: 'Launch film' });
    expect(made).toMatchObject({ ok: true, board: { createdRole: 'studio', status: 'draft' } });
    const id = (made as { board: { id: string } }).board.id;
    const saved = await staffReplaceFrames(deps, admin(), {
      storyboardId: id,
      frames: [
        { picture: await pngBytes(30, 40), text: { scene: '1', shot: '1', description: 'Open on the bottle' } },
        { picture: await pngBytes(40, 30), text: { scene: '1', shot: '2', description: 'Close on the label', seconds: 3 } },
      ],
    });
    expect(saved).toMatchObject({ ok: true, board: { cuts: 2 } });
    const cuts = (await f.sql.query<{ id: string }>("select id from brand_storyboard_frames where storyboard_id = $1 order by idx", [id])).rows.map((r) => r.id);
    return { id, cuts };
  }

  it('stays hidden from the brand until it is shared', async () => {
    const { id } = await teamBoard();
    expect((await list()).boards).toEqual([]);
    expect(await loadStoryboardDetail(deps, owner(), f.orgId, f.projectId, id)).toEqual({ ok: false, code: 'not_found' });
    expect(await op(deps, f, owner(), 'board.status', { storyboardId: id, status: 'approved' })).toEqual({ ok: false, code: 'not_found' });
    expect(await storyboardForShare(deps, f.orgId, id)).toBeNull();
    expect(await staffShareStoryboard(deps, admin(), { storyboardId: id })).toMatchObject({ ok: true, board: { status: 'shared' } });
    expect(events.calls).toEqual([expect.objectContaining({ event: 'storyboard_shared', actorRole: 'studio', actorId: f.ids.admin })]);
    expect((await list()).boards).toMatchObject([{ id, createdRole: 'studio', status: 'shared', cuts: 2, seconds: 5 }]);
    expect(await detail(id)).toMatchObject({ editable: false, board: { frames: [{ shot: '1' }, { shot: '2', seconds: 3 }] } });
    expect(await storyboardForShare(deps, f.orgId, id)).toMatchObject({ id, frames: [{ threadCount: 0 }, { threadCount: 0 }] });
  });

  it('is approved or sent back by an editor, not by a viewer, and the brand cannot change its cuts', async () => {
    const { id, cuts } = await teamBoard();
    await staffShareStoryboard(deps, admin(), { storyboardId: id });
    events.calls.length = 0;
    expect(await op(deps, f, viewerOf(f.ids.viewer), 'board.status', { storyboardId: id, status: 'approved' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(deps, f, owner(), 'board.update', { storyboardId: id, title: 'Mine now' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(deps, f, owner(), 'frame.delete', { storyboardId: id, frameId: cuts[0] })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(deps, f, owner(), 'board.version', { storyboardId: id })).toEqual({ ok: false, code: 'forbidden' });
    expect(await op(deps, f, viewerOf(f.ids.editor), 'board.status', { storyboardId: id, status: 'changes_requested' })).toMatchObject({ ok: true, board: { status: 'changes_requested' } });
    expect(await op(deps, f, owner(), 'board.status', { storyboardId: id, status: 'approved' })).toMatchObject({ ok: true, board: { status: 'approved' } });
    expect(await op(deps, f, owner(), 'board.status', { storyboardId: id, status: 'shared' })).toMatchObject({ ok: true, board: { status: 'shared' } });
    expect(events.calls.map((e) => (e as { event: string }).event)).toEqual(['storyboard_changes_requested', 'storyboard_approved']);
  });

  it('marks the cuts that changed in a new version, and the brand sees it only once shared', async () => {
    const { id, cuts } = await teamBoard();
    await staffShareStoryboard(deps, admin(), { storyboardId: id });
    const next = await staffNewVersion(deps, admin(), { storyboardId: id });
    expect(next).toMatchObject({ ok: true, board: { version: 2, status: 'draft', createdRole: 'studio' } });
    const v2 = (next as { board: { id: string } }).board.id;
    expect((await list()).boards.map((b) => b.version)).toEqual([1]);
    const copies = (await f.sql.query<{ id: string }>("select id from brand_storyboard_frames where storyboard_id = $1 order by idx", [v2])).rows.map((r) => r.id);
    // Swap the order, reword the second cut, add a third.
    await staffReplaceFrames(deps, admin(), {
      storyboardId: v2,
      frames: [
        { id: copies[1], text: { scene: '1', shot: '2', description: 'Close on the new label', seconds: 3 } },
        { id: copies[0], text: { scene: '1', shot: '1', description: 'Open on the bottle' } },
        { picture: await pngBytes(50, 50), text: { description: 'Logo end card' } },
      ],
    });
    events.calls.length = 0;
    await staffShareStoryboard(deps, admin(), { storyboardId: v2 });
    expect(events.calls).toEqual([expect.objectContaining({ event: 'storyboard_version', detail: { title: 'Launch film', version: 2 } })]);
    const boards = (await list()).boards;
    expect(boards.map((b) => [b.version, b.lineageId === boards[0]!.lineageId])).toEqual([
      [2, true],
      [1, true],
    ]);
    const view = await detail(v2);
    expect(view.previous).toEqual({ id, version: 1 });
    expect(view.changedFrameIds).toHaveLength(2);
    expect(view.changedFrameIds).toContain(copies[1]);
    expect(view.changedFrameIds).not.toContain(copies[0]);
    expect(view.removedCount).toBe(0);
    expect(cuts).toHaveLength(2);
    // Dropping a cut in a third version is a removal, not a change.
    const v3 = ((await staffNewVersion(deps, admin(), { storyboardId: v2 })) as { board: { id: string } }).board.id;
    const v3cuts = (await f.sql.query<{ id: string }>("select id from brand_storyboard_frames where storyboard_id = $1 order by idx", [v3])).rows.map((r) => r.id);
    await staffReplaceFrames(deps, admin(), { storyboardId: v3, frames: v3cuts.slice(0, 2).map((cutId, i) => ({ id: cutId, text: i === 0 ? { scene: '1', shot: '2', description: 'Close on the new label', seconds: 3 } : { scene: '1', shot: '1', description: 'Open on the bottle' } })) });
    await staffShareStoryboard(deps, admin(), { storyboardId: v3 });
    expect(await detail(v3)).toMatchObject({ previous: { version: 2 }, changedFrameIds: [], removedCount: 1 });
  });

  it('counts each cut’s thread from the conversation table, and reads zero when that table is gone', async () => {
    const { id, cuts } = await teamBoard();
    await staffShareStoryboard(deps, admin(), { storyboardId: id });
    await threadMessage(f, id, cuts[0]!);
    await threadMessage(f, id, cuts[0]!);
    await threadMessage(f, id, cuts[0]!, { deleted: true });
    await threadMessage(f, id, cuts[1]!);
    expect((await detail(id)).board.frames.map((x) => x.threadCount)).toEqual([2, 1]);
    await f.sql.query('drop table brand_room_messages cascade');
    expect((await detail(id)).board.frames.map((x) => x.threadCount)).toEqual([0, 0]);
  });

  it('never fails the write when the conversation line cannot be posted', async () => {
    const { id } = await teamBoard();
    events.fail = true;
    expect(await staffShareStoryboard(deps, admin(), { storyboardId: id })).toMatchObject({ ok: true, board: { status: 'shared' } });
  });

  it('re-reads the admin flag and refuses a non-admin', async () => {
    expect(await staffCreateStoryboard(deps, viewerOf(f.ids.owner), { projectId: f.projectId, title: 'x' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await staffCreateStoryboard(deps, { ...viewerOf(f.ids.owner), isAdmin: true }, { projectId: f.projectId, title: 'x' })).toEqual({ ok: false, code: 'forbidden' });
  });
});

describe('the sandbox hardline', () => {
  for (const options of [{ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]! }, { orgName: 'Morphic Korea' }, { orgName: '모픽' }]) {
    it(`closes storyboards for ${JSON.stringify(options)} on the brand side and the team side`, async () => {
      await f.db.close();
      f = await studioFixture(options);
      deps = boardDeps(f);
      expect(await loadStoryboardList(deps, owner(), f.orgId, f.projectId)).toEqual({ ok: false, code: 'not_found' });
      expect(await op(deps, f, owner(), 'board.create', { title: 'x' })).toEqual({ ok: false, code: 'not_found' });
      expect(await staffCreateStoryboard(deps, admin(), { projectId: f.projectId, title: 'x' })).toEqual({ ok: false, code: 'not_found' });
      // Even a row put there by hand is never shown or shared.
      const id = (
        await f.sql.query<{ id: string }>(
          `insert into brand_storyboards (organization_id, project_id, lineage_id, title, created_role, status, shared_at) values ($1, $2, gen_random_uuid(), 'x', 'studio', 'shared', now()) returning id`,
          [f.orgId, f.projectId],
        )
      ).rows[0]!.id;
      expect(await storyboardForShare(deps, f.orgId, id)).toBeNull();
      expect(await staffShareStoryboard(deps, admin(), { storyboardId: id })).toEqual({ ok: false, code: 'not_found' });
      expect((await f.sql.query('select count(*)::int as n from brand_storyboards')).rows[0]).toEqual({ n: 1 });
    });
  }
});
