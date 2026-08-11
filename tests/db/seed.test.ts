import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import { loadPublishedRevisionBySlug } from '@/lib/content/load';
import { shapeRevision } from '@/lib/content/shape';
import { BLOCK_KINDS } from '@/lib/content/schemas';
import { VISIBILITY_ORDER, type Tier } from '@/lib/content/visibility';
import { seed, type SeedResult } from '@/scripts/seed';
import { freshDb, runner } from '../helpers/pglite';

describe('seed publishes fixtures through the real prepare → copy → publish flow (§8 M0)', () => {
  let db: PGlite;
  let storage: StorageDriver;
  let storageRoot: string;
  let result: SeedResult;

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-storage-'));
    storage = createLocalStorageDriver(storageRoot);
    result = await seed({ sql: runner(db), storage, createAuthUsers: true });
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('publishes both fixture playbooks and swaps the pointer', async () => {
    expect(result.playbooks.map((p) => p.slug)).toEqual([
      'character-sheet-generation',
      'talking-character-clip',
    ]);

    const { rows } = await db.query<{
      slug: string;
      status: string;
      published_revision_id: string | null;
      state: string;
      published_at: Date | null;
    }>(
      `select p.slug, p.status, p.published_revision_id, r.state, r.published_at
         from playbooks p join playbook_revisions r on r.id = p.published_revision_id
        order by p.slug`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('published');
      expect(row.state).toBe('published');
      expect(row.published_revision_id).not.toBeNull();
      expect(row.published_at).not.toBeNull();
    }
  });

  it('covers every block kind × visibility level', async () => {
    const { rows } = await db.query<{ kind: string; resolved_visibility: string }>(
      `select distinct b.kind, b.resolved_visibility::text as resolved_visibility from blocks b`,
    );
    const seen = new Set(rows.map((r) => `${r.kind}:${r.resolved_visibility}`));
    for (const kind of BLOCK_KINDS) {
      for (const visibility of VISIBILITY_ORDER) {
        expect(seen.has(`${kind}:${visibility}`), `${kind} × ${visibility}`).toBe(true);
      }
    }
  });

  it('stamps resolved_visibility on every block (nothing left to infer at read time)', async () => {
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from blocks where resolved_visibility is null',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('routes the manifest per §6: heroes public, workflow files private, showcase-gated public blocks', async () => {
    const { rows } = await db.query<{
      slug: string;
      ref: string;
      kind: string | null;
      resolved: string | null;
      target_bucket: string;
      copied_at: Date | null;
    }>(
      `select p.slug, pa.ref, b.kind, b.resolved_visibility::text as resolved,
              pa.target_bucket, pa.copied_at
         from publish_assets pa
         join playbook_revisions r on r.id = pa.revision_id
         join playbooks p on p.id = r.playbook_id
         left join blocks b on b.id::text = pa.ref
        order by p.slug, pa.ref`,
    );

    // every referenced object was physically copied
    expect(rows.every((r) => r.copied_at !== null)).toBe(true);

    // heroes always land in the public bucket (§3.1 public metadata rule)
    const heroes = rows.filter((r) => r.ref === 'hero');
    expect(heroes).toHaveLength(2);
    expect(heroes.every((r) => r.target_bucket === 'public-content')).toBe(true);

    // workflow files are always private artifacts, whatever their visibility
    const workflows = rows.filter((r) => r.kind === 'workflow_file');
    expect(workflows.length).toBeGreaterThanOrEqual(5);
    expect(workflows.every((r) => r.target_bucket === 'artifacts-published')).toBe(true);

    // `public` asset on the SHOWCASE playbook ⇒ public-content
    const showcasePublic = rows.filter(
      (r) => r.slug === 'character-sheet-generation' && r.kind === 'asset' && r.resolved === 'public',
    );
    expect(showcasePublic).toHaveLength(1);
    expect(showcasePublic[0]?.target_bucket).toBe('public-content');

    // `public` asset on the NON-showcase playbook ⇒ content-published (private)
    const nonShowcasePublic = rows.filter(
      (r) => r.slug === 'talking-character-clip' && r.kind === 'asset' && r.resolved === 'public',
    );
    expect(nonShowcasePublic).toHaveLength(1);
    expect(nonShowcasePublic[0]?.target_bucket).toBe('content-published');
  });

  it('physically copied the bytes to content-addressed keys and left staging untouched', async () => {
    const { rows } = await db.query<{
      sha256: string;
      target_bucket: 'public-content' | 'content-published' | 'artifacts-published';
      target_key: string;
      source_staging_key: string;
    }>('select sha256, target_bucket, target_key, source_staging_key from publish_assets');

    for (const row of rows) {
      expect(row.target_key.startsWith(row.sha256)).toBe(true);
      expect(await storage.exists(row.target_bucket, row.target_key)).toBe(true);
      expect(await storage.exists('content', row.source_staging_key)).toBe(true);
    }
  });

  it('stamps published_key + bucket into every AssetRef', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from blocks
        where content ? 'asset'
          and (not (content -> 'asset' ? 'published_key') or not (content -> 'asset' ? 'bucket'))`,
    );
    expect(rows[0]?.n).toBe(0);

    const { rows: heroes } = await db.query<{ bucket: string; key: string }>(
      `select hero_asset ->> 'bucket' as bucket, hero_asset ->> 'published_key' as key
         from playbook_revisions where state = 'published'`,
    );
    expect(heroes).toHaveLength(2);
    for (const hero of heroes) {
      expect(hero.bucket).toBe('public-content');
      expect(hero.key).toBeTruthy();
    }
  });

  it('produces shaped-readable fixtures for every tier, with no storage keys in the payload', async () => {
    const revision = await loadPublishedRevisionBySlug(runner(db), 'talking-character-clip');
    expect(revision).not.toBeNull();
    expect(revision!.steps).toHaveLength(4);
    // the invariant the pure shaper depends on
    for (const step of revision!.steps) {
      for (const block of step.blocks) {
        expect(block.effective_visibility).toBeTruthy();
      }
    }

    const expectedVisible: Record<Tier, number> = { anon: 6, free: 12, pro: 18, admin: 24 };
    for (const tier of ['anon', 'free', 'pro', 'admin'] as Tier[]) {
      const shaped = shapeRevision(revision!, tier);
      const blocks = shaped.steps.flatMap((s) => s.blocks);
      expect(blocks).toHaveLength(24);
      expect(blocks.filter((b) => !b.locked)).toHaveLength(expectedVisible[tier]);
      expect(shaped.lockedCount).toBe(24 - expectedVisible[tier]);

      const serialized = JSON.stringify(shaped);
      expect(serialized).not.toContain('staging_key');
      expect(serialized).not.toContain('content/rev/');

      // This playbook is NOT a showcase: no BLOCK asset may be served from the public bucket.
      // (The hero legitimately is — heroes are public marketing surface for every playbook, §3.1.)
      const blockAssetSources = blocks
        .filter((b) => !b.locked)
        .map((b) => (b.locked ? null : b.content))
        .filter((c) => c !== null && (c.kind === 'asset' || c.kind === 'workflow_file'))
        .map((c) => (c as { asset: { source: string } }).asset.source);
      expect(blockAssetSources.length).toBeGreaterThan(0);
      expect(blockAssetSources.every((s) => s === 'gateway')).toBe(true);
    }
  });

  it('serves the showcase playbook hero and its public asset from the public bucket', async () => {
    const revision = await loadPublishedRevisionBySlug(runner(db), 'character-sheet-generation');
    const shaped = shapeRevision(revision!, 'anon');
    expect(shaped.hero?.source).toBe('public');

    const publicAssets = shaped.steps
      .flatMap((s) => s.blocks)
      .filter((b) => !b.locked && b.content.kind === 'asset');
    expect(publicAssets).toHaveLength(1);
    const block = publicAssets[0];
    expect(block && !block.locked && block.content.kind === 'asset' && block.content.asset.source).toBe(
      'public',
    );
    expect(JSON.stringify(shaped)).not.toContain('staging_key');
  });

  it('creates the four entitlement fixtures (anon = absence of a user)', async () => {
    const { rows } = await db.query<{ email: string; plan: string; is_admin: boolean; status: string | null }>(
      `select pr.email, pr.plan, pr.is_admin, s.status
         from profiles pr left join subscriptions s on s.user_id = pr.id
        order by pr.email`,
    );
    expect(rows).toEqual([
      { email: 'admin@yagiworkshop.xyz', plan: 'free', is_admin: true, status: null },
      { email: 'free@playbook.test', plan: 'free', is_admin: false, status: null },
      { email: 'pro@playbook.test', plan: 'pro', is_admin: false, status: 'active' },
    ]);
    expect(Object.keys(result.users).sort()).toEqual(['admin', 'free', 'pro']);
  });
});
