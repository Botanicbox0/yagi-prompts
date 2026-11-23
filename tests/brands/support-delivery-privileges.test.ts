import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';

describe('support delivery & consumer concierge privileges under Supabase defaults', () => {
  it('removes inherited default table grants before granting least-privilege server access', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        create table brand_organizations (id uuid primary key);
        create table profiles (id uuid primary key);
      `);
      await db.exec(readMigration('0178_core_support_delivery.sql'));
      await db.exec(readMigration('0179_glue_support_delivery.sql'));
      // Running glue migration a second time is safe.
      await db.exec(readMigration('0179_glue_support_delivery.sql'));

      const allowed = async (table: string, role: string, privilege: string) =>
        (
          await db.query<{ allowed: boolean }>(
            `select has_table_privilege($1, $2, $3) as allowed`,
            [role, `public.${table}`, privilege],
          )
        ).rows[0]!.allowed;

      const allowedCol = async (table: string, role: string, col: string, privilege: string) =>
        (
          await db.query<{ allowed: boolean }>(
            `select has_column_privilege($1, $2, $3, $4) as allowed`,
            [role, `public.${table}`, col, privilege],
          )
        ).rows[0]!.allowed;

      for (const privilege of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        expect(await allowed('team_notice_deliveries', 'service_role', privilege), `outbox:${privilege}`).toBe(false);
      }
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
        expect(await allowed('team_notice_deliveries', 'service_role', privilege), `outbox:${privilege}`).toBe(true);
      }

      // F5: only column-level UPDATE on `transcript` (retention purge), never full table or body/user_id update.
      for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        expect(await allowed('consumer_support_messages', 'service_role', privilege), `consumer:${privilege}`).toBe(
          false,
        );
      }
      expect(await allowedCol('consumer_support_messages', 'service_role', 'transcript', 'UPDATE')).toBe(true);
      expect(await allowedCol('consumer_support_messages', 'service_role', 'body', 'UPDATE')).toBe(false);
      for (const privilege of ['SELECT', 'INSERT']) {
        expect(await allowed('consumer_support_messages', 'service_role', privilege), `consumer:${privilege}`).toBe(
          true,
        );
      }

      // F13: synced Slack reply ledger least-privilege grants
      for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        expect(await allowed('support_synced_replies', 'service_role', privilege), `synced:${privilege}`).toBe(false);
      }
      for (const privilege of ['SELECT', 'INSERT']) {
        expect(await allowed('support_synced_replies', 'service_role', privilege), `synced:${privilege}`).toBe(true);
      }

      for (const table of ['team_notice_deliveries', 'consumer_support_messages', 'support_synced_replies']) {
        for (const role of ['anon', 'authenticated']) {
          expect(
            await allowed(table, role, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
            `${table}:${role}`,
          ).toBe(false);
        }
      }

      const userId = '11111111-1111-4111-8111-111111111111';
      const sourceId = '22222222-2222-4222-8222-222222222222';
      const reqId = '33333333-3333-4333-8333-333333333333';
      await db.query('insert into profiles (id) values ($1)', [userId]);

      await db.exec('set role service_role');
      await db.query(
        `insert into team_notice_deliveries (kind, source_table, source_id, actor_user_id, preview)
         values ('concierge_escalation', 'consumer_support_messages', $1, $2, 'hello')`,
        [sourceId, userId],
      );
      await db.query(
        `update team_notice_deliveries set status = 'failed', last_error_code = 'http_500' where source_id = $1`,
        [sourceId],
      );
      expect((await db.query('select status from team_notice_deliveries')).rows).toEqual([{ status: 'failed' }]);
      await expect(db.query('delete from team_notice_deliveries')).rejects.toThrow(/permission denied/);
      await expect(db.query('truncate team_notice_deliveries')).rejects.toThrow(/permission denied/);

      await db.query(
        `insert into consumer_support_messages (user_id, author_role, created_by, request_id, body, transcript)
         values ($1, 'customer', $1, $2, 'Need help', '[{"role":"user","text":"excerpt"}]'::jsonb)`,
        [userId, reqId],
      );
      expect((await db.query('select body from consumer_support_messages')).rows).toEqual([{ body: 'Need help' }]);
      await db.query("update consumer_support_messages set transcript = '[]'::jsonb where user_id = $1", [userId]);
      expect((await db.query('select transcript from consumer_support_messages')).rows).toEqual([{ transcript: [] }]);
      await expect(db.query("update consumer_support_messages set body = 'tampered'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query('delete from consumer_support_messages')).rejects.toThrow(/permission denied/);

      await db.query(
        `insert into support_synced_replies (message_id, slack_channel, slack_ts)
         values ($1, 'C0123456789', '1795000000.000100')`,
        [reqId],
      );
      await expect(db.query('delete from support_synced_replies')).rejects.toThrow(/permission denied/);
    } finally {
      await db.close();
    }
  });
});
