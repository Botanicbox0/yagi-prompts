import { afterEach, describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';
import { expectReject } from '@/tests/helpers/pglite';
import { seedImageAsset, studioDeps, studioFixture, type StudioFixture } from '../server/helpers';

/** docs/BRAND-STUDIO-V3.md §4 — the library tables hold their own rules, whatever the service does. */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

describe('0081 brand studio library schema', () => {
  it('keeps live folder names unique per organization, ignoring case, and frees a name on delete', async () => {
    f = await studioFixture();
    const insert = (name: string) =>
      f!.sql.query<{ id: string }>('insert into brand_studio_folders (organization_id, name, created_by) values ($1, $2, $3) returning id', [f!.orgId, name, f!.ids.owner]);
    const first = (await insert('Logos')).rows[0]!.id;
    expect(await expectReject(() => insert('logos'))).toMatch(/duplicate|unique/i);
    await f.sql.query('update brand_studio_folders set deleted_at = now() where id = $1', [first]);
    await expect(insert('LOGOS')).resolves.toBeTruthy();
    expect(await expectReject(() => insert(' padded'))).toMatch(/check|brand_studio_folders_name/i);
    expect(await expectReject(() => insert('x'.repeat(61)))).toMatch(/check|brand_studio_folders_name/i);
  });

  it('files a thing once per folder, needs exactly one source and cannot cross organizations', async () => {
    f = await studioFixture();
    const deps = studioDeps(f.sql);
    const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const folder = (await f.sql.query<{ id: string }>("insert into brand_studio_folders (organization_id, name) values ($1, 'A') returning id", [f.orgId])).rows[0]!.id;
    const file = () => f!.sql.query('insert into brand_studio_folder_items (folder_id, organization_id, asset_id) values ($1, $2, $3)', [folder, f!.orgId, asset]);
    await file();
    expect(await expectReject(file)).toMatch(/duplicate|unique/i);
    expect(await expectReject(() => f!.sql.query('insert into brand_studio_folder_items (folder_id, organization_id) values ($1, $2)', [folder, f!.orgId]))).toMatch(/one_ref|check/i);
    const other = (await f.sql.query<{ id: string }>("insert into brand_organizations (name, created_by, request_id) values ('Other', $1, gen_random_uuid()) returning id", [f.ids.owner])).rows[0]!.id;
    const second = await seedImageAsset(deps, f.orgId, f.ids.owner);
    expect(
      await expectReject(() => f!.sql.query('insert into brand_studio_folder_items (folder_id, organization_id, asset_id) values ($1, $2, $3)', [folder, other, second])),
    ).toMatch(/foreign key|folder_fk/i);
  });

  it('likes once per member per thing, and a deleted folder row takes its items with it', async () => {
    f = await studioFixture();
    const deps = studioDeps(f.sql);
    const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const like = (user: string) => f!.sql.query('insert into brand_studio_likes (organization_id, user_id, asset_id) values ($1, $2, $3)', [f!.orgId, user, asset]);
    await like(f.ids.owner);
    await like(f.ids.viewer);
    expect(await expectReject(() => like(f!.ids.owner))).toMatch(/duplicate|unique/i);
    const folder = (await f.sql.query<{ id: string }>("insert into brand_studio_folders (organization_id, name) values ($1, 'B') returning id", [f.orgId])).rows[0]!.id;
    await f.sql.query('insert into brand_studio_folder_items (folder_id, organization_id, asset_id) values ($1, $2, $3)', [folder, f.orgId, asset]);
    await f.sql.query('delete from brand_studio_folders where id = $1', [folder]);
    expect((await f.sql.query('select 1 from brand_studio_folder_items')).rows).toHaveLength(0);
  });

  it('closes all three tables to browser keys (0154)', async () => {
    f = await studioFixture();
    await f.db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await f.db.exec(readMigration('0154_glue_brand_studio_library.sql'));
    for (const table of ['brand_studio_folders', 'brand_studio_folder_items', 'brand_studio_likes']) {
      const row = (await f.sql.query<{ rls: boolean; forced: boolean }>('select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = $1', [table])).rows[0]!;
      expect(row, table).toEqual({ rls: true, forced: true });
      for (const role of ['anon', 'authenticated']) {
        const allowed = (await f.sql.query<{ allowed: boolean }>("select has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') as allowed", [role, table])).rows[0]!.allowed;
        expect(allowed, `${role} on ${table}`).toBe(false);
      }
      expect((await f.sql.query<{ allowed: boolean }>("select has_table_privilege('service_role', $1, 'SELECT,INSERT,UPDATE,DELETE') as allowed", [table])).rows[0]!.allowed).toBe(true);
    }
  });
});
