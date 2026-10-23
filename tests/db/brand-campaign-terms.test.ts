import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, expectReject, freshDb } from '../helpers/pglite';

/**
 * 0056 / 0140 — docs/PLATFORM-2.0.md §16.6. The wizard's terms on the brief, who a campaign is shown
 * to, the private target list, and the brand's "preferred" mark on an application. Both files are
 * cloud-applied by the founder or the Director, and say so at the top.
 */
const CORE = '0056_core_brand_campaign_terms.sql';
const GLUE = '0140_glue_brand_campaign_terms.sql';
const USER = '55555555-5555-4555-8555-555555555555';
const CAMPAIGN = '66666666-6666-4666-8666-666666666666';

async function campaign(db: PGlite, audience?: string) {
  await db.query(
    `insert into campaigns (id, slug, title, summary, host_name, host_kind, platforms, deliverable, slots${audience ? ', audience' : ''})
     values ($1, 'wizard-test', '{"en":"t","ko":"t"}', '{"en":"s","ko":"s"}', 'Brand', 'brand', '{instagram}', 'reel', 3${audience ? ', $2' : ''})`,
    audience ? [CAMPAIGN, audience] : [CAMPAIGN],
  );
}

describe('0056 brand campaign terms (core)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
    await db.query('insert into auth.users (id) values ($1)', [USER]);
    await db.query(`insert into profiles (id, email, locale) values ($1, 'b@twings.test', 'ko')`, [USER]);
  });
  afterEach(async () => db.close());

  it('adds campaign_terms to briefs as a nullable JSON object', async () => {
    const { rows } = await db.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns where table_name = 'brand_projects' and column_name = 'campaign_terms'`,
    );
    expect(rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);
    const def = (await db.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'brand_projects_campaign_terms_object'`)).rows[0]!.def;
    expect(def).toContain("jsonb_typeof(campaign_terms) = 'object'");
  });

  it('defaults every campaign to public and refuses an unknown audience', async () => {
    await campaign(db);
    expect((await db.query<{ audience: string }>('select audience from campaigns where id = $1', [CAMPAIGN])).rows[0]!.audience).toBe('public');
    await db.query("update campaigns set audience = 'invited' where id = $1", [CAMPAIGN]);
    await db.query("update campaigns set audience = 'influencers' where id = $1", [CAMPAIGN]);
    expect(await expectReject(() => db.query("update campaigns set audience = 'everyone' where id = $1", [CAMPAIGN]))).toMatch(/check/i);
  });

  it('keeps one target row per campaign and account, gone with either side', async () => {
    await campaign(db, 'invited');
    const columns = (await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns where table_name = 'campaign_targets' order by ordinal_position`,
    )).rows;
    expect(Object.fromEntries(columns.map((c) => [c.column_name, c.is_nullable]))).toEqual({
      campaign_id: 'NO', user_id: 'NO', invited_by: 'YES', invited_at: 'NO',
    });
    const insert = () => db.query('insert into campaign_targets (campaign_id, user_id, invited_by) values ($1, $2, $2)', [CAMPAIGN, USER]);
    await insert();
    expect(await expectReject(insert)).toMatch(/duplicate key|unique/i);
    await db.query('delete from campaigns where id = $1', [CAMPAIGN]);
    expect((await db.query<{ n: number }>('select count(*)::int as n from campaign_targets')).rows[0]!.n).toBe(0);
  });

  it('records the brand preference as a time on the application, empty by default', async () => {
    await campaign(db);
    await db.query(`insert into campaign_applications (campaign_id, creator_id, pitch, sns_url) values ($1, $2, 'pitch', 'https://instagram.com/x')`, [CAMPAIGN, USER]);
    const row = (await db.query<{ brand_preferred_at: string | null }>('select brand_preferred_at from campaign_applications')).rows[0]!;
    expect(row.brand_preferred_at).toBeNull();
    await db.query('update campaign_applications set brand_preferred_at = now()');
  });
});

describe('0140 campaign_targets (glue)', () => {
  const core = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');

  it('says on the first line that the cloud needs it applied', () => {
    expect(core.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
    expect(glue.split('\n')[0]).toContain('CLOUD APPLICATION REQUIRED');
  });

  it('closes campaign_targets to browser roles and opens it to service_role only (the 0131 shape)', () => {
    expect(glue).toContain("'campaign_targets'");
    expect(glue).toContain('alter table public.%I enable row level security');
    expect(glue).toContain('alter table public.%I force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).toContain('grant select,insert,update,delete on public.%I to service_role');
    expect(glue).not.toMatch(/create\s+policy/i);
  });

  it('really denies a browser role once applied', async () => {
    const db = await freshDb();
    try {
      await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        grant select on all tables in schema public to anon, authenticated;`);
      await db.exec(glue);
      await db.exec('set role anon;');
      expect(await expectReject(() => db.query('select * from campaign_targets'))).toMatch(/permission denied/i);
      await db.exec('reset role; set role service_role;');
      expect((await db.query('select * from campaign_targets')).rows).toEqual([]);
      await db.exec('reset role;');
    } finally {
      await db.close();
    }
  });
});
