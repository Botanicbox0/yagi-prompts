import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { AssetRefSchema, parseBlock, type AssetRef, type Localized } from '@/lib/content/schemas';
import { runPublishPipeline, type CopyReport } from '@/lib/publish/pipeline';
import { publishPromptMedia } from '@/lib/prompts/media';
import { insertPrompt } from '@/lib/prompts/repo';
import { DEFAULT_PROMPT_MODEL, type PromptMedia } from '@/lib/prompts/schemas';
import {
  EDGE_FIXTURE_PLAYBOOKS,
  FIXTURE_PLAYBOOKS,
  FIXTURE_USERS,
  sentinelToken,
  type AssetSpec,
  type EdgePlaybookSpec,
  type PlaybookSpec,
} from './fixtures';
import { PROMPT_FIXTURES } from './prompt-fixtures';

/**
 * PLAN §8 M0 — "seed script publishes 2 fixture playbooks through the REAL prepare→copy→publish
 * flow (every block kind × visibility)" plus the entitlement fixtures.
 *
 * Driver-agnostic on purpose: the vitest acceptance run feeds it PGlite; `npm run seed` feeds it a
 * real Postgres URL. Nothing here bypasses the RPCs — that is the point of the exercise.
 */

export interface SeedOptions {
  sql: SqlRunner;
  storage: StorageDriver;
  /**
   * PGlite/self-hosted: true (the harness owns a minimal `auth.users` stub).
   * Real Supabase: false — auth.users belongs to GoTrue; create the users with the Auth admin API
   * first (docs/SETUP.md) and this seed will attach profiles to them.
   */
  createAuthUsers?: boolean;
  log?: (message: string) => void;
}

export interface SeededPlaybook {
  id: string;
  slug: string;
  revisionId: string;
  copy: CopyReport;
  skipped: boolean;
}

export interface SeedResult {
  users: Record<'free' | 'pro' | 'admin', string>;
  playbooks: SeededPlaybook[];
  /** §13 — the prompts catalog, seeded through the same publish-media lifecycle. */
  prompts: PromptSeedResult[];
}

const PLACEHOLDER_NOTE = (label: string) =>
  `PLAYBOOK FIXTURE PLACEHOLDER :: ${label} :: not real production media`;

// --- a real, tiny PNG -------------------------------------------------------
// §9 wants placeholder media that is CLEARLY placeholder; M2 also needs it to be real media, so
// the detail page, the library grid and the streaming half of the media gateway can be verified
// end to end (a text file with a .png extension proves nothing about `Content-Type` handling).
// Hand-rolled rather than a dependency: a solid greyscale field with a grid, plus a `tEXt` chunk
// carrying the same "not real production media" label the bytes used to carry as their entirety.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function placeholderPng(label: string, width = 640, height = 360): Uint8Array {
  // Cap the raster: the declared w/h can be 1600×900, and a fixture does not need those pixels.
  const scale = Math.min(1, 800 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));

  const seed = createHash('sha256').update(label).digest()[0] ?? 0;
  const base = 0x38 + (seed % 0x60); // mid greys only — fixtures must not invent palette colours
  const line = Math.min(255, base + 0x18);

  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    const horizontal = y % 48 === 0;
    for (let x = 0; x < w; x += 1) {
      const tone = horizontal || x % 48 === 0 ? line : base;
      const p = rowStart + 1 + x * 3;
      raw[p] = tone;
      raw[p + 1] = tone;
      raw[p + 2] = tone;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const text = Buffer.concat([
    Buffer.from('Comment\0', 'latin1'),
    Buffer.from(PLACEHOLDER_NOTE(label), 'latin1'),
  ]);

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('tEXt', text),
      pngChunk('IDAT', deflateSync(raw, { level: 9 })),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// --- a real, tiny MP4 container --------------------------------------------
// §13 needs fixture VIDEO, and a video fixture has to be a real file for anything downstream to be
// worth testing: `probeMp4DurationSeconds` must read a duration out of actual bytes, the copier
// must move it, and the media route must serve it as `video/mp4`. This builds a structurally valid
// ISO-BMFF file — `ftyp` + `moov`/`mvhd` + `mdat` — with no encoded video track, so it is honest
// placeholder media in exactly the sense §9 asks for: clearly labelled (the note lives in `mdat`),
// and a player that cannot decode it simply shows the poster underneath.

function isoBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function placeholderMp4(label: string, durationSeconds: number): Uint8Array {
  const ftyp = isoBox(
    'ftyp',
    Buffer.concat([
      Buffer.from('isom', 'latin1'),
      Buffer.from([0x00, 0x00, 0x02, 0x00]), // minor version
      Buffer.from('isomiso2mp41', 'latin1'),
    ]),
  );

  const timescale = 1000;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(0, 0); // version 0 + flags
  mvhd.writeUInt32BE(0, 4); // creation time
  mvhd.writeUInt32BE(0, 8); // modification time
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(durationSeconds * timescale), 16);
  mvhd.writeUInt32BE(0x00010000, 20); // rate 1.0
  mvhd.writeUInt16BE(0x0100, 24); // volume 1.0
  // 2 reserved + 8 reserved stay zero; the unity matrix starts at 36.
  mvhd.writeUInt32BE(0x00010000, 36);
  mvhd.writeUInt32BE(0x00010000, 52);
  mvhd.writeUInt32BE(0x40000000, 68);
  mvhd.writeUInt32BE(2, 96); // next track id

  const moov = isoBox('moov', isoBox('mvhd', mvhd));
  const mdat = isoBox('mdat', Buffer.from(`${PLACEHOLDER_NOTE(label)}\n`, 'latin1'));
  return new Uint8Array(Buffer.concat([ftyp, moov, mdat]));
}

/** Deterministic, clearly-labelled placeholder bytes (§9: fixture media is labelled as such). */
function placeholderBytes(spec: AssetSpec): Uint8Array {
  if (spec.mime === 'image/png') return placeholderPng(spec.label, spec.w, spec.h);
  if (spec.mime === 'video/mp4') return placeholderMp4(spec.label, spec.duration_s ?? 6);
  return new TextEncoder().encode(`${PLACEHOLDER_NOTE(spec.label)}\n`);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function seedUsers(opts: SeedOptions): Promise<Record<'free' | 'pro' | 'admin', string>> {
  const { sql } = opts;
  for (const user of Object.values(FIXTURE_USERS)) {
    if (opts.createAuthUsers !== false) {
      await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [
        user.id,
      ]);
    }
    await sql.query(
      `insert into profiles (id, email, display_name, locale, plan, is_admin)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update
         set email = excluded.email,
             display_name = excluded.display_name,
             locale = excluded.locale,
             plan = excluded.plan,
             is_admin = excluded.is_admin`,
      [user.id, user.email, user.displayName, user.locale, user.plan, user.isAdmin],
    );
    if (user.subscription) {
      await sql.query(
        `insert into subscriptions
           (user_id, stripe_subscription_id, status, cancel_at_period_end, current_period_end, stripe_fetched_at)
         values ($1, $2, $3, false, now() + interval '30 days', now())
         on conflict (user_id) do update
           set stripe_subscription_id = excluded.stripe_subscription_id,
               status = excluded.status,
               stripe_fetched_at = excluded.stripe_fetched_at`,
        [user.id, user.subscription.stripeSubscriptionId, user.subscription.status],
      );
    }
  }
  return {
    free: FIXTURE_USERS.free.id,
    pro: FIXTURE_USERS.pro.id,
    admin: FIXTURE_USERS.admin.id,
  };
}

interface DraftArgs {
  revisionId: string;
  revNo: number;
  changeNote?: Localized;
}

/**
 * Materialise one DRAFT revision of a spec: the playbook row (once), the revision, its steps and
 * blocks, and the staged bytes every AssetRef points at. Publication is always a separate step, so
 * every fixture — core or edge — reaches its state through the real RPCs.
 */
async function insertDraftRevision(
  opts: SeedOptions,
  spec: PlaybookSpec,
  args: DraftArgs,
): Promise<void> {
  const { sql, storage } = opts;

  // Assets are uploaded to private staging as they are materialised, so the manifest built by
  // prepare_publish always has real bytes behind it.
  const uploads: Array<{ key: string; bytes: Uint8Array; mime: string }> = [];
  const mkAsset = (asset: AssetSpec): AssetRef => {
    const bytes = placeholderBytes(asset);
    const key = `content/rev/${args.revisionId}/${randomUUID()}.${asset.ext}`;
    uploads.push({ key, bytes, mime: asset.mime });
    const ref: AssetRef = { staging_key: key, sha256: sha256Hex(bytes), mime: asset.mime };
    if (asset.w !== undefined) ref.w = asset.w;
    if (asset.h !== undefined) ref.h = asset.h;
    if (asset.duration_s !== undefined) ref.duration_s = asset.duration_s;
    return ref;
  };

  const heroRef = mkAsset(spec.hero);

  await sql.query(
    `insert into playbooks (id, slug, status, category, sort) values ($1, $2, 'draft', $3, $4)
     on conflict (id) do nothing`,
    [spec.id, spec.slug, spec.category, spec.sort],
  );

  await sql.query(
    `insert into playbook_revisions
       (id, playbook_id, rev_no, state, is_showcase, title, summary, difficulty,
        tools, models, est_time_min, est_cost_usd, hero_asset, change_note)
     values ($1, $2, $3, 'draft', $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
    [
      args.revisionId,
      spec.id,
      args.revNo,
      spec.isShowcase,
      JSON.stringify(spec.title),
      JSON.stringify(spec.summary),
      spec.difficulty,
      spec.tools,
      spec.models,
      spec.estTimeMin,
      spec.estCostUsd,
      JSON.stringify(heroRef),
      args.changeNote === undefined ? null : JSON.stringify(args.changeNote),
    ],
  );

  for (const [stepIndex, step] of spec.steps.entries()) {
    const stepId = randomUUID();
    await sql.query(
      `insert into steps (id, revision_id, "order", title, body)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        stepId,
        args.revisionId,
        stepIndex + 1,
        JSON.stringify(step.title),
        step.body === null ? null : JSON.stringify(step.body),
      ],
    );

    for (const [blockIndex, block] of step.blocks.entries()) {
      const content = block.build(
        mkAsset,
        sentinelToken(spec.slug, stepIndex + 1, blockIndex + 1),
      );
      // The zod schemas are the single source (§6.1) — fixtures go through them, not around them.
      parseBlock(block.kind, content);
      await sql.query(
        `insert into blocks (id, step_id, "order", kind, content, visibility)
         values ($1, $2, $3, $4, $5::jsonb, $6::visibility)`,
        [
          randomUUID(),
          stepId,
          blockIndex + 1,
          block.kind,
          JSON.stringify(content),
          block.visibility ?? null,
        ],
      );
    }
  }

  for (const upload of uploads) {
    await storage.putStaging(upload.key, upload.bytes, upload.mime);
  }
}

async function seedPlaybook(opts: SeedOptions, spec: PlaybookSpec): Promise<SeededPlaybook> {
  const { sql, storage } = opts;
  const log = opts.log ?? (() => {});

  const existing = await sql.query<{ id: string; published_revision_id: string | null }>(
    'select id, published_revision_id from playbooks where slug = $1',
    [spec.slug],
  );
  if (existing.rows.length > 0) {
    log(`· ${spec.slug} already present — skipping (published content is immutable)`);
    return {
      id: existing.rows[0]!.id,
      slug: spec.slug,
      revisionId: existing.rows[0]!.published_revision_id ?? '',
      copy: { copied: 0, alreadyPresent: 0, skipped: 0 },
      skipped: true,
    };
  }

  await insertDraftRevision(opts, spec, { revisionId: spec.revisionId, revNo: 1 });

  const copy = await runPublishPipeline(sql, storage, {
    playbookId: spec.id,
    revisionId: spec.revisionId,
  });
  log(
    `· ${spec.slug} published (rev ${spec.revisionId}) — ` +
      `${copy.copied} copied, ${copy.alreadyPresent} already present`,
  );

  return { id: spec.id, slug: spec.slug, revisionId: spec.revisionId, copy, skipped: false };
}

export async function seed(opts: SeedOptions): Promise<SeedResult> {
  const users = await seedUsers(opts);
  const playbooks: SeededPlaybook[] = [];
  for (const spec of FIXTURE_PLAYBOOKS) {
    playbooks.push(await seedPlaybook(opts, spec));
  }
  // §13: the prompts catalog is part of the BASE seed, not an edge add-on — the landing, the
  // gallery and the sitemap all read it now, so a seeded database without it is not the product.
  const prompts = await seedPrompts(opts);
  return { users, playbooks, prompts };
}

// ---------------------------------------------------------------------------
// edge fixtures (M2) — draft / archived / superseded, all through the real RPCs
// ---------------------------------------------------------------------------

export interface EdgeSeedResult {
  slug: string;
  playbookId: string;
  mode: EdgePlaybookSpec['mode'];
  /** Revisions in creation order; for `republished` that is [superseded, published]. */
  revisionIds: string[];
  skipped: boolean;
}

async function seedEdgePlaybook(
  opts: SeedOptions,
  spec: EdgePlaybookSpec,
): Promise<EdgeSeedResult> {
  const { sql, storage } = opts;
  const log = opts.log ?? (() => {});

  const existing = await sql.query<{ id: string }>('select id from playbooks where slug = $1', [
    spec.slug,
  ]);
  if (existing.rows.length > 0) {
    log(`· ${spec.slug} already present — skipping`);
    return {
      slug: spec.slug,
      playbookId: existing.rows[0]!.id,
      mode: spec.mode,
      revisionIds: [],
      skipped: true,
    };
  }

  await insertDraftRevision(opts, spec, { revisionId: spec.revisionId, revNo: 1 });
  const revisionIds = [spec.revisionId];

  if (spec.mode === 'draft') {
    log(`· ${spec.slug} left as a DRAFT (never published)`);
    return { slug: spec.slug, playbookId: spec.id, mode: spec.mode, revisionIds, skipped: false };
  }

  await runPublishPipeline(sql, storage, { playbookId: spec.id, revisionId: spec.revisionId });

  if (spec.mode === 'archived') {
    // `published_revision_id` survives archiving by design (§6) — only `status` moves, and it is a
    // plain column, not one of the publisher-gated fields.
    await sql.query(`update playbooks set status = 'archived' where id = $1`, [spec.id]);
    log(`· ${spec.slug} published then ARCHIVED`);
    return { slug: spec.slug, playbookId: spec.id, mode: spec.mode, revisionIds, skipped: false };
  }

  // republished: rev 2 supersedes rev 1. The change note is mandatory here — publish_revision
  // rejects a republish without a bilingual one (§3.8), which is the point of exercising it.
  const secondRevisionId = spec.secondRevisionId ?? randomUUID();
  await insertDraftRevision(opts, spec, {
    revisionId: secondRevisionId,
    revNo: 2,
    ...(spec.changeNote ? { changeNote: spec.changeNote } : {}),
  });
  await runPublishPipeline(sql, storage, { playbookId: spec.id, revisionId: secondRevisionId });
  revisionIds.push(secondRevisionId);
  log(`· ${spec.slug} republished — rev 1 superseded, rev 2 live`);

  return { slug: spec.slug, playbookId: spec.id, mode: spec.mode, revisionIds, skipped: false };
}

// ---------------------------------------------------------------------------
// prompts (M6) — PLAN §13
// ---------------------------------------------------------------------------

export interface PromptSeedResult {
  slug: string;
  id: string;
  status: string;
  copied: number;
}

/**
 * Seed the §13 prompt catalog through the REAL lifecycle.
 *
 * Nothing here shortcuts the doctrine that matters: assets are staged privately first, and only a
 * PUBLISHED item's media is copied into `public-content` (via `publishPromptMedia`, the same
 * function the approve operation calls). So the pending submission's clip exists on disk, is
 * reachable to an admin, and has no `published_key` at all — which is exactly why the sweep can
 * assert that its bytes are unreachable publicly.
 *
 * Published rows are backdated by `publishedDaysAgo` so the gallery order and the 14-day NEW badge
 * window are deterministic rather than "whatever `now()` was when the snapshot was built".
 */
export async function seedPrompts(opts: SeedOptions): Promise<PromptSeedResult[]> {
  const { sql, storage } = opts;
  const log = opts.log ?? (() => {});
  const results: PromptSeedResult[] = [];

  for (const fixture of PROMPT_FIXTURES) {
    const existing = await sql.query<{ id: string }>('select id from prompt_items where slug = $1', [
      fixture.slug,
    ]);
    if (existing.rows.length > 0) {
      log(`· prompt ${fixture.slug} already present — skipping`);
      results.push({ slug: fixture.slug, id: existing.rows[0]!.id, status: 'skipped', copied: 0 });
      continue;
    }

    const media: PromptMedia = {};
    for (const [kind, spec] of [
      ['poster', fixture.poster],
      ['video', fixture.video],
    ] as const) {
      if (!spec) continue;
      const bytes = placeholderBytes(spec);
      const key = `content/prompt/${fixture.id}/${randomUUID()}.${spec.ext}`;
      await storage.putStaging(key, bytes, spec.mime);
      const ref: Record<string, unknown> = {
        staging_key: key,
        sha256: sha256Hex(bytes),
        mime: spec.mime,
      };
      if (spec.w !== undefined) ref.w = spec.w;
      if (spec.h !== undefined) ref.h = spec.h;
      if (spec.duration_s !== undefined) ref.duration_s = spec.duration_s;
      media[kind] = AssetRefSchema.parse(ref);
    }

    const published = fixture.status === 'published';
    // The copier runs for published items ONLY — a pending submission's bytes stay private.
    const { media: finalMedia, report } = published
      ? await publishPromptMedia(storage, media)
      : { media, report: { copied: 0, alreadyPresent: 0 } };

    await insertPrompt(sql, {
      id: fixture.id,
      slug: fixture.slug,
      source: fixture.source,
      authorId: fixture.authorKey ? FIXTURE_USERS[fixture.authorKey].id : null,
      authorHandle: fixture.handle ?? null,
      status: fixture.status,
      model: DEFAULT_PROMPT_MODEL,
      title: fixture.title,
      titleKo: fixture.titleKo,
      // The sentinel rides INSIDE the gated bytes — that is the whole point of it.
      promptText: `${fixture.text}\n:: ${fixture.sentinel}`,
      textVisibility: fixture.textVisibility,
      media: Object.keys(finalMedia).length === 0 ? null : finalMedia,
      useCase: fixture.useCase,
      featured: fixture.featured,
      rejectReason: fixture.rejectReason ?? null,
      publishedAt: published ? 'now' : null,
    });

    if (published && fixture.publishedDaysAgo !== undefined) {
      await sql.query(
        `update prompt_items set published_at = now() - ($2 || ' days')::interval where id = $1`,
        [fixture.id, String(fixture.publishedDaysAgo)],
      );
    }

    log(`· prompt ${fixture.slug} seeded (${fixture.status}, ${report.copied} copied)`);
    results.push({
      slug: fixture.slug,
      id: fixture.id,
      status: fixture.status,
      copied: report.copied,
    });
  }

  return results;
}

/**
 * The states the M2 read path has to REFUSE (see `EDGE_FIXTURE_PLAYBOOKS`).
 *
 * Applied separately from `seed()` on purpose: M0/M1's acceptance suites assert the exact shape of
 * the published catalog, and their subject must not drift because a later milestone needed a draft
 * to 404 on. `npm run db:local` applies both, so the dev snapshot and the anon sweep see everything.
 */
export async function seedEdgeFixtures(opts: SeedOptions): Promise<EdgeSeedResult[]> {
  const results: EdgeSeedResult[] = [];
  for (const spec of EDGE_FIXTURE_PLAYBOOKS) {
    results.push(await seedEdgePlaybook(opts, spec));
  }
  return results;
}
