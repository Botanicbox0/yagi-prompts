import 'dotenv/config';
import { Client } from 'pg';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { getStorage, type StorageDriver } from '@/lib/storage';
import { seed } from './seed';

/**
 * `npm run seed` — runs the fixture seed against a real Postgres.
 *
 *   DATABASE_URL=postgresql://...   required (Supabase → Project settings → Database → URI)
 *   STORAGE_DRIVER=local|supabase   defaults to local (.storage/)
 *   SEED_CREATE_AUTH_USERS=1        only for self-hosted/dev databases where you own auth.users.
 *                                   On Supabase, create the three fixture users with the Auth
 *                                   admin API first — see docs/SETUP.md.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required. See docs/SETUP.md.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  let storage: StorageDriver;
  try {
    storage = await getStorage();
  } catch {
    storage = createLocalStorageDriver();
  }

  try {
    const result = await seed({
      sql: {
        async query(text, params = []) {
          const res = await client.query(text, params as unknown[]);
          return { rows: res.rows };
        },
      },
      storage,
      createAuthUsers: process.env.SEED_CREATE_AUTH_USERS === '1',
      log: (m) => console.log(m),
    });
    console.log(`seeded ${result.playbooks.length} playbook(s), 3 entitlement fixtures`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
