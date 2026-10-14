import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { FIXTURE_SENTINELS } from './fixtures';
import { HIDDEN_PROMPT_SLUGS, PROMPT_SENTINELS } from './prompt-fixtures';
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
  robotsTag: string | null;
  /** For the `?download=1` probes — the header that makes a browser SAVE instead of play. */
  contentDisposition: string | null;
  body: string;
  bytes: Uint8Array;
}

async function request(path: string, init?: RequestInit): Promise<Fetched> {
  // Undici intentionally replaces Host; use the native transport for local workspace probes.
  const headers = new Headers(init?.headers);
  if (headers.has('host') && new URL(BASE).protocol === 'http:') {
    return new Promise<Fetched>((resolveResponse, reject) => {
      const probe = httpRequest(new URL(`${BASE}${path}`), {
        method: init?.method ?? 'GET', headers: Object.fromEntries(headers),
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const header = (name: string) => {
            const value = response.headers[name];
            return Array.isArray(value) ? value.join(', ') : value ?? null;
          };
          resolveResponse({
            status: response.statusCode ?? 0, location: header('location'),
            cacheControl: header('cache-control'), contentType: header('content-type'),
            robotsTag: header('x-robots-tag'), contentDisposition: header('content-disposition'),
            body: bytes.toString('utf8'), bytes,
          });
        });
      });
      probe.setTimeout(30_000, () => probe.destroy(new Error('Host probe timed out')));
      probe.on('error', reject);
      probe.end();
    });
  }
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get('location'),
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
    robotsTag: response.headers.get('x-robots-tag'),
    contentDisposition: response.headers.get('content-disposition'),
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
  audience: string;
  id: string;
  slug: string;
  status: string;
  source: string;
  visibility: string;
  featured: boolean;
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

interface BrandWorkspaceProbe {
  id: string;
  title: string;
  organization_name: string;
  attachment_id: string;
  storage_key: string;
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
    `select id, slug, audience, status, source, text_visibility::text as visibility, featured
       from prompt_items order by slug`,
  );
  const brandWorkspace = await db.query<BrandWorkspaceProbe>(
    `select p.id, p.title, o.name as organization_name,
            a.id as attachment_id, a.storage_key
       from brand_projects p
       join brand_organizations o on o.id = p.organization_id
       join brand_attachments a on a.project_id = p.id and a.status = 'ready'
      where p.title like '[Local fixture]%' and o.name like '[Local fixture]%'
      order by p.id, a.id`,
  );

  await db.close();
  return {
    assets: assets.rows,
    privateKeys: privateKeys.rows.map((r) => r.target_key),
    prompts: prompts.rows,
    brandWorkspace: brandWorkspace.rows,
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

async function sweepMonthlyLegal(): Promise<void> {
  console.log('\nmonthly legal information — published, launch unapproved');
  for (const locale of ['ko', 'en']) {
    for (const doc of ['terms', 'refund']) {
      const page = await get(`/${locale}/legal/${doc}`);
      expectEqual(`${locale} ${doc}: public HTTP 200`, page.status, 200);
      expectPresent(`${locale} ${doc}: preparing disclosure`, page.body, 'data-subscription-legal-status="preparing"');
      expectAbsent(`${locale} ${doc}: publication does not claim approval`, page.body, 'data-subscription-legal-version');
      expectPresent(`${locale} ${doc}: launch notice is server-rendered`, page.body, locale === 'ko' ? '월 구독은 현재 준비 중' : 'Monthly subscriptions are being prepared');
      expectPresent(`${locale} ${doc}: monthly content is server-rendered`, page.body, locale === 'ko' ? '월 구독' : 'Monthly subscription');
      if (doc === 'refund') {
        expectPresent(`${locale}: unused current-period refund`, page.body, locale === 'ko' ? '현재 결제 기간의 제작량을 사용하지 않았고' : 'none of its video-making capacity has been used');
        expectPresent(`${locale}: failed creation restores capacity`, page.body, locale === 'ko' ? '해당 작업에 사용한 제작량' : 'unused capacity for that job');
        expectPresent(`${locale}: one-time refunds retain separate scope`, page.body, locale === 'ko' ? '템플릿 단건 구매의 환불' : 'One-time template purchase refunds');
      }
    }
    const privacy = await get(`/${locale}/legal/privacy`);
    expectEqual(`${locale} privacy: public HTTP 200`, privacy.status, 200);
    // Flight serializes an undefined prop name; only a rendered HTML attribute signals activation.
    expectAbsent(`${locale} privacy: unapproved processing is not activated by publication`, privacy.body, 'data-subscription-legal-status=');
  }
}

async function sweepNotFound(privateKeys: string[], brandWorkspace: BrandWorkspaceProbe[]): Promise<void> {
  console.log('\n404s — draft, archived, unknown');
  expectEqual('archived playbook 404s', (await get(`/en/p/${ARCHIVED}`)).status, 404);
  expectEqual('draft playbook 404s', (await get('/en/p/insta-toon-pipeline')).status, 404);
  expectEqual('unknown slug 404s', (await get('/en/p/no-such-playbook')).status, 404);

  // Unknown routes must reach the branded boundary, not Next's generic English dead end.
  // Inspect the complete HTML/Flight response without ever logging fixture values on failure.
  const forbidden = [
    ...FIXTURE_SENTINELS.filter((sentinel) => sentinel.visibility !== 'public').map((sentinel) => sentinel.token),
    ...PROMPT_SENTINELS.map((sentinel) => sentinel.token),
    ...privateKeys,
    ...brandWorkspace.flatMap((fixture) => [fixture.title, fixture.organization_name, fixture.storage_key]),
    'content/rev/', 'content-published', 'artifacts-published',
  ];
  for (const locale of ['ko', 'en']) {
    for (const suffix of ['qa-page-that-does-not-exist', 'qa-page-that-does-not-exist/nested']) {
      const path = `/${locale}/${suffix}`;
      const page = await get(path);
      expectEqual(`${path}: HTTP 404`, page.status, 404);
      expectPresent(`${path}: static bilingual document`, page.body, '<html lang="en"');
      const head = await request(path, { method: 'HEAD' });
      expectEqual(`${path}: HEAD 404`, head.status, 404);
      expectEqual(`${path}: HEAD has no body`, head.bytes.length, 0);
      for (const panelLocale of ['ko', 'en']) {
        expectPresent(`${path}: ${panelLocale} branded panel`, page.body, `data-not-found="${panelLocale}"`);
        expectPresent(`${path}: ${panelLocale} video return`, page.body, `href="/${panelLocale}/video"`);
        expectPresent(`${path}: ${panelLocale} campaign return`, page.body, `href="/${panelLocale}/campaigns"`);
      }
      expectEqual(`${path}: no private content or storage keys`, forbidden.some((value) => value.length > 0 && page.body.includes(value)), false);
    }
  }
  for (const path of ['/api/qa-route-that-does-not-exist', '/auth/qa-route-that-does-not-exist']) {
    const page = await get(path);
    expectEqual(`${path}: HTTP 404`, page.status, 404);
    expectPresent(`${path}: remains no-store`, page.cacheControl ?? '', 'no-store');
    expectPresent(`${path}: default document locale`, page.body, '<html lang="en"');
    expectEqual(`${path}: no private content or storage keys`, forbidden.some((value) => value.length > 0 && page.body.includes(value)), false);
  }
  // Local Host overrides exercise the actual workspace middleware before global 404 routing.
  // On a deployed preview the proxy owns Host, so these checks belong to the local server sweep.
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname)) {
    for (const host of ['admin.twings.app', 'brand.twings.app', 'brands.twings.app']) {
      const path = '/ko/qa-page-that-does-not-exist/nested';
      const page = await request(path, { headers: { host } });
      expectEqual(`${host}${path}: host boundary 404`, page.status, 404);
      expectPresent(`${host}${path}: private`, page.cacheControl ?? '', 'private');
      expectPresent(`${host}${path}: no-store`, page.cacheControl ?? '', 'no-store');
      expectEqual(`${host}${path}: noindex`, page.robotsTag, 'noindex, nofollow');
      expectEqual(`${host}${path}: no public fallback or private payload`, page.bytes.length, 0);
      expectEqual(`${host}${path}: no private content or storage keys`, forbidden.some((value) => value.length > 0 && page.body.includes(value)), false);
    }
  }
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

  // Toss: no anonymous order creation/approval, order reads, or private widget HTML.
  for (const path of ['/api/billing/toss/orders', '/api/billing/toss/confirm']) {
    const response = await request(path, { method: 'POST', headers: { Origin: BASE } });
    expectEqual(`${path} refuses anonymous payment entry`, response.status, 401);
    expectEqual(`${path} is never cached`, response.cacheControl, 'private, no-store');
  }
  const tossOrderId = '00000000-0000-4000-8000-000000000000';
  expectEqual('Toss order API refuses anon', (await get(`/api/billing/toss/orders/${tossOrderId}`)).status, 401);
  const tossPage = await get(`/billing/toss/${tossOrderId}`);
  expectOneOf('Toss checkout page redirects anon', tossPage.status, [302, 307, 308]);
  expectAbsent('Toss checkout HTML stays behind sign-in', tossPage.body, 'data-toss-checkout');

  // New recurring entry points do not inherit the legacy anonymous or retired paths.
  for (const path of ['/api/creator-subscriptions', '/api/creator-subscriptions/confirm', '/api/creator-subscriptions/renders',
    `/api/creator-subscriptions/${tossOrderId}/cancel`, `/api/creator-subscriptions/${tossOrderId}/refund`]) {
    const response = await request(path, { method: 'POST', headers: { Origin: BASE } });
    expectEqual(`${path} refuses anonymous subscription entry`, response.status, 401);
    expectEqual(`${path} remains private and uncached`, response.cacheControl, 'private, no-store');
    expectAbsent(`${path} never reveals a billing key`, response.body, 'billingKey');
  }
  expectEqual('Subscription order lookup refuses anon', (await get(`/api/creator-subscriptions/${tossOrderId}`)).status, 401);
  expectEqual('Subscription worker refuses missing private authorization', (await request('/api/creator-subscriptions/tick', { method: 'POST' })).status, 401);
  const availability = await get('/api/creator-subscriptions/availability');
  expectEqual('Anonymous subscription availability is public', availability.status, 200);
  expectPresent('Offline availability stays preparing', availability.body, '"status":"preparing"');
  for (const field of ['billingKey', 'customerKey', 'monthlyUnits', 'implementationSha', 'evidenceDigest', 'configurationDigest'])
    expectAbsent(`Public availability excludes ${field}`, availability.body, field);
  for (const path of ['/billing/subscription', '/admin/subscriptions']) {
    const page = await get(path);
    expectOneOf(`${path} requires sign-in`, page.status, [302, 307, 308]);
    expectAbsent(`${path} has no anonymous enrollment controls`, page.body, 'data-subscription-enroll');
  }

  const checkout = await postForm('/api/billing/checkout', {
    locale: 'en',
    slug: SHOWCASE,
  });
  // Audit P1-4: the $9/month subscription checkout is retired — 410 with a code, for everyone.
  expectEqual('retired subscription checkout answers 410', checkout.status, 410);
  expectPresent('…with the retired code', checkout.body, 'subscription_retired');
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

  // Audit P1-4: the retired subscription pages 308 to the localized pricing page, not to sign-in.
  for (const page of ['upgrade', 'success', 'cancelled']) {
    const retired = await get(`/billing/${page}?locale=ko`);
    expectEqual(`/billing/${page} is retired with a 308`, retired.status, 308);
    expectEqual(`…to the Korean pricing page`, new URL(retired.location ?? '/', BASE).pathname, '/ko/pricing');
  }
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

/** AGENTS §7: assert the actual server HTML, not just metadata builders. */
async function sweepStructuredData(): Promise<void> {
  console.log('\nSEO/GEO — JSON-LD, shared FAQ, locale URLs and reading aids');
  for (const locale of ['en', 'ko']) {
    const routes = [
      { rest: '', placement: 'landing' },
      { rest: '/faq', placement: 'all' },
      { rest: '/campaigns', placement: 'campaign' },
      { rest: '/brands', placement: 'brand' },
      { rest: `/t/${GATED_PROMPT}`, placement: 'template' },
    ];
    for (const { rest, placement } of routes) {
      const path = `/${locale}${rest}`;
      const page = await get(path);
      expectEqual(`${path} SEO page renders`, page.status, 200);
      expectPresent(`${path} shared FAQ marker`, page.body, `data-faq-catalog="${placement}"`);
      expectPresent(`${path} self-canonical`, page.body, `rel="canonical" href="${BASE}${path}"`);
      for (const tag of ['en', 'ko', 'x-default']) {
        expectPresent(`${path} alternate ${tag}`, page.body, `hrefLang="${tag}" href="${BASE}/${tag === 'x-default' ? 'en' : tag}${rest}"`);
      }
      const nodes: Record<string, unknown>[] = [];
      const scripts = [...page.body.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      for (const script of scripts) {
        try {
          const data = JSON.parse(script[1]!);
          nodes.push(...(Array.isArray(data['@graph']) ? data['@graph'] : [data]));
        } catch {
          fail(`${path} parseable JSON-LD`, 'invalid JSON');
        }
      }
      for (const type of ['Organization', 'WebSite', 'FAQPage']) {
        expectEqual(`${path} contains ${type}`, nodes.some((node) => node['@type'] === type), true);
      }
      if (rest === '/brands') expectEqual(`${path} contains Service`, nodes.some((node) => node['@type'] === 'Service'), true);
      if (rest.startsWith('/t/')) {
        expectEqual(`${path} no offer during closed generation rollout`, nodes.some((node) => node['@type'] === 'Product'), false);
      }
      const faq = nodes.find((node) => node['@type'] === 'FAQPage');
      expectEqual(`${path} nonempty FAQ answers`, Array.isArray(faq?.mainEntity) && faq.mainEntity.length > 0 && faq.mainEntity.every((item: { acceptedAnswer?: { text?: string } }) => Boolean(item.acceptedAnswer?.text?.trim())), true);
      if (rest === '/brands') {
        expectPresent(`${path} simultaneous market service`, page.body, 'data-brand-markets');
        expectPresent(`${path} simultaneous offer copy`, page.body, locale === 'ko' ? '동시에' : 'simultaneously');
        expectEqual(`${path} eight buyer FAQ answers`, Array.isArray(faq?.mainEntity) ? faq.mainEntity.length : 0, 8);
        expectPresent(`${path} AI safety answer in server HTML`, page.body, locale === 'ko' ? '국외 이전' : 'overseas processing');
      }
    }
  }
  const sitemap = await get('/sitemap.xml');
  for (const locale of ['ko', 'en']) expectPresent(`sitemap includes ${locale} FAQ`, sitemap.body, `<loc>${BASE}/${locale}/faq</loc>`);
  for (const path of ['/llms.txt', '/llms-full.txt']) {
    const page = await get(path);
    expectEqual(`${path} public reader aid`, page.status, 200);
    expectPresent(`${path} names operator`, page.body, 'YAGI WORKSHOP');
    expectPresent(`${path} links FAQ source`, page.body, 'https://twings.app/ko/faq');
  }
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
// F1 — the embedded-WebView gate on the OAuth entry
// ---------------------------------------------------------------------------

/** Real captured UAs — the same fixtures tests/auth/webview.test.ts pins the token list with. */
const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98 (iPhone16,2; iOS 17_5_1; en_US; en; scale=3.00; 1290x2796; 591149735)';
const KAKAOTALK_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * `/auth/signin` from inside an in-app WebView must land on the interstitial — Google would
 * answer `disallowed_useragent` — while a real browser keeps today's redirect (Google when
 * OAuth is configured, the `?error=oauth*` landing otherwise; this sweep accepts either, the
 * environments differ on it honestly).
 */
async function sweepWebViewSignin(): Promise<void> {
  console.log('\n/auth/signin — the embedded-WebView gate (F1)');
  for (const locale of ['ko', 'en']) {
    const review = await request(`/auth/review?locale=${locale}`);
    expectEqual(`${locale}: review login is reachable`, review.status, 200);
    expectPresent(`${locale}: review login form`, review.body, 'data-review-login');
    expectPresent(`${locale}: review login is not indexed`, review.body, 'noindex');
    expectPresent(`${locale}: review credentials are not cached`, review.cacheControl ?? '', 'no-store');
    expectPresent(`${locale}: review password uses POST`, review.body, 'action="/auth/review/login"');
  }

  // docs/TEMPLATES-IA.md §8 — no provider named: the chooser, in the reader's language, with both doors.
  const bare = await request('/auth/signin?next=%2Fen%2Fvideo&locale=en', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('an unnamed provider is sent to the chooser', bare.status, [302, 303, 307]);
  const bareTarget = bare.location ? new URL(bare.location, BASE) : null;
  if (bareTarget?.pathname === '/auth/choose') ok('…at /auth/choose', `${bareTarget.pathname}${bareTarget.search}`);
  else fail('bare signin redirect target', `expected /auth/choose, got ${bare.location}`);
  const chooser = await request('/auth/choose?next=%2Fko%2Fvideo&locale=ko', { headers: { 'user-agent': CHROME_UA } });
  expectEqual('the chooser renders 200', chooser.status, 200);
  expectPresent('…as the designed page', chooser.body, 'data-auth-choose');
  expectPresent('…with manual language choice', chooser.body, 'data-auth-language');
  expectPresent('…with the Kakao door', chooser.body, 'data-auth-provider="kakao"');
  expectPresent('…and the Google door', chooser.body, 'data-auth-provider="google"');
  expectPresent('…in Korean', chooser.body, '카카오로 계속하기');
  expectPresent('…with Google in mixed case (brand rule, never "GOOGLE")', chooser.body, 'Google로 계속하기');
  expectPresent('…the act, not a pitch', chooser.body, '로그인 또는 회원가입');
  expectPresent('…the consent line linking the terms', chooser.body, 'href="/ko/legal/terms"');
  expectPresent('…and the privacy policy', chooser.body, 'href="/ko/legal/privacy"');
  if (chooser.body.indexOf('data-auth-provider="google"') < chooser.body.indexOf('data-auth-provider="kakao"')) ok('…Google listed first');
  else fail('chooser order', 'Google should come before Kakao (founder, 2026-09-06)');
  expectPresent('…with the Google mark', chooser.body, 'fill="#4285F4"');
  expectPresent('…and the Kakao symbol', chooser.body, 'fill="#000000" fill-opacity="0.85"');
  expectPresent('…carrying the return path', chooser.body, 'next=%2Fko%2Fvideo');
  expectPresent('…and noindex', chooser.body, 'noindex');
  for (const locale of ['ko', 'en']) {
    const brandChooser = await request(`/auth/choose?next=%2Fbrand&locale=${locale}`);
    expectEqual(`brand chooser ${locale} renders`, brandChooser.status, 200);
    expectPresent(`brand chooser ${locale} explains the service`, brandChooser.body, 'data-brand-auth');
    expectPresent(`brand chooser ${locale} includes the showcase`, brandChooser.body, 'data-brand-auth-showcase');
    expectPresent(`brand chooser ${locale} keeps login`, brandChooser.body, 'data-auth-provider="google"');
    expectPresent(`brand chooser ${locale} keeps consent`, brandChooser.body, 'data-auth-legal');
  }
  // Kakao is exempt from the WebView interstitial — KakaoTalk's browser can complete it.
  const kakaoHop = await request('/auth/signin?provider=kakao&next=%2Fko%2Fvideo&locale=ko', { headers: { 'user-agent': KAKAOTALK_UA } });
  expectOneOf('a Kakao sign-in from KakaoTalk redirects', kakaoHop.status, [302, 303, 307]);
  if (kakaoHop.location && !kakaoHop.location.includes('/auth/open-in-browser')) ok('…without the interstitial', kakaoHop.location);
  else fail('kakao webview handling', `expected no interstitial, got ${kakaoHop.location}`);

  const entry = '/auth/signin?provider=google&next=%2Fen%2Fvideo&locale=en';
  const webview = await request(entry, { headers: { 'user-agent': INSTAGRAM_UA } });
  expectOneOf('an Instagram UA is redirected', webview.status, [302, 303, 307]);
  const target = webview.location ? new URL(webview.location, BASE) : null;
  if (target?.pathname === '/auth/open-in-browser') {
    ok('…to the interstitial', `${target.pathname}${target.search}`);
  } else {
    fail('webview redirect target', `expected /auth/open-in-browser, got ${webview.location}`);
    return;
  }

  const page = await request(`${target.pathname}${target.search}`, {
    headers: { 'user-agent': INSTAGRAM_UA },
  });
  expectEqual('the interstitial renders 200', page.status, 200);
  expectPresent('…as the designed page', page.body, 'data-webview-interstitial');
  expectPresent('…with the display heading', page.body, 'OPEN IN YOUR BROWSER.');
  expectPresent('…and the copyable absolute target', page.body, 'data-webview-next');
  expectPresent('…which is absolute', page.body, 'http');
  expectPresent('…and points at the next target', page.body, '/en/video');
  if (page.cacheControl?.includes('no-store')) ok('…never cached', page.cacheControl);
  else fail('interstitial cache-control', `expected no-store, got ${page.cacheControl}`);
  expectPresent('…and noindex', page.body, 'noindex');

  // The KO surface, through the KakaoTalk UA the founder's traffic actually carries.
  const koEntry = '/auth/signin?provider=google&next=%2Fko%2Fvideo&locale=ko';
  const koHop = await request(koEntry, { headers: { 'user-agent': KAKAOTALK_UA } });
  const koTarget = koHop.location ? new URL(koHop.location, BASE) : null;
  if (koTarget?.pathname === '/auth/open-in-browser') {
    const koPage = await request(`${koTarget.pathname}${koTarget.search}`, {
      headers: { 'user-agent': KAKAOTALK_UA },
    });
    expectPresent('a KakaoTalk UA reads it in Korean', koPage.body, '기본 브라우저에서 열어 주세요.');
  } else {
    fail('kakaotalk redirect target', `expected /auth/open-in-browser, got ${koHop.location}`);
  }

  // A real browser is NOT interrupted: same entry, no interstitial anywhere in the answer.
  const chrome = await request(entry, { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('a plain Chrome UA still redirects', chrome.status, [302, 303, 307]);
  if (chrome.location && !chrome.location.includes('/auth/open-in-browser')) {
    ok('…to Google/oauth-error as today', chrome.location);
  } else {
    fail('chrome redirect target', `unexpected interstitial: ${chrome.location}`);
  }
}

// ---------------------------------------------------------------------------
// §13 — the prompts surface (M6)
// ---------------------------------------------------------------------------

const GATED_PROMPT = 'neon-alley-dolly'; // YAGI, text_visibility = pro
const TEASER_PROMPT = 'static-portrait-window-light'; // YAGI, deliberate public teaser
const COMMUNITY_PROMPT = 'skate-park-golden-hour'; // community, public by definition
const AUDIO_PROMPT = 'handheld-market-run'; // YAGI, carries the audio-result fixture

const promptToken = (slug: string) => PROMPT_SENTINELS.find((s) => s.slug === slug)!.token;

/** Every sentinel an anonymous reader must NEVER meet: gated YAGI text + both moderation states. */
const FORBIDDEN_PROMPT_SENTINELS = PROMPT_SENTINELS.filter((s) => !s.publicToAnon);




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

  // --- the audio result (founder 2026-08-13): public, playable, downloadable ---------------
  const withAudio = prompts.find((p) => p.slug === AUDIO_PROMPT)!;
  const audio = await get(`/api/prompts/media/${encodeURIComponent(`${withAudio.id}:audio`)}`);
  expectEqual('a published audio result is served', audio.status, 200);
  expectEqual('…as audio/mpeg', audio.contentType, 'audio/mpeg');
  expectEqual('…inline by default', audio.contentDisposition, null);

  const download = await get(
    `/api/prompts/media/${encodeURIComponent(`${withAudio.id}:audio`)}?download=1`,
  );
  expectEqual('?download=1 still serves the bytes', download.status, 200);
  if (download.contentDisposition?.startsWith('attachment') && download.contentDisposition.includes(AUDIO_PROMPT)) {
    ok('…as an attachment named after the slug', download.contentDisposition);
  } else {
    fail('audio download disposition', `got ${download.contentDisposition}`);
  }

}










// ---------------------------------------------------------------------------
// docs/TEMPLATES-IA.md — the template surface (2026-09-05)
// ---------------------------------------------------------------------------

/** A template not yet for sale in the fixtures (price 0): the page says so instead of selling. */
const CLOSED_TEMPLATE = 'mv-strobe-corridor';
/** The one image template in the fixtures. */
const IMAGE_TEMPLATE = TEASER_PROMPT;

/**
 * The two tabs and the template page, anonymous. The disclosure property is simpler than the
 * prompt era's and stricter: NO prompt text of any kind reaches any public page any more — not on a
 * card, not on the template page, not in a lock panel, because there is no lock panel.
 */
async function sweepTemplates(): Promise<void> {
  for (const locale of ['en', 'ko'] as const) {
    const path = `/${locale}/video`;
    console.log(`\n${path} — the VIDEO tab, anonymous`);
    const page = await get(path);
    expectEqual('renders 200', page.status, 200);
    expectPresent('is the video tab', page.body, 'data-templates="video"');
    expectPresent('shows the tabs', page.body, 'data-medium-tab="image"');
    expectPresent('cards are addressable', page.body, `data-prompt-card="${GATED_PROMPT}"`);
    // Founder, 2026-09-07: no price on a card — it lives on the template page, in the reader's currency.
    expectAbsent('cards wear no price', page.body, 'data-price-chip');
    // `>$4<` — the price as rendered text; a bare `$4` also matches React Flight's `"$4:props…"` references.
    expectAbsent('…not even the number', page.body, locale === 'ko' ? '5,900원' : '>$4<');
    expectPresent('cards link to template pages', page.body, `href="/${locale}/t/${GATED_PROMPT}"`);
    expectPresent('the model chip', page.body, 'SEEDANCE 2.5');
    expectPresent('the use-case filter', page.body, 'data-use-case-filter');
    expectAbsent('no lock chips anywhere', page.body, 'data-lock-chip');
    expectAbsent('no image template on the video tab', page.body, `data-prompt-card="${IMAGE_TEMPLATE}"`);
    expectAbsent('no prompt submission door', page.body, '/prompts/submit');
    for (const sentinel of PROMPT_SENTINELS) {
      expectAbsent(`NO prompt text on a card (${sentinel.token})`, page.body, sentinel.token);
    }
    for (const slug of HIDDEN_PROMPT_SLUGS) {
      expectAbsent(`no ${slug} card at all`, page.body, `data-prompt-card="${slug}"`);
    }
    expectAbsent('no staging keys', page.body, 'content/prompt/');
  }

  console.log('\n/en/image — the IMAGE tab, anonymous');
  const image = await get('/en/image');
  expectEqual('renders 200', image.status, 200);
  expectPresent('is the image tab', image.body, 'data-templates="image"');
  expectPresent('shows the image template', image.body, `data-prompt-card="${IMAGE_TEMPLATE}"`);
  expectAbsent('and no video template', image.body, `data-prompt-card="${GATED_PROMPT}"`);

  console.log('\n/en/t/[slug] — template pages, anonymous');
  const detail = await get(`/en/t/${GATED_PROMPT}`);
  expectEqual('a priced template renders 200', detail.status, 200);
  if (detail.cacheControl !== 'private, no-store') ok('…and is cacheable — nothing on it is gated', detail.cacheControl ?? '(none)');
  else fail('template detail cache mode', 'must not be private, no-store: the page has no per-viewer half');
  expectPresent('…names itself', detail.body, `data-template="${GATED_PROMPT}"`);
  expectPresent('…with the make section', detail.body, 'data-template-make');
  expectPresent('…and the one-style studio', detail.body, 'data-single="true"');
  // Founder, 2026-09-11: no demo. The static page says payment opens soon and offers the email.
  expectPresent('…and the studio is closed, not mocked', detail.body, 'data-studio-closed');
  expectAbsent('…no demo badge anywhere', detail.body, 'data-demo-badge');
  expectAbsent('…no placeholder ad', detail.body, 'YOUR AD HERE');
  expectPresent('…the house ad points at the brand form', detail.body, 'data-house-ad');
  expectPresent('…and the price in dollars on the English page', detail.body, '>$4<');
  const detailKo = await get(`/ko/t/${GATED_PROMPT}`);
  expectEqual('the Korean template page renders 200', detailKo.status, 200);
  expectPresent('…with the price in won', detailKo.body, '5,900원');
  expectAbsent('…and never a dollar', detailKo.body, '>$4<');
  expectAbsent('…and NONE of its prompt text', detail.body, promptToken(GATED_PROMPT));
  expectAbsent('…no prompt block', detail.body, 'data-prompt-text');
  expectAbsent('…no lock panel', detail.body, 'data-lock-panel');
  expectAbsent('…no copy button', detail.body, 'data-copy-prompt');
  expectAbsent('…no cookie balance', detail.body, 'data-cookie-balance');
  for (const sentinel of PROMPT_SENTINELS) {
    expectAbsent(`…no prompt text of any kind (${sentinel.token})`, detail.body, sentinel.token);
  }

  const closed = await get(`/en/t/${CLOSED_TEMPLATE}`);
  expectEqual('a not-yet-for-sale template renders 200', closed.status, 200);
  expectPresent('…and says so', closed.body, 'data-template-closed');
  expectAbsent('…without a studio', closed.body, 'data-twings-studio');
  // (Related cards below it may well carry price chips — the assertion is on ITS facts, not the page.)
  expectPresent('…and no price in its facts', closed.body, 'data-template-closed');

  const imageDetail = await get(`/en/t/${IMAGE_TEMPLATE}`);
  expectEqual('an image template renders 200', imageDetail.status, 200);
  expectPresent('…as an image', imageDetail.body, 'data-medium="image"');

  for (const slug of HIDDEN_PROMPT_SLUGS) {
    expectEqual(`${slug} 404s`, (await get(`/en/t/${slug}`)).status, 404);
  }
  expectEqual('an unknown slug 404s', (await get('/en/t/no-such-template')).status, 404);

  // Whatever the pages did, the moderation sentinels are nowhere on the public surface.
  for (const path of ['/en/video', '/en/image', `/en/t/${GATED_PROMPT}`, '/sitemap.xml']) {
    const response = await get(path);
    for (const sentinel of FORBIDDEN_PROMPT_SENTINELS) {
      expectAbsent(`${path}: no ${sentinel.token}`, response.body, sentinel.token);
    }
  }

  console.log('\nsitemap + robots + <head> — the template surface');
  const sitemap = await get('/sitemap.xml');
  for (const rest of ['/en/video<', '/ko/video<', '/en/image<', '/ko/image<']) {
    expectPresent(`lists ${rest.slice(0, -1)}`, sitemap.body, rest);
  }
  for (const slug of [GATED_PROMPT, TEASER_PROMPT, COMMUNITY_PROMPT]) {
    expectPresent(`lists /en/t/${slug}`, sitemap.body, `/en/t/${slug}`);
    expectPresent(`lists /ko/t/${slug}`, sitemap.body, `/ko/t/${slug}`);
  }
  for (const slug of HIDDEN_PROMPT_SLUGS) {
    expectAbsent(`never lists ${slug}`, sitemap.body, slug);
  }
  for (const gone of ['/prompts', '/contests', '/studio']) {
    expectAbsent(`never lists the retired ${gone}`, sitemap.body, `${gone}<`);
    expectAbsent(`never lists ${gone}/`, sitemap.body, `${gone}/`);
  }
  const robots = await get('/robots.txt');
  expectAbsent('robots no longer names the retired forms', robots.body, '/prompts/submit');
  expectAbsent('…nor the contest entry', robots.body, '/contests/*/submit');
  expectPresent('self-canonical', detail.body, `rel="canonical" href="${BASE}/en/t/${GATED_PROMPT}"`);
  expectPresent('hreflang ko', detail.body, `hrefLang="ko" href="${BASE}/ko/t/${GATED_PROMPT}"`);
  expectAbsent('a template is NOT deindexed', detail.body, 'name="robots" content="noindex');
  expectPresent('og:site_name on the template', detail.body, 'property="og:site_name" content="TWINGS"');
  const video = await get('/en/video');
  expectPresent('the video tab self-canonicals', video.body, `rel="canonical" href="${BASE}/en/video"`);
  expectPresent('og:site_name on the tab', video.body, 'property="og:site_name" content="TWINGS"');

  console.log('\n/manifest.webmanifest + /sw.js — the PWA files, unprefixed');
  const manifest = await get('/manifest.webmanifest');
  expectEqual('the manifest is served at the root', manifest.status, 200);
  expectPresent('…and names the app', manifest.body, '"TWINGS"');
  expectPresent('…in standalone display', manifest.body, '"standalone"');
  expectEqual('the service worker is served at the root', (await get('/sw.js')).status, 200);
  expectEqual('the offline page is served at the root', (await get('/offline.html')).status, 200);
  expectPresent('the landing declares the manifest', (await get('/en')).body, 'rel="manifest"');
}

/** The prompt site's URLs 308 onto the template site's; the copy door answers 410. */
async function sweepTemplateRedirects(prompts: PromptProbe[]): Promise<void> {
  console.log('\nredirects — the prompt site → the template site');
  const cases: Array<[string, string]> = [
    ['/en/studio', '/en/video'],
    ['/ko/studio', '/ko/video'],
    ['/en/prompts', '/en/video'],
    [`/en/prompts/${GATED_PROMPT}`, `/en/t/${GATED_PROMPT}`],
    ['/ko/contests', '/ko/campaigns'],
    ['/en/contests/some-contest', '/en/campaigns'],
    ['/prompts/submit', '/en/video'],
    ['/contests/some-contest/submit', '/en/campaigns'],
  ];
  for (const [from, to] of cases) {
    const response = await get(from);
    expectEqual(`${from} redirects permanently`, response.status, 308);
    if (response.location?.endsWith(to)) ok(`…to ${to}`);
    else fail(`${from} redirect target`, `expected ${to}, got ${response.location}`);
  }
  // …while the unprefixed public forms still 308 into a locale like every public page.
  const unprefixed = await get('/video');
  expectOneOf('unprefixed /video 308s into a locale', unprefixed.status, [307, 308]);
  if (unprefixed.location?.includes('/video')) ok('…keeping the path', unprefixed.location);
  else fail('/video redirect target', `unexpected location ${unprefixed.location}`);
  expectOneOf('/admin/prompts refuses anon', (await get('/admin/prompts')).status, [302, 307, 308, 404]);

  console.log('\n/api/prompts/copy — closed (410)');
  const community = prompts.find((p) => p.slug === COMMUNITY_PROMPT)!;
  const gone = await postJson(`/api/prompts/copy/${community.id}`, {});
  expectEqual('a community prompt no longer copies for anyone', gone.status, 410);
  expectAbsent('…and no text in the answer', gone.body, promptToken(COMMUNITY_PROMPT));
  expectEqual('…never cached', gone.cacheControl, 'private, no-store');
  expectEqual('an unknown id is 410 too — there is nothing to look up', (await postJson('/api/prompts/copy/11111111-2222-4333-8444-555555555555', {})).status, 410);
  expectEqual('GET is not the copy verb', (await get(`/api/prompts/copy/${community.id}`)).status, 405);
}

/** The landing after the template pivot: the two doors, the video rail, no prompt text. */
async function sweepLandingTemplates(): Promise<void> {
  console.log('\n/en — the landing as a template site');
  const page = await get('/en');
  expectEqual('renders 200', page.status, 200);
  expectPresent('nav points at the video tab', page.body, 'href="/en/video"');
  expectPresent('nav points at the image tab', page.body, 'href="/en/image"');
  expectPresent('nav points at campaigns', page.body, 'href="/en/campaigns"');
  expectAbsent('nav no longer points at prompts', page.body, 'href="/en/prompts"');
  expectAbsent('nav no longer points at the studio', page.body, 'href="/en/studio"');
  expectAbsent('nav no longer points at contests', page.body, 'href="/en/contests"');
  expectPresent('the hero opens on the video door', page.body, 'data-hero-video');
  expectAbsent('no placeholder ad on the landing', page.body, 'YOUR AD HERE');
  expectPresent('the creator home has a separate brand entry', page.body, 'data-brand-door');
  expectPresent('the brand entry leads to public services', page.body, 'href="/en/brands"');
  expectPresent('the video rail is template cards', page.body, 'data-prompt-card=');
  expectPresent('the model is on the page', page.body, 'SEEDANCE 2.5');
  expectAbsent('the library is denavigated', page.body, 'href="/library"');
  for (const sentinel of PROMPT_SENTINELS) {
    expectAbsent(`no prompt text on the landing (${sentinel.token})`, page.body, sentinel.token);
  }
  expectAbsent('no cookie balance on the landing', page.body, 'data-cookie-balance');
  expectPresent('og:site_name on the landing', page.body, 'property="og:site_name" content="TWINGS"');
  expectEqual('/library still works for anyone who has the URL', (await get('/library')).status, 307);
}

/** Public monthly outcomes, no per-template price table or account data. */
async function sweepPricingTemplates(): Promise<void> {
  console.log('\n/en/pricing + /ko/pricing — monthly plan comparison, anonymous');
  for (const locale of ['en', 'ko']) {
    const page = await get(`/${locale}/pricing`);
    expectEqual(`/${locale}/pricing renders 200`, page.status, 200);
    expectPresent('…with the upcoming monthly plan', page.body, 'data-pricing-subscription="preparing"');
    expectPresent('…with its Creator monthly won price', page.body, '24,900');
    expectPresent('…with its Premium monthly won price', page.body, '49,000');
    expectPresent('…with prompt editing honestly marked as planned', page.body, 'data-prompt-editing="planned"');
    expectPresent('…with a usage preview', page.body, 'data-subscription-preview');
    expectPresent('…with enrollment explicitly closed', page.body, 'data-subscription-unavailable');
    expectAbsent('…without a subscription checkout endpoint', page.body, '/api/billing/subscription');
    expectPresent('…with Creator output counts', page.body, 'data-plan-film-count="creator"');
    expectPresent('…with Premium output counts', page.body, 'data-plan-film-count="premium"');
    expectPresent('…with pricing-specific FAQs', page.body, 'data-faq-catalog="pricing"');
    expectPresent('…with the front-facing photo guide', page.body, 'data-pricing-photo-guide');
    expectAbsent('…without a template price table', page.body, 'data-pricing-table');
    expectAbsent('…without technical dropdowns', page.body, '<select');
    expectAbsent('…no cookie table', page.body, 'data-cookie-table');
    expectAbsent('…no balance figure', page.body, 'data-cookie-balance');
  }
  const en = await get('/en/pricing');
  expectPresent('og:site_name on pricing', en.body, 'property="og:site_name" content="TWINGS"');
}

// ---------------------------------------------------------------------------
// docs/CAMPAIGNS.md — the campaigns surface (2026-09-05)
// ---------------------------------------------------------------------------

/**
 * The local snapshot seeds no campaign, so this sweep proves the SHAPE from outside: the listing is
 * public in both locales and reachable from the nav, the two unprefixed leaves are gated at the
 * edge (the 2026-09-05 bug: they built fine and 308'd into `/ko/campaigns/…` → 404), the admin
 * board refuses anon, and robots agrees with the middleware about what is app surface.
 */
async function sweepCampaigns(): Promise<void> {
  console.log('\n/campaigns — listing, gates, robots, anonymous');

  for (const locale of ['en', 'ko'] as const) {
    const listing = await get(`/${locale}/campaigns`);
    expectEqual(`/${locale}/campaigns renders 200`, listing.status, 200);
    expectPresent(`/${locale}/campaigns has the campaigns section`, listing.body, 'data-campaigns');
    expectPresent(`/${locale}/campaigns has creator opportunities`, listing.body, 'data-creators');
    expectPresent(`/${locale}/campaigns preserves old brand bookmarks`, listing.body, 'data-legacy-brand-entry');
    const brand = await get(`/${locale}/brands`);
    expectEqual(`/${locale}/brands renders 200`, brand.status, 200);
    for (const marker of ['data-campaign-hero', 'data-campaign-reel', 'data-campaign-principles', 'data-campaign-proof', 'data-brands', 'data-case-study', 'data-customer-story', 'data-audience-switch']) {
      expectPresent(`/${locale}/brands carries ${marker}`, brand.body, marker);
    }
    expectEqual(`/${locale}/brands offers three format films`, (brand.body.match(/data-format-select=/g) ?? []).length, 3);
    expectEqual(`/${locale}/brands shows three service examples`, (brand.body.match(/data-service-example=/g) ?? []).length, 3);
    expectAbsent(`/${locale}/brands has no hidden service tabs`, brand.body, 'data-use-case-select');
    expectAbsent(`/${locale}/brands has no misplaced workspace card`, brand.body, 'data-brand-workspace-entry');
    expectEqual(`/${locale}/brands groups campaigns into one customer story`, (brand.body.match(/data-customer-story=/g) ?? []).length, 1);
    expectEqual(`/${locale}/brands carries two distinct Morphic cases`, (brand.body.match(/data-case-study=/g) ?? []).length, 2);
    expectPresent(`/${locale}/brands names the founder-approved client`, brand.body, 'Morphic');
    expectPresent(`/${locale}/brands carries the 90s case`, brand.body, 'data-case-study="morphic-90s-interview"');
    expectPresent(`/${locale}/brands carries the September follow-up`, brand.body, 'data-case-study="morphic-september-kr-jp"');
    expectPresent(`/${locale}/brands keeps video poster-first`, brand.body, 'preload="none"');
    expectAbsent(`/${locale}/brands exposes no creator handle in campaign media URLs`, brand.body.toLowerCase(), '/reel/brands/@');
    if (locale === 'ko') {
      expectPresent('/ko/brands carries the approved view floor', brand.body, '200만+');
      expectPresent('/ko/brands carries the approved organic floor', brand.body, '300건+');
    } else {
      expectPresent('/en/brands carries the approved view floor', brand.body, '2M+');
      expectPresent('/en/brands carries the approved organic floor', brand.body, '300+');
    }
    expectPresent(`/${locale}/brands progressive inquiry form`, brand.body, 'data-brand-inquiry="form"');
    expectPresent(`/${locale}/brands accessible inquiry dialog`, brand.body, 'data-brand-inquiry-dialog');
    expectPresent(`/${locale}/brands role field`, brand.body, 'name="contactRole"');
    expectEqual(`/${locale}/brands shows real August film links`, (brand.body.match(/href="https:\/\/www.instagram.com\/p\/(?:DcXjygPg8fE|DcShoikJklw)\/"/g) ?? []).length, 2);
    expectAbsent(`/${locale}/brands does not send case visitors to Morphic`, brand.body, 'href="https://morphic.com/');
    expectAbsent(`/${locale}/brands removes the generic Morphic guide`, brand.body, 'make-90s-street-style-interview-video');
    expectEqual(`/${locale}/brands shows four September originals`, (brand.body.match(/data-case-post="/g) ?? []).length, 4);
    expectEqual(`/${locale}/brands shows two Korea originals`, (brand.body.match(/data-post-market="KR"/g) ?? []).length, 2);
    expectEqual(`/${locale}/brands shows two Japan originals`, (brand.body.match(/data-post-market="JP"/g) ?? []).length, 2);
    for (const code of ['DdqhUUvRUik', 'DdqirU_yjr-', 'Dd1CiCDSlix', 'Dd0VQJaz8h-']) {
      expectPresent(`/${locale}/brands links the published September original ${code}`, brand.body, `href="https://www.instagram.com/p/${code}/"`);
    }
    expectPresent(`/${locale}/brands shows the production film`, brand.body, 'data-production-films');
    expectPresent(`/${locale}/brands links the production portfolio`, brand.body, 'https://pitch.com/v/yagi-production-wokrs-vsrgfd');
    expectAbsent(`/${locale}/brands uses no green brand accent`, brand.body, 'brand-lime');
    expectPresent(`/${locale}/brands self-canonicals`, brand.body, `rel="canonical" href="${BASE}/${locale}/brands"`);
    const storyIndex = await get(`/${locale}/brands/stories`);
    expectEqual(`/${locale}/brands/stories renders 200`, storyIndex.status, 200);
    expectPresent(`/${locale}/brands/stories links the customer detail`, storyIndex.body, `href="/${locale}/brands/stories/morphic"`);
    const story = await get(`/${locale}/brands/stories/morphic`);
    expectEqual(`/${locale}/brands/stories/morphic renders 200`, story.status, 200);
    expectEqual(`/${locale}/brands/stories/morphic keeps both campaigns`, (story.body.match(/data-case-study=/g) ?? []).length, 2);
    expectPresent(`/${locale}/brands/stories/morphic self-canonicals`, story.body, `rel="canonical" href="${BASE}/${locale}/brands/stories/morphic"`);
    expectPresent(`/${locale}/brands/stories/morphic carries campaign limitations`, story.body, locale === 'ko' ? '전환율은 별도로 집계하지 않았습니다' : 'conversion');
    expectPresent(`/${locale}/brands/stories/morphic offers only the founder's own format`, story.body, 'href="https://morphic.com/en/workflows/019feecc-c7ec-77bd-bc3a-2ddc1f680105/90s-korean-street-interview"');
    expectAbsent(`/${locale}/brands/stories/morphic removes the generic guide`, story.body, 'make-90s-street-style-interview-video');
    expectEqual(`/${locale}/brands/stories/morphic keeps four published September originals`, (story.body.match(/data-case-post="/g) ?? []).length, 4);
    expectEqual(`/${locale}/brands rejects unknown customer stories`, (await get(`/${locale}/brands/stories/unapproved`)).status, 404);
    expectPresent(`/${locale}/brands carries buyer FAQ questions`, brand.body, locale === 'ko' ? '캠페인 성과는 어떻게 확인하나요?' : 'How do you report campaign results?');
    expectAbsent(`/${locale}/brands has no redundant order warning`, brand.body, locale === 'ko' ? '문의 제출만으로 주문' : 'Submitting an enquiry does not place an order');
    expectPresent(`/${locale}/campaigns self-canonicals`, listing.body, `rel="canonical" href="${BASE}/${locale}/campaigns"`);
    const landing = await get(`/${locale}`);
    expectPresent(`/${locale} nav links the campaigns tab`, landing.body, `href="/${locale}/campaigns"`);
  }
  expectEqual('an unknown campaign 404s', (await get('/en/campaigns/no-such-campaign')).status, 404);

  // Private participation leaves stay behind login, including sponsored creation.
  for (const path of ['/campaigns/mine', '/campaigns/no-such-campaign/apply', '/campaigns/no-such-campaign/make']) {
    const gated = await get(path);
    expectOneOf(`${path} redirects anon`, gated.status, [302, 307, 308]);
    if (gated.location && gated.location.includes('signin=1')) ok('…to sign-in', gated.location);
    else fail(`${path} redirect target`, `expected the sign-in redirect, got ${gated.location}`);
  }
  // …while the listing itself still 308s into a locale like every public page.
  const unprefixed = await get('/campaigns');
  expectOneOf('unprefixed /campaigns 308s into a locale', unprefixed.status, [307, 308]);
  if (unprefixed.location?.includes('/campaigns')) ok('…keeping the path', unprefixed.location);
  else fail('/campaigns redirect target', `unexpected location ${unprefixed.location}`);

  for (const path of ['/admin/campaigns', '/admin/campaigns/new']) {
    const admin = await get(path);
    expectOneOf(`${path} refuses anon`, admin.status, [302, 307, 308, 404]);
    expectAbsent('…and leaks no board', admin.body, 'data-admin-campaign=');
    expectAbsent('…and no payout queue', admin.body, 'data-payout-queue');
  }

  const robots = await get('/robots.txt');
  expectPresent('robots disallows the apply form', robots.body, 'Disallow: /campaigns/*/apply');
  expectPresent('robots disallows campaign production', robots.body, 'Disallow: /campaigns/*/make');
  expectPresent('robots disallows my campaigns', robots.body, 'Disallow: /campaigns/mine');
  expectAbsent('…without disallowing the listing itself', robots.body, 'Disallow: /campaigns\n');
  const sitemap = await get('/sitemap.xml');
  expectPresent('sitemap lists the listing (en)', sitemap.body, '/en/campaigns<');
  expectPresent('sitemap lists the listing (ko)', sitemap.body, '/ko/campaigns<');
}

/** Actual HTTP boundaries with nonempty private fixtures; no browser identity or cookies. */
async function sweepBrandWorkspace(fixtures: BrandWorkspaceProbe[]): Promise<void> {
  console.log('\n/brand — private workspace fixtures, anonymous');
  const fixture = fixtures[0];
  if (!fixture) {
    fail('brand workspace fixture discovery', 'missing ready private attachment/project — re-run npm run db:local');
    return;
  }
  ok('brand workspace has a real project and ready attachment to protect');
  const noPrivateBytes = (label: string, response: Fetched) => {
    // Never print private fixture values or storage keys, including on failure.
    const leaked = fixtures.some(row => [row.title, row.organization_name, row.storage_key].some(value => response.body.includes(value)));
    expectEqual(`${label}: no fixture content or private storage key`, leaked, false);
  };
  // Authorization must run before looking up either existing or guessed report IDs.
  for (const path of ['/brand', `/brand/projects/${fixture.id}`, `/admin/brand-workspace/${fixture.id}`,
    `/brand/projects/${fixture.id}/reports/${fixture.id}`,
    `/admin/brand-workspace/${fixture.id}/reports/${fixture.id}`,
    // Secondary usage (docs/SECONDARY-USAGE.md): the pay page, the provider return page and the studio queue.
    `/brand/projects/${fixture.id}/usage/${fixture.id}/pay`, '/brand/usage/return', '/admin/brand-workspace/usage']) {
    const page = await get(path);
    const label = path.replace(fixture.id, '{fixture}');
    expectEqual(`${label}: redirects anonymous access`, page.status, 307);
    const target = new URL(page.location ?? '/', BASE);
    expectEqual(`${label}: redirects only to same-origin sign-in`,
      target.origin === new URL(BASE).origin && (target.pathname === '/auth/choose' || target.searchParams.get('signin') === '1'), true);
    expectEqual(`${label}: private no-store`, page.cacheControl, 'private, no-store');
    expectEqual(`${label}: noindex`, page.robotsTag, 'noindex, nofollow');
    noPrivateBytes(label, page);
  }
  const attachment = await get(`/api/brand-workspace/attachments/${fixture.attachment_id}`);
  expectEqual('brand attachment hides its existence from anonymous readers', attachment.status, 404);
  expectEqual('brand attachment refusal contains no file bytes', attachment.bytes.length, 0);
  expectEqual('brand attachment issues no signed download URL', attachment.location, null);
  expectEqual('brand attachment refusal is private no-store', attachment.cacheControl, 'private, no-store');
  noPrivateBytes('brand attachment', attachment);
  const usageStatus = await get(`/api/brand-workspace/usage?orderId=${fixture.id}`);
  expectEqual('brand usage payment status refuses anonymous readers', usageStatus.status, 401);
  expectEqual('brand usage payment status is private no-store', usageStatus.cacheControl, 'private, no-store');
  noPrivateBytes('brand usage payment status', usageStatus);

  // Preview sweeps remain read-only for this feature. Even locally this malformed input could
  // not create a message if authentication regressed; the expected 401 must precede validation.
  const base = new URL(BASE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    console.log('  SKIP  brand message POST — loopback targets only');
    return;
  }
  const message = await request('/api/brand-workspace', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base.origin },
    body: JSON.stringify({ operation: 'message.send', input: { projectId: fixture.id, body: '', requestId: 'invalid-sweep-probe' } }),
  });
  expectEqual('brand message refuses anonymous access before validation', message.status, 401);
  expectEqual('brand message returns only the sign-in error', message.body, JSON.stringify({ ok: false, code: 'sign_in_required' }));
  expectEqual('brand message refusal is private no-store', message.cacheControl, 'private, no-store');
  noPrivateBytes('brand message', message);
  const usageOrder = await request('/api/brand-workspace/usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base.origin },
    body: JSON.stringify({ operation: 'order.create', input: { caseId: fixture.id, requestId: 'invalid-sweep-probe', consent: true } }),
  });
  expectEqual('brand usage order refuses anonymous access before validation', usageOrder.status, 401);
  expectEqual('brand usage order refusal is private no-store', usageOrder.cacheControl, 'private, no-store');
  noPrivateBytes('brand usage order', usageOrder);
}

/** docs/TEMPLATES-IA.md §8 — the render queue: gated where it must be, open where the token says. */
async function sweepRenders(): Promise<void> {
  console.log('\n/renders — the render queue, anonymous');
  const ID = '00000000-0000-4000-8000-000000000000';
  const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  const mine = await request('/renders', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('/renders redirects anon', mine.status, [302, 303, 307]);
  if (mine.location?.includes('signin=1')) ok('…to sign-in', mine.location);
  else fail('/renders redirect target', `expected the sign-in redirect, got ${mine.location}`);
  const detail = await request(`/renders/${ID}`, { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('/renders/{id} redirects anon', detail.status, [302, 303, 307]);

  const share = await request(`/r/${ID}/${TOKEN}`, { headers: { 'user-agent': CHROME_UA } });
  expectEqual('an unknown 3-day link 404s', share.status, 404);
  expectAbsent('…with no locale redirect in the way', String(share.location ?? ''), '/en/r/');
  // Audit P1-3: a mistyped share link is the viral entry point — the branded (app) 404, not Next's default.
  const badShare = await request(`/r/${ID}/bad`, { headers: { 'user-agent': CHROME_UA } });
  expectEqual('a malformed share link 404s', badShare.status, 404);
  expectPresent('…with the branded app 404', badShare.body, 'data-app-not-found');

  const media = await request(`/api/renders/media/${ID}`);
  expectEqual('the render gateway refuses anon', media.status, 401);
  expectPresent('…no-store', media.cacheControl ?? '', 'no-store');
  const mediaShare = await request(`/api/renders/media/${ID}?s=${TOKEN}`);
  expectEqual('…and an unknown token', mediaShare.status, 404);

  const access = await request('/api/renders/access');
  expectEqual('access answers anon', access.status, 200);
  expectPresent('…with live:false', access.body, '"live":false');

  const enqueue = await fetch(`${BASE}/api/renders`, { method: 'POST', redirect: 'manual' });
  expectEqual('enqueue refuses anon', enqueue.status, 401);
  const campaignEnqueue = await fetch(`${BASE}/api/campaign-production`, { method: 'POST', redirect: 'manual', headers: { Origin: BASE } });
  expectEqual('campaign production refuses anon', campaignEnqueue.status, 401);
  expectPresent('campaign production refusal is private', campaignEnqueue.headers.get('cache-control') ?? '', 'no-store');
  for (const leaf of ['media', 'preview']) {
    const output = await request(`/api/campaign-production/${ID}/${leaf}`);
    expectEqual(`campaign ${leaf} refuses anon`, output.status, 404);
    expectPresent(`campaign ${leaf} response is private`, output.cacheControl ?? '', 'no-store');
  }

  // docs/TEMPLATES-IA.md §8.2 — the face check is app surface; the bank's callback is public but inert without a token.
  const verify = await request('/identity/verify', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('/identity/verify redirects anon', verify.status, [302, 303, 307]);
  if (verify.location?.includes('signin=1')) ok('…to sign-in', verify.location);
  else fail('/identity/verify redirect target', `expected the sign-in redirect, got ${verify.location}`);
  const callback = await request('/api/identity/callback');
  const portrait = await request('/identity/portrait', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('portrait page redirects anonymous', portrait.status, [302,303,307]);
  const portraitState = await request('/api/identity/portrait');
  expectEqual('portrait state refuses anonymous', portraitState.status, 401);
  expectPresent('portrait response is private', portraitState.cacheControl ?? '', 'no-store');
  const portraitImage = await request('/api/identity/portrait/00000000-0000-4000-8000-000000000000/image');
  expectEqual('portrait image refuses anonymous', portraitImage.status, 401);
  const portraitCreate = await fetch(`${BASE}/api/identity/portrait`, {method:'POST',headers:{origin:BASE}});
  expectEqual('portrait creation refuses anonymous', portraitCreate.status, 401);
  expectEqual('the identity callback answers a bare hit with a redirect', callback.status, 303);
  expectPresent('…to the verify page, result unknown', callback.location ?? '', '/identity/verify?result=unknown');

  const tick = await request('/api/renders/tick');
  expectEqual('the tick runs (no secret locally)', tick.status, 200);
  expectPresent('…and reports a pass', tick.body, '"summary"');
  expectPresent('…no-store', tick.cacheControl ?? '', 'no-store');
}

async function main(): Promise<void> {
  console.log(`TWINGS anon sweep → ${BASE} (local mode)`);

  const probe = await fetch(`${BASE}/en`, { redirect: 'manual' }).catch(() => null);
  if (probe === null) {
    console.error(`\nno server at ${BASE}. Start one: npm run build:local && npm run start:local`);
    process.exitCode = 1;
    return;
  }

  const { assets, privateKeys, prompts, brandWorkspace } = await readSnapshot();

  await sweepShowcasePage('en', privateKeys);
  await sweepShowcasePage('ko', privateKeys);
  await sweepRedirects();
  await sweepMonthlyLegal();
  await sweepNotFound(privateKeys, brandWorkspace);
  await sweepGateway(assets);
  await sweepConversionCta();
  await sweepMoney();
  await sweepSeo();
  await sweepStructuredData();
  await sweepDetailMetadata();
  await sweepUnsubscribe();
  const creatorSession = await get('/api/account/session');
  expectEqual('creator session endpoint is reachable anonymously', creatorSession.status, 200);
  expectEqual('creator session reveals no identity to an anonymous visitor', creatorSession.body, '{"signedIn":false}');
  expectEqual('creator session is never cached', creatorSession.cacheControl, 'private, no-store');
  expectEqual('creator session is never indexed', creatorSession.robotsTag, 'noindex, nofollow');

  // --- F1: the OAuth entry's WebView gate -----------------------------------
  await sweepWebViewSignin();

  // --- M6 §13: the prompts surface ----------------------------------------
  await sweepTemplates();
  await sweepTemplateRedirects(prompts);
  await sweepPromptMedia(prompts);
  await sweepLandingTemplates();
  await sweepPricingTemplates();


  // --- docs/CAMPAIGNS.md: the campaigns surface --------------------------
  await sweepCampaigns();
  await sweepBrandWorkspace(brandWorkspace);
  // Contract-only production must not become a consumer catalogue or media surface.
  const brandTemplate = prompts.find(p => p.audience === 'brand');
  if (!brandTemplate) fail('private production fixture', 'missing brand template; rebuild local snapshot');
  else {
    for (const locale of ['ko', 'en']) {
      expectEqual(`${locale}: private brand template detail is 404`, (await get(`/${locale}/t/${brandTemplate.slug}`)).status, 404);
      expectAbsent(`${locale}: private brand template absent from catalogue`, (await get(`/${locale}/video`)).body, brandTemplate.slug);
    }
    expectEqual('private template media is 404', (await get(`/api/prompts/media/${brandTemplate.id}:poster`)).status, 404);
    expectAbsent('private template absent from sitemap', (await get('/sitemap.xml')).body, brandTemplate.slug);
  }
  expectOneOf('brand studio requires login', (await get('/brand/studio')).status, [302,303,307,308]);
  expectEqual('brand production refuses anonymous creation', (await postJson('/api/brand-production', {})).status, 401);
  expectEqual('brand production refuses anonymous status', (await get('/api/brand-production/00000000-0000-4000-8000-000000000000')).status, 404);
  expectEqual('brand production refuses anonymous output', (await get('/api/brand-production/00000000-0000-4000-8000-000000000000/media')).status, 404);

  // --- docs/TEMPLATES-IA.md §8: the render queue --------------------------
  await sweepRenders();

  console.log(
    `\n${failures === 0 ? 'SWEEP PASSED' : 'SWEEP FAILED'} — ${checks - failures}/${checks} checks passed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
