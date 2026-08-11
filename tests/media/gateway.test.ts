import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import type { Viewer } from '@/lib/auth/viewer';
import { authorizeMedia } from '@/lib/media/authorize';
import { heroRef, mediaGatewayPath, parseMediaRef } from '@/lib/content/media-ref';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Tier } from '@/lib/content/visibility';
import { seed, seedEdgeFixtures, type EdgeSeedResult } from '@/scripts/seed';
import { freshDb, runner } from '../helpers/pglite';

/**
 * PLAN §3.3 / §8 M2 — media-gateway authorization: "block → step → revision must equal the
 * playbook's CURRENT published_revision_id (drafts/superseded refuse) → playbook eligibility →
 * effective visibility ≤ tier".
 *
 * Driven against fixtures published through the real RPCs, so "superseded" here is a revision that
 * really was published and really was superseded, with real copied bytes behind its block ids —
 * which is the only version of this test worth having.
 */

const viewerFor = (tier: Tier): Viewer => ({
  tier,
  userId: tier === 'anon' ? null : `user-${tier}`,
  email: null,
  isAdmin: tier === 'admin',
  locale: null,
});

interface BlockRow {
  id: string;
  kind: string;
  visibility: string | null;
  slug: string;
  revision_id: string;
  step_order: number;
  block_order: number;
}

describe('media gateway authorization chain (§3.3)', () => {
  let db: PGlite;
  let sql: SqlRunner;
  let storage: StorageDriver;
  let storageRoot: string;
  let blocks: BlockRow[];
  let edges: EdgeSeedResult[];

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-gateway-'));
    storage = createLocalStorageDriver(storageRoot);
    sql = runner(db);
    await seed({ sql, storage, createAuthUsers: true });
    edges = await seedEdgeFixtures({ sql, storage });

    const { rows } = await sql.query<BlockRow>(
      `select b.id, b.kind, b.resolved_visibility::text as visibility, p.slug,
              r.id as revision_id, s."order" as step_order, b."order" as block_order
         from blocks b
         join steps s on s.id = b.step_id
         join playbook_revisions r on r.id = s.revision_id
         join playbooks p on p.id = r.playbook_id`,
    );
    blocks = rows;
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const find = (slug: string, kind: string, visibility?: string, revisionId?: string) => {
    const row = blocks.find(
      (b) =>
        b.slug === slug &&
        b.kind === kind &&
        (visibility === undefined || b.visibility === visibility) &&
        (revisionId === undefined || b.revision_id === revisionId),
    );
    expect(row, `${slug} / ${kind} / ${visibility ?? 'any'}`).toBeDefined();
    return row!;
  };

  const ask = (tier: Tier, ref: string) => authorizeMedia(sql, viewerFor(tier), ref);

  // --- link 1: the revision must be the CURRENT published one ---------------

  it('refuses a block on a DRAFT revision, for every tier', async () => {
    const draft = find('insta-toon-pipeline', 'asset');
    for (const tier of ['anon', 'free', 'pro', 'admin'] as Tier[]) {
      const result = await ask(tier, draft.id);
      expect(result.status, tier).toBe('not_found');
    }
  });

  it('refuses a block on a SUPERSEDED revision even though its bytes were published', async () => {
    const lora = edges.find((e) => e.slug === 'character-lora-training')!;
    const supersededRevision = lora.revisionIds[0]!;
    const currentRevision = lora.revisionIds[1]!;
    expect(supersededRevision).not.toBe(currentRevision);

    const stale = find('character-lora-training', 'asset', undefined, supersededRevision);
    const current = find('character-lora-training', 'asset', undefined, currentRevision);

    for (const tier of ['anon', 'free', 'pro', 'admin'] as Tier[]) {
      expect((await ask(tier, stale.id)).status, tier).toBe('not_found');
    }
    // …and the identical block on the CURRENT revision is served to an entitled viewer.
    expect((await ask('free', current.id)).status).toBe('ok');
  });

  it('refuses every block of an ARCHIVED playbook below admin', async () => {
    const archived = find('voice-identity-setup', 'asset');
    expect((await ask('anon', archived.id)).status).toBe('not_found');
    expect((await ask('free', archived.id)).status).toBe('not_found');
    expect((await ask('pro', archived.id)).status).toBe('not_found');
    // §7 gates the read path "for non-admins"; the page behaves the same way (facade.test.ts).
    expect((await ask('admin', archived.id)).status).toBe('ok');
  });

  it('refuses an unknown id and anything that is not a ref', async () => {
    expect((await ask('pro', '11111111-2222-4333-8444-555555555555')).status).toBe('not_found');
    for (const bad of ['not-a-uuid', '../secrets', '', 'a/b', 'DROP TABLE blocks']) {
      expect((await ask('admin', bad)).status, bad).toBe('not_found');
    }
  });

  // --- link 2/3: playbook eligibility ---------------------------------------

  it('answers 401 for an anonymous reader on a NON-showcase playbook', async () => {
    const publicAsset = find('talking-character-clip', 'asset', 'public');
    // `public` visibility, but the playbook itself is not showcase: the sign-in wall comes first,
    // and it comes back as 401 rather than 404 because the card that linked here is public (§3.1).
    expect((await ask('anon', publicAsset.id)).status).toBe('unauthorized');
    expect((await ask('free', publicAsset.id)).status).toBe('ok');
  });

  // --- link 4: visibility ≤ tier --------------------------------------------

  it('walks the visibility ladder on a playbook the viewer is eligible for', async () => {
    // The matrix playbook carries an asset at every visibility level; anon is not eligible for it
    // at all (previous test), so the anon row of the ladder is asserted on the showcase fixture.
    const table: Array<[string, Tier, string]> = [
      ['free', 'free', 'ok'],
      ['pro', 'free', 'forbidden'],
      ['hidden', 'free', 'forbidden'],
      ['public', 'pro', 'ok'],
      ['pro', 'pro', 'ok'],
      ['hidden', 'pro', 'forbidden'],
      ['hidden', 'admin', 'ok'],
    ];
    for (const [visibility, tier, expected] of table) {
      const row = find('talking-character-clip', 'asset', visibility);
      expect((await ask(tier, row.id)).status, `${visibility} × ${tier}`).toBe(expected);
    }
  });

  it('gives an anonymous reader on a showcase playbook exactly the public objects', async () => {
    const table: Array<[string, string, string]> = [
      ['asset', 'public', 'ok'],
      ['asset', 'free', 'unauthorized'],
      ['workflow_file', 'pro', 'unauthorized'],
    ];
    for (const [kind, visibility, expected] of table) {
      const row = find('character-sheet-generation', kind, visibility);
      expect((await ask('anon', row.id)).status, `${kind}/${visibility}`).toBe(expected);
    }
  });

  it('distinguishes 401 (sign in) from 403 (upgrade) — the funnel depends on it', async () => {
    const proBlock = find('character-sheet-generation', 'workflow_file', 'pro');
    expect((await ask('anon', proBlock.id)).status).toBe('unauthorized');
    expect((await ask('free', proBlock.id)).status).toBe('forbidden');
    expect((await ask('pro', proBlock.id)).status).toBe('ok');
  });

  // --- the object it hands back ---------------------------------------------

  it('routes an authorized object to the bucket the manifest chose', async () => {
    const showcasePublic = find('character-sheet-generation', 'asset', 'public');
    const showcaseFree = find('character-sheet-generation', 'asset', 'free');
    const workflow = find('character-sheet-generation', 'workflow_file', 'pro');

    const asAnon = await ask('anon', showcasePublic.id);
    expect(asAnon.status).toBe('ok');
    if (asAnon.status === 'ok') {
      expect(asAnon.object.bucket).toBe('public-content');
      expect(asAnon.object.key).toMatch(/^[a-f0-9]{64}\.png$/);
      expect(asAnon.object.filename).toBeNull();
    }

    const asFree = await ask('free', showcaseFree.id);
    expect(asFree.status).toBe('ok');
    if (asFree.status === 'ok') expect(asFree.object.bucket).toBe('content-published');

    const asPro = await ask('pro', workflow.id);
    expect(asPro.status).toBe('ok');
    if (asPro.status === 'ok') {
      // §3.3: the workflow_file path forces a download, which needs the name.
      expect(asPro.object.bucket).toBe('artifacts-published');
      expect(asPro.object.filename).toBe('character-sheet.json');
      expect(asPro.object.kind).toBe('workflow_file');
    }
  });

  it('never hands back a staging key', async () => {
    const block = find('character-sheet-generation', 'asset', 'free');
    const result = await ask('pro', block.id);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(JSON.stringify(result.object)).not.toContain('content/rev/');
    expect(result.object.key.startsWith('content/')).toBe(false);
  });

  // --- heroes ----------------------------------------------------------------

  it('serves a hero through the same chain, treating it as public marketing surface (§3.1)', async () => {
    const { rows } = await sql.query<{ id: string; slug: string }>(
      `select r.id, p.slug from playbooks p join playbook_revisions r on r.id = p.published_revision_id`,
    );
    const showcase = rows.find((r) => r.slug === 'character-sheet-generation')!;
    const gated = rows.find((r) => r.slug === 'talking-character-clip')!;

    const anonOnShowcase = await ask('anon', heroRef(showcase.id));
    expect(anonOnShowcase.status).toBe('ok');
    if (anonOnShowcase.status === 'ok') {
      expect(anonOnShowcase.object.kind).toBe('hero');
      expect(anonOnShowcase.object.bucket).toBe('public-content');
    }

    // Playbook eligibility still applies: a hero is public, its playbook may not be.
    expect((await ask('anon', heroRef(gated.id))).status).toBe('unauthorized');
    expect((await ask('free', heroRef(gated.id))).status).toBe('ok');
  });

  it('refuses the hero of a superseded revision', async () => {
    const lora = edges.find((e) => e.slug === 'character-lora-training')!;
    expect((await ask('pro', heroRef(lora.revisionIds[0]!))).status).toBe('not_found');
    expect((await ask('pro', heroRef(lora.revisionIds[1]!))).status).toBe('ok');
  });
});

describe('media refs (§3.3 grammar)', () => {
  it('parses both forms and rejects everything else', () => {
    expect(parseMediaRef('abc')).toEqual({ kind: 'block', blockId: 'abc' });
    expect(parseMediaRef('rev-1:hero')).toEqual({ kind: 'hero', revisionId: 'rev-1' });
    for (const bad of ['', '   ', ':hero', 'a/b', 'a:b']) {
      expect(parseMediaRef(bad), bad).toBeNull();
    }
  });

  it('encodes the hero colon so the path survives a round trip', () => {
    const path = mediaGatewayPath(heroRef('11111111-1111-4111-8111-111111111111'));
    expect(path).toBe('/api/media/11111111-1111-4111-8111-111111111111%3Ahero');
    expect(parseMediaRef(decodeURIComponent(path.split('/').pop()!))).toEqual({
      kind: 'hero',
      revisionId: '11111111-1111-4111-8111-111111111111',
    });
  });
});
