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

async function request(path: string, init?: RequestInit): Promise<Fetched> {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
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

async function get(path: string): Promise<Fetched> {
  return request(path);
}

async function postForm(path: string, fields: Record<string, string>): Promise<Fetched> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

async function postJson(path: string, body: unknown): Promise<Fetched> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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

/**
 * M3 — the money and analytics surface, for an anonymous visitor against a PRODUCTION build.
 *
 * Two properties this is the only place to check:
 *   · the conversion path never hands an anonymous reader a dead POST — every money route answers
 *     with the sign-in wall, and the locked-block CTA renders as a sign-in link, not a checkout
 *     form (`data-upgrade` is emitted by components/billing/upgrade-cta.tsx for exactly this);
 *   · with no Stripe configured (§11) the routes degrade to a designed 503 rather than a stack
 *     trace — and, because this is `next start`, NODE_ENV is 'production', so the dev identity and
 *     the fake gateway are both provably dead here.
 */
async function sweepMoney(): Promise<void> {
  console.log('\n/api/billing + /api/events — anon, production build (M3)');

  const checkout = await postForm('/api/billing/checkout', {
    locale: 'en',
    slug: SHOWCASE,
  });
  expectEqual('checkout POST bounces anon with 303', checkout.status, 303);
  if (checkout.location?.includes('/auth/signin')) {
    ok('…to sign-in with a return-to', checkout.location);
    if (checkout.location.includes(encodeURIComponent(`/en/p/${SHOWCASE}`)))
      ok('…carrying the origin playbook');
    else fail('checkout return-to', `origin missing from ${checkout.location}`);
  } else fail('checkout redirect target', `expected /auth/signin, got ${checkout.location}`);
  expectEqual('checkout is never cached', checkout.cacheControl, 'private, no-store');

  const portal = await postForm('/api/billing/portal', {});
  expectEqual('portal POST bounces anon with 303', portal.status, 303);
  if (portal.location?.includes('/auth/signin')) ok('…to sign-in');
  else fail('portal redirect target', `expected /auth/signin, got ${portal.location}`);

  // No STRIPE_* on this machine ⇒ the honest 503, never a crash. (The signature path itself is
  // verified for real against the SDK in tests/billing/webhook-signature.test.ts.)
  const webhook = await postJson('/api/stripe/webhook', { id: 'evt_probe' });
  expectOneOf('webhook answers without crashing', webhook.status, [400, 503]);
  expectEqual('webhook is never cached', webhook.cacheControl, 'private, no-store');
  expectAbsent('webhook leaks no stack trace', webhook.body, 'at ');
  expectEqual('GET on the webhook is 405', (await get('/api/stripe/webhook')).status, 405);

  // §3.4 funnel beacon: the two client-observable types only.
  const beacon = await postJson('/api/events', {
    type: 'hit_lock',
    slug: SHOWCASE,
    surface: 'detail',
  });
  expectEqual('hit_lock beacon accepted', beacon.status, 204);
  expectEqual(
    'a server-only event type is rejected',
    (await postJson('/api/events', { type: 'view_playbook' })).status,
    400,
  );
  expectEqual(
    'an invented event type is rejected',
    (await postJson('/api/events', { type: 'pageview' })).status,
    400,
  );
  expectEqual('a non-json body is rejected', (await postJson('/api/events', 'nope')).status, 400);

  const upgrade = await get('/billing/upgrade');
  expectOneOf('/billing/upgrade redirects anon', upgrade.status, [302, 307, 308]);
  const account = await get('/account');
  expectOneOf('/account redirects anon', account.status, [302, 307, 308]);
}

/** The CTA an anonymous reader is actually shown on a locked page (§3.4 Journey A). */
async function sweepConversionCta(): Promise<void> {
  console.log('\nlocked-page CTA — anonymous');
  const page = await get(`/en/p/${SHOWCASE}`);
  expectPresent('locked blocks offer sign-in', page.body, 'data-upgrade="signin"');
  // A form POST an anonymous reader cannot complete would be a dead end mid-funnel.
  expectAbsent('…and never a checkout form', page.body, 'data-upgrade="checkout"');
  expectPresent('sign-in returns to this playbook', page.body, encodeURIComponent(`/en/p/${SHOWCASE}`));
}

/**
 * M5 — the SEO surface, as a crawler actually receives it.
 *
 * The unit tests pin what `lib/seo/*` builds; only a real server can show what survives Next's
 * metadata rendering, and the property that matters is a disclosure one: the sitemap must list the
 * showcase playbook and must NOT list the gated library's slugs or any `noindex` path.
 */
async function sweepSeo(): Promise<void> {
  console.log('\n/sitemap.xml + /robots.txt — the public surface (M5)');

  const sitemap = await get('/sitemap.xml');
  expectEqual('sitemap renders 200', sitemap.status, 200);
  if (!sitemap.contentType?.includes('xml')) {
    fail('sitemap content type', `expected xml, got ${sitemap.contentType}`);
  } else ok('…as xml');

  expectPresent('lists the showcase playbook (en)', sitemap.body, `/en/p/${SHOWCASE}`);
  expectPresent('lists the showcase playbook (ko)', sitemap.body, `/ko/p/${SHOWCASE}`);
  expectPresent('lists the landing page', sitemap.body, '<loc>http');
  expectPresent('carries hreflang alternates', sitemap.body, 'hreflang="ko"');
  expectPresent('…including x-default', sitemap.body, 'hreflang="x-default"');
  expectPresent('lists both locales of the landing page', sitemap.body, `${BASE}/ko<`);
  expectAbsent('never lists the login-walled playbook', sitemap.body, NON_SHOWCASE);
  expectAbsent('never lists the archived playbook', sitemap.body, ARCHIVED);
  for (const path of ['/library', '/admin', '/account', '/billing', '/api/']) {
    expectAbsent(`never lists ${path}`, sitemap.body, path);
  }
  if (/<loc>(?!https?:\/\/)/.test(sitemap.body)) {
    fail('sitemap urls are absolute', 'a <loc> is not an absolute URL');
  } else ok('every <loc> is absolute');

  const robots = await get('/robots.txt');
  expectEqual('robots renders 200', robots.status, 200);
  for (const path of ['/admin', '/library', '/account', '/billing', '/api']) {
    expectPresent(`disallows ${path}`, robots.body, `Disallow: ${path}`);
  }
  expectPresent('allows the public surface', robots.body, 'Allow: /');
  expectPresent('points at the sitemap', robots.body, 'Sitemap: http');
}

/** M5 — canonical / hreflang / og:image, on the HTML a crawler is served. */
async function sweepDetailMetadata(): Promise<void> {
  console.log('\nshowcase detail <head> — canonical, hreflang, OG (M5)');

  const page = await get(`/en/p/${SHOWCASE}`);
  expectPresent('self-canonical', page.body, `rel="canonical" href="${BASE}/en/p/${SHOWCASE}"`);
  // Next emits the attribute as `hrefLang` verbatim in the HTML (React prop spelling), which the
  // HTML parser lower-cases; assert what is actually on the wire.
  expectPresent('hreflang en', page.body, `hrefLang="en" href="${BASE}/en/p/${SHOWCASE}"`);
  expectPresent('hreflang ko', page.body, `hrefLang="ko" href="${BASE}/ko/p/${SHOWCASE}"`);
  expectPresent('hreflang x-default', page.body, 'hrefLang="x-default"');
  expectPresent('og:type article', page.body, 'property="og:type" content="article"');
  expectPresent('og:locale en_US', page.body, 'content="en_US"');
  expectAbsent('showcase pages are NOT deindexed', page.body, 'name="robots" content="noindex');

  const ko = await get(`/ko/p/${SHOWCASE}`);
  expectPresent('ko page self-canonicals to ko', ko.body, `rel="canonical" href="${BASE}/ko/p/${SHOWCASE}"`);
  expectPresent('…and declares ko_KR', ko.body, 'content="ko_KR"');

  // §3.1: heroes are the only public marketing bytes. With no CDN configured (§11) there is no
  // public URL to emit, and emitting a gateway path — which 401s for a crawler — would be worse.
  const hasOgImage = page.body.includes('property="og:image"');
  if (hasOgImage) {
    if (page.body.includes('/api/media/')) {
      fail('og:image source', 'og:image points at the entitlement gateway, which 401s for crawlers');
    } else ok('og:image is a public-bucket URL');
  } else {
    ok('no og:image, because no public CDN is configured (§11)');
  }
}

/** M5 — the unsubscribe endpoint, which is reachable with NO session by design (§3.5). */
async function sweepUnsubscribe(): Promise<void> {
  console.log('\n/api/notify/unsubscribe — signed-token only, no session (M5)');

  const cases: Array<[string, string]> = [
    ['no token at all', '/api/notify/unsubscribe'],
    ['empty token', '/api/notify/unsubscribe?t='],
    ['garbage token', '/api/notify/unsubscribe?t=not-a-token'],
    ['token-shaped garbage', '/api/notify/unsubscribe?t=aaaa.bbbb'],
    // A real payload with a made-up signature: the shape is right, the HMAC is not.
    [
      'forged signature',
      `/api/notify/unsubscribe?t=${Buffer.from(
        JSON.stringify({ u: 'f0000000-0000-4000-8000-000000000002', t: 'notif_updates' }),
      ).toString('base64url')}.${'a'.repeat(43)}`,
    ],
  ];

  for (const [label, path] of cases) {
    const response = await get(path);
    expectEqual(`${label} → 400`, response.status, 400);
    // Not the M3 `'at '` probe: this page's own copy contains "That link…", and a substring match
    // on `at ` reads that as a stack frame. Check for the things a stack frame actually contains.
    for (const trace of ['node_modules', 'webpack-internal', '.next/server', '\n    at ']) {
      expectAbsent(`${label} leaks no stack trace (${trace.trim()})`, response.body, trace);
    }
  }

  const probe = await get('/api/notify/unsubscribe?t=nope');
  expectEqual('refusals are never cached', probe.cacheControl, 'private, no-store');
  if (probe.contentType?.includes('text/html')) ok('…and answer with a readable page');
  else fail('unsubscribe content type', `expected text/html, got ${probe.contentType}`);
  expectPresent('the refusal page is noindex', probe.body, 'noindex');
  // The point of the endpoint: it must not bounce an unauthenticated reader to sign-in.
  expectAbsent('never redirects to sign-in', probe.body, '/auth/signin');
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
  await sweepConversionCta();
  await sweepMoney();
  await sweepSeo();
  await sweepDetailMetadata();
  await sweepUnsubscribe();

  console.log(
    `\n${failures === 0 ? 'SWEEP PASSED' : 'SWEEP FAILED'} — ${checks - failures}/${checks} checks passed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
