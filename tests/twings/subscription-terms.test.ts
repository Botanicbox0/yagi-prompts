import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readMigration } from '@/lib/db/migrations';
import { makeSingleConnectionRunner } from '@/lib/db/sql-runner';
import { CREATOR_PLAN_VERSIONS } from '@/lib/twings/subscription-versions';
import { loadCreatorSubscriptionTerms } from '@/lib/twings/subscription-terms';

describe('creator price and agreement archive (Postgres)', () => {
  const db = new PGlite();
  const user = '10000000-0000-4000-8000-000000000001';
  const agreement = '20000000-0000-4000-8000-000000000001';
  const sql = makeSingleConnectionRunner(async <T>(text: string, params: unknown[] = []) => ({ rows: (await db.query<T>(text, params)).rows }));
  beforeAll(async () => {
    await db.exec(`create table profiles (id uuid primary key); insert into profiles values ('${user}');`);
    await db.exec(readMigration('0042_core_creator_plan_versions.sql'));
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
    await db.exec(readMigration('0127_glue_creator_plan_versions.sql'));
  });
  afterAll(() => db.close());

  it('archives all historic prices with the same immutable contract as the UI catalog', async () => {
    const rows = await db.query<{ snapshot: unknown }>('select snapshot from creator_plan_versions order by version_id');
    expect(rows.rows.map(r => r.snapshot)).toEqual([...CREATOR_PLAN_VERSIONS].sort((a,b) => a.id.localeCompare(b.id)));
    await expect(db.query("update creator_plan_versions set snapshot = '{}' where version_id = 'creator-2026-10-07-v1'")).rejects.toThrow();
    await expect(db.query("delete from creator_plan_versions where version_id = 'creator-2026-10-07-v1'")).rejects.toThrow();
  });

  it('reads the agreed historical price and fails closed for another user or unknown agreement', async () => {
    await db.query(`insert into creator_subscription_terms (id,user_id,plan_version_id,legal_version,consent_reference,agreed_at)
      values ($1,$2,'creator-2026-10-07-v1','test-terms-v1','test-consent-1','2026-10-07T00:00:00Z')`, [agreement,user]);
    const terms = await loadCreatorSubscriptionTerms(sql, user, agreement);
    expect(terms?.plan).toMatchObject({ priceKrw: 19000, monthlyCredits: 400 });
    expect(await loadCreatorSubscriptionTerms(sql, '10000000-0000-4000-8000-000000000002', agreement)).toBeNull();
    expect(await loadCreatorSubscriptionTerms(sql, user, '20000000-0000-4000-8000-000000000002')).toBeNull();
    await expect(db.query('update creator_subscription_terms set plan_version_id=$1 where id=$2', ['advanced-2026-10-08-v1',agreement])).rejects.toThrow();
  });

  it('denies browsers all access and denies service-role rewriting/deleting the archive', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const result = await db.query<{ can_update:boolean; can_delete:boolean; can_insert:boolean; can_select:boolean }>(
        `select has_table_privilege($1,'creator_plan_versions','UPDATE') can_update,
        has_table_privilege($1,'creator_plan_versions','DELETE') can_delete,
        has_table_privilege($1,'creator_plan_versions','INSERT') can_insert,
        has_table_privilege($1,'creator_subscription_terms','SELECT') can_select`,[role]);
      expect(result.rows[0]).toEqual({can_update:false,can_delete:false,can_insert:false,can_select:role==='service_role'});
    }
  });
});
