import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, freshDb, glueMigrationFiles } from '../helpers/pglite';

describe('migrations apply on a fresh database (PLAN §6)', () => {
  it('has a unique migration version for cloud application', () => {
    const versions = [...coreMigrationFiles(), ...glueMigrationFiles()].map(file => file.split('_')[0]);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('splits into core (PGlite-testable) and supabase-glue files', () => {
    expect(coreMigrationFiles().length).toBeGreaterThan(0);
    expect(glueMigrationFiles().length).toBeGreaterThan(0);
    // Nothing may be both; nothing may be neither.
    expect(coreMigrationFiles().filter((f) => glueMigrationFiles().includes(f))).toEqual([]);
  });

  it('creates every §6 table', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'billing_payments',
      'blocks',
      'brand_attachments',
      'brand_content_decisions',
      'brand_content_versions',
      'brand_contract_documents',
      'brand_contract_sharing_events',
      // 2026-09-11 — the brand enquiry form on the campaigns page: one row per enquiry, studio-only.
      'brand_inquiries',
      'brand_inquiry_deliveries',
      'brand_invites',
      'brand_memberships',
      'brand_messages',
      // 2026-09-23 — a brand's own logo history; the organization points at the current one.
      'brand_organization_logos',
      'brand_organizations',
      // 2026-09-22 — one ledger row per studio collection-console save (idempotency + batch time).
      'brand_post_collection_batches',
      'brand_post_measurements',
      'brand_posts',
      'brand_production_contracts',
      'brand_production_reservations',
      'brand_production_templates',
      'brand_project_members',
      'brand_projects',
      'brand_reports',
      'brand_support_messages',
      // 2026-09-23 — secondary usage (docs/SECONDARY-USAGE.md): inquiry case → studio scope, creator
      // compensation and consent (studio-only) → brand quote → payment → grants, plus history/outcomes.
      'brand_usage_buyers',
      'brand_usage_case_items',
      'brand_usage_cases',
      'brand_usage_compensations',
      'brand_usage_consents',
      'brand_usage_events',
      'brand_usage_grant_events',
      'brand_usage_grants',
      'brand_usage_messages',
      'brand_usage_outcomes',
      'brand_usage_payments',
      'brand_usage_quotes',
      'brand_usage_scope_revisions',
      'brand_workspace_events',
      // docs/CAMPAIGNS.md (2026-09-03) — the paid cousin of contests: the campaign, one application per
      // creator walked through the state machine, and the same append-only write ledger the contest
      // entries use for the daily cap.
      'campaign_application_writes',
      'campaign_applications',
      'campaign_collaboration_links',
      'campaign_funding_cases',
      'campaign_funding_events',
      'campaign_funding_payments',
      'campaign_funding_quotes',
      'campaign_funding_reward_proposals',
      'campaign_participant_access_audit',
      'campaign_participant_files',
      'campaign_participant_invites',
      'campaign_participant_messages',
      'campaign_productions',
      'campaign_render_jobs',
      'campaign_risk_access',
      'campaign_risk_flags',
      'campaign_risk_jobs',
      'campaign_risk_reviews',
      'campaign_risk_slack_outbox',
      'campaign_risk_workers',
      'campaign_targets',
      'campaigns',
      // §14.1 (M9) — the contests pivot's three new tables. Atomic like `prompt_items`: no
      // revisions, no manifest, no constraint triggers. `contest_entry_writes` is the append-only
      // rate-limit ledger, because "≤10 entry writes/day/user" counts WRITES and an upserted entry
      // row cannot.
      'contest_entries',
      'contest_entry_writes',
      'contests',
      // §15.2 (M10) — the cookies pivot's three new tables. `prompt_unlocks` is the permanent
      // per-(account, prompt) unlock; `cookie_ledger` is the append-only audit whose sum the
      // `profiles.cookie_balance` column caches for the fast read; `cookie_purchase_events`
      // claims each provider payment id exactly once so a redelivered M8 webhook cannot credit
      // one $4 pack twice (M10 review R1, finding 2).
      'cookie_ledger',
      'cookie_purchase_events',
      'creator_subscription_key_cleanup',
      'creator_subscription_launch_evidence',
      'creator_subscription_periods',
      'creator_subscription_renders',
      'creator_subscription_usage',
      'creator_subscriptions',
      'default_policy',
      'events',
      // docs/TEMPLATES-IA.md §8.2 (2026-09-10) — the real-person identity: one group per person, one asset per photo.
      'identity_assets',
      'identity_groups',
      // docs/IDENTITY-SELFIE.md (2026-10-22) — the generated-portrait tables stay for paid lineage; `identity_selfies` is the one photo.
      'identity_portrait_attempts',
      'identity_portrait_selections',
      'identity_selfies',
      // docs/PLATFORM-2.0.md §20 (2026-10-28) — an AI creative's agent tokens and representative works.
      'maker_tokens',
      'maker_works',
      'notification_deliveries',
      'notification_jobs',
      'platform_audit',
      'platform_claims',
      'platform_creator_applications',
      'platform_creators',
      'platform_credit_ledger',
      'platform_format_assets',
      'platform_formats',
      'platform_image_offers',
      'platform_messages',
      'platform_quality',
      'platform_rate_limits',
      'platform_ratings',
      'platform_redemptions',
      'platform_reward_policy',
      'platform_settlements',
      'platform_threads',
      'playbook_revisions',
      'playbooks',
      'profiles',
      // §13.1 (M6) — the prompts pivot's one new table. Atomic by design: no revisions, no
      // manifest, no constraint triggers; the machinery above still guards playbooks only.
      'prompt_items',
      'prompt_unlocks',
      'publish_assets',
      // docs/PLATFORM-2.0.md §5.3 (2026-10-22) — one row per device that said yes to the completion push.
      'push_subscriptions',
      // §20.3 — one row per (template, member) who opened a full recipe.
      'recipe_unlocks',
      // 2026-09-11 — the owner's complaint about a result, one per render, worked from the admin inbox.
      'render_feedback',
      // docs/TEMPLATES-IA.md §8 (2026-09-06) — the render queue: one row per make, from photo to link.
      'render_job_outputs',
      'render_job_recipes',
      'render_jobs',
      // docs/PLATFORM-2.0.md §17.1 (2026-10-23) — linked SNS accounts, their write ledger, the local worker's heartbeat.
      'social_account_writes',
      'social_accounts',
      'social_verify_workers',
      'steps',
      'stripe_events',
      'subscriptions',
    ]);
    await db.close();
  });

  it('declares the visibility enum in gating order public < free < pro < hidden', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ label: string }>(
      `select enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'visibility' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual(['public', 'free', 'pro', 'hidden']);

    const { rows: cmp } = await db.query<{ ok: boolean }>(
      `select ('public'::visibility < 'free'::visibility
           and 'free'::visibility   < 'pro'::visibility
           and 'pro'::visibility    < 'hidden'::visibility) as ok`,
    );
    expect(cmp[0]?.ok).toBe(true);
    await db.close();
  });

  it('seeds the default visibility policy per kind (§3.8 /admin/policy)', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ kind: string; visibility: string }>(
      'select kind, visibility from default_policy order by kind',
    );
    expect(rows).toEqual([
      { kind: 'asset', visibility: 'free' },
      { kind: 'link', visibility: 'public' },
      { kind: 'note', visibility: 'free' },
      { kind: 'params', visibility: 'pro' },
      { kind: 'prompt', visibility: 'pro' },
      { kind: 'workflow_file', visibility: 'pro' },
    ]);
    await db.close();
  });

  it('installs the same-playbook composite FK and the block content CHECK', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ conname: string; contype: string }>(
      `select conname, contype from pg_constraint
        where conname in ('fk_published_revision_same_playbook','blocks_content_min')
        order by conname`,
    );
    expect(rows).toEqual([
      { conname: 'blocks_content_min', contype: 'c' },
      { conname: 'fk_published_revision_same_playbook', contype: 'f' },
    ]);
    await db.close();
  });

  it('owns both publish RPCs with the publisher role and marks them SECURITY DEFINER', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ proname: string; owner: string; secdef: boolean }>(
      `select p.proname, r.rolname as owner, p.prosecdef as secdef
         from pg_proc p
         join pg_roles r on r.oid = p.proowner
        where p.proname in ('prepare_publish','publish_revision') order by p.proname`,
    );
    expect(rows).toEqual([
      { proname: 'prepare_publish', owner: 'publisher', secdef: true },
      { proname: 'publish_revision', owner: 'publisher', secdef: true },
    ]);
    await db.close();
  });

  it('forces deny-all RLS on EVERY table in the glue migration (§6 security posture)', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    await db.close();

    /**
     * Every `*_glue_*` file, concatenated.
     *
     * M6 added `prompt_items` in `0102_glue_prompts_rls.sql` rather than editing `0100` — migrations
     * are append-only. The PROPERTY under test is unchanged and is what matters: every table in the
     * database is named by the deny-all posture somewhere, and no file anywhere creates a policy.
     */
    const glue = glueMigrationFiles()
      .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      .join('\n');
    for (const { table_name } of rows) {
      expect(glue, `RLS coverage for ${table_name}`).toContain(`'${table_name}'`);
    }
    expect(glue).toContain('enable row level security');
    expect(glue).toContain('force  row level security');
    expect(glue).toContain('revoke all on public.%I from anon, authenticated');

    /**
     * M9 review, finding 7 — name the §14 tables explicitly rather than relying on the loop above.
     *
     * The loop asserts coverage for whatever tables the migrations happen to create, which is the
     * right general property but would go quiet if a table were dropped from BOTH the schema and
     * the posture at once. `contest_entries` is the second table a non-admin can cause rows to
     * appear in and the first that stores a personal link, so its deny-all is spelled out here and
     * probed for real against the cloud in `npm run cloud:smoke`.
     */
    const contests = readFileSync(join(MIGRATIONS_DIR, '0104_glue_contests_rls.sql'), 'utf8');
    for (const table of ['contests', 'contest_entries', 'contest_entry_writes']) {
      expect(contests, `0104 covers ${table}`).toContain(`'${table}'`);
    }
    expect(contests).toContain('enable row level security');
    expect(contests).toContain('force  row level security');
    expect(contests).toContain('revoke all on public.%I from anon, authenticated');
    expect(contests).not.toMatch(/create\s+policy/i);

    /**
     * M10 §15.2 — same explicitness for the cookies tables. `cookie_ledger` records what every
     * account spent and on which prompt, and `prompt_unlocks` is a per-person reading history;
     * both are exactly the kind of row PostgREST must never hand to a browser key. Probed for
     * real against the cloud in `npm run cloud:smoke`.
     */
    const cookies = readFileSync(join(MIGRATIONS_DIR, '0105_glue_cookies_rls.sql'), 'utf8');
    for (const table of ['prompt_unlocks', 'cookie_ledger', 'cookie_purchase_events']) {
      expect(cookies, `0105 covers ${table}`).toContain(`'${table}'`);
    }
    expect(cookies).toContain('enable row level security');
    expect(cookies).toContain('force  row level security');
    expect(cookies).toContain('revoke all on public.%I from anon, authenticated');
    expect(cookies).not.toMatch(/create\s+policy/i);
    // no policies anywhere — deny-all means the absence of policies, not a permissive one
    expect(glue).not.toMatch(/create\s+policy/i);
    for (const file of [...coreMigrationFiles(), ...glueMigrationFiles()]) {
      expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'), file).not.toMatch(/create\s+policy/i);
    }
  });

  /**
   * M10 §15.2 — the 0103 lesson as a standing rule: a new `public` function is a new PostgREST
   * `/rpc` surface handed to anon/authenticated by Supabase's default privileges. The cookies
   * migration therefore creates NONE — every wallet decision lives in `lib/cookies/repo.ts`
   * inside `transaction()`, which is also what makes it testable here.
   */
  it('adds the cookie schema without creating a single SQL function', () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '0008_core_cookies.sql'), 'utf8');
    expect(migration).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(migration).toContain('cookie_balance');
    expect(migration).toContain('cookies_granted_at');
  });

  it('exposes the publish RPCs to service_role only', () => {
    const glue = readFileSync(join(MIGRATIONS_DIR, '0100_glue_rls.sql'), 'utf8');
    expect(glue).toContain('revoke execute on function prepare_publish(uuid)              from public');
    expect(glue).toContain('revoke execute on function publish_revision(uuid, uuid, text) from public');
    expect(glue).toContain('grant execute on function prepare_publish(uuid)              to service_role');
    expect(glue).toContain('grant execute on function publish_revision(uuid, uuid, text) to service_role');
    expect(glue).toContain('alter role publisher with bypassrls');
  });

  it('registers the immutability constraint triggers', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ tgname: string }>(
      `select tgname from pg_trigger where not tgisinternal and tgname like 'trg_guard_%' order by tgname`,
    );
    expect(rows.map((r) => r.tgname)).toEqual([
      'trg_guard_blocks',
      'trg_guard_playbook_revisions',
      'trg_guard_playbooks',
      'trg_guard_publish_assets',
      'trg_guard_steps',
    ]);
    await db.close();
  });
});
