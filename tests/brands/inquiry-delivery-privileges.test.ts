import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';

describe('inquiry delivery privileges under Supabase defaults', () => {
  it('removes inherited default table grants before granting only server SELECT, INSERT and UPDATE', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        create table brand_inquiries (id uuid primary key);
      `);
      await db.exec(readMigration('0041_core_brand_inquiry_delivery.sql'));
      await db.exec(readMigration('0125_glue_brand_inquiry_delivery_rls.sql'));
      const allowed = async (role: string, privilege: string) => (await db.query<{ allowed: boolean }>(
        "select has_table_privilege($1, 'public.brand_inquiry_deliveries', $2) as allowed", [role, privilege],
      )).rows[0]!.allowed;
      // The production finding: granting three privileges did not revoke the defaults.
      expect(await allowed('service_role', 'DELETE')).toBe(true);

      await db.exec(readMigration('0126_glue_brand_inquiry_delivery_least_privilege.sql'));
      // Running the permission repair again is safe.
      await db.exec(readMigration('0126_glue_brand_inquiry_delivery_least_privilege.sql'));

      for (const privilege of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        expect(await allowed('service_role', privilege), privilege).toBe(false);
      }
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
        expect(await allowed('service_role', privilege), privilege).toBe(true);
      }
      for (const role of ['anon', 'authenticated']) {
        expect(await allowed(role, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')).toBe(false);
      }
      const id = '8842d53b-597f-4225-9186-ec974d8c1bc8';
      await db.query('insert into brand_inquiries (id) values ($1)', [id]);
      await db.exec('set role service_role');
      await db.query('insert into brand_inquiry_deliveries (inquiry_id) values ($1)', [id]);
      await db.query("update brand_inquiry_deliveries set status = 'failed' where inquiry_id = $1", [id]);
      expect((await db.query('select status from brand_inquiry_deliveries')).rows).toEqual([{ status: 'failed' }]);
      await expect(db.query('delete from brand_inquiry_deliveries')).rejects.toThrow(/permission denied/);
      await expect(db.query('truncate brand_inquiry_deliveries')).rejects.toThrow(/permission denied/);
    } finally { await db.close(); }
  });
});
