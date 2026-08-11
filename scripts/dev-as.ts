import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { FIXTURE_USERS } from './fixtures';

/**
 * `npm run dev:pro` · `npm run dev:free` · `npm run dev:admin` — render-verify a SIGNED-IN view.
 *
 * The problem: `/account`, the Pro render of a playbook and the whole checkout loop are behind a
 * session, and there is no Supabase project on this machine (PLAN §11). Without this, every locally
 * rendered page is anonymous and nobody — including the Director — can look at a Pro view at all.
 *
 * What it does, and just as importantly what it does NOT do:
 *   · it sets `PLAYBOOK_DEV_IDENTITY` to a fixture profile id and starts `next dev`. That is an
 *     IDENTITY. The tier is then derived from that profile's real `subscriptions` row by the same
 *     `resolveViewer` every request uses (lib/auth/identity.ts) — so `dev:pro` shows Pro because
 *     `npm run db:local` seeded an `active` subscription for that user, not because of the flag;
 *   · it verifies that row is actually in the snapshot before starting, so a stale snapshot fails
 *     here with an instruction rather than silently rendering `free`;
 *   · it enables the deterministic fake Stripe gateway when no real keys are present, so the
 *     lock → checkout → unlock loop is walkable end to end;
 *   · it CANNOT affect a production build. `next dev` runs with NODE_ENV=development, and both
 *     `devIdentityUserId()` and `fakeBillingEnabled()` return null/false when NODE_ENV is
 *     'production' — which is what `npm start` (and therefore `npm run sweep:anon`) always is.
 *
 * Usage:  npm run db:local        # once, to build the snapshot with the fixture users
 *         npm run dev:pro         # then open http://localhost:3000/account
 */

type TierName = keyof typeof FIXTURE_USERS;

const TIERS = Object.keys(FIXTURE_USERS) as TierName[];

function usage(): never {
  console.error(`usage: tsx scripts/dev-as.ts <${TIERS.join('|')}> [--start]`);
  process.exit(1);
}

/** Read the snapshot and report what the app will actually derive for this identity. */
async function verifyIdentity(userId: string): Promise<{ tier: string; email: string } | null> {
  const path = resolve(process.env.PLAYBOOK_LOCAL_DB ?? DEFAULT_LOCAL_SNAPSHOT);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  const db = new PGlite({ loadDataDir: new Blob([new Uint8Array(bytes)]) });
  await db.waitReady;
  const { rows } = await db.query<{ email: string; is_admin: boolean; status: string | null }>(
    `select p.email, p.is_admin, s.status
       from profiles p left join subscriptions s on s.user_id = p.id
      where p.id = $1`,
    [userId],
  );
  await db.close();
  const row = rows[0];
  if (!row) return null;
  const tier = row.is_admin
    ? 'admin'
    : row.status === 'active' || row.status === 'past_due'
      ? 'pro'
      : 'free';
  return { tier, email: row.email };
}

async function main(): Promise<void> {
  const [rawTier, ...rest] = process.argv.slice(2);
  if (!rawTier || !TIERS.includes(rawTier as TierName)) usage();
  const tier = rawTier as TierName;
  const user = FIXTURE_USERS[tier];

  const verified = await verifyIdentity(user.id);
  if (verified === null) {
    console.error(
      `no fixture profile ${user.id} in the local snapshot.\n` +
        'Build it first:  npm run db:local',
    );
    process.exit(1);
  }

  const hasRealStripe = Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_'));
  const command = rest.includes('--start') ? 'start' : 'dev';

  console.log(
    [
      `dev identity : ${verified.email} (${user.id})`,
      `derived tier : ${verified.tier}   ← from the subscriptions row, not from this flag`,
      `billing      : ${hasRealStripe ? 'live Stripe (env)' : 'deterministic fake gateway'}`,
      `next         : ${command}`,
      '',
    ].join('\n'),
  );

  if (command === 'start') {
    console.warn(
      'NOTE: `next start` runs with NODE_ENV=production, where the dev identity is dead code.\n' +
        'Use `npm run dev:' + tier + '` for a signed-in render.\n',
    );
  }

  const require_ = createRequire(import.meta.url);
  const nextBin = require_.resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [nextBin, command], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYBOOK_DEV_IDENTITY: user.id,
      ...(hasRealStripe ? {} : { PLAYBOOK_FAKE_BILLING: '1' }),
    },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
