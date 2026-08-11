import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { FIXTURE_SENTINELS } from './fixtures';

/**
 * `npm run sweep:anon` — PLAN §8 M2, the authz sweep, run against a REAL server.
 *
 * "zero gated bytes or storage keys for anon" is the acceptance criterion, and the only honest way
 * to check it is over HTTP against `next start`: the shaper can be unit-tested into the ground and
 * still leak through a Flight payload, a metadata tag or a route that forgot its gate.
 *
 * The oracle is the fixture SENTINELS (`scripts/fixtures.ts`): every block carries a unique token
 * inside its own gated content. For an anonymous reader we assert, on the real HTML:
 *   · every token from a block ABOVE the anon tier is absent
 *   · every token from a block AT the anon tier is present   ← the positive control that keeps the
 *     assertion honest; without it, an empty page would "pass"
 *   · no staging key and no PRIVATE published key appears anywhere
 *
 * Session tiers (free/pro/admin) are NOT swept here: there is no Supabase project yet (§11), so a
 * real session cannot be minted and faking one would mean shipping a backdoor. Those tiers are
 * covered by the façade matrix on PGlite (tests/content/facade.test.ts) — see docs/SETUP.md for
 * the follow-up this leaves open.
 *
 * Usage:  npm run db:local && npm run build && npm start &  →  npm run sweep:anon
 *         SWEEP_BASE_URL=https://preview.example npm run sweep:anon
 */

const BASE = (process.env.SWEEP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SHOWCASE = 'character-sheet-generation';
const NON_SHOWCASE = 'talking-character-clip';
const ARCHIVED = 'voice-identity-setup';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;

function ok(label: string, detail = ''): void {
  checks += 1;
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail: string): void {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label} — ${detail}`);
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) ok(label, String(actual));
  else fail(label, `expected ${String(expected)}, got ${String(actual)}`);
}

function expectOneOf(label: string, actual: number, expected: number[]): void {
  if (expected.includes(actual)) ok(label, String(actual));
  else fail(label, `expected one of [${expected.join(', ')}], got ${actual}`);
}

function expectAbsent(label: string, haystack: string, needle: string): void {
  if (!haystack.includes(needle)) ok(label);
  else fail(label, `"${needle}" is present in the response`);
}

function expectPresent(label: string, haystack: string, needle: string): void {
  if (haystack.includes(needle)) ok(label);
  else fail(label, `"${needle}" is missing from the response`);
}

interface Fetched {
  status: number;
  location: string | null;
  cacheControl: string | null;
  contentType: string | null;
  body: string;
  bytes: Uint8Array;
}

async function get(path: string): Promise<Fetched> {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get('location'),
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
    body: new TextDecoder().decode(bytes),
    bytes,
  };
}

// ---------------------------------------------------------------------------
// what the running server is serving (read from the same snapshot it loaded)
// ---------------------------------------------------------------------------

interface AssetBlockRow {
  id: string;
  kind: string;
  visibility: string;
  slug: string;
  state: string;
  is_current: boolean;
  status: string;
}

async function readSnapshot() {
  const path = resolve(process.env.PLAYBOOK_LOCAL_DB ?? DEFAULT_LOCAL_SNAPSHOT);
  const bytes = await readFile(path);
  const db = new PGlite({ loadDataDir: new Blob([new Uint8Array(bytes)]) });
  await db.waitReady;

  const assets = await db.query<AssetBlockRow>(
    `select b.id, b.kind, coalesce(b.resolved_visibility::text, 'unstamped') as visibility,
            p.slug, r.state, (p.published_revision_id = r.id) as is_current, p.status
       from blocks b
       join steps s on s.id = b.step_id
       join playbook_revisions r on r.id = s.revision_id
       join playbooks p on p.id = r.playbook_id
      where b.content ? 'asset'`,
  );

  const privateKeys = await db.query<{ target_key: string }>(
    `select target_key from publish_assets where target_bucket <> 'public-content'`,
  );

  await db.close();
  return { assets: assets.rows, privateKeys: privateKeys.rows.map((r) => r.target_key) };
}

// ---------------------------------------------------------------------------
// the sweep
// ---------------------------------------------------------------------------

function sentinelsFor(slug: string) {
  const all = FIXTURE_SENTINELS.filter((s) => s.slug === slug);
  return {
    visibleToAnon: all.filter((s) => s.visibility === 'public'),
    gated: all.filter((s) => s.visibility !== 'public'),
  };
}

async function sweepShowcasePage(locale: string, privateKeys: string[]): Promise<void> {
  const path = `/${locale}/p/${SHOWCASE}`;
  console.log(`\n${path} — showcase detail, anonymous`);
  const page = await get(path);

  expectEqual('renders 200', page.status, 200);
  expectEqual('cache-control is private, no-store (§3.4)', page.cacheControl, 'private, no-store');

  const { visibleToAnon, gated } = sentinelsFor(SHOWCASE);

  // positive control first: if these are missing, every absence assertion below is meaningless
  for (const sentinel of visibleToAnon) {
    expectPresent(`public ${sentinel.kind} block is rendered (${sentinel.token})`, page.body, sentinel.token);
  }
  for (const sentinel of gated) {
    expectAbsent(
      `NO ${sentinel.visibility} ${sentinel.kind} bytes (${sentinel.token})`,
      page.body,
      sentinel.token,
    );
  }

  // §5.5 locked render: chrome present, content absent
  expectPresent('locked blocks render the §5.5 panel', page.body, 'data-lock-panel');
  expectPresent('locked blocks keep their chrome', page.body, 'data-locked="true"');
  expectPresent('unlocked blocks still render (control)', page.body, 'data-locked="false"');
  expectPresent('lock counts reach the step index (§5.5)', page.body, 'locked');

  // storage keys
  expectAbsent('no staging keys in the HTML', page.body, 'content/rev/');
  expectAbsent('no private content bucket named', page.body, 'content-published');
  expectAbsent('no artifacts bucket named', page.body, 'artifacts-published');
  let leaked = 0;
  for (const key of privateKeys) if (page.body.includes(key)) leaked += 1;
  if (leaked === 0) ok(`no private published key in the HTML (${privateKeys.length} checked)`);
  else fail('private published keys leaked', `${leaked} of ${privateKeys.length} appear in the HTML`);
}

async function sweepRedirects(): Promise<void> {
  console.log('\nredirects — the login wall');

  const gated = await get(`/en/p/${NON_SHOWCASE}`);
  expectOneOf('non-showcase detail redirects anon', gated.status, [302, 307, 308]);
  if (gated.location?.includes('/auth/signin')) ok('…into Journey A (/auth/signin)', gated.location);
  else fail('non-showcase detail redirect target', `expected /auth/signin, got ${gated.location}`);

  const library = await get('/library');
  expectOneOf('/library redirects anon', library.status, [302, 307, 308]);
  if (library.location && !library.location.includes('/library'))
    ok('…away from the library', library.location);
  else fail('/library redirect target', `unexpected location ${library.location}`);
}

async function sweepNotFound(): Promise<void> {
  console.log('\n404s — draft, archived, unknown');
  expectEqual('archived playbook 404s', (await get(`/en/p/${ARCHIVED}`)).status, 404);
  expectEqual('draft playbook 404s', (await get('/en/p/insta-toon-pipeline')).status, 404);
  expectEqual('unknown slug 404s', (await get('/en/p/no-such-playbook')).status, 404);
}

async function sweepGateway(assets: AssetBlockRow[]): Promise<void> {
  console.log('\n/api/media — full-chain authorization (§3.3)');

  const current = (slug: string, visibility: string) =>
    assets.find((a) => a.slug === slug && a.is_current && a.visibility === visibility);

  const publicAsset = current(SHOWCASE, 'public');
  const freeAsset = current(SHOWCASE, 'free');
  const proAsset = current(SHOWCASE, 'pro');
  const draftBlock = assets.find((a) => a.state === 'draft');
  const supersededBlock = assets.find((a) => a.state === 'superseded');

  if (!publicAsset || !freeAsset || !proAsset || !draftBlock || !supersededBlock) {
    fail('fixture discovery', 'the local snapshot is missing an expected block — re-run npm run db:local');
    return;
  }

  expectEqual('gated (free) block refuses anon with 401', (await get(`/api/media/${freeAsset.id}`)).status, 401);
  expectEqual('gated (pro) block refuses anon with 401', (await get(`/api/media/${proAsset.id}`)).status, 401);
  expectEqual('DRAFT revision block 404s', (await get(`/api/media/${draftBlock.id}`)).status, 404);
  expectEqual('SUPERSEDED revision block 404s', (await get(`/api/media/${supersededBlock.id}`)).status, 404);
  expectEqual('unknown block id 404s', (await get('/api/media/11111111-2222-4333-8444-555555555555')).status, 404);
  expectEqual('non-uuid ref 404s', (await get('/api/media/not-a-uuid')).status, 404);

  const refused = await get(`/api/media/${proAsset.id}`);
  expectEqual('refusals are never cached', refused.cacheControl, 'private, no-store');

  // the authorized path: 302 → token → bytes
  const authorized = await get(`/api/media/${publicAsset.id}`);
  expectEqual('public showcase asset is authorized', authorized.status, 302);
  const location = authorized.location ?? '';
  if (!location.includes('t=')) {
    fail('token redirect', `expected a ?t= capability URL, got ${location}`);
    return;
  }
  ok('…and redirects to a ≤60s token URL');

  const delivered = await get(location);
  expectEqual('the token delivers the bytes', delivered.status, 200);
  expectEqual('…as the declared type', delivered.contentType, 'image/png');
  const isPng =
    delivered.bytes[0] === 0x89 && delivered.bytes[1] === 0x50 && delivered.bytes[2] === 0x4e;
  if (isPng) ok('…and the bytes are the real object');
  else fail('delivered bytes', 'response is not a PNG');
  expectEqual('media bytes are never cached', delivered.cacheControl, 'private, no-store');

  // forged / truncated tokens
  const token = new URL(location, BASE).searchParams.get('t') ?? '';
  const [payload, signature] = token.split('.') as [string, string?];
  const forged = `${payload}.${'a'.repeat((signature ?? 'x').length)}`;
  expectEqual(
    'a forged signature is refused with 403',
    (await get(`${location.split('?')[0]}?t=${encodeURIComponent(forged)}`)).status,
    403,
  );
  expectEqual(
    'a truncated token is refused with 403',
    (await get(`${location.split('?')[0]}?t=abc`)).status,
    403,
  );
  expectEqual(
    'a token replayed against another block is refused with 403',
    (await get(`/api/media/${freeAsset.id}?t=${encodeURIComponent(token)}`)).status,
    403,
  );
}

async function main(): Promise<void> {
  console.log(`PLAYBOOK anon sweep → ${BASE}`);

  const probe = await fetch(`${BASE}/en`, { redirect: 'manual' }).catch(() => null);
  if (probe === null) {
    console.error(`\nno server at ${BASE}. Start one: npm run build && npm start`);
    process.exitCode = 1;
    return;
  }

  const { assets, privateKeys } = await readSnapshot();

  await sweepShowcasePage('en', privateKeys);
  await sweepShowcasePage('ko', privateKeys);
  await sweepRedirects();
  await sweepNotFound();
  await sweepGateway(assets);

  console.log(
    `\n${failures === 0 ? 'SWEEP PASSED' : 'SWEEP FAILED'} — ${checks - failures}/${checks} checks passed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
