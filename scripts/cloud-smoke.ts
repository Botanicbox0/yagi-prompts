import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { createSupabaseStorageDriver } from '@/lib/storage/supabase-driver';
import { createServiceClient } from '@/lib/supabase/service-client';
import { RUNTIME_MODE_ENV, describeRuntimeSelection } from '@/lib/runtime-mode';
import { STAGING_BUCKET } from '@/lib/storage';

/**
 * `npm run cloud:smoke` — does the LIVE project actually answer the way M0–M6 assumed?
 *
 * Every acceptance run so far has been hermetic: PGlite for the database, `.storage/` for the
 * bytes. That proves the code and says nothing about the cloud — buckets that were never created,
 * a glue migration that never ran, storage RLS that denies the service role, a `copy` that rejects
 * a cross-bucket destination. This is the smallest script that catches each of those, with the
 * smallest possible footprint:
 *
 *   · READ-ONLY against the database. The only write is one probe object in the private `content`
 *     STAGING bucket, deleted on the way out. **Published buckets are never touched** — write-once
 *     is a security property (§6), and a smoke test is not a reason to bend it.
 *   · never prints a secret. Keys are read, used as headers, and never logged; URLs are printed
 *     without their query strings.
 *   · a check it cannot run is SKIP, never PASS. Missing credentials make the run INCOMPLETE and
 *     the exit code non-zero — a ship gate that quietly passes on an unset key is worse than none.
 */

// `.env.local` first (that is where this repo keeps real credentials), `.env` as the fallback.
// `override` stays false, so an explicit shell variable still wins.
loadEnv({ path: ['.env.local', '.env'], quiet: true });
process.env[RUNTIME_MODE_ENV] = 'cloud';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

type State = 'pass' | 'fail' | 'skip';

interface Row {
  group: string;
  check: string;
  state: State;
  detail: string;
}

const rows: Row[] = [];

function record(group: string, check: string, state: State, detail = ''): void {
  rows.push({ group, check, state, detail });
}

function expect(group: string, check: string, pass: boolean, detail = ''): void {
  record(group, check, pass ? 'pass' : 'fail', detail);
}

function fail(group: string, check: string, err: unknown): void {
  record(group, check, 'fail', err instanceof Error ? err.message : String(err));
}

/** A signed URL carries a token in the query string — never let one reach the console. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?…' : ''}`;
  } catch {
    return '(unparseable url)';
  }
}

// ---------------------------------------------------------------------------
// 1. database
// ---------------------------------------------------------------------------

async function smokeDatabase(url: string, anonKey: string, hasServiceKey: boolean): Promise<void> {
  const group = 'db';
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    record(group, 'DATABASE_URL present', 'fail', 'unset — cannot reach Postgres directly');
  } else {
    const client = new Client({ connectionString });
    try {
      await client.connect();

      const alive = await client.query('select 1 as ok');
      expect(group, 'select 1', alive.rows[0]?.ok === 1);

      const tables = await client.query<{ n: string }>(
        `select count(*)::text as n from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      const tableCount = Number(tables.rows[0]?.n ?? 0);
      expect(group, 'public tables', tableCount >= 16, `${tableCount} (expected >= 16)`);

      const items = await client.query<{ n: string }>(
        'select count(*)::text as n from prompt_items',
      );
      record(group, 'prompt_items rows', 'pass', `${items.rows[0]?.n ?? '?'} (informational)`);

      // §14 — the three M9 tables must EXIST on the cloud before the deny-all probe below means
      // anything: a refusal from a table that is not there is not a posture.
      const contests = await client.query<{ n: string }>(
        `select count(*)::text as n from information_schema.tables
          where table_schema = 'public'
            and table_name in ('contests','contest_entries','contest_entry_writes')`,
      );
      expect(group, 'contest tables (0007)', Number(contests.rows[0]?.n ?? 0) === 3, `${contests.rows[0]?.n ?? '?'} of 3`);

      // §15 — the two M10 tables, same reasoning: the deny-all probe below is only a posture if
      // the table it is refused from actually exists.
      const cookies = await client.query<{ n: string }>(
        `select count(*)::text as n from information_schema.tables
          where table_schema = 'public'
            and table_name in ('prompt_unlocks','cookie_ledger','cookie_purchase_events')`,
      );
      expect(group, 'cookie tables (0008)', Number(cookies.rows[0]?.n ?? 0) === 3, `${cookies.rows[0]?.n ?? '?'} of 3`);

      // (M10 review R1, finding 4.) The REST probe below can only see the anon half of the
      // posture, and answers "refused" to both a real deny and a permissive-but-empty table.
      // This asserts the §6 posture ITSELF: RLS enabled AND forced, zero policies, zero grants
      // to either browser role — measured from pg_catalog, not inferred from a status code.
      const posture = await client.query<{ bad: string }>(
        `select count(*)::text as bad
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('prompt_unlocks','cookie_ledger','cookie_purchase_events')
            and (
              not c.relrowsecurity
              or not c.relforcerowsecurity
              or exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname)
              or exists (select 1 from information_schema.role_table_grants g
                          where g.table_schema = 'public' and g.table_name = c.relname
                            and g.grantee in ('anon','authenticated'))
            )`,
      );
      expect(
        group,
        'cookie tables hold the full deny-all posture (0105)',
        Number(posture.rows[0]?.bad ?? 1) === 0,
        `${posture.rows[0]?.bad ?? '?'} table(s) out of posture`,
      );

      // Finding 1's other half, measured as the actual invariant (review R2): the balance column
      // is a CACHE of the ledger sum, so the honest probe is the equation itself — not merely
      // "some signup row exists", which a wrong delta or a duplicate row would slip past.
      const unexplained = await client.query<{ n: string }>(
        `select count(*)::text as n
           from profiles p
          where p.cookie_balance is distinct from coalesce(
            (select sum(l.delta)::int from cookie_ledger l where l.profile_id = p.id), 0)`,
      );
      expect(
        group,
        'every wallet equals its ledger sum',
        Number(unexplained.rows[0]?.n ?? 1) === 0,
        `${unexplained.rows[0]?.n ?? '?'} wallet(s) out of balance`,
      );

      // 0008 backfills by default: whatever profiles exist must already hold a wallet ≥ 0.
      const wallets = await client.query<{ n: string }>(
        `select count(*)::text as n from profiles where cookie_balance is null or cookie_balance < 0`,
      );
      expect(group, 'profiles backfilled to a valid wallet', Number(wallets.rows[0]?.n ?? 0) === 0);

      // The buckets from glue migration 0101 — the half a PGlite run can never assert.
      const buckets = await client.query<{ id: string; public: boolean }>(
        `select id, public from storage.buckets order by id`,
      );
      const found = new Map(buckets.rows.map((r) => [r.id, r.public]));
      for (const [bucket, shouldBePublic] of [
        ['content', false],
        ['public-content', true],
        ['content-published', false],
        ['artifacts-published', false],
      ] as const) {
        expect(
          group,
          `bucket ${bucket}`,
          found.has(bucket) && found.get(bucket) === shouldBePublic,
          found.has(bucket) ? `public=${found.get(bucket)}` : 'MISSING',
        );
      }

      // 0100/0103: the RPCs are reachable by the app's role and by nobody else.
      const grants = await client.query<{ svc: boolean; anon: boolean; auth: boolean }>(
        `select has_function_privilege('service_role', 'prepare_publish(uuid)', 'execute') as svc,
                has_function_privilege('anon',          'prepare_publish(uuid)', 'execute') as anon,
                has_function_privilege('authenticated', 'prepare_publish(uuid)', 'execute') as auth`,
      );
      const grant = grants.rows[0];
      expect(group, 'prepare_publish: service_role may execute', grant?.svc === true);
      expect(
        group,
        'prepare_publish: anon/authenticated may NOT',
        grant?.anon === false && grant?.auth === false,
        `anon=${grant?.anon} authenticated=${grant?.auth}`,
      );

      // The guard itself. Over pg here so it runs without the service key too; when the key IS
      // present the same call is repeated through the service client below, which is the path the
      // app actually uses.
      try {
        await client.query('select prepare_publish($1)', [ZERO_UUID]);
        expect(group, 'prepare_publish guard fires (pg)', false, 'no error raised (unexpected)');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(
          group,
          'prepare_publish guard fires (pg)',
          /revision .* not found/i.test(message),
          message.slice(0, 48),
        );
      }
    } catch (err) {
      fail(group, 'postgres connection', err);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Deny-all RLS, from the OUTSIDE. This is the posture the whole gating doctrine rests on
  // (0100/0102 revoke every privilege from anon), so it is probed with the anon key over the same
  // REST surface a browser would use — not with a query the service role would always win.
  /**
   * Every table a non-admin can cause rows to appear in, plus the two beside them.
   *
   * M9 review, finding 7: `contest_entries` is the first table on the site that stores a personal
   * link (`sns_url`), and a PENDING entry's is visible to nobody but the moderator. PGlite has no
   * anon role, so the only place that posture can be MEASURED rather than asserted from the
   * migration text is here, over the same REST surface a browser would use.
   *
   * M10 §15 adds `prompt_unlocks` (a per-person reading history) and `cookie_ledger` (a
   * per-person spending record) — 0105's deny-all is probed the same way.
   */
  for (const table of [
    'prompt_items',
    'contests',
    'contest_entries',
    'contest_entry_writes',
    'prompt_unlocks',
    'cookie_ledger',
    'cookie_purchase_events',
  ]) {
    try {
      const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      const body = await response.text();
      const denied = !response.ok;
      const emptied = response.ok && body.trim() === '[]';
      expect(
        group,
        `anon REST on ${table} is refused`,
        denied || emptied,
        denied ? `HTTP ${response.status} (permission denied)` : 'HTTP 200 but zero rows',
      );
    } catch (err) {
      fail(group, `anon REST on ${table} is refused`, err);
    }
  }

  if (!hasServiceKey) {
    record(group, 'prepare_publish via service client', 'skip', 'SUPABASE_SERVICE_ROLE_KEY unset');
    return;
  }

  try {
    const { error } = await createServiceClient().rpc('prepare_publish', {
      p_revision_id: ZERO_UUID,
    });
    const message = error?.message ?? '';
    expect(
      group,
      'prepare_publish via service client',
      /revision .* not found/i.test(message),
      message ? message.slice(0, 48) : 'no error returned (unexpected)',
    );
  } catch (err) {
    fail(group, 'prepare_publish via service client', err);
  }
}

// ---------------------------------------------------------------------------
// 2. storage — the M7 driver, against the real buckets
// ---------------------------------------------------------------------------

async function smokeStorage(url: string, hasServiceKey: boolean): Promise<void> {
  const group = 'storage';
  const missingKey = 'smoke-does-not-exist.txt';
  const expectedPublicUrl = `${url}/storage/v1/object/public/public-content/${missingKey}`;

  if (!hasServiceKey) {
    for (const check of [
      'putStaging → content',
      'exists(content, key)',
      'signed URL serves the bytes back',
      'staging probe removed',
      'publicUrl shape (driver)',
    ]) {
      record(group, check, 'skip', 'SUPABASE_SERVICE_ROLE_KEY unset');
    }
  } else {
    const driver = createSupabaseStorageDriver();
    const key = `smoke/${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const payload = `yagi-prompts cloud smoke ${Date.now()}`;
    let uploaded = false;

    try {
      await driver.putStaging(key, new TextEncoder().encode(payload), 'text/plain');
      uploaded = true;
      record(group, 'putStaging → content', 'pass', key);
    } catch (err) {
      fail(group, 'putStaging → content', err);
    }

    if (uploaded) {
      try {
        expect(group, 'exists(content, key)', await driver.exists(STAGING_BUCKET, key));
      } catch (err) {
        fail(group, 'exists(content, key)', err);
      }

      // The gateway only ever signs PUBLISHED buckets, so the driver's typed `signedUrl` cannot
      // take a staging bucket. Same API, same ≤60s window, signed through the service client.
      try {
        const { data, error } = await createServiceClient()
          .storage.from(STAGING_BUCKET)
          .createSignedUrl(key, 60);
        if (error || !data) throw new Error(error?.message ?? 'no signed url returned');

        const fetched = await fetch(data.signedUrl);
        const text = await fetched.text();
        expect(
          group,
          'signed URL serves the bytes back',
          fetched.ok && text === payload,
          `HTTP ${fetched.status}, ${text.length}B, ${redactUrl(data.signedUrl)}`,
        );
      } catch (err) {
        fail(group, 'signed URL serves the bytes back', err);
      }

      // Clean up. Deleting STAGING is legitimate — it is not published content, and the write-once
      // rule protects the published buckets, which this script never writes to at all.
      try {
        const { error } = await createServiceClient().storage.from(STAGING_BUCKET).remove([key]);
        expect(group, 'staging probe removed', !error, error?.message ?? key);
      } catch (err) {
        fail(group, 'staging probe removed', err);
      }
    }

    // The URL the shapers emit for every card, built by the SDK so the two cannot drift.
    const built = driver.publicUrl(missingKey);
    expect(group, 'publicUrl shape (driver)', built === expectedPublicUrl, built);
  }

  // Needs no credential at all: a key that does not exist is the right probe for "is the public
  // endpoint live on this host" — a wrong host would not resolve, a missing bucket would 404 the
  // bucket rather than the object.
  try {
    const head = await fetch(expectedPublicUrl, { method: 'HEAD' });
    expect(
      group,
      'public-content endpoint resolves',
      head.status === 400 || head.status === 404,
      `HTTP ${head.status} on a missing key`,
    );
  } catch (err) {
    fail(group, 'public-content endpoint resolves', err);
  }
}

// ---------------------------------------------------------------------------
// 3. auth configuration (informational — Google is being wired in parallel)
// ---------------------------------------------------------------------------

async function smokeAuth(url: string, anonKey: string): Promise<void> {
  const group = 'auth';
  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!response.ok) {
      record(group, 'settings reachable', 'fail', `HTTP ${response.status}`);
      return;
    }
    const settings = (await response.json()) as {
      external?: Record<string, boolean>;
      disable_signup?: boolean;
    };
    record(group, 'settings reachable', 'pass', 'HTTP 200');
    // INFORMATIONAL, never a failure: Google may not be configured yet, and that blocks launch,
    // not this script.
    record(
      group,
      'google provider enabled',
      'pass',
      `${settings.external?.google === true} (informational)`,
    );
    record(
      group,
      'signup enabled',
      'pass',
      `${settings.disable_signup !== true} (informational)`,
    );
  } catch (err) {
    fail(group, 'settings reachable', err);
  }
}

// ---------------------------------------------------------------------------

function printTable(): { failed: number; skipped: number } {
  const groupWidth = Math.max(5, ...rows.map((r) => r.group.length));
  const checkWidth = Math.max(5, ...rows.map((r) => r.check.length));
  const line = (a: string, b: string, c: string, d: string) =>
    `  ${a.padEnd(6)}${b.padEnd(groupWidth + 2)}${c.padEnd(checkWidth + 2)}${d}`;

  console.log('');
  console.log(line('', 'GROUP', 'CHECK', 'DETAIL'));
  console.log(`  ${'-'.repeat(8 + groupWidth + checkWidth + 26)}`);
  for (const row of rows) {
    console.log(line(row.state.toUpperCase(), row.group, row.check, row.detail));
  }

  const failed = rows.filter((r) => r.state === 'fail').length;
  const skipped = rows.filter((r) => r.state === 'skip').length;
  const passed = rows.length - failed - skipped;

  console.log('');
  const verdict =
    failed > 0 ? 'CLOUD SMOKE FAILED' : skipped > 0 ? 'CLOUD SMOKE INCOMPLETE' : 'CLOUD SMOKE PASSED';
  console.log(`${verdict} — ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped > 0) {
    console.log('Skipped checks need SUPABASE_SERVICE_ROLE_KEY in .env.local (see docs/SETUP.md).');
  }
  return { failed, skipped };
}

async function main(): Promise<void> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !anonKey) {
    console.error(
      'cloud smoke cannot run: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are ' +
        'required. See docs/SETUP.md.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`YAGI PROMPTS cloud smoke → ${new URL(url).host}`);
  console.log(`runtime: ${describeRuntimeSelection()}`);

  await smokeDatabase(url, anonKey, hasServiceKey);
  await smokeStorage(url, hasServiceKey);
  await smokeAuth(url, anonKey);

  const { failed, skipped } = printTable();
  process.exitCode = failed === 0 && skipped === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
