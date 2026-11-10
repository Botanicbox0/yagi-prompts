import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';
import { expectReject } from '@/tests/helpers/pglite';
import { studioFixture, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §8 — the two storyboard tables (0083 + 0157). The service checks every rule
 * first; these constraints are the floor under it: a board belongs to a project of its organization,
 * a version number is used once per lineage, a cut never leaves its board's organization, a ready cut
 * has a picture and a pending one has its reservation, and two cuts may share a place only inside a
 * transaction (the deferred order key).
 */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

async function board(extra: { lineage?: string; version?: number } = {}) {
  return (
    await f!.sql.query<{ id: string; lineage_id: string }>(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, version, title, created_by, created_role)
         values ($1, $2, $3, $4, 'Spring film', $5, 'studio') returning id, lineage_id`,
      [f!.orgId, f!.projectId, extra.lineage ?? randomUUID(), extra.version ?? 1, f!.ids.admin],
    )
  ).rows[0]!;
}

const KEY = `st/${'a'.repeat(64)}.png`;

describe('storyboard schema (0083)', () => {
  it('ties a board to a project of its own organization and a version to its lineage once', async () => {
    f = await studioFixture();
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other', f.ids.owner, randomUUID()]);
    expect(
      await expectReject(() =>
        f!.sql.query(
          `insert into brand_storyboards (organization_id, project_id, lineage_id, title, created_role) values ($1, $2, $3, 'x', 'brand')`,
          [otherOrg, f!.projectId, randomUUID()],
        ),
      ),
    ).toMatch(/brand_storyboards_project_fk|foreign key/);
    const first = await board();
    expect(await expectReject(() => board({ lineage: first.lineage_id, version: 1 }))).toMatch(/brand_storyboards_lineage_version|duplicate/);
    await board({ lineage: first.lineage_id, version: 2 });
    expect(
      await expectReject(() => f!.sql.query(`update brand_storyboards set status = 'shared' where id = $1`, [first.id])),
    ).toMatch(/brand_storyboards_shared/);
    await f.sql.query(`update brand_storyboards set status = 'shared', shared_at = now() where id = $1`, [first.id]);
  });

  it('keeps a cut in its organization, a ready cut with a picture and a pending one with its reservation', async () => {
    f = await studioFixture();
    const { id } = await board();
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx, storage_key) values ($1, $2, 0, $3)`, [id, randomUUID(), KEY]),
      ),
    ).toMatch(/brand_storyboard_frames_board_fk|foreign key/);
    expect(
      await expectReject(() => f!.sql.query(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx) values ($1, $2, 0)`, [id, f!.orgId])),
    ).toMatch(/brand_storyboard_frames_picture/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status) values ($1, $2, 0, 'pending')`, [id, f!.orgId]),
      ),
    ).toMatch(/brand_storyboard_frames_upload/);
    await f.sql.query(
      `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, staging_key, mime, size_bytes) values ($1, $2, 0, 'pending', 'k', 'image/png', 10)`,
      [id, f.orgId],
    );
    expect(
      await expectReject(() =>
        f!.sql.query(
          `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, staging_key, mime, size_bytes) values ($1, $2, 1, 'pending', 'k', 'image/gif', 10)`,
          [id, f!.orgId],
        ),
      ),
    ).toMatch(/brand_storyboard_frames_mime/);
    for (const [column, value] of [
      ['description', 'x'.repeat(2001)],
      ['camera', 'x'.repeat(301)],
      ['audio', 'x'.repeat(301)],
      ['seconds', 600.5],
    ] as const) {
      expect(
        await expectReject(() =>
          f!.sql.query(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx, storage_key, ${column}) values ($1, $2, 5, $3, $4)`, [id, f!.orgId, KEY, value]),
        ),
        column,
      ).toMatch(new RegExp(`brand_storyboard_frames_${column}`));
    }
  });

  it('lets two cuts trade places inside a transaction but not keep the same place', async () => {
    f = await studioFixture();
    const { id } = await board();
    const a = (await f.sql.query<{ id: string }>(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx, storage_key) values ($1, $2, 0, $3) returning id`, [id, f.orgId, KEY])).rows[0]!.id;
    const b = (await f.sql.query<{ id: string }>(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx, storage_key) values ($1, $2, 1, $3) returning id`, [id, f.orgId, KEY])).rows[0]!.id;
    await f.sql.transaction(async (tx) => {
      await tx.query('update brand_storyboard_frames set idx = 1 where id = $1', [a]);
      await tx.query('update brand_storyboard_frames set idx = 0 where id = $1', [b]);
    });
    expect(
      await expectReject(() =>
        f!.sql.transaction(async (tx) => {
          await tx.query('update brand_storyboard_frames set idx = 0 where id = $1', [a]);
        }),
      ),
    ).toMatch(/brand_storyboard_frames_order|duplicate/);
  });

  it('closes both tables to every browser key in the glue file', () => {
    const glue = readMigration('0157_glue_brand_storyboards.sql');
    for (const table of ['brand_storyboards', 'brand_storyboard_frames']) expect(glue).toContain(`'${table}'`);
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});
