import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { createShare, loadSharePage, resolveShare, staffProjectShares } from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import { staffCreateStoryboard, staffReplaceFrames, staffShareStoryboard } from '@/lib/brand-rooms/storyboards';
import { pngBytes, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { roomDraft, seedProject } from './fixtures';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §4 — the team makes and turns off share links from a project's desk through
 * the registered `brand_rooms.share.create` / `brand_rooms.share.revoke` (`/admin/do`): admins only (re-read
 * on the profile row), a closed brand refused as missing, the brand dialog's options checked the same way,
 * the link stored as the team, its token handed back once and never in a redirect.
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

const ctx = (isAdmin = true, userId = isAdmin ? f.ids.admin : f.ids.owner): AdminContext => ({ sql: f.sql, storage: deps.staging as never, viewer: { ...viewerOf(userId), isAdmin } });
const form = (op: string, fields: Record<string, string>) => {
  const data = new FormData();
  data.set('_op', op);
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const create = (fields: Record<string, string>, context = ctx()) =>
  dispatchAdmin('brand_rooms.share.create', form('brand_rooms.share.create', { organizationId: f.orgId, projectId: f.projectId, ...fields }), context);
const shares = async () => (await f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_shares')).rows[0]!.n;

async function sharedBoard(share = true): Promise<string> {
  const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
  const made = await staffCreateStoryboard(deps, admin, { projectId: f.projectId, title: 'Launch film' });
  const id = (made as { board: { id: string } }).board.id;
  await staffReplaceFrames(deps, admin, { storyboardId: id, frames: [{ picture: await pngBytes(30, 40), text: { scene: '1', shot: '1', description: 'Open' } }] });
  if (share) await staffShareStoryboard(deps, admin, { storyboardId: id });
  return id;
}

describe('brand_rooms.share.create', () => {
  it('is registered beside the kill switch', () => {
    expect(ADMIN_OPERATION_NAMES).toContain('brand_rooms.share.create');
    expect(ADMIN_OPERATION_NAMES).toContain('brand_rooms.share.revoke');
  });

  it('makes a link to a draft as the team, with the options asked for, and hands the token back once', async () => {
    const reviewId = await roomDraft(f, deps);
    const outcome = await create({ target: `review:${reviewId}`, allowComments: 'on', allowDownload: 'on', expiresInDays: '7', passphrase: 'open-sesame' });
    expect(outcome).toMatchObject({ ok: true, code: 'created', shareToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(outcome).not.toHaveProperty('to');
    const token = (outcome as { shareToken: string }).shareToken;
    // Never in the address the browser is sent to; a post without script returns to the same tab.
    const back = `/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=links`;
    expect(outcomeUrl(back, outcome)).toBe(`${back}&ok=created`);
    expect(outcomeUrl(back, outcome)).not.toContain(token);
    const row = (
      await f.sql.query<{ created_role: string; created_by: string; allow_comments: boolean; allow_download: boolean; has_passphrase: boolean; project_id: string; days: number }>(
        `select created_role, created_by, allow_comments, allow_download, passphrase_hash is not null as has_passphrase, project_id,
                round(extract(epoch from (expires_at - created_at)) / 86400)::int as days from brand_room_shares`,
      )
    ).rows[0];
    expect(row).toEqual({ created_role: 'studio', created_by: f.ids.admin, allow_comments: true, allow_download: true, has_passphrase: true, project_id: f.projectId, days: 7 });
    expect(await loadSharePage({ sql: f.sql, media: deps.media }, token, { get: () => undefined })).toEqual({ state: 'locked', kind: 'review' });
    const listed = await staffProjectShares({ sql: f.sql, media: deps.media }, { ...viewerOf(f.ids.admin), isAdmin: true }, { organizationId: f.orgId, projectId: f.projectId });
    expect(listed).toMatchObject({ ok: true, shares: [{ kind: 'review', targetId: reviewId, targetTitle: 'Spring film', targetVersion: 1, createdRole: 'studio', hasPassphrase: true, state: 'live' }] });
  });

  it('defaults to the brand dialog defaults: notes off unless asked, no download, 14 days, no passphrase', async () => {
    const reviewId = await roomDraft(f, deps);
    expect(await create({ target: `review:${reviewId}` })).toMatchObject({ ok: true });
    const row = (await f.sql.query<{ allow_comments: boolean; allow_download: boolean; passphrase_hash: string | null; days: number }>(
      'select allow_comments, allow_download, passphrase_hash, round(extract(epoch from (expires_at - created_at)) / 86400)::int as days from brand_room_shares',
    )).rows[0];
    expect(row).toEqual({ allow_comments: false, allow_download: false, passphrase_hash: null, days: 14 });
  });

  it('shares a storyboard once the brand can see it, never a draft board', async () => {
    const draft = await sharedBoard(false);
    expect(await create({ target: `storyboard:${draft}` })).toMatchObject({ ok: false, code: 'notFound' });
    const shared = await sharedBoard();
    const outcome = await create({ target: `storyboard:${shared}` });
    expect(outcome).toMatchObject({ ok: true });
    expect(await resolveShare(f.sql, (outcome as { shareToken: string }).shareToken)).toMatchObject({ kind: 'storyboard', created_role: 'studio' });
  });

  it('checks the options the way the brand dialog does', async () => {
    const reviewId = await roomDraft(f, deps);
    expect(await create({ target: `video:${reviewId}` })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await create({})).toMatchObject({ ok: false, code: 'invalid' });
    expect(await create({ target: `review:${reviewId}`, expiresInDays: '0' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await create({ target: `review:${reviewId}`, expiresInDays: '91' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await create({ target: `review:${reviewId}`, expiresInDays: 'soon' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await create({ target: `review:${reviewId}`, passphrase: 'abc' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await create({ target: 'review:not-a-uuid' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await shares()).toBe(0);
  });

  it('refuses another project item, an unknown item, a hidden project and a closed brand as missing', async () => {
    const reviewId = await roomDraft(f, deps);
    const other = await seedProject(f);
    expect(await create({ projectId: other, target: `review:${reviewId}` })).toMatchObject({ ok: false, code: 'notFound' });
    expect(await create({ target: `review:${randomUUID()}` })).toMatchObject({ ok: false, code: 'notFound' });
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [f.projectId]);
    expect(await create({ target: `review:${reviewId}` })).toMatchObject({ ok: false, code: 'notFound' });
    await f.sql.query('update brand_projects set client_visible = true where id = $1', [f.projectId]);
    await f.sql.query("update brand_organizations set name = 'Morphic Korea' where id = $1", [f.orgId]);
    expect(await create({ target: `review:${reviewId}` })).toMatchObject({ ok: false, code: 'notFound' });
    expect(await shares()).toBe(0);
  });

  it('refuses a non-admin, and an admin flag the profile row does not carry', async () => {
    const reviewId = await roomDraft(f, deps);
    expect(await create({ target: `review:${reviewId}` }, ctx(false))).toEqual({ ok: false, code: 'forbidden' });
    expect(await create({ target: `review:${reviewId}` }, { ...ctx(true, f.ids.owner) })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await shares()).toBe(0);
  });
});

describe('brand_rooms.share.revoke from the desk', () => {
  async function brandLink(): Promise<{ reviewId: string; shareId: string }> {
    const reviewId = await roomDraft(f, deps);
    const created = (await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: 'review', targetId: reviewId })) as ShareCreated;
    return { reviewId, shareId: created.share.id };
  }
  const revoke = (fields: Record<string, string>, context = ctx()) => dispatchAdmin('brand_rooms.share.revoke', form('brand_rooms.share.revoke', fields), context);
  const revokedBy = async () => (await f.sql.query<{ revoked_by: string | null }>('select revoked_by from brand_room_shares')).rows[0]!.revoked_by;

  it("turns off one of the project's links and stays on the desk's 공유 링크 tab (the version kept too)", async () => {
    const { reviewId, shareId } = await brandLink();
    const outcome = await revoke({ shareId, organizationId: f.orgId, projectId: f.projectId });
    expect(outcome).toEqual({ ok: true, code: 'saved' });
    expect(await revokedBy()).toBe(f.ids.admin);
    // The redirect keeps the tab (a `to` would drop the query and land on 시안).
    const back = `/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=links&review=${reviewId}`;
    expect(outcomeUrl(back, outcome)).toBe(`${back}&ok=saved`);
    // The listing shows it turned off.
    const listed = await staffProjectShares({ sql: f.sql, media: deps.media }, { ...viewerOf(f.ids.admin), isAdmin: true }, { organizationId: f.orgId, projectId: f.projectId });
    expect(listed).toMatchObject({ ok: true, shares: [{ id: shareId, state: 'revoked' }] });
  });

  it('refuses a link of another project and a closed brand, and a non-admin', async () => {
    const { shareId } = await brandLink();
    const other = await seedProject(f);
    expect(await revoke({ shareId, organizationId: f.orgId, projectId: other })).toMatchObject({ ok: false, code: 'notFound' });
    expect(await revoke({ shareId, organizationId: f.orgId, projectId: f.projectId }, ctx(false))).toEqual({ ok: false, code: 'forbidden' });
    await f.sql.query("update brand_organizations set name = 'Morphic Korea' where id = $1", [f.orgId]);
    expect(await revoke({ shareId, organizationId: f.orgId, projectId: f.projectId })).toMatchObject({ ok: false, code: 'notFound' });
    expect(await revokedBy()).toBeNull();
    // The unscoped kill switch still turns off any link (a closed brand's links already show nothing).
    expect(await revoke({ shareId })).toMatchObject({ ok: true });
    expect(await revokedBy()).toBe(f.ids.admin);
  });

  it('keeps the desk list to its project and an open brand', async () => {
    await brandLink();
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    const other = await seedProject(f);
    expect(await staffProjectShares({ sql: f.sql, media: deps.media }, admin, { organizationId: f.orgId, projectId: other })).toEqual({ ok: true, shares: [] });
    expect(await staffProjectShares({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'forbidden' });
    await f.sql.query("update brand_organizations set name = 'Morphic Korea' where id = $1", [f.orgId]);
    expect(await staffProjectShares({ sql: f.sql, media: deps.media }, admin, { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'not_found' });
  });
});
