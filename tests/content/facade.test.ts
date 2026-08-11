import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import type { Viewer } from '@/lib/auth/viewer';
import { decideEligibility } from '@/lib/content/eligibility';
import { shapePlaybook, type ShapedPlaybookResult } from '@/lib/content/playbook-access';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { TIER_ORDER, type Tier } from '@/lib/content/visibility';
import { resolveViewer, sqlIdentitySource } from '@/lib/auth/identity';
import { devIdentityUserId } from '@/lib/auth/dev-identity';
import { seed, seedEdgeFixtures, type EdgeSeedResult } from '@/scripts/seed';
import { FIXTURE_USERS } from '@/scripts/fixtures';
import { freshDb, runner } from '../helpers/pglite';

/**
 * PLAN §8 M2 acceptance — "façade eligibility matrix (tier × status × showcase)".
 *
 * Driven against a REAL Postgres (PGlite) carrying fixtures published through the REAL
 * prepare → copy → publish RPCs, with the VIEWER injected. There is no Supabase project yet (§11),
 * so a real session cannot be minted; injecting the resolved viewer at the documented seam is the
 * honest way to test tier behaviour, and it is strictly better than a backdoor in the session path
 * — `getShapedPlaybook` still has no parameter that could carry a tier.
 */

const viewerFor = (tier: Tier): Viewer => ({
  tier,
  userId: tier === 'anon' ? null : `user-${tier}`,
  email: tier === 'anon' ? null : `${tier}@playbook.test`,
  isAdmin: tier === 'admin',
  locale: null,
});

type Outcome = ShapedPlaybookResult['status'];

describe('getShapedPlaybook eligibility matrix (§7 / §3.3)', () => {
  let db: PGlite;
  let sql: SqlRunner;
  let storage: StorageDriver;
  let storageRoot: string;

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-facade-'));
    storage = createLocalStorageDriver(storageRoot);
    sql = runner(db);
    await seed({ sql, storage, createAuthUsers: true });
    await seedEdgeFixtures({ sql, storage });
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const open = (tier: Tier, slug: string) => shapePlaybook({ sql, viewer: viewerFor(tier) }, slug);

  /**
   * The matrix. Rows are the states a playbook can actually be in; every one of them exists as a
   * seeded fixture rather than as a hand-built row, so a change to the publish RPCs shows up here.
   */
  const MATRIX: Array<{ what: string; slug: string; expected: Record<Tier, Outcome> }> = [
    {
      what: 'published + showcase',
      slug: 'character-sheet-generation',
      expected: { anon: 'ok', free: 'ok', pro: 'ok', admin: 'ok' },
    },
    {
      what: 'published, NOT showcase',
      slug: 'talking-character-clip',
      expected: { anon: 'requires_signin', free: 'ok', pro: 'ok', admin: 'ok' },
    },
    {
      what: 'republished (rev 2 live, rev 1 superseded)',
      slug: 'character-lora-training',
      expected: { anon: 'requires_signin', free: 'ok', pro: 'ok', admin: 'ok' },
    },
    {
      what: 'draft — never published',
      slug: 'insta-toon-pipeline',
      expected: { anon: 'not_found', free: 'not_found', pro: 'not_found', admin: 'not_found' },
    },
    {
      what: 'archived (pointer survives, status does not)',
      slug: 'voice-identity-setup',
      // Admin still reads it: §7 gates the read path "for non-admins".
      expected: { anon: 'not_found', free: 'not_found', pro: 'not_found', admin: 'ok' },
    },
    {
      what: 'unknown slug',
      slug: 'no-such-playbook',
      expected: { anon: 'not_found', free: 'not_found', pro: 'not_found', admin: 'not_found' },
    },
  ];

  for (const row of MATRIX) {
    for (const tier of TIER_ORDER) {
      it(`${row.what} × ${tier} → ${row.expected[tier]}`, async () => {
        const result = await open(tier, row.slug);
        expect(result.status).toBe(row.expected[tier]);
      });
    }
  }

  it('serves the CURRENT published revision, never the superseded one', async () => {
    const result = await open('free', 'character-lora-training');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.playbook.rev_no).toBe(2);
    // The republish carried a bilingual change note — §3.3's header renders it.
    expect(result.playbook.change_note?.en).toContain('Z-Image');
    expect(result.playbook.change_note?.ko).toBeTruthy();
  });

  it('locks exactly what the tier cannot see, and strips every storage key', async () => {
    const expectedVisible: Record<Tier, number> = { anon: 6, free: 12, pro: 18, admin: 24 };
    for (const tier of TIER_ORDER) {
      const result = await open(tier, 'talking-character-clip');
      // anon is bounced from this playbook entirely; the tier still has to be shapeable for admins
      // previewing as anon, which the preview case below covers.
      if (tier === 'anon') {
        expect(result.status).toBe('requires_signin');
        continue;
      }
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') continue;

      const blocks = result.playbook.steps.flatMap((step) => step.blocks);
      expect(blocks).toHaveLength(24);
      expect(blocks.filter((b) => !b.locked)).toHaveLength(expectedVisible[tier]);

      const serialized = JSON.stringify(result.playbook);
      expect(serialized).not.toContain('staging_key');
      expect(serialized).not.toContain('content/rev/');
      expect(serialized).not.toContain('content-published');
      expect(serialized).not.toContain('artifacts-published');
    }
  });

  it('gives an anonymous reader on a showcase page chrome only, never gated bytes', async () => {
    const result = await open('anon', 'character-sheet-generation');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const blocks = result.playbook.steps.flatMap((step) => step.blocks);
    const locked = blocks.filter((b) => b.locked);
    expect(locked.length).toBeGreaterThan(0);
    expect(result.playbook.lockedCount).toBe(locked.length);

    // The fixture sentinels are the real assertion: no token belonging to a gated block may appear.
    const serialized = JSON.stringify(result.playbook);
    for (const block of locked) {
      expect(Object.keys(block).sort()).toEqual(['id', 'kind', 'locked', 'order', 'visibility']);
    }
    expect(serialized).toContain('SENTINEL_CHARACTER_SHEET_GENERATION_S1_B2'); // public link
    expect(serialized).not.toContain('SENTINEL_CHARACTER_SHEET_GENERATION_S2_B1'); // pro prompt
    expect(serialized).not.toContain('SENTINEL_CHARACTER_SHEET_GENERATION_S1_B1'); // free note
  });

  it('reports neighbours in catalog order (§3.3 prev/next)', async () => {
    const result = await open('pro', 'talking-character-clip');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const { prev, next } = result.neighbours;
    // Newest first: lora (published last) · talking-character-clip · character-sheet-generation.
    expect(prev?.slug).toBe('character-lora-training');
    expect(next?.slug).toBe('character-sheet-generation');
  });

  it('never lists an archived or draft playbook as a neighbour', async () => {
    const result = await open('pro', 'character-lora-training');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const slugs = [result.neighbours.prev?.slug, result.neighbours.next?.slug];
    expect(slugs).not.toContain('voice-identity-setup');
    expect(slugs).not.toContain('insta-toon-pipeline');
  });
});

describe('admin preview plumbing (§3.8 preview-as, §7)', () => {
  let db: PGlite;
  let sql: SqlRunner;
  let storageRoot: string;
  let edges: EdgeSeedResult[];

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-preview-'));
    const storage = createLocalStorageDriver(storageRoot);
    sql = runner(db);
    await seed({ sql, storage, createAuthUsers: true });
    edges = await seedEdgeFixtures({ sql, storage });
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const lora = () => edges.find((e) => e.slug === 'character-lora-training')!;
  const draft = () => edges.find((e) => e.slug === 'insta-toon-pipeline')!;

  it('refuses preview options from every non-admin tier — no silent downgrade', async () => {
    for (const tier of ['anon', 'free', 'pro'] as Tier[]) {
      const byRevision = await shapePlaybook(
        { sql, viewer: viewerFor(tier) },
        'character-lora-training',
        { revisionId: lora().revisionIds[0]! },
      );
      expect(byRevision.status, `${tier} + revisionId`).toBe('not_found');

      const byTier = await shapePlaybook(
        { sql, viewer: viewerFor(tier) },
        'character-sheet-generation',
        { previewTier: 'admin' },
      );
      expect(byTier.status, `${tier} + previewTier`).toBe('not_found');
    }
  });

  it('lets a verified admin pin a superseded revision', async () => {
    const result = await shapePlaybook(
      { sql, viewer: viewerFor('admin') },
      'character-lora-training',
      { revisionId: lora().revisionIds[0]! },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.playbook.rev_no).toBe(1);
    expect(result.preview).toBe(true);
  });

  it('lets a verified admin pin a draft revision the public path 404s', async () => {
    const result = await shapePlaybook({ sql, viewer: viewerFor('admin') }, 'insta-toon-pipeline', {
      revisionId: draft().revisionIds[0]!,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Draft blocks carry no stamped visibility; the loader normalises them through the shared
    // resolver, so the pure shaper still receives a non-null visibility on every block (R3b).
    for (const block of result.playbook.steps.flatMap((s) => s.blocks)) {
      expect(block.visibility).toBeTruthy();
    }
  });

  it('refuses a revision id belonging to a different playbook', async () => {
    const result = await shapePlaybook(
      { sql, viewer: viewerFor('admin') },
      'character-sheet-generation',
      { revisionId: draft().revisionIds[0]! },
    );
    expect(result.status).toBe('not_found');
  });

  it('previews as a lower tier, eligibility included', async () => {
    const asAnon = await shapePlaybook(
      { sql, viewer: viewerFor('admin') },
      'talking-character-clip',
      { previewTier: 'anon' },
    );
    // An admin asking "what does a visitor see here" gets the visitor's answer, redirect and all.
    expect(asAnon.status).toBe('requires_signin');

    const showcaseAsAnon = await shapePlaybook(
      { sql, viewer: viewerFor('admin') },
      'character-sheet-generation',
      { previewTier: 'anon' },
    );
    expect(showcaseAsAnon.status).toBe('ok');
    if (showcaseAsAnon.status !== 'ok') return;
    expect(showcaseAsAnon.playbook.tier).toBe('anon');
    expect(showcaseAsAnon.playbook.lockedCount).toBeGreaterThan(0);
  });
});

/**
 * M3 — the same façade, but with the viewer RESOLVED from the database instead of fabricated.
 *
 * M2's matrix injects `{ tier }` because no session could be minted (§11). That is still true, but
 * M3 moved the half that turns a *user id* into a *tier* into `lib/auth/identity.ts`, and that half
 * is exactly where the entitlement wiring lives. So these cases drive the real derivation against
 * the seeded `subscriptions` rows and hand the result to the real façade: if the entitlement rule
 * or the seed ever disagree, a shaped page changes here.
 */
describe('viewer resolution ⇒ shaped page (§3.4 wiring)', () => {
  let db: PGlite;
  let sql: SqlRunner;
  let storageRoot: string;

  beforeAll(async () => {
    db = await freshDb();
    storageRoot = await mkdtemp(join(tmpdir(), 'playbook-viewer-'));
    sql = runner(db);
    await seed({ sql, storage: createLocalStorageDriver(storageRoot), createAuthUsers: true });
  });

  afterAll(async () => {
    await db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const viewerFromDb = async (userId: string): Promise<Viewer> =>
    resolveViewer({ id: userId }, await sqlIdentitySource(sql).load(userId));

  it('derives pro from the seeded subscriptions row, not from profiles.plan', async () => {
    const viewer = await viewerFromDb(FIXTURE_USERS.pro.id);
    expect(viewer.tier).toBe('pro');
    expect(viewer.email).toBe(FIXTURE_USERS.pro.email);

    const result = await shapePlaybook({ sql, viewer }, 'talking-character-clip');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const blocks = result.playbook.steps.flatMap((step) => step.blocks);
    // 24 blocks across 4 visibilities; pro sees everything except `hidden`.
    expect(blocks.filter((b) => !b.locked)).toHaveLength(18);
  });

  it('derives free with no subscription row, and admin from is_admin', async () => {
    expect((await viewerFromDb(FIXTURE_USERS.free.id)).tier).toBe('free');
    // The admin fixture carries `plan='free'` and no subscription — admin still outranks both.
    expect((await viewerFromDb(FIXTURE_USERS.admin.id)).tier).toBe('admin');
  });

  it('locks pro blocks the moment the subscription stops being entitled', async () => {
    const before = await shapePlaybook(
      { sql, viewer: await viewerFromDb(FIXTURE_USERS.pro.id) },
      'talking-character-clip',
    );
    expect(before.status === 'ok' && before.playbook.lockedCount).toBe(6);

    await sql.query(`update subscriptions set status = 'canceled' where user_id = $1`, [
      FIXTURE_USERS.pro.id,
    ]);

    const after = await shapePlaybook(
      { sql, viewer: await viewerFromDb(FIXTURE_USERS.pro.id) },
      'talking-character-clip',
    );
    expect(after.status).toBe('ok');
    if (after.status !== 'ok') return;
    expect(after.playbook.tier).toBe('free');
    expect(after.playbook.lockedCount).toBe(12);

    await sql.query(`update subscriptions set status = 'past_due' where user_id = $1`, [
      FIXTURE_USERS.pro.id,
    ]);
    // Stripe owns the retry window: `past_due` is still entitled (§3.4).
    expect((await viewerFromDb(FIXTURE_USERS.pro.id)).tier).toBe('pro');
  });

  it('resolves anon for an unknown user id', async () => {
    const viewer = await viewerFromDb('00000000-0000-4000-8000-000000000404');
    // No profile ⇒ no admin flag, no entitlement. The tier floor for a *signed-in* id is `free`;
    // the absence of a session is what produces `anon`, and that is `getViewer`'s half.
    expect(viewer.tier).toBe('free');
    expect(viewer.email).toBeNull();
  });
});

/**
 * The dev identity is the local render-verify seam (`npm run dev:pro`). Its whole safety argument
 * is that it cannot exist in a production build — so that is what is pinned here.
 */
describe('dev identity fences (lib/auth/dev-identity.ts)', () => {
  const id = FIXTURE_USERS.pro.id;

  it('is dead in a production build, whatever the env says', () => {
    expect(devIdentityUserId({ NODE_ENV: 'production', PLAYBOOK_DEV_IDENTITY: id })).toBeNull();
  });

  it('requires an explicit, well-formed id in development', () => {
    expect(devIdentityUserId({ NODE_ENV: 'development' })).toBeNull();
    expect(devIdentityUserId({ NODE_ENV: 'development', PLAYBOOK_DEV_IDENTITY: '' })).toBeNull();
    expect(devIdentityUserId({ NODE_ENV: 'development', PLAYBOOK_DEV_IDENTITY: 'pro' })).toBeNull();
    expect(devIdentityUserId({ NODE_ENV: 'development', PLAYBOOK_DEV_IDENTITY: id })).toBe(id);
  });

  /**
   * Exactly two consumers on the RUNTIME surface, and both are gates rather than grants: the edge
   * session check and the viewer resolution. A third would be a new way for an env var to reach a
   * decision, which is the thing the fences exist to prevent. `scripts/` is out of scope on purpose
   * — a launcher that sets the variable is not a code path that trusts it.
   */
  it('is consulted by exactly two places on the runtime surface', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join: joinPath } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../..', import.meta.url));

    const hits: string[] = [];
    const check = (full: string) => {
      if (readFileSync(full, 'utf8').includes('devIdentityUserId')) {
        hits.push(full.slice(root.length).replace(/\\/g, '/'));
      }
    };
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
        const full = joinPath(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) check(full);
      }
    };
    for (const dir of ['app', 'lib', 'components']) walk(joinPath(root, dir));
    check(joinPath(root, 'middleware.ts'));

    expect(hits.sort()).toEqual([
      'lib/auth/dev-identity.ts',
      'lib/auth/viewer.ts',
      'middleware.ts',
    ]);
  });
});

describe('decideEligibility (the pure rule both the page and the gateway use)', () => {
  const gate = (over: Partial<Parameters<typeof decideEligibility>[0]> = {}) => ({
    playbookId: 'pb',
    slug: 'slug',
    status: 'published' as const,
    publishedRevisionId: 'rev',
    isShowcase: false,
    ...over,
  });

  it('never resolves anything for a playbook with no published revision', () => {
    for (const tier of TIER_ORDER) {
      expect(decideEligibility(gate({ publishedRevisionId: null }), tier)).toBe('not_found');
      expect(decideEligibility(null, tier)).toBe('not_found');
    }
  });

  it('separates "sign in" from "does not exist" for anonymous readers', () => {
    expect(decideEligibility(gate({ isShowcase: true }), 'anon')).toBe('ok');
    expect(decideEligibility(gate({ isShowcase: false }), 'anon')).toBe('requires_signin');
    // …but an archived playbook is gone for everyone below admin, showcase or not.
    expect(decideEligibility(gate({ isShowcase: true, status: 'archived' }), 'anon')).toBe(
      'not_found',
    );
  });
});
