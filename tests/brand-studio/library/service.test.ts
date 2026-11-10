import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_LIMITS, type LibraryFolderDone, type LibraryFolderItems, type LibrarySummary } from '@/lib/brand-studio/library-contracts';
import { loadFolderItems, loadLibrary, runLibraryOperation } from '@/lib/brand-studio/library';
import { seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedImageOutput, seedOtherOrganization } from './helpers';

/** docs/BRAND-STUDIO-V3.md §4 — folders the organization shares, likes that are a member's own. */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const run = (user: string, operation: string, input: Record<string, unknown>) => runLibraryOperation(deps, viewerOf(user), operation, { organizationId: f.orgId, ...input });
const summary = async (user: string) => (await loadLibrary(deps, viewerOf(user), f.orgId)) as LibrarySummary;
async function folder(user: string, name: string) {
  const result = await run(user, 'folder.create', { name });
  if (!result.ok) throw new Error(result.code);
  return (result as LibraryFolderDone).folder;
}

describe('folders', () => {
  it('files assets and results, counts live items, shows four covers and leaves out what was deleted', async () => {
    const box = await folder(f.ids.editor, '  봄   캠페인 ');
    expect(box).toMatchObject({ name: '봄 캠페인', count: 0, covers: [] });
    const assets = [];
    for (let i = 0; i < 4; i += 1) assets.push(await seedImageAsset(deps, f.orgId, f.ids.owner));
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner);
    const result = await seedImageOutput(deps, f.orgId, f.ids.owner);
    for (const assetId of assets) expect(await run(f.ids.editor, 'folder.add', { folderId: box.id, ref: { assetId } })).toMatchObject({ ok: true });
    expect(await run(f.ids.owner, 'folder.add', { folderId: box.id, ref: { assetId: film } })).toMatchObject({ ok: true, item: { kind: 'video', seconds: 6 } });
    const added = await run(f.ids.owner, 'folder.add', { folderId: box.id, ref: { outputId: result } });
    expect(added).toMatchObject({ ok: true, folder: { count: 6 }, item: { key: `o:${result}`, ref: { outputId: result }, kind: 'image', name: null } });
    // Filing the same thing again changes nothing.
    expect(await run(f.ids.owner, 'folder.add', { folderId: box.id, ref: { outputId: result } })).toMatchObject({ ok: true, folder: { count: 6 } });

    const listed = (await loadFolderItems(deps, viewerOf(f.ids.viewer), f.orgId, box.id)) as LibraryFolderItems;
    expect(listed.items.map((i) => i.key)).toEqual([`o:${result}`, `a:${film}`, ...[...assets].reverse().map((id) => `a:${id}`)]);
    const [shown] = (await summary(f.ids.guest)).folders;
    expect(shown).toMatchObject({ id: box.id, count: 6 });
    // The video has no still, so the four covers are the result and the three newest pictures.
    expect(shown!.covers).toHaveLength(4);
    expect(shown!.covers[0]).toBe(listed.items[0]!.url);

    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [assets[3]]);
    await f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [result]);
    const after = (await loadFolderItems(deps, viewerOf(f.ids.owner), f.orgId, box.id)) as LibraryFolderItems;
    expect(after.items.map((i) => i.key)).not.toContain(`o:${result}`);
    expect(after.items).toHaveLength(4);
    expect(after.folder.count).toBe(4);
  });

  it('takes things out, renames, refuses a name in use and deletes (twice is still done)', async () => {
    const a = await folder(f.ids.owner, 'Logos');
    const b = await folder(f.ids.owner, 'Products');
    expect(await run(f.ids.owner, 'folder.create', { name: 'logos' })).toEqual({ ok: false, code: 'conflict' });
    expect(await run(f.ids.owner, 'folder.rename', { folderId: b.id, name: 'LOGOS' })).toEqual({ ok: false, code: 'conflict' });
    expect(await run(f.ids.owner, 'folder.rename', { folderId: b.id, name: 'Bottles' })).toMatchObject({ ok: true, folder: { name: 'Bottles' } });
    expect(await run(f.ids.owner, 'folder.rename', { folderId: b.id, name: ' ' })).toEqual({ ok: false, code: 'invalid' });
    expect(await run(f.ids.owner, 'folder.create', { name: 'x'.repeat(LIBRARY_LIMITS.folderNameMax + 1) })).toEqual({ ok: false, code: 'invalid' });
    expect((await summary(f.ids.owner)).folders.map((x) => x.name)).toEqual(['Bottles', 'Logos']);

    const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    await run(f.ids.owner, 'folder.add', { folderId: a.id, ref: { assetId: asset } });
    expect(await run(f.ids.editor, 'folder.remove', { folderId: a.id, ref: { assetId: asset } })).toMatchObject({ ok: true, folder: { count: 0 } });

    expect(await run(f.ids.owner, 'folder.delete', { folderId: a.id })).toEqual({ ok: true });
    expect(await run(f.ids.owner, 'folder.delete', { folderId: a.id })).toEqual({ ok: true });
    expect((await summary(f.ids.owner)).folders.map((x) => x.id)).toEqual([b.id]);
    expect(await loadFolderItems(deps, viewerOf(f.ids.owner), f.orgId, a.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await run(f.ids.owner, 'folder.add', { folderId: a.id, ref: { assetId: asset } })).toEqual({ ok: false, code: 'not_found' });
    // The name of a deleted folder is free again.
    expect(await run(f.ids.owner, 'folder.create', { name: 'Logos' })).toMatchObject({ ok: true });
  });

  it('keeps to 100 folders per organization and 500 things per folder', async () => {
    await f.sql.query("insert into brand_studio_folders (organization_id, name) select $1, 'F' || g from generate_series(1, $2::int) g", [f.orgId, LIBRARY_LIMITS.foldersPerOrganization]);
    expect(await run(f.ids.owner, 'folder.create', { name: 'One more' })).toEqual({ ok: false, code: 'asset_limit' });
    const full = (await summary(f.ids.owner)).folders[0]!;
    await f.sql.query(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, status)
         select $1, 'image', 'bulk', 'image/png', 10, 'st/' || md5(g::text) || md5('x' || g) || '.png', 'ready' from generate_series(1, $2::int) g`,
      [f.orgId, LIBRARY_LIMITS.itemsPerFolder],
    );
    await f.sql.query(
      "insert into brand_studio_folder_items (folder_id, organization_id, asset_id) select $1, $2, id from brand_studio_assets where name = 'bulk'",
      [full.id, f.orgId],
    );
    const extra = await seedImageAsset(deps, f.orgId, f.ids.owner);
    expect(await run(f.ids.owner, 'folder.add', { folderId: full.id, ref: { assetId: extra } })).toEqual({ ok: false, code: 'asset_limit' });
  });

  it('never files or shows another organization’s things', async () => {
    const other = await seedOtherOrganization(deps, f.ids.owner);
    const foreignAsset = await seedImageAsset(deps, other, f.ids.owner);
    const foreignOutput = await seedImageOutput(deps, other, f.ids.owner);
    const box = await folder(f.ids.owner, 'Mine');
    expect(await run(f.ids.owner, 'folder.add', { folderId: box.id, ref: { assetId: foreignAsset } })).toEqual({ ok: false, code: 'reference_missing' });
    expect(await run(f.ids.owner, 'folder.add', { folderId: box.id, ref: { outputId: foreignOutput } })).toEqual({ ok: false, code: 'reference_missing' });
    expect(await run(f.ids.owner, 'like.toggle', { ref: { assetId: foreignAsset }, liked: true })).toEqual({ ok: false, code: 'reference_missing' });
    // A folder of the other organization is not reachable through this one.
    const theirs = (await f.sql.query<{ id: string }>("insert into brand_studio_folders (organization_id, name) values ($1, 'Theirs') returning id", [other])).rows[0]!.id;
    expect(await loadFolderItems(deps, viewerOf(f.ids.owner), f.orgId, theirs)).toEqual({ ok: false, code: 'not_found' });
    expect(await run(f.ids.owner, 'folder.rename', { folderId: theirs, name: 'Taken' })).toEqual({ ok: false, code: 'not_found' });
    expect(await run(f.ids.owner, 'folder.delete', { folderId: theirs })).toEqual({ ok: false, code: 'not_found' });
    // And the outsider sees nothing of this one.
    expect(await loadLibrary(deps, viewerOf(f.ids.outsider), f.orgId)).toEqual({ ok: false, code: 'not_found' });
    expect(await run(f.ids.outsider, 'like.toggle', { ref: { assetId: foreignAsset }, liked: true })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('roles', () => {
  it('lets viewers like but only creators keep folders; a campaign guest only looks', async () => {
    const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const box = await folder(f.ids.owner, 'Shared');
    expect(await run(f.ids.viewer, 'like.toggle', { ref: { assetId: asset }, liked: true })).toMatchObject({ ok: true, liked: true });
    for (const [operation, input] of [
      ['folder.create', { name: 'Nope' }],
      ['folder.rename', { folderId: box.id, name: 'Nope' }],
      ['folder.delete', { folderId: box.id }],
      ['folder.add', { folderId: box.id, ref: { assetId: asset } }],
      ['folder.remove', { folderId: box.id, ref: { assetId: asset } }],
    ] as const) {
      expect(await run(f.ids.viewer, operation, input), operation).toEqual({ ok: false, code: 'forbidden' });
      expect(await run(f.ids.guest, operation, input), operation).toEqual({ ok: false, code: 'forbidden' });
    }
    expect(await run(f.ids.guest, 'like.toggle', { ref: { assetId: asset }, liked: true })).toEqual({ ok: false, code: 'forbidden' });
    expect((await summary(f.ids.guest)).folders.map((x) => x.id)).toEqual([box.id]);
  });

  it('answers malformed input after the gate, unknown operations as invalid', async () => {
    expect(await run(f.ids.owner, 'folder.shred', { folderId: randomUUID() })).toEqual({ ok: false, code: 'invalid' });
    expect(await run(f.ids.owner, 'like.toggle', { ref: { assetId: randomUUID(), outputId: randomUUID() }, liked: true })).toEqual({ ok: false, code: 'invalid' });
    expect(await run(f.ids.owner, 'like.toggle', { ref: { assetId: randomUUID() } })).toEqual({ ok: false, code: 'invalid' });
    expect(await runLibraryOperation(deps, viewerOf(f.ids.owner), 'folder.create', { organizationId: 'nope', name: 'A' })).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('likes', () => {
  it('are personal, newest first, idempotent both ways, and drop what was deleted', async () => {
    const first = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const second = await seedImageOutput(deps, f.orgId, f.ids.owner);
    expect(await run(f.ids.owner, 'like.toggle', { ref: { assetId: first }, liked: true })).toMatchObject({ ok: true, liked: true, item: { key: `a:${first}` } });
    await f.sql.query("update brand_studio_likes set created_at = now() - interval '1 minute'");
    expect(await run(f.ids.owner, 'like.toggle', { ref: { outputId: second }, liked: true })).toMatchObject({ ok: true, item: { key: `o:${second}` } });
    expect(await run(f.ids.owner, 'like.toggle', { ref: { outputId: second }, liked: true })).toMatchObject({ ok: true, liked: true });
    expect((await summary(f.ids.owner)).liked.map((i) => i.key)).toEqual([`o:${second}`, `a:${first}`]);
    expect((await summary(f.ids.editor)).liked).toEqual([]);

    expect(await run(f.ids.owner, 'like.toggle', { ref: { assetId: first }, liked: false })).toEqual({ ok: true, liked: false, item: null });
    expect(await run(f.ids.owner, 'like.toggle', { ref: { assetId: first }, liked: false })).toEqual({ ok: true, liked: false, item: null });
    await f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [second]);
    expect((await summary(f.ids.owner)).liked).toEqual([]);
    // Liking a deleted result is refused; un-liking it still works.
    expect(await run(f.ids.owner, 'like.toggle', { ref: { outputId: second }, liked: true })).toEqual({ ok: false, code: 'reference_missing' });
    expect(await run(f.ids.owner, 'like.toggle', { ref: { outputId: second }, liked: false })).toMatchObject({ ok: true, liked: false });
  });
});
