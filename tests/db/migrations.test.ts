import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, freshDb, glueMigrationFiles } from '../helpers/pglite';

describe('migrations apply on a fresh database (PLAN §6)', () => {
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
      'blocks',
      'default_policy',
      'events',
      'notification_deliveries',
      'notification_jobs',
      'playbook_revisions',
      'playbooks',
      'profiles',
      'publish_assets',
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

    const glue = readFileSync(join(MIGRATIONS_DIR, '0100_glue_rls.sql'), 'utf8');
    for (const { table_name } of rows) {
      expect(glue, `RLS coverage for ${table_name}`).toContain(`'${table_name}'`);
    }
    expect(glue).toContain('enable row level security');
    expect(glue).toContain('force  row level security');
    expect(glue).toContain('revoke all on public.%I from anon, authenticated');
    // no policies anywhere — deny-all means the absence of policies, not a permissive one
    expect(glue).not.toMatch(/create\s+policy/i);
    for (const file of [...coreMigrationFiles(), ...glueMigrationFiles()]) {
      expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'), file).not.toMatch(/create\s+policy/i);
    }
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
