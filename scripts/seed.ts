import { createHash, randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { parseBlock, type AssetRef } from '@/lib/content/schemas';
import { runPublishPipeline, type CopyReport } from '@/lib/publish/pipeline';
import {
  FIXTURE_PLAYBOOKS,
  FIXTURE_USERS,
  type AssetSpec,
  type PlaybookSpec,
} from './fixtures';

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
}

/** Deterministic, clearly-labelled placeholder bytes (§9: fixture media is labelled as such). */
function placeholderBytes(label: string): Uint8Array {
  return new TextEncoder().encode(
    `PLAYBOOK FIXTURE PLACEHOLDER :: ${label} :: not real production media\n`,
  );
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

  // Assets are uploaded to private staging as they are materialised, so the manifest built by
  // prepare_publish always has real bytes behind it.
  const uploads: Array<{ key: string; bytes: Uint8Array; mime: string }> = [];
  const mkAsset = (asset: AssetSpec): AssetRef => {
    const bytes = placeholderBytes(asset.label);
    const key = `content/rev/${spec.revisionId}/${randomUUID()}.${asset.ext}`;
    uploads.push({ key, bytes, mime: asset.mime });
    const ref: AssetRef = { staging_key: key, sha256: sha256Hex(bytes), mime: asset.mime };
    if (asset.w !== undefined) ref.w = asset.w;
    if (asset.h !== undefined) ref.h = asset.h;
    if (asset.duration_s !== undefined) ref.duration_s = asset.duration_s;
    return ref;
  };

  const heroRef = mkAsset(spec.hero);

  await sql.query(
    `insert into playbooks (id, slug, status, category, sort) values ($1, $2, 'draft', $3, $4)`,
    [spec.id, spec.slug, spec.category, spec.sort],
  );

  await sql.query(
    `insert into playbook_revisions
       (id, playbook_id, rev_no, state, is_showcase, title, summary, difficulty,
        tools, models, est_time_min, est_cost_usd, hero_asset)
     values ($1, $2, 1, 'draft', $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      spec.revisionId,
      spec.id,
      spec.isShowcase,
      JSON.stringify(spec.title),
      JSON.stringify(spec.summary),
      spec.difficulty,
      spec.tools,
      spec.models,
      spec.estTimeMin,
      spec.estCostUsd,
      JSON.stringify(heroRef),
    ],
  );

  for (const [stepIndex, step] of spec.steps.entries()) {
    const stepId = randomUUID();
    await sql.query(
      `insert into steps (id, revision_id, "order", title, body)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        stepId,
        spec.revisionId,
        stepIndex + 1,
        JSON.stringify(step.title),
        step.body === null ? null : JSON.stringify(step.body),
      ],
    );

    for (const [blockIndex, block] of step.blocks.entries()) {
      const content = block.build(mkAsset);
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
  return { users, playbooks };
}
