import { afterEach, describe, expect, it } from 'vitest';
import { expectReject } from '@/tests/helpers/pglite';
import { seedImageAsset, seedVideoAsset, studioDeps, studioFixture, type StudioFixture } from '@/tests/brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §8 — what 0084 adds under the service: a version stack keeps one row per version,
 * a range ends after it starts, a drawing is bounded, a guest has a name and no account, a carried note
 * heads its own thread once per review, a share stores a hash and expires within 90 days, and a
 * delivered file is a studio asset of its own kind.
 */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

async function setup() {
  f = await studioFixture();
  const deps = studioDeps(f.sql);
  const assetId = await seedVideoAsset(deps, f.orgId, f.ids.owner);
  const review = (
    await f.sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, asset_id, title, created_by, created_role, project_id) values ($1, $2, 'Film', $3, 'studio', $4) returning id`,
      [f.orgId, assetId, f.ids.owner, f.projectId],
    )
  ).rows[0]!.id;
  return { deps, review };
}

function comment(review: string, column: string | null, value: unknown, author: string | null = f!.ids.owner) {
  return f!.sql.query(
    `insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body${column ? `, ${column}` : ''})
       values ($1, $2, $3, 'brand', 'note'${column ? ', $4' : ''})`,
    column ? [review, f!.orgId, author, value] : [review, f!.orgId, author],
  );
}

describe('brand room review schema (0084)', () => {
  it('defaults an existing review to v1 of its own stack from the studio', async () => {
    const { review } = await setup();
    const row = (await f!.sql.query('select stack_id, version, source, project_id from brand_studio_reviews where id = $1', [review])).rows[0];
    expect(row).toMatchObject({ stack_id: null, version: 1, source: 'studio', project_id: f!.projectId });
  });

  it('keeps one live row per version of a stack and names the stack from v2 on', async () => {
    const { deps, review } = await setup();
    const second = await seedImageAsset(deps, f!.orgId, f!.ids.owner);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_reviews (organization_id, asset_id, title, created_role, version) values ($1, $2, 'v2', 'studio', 2)`, [f!.orgId, second]),
      ),
    ).toMatch(/brand_studio_reviews_stack_version/);
    await f!.sql.query(`insert into brand_studio_reviews (organization_id, asset_id, title, created_role, stack_id, version) values ($1, $2, 'v2', 'studio', $3, 2)`, [f!.orgId, second, review]);
    const third = await seedImageAsset(deps, f!.orgId, f!.ids.owner, { width: 70 });
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_reviews (organization_id, asset_id, title, created_role, stack_id, version) values ($1, $2, 'v2 again', 'studio', $3, 2)`, [f!.orgId, third, review]),
      ),
    ).toMatch(/brand_studio_reviews_stack_version_key/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_reviews (organization_id, asset_id, title, created_role, source) values ($1, $2, 'x', 'studio', 'cli')`, [f!.orgId, third]),
      ),
    ).toMatch(/brand_studio_reviews_source/);
  });

  it('bounds ranges, drawings and guest names', async () => {
    const { review } = await setup();
    expect(await expectReject(() => comment(review, 'end_ms', 500))).toMatch(/brand_studio_review_comments_range/);
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body, at_ms, end_ms) values ($1, $2, $3, 'brand', 'x', 900, 900)`, [review, f!.orgId, f!.ids.owner]),
      ),
    ).toMatch(/brand_studio_review_comments_range/);
    await f!.sql.query(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body, at_ms, end_ms) values ($1, $2, $3, 'brand', 'x', 900, 2400)`, [review, f!.orgId, f!.ids.owner]);
    expect(await expectReject(() => comment(review, 'strokes', JSON.stringify([])))).toMatch(/brand_studio_review_comments_strokes/);
    expect(await expectReject(() => comment(review, 'strokes', JSON.stringify({ a: 1 })))).toMatch(/brand_studio_review_comments_strokes/);
    const many = Array.from({ length: 25 }, () => ({ tool: 'pen', color: 'blue', points: [[0, 0], [1, 1]] }));
    expect(await expectReject(() => comment(review, 'strokes', JSON.stringify(many)))).toMatch(/brand_studio_review_comments_strokes/);
    expect(await expectReject(() => comment(review, 'guest_name', 'Jin'))).toMatch(/brand_studio_review_comments_guest/);
    await comment(review, 'guest_name', 'Jin', null);
  });

  it('carries a note once per review, as the head of its own thread', async () => {
    const { review } = await setup();
    const origin = (
      await f!.sql.query<{ id: string }>(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body) values ($1, $2, $3, 'brand', 'x') returning id`, [review, f!.orgId, f!.ids.owner])
    ).rows[0]!.id;
    await comment(review, 'carried_from', origin);
    expect(await expectReject(() => comment(review, 'carried_from', origin))).toMatch(/brand_studio_review_comments_carried_key/);
  });

  it('stores a share as a hash that expires within 90 days', async () => {
    await setup();
    const insert = (hash: string, days: number) =>
      f!.sql.query(
        `insert into brand_room_shares (token_hash, organization_id, kind, target_id, expires_at, created_role) values ($1, $2, 'review', gen_random_uuid(), now() + make_interval(days => $3), 'brand')`,
        [hash, f!.orgId, days],
      );
    expect(await expectReject(() => insert('plain-token', 14))).toMatch(/brand_room_shares_token/);
    expect(await expectReject(() => insert('a'.repeat(64), 91))).toMatch(/brand_room_shares_expiry/);
    await insert('a'.repeat(64), 90);
    expect(await expectReject(() => insert('a'.repeat(64), 14))).toMatch(/brand_room_shares_token_key/);
  });

  it('lets a delivered file be a studio asset', async () => {
    await setup();
    await f!.sql.query(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, source, status) values ($1, 'video', 'Cut', 'video/mp4', 10, 'st/x.mp4', 'delivery', 'ready')`,
      [f!.orgId],
    );
    expect(
      await expectReject(() =>
        f!.sql.query(`insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, source, status) values ($1, 'video', 'Cut', 'video/mp4', 10, 'st/y.mp4', 'cli', 'ready')`, [f!.orgId]),
      ),
    ).toMatch(/brand_studio_assets_source/);
  });
});
