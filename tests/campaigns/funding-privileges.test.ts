import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { freshDb } from '@/tests/helpers/pglite';

it('removes inherited destructive service privileges from all campaign funding tables', async () => {
  const db = await freshDb();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    const tables = ['campaign_funding_cases', 'campaign_funding_quotes', 'campaign_funding_payments', 'campaign_funding_events', 'campaign_funding_reward_proposals'];
    for (const table of tables) await db.exec(`grant all on public.${table} to service_role`);
    await db.exec(await readFile(new URL('../../supabase/migrations/0134_glue_campaign_funding.sql', import.meta.url), 'utf8'));
    for (const table of tables) {
      const { rows } = await db.query<{ can_read: boolean; can_insert: boolean; can_delete: boolean; can_truncate: boolean; browser_read: boolean }>(
        `select has_table_privilege('service_role',$1,'SELECT') can_read,
          has_table_privilege('service_role',$1,'INSERT') can_insert,
          has_table_privilege('service_role',$1,'DELETE') can_delete,
          has_table_privilege('service_role',$1,'TRUNCATE') can_truncate,
          has_table_privilege('authenticated',$1,'SELECT') browser_read`, [table]);
      expect(rows[0], table).toEqual({ can_read: true, can_insert: true, can_delete: false, can_truncate: false, browser_read: false });
    }
  } finally {
    await db.close();
  }
});
