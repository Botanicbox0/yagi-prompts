import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { loadStoryboardList } from '@/lib/brand-rooms/storyboards';
import type { StoryboardList } from '@/lib/brand-rooms/storyboard-contracts';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { memoryStaging, pngBytes, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §5, §9-2 — the team's storyboard writes go through the admin registry
 * (`/admin/do`) only: registered, refused for a non-admin, stored as the YAGI team, pictures taken from
 * a minted staging key or the posted form, and back to the board's admin page.
 */
const media = vi.hoisted(() => ({ store: null as ReturnType<typeof createMemoryMediaStore> | null }));
vi.mock('@/lib/brand-studio/media-store', async (original) => ({
  ...(await original<typeof import('@/lib/brand-studio/media-store')>()),
  createStudioMediaStore: () => media.store,
}));

let f: StudioFixture;
let staging: ReturnType<typeof memoryStaging>;
beforeEach(async () => {
  f = await studioFixture();
  media.store = createMemoryMediaStore();
  staging = memoryStaging();
});
afterEach(async () => {
  await f.db.close();
});

const ctx = (userId: string, isAdmin: boolean): AdminContext => ({ sql: f.sql, storage: staging as never, viewer: { ...viewerOf(userId), isAdmin } });
const form = (op: string, fields: Record<string, string | Blob>) => {
  const data = new FormData();
  data.set('_op', op);
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const admin = () => ctx(f.ids.admin, true);

async function create(): Promise<string> {
  const made = await dispatchAdmin('brand_rooms.storyboard.create', form('brand_rooms.storyboard.create', { projectId: f.projectId, title: 'Launch film' }), admin());
  expect(made).toMatchObject({ ok: true, code: 'created' });
  return (made as { to: string }).to.split('/').pop()!;
}

describe('brand_rooms.storyboard.* admin operations', () => {
  it('are registered', () => {
    for (const verb of ['create', 'update', 'frames', 'share', 'version', 'delete']) expect(ADMIN_OPERATION_NAMES).toContain(`brand_rooms.storyboard.${verb}`);
  });

  it('refuse a non-admin session, and a session that claims admin without the profile flag', async () => {
    expect(await dispatchAdmin('brand_rooms.storyboard.create', form('brand_rooms.storyboard.create', { projectId: f.projectId, title: 'x' }), ctx(f.ids.owner, false))).toEqual({ ok: false, code: 'forbidden' });
    expect(await dispatchAdmin('brand_rooms.storyboard.create', form('brand_rooms.storyboard.create', { projectId: f.projectId, title: 'x' }), ctx(f.ids.owner, true))).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await f.sql.query('select count(*)::int as n from brand_storyboards')).rows[0]).toEqual({ n: 0 });
  });

  it('save the cuts from a staging key and a posted file, then share, version and delete', async () => {
    const id = await create();
    const back = `/admin/brand-rooms/storyboards/${id}`;
    const staged = await pngBytes(60, 40);
    const key = 'content/prompt/upload/11111111-2222-4333-8444-555555555555.png';
    await staging.putStaging(key, staged, 'image/png');
    const posted = new File([Buffer.from(await pngBytes(40, 60))], '02.png', { type: 'image/png' });
    const saved = await dispatchAdmin(
      'brand_rooms.storyboard.frames',
      form('brand_rooms.storyboard.frames', {
        storyboardId: id,
        title: 'Launch film, cut',
        frames: JSON.stringify([
          { upload: `staging:${key}`, scene: '1', shot: '1', description: 'Open', seconds: 2 },
          { upload: 'file:picture_1', description: 'Close', camera: 'Push in' },
        ]),
        picture_1: posted,
      }),
      admin(),
    );
    expect(saved).toEqual({ ok: true, code: 'saved', to: back });
    expect(outcomeUrl(back, saved)).toBe(`${back}?ok=saved`);
    const rows = (await f.sql.query<{ description: string; width: number; created_by: string }>('select description, width, created_by from brand_storyboard_frames where storyboard_id = $1 order by idx', [id])).rows;
    expect(rows).toEqual([
      { description: 'Open', width: 60, created_by: f.ids.admin },
      { description: 'Close', width: 40, created_by: f.ids.admin },
    ]);
    expect((await f.sql.query('select title, created_role, created_by from brand_storyboards where id = $1', [id])).rows[0]).toEqual({ title: 'Launch film, cut', created_role: 'studio', created_by: f.ids.admin });

    // A key the staging route never minted is refused before anything is read.
    expect(
      await dispatchAdmin('brand_rooms.storyboard.frames', form('brand_rooms.storyboard.frames', { storyboardId: id, frames: JSON.stringify([{ upload: 'staging:content/rev/x/secret.png' }]) }), admin()),
    ).toMatchObject({ ok: false, code: 'invalid' });

    expect(await dispatchAdmin('brand_rooms.storyboard.share', form('brand_rooms.storyboard.share', { storyboardId: id }), admin())).toMatchObject({ ok: true, code: 'published' });
    const brand = (await loadStoryboardList({ sql: f.sql, media: media.store!, staging }, viewerOf(f.ids.owner), f.orgId, f.projectId)) as StoryboardList;
    expect(brand.boards).toMatchObject([{ id, status: 'shared', cuts: 2 }]);
    // Shared: the cuts do not change any more.
    expect(
      await dispatchAdmin('brand_rooms.storyboard.frames', form('brand_rooms.storyboard.frames', { storyboardId: id, frames: '[]' }), admin()),
    ).toMatchObject({ ok: false, code: 'brandConflict' });

    const version = await dispatchAdmin('brand_rooms.storyboard.version', form('brand_rooms.storyboard.version', { storyboardId: id }), admin());
    expect(version).toMatchObject({ ok: true, code: 'created' });
    const v2 = (version as { to: string }).to.split('/').pop()!;
    expect(v2).not.toBe(id);
    expect(await dispatchAdmin('brand_rooms.storyboard.delete', form('brand_rooms.storyboard.delete', { storyboardId: v2 }), admin())).toEqual({ ok: true, code: 'deleted', to: '/admin/brand-rooms/storyboards' });
  });

  it('refuse a sandboxed organization', async () => {
    await f.db.close();
    f = await studioFixture({ orgName: 'Morphic Korea' });
    expect(await dispatchAdmin('brand_rooms.storyboard.create', form('brand_rooms.storyboard.create', { projectId: f.projectId, title: 'x' }), admin())).toMatchObject({ ok: false, code: 'notFound' });
  });
});
