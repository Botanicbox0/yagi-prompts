import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { FIXTURE_SENTINELS } from './fixtures';
import { HIDDEN_PROMPT_SLUGS, PROMPT_SENTINELS } from './prompt-fixtures';
import {
  CONTEST_ENTRY_SENTINELS,
  HIDDEN_CONTEST_SLUGS,
  PUBLISHED_CONTEST_SLUG,
} from './contest-fixtures';
import { RUNTIME_MODE_ENV } from '@/lib/runtime-mode';

/**
 * M7: the sweep's oracle is the LOCAL snapshot (it opens `.pglite/catalog.tar.gz` directly), so the
 * server it points at must be serving that same snapshot. Pinning the mode here does not reach the
 * server process — start that with `npm run start:local` — but it keeps this script's own reads
 * hermetic and states the assumption where a reader will look for it.
 */
process.env[RUNTIME_MODE_ENV] = 'local';

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
 * Usage:  npm run db:local && npm run build:local && npm run start:local &  →  npm run sweep:anon
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

interface PromptProbe {
  id: string;
  slug: string;
  status: string;
  source: string;
  visibility: string;
  featured: boolean;
}

interface ContestProbe {
  id: string;
  slug: string;
  status: string;
}

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

  // §13 — the prompts surface needs ids (the copy endpoint is keyed on them) and statuses.
  const prompts = await db.query<PromptProbe>(
    `select id, slug, status, source, text_visibility::text as visibility, featured
       from prompt_items order by slug`,
  );

  // §14 — the contests surface. The demo contest is a DRAFT by design, so the ids are what let the
  // sweep prove that its poster and its entries are unreachable rather than merely absent.
  const contests = await db.query<ContestProbe>(
    'select id, slug, status from contests order by slug',
  );

  await db.close();
  return {
    assets: assets.rows,
    privateKeys: privateKeys.rows.map((r) => r.target_key),
    prompts: prompts.rows,
    contests: contests.rows,
  };
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

// ---------------------------------------------------------------------------
// §13 — the prompts surface (M6)
// ---------------------------------------------------------------------------

const GATED_PROMPT = 'neon-alley-dolly'; // YAGI, text_visibility = pro
const TEASER_PROMPT = 'static-portrait-window-light'; // YAGI, deliberate public teaser
const COMMUNITY_PROMPT = 'skate-park-golden-hour'; // community, public by definition

const promptToken = (slug: string) => PROMPT_SENTINELS.find((s) => s.slug === slug)!.token;

/** Every sentinel an anonymous reader must NEVER meet: gated YAGI text + both moderation states. */
const FORBIDDEN_PROMPT_SENTINELS = PROMPT_SENTINELS.filter((s) => !s.publicToAnon);

/**
 * The gallery is STATIC and cached, so it is served byte-identically to every tier. That makes it
 * the highest-value sweep target on the site: if a single gated character can reach this document,
 * it reaches everyone at once and stays in a CDN.
 */
async function sweepPromptGallery(locale: string): Promise<void> {
  const path = `/${locale}/prompts`;
  console.log(`\n${path} — the gallery, anonymous`);
  const page = await get(path);

  expectEqual('renders 200', page.status, 200);

  // Positive controls first: without these, every absence below would pass on an empty page.
  expectPresent('YAGI rail header', page.body, locale === 'ko' ? 'YAGI 오리지널' : 'ORIGINAL PROMPTS BY YAGI');
  expectPresent('community rail header', page.body, locale === 'ko' ? '커뮤니티에서' : 'FROM THE COMMUNITY');
  expectPresent('the model chip', page.body, 'SEEDANCE 2.5');
  expectPresent('lock chips on gated cards', page.body, 'data-lock-chip');
  expectPresent('cards are addressable', page.body, `data-prompt-card="${GATED_PROMPT}"`);
  expectPresent('community credit', page.body, '@hana');
  expectPresent('the use-case filter', page.body, 'data-use-case-filter');
  expectPresent('the submit CTA', page.body, '/prompts/submit');

  // The property that matters: no prompt text of ANY kind reaches a card.
  for (const sentinel of PROMPT_SENTINELS) {
    expectAbsent(`NO ${sentinel.status}/${sentinel.visibility} text on a card (${sentinel.token})`, page.body, sentinel.token);
  }
  for (const slug of HIDDEN_PROMPT_SLUGS) {
    expectAbsent(`no ${slug} card at all`, page.body, `data-prompt-card="${slug}"`);
  }
  expectAbsent('no staging keys in the gallery', page.body, 'content/prompt/');
}

async function sweepPromptDetails(locale: string, prompts: PromptProbe[]): Promise<void> {
  console.log(`\n/${locale}/prompts/[slug] — details, anonymous`);
  const gatedRow = prompts.find((p) => p.slug === GATED_PROMPT)!;

  const gated = await get(`/${locale}/prompts/${GATED_PROMPT}`);
  expectEqual('a Pro-gated prompt still renders 200', gated.status, 200);
  expectEqual('…and is never cached (§3.4)', gated.cacheControl, 'private, no-store');
  expectPresent('…with the §5.5 lock panel', gated.body, 'data-lock-panel');
  expectPresent('…and the card surface anyone may see', gated.body, 'data-model-chip');
  expectAbsent('…and NONE of its text', gated.body, promptToken(GATED_PROMPT));
  // Its OWN copy button is gone. The related cards keep theirs — they are a different prompt each,
  // and the endpoint decides per id, so a copy control there is not a claim about this one.
  expectAbsent('…and no copy button for itself', gated.body, `data-copy-prompt="${gatedRow.id}"`);

  const teaser = await get(`/${locale}/prompts/${TEASER_PROMPT}`);
  expectEqual('a public teaser renders 200', teaser.status, 200);
  expectPresent('…with its text (positive control)', teaser.body, promptToken(TEASER_PROMPT));
  expectPresent('…in the monospace block', teaser.body, 'data-prompt-text');
  expectAbsent('…and no lock panel', teaser.body, 'data-lock-panel');

  const community = await get(`/${locale}/prompts/${COMMUNITY_PROMPT}`);
  expectEqual('a community prompt renders 200', community.status, 200);
  expectPresent('…with its text, free to everyone (§13.3-1)', community.body, promptToken(COMMUNITY_PROMPT));

  for (const slug of HIDDEN_PROMPT_SLUGS) {
    expectEqual(`${slug} 404s`, (await get(`/${locale}/prompts/${slug}`)).status, 404);
  }
  expectEqual('an unknown slug 404s', (await get(`/${locale}/prompts/no-such-prompt`)).status, 404);

  // Whatever the page did, the two moderation sentinels are nowhere on the public surface.
  for (const path of [`/${locale}/prompts`, `/${locale}/prompts/${GATED_PROMPT}`, '/sitemap.xml']) {
    const response = await get(path);
    for (const sentinel of FORBIDDEN_PROMPT_SENTINELS) {
      expectAbsent(`${path}: no ${sentinel.token}`, response.body, sentinel.token);
    }
  }
}

/** §13.3-5 — the gate that lets a static gallery offer copy at all. */
async function sweepPromptCopy(prompts: PromptProbe[]): Promise<void> {
  console.log('\n/api/prompts/copy — entitlement, anonymous');

  const bySlug = (slug: string) => prompts.find((p) => p.slug === slug);
  const community = bySlug(COMMUNITY_PROMPT);
  const teaser = bySlug(TEASER_PROMPT);
  const gated = bySlug(GATED_PROMPT);
  const pending = prompts.find((p) => p.status === 'pending');
  const rejected = prompts.find((p) => p.status === 'rejected');

  if (!community || !teaser || !gated || !pending || !rejected) {
    fail('prompt fixture discovery', 'the local snapshot is missing a prompt — re-run npm run db:local');
    return;
  }

  const copy = (id: string) => postJson(`/api/prompts/copy/${id}`, {});

  const open = await copy(community.id);
  expectEqual('a community prompt copies for anon', open.status, 200);
  expectPresent('…and the answer is the real text', open.body, promptToken(COMMUNITY_PROMPT));
  expectEqual('…and is never cached', open.cacheControl, 'private, no-store');

  const teaserCopy = await copy(teaser.id);
  expectEqual('a public YAGI teaser copies for anon', teaserCopy.status, 200);

  const refused = await copy(gated.id);
  expectOneOf('a Pro prompt refuses anon', refused.status, [401, 403]);
  expectAbsent('…with no text in the refusal', refused.body, promptToken(GATED_PROMPT));
  expectPresent('…and a way forward', refused.body, 'sign_in_required');
  expectEqual('…never cached either', refused.cacheControl, 'private, no-store');

  expectEqual('a pending submission 404s', (await copy(pending.id)).status, 404);
  expectEqual('a rejected submission 404s', (await copy(rejected.id)).status, 404);
  expectEqual(
    'an unknown id 404s',
    (await copy('11111111-2222-4333-8444-555555555555')).status,
    404,
  );
  expectEqual('a malformed id 404s rather than 500s', (await copy('not-a-uuid')).status, 404);
  expectEqual('GET is not the copy verb', (await get(`/api/prompts/copy/${community.id}`)).status, 405);
}

/** §13.1 — poster/clip bytes are public marketing surface for PUBLISHED items and nothing else. */
async function sweepPromptMedia(prompts: PromptProbe[]): Promise<void> {
  console.log('\n/api/prompts/media — public bytes, published rows only');

  const gated = prompts.find((p) => p.slug === GATED_PROMPT)!;
  const pending = prompts.find((p) => p.status === 'pending')!;

  const poster = await get(`/api/prompts/media/${encodeURIComponent(`${gated.id}:poster`)}`);
  expectEqual('a published poster is served', poster.status, 200);
  expectEqual('…as the declared type', poster.contentType, 'image/png');
  const isPng = poster.bytes[0] === 0x89 && poster.bytes[1] === 0x50 && poster.bytes[2] === 0x4e;
  if (isPng) ok('…and the bytes are the real object');
  else fail('poster bytes', 'response is not a PNG');

  const clip = await get(`/api/prompts/media/${encodeURIComponent(`${gated.id}:video`)}`);
  expectEqual('a published clip is served', clip.status, 200);
  expectEqual('…as video/mp4', clip.contentType, 'video/mp4');

  // The pending submission's clip exists on disk and is unreachable here: it has no published key.
  expectEqual(
    'a PENDING submission’s clip is unreachable',
    (await get(`/api/prompts/media/${encodeURIComponent(`${pending.id}:video`)}`)).status,
    404,
  );
  expectEqual(
    'an unknown ref 404s',
    (await get('/api/prompts/media/11111111-2222-4333-8444-555555555555%3Aposter')).status,
    404,
  );
  expectEqual('a malformed ref 404s', (await get('/api/prompts/media/nonsense')).status, 404);
  expectEqual('a bad kind 404s', (await get(`/api/prompts/media/${gated.id}%3Aoriginal`)).status, 404);
}

/** §13.2 — the gated halves of the prompts surface, from outside. */
async function sweepPromptGates(): Promise<void> {
  console.log('\n/prompts/submit + /admin/prompts — anonymous');

  const submit = await get('/prompts/submit');
  expectOneOf('/prompts/submit redirects anon', submit.status, [302, 307, 308]);
  if (submit.location && !submit.location.includes('/prompts/submit')) {
    ok('…away from the form', submit.location);
  } else fail('/prompts/submit redirect target', `unexpected location ${submit.location}`);

  const admin = await get('/admin/prompts');
  expectOneOf('/admin/prompts refuses anon', admin.status, [302, 307, 308, 404]);
  expectAbsent('…and leaks no queue', admin.body, 'data-prompt-queue');

  // The gallery is public and must NOT be caught by the app-path gate.
  expectEqual('/en/prompts stays public', (await get('/en/prompts')).status, 200);
  const unprefixed = await get('/prompts');
  expectOneOf('unprefixed /prompts 308s into a locale', unprefixed.status, [307, 308]);
  if (unprefixed.location?.includes('/prompts')) ok('…keeping the path', unprefixed.location);
  else fail('/prompts redirect target', `unexpected location ${unprefixed.location}`);
}

/** §13.2 SEO: the gallery and every published prompt are indexed; moderation states are not. */
async function sweepPromptSeo(): Promise<void> {
  console.log('\nsitemap + <head> — the prompts surface');

  const sitemap = await get('/sitemap.xml');
  expectPresent('lists the gallery (en)', sitemap.body, '/en/prompts<');
  expectPresent('lists the gallery (ko)', sitemap.body, '/ko/prompts<');
  for (const slug of [GATED_PROMPT, TEASER_PROMPT, COMMUNITY_PROMPT]) {
    expectPresent(`lists /en/prompts/${slug}`, sitemap.body, `/en/prompts/${slug}`);
    expectPresent(`lists /ko/prompts/${slug}`, sitemap.body, `/ko/prompts/${slug}`);
  }
  for (const slug of HIDDEN_PROMPT_SLUGS) {
    expectAbsent(`never lists ${slug}`, sitemap.body, slug);
  }
  expectAbsent('never lists the submission form', sitemap.body, '/prompts/submit');

  const robots = await get('/robots.txt');
  expectPresent('robots disallows the submission form', robots.body, 'Disallow: /prompts/submit');

  const detail = await get(`/en/prompts/${GATED_PROMPT}`);
  expectPresent('self-canonical', detail.body, `rel="canonical" href="${BASE}/en/prompts/${GATED_PROMPT}"`);
  expectPresent('hreflang ko', detail.body, `hrefLang="ko" href="${BASE}/ko/prompts/${GATED_PROMPT}"`);
  expectPresent('hreflang x-default', detail.body, 'hrefLang="x-default"');
  // A gated prompt page is still a public page — only the text is gated.
  expectAbsent('a Pro-gated prompt is NOT deindexed', detail.body, 'name="robots" content="noindex');

  const gallery = await get('/en/prompts');
  expectPresent('the gallery self-canonicals', gallery.body, `rel="canonical" href="${BASE}/en/prompts"`);
  expectAbsent('the gallery is indexed', gallery.body, 'name="robots" content="noindex');
}

/** §13.2 — the landing pivot: prompts in the nav, prompt cards in the featured strip. */
async function sweepLandingPivot(): Promise<void> {
  console.log('\n/en — the landing after the pivot');
  const page = await get('/en');

  expectEqual('renders 200', page.status, 200);
  expectPresent('nav points at the gallery', page.body, 'href="/en/prompts"');
  expectPresent('featured strip is prompt cards', page.body, 'data-prompt-card=');
  expectPresent('the model is on the page', page.body, 'SEEDANCE 2.5');
  // PLAYBOOKS_IN_NAV=false: the library keeps working but is not linked from the marketing chrome.
  expectAbsent('the library is denavigated', page.body, 'href="/library"');
  for (const sentinel of PROMPT_SENTINELS) {
    expectAbsent(`no prompt text on the landing (${sentinel.token})`, page.body, sentinel.token);
  }

  expectEqual('/library still works for anyone who has the URL', (await get('/library')).status, 307);
}

// ---------------------------------------------------------------------------
// §14 — the contests surface (M9)
// ---------------------------------------------------------------------------

/** Every entry sentinel an anonymous reader must NEVER meet. */
const FORBIDDEN_ENTRY_SENTINELS = CONTEST_ENTRY_SENTINELS.filter((s) => !s.publicToAnon);

/**
 * The one sentinel that MUST be reachable: an approved entry of the published fixture contest.
 *
 * Without it every absence assertion below would pass on a page that renders no entries at all —
 * the vacuity the M9 review called out. This is the positive control that makes them mean something.
 */
const LIVE_ENTRY_SENTINEL = CONTEST_ENTRY_SENTINELS.find((s) => s.publicToAnon)!;

async function sweepContestsListing(locale: string, contests: ContestProbe[]): Promise<void> {
  const path = `/${locale}/contests`;
  console.log(`\n${path} — the listing, anonymous`);
  const page = await get(path);

  expectEqual('renders 200', page.status, 200);

  // Positive controls: the page is a real page, not an error dressed as one.
  // M9 design review, finding 8: the KO hero is broken where the SENTENCE breaks
  // ("브랜드가 / 브리프를 건넵니다."), not where the English one does.
  expectPresent(
    'the display headline',
    page.body,
    locale === 'ko' ? '브리프를 건넵니다' : 'BRANDS BRING',
  );
  expectPresent('the OPEN rail', page.body, 'data-contest-rail="open"');
  expectPresent(
    'the published contest card',
    page.body,
    `data-contest-card="${PUBLISHED_CONTEST_SLUG}"`,
  );
  expectPresent('…with its phase chip', page.body, 'data-phase-chip="open"');
  expectPresent('…and a server-rendered D-day', page.body, 'data-dday');

  // §14.2 — "Listing carries the B2B CTA ('Run a contest with the studio →' mailto)".
  expectPresent('the B2B CTA strip', page.body, 'data-contest-hire');
  expectPresent('…as a real mailto', page.body, 'mailto:hello@yagiworkshop.xyz');
  expectPresent(
    '…with the studio wording',
    page.body,
    locale === 'ko' ? '스튜디오와 콘테스트 열기' : 'Run a contest with the studio',
  );
  expectPresent('nav points at the tab', page.body, `href="/${locale}/contests"`);

  // The property that matters: a DRAFT contest is nowhere on the public listing.
  for (const contest of contests) {
    if (contest.status === 'published') continue;
    expectAbsent(`no ${contest.slug} card`, page.body, `data-contest-card="${contest.slug}"`);
    expectAbsent(`…and no ${contest.slug} link`, page.body, `/contests/${contest.slug}`);
  }
  // No entry text of ANY status reaches a listing card — the card carries a COUNT, never a row.
  for (const sentinel of CONTEST_ENTRY_SENTINELS) {
    expectAbsent(`no ${sentinel.status} entry text (${sentinel.token})`, page.body, sentinel.token);
  }
  expectAbsent('no staging keys in the listing', page.body, 'content/contest/');
}

/** §14.2 — "published only; draft = admin preview path", checked from outside. */
async function sweepContestDetails(locale: string, contests: ContestProbe[]): Promise<void> {
  console.log(`\n/${locale}/contests/[slug] — details, anonymous`);

  // --- the PUBLISHED contest: the positive control the review asked for ----
  const live = await get(`/${locale}/contests/${PUBLISHED_CONTEST_SLUG}`);
  expectEqual('a published contest renders 200', live.status, 200);
  expectEqual('…and is never cached (§14.2)', live.cacheControl, 'private, no-store');
  expectPresent('…with its prize in display type', live.body, 'data-contest-prize');
  expectPresent('…the phase-aware CTA', live.body, 'data-contest-cta="enter"');
  expectPresent('…and the entries rail', live.body, 'data-contest-entries');
  // The measurement: an APPROVED entry is here…
  expectPresent(
    `…carrying the approved entry (${LIVE_ENTRY_SENTINEL.token})`,
    live.body,
    LIVE_ENTRY_SENTINEL.token,
  );
  expectPresent('…as an addressable card', live.body, 'data-entry-card=');
  expectPresent('…with its SNS credit chip', live.body, 'data-entry-sns=');
  // …and every other moderation state is not, on the very page that proves the rail works.
  for (const sentinel of FORBIDDEN_ENTRY_SENTINELS) {
    expectAbsent(
      `…and NO ${sentinel.status} entry (${sentinel.token})`,
      live.body,
      sentinel.token,
    );
  }
  expectAbsent('…and no staging keys', live.body, 'content/contest/');

  for (const slug of HIDDEN_CONTEST_SLUGS) {
    expectEqual(`draft ${slug} 404s`, (await get(`/${locale}/contests/${slug}`)).status, 404);
  }
  expectEqual(
    'an unknown slug 404s',
    (await get(`/${locale}/contests/no-such-contest`)).status,
    404,
  );

  // The admin preview path is admin surface, so it must refuse an anonymous reader outright.
  for (const slug of HIDDEN_CONTEST_SLUGS) {
    const preview = await get(`/admin/contests/${slug}/preview`);
    expectOneOf(`preview of ${slug} refuses anon`, preview.status, [302, 307, 308, 404]);
    for (const sentinel of FORBIDDEN_ENTRY_SENTINELS) {
      expectAbsent(`…and leaks no entry (${sentinel.token})`, preview.body, sentinel.token);
    }
  }

  // A draft's poster exists on disk (staged) and has no published key, so the public media route
  // must refuse it — that is the disclosure doctrine holding for an unannounced prize.
  const draft = contests.find((c) => c.status !== 'published');
  if (draft) {
    expectEqual(
      'a DRAFT contest’s poster is unreachable',
      (await get(`/api/contests/media/${encodeURIComponent(`${draft.id}:poster`)}`)).status,
      404,
    );
  }

  const published = contests.find((c) => c.status === 'published');
  if (published) {
    const poster = await get(`/api/contests/media/${encodeURIComponent(`${published.id}:poster`)}`);
    expectEqual('a PUBLISHED contest’s poster is served', poster.status, 200);
    expectEqual('…as the declared type', poster.contentType, 'image/png');
    const isPng = poster.bytes[0] === 0x89 && poster.bytes[1] === 0x50 && poster.bytes[2] === 0x4e;
    if (isPng) ok('…and the bytes are the real object');
    else fail('poster bytes', 'response is not a PNG');
    /**
     * M9 review, finding 3 — the `{id}:{kind}` alias is a MUTABLE pointer, so it must never be
     * cached immutably: unpublishing a contest has to stop serving its poster immediately rather
     * than a day later. The immutable thing is the content-addressed object it points at.
     */
    if (poster.cacheControl?.includes('immutable')) {
      fail('alias cache', `mutable alias served as immutable: ${poster.cacheControl}`);
    } else ok('…and the mutable alias is not cached immutably', poster.cacheControl ?? '(none)');
  }
  expectEqual(
    'an unknown media ref 404s',
    (await get('/api/contests/media/11111111-2222-4333-8444-555555555555%3Aposter')).status,
    404,
  );
  expectEqual('a malformed media ref 404s', (await get('/api/contests/media/nonsense')).status, 404);
}

/** §14.2 — the gated halves of the contests surface, from outside. */
async function sweepContestGates(contests: ContestProbe[]): Promise<void> {
  console.log('\n/contests/[slug]/submit + /admin/contests — anonymous');

  // The PUBLISHED contest, so the redirect proves the login gate rather than a 404.
  const slug = PUBLISHED_CONTEST_SLUG;
  const submit = await get(`/contests/${slug}/submit`);
  expectOneOf('the entry form redirects anon', submit.status, [302, 307, 308]);
  if (submit.location && !submit.location.startsWith(`/contests/${slug}/submit`)) {
    ok('…away from the form', submit.location);
  } else fail('entry form redirect target', `unexpected location ${submit.location}`);

  const admin = await get('/admin/contests');
  expectOneOf('/admin/contests refuses anon', admin.status, [302, 307, 308, 404]);
  expectAbsent('…and leaks no queue', admin.body, 'data-contest-entry=');
  for (const sentinel of FORBIDDEN_ENTRY_SENTINELS) {
    expectAbsent(`…and no entry text (${sentinel.token})`, admin.body, sentinel.token);
  }
  for (const contest of contests) {
    expectAbsent(`…and no ${contest.slug} editor`, admin.body, `data-admin-contest="${contest.slug}"`);
  }

  // The listing is public and must NOT be caught by the app-path gate.
  expectEqual('/en/contests stays public', (await get('/en/contests')).status, 200);
  const unprefixed = await get('/contests');
  expectOneOf('unprefixed /contests 308s into a locale', unprefixed.status, [307, 308]);
  if (unprefixed.location?.includes('/contests')) ok('…keeping the path', unprefixed.location);
  else fail('/contests redirect target', `unexpected location ${unprefixed.location}`);
}

/** §14.2 SEO: the listing is indexed; a draft contest and the entry form are not. */
async function sweepContestSeo(): Promise<void> {
  console.log('\nsitemap + <head> — the contests surface');

  const sitemap = await get('/sitemap.xml');
  expectPresent('lists the listing (en)', sitemap.body, '/en/contests<');
  expectPresent('lists the listing (ko)', sitemap.body, '/ko/contests<');
  expectPresent(
    'lists the published contest (en)',
    sitemap.body,
    `/en/contests/${PUBLISHED_CONTEST_SLUG}`,
  );
  expectPresent(
    'lists the published contest (ko)',
    sitemap.body,
    `/ko/contests/${PUBLISHED_CONTEST_SLUG}`,
  );
  for (const slug of HIDDEN_CONTEST_SLUGS) {
    expectAbsent(`never lists the draft ${slug}`, sitemap.body, slug);
  }
  expectAbsent('never lists an entry form', sitemap.body, '/submit');

  const robots = await get('/robots.txt');
  expectPresent('robots disallows the entry form', robots.body, 'Disallow: /contests/*/submit');
  expectAbsent('…without disallowing the listing itself', robots.body, 'Disallow: /contests\n');

  const listing = await get('/en/contests');
  expectPresent('the listing self-canonicals', listing.body, `rel="canonical" href="${BASE}/en/contests"`);
  expectPresent('hreflang ko', listing.body, `hrefLang="ko" href="${BASE}/ko/contests"`);
  expectPresent('hreflang x-default', listing.body, 'hrefLang="x-default"');
  expectAbsent('the listing is indexed', listing.body, 'name="robots" content="noindex');
}

/** §14.2 — Contests joins the nav between Prompts and Pricing, on every marketing page. */
async function sweepContestNav(): Promise<void> {
  console.log('\nnav — Prompts · Contests · Pricing');
  for (const path of ['/en', '/en/prompts', '/en/pricing']) {
    const page = await get(path);
    expectPresent(`${path} links the contests tab`, page.body, 'href="/en/contests"');
  }
  const ko = await get('/ko');
  expectPresent('/ko links the ko tab', ko.body, 'href="/ko/contests"');
}

async function main(): Promise<void> {
  console.log(`YAGI PROMPTS anon sweep → ${BASE} (local mode)`);

  const probe = await fetch(`${BASE}/en`, { redirect: 'manual' }).catch(() => null);
  if (probe === null) {
    console.error(`\nno server at ${BASE}. Start one: npm run build:local && npm run start:local`);
    process.exitCode = 1;
    return;
  }

  const { assets, privateKeys, prompts, contests } = await readSnapshot();

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

  // --- M6 §13: the prompts surface ----------------------------------------
  await sweepPromptGallery('en');
  await sweepPromptGallery('ko');
  await sweepPromptDetails('en', prompts);
  await sweepPromptCopy(prompts);
  await sweepPromptMedia(prompts);
  await sweepPromptGates();
  await sweepPromptSeo();
  await sweepLandingPivot();

  // --- M9 §14: the contests surface ---------------------------------------
  await sweepContestsListing('en', contests);
  await sweepContestsListing('ko', contests);
  await sweepContestDetails('en', contests);
  await sweepContestGates(contests);
  await sweepContestSeo();
  await sweepContestNav();

  console.log(
    `\n${failures === 0 ? 'SWEEP PASSED' : 'SWEEP FAILED'} — ${checks - failures}/${checks} checks passed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
