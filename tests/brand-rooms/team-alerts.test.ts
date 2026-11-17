import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { memoryStaging, pngBytes, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §3 — the two customer moves that reached nobody now reach the team's internal
 * notifier (Slack), after the answer and best effort: a guest's note through a share link, and a brand's
 * approval or change request on the team's storyboard. A team note (§5) never does, the guest learns
 * nothing new from the answer, and the link's limits stay as they were.
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  after: [] as Array<() => unknown>,
  notify: vi.fn(async (_sql: unknown, _notice: unknown) => ({ sent: true })),
  media: null as unknown,
  staging: null as unknown,
}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => unknown) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
  requireAdmin: async () => mocks.viewer,
}));
vi.mock('@/lib/brands/concierge-slack', () => ({ notifySlackBrandConcierge: mocks.notify }));
vi.mock('@/lib/storage', async (original) => ({ ...(await original<typeof import('@/lib/storage')>()), getStorage: async () => mocks.staging }));
vi.mock('@/lib/brand-studio/media-store', async (original) => ({
  ...(await original<typeof import('@/lib/brand-studio/media-store')>()),
  createStudioMediaStore: () => mocks.media,
}));

const publicRoute = await import('@/app/api/brand-rooms/shares/public/route');
const boardsRoute = await import('@/app/api/brand-rooms/storyboards/route');
const { createShare, guestComment } = await import('@/lib/brand-rooms/shares');
const { runStoryboardOperation, staffCreateStoryboard, staffReplaceFrames, staffShareStoryboard } = await import('@/lib/brand-rooms/storyboards');
const { dispatchAdmin } = await import('@/lib/admin/dispatch');
const { roomDraft } = await import('./review/fixtures');
type ShareCreated = import('@/lib/brand-rooms/share-contracts').ShareCreated;
type RoomTeamNotice = import('@/lib/brand-rooms/team-notice').RoomTeamNotice;

let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  mocks.after.length = 0;
  mocks.notify.mockReset();
  mocks.notify.mockResolvedValue({ sent: true });
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.viewer = null;
  mocks.media = createMemoryMediaStore();
  mocks.staging = memoryStaging();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  mocks.sql = null;
});

const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const runAfter = async () => {
  for (const task of mocks.after.splice(0)) await task();
};
const noCookies = { get: () => undefined };

async function sharedDraft(allowComments = true): Promise<{ reviewId: string; token: string }> {
  const deps = studioDeps(f.sql);
  const reviewId = await roomDraft(f, deps, 'video', 'Spring film');
  const created = (await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: 'review', targetId: reviewId, allowComments })) as ShareCreated;
  return { reviewId, token: created.token };
}

async function teamBoard(): Promise<string> {
  const deps = { ...studioDeps(f.sql) };
  const made = await staffCreateStoryboard(deps, admin(), { projectId: f.projectId, title: 'Launch film' });
  const id = (made as { board: { id: string } }).board.id;
  await staffReplaceFrames(deps, admin(), { storyboardId: id, frames: [{ picture: await pngBytes(30, 40), text: { scene: '1', shot: '1', description: 'Open on the bottle' } }] });
  expect(await staffShareStoryboard(deps, admin(), { storyboardId: id })).toMatchObject({ ok: true });
  return id;
}

describe("a guest's note", () => {
  it('builds one notice for the team, with the note made inert for Slack and the desk to open', async () => {
    const { reviewId, token } = await sharedDraft();
    const notify = vi.fn();
    const added = await guestComment({ sql: f.sql, media: createMemoryMediaStore(), notify }, { token, name: 'Jin <@U1>', body: '<!channel> brighter & warmer', atMs: 1500 }, noCookies);
    expect(added).toMatchObject({ ok: true });
    expect(notify).toHaveBeenCalledTimes(1);
    const notice = notify.mock.calls[0]![0] as RoomTeamNotice;
    expect(notice).toMatchObject({ organizationId: f.orgId, userId: null, messageId: (added as { comment: { id: string } }).comment.id, sender: { label: 'Jin &lt;@U1&gt;', role: '공유 링크 외부인' } });
    expect(notice.body).toContain('[공유 링크 의견] Spring film · 0:01');
    expect(notice.body).toContain('&lt;!channel&gt; brighter &amp; warmer');
    expect(notice.body).not.toContain('<!channel>');
    expect(notice.body).toContain(`관리자 화면: /admin/brand-rooms/${f.orgId}/${f.projectId}?review=${reviewId}&t=1500`);
  });

  it('builds nothing when the note is refused, and the link limits are unchanged', async () => {
    const closed = await sharedDraft(false);
    const notify = vi.fn();
    const deps = { sql: f.sql, media: createMemoryMediaStore(), notify };
    expect(await guestComment(deps, { token: closed.token, name: 'Jin', body: 'x' }, noCookies)).toEqual({ ok: false, code: 'comments_closed' });
    const open = await sharedDraft();
    for (let i = 0; i < 6; i += 1) expect((await guestComment(deps, { token: open.token, name: 'Jin', body: `note ${i}` }, noCookies)).ok).toBe(true);
    expect(await guestComment(deps, { token: open.token, name: 'Jin', body: 'too many' }, noCookies)).toEqual({ ok: false, code: 'rate_limited' });
    expect(notify).toHaveBeenCalledTimes(6);
  });

  it('reaches Slack after the answer through the public door, and the answer carries nothing new', async () => {
    const { token } = await sharedDraft();
    const response = await publicRoute.POST(
      new NextRequest('http://localhost:3000/api/brand-rooms/shares/public', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'comment', token, name: 'Jin', body: 'Love it' }) }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['comment', 'ok']);
    expect(JSON.stringify(body)).not.toContain('관리자 화면');
    expect(mocks.notify).not.toHaveBeenCalled();
    await runAfter();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0]![1]).toMatchObject({ organizationId: f.orgId, userId: null, body: expect.stringContaining('Love it') });
  });

  it('a Slack failure changes nothing for the guest', async () => {
    const { token } = await sharedDraft();
    mocks.notify.mockRejectedValue(new Error('slack down'));
    const response = await publicRoute.POST(
      new NextRequest('http://localhost:3000/api/brand-rooms/shares/public', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'comment', token, name: 'Jin', body: 'Again' }) }),
    );
    expect(response.status).toBe(201);
    await expect(runAfter()).resolves.toBeUndefined();
  });
});

describe("a brand's decision on the team's storyboard", () => {
  const decide = (viewer: Viewer, storyboardId: string, status: string, notify = vi.fn()) =>
    runStoryboardOperation({ ...studioDeps(f.sql), notify }, viewer, 'board.status', { organizationId: f.orgId, projectId: f.projectId, storyboardId, status }).then((result) => ({ result, notify }));

  it('tells the team about an approval and a change request, once each, and not about a reopen or a repeat', async () => {
    const id = await teamBoard();
    const changes = await decide(viewerOf(f.ids.editor), id, 'changes_requested');
    expect(changes.result).toMatchObject({ ok: true });
    expect(changes.notify).toHaveBeenCalledTimes(1);
    expect(changes.notify.mock.calls[0]![0]).toEqual({
      organizationId: f.orgId,
      userId: f.ids.editor,
      messageId: id,
      body: `[스토리보드 수정 요청] Launch film · v1\n관리자 화면: /admin/brand-rooms/storyboards/${id}`,
    });
    expect((await decide(viewerOf(f.ids.editor), id, 'changes_requested')).notify).not.toHaveBeenCalled();
    const approved = await decide(viewerOf(f.ids.owner), id, 'approved');
    expect(approved.notify.mock.calls[0]![0]).toMatchObject({ userId: f.ids.owner, body: expect.stringContaining('[스토리보드 승인] Launch film') });
    expect((await decide(viewerOf(f.ids.owner), id, 'shared')).notify).not.toHaveBeenCalled();
    // A viewer may not decide: no notice either.
    const refused = await decide(viewerOf(f.ids.viewer), id, 'approved');
    expect(refused.result).toEqual({ ok: false, code: 'forbidden' });
    expect(refused.notify).not.toHaveBeenCalled();
  });

  it('reaches Slack after the answer through the storyboards route', async () => {
    const id = await teamBoard();
    mocks.viewer = viewerOf(f.ids.owner);
    const response = await boardsRoute.POST(
      new NextRequest('http://localhost:3000/api/brand-rooms/storyboards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'board.status', input: { organizationId: f.orgId, projectId: f.projectId, storyboardId: id, status: 'approved' } }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.notify).not.toHaveBeenCalled();
    await runAfter();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0]![1]).toMatchObject({ organizationId: f.orgId, userId: f.ids.owner, messageId: id });
  });
});

describe('a team note', () => {
  it('never reaches Slack', async () => {
    const reviewId = await roomDraft(f, studioDeps(f.sql));
    const form = new FormData();
    for (const [k, v] of Object.entries({ _op: 'brand_studio.review.reply', reviewId, body: 'Ask the colourist', visibility: 'team' })) form.set(k, v);
    const outcome = await dispatchAdmin('brand_studio.review.reply', form, { sql: f.sql, storage: {} as never, viewer: admin(), defer: (task) => mocks.after.push(task) });
    expect(outcome).toMatchObject({ ok: true });
    await runAfter();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
