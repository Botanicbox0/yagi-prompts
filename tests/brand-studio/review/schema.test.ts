import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';
import { expectReject } from '@/tests/helpers/pglite';
import { seedImageAsset, studioDeps, studioFixture, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-STUDIO-V3.md §7 — the two review tables. The service checks every rule first; these
 * constraints are the floor under it: one subject, one live review per piece, a comment never leaves
 * its review or its organization, a spot is both coordinates or neither.
 */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

async function setup() {
  f = await studioFixture();
  const deps = studioDeps(f.sql);
  const assetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
  const review = (
    await f.sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, asset_id, title, created_by, created_role) values ($1, $2, 'Look 1', $3, 'brand') returning id`,
      [f.orgId, assetId, f.ids.owner],
    )
  ).rows[0]!.id;
  return { assetId, review };
}

describe('brand studio review schema (0080)', () => {
  it('needs exactly one subject and allows one live review per piece', async () => {
    const { assetId } = await setup();
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_reviews (organization_id, title, created_role) values ($1, 'x', 'brand')`, [f!.orgId]),
      ),
    ).toMatch(/brand_studio_reviews_subject/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_reviews (organization_id, asset_id, title, created_role) values ($1, $2, 'again', 'brand')`, [f!.orgId, assetId]),
      ),
    ).toMatch(/brand_studio_reviews_asset_key|duplicate/);
    await f!.sql.query('update brand_studio_reviews set deleted_at = now() where asset_id = $1', [assetId]);
    await f!.sql.query(`insert into brand_studio_reviews (organization_id, asset_id, title, created_role) values ($1, $2, 'again', 'studio')`, [f!.orgId, assetId]);
  });

  it('keeps a comment inside its review and organization, and a spot whole', async () => {
    const { review } = await setup();
    const other = randomUUID();
    await f!.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', f!.ids.owner, randomUUID()]);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_role, body) values ($1, $2, 'brand', 'hi')`, [review, other]),
      ),
    ).toMatch(/brand_studio_review_comments_review_fk|foreign key/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_role, body, x) values ($1, $2, 'brand', 'hi', 0.5)`, [review, f!.orgId]),
      ),
    ).toMatch(/brand_studio_review_comments_spot/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_role, body) values ($1, $2, 'brand', '')`, [review, f!.orgId]),
      ),
    ).toMatch(/brand_studio_review_comments_body/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_role, body) values ($1, $2, 'client', 'hi')`, [review, f!.orgId]),
      ),
    ).toMatch(/brand_studio_review_comments_role/);
    const root = (
      await f!.sql.query<{ id: string }>(
        `insert into brand_studio_review_comments (review_id, organization_id, author_role, body, at_ms, x, y) values ($1, $2, 'brand', 'logo too small', 1200, 0.25, 0.75) returning id`,
        [review, f!.orgId],
      )
    ).rows[0]!.id;
    // A reply must stay in its parent's review.
    const { assetId: secondAsset } = { assetId: await seedImageAsset(studioDeps(f!.sql), f!.orgId, f!.ids.owner) };
    const otherReview = (
      await f!.sql.query<{ id: string }>(
        `insert into brand_studio_reviews (organization_id, asset_id, title, created_role) values ($1, $2, 'Look 2', 'brand') returning id`,
        [f!.orgId, secondAsset],
      )
    ).rows[0]!.id;
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, parent_id, author_role, body) values ($1, $2, $3, 'studio', 'on it')`, [otherReview, f!.orgId, root]),
      ),
    ).toMatch(/brand_studio_review_comments_parent_fk|foreign key/);
    const row = (await f!.sql.query<{ x: number; y: number; at_ms: number }>('select x, y, at_ms from brand_studio_review_comments where id = $1', [root])).rows[0]!;
    expect(row).toEqual({ x: 0.25, y: 0.75, at_ms: 1200 });
  });

  it('closes both tables to every browser key in the glue file', () => {
    const glue = readMigration('0155_glue_brand_studio_review.sql');
    for (const table of ['brand_studio_reviews', 'brand_studio_review_comments']) expect(glue).toContain(`'${table}'`);
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});
