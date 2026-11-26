import { createECDH, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { FIXTURE_SENTINELS } from './fixtures';
import { HIDDEN_PROMPT_SLUGS, PROMPT_SENTINELS } from './prompt-fixtures';
import { LOCAL_MAKER, LOCAL_RECIPE_CANARY, LOCAL_RECIPE_SLUG } from './maker-fixtures';
import { CAST_SENTINELS } from './cast-fixtures';
import { FIXED_PARTS_PROMPT_FIXTURES, FIXED_PARTS_SLUG, STYLED_PARTS_PROMPT_FIXTURES, STYLED_PARTS_SLUG } from './fixed-parts-fixtures';
import { LOOK_FEMALE_SLUG, LOOK_MALE_SLUG, TEMPLATE_LOOK_PROMPT_FIXTURES } from './template-look-fixtures';
import { RUNTIME_MODE_ENV } from '@/lib/runtime-mode';
import { KO_TERMS } from '@/messages/ko';
import { EN_TERMS } from '@/messages/en';

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
  /** The workspace pages' nonce policy (lib/security/workspace-csp.ts). */
  csp: string | null;
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
            csp: header('content-security-policy'),
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
    csp: response.headers.get('content-security-policy'),
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
    // The campaign wizard and the pages absorbed into the campaign tabs (docs/PLATFORM-2.0.md §16.6)
    // stay on the brand host: an anonymous visitor is asked to sign in and comes back to the same path.
    const project = '00000000-0000-4000-8000-000000000000';
    // docs/BRAND-STUDIO-V2.md §5: the studio and its formats tab ask for sign-in like every brand page.
    // docs/BRAND-STUDIO-V3.md §12: so do the workspace home and the default landing that picks it.
    // docs/BRAND-SOUND-STUDIO.md §7.3: and the sound studio, whatever its flag says.
    for (const path of ['/brand/projects/new', `/brand/projects/${project}`, `/brand/projects/${project}/participants`, `/brand/projects/${project}/funding`, '/brand/creators', '/brand/studio', '/brand/studio?tab=formats', '/brand/studio/sound', '/brand/home', '/brand/start']) {
      const page = await request(path, { headers: { host: 'brand.twings.app' } });
      const next = page.location ? new URL(page.location, BASE).searchParams.get('next') : null;
      expectEqual(`brand.twings.app${path}: asks to sign in and returns here`, page.status >= 300 && page.status < 400 && next === path, true);
      expectEqual(`brand.twings.app${path}: no private content or storage keys`, forbidden.some((value) => value.length > 0 && page.body.includes(value)), false);
    }
    // docs/PLATFORM-2.0.md §17.3 — the pool's invite API stays on the brand host and refuses strangers.
    const poolInvite = await request('/api/brand-creators', { method: 'POST', headers: { host: 'brand.twings.app', 'content-type': 'application/json' } });
    expectOneOf('brand.twings.app /api/brand-creators: refuses anonymous (closed or sign-in)', poolInvite.status, [401, 404]);
    expectPresent('brand.twings.app /api/brand-creators: private', poolInvite.cacheControl ?? '', 'no-store');
    const poolRead = await request('/api/brand-creators', { headers: { host: 'brand.twings.app' } });
    expectEqual('brand.twings.app /api/brand-creators: no reads', poolRead.status, 404);
    // docs/BRAND-STUDIO-V2.md §3, §5: the studio API never answers a stranger and is never cached.
    const anyOrg = '00000000-0000-4000-8000-000000000000';
    for (const path of ['/api/brand-studio', `/api/brand-studio?organizationId=${anyOrg}`, `/api/brand-studio?organizationId=${anyOrg}&jobs=${anyOrg}`]) {
      const studio = await request(path, { headers: { host: 'brand.twings.app' } });
      expectOneOf(`brand.twings.app ${path}: refuses anonymous (closed or sign-in)`, studio.status, [401, 404]);
      expectPresent(`brand.twings.app ${path}: no-store`, studio.cacheControl ?? '', 'no-store');
      expectEqual(`brand.twings.app ${path}: no private content or storage keys`, forbidden.some((value) => value.length > 0 && studio.body.includes(value)), false);
    }
    const studioWrite = await request('/api/brand-studio', { method: 'POST', headers: { host: 'brand.twings.app', 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'job.create', input: {} }) });
    expectOneOf('brand.twings.app /api/brand-studio POST: refuses anonymous', studioWrite.status, [401, 404]);
    expectPresent('brand.twings.app /api/brand-studio POST: no-store', studioWrite.cacheControl ?? '', 'no-store');
  }
  const studioApi = await get('/api/brand-studio');
  expectOneOf('/api/brand-studio refuses anonymous (closed or sign-in)', studioApi.status, [401, 404]);
  expectPresent('/api/brand-studio is never cached', studioApi.cacheControl ?? '', 'no-store');
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

  // docs/PLATFORM-2.0.md §2.2: 다시 결제하기 is the owner's alone; the webhook is a hint, never an oracle;
  // a return from the provider with no session keeps its approval parameters through sign-in.
  const retry = await request(`/api/billing/toss/orders/${tossOrderId}/retry`, { method: 'POST', headers: { Origin: BASE } });
  expectEqual('Toss retry refuses anonymous re-ordering', retry.status, 401);
  expectEqual('Toss retry is never cached', retry.cacheControl, 'private, no-store');
  const hint = await postJson('/api/billing/toss/webhook', {
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { orderId: tossOrderId, paymentKey: 'sweep_probe', status: 'CANCELED' },
  });
  expectEqual('Toss webhook answers an unknown order with 200', hint.status, 200);
  expectEqual('…and an empty body', hint.body, '');
  expectEqual('Toss webhook is never cached', hint.cacheControl, 'private, no-store');
  const malformed = await request('/api/billing/toss/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  expectEqual('Toss webhook answers a malformed body with 200', malformed.status, 200);
  expectEqual('…and an empty body', malformed.body, '');
  expectEqual('GET on the Toss webhook is 405', (await get('/api/billing/toss/webhook')).status, 405);
  const back = await get(`/billing/toss/return?locale=ko&paymentKey=sweep_probe&orderId=${tossOrderId}&amount=1000`);
  expectOneOf('Toss return without a session goes to sign-in', back.status, [302, 307, 308]);
  const resume = new URL(back.location ?? '/', BASE).searchParams.get('next') ?? '';
  expectPresent('…keeping the approval parameters in next', resume, `/billing/toss/return?`);
  expectPresent('…the payment key included', resume, 'paymentKey=sweep_probe');
  expectPresent('…and the order', resume, `orderId=${tossOrderId}`);

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
  // lib/content/landing-media.ts — the replace screen is admin-only, and the image route answers only
  // for a slot that really has an override (none in the snapshot), never for a path it was handed.
  {
    const editor = await get('/admin/landing-media');
    expectOneOf('/admin/landing-media requires sign-in', editor.status, [302, 307, 308, 404]);
    expectAbsent('/admin/landing-media shows no tiles anonymously', editor.body, 'data-landing-slot');
    for (const path of ['/api/landing-media/studio/p-amber-1', '/api/landing-media/studio/nope', '/api/landing-media/..%2F.env']) {
      const media = await get(path);
      expectEqual(`${path} is a 404 without an override`, media.status, 404);
    }
  }
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

/**
 * docs/RUNBOOK-deletion.md — the account deletion surface. The public how-to page is the Google
 * Play listing's "account deletion URL": it must answer 200 to a stranger, be indexable and listed,
 * and lead to the in-app request, which (like the admin queue) stays behind the login wall.
 */
async function sweepAccountDeletion(): Promise<void> {
  console.log('\n/{locale}/delete-account — account deletion without signing in (RUNBOOK-deletion)');
  const sitemap = await get('/sitemap.xml');
  for (const locale of ['ko', 'en']) {
    const path = `/${locale}/delete-account`;
    const page = await get(path);
    expectEqual(`${path} renders 200 anonymously`, page.status, 200);
    expectPresent(`${path} page marker`, page.body, 'data-account-deletion-page');
    expectPresent(`${path} says how to request in the app`, page.body, 'data-deletion-steps');
    expectPresent(`${path} links the in-app request`, page.body, 'href="/account/delete"');
    expectPresent(`${path} offers the mail request`, page.body, 'mailto:hello@yagiworkshop.xyz');
    expectPresent(`${path} lists what is deleted and kept`, page.body, 'data-deletion-facts');
    expectPresent(`${path} names what is removed`, page.body, 'data-deletion-removed');
    expectPresent(`${path} names what is kept (payment records)`, page.body, 'data-deletion-kept');
    expectPresent(`${path} says how long it takes`, page.body, 'data-deletion-time');
    expectAbsent(`${path} leaves no unfilled placeholder`, page.body, '{days}');
    expectPresent(`${path} links the privacy policy`, page.body, `href="/${locale}/legal/privacy"`);
    expectPresent(`${path} canonical`, page.body, `${path}"`);
    expectAbsent(`${path} is indexable`, page.body, 'noindex');
    expectPresent(`sitemap lists ${path}`, sitemap.body, `<loc>${BASE}${path}</loc>`);
  }
  const bare = await get('/delete-account');
  expectOneOf('/delete-account picks a locale', bare.status, [307, 308]);
  const confirm = await get('/account/delete');
  expectOneOf('/account/delete redirects anon', confirm.status, [302, 303, 307, 308]);
  if (confirm.location && !confirm.location.startsWith('/account') && !confirm.location.includes('/account/delete?'))
    ok('…away from the confirmation step', confirm.location);
  else fail('/account/delete redirect target', `unexpected location ${confirm.location}`);
  expectOneOf('/admin/account-deletions refuses anon', (await get('/admin/account-deletions')).status, [302, 303, 307, 308, 404]);
  for (const op of ['account.deletion.run', 'account.deletion.complete', 'account.deletion.cancel']) {
    const mark = await postForm('/admin/do', { _op: op, id: '00000000-0000-4000-8000-000000000000', note: 'sweep' });
    expectEqual(`anonymous ${op} is refused`, mark.status >= 400 || (mark.status >= 300 && !(mark.location ?? '').includes('ok=')), true);
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
  expectPresent('…beside the personal stage', chooser.body, 'data-personal-auth-stage');
  expectPresent('…with the three leads', chooser.body, '/reel/landing/entry-lead.mp4');
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
    expectPresent(`brand chooser ${locale} shows the brand world`, brandChooser.body, 'data-brand-auth-stage');
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
    // PLATFORM-2.0 §15.3-4 (founder 2026-10-23): portrait templates are 4:5 cards, 16:9 is for
    // landscape ones; the card names length and shape, never the engine, and is one link.
    expectPresent('portrait templates sit in 4:5 cards', page.body, 'data-frame="portrait"');
    expectPresent('…landscape ones keep 16:9', page.body, 'data-frame="landscape"');
    expectPresent('…with a length chip', page.body, 'data-card-duration');
    expectPresent('…and a ratio chip', page.body, 'data-card-aspect');
    expectAbsent('…and no engine chip', page.body, 'data-model-chip');
    expectAbsent('…and no "view template" button', page.body, 'data-card-detail');
    // 2026-11-24 (founder, second time): the video list filters by length, never by genre chips.
    expectPresent('the list filter', page.body, 'data-list-filter');
    expectPresent('…grouped by length', page.body, 'data-filter-facet="length"');
    expectPresent('…with the short band', page.body, 'data-filter-option="length:short"');
    if (/data-filter-option="length:(mid|long)"/.test(page.body)) ok('…and another band', 'mid or long');
    else fail('…and another band', 'neither data-filter-option="length:mid" nor "length:long"');
    expectPresent('cards carry their length band', page.body, 'data-length=');
    expectAbsent('…and no genre chips', page.body, 'data-filter-option="useCase:');
    // docs/PERSONAL-STUDIO.md §3.4.9 (S2): the style group splits only on cards that declare their styling — on the
    // local data, the one fixture that does (scripts/fixed-parts-fixtures.ts); production shows none until templates
    // are declared. A card that declares nothing carries no style.
    expectPresent('…grouped by style (the styled local fixture)', page.body, 'data-filter-facet="style"');
    expectPresent('…with "styled by the template"', page.body, 'data-filter-option="style:styled"');
    expectPresent('…on the card that declares it', page.body, 'data-style="styled"');
    {
      const styled = page.body.split('data-style="').length - 1;
      if (styled === 1) ok('…and on no card that declares none', 'one card carries data-style');
      else fail('…style on undeclared cards', `expected exactly 1 data-style, got ${styled}`);
    }
    // docs/PERSONAL-STUDIO.md §3.4.10: the template style. The two labelled local samples are listed like any card;
    // an anonymous visitor is never asked and never filtered, and nothing in the cached HTML is hidden. With the switch
    // off (the default for this run) no card carries a style label at all; with TWINGS_TEMPLATE_LOOK=on set for the
    // server AND this sweep, every card carries one and the two samples carry theirs.
    expectPresent('the women’s-style sample is listed', page.body, `data-prompt-card="${LOOK_FEMALE_SLUG}"`);
    expectPresent('…and the men’s-style sample', page.body, `data-prompt-card="${LOOK_MALE_SLUG}"`);
    if (/data-prompt-item="true"[^>]*\shidden(=|\s|>)/.test(page.body)) fail('every card is visible in the HTML', 'a data-prompt-item carries hidden');
    else ok('every card is visible in the HTML', 'no hidden card');
    expectAbsent('…no style question for a visitor', page.body, 'data-look-question');
    expectAbsent('…no "few so far" line in the HTML', page.body, 'data-look-few');
    if (process.env.TWINGS_TEMPLATE_LOOK === 'on') {
      expectPresent('…the women’s-style label (switch on)', page.body, 'data-look="female"');
      expectPresent('…the men’s-style label (switch on)', page.body, 'data-look="male"');
      expectPresent('…the rail’s "show other styles too" (hidden)', page.body, 'data-look-reveal');
    } else {
      expectAbsent('…no style label on any card (switch off)', page.body, 'data-look=');
      expectAbsent('…no "show other styles too" (switch off)', page.body, 'data-look-reveal');
    }
    // §15.3-5: the GEO definition is still in the HTML, under the grid rather than above it.
    {
      const definition = page.body.indexOf('data-service-definition');
      const lastCard = page.body.lastIndexOf('data-prompt-card=');
      if (definition > lastCard && lastCard > -1) ok('the service definition follows the grid', `${definition} > ${lastCard}`);
      else fail('the service definition follows the grid', `definition at ${definition}, last card at ${lastCard}`);
    }
    expectAbsent('no lock chips anywhere', page.body, 'data-lock-chip');
    expectAbsent('no image template on the video tab', page.body, `data-prompt-card="${IMAGE_TEMPLATE}"`);
    expectAbsent('no prompt submission door', page.body, '/prompts/submit');
    // docs/PLATFORM-2.0.md §3.2-1: the first-run sheet is a client island — nothing of it in static HTML.
    expectAbsent('the first-run sheet never reaches the static page', page.body, 'data-onboarding-sheet');
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
  expectPresent('the list filter', image.body, 'data-list-filter');
  expectAbsent('…with no length group on images', image.body, 'data-filter-facet="length"');

  console.log('\n/en/t/[slug] — template pages, anonymous');
  const detail = await get(`/en/t/${GATED_PROMPT}`);
  expectEqual('a priced template renders 200', detail.status, 200);
  if (detail.cacheControl !== 'private, no-store') ok('…and is cacheable — nothing on it is gated', detail.cacheControl ?? '(none)');
  else fail('template detail cache mode', 'must not be private, no-store: the page has no per-viewer half');
  expectPresent('…names itself', detail.body, `data-template="${GATED_PROMPT}"`);
  expectPresent('…with the make section', detail.body, 'data-template-make');
  expectPresent('…and the one-style studio', detail.body, 'data-single="true"');
  // Founder, 2026-09-11: no demo. PLATFORM-2.0 §3.2-2: the static page no longer paints "closed" and
  // flips — it draws a neutral skeleton, and the per-viewer access call settles it in the browser.
  expectPresent('…and the studio starts as a neutral skeleton', detail.body, 'data-studio-pending');
  expectAbsent('…not painted closed before the access call', detail.body, 'data-studio-closed');
  // §15.3-1, revised 2026-10-29 (founder): a short make box on the page, the make card in a sheet.
  expectPresent('…a make box on the page', detail.body, 'data-template-make-launcher');
  expectPresent('…the make card in a sheet', detail.body, 'data-make-sheet');
  expectAbsent('…no price box', detail.body, 'data-template-price-box');
  expectAbsent('…no link button above the card', detail.body, 'data-template-make-cta');
  expectPresent('…its facts', detail.body, 'data-template-fact');
  expectPresent('…the AI limit inside the card', detail.body, 'data-studio-ai-note');
  expectPresent('…the refund sentence inside the card', detail.body, 'data-template-refund');
  expectAbsent('…no engine chip on the decision screen', detail.body, 'data-engine-chip');
  expectPresent('…a phone sticky bar', detail.body, 'data-make-sticky');
  if (/<div[^>]*data-make-sticky[^>]*data-hide-tabs/.test(detail.body)) ok('…that hides the installed app tabs', 'data-hide-tabs');
  else fail('…sticky bar hides the app tabs', 'data-make-sticky must carry data-hide-tabs');
  expectPresent('…and the selfie strip still opens the make card', detail.body, 'href="#make"');
  expectAbsent('…no demo badge anywhere', detail.body, 'data-demo-badge');
  expectAbsent('…no placeholder ad', detail.body, 'YOUR AD HERE');
  expectAbsent('…no house ad rail', detail.body, 'data-house-ad');
  // The terms promise the single-purchase price on the template page (while the shop is open: tests/ui/make-screen);
  // credits and "subscribe" wait for subscriptions (§19.2).
  const shown = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');
  expectAbsent('…no "Subscribe to make it here" while subscriptions are closed', detail.body, 'Subscribe to make it here');
  expectAbsent('…and no credits', shown(detail.body), 'data-template-credits');
  expectAbsent('…no Offer price in the structured data', detail.body, 'priceCurrency');
  // The related list uses the same justified film rows as the catalogue.
  if (/<ul[^>]*data-related-grid[^>]*class="[^"]*\bfilm-rows\b/.test(detail.body)) ok('…related templates in film rows', 'data-related-grid');
  else fail('…related templates grid', 'expected data-related-grid with film-rows');
  expectPresent('…whose items are cards', detail.body, 'data-related-item');
  const detailKo = await get(`/ko/t/${GATED_PROMPT}`);
  expectEqual('the Korean template page renders 200', detailKo.status, 200);
  expectAbsent('…no "구독하고 여기서 만들기" while subscriptions are closed', detailKo.body, '구독하고 여기서 만들기');
  if (/완성까지<\/dt><dd[^>]*>보통 \d+분/.test(detailKo.body)) ok('…with the typical wait in minutes', '보통 N분');
  else fail('…typical wait', 'expected "완성까지 · 보통 N분" in the make card');
  expectAbsent('…and never a dollar', detailKo.body, '>$4<');
  expectAbsent('…and NONE of its prompt text', detail.body, promptToken(GATED_PROMPT));
  expectAbsent('…no prompt block', detail.body, 'data-prompt-text');
  expectAbsent('…no lock panel', detail.body, 'data-lock-panel');
  expectAbsent('…no copy button', detail.body, 'data-copy-prompt');
  expectAbsent('…no cookie balance', detail.body, 'data-cookie-balance');
  for (const sentinel of PROMPT_SENTINELS) {
    expectAbsent(`…no prompt text of any kind (${sentinel.token})`, detail.body, sentinel.token);
  }
  // docs/PERSONAL-STUDIO.md §3.4.4 (T1a): a template that declares no fixed part has no fixed row.
  expectAbsent('…no "what this template decides" row without a declaration', detail.body, 'data-template-fixed');
  expectAbsent('…nor on the Korean page', detailKo.body, 'data-template-fixed');
  expectAbsent('…no part states without a declaration', detail.body, 'data-fixed-state');
  // 2026-11-24 (founder): genre chips say nothing about a video — a video template page carries none.
  expectAbsent('…no genre chips on a video template', detail.body, 'data-template-use-case');

  // T1a: the local film whose prompt declares fixed parts (scripts/fixed-parts-fixtures.ts) shows them under the
  // example video: names from the lock projection, the marks' descriptions and ranges — never the block's words.
  for (const locale of ['ko', 'en'] as const) {
    const fixedPage = await get(`/${locale}/t/${FIXED_PARTS_SLUG}`);
    expectEqual(`${locale}: the template with fixed parts renders 200`, fixedPage.status, 200);
    expectPresent(`${locale}: …with the fixed row`, fixedPage.body, 'data-template-fixed');
    expectPresent(`${locale}: …under the keyframe strip`, fixedPage.body, 'data-video-keyframe-strip');
    if (fixedPage.body.indexOf('data-video-keyframe-strip') < fixedPage.body.indexOf('data-template-fixed')) ok(`${locale}: …in that order`, 'strip, then fixed row');
    else fail(`${locale}: fixed row order`, 'expected the fixed row after the keyframe strip');
    for (const part of ['outfit', 'prop', 'lighting_mood']) expectPresent(`${locale}: …names ${part}`, fixedPage.body, `data-fixed-part="${part}"`);
    expectPresent(`${locale}: …a marked range is tappable`, fixedPage.body, 'data-fixed-item="outfit"');
    expectPresent(`${locale}: …with its range`, fixedPage.body, '0:02–0:03');
    expectPresent(`${locale}: …the heading`, fixedPage.body, locale === 'ko' ? '이 템플릿에서 정해진 것' : 'What this template decides');
    expectPresent(`${locale}: …the description`, fixedPage.body, locale === 'ko' ? '은색 붐박스' : 'Silver boombox');
    for (const word of ['Template locks', 'Keep exactly as in the template', 'powder-blue studio world', 'rhinestone denim, studded belts', FIXED_PARTS_PROMPT_FIXTURES[0]!.sentinel]) {
      expectAbsent(`${locale}: …no word of the template's prompt (${word})`, fixedPage.body, word);
    }
  }

  // §3.4.9 (S2): the local film that styles the hair and makeup (and locks a prop) lists all three with their states —
  // names and the admin's descriptions only, never a word of either block.
  for (const locale of ['ko', 'en'] as const) {
    const styledPage = await get(`/${locale}/t/${STYLED_PARTS_SLUG}`);
    expectEqual(`${locale}: the template with styled parts renders 200`, styledPage.status, 200);
    expectPresent(`${locale}: …with the fixed row`, styledPage.body, 'data-template-fixed');
    for (const part of ['hair', 'makeup', 'prop']) expectPresent(`${locale}: …names ${part}`, styledPage.body, `data-fixed-part="${part}"`);
    const styledCount = styledPage.body.split('data-fixed-state="styled"').length - 1;
    if (styledCount === 2) ok(`${locale}: …two parts in the template's style`, 'hair, makeup');
    else fail(`${locale}: styled parts`, `expected 2 data-fixed-state="styled", got ${styledCount}`);
    expectPresent(`${locale}: …and the locked prop`, styledPage.body, 'data-fixed-state="locked"');
    expectPresent(`${locale}: …the state in words`, styledPage.body, locale === 'ko' ? '템플릿 스타일' : 'Template style');
    expectPresent(`${locale}: …the description`, styledPage.body, locale === 'ko' ? '낮게 묶은 머리' : 'Low bun');
    for (const word of ['Template styling', 'Styled by the template', 'Template locks', 'a sleek low bun', 'glossy lip', 'microphone on a stand', STYLED_PARTS_PROMPT_FIXTURES[0]!.sentinel]) {
      expectAbsent(`${locale}: …no word of the template's prompt (${word})`, styledPage.body, word);
    }
    expectAbsent(`${locale}: …and no genre chips on the video`, styledPage.body, 'data-template-use-case');
  }

  // §3.4.10: a one-style template is always viewable directly; its style fact is there only with the switch on, and
  // the mismatch line (viewer-specific) never reaches the cached HTML.
  for (const locale of ['ko', 'en'] as const) {
    const lookPage = await get(`/${locale}/t/${LOOK_MALE_SLUG}`);
    expectEqual(`${locale}: the men's-style sample renders 200`, lookPage.status, 200);
    expectPresent(`${locale}: …with its make button`, lookPage.body, 'data-make-cta');
    expectAbsent(`${locale}: …no mismatch line in the HTML`, lookPage.body, 'data-look-mismatch');
    const fact = locale === 'ko' ? '남성 스타일' : 'Men&#x27;s styles';
    if (process.env.TWINGS_TEMPLATE_LOOK === 'on') expectPresent(`${locale}: …the style fact (switch on)`, lookPage.body, fact);
    else expectAbsent(`${locale}: …no style fact (switch off)`, lookPage.body, fact);
    expectAbsent(`${locale}: …no word of its prompt`, lookPage.body, TEMPLATE_LOOK_PROMPT_FIXTURES[1]!.sentinel);
  }

  const closed = await get(`/en/t/${CLOSED_TEMPLATE}`);
  expectEqual('a not-yet-for-sale template renders 200', closed.status, 200);
  expectAbsent('…a video template page carries no genre chips', closed.body, 'data-template-use-case');
  expectPresent('…and says so', closed.body, 'data-template-closed');
  expectAbsent('…without a studio', closed.body, 'data-twings-studio');
  // (Related cards below it may well carry price chips — the assertion is on ITS facts, not the page.)
  expectPresent('…and no price in its facts', closed.body, 'data-template-closed');

  const imageDetail = await get(`/en/t/${IMAGE_TEMPLATE}`);
  expectEqual('an image template renders 200', imageDetail.status, 200);
  expectPresent('…as an image', imageDetail.body, 'data-medium="image"');
  // A set template (2026-10-27): every frame one order makes, on the page and never on the card.
  expectPresent('…a set shows all its frames', imageDetail.body, 'data-template-gallery="2"');
  expectPresent('…the last of them included', imageDetail.body, 'data-template-gallery-frame="2"');
  expectPresent('…and says how many images it makes', imageDetail.body, '2 images');
  expectAbsent('…the image tab carries no set frames', image.body, 'data-template-gallery');
  expectAbsent('…a single template has no set section', detail.body, 'data-template-gallery');

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
  // docs/PLATFORM-2.0.md §5.2 — the installed app's manifest, in the site's own white.
  expectPresent('…splash and status bar in the site’s white', manifest.body, '"theme_color":"#ffffff"');
  expectPresent('…white background', manifest.body, '"background_color":"#ffffff"');
  expectPresent('…starting on the formats in the reader’s locale', manifest.body, '"start_url":"/video?source=pwa"');
  expectPresent('…with the fixed app id', manifest.body, '"id":"/"');
  expectPresent('…maskable icons', manifest.body, '"purpose":"maskable"');
  expectPresent('…and the two shortcuts', manifest.body, '"shortcuts"');
  for (const icon of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png', '/icons/badge-96.png']) {
    const served = await get(icon);
    expectEqual(`${icon} is served`, served.status, 200);
    expectPresent(`${icon} is a PNG`, served.contentType ?? '', 'image/png');
  }
  const worker = await get('/sw.js');
  expectEqual('the service worker is served at the root', worker.status, 200);
  expectPresent('…and shows the completion push', worker.body, "self.addEventListener('push'");
  expectPresent('…and opens its link on a tap', worker.body, "self.addEventListener('notificationclick'");
  expectPresent('…keeping navigations network first', worker.body, "if (request.mode !== 'navigate') return;");
  expectEqual('the offline page is served at the root', (await get('/offline.html')).status, 200);
  const landing = await get('/en');
  expectPresent('the landing declares the manifest', landing.body, 'rel="manifest"');
  expectPresent('…runs edge to edge (safe areas padded in CSS)', landing.body, 'viewport-fit=cover');
  // A white page under the iOS `default` bar (dark text on white); black-translucent would hide it.
  expectPresent('…under the default iOS status bar', landing.body, 'name="apple-mobile-web-app-status-bar-style" content="default"');
  expectPresent('…with the white browser chrome', landing.body, 'name="theme-color" content="#ffffff"');
  // 2026-10-07: no bottom-fixed UI in the mobile browser — the tabs exist only after the page
  // finds itself installed, never in server HTML.
  expectAbsent('…and never ships the bottom tabs in its HTML', landing.body, 'data-bottom-tabs');
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
  // §15.3-2: the founder-approved default selfie → scene pair renders on the landing.
  expectPresent('the selfie → scene evidence pair is on the landing', page.body, 'data-hero-evidence');
  expectPresent('the hero sale-state line', page.body, 'data-creator-availability');
  expectAbsent('no placeholder ad on the landing', page.body, 'YOUR AD HERE');
  expectPresent('the creator home has a separate brand entry', page.body, 'data-brand-door');
  expectPresent('the brand entry leads to public services', page.body, 'href="/en/brands"');
  expectPresent('the video rail is template cards', page.body, 'data-prompt-card=');
  expectAbsent('no engine name on the landing (IDENTITY §7)', page.body, 'SEEDANCE 2.5');
  expectAbsent('the library is denavigated', page.body, 'href="/library"');
  for (const sentinel of PROMPT_SENTINELS) {
    expectAbsent(`no prompt text on the landing (${sentinel.token})`, page.body, sentinel.token);
  }
  expectAbsent('no cookie balance on the landing', page.body, 'data-cookie-balance');
  expectPresent('og:site_name on the landing', page.body, 'property="og:site_name" content="TWINGS"');
  expectEqual('/library still works for anyone who has the URL', (await get('/library')).status, 307);
}

/**
 * docs/PLATFORM-2.0.md §7.5·§14.1 — the header names (개인 | 브랜드), the two origin rails and the
 * public maker page. The local snapshot carries published community fixtures (maker origin) and one
 * maker who opted in (`scripts/maker-fixtures.ts`, `@jun`), so here both rails exist; production
 * has no maker template yet, and the unit tests pin that the second rail and the chips then vanish.
 */
async function sweepMakers(): Promise<void> {
  console.log('\n§14.1 names — the header audience switch');
  for (const [locale, personal, brand] of [['ko', KO_TERMS.personal, '브랜드'], ['en', EN_TERMS.personal, 'Brands']] as const) {
    const page = await get(`/${locale}`);
    const side = (id: string) => new RegExp(`data-audience="${id}"[^>]*>([^<]*)</a>`).exec(page.body)?.[1] ?? null;
    expectEqual(`${locale}: the switch's consumer side reads "${personal}"`, side('creator'), personal);
    expectEqual(`${locale}: …and its brand side "${brand}"`, side('brand'), brand);
  }

  // §7.5 (founder 2026-10-30): one feed — originals and AI creatives mixed, no origin rails or chips.
  console.log(`\n/ko/video — ${KO_TERMS.studioCollection} and ${KO_TERMS.maker} templates in one grid`);
  const video = await get('/ko/video');
  // The pet and couple shelves under the grid (docs/CAST-CATEGORIES.md §5) are their own sections, not origin rails.
  expectEqual('one grid on the listing', video.body.split('data-rail="').length - 1 - (video.body.split('data-rail="cast-').length - 1), 1);
  expectAbsent('…no origin rails', video.body, 'data-rail-origin');
  expectAbsent('…no origin chips', video.body, 'data-origin-filter');
  expectAbsent('…no collection headings', video.body, `>${KO_TERMS.makerCollection}</h2>`);
  const origins = [...video.body.matchAll(/data-card-origin="(studio|maker)"/g)].map((match) => match[1]!);
  expectEqual('both origins in that grid', [...new Set(origins)].sort().join(','), 'maker,studio');
  // While both still have cards, one origin never holds more than three places in a row.
  const mixedUntil = Math.min(origins.lastIndexOf('studio'), origins.lastIndexOf('maker'));
  let longest = 0;
  for (let i = 0, run = 0; i <= mixedUntil; i++) { run = i > 0 && origins[i] === origins[i - 1] ? run + 1 : 1; longest = Math.max(longest, run); }
  if (longest <= 3) ok('…mixed, never more than three of one origin in a row', origins.join(' '));
  else fail('…mixed, never more than three of one origin in a row', origins.join(' '));
  expectPresent('a public creative is credited by handle', video.body, `${KO_TERMS.creditPrefix} @jun`);
  expectAbsent('no "작가" anywhere on the catalogue', video.body, '작가');
  expectAbsent('no author account id reaches the page', video.body, 'f0000000-0000-4000-8000-000000000002');
  const home = await get('/ko');
  expectAbsent('the home page has no separate creatives rail', home.body, 'data-rail="makers"');
  const homeVideo = home.body.slice(home.body.indexOf('data-rail="video"'), home.body.indexOf('data-all-video'));
  expectPresent('…its video rail carries the creatives\' templates', homeVideo, 'data-card-origin="maker"');

  console.log('\n/ko/t/[slug] — one creator line, only where the creative opted in');
  const makerTemplate = await get('/ko/t/cafe-window-timelapse');
  expectEqual('renders 200', makerTemplate.status, 200);
  expectPresent('the creator line', makerTemplate.body, 'data-template-maker="jun"');
  expectEqual('…once', makerTemplate.body.split('data-template-maker=').length - 1, 1);
  const line = makerTemplate.body.indexOf('data-template-maker="jun"');
  if (line > makerTemplate.body.indexOf('<h1') && line < makerTemplate.body.indexOf('data-template-description')) ok('…right under the title');
  else fail('…right under the title', `line at ${line}`);
  expectPresent('…linking to the creative\'s profile', makerTemplate.body, 'href="/ko/makers/jun"');
  expectPresent('the verified mark', makerTemplate.body, 'data-template-verified');
  // 2026-10-29: the copy-or-make fork and the recipe pill follow a public prompt, never the credit.
  expectAbsent('no copy-or-make fork without a public prompt', makerTemplate.body, 'data-template-recipe-actions');
  // Locally one card has a public prompt: the studio recipe the maker fixtures disclose (LOCAL_RECIPE_SLUG).
  expectEqual('…and the catalogue\'s recipe pill only on that one card', video.body.split('data-card-recipe="true"').length - 1, 1);
  const legacy = await get('/ko/t/skate-park-golden-hour');
  expectPresent('a handle without a maker page is a plain credit', legacy.body, `${KO_TERMS.creditPrefix} @hana`);
  expectAbsent('…with no maker block', legacy.body, 'data-template-maker');
  const studio = await get(`/ko/t/${GATED_PROMPT}`);
  expectPresent('a studio template names the studio collection', studio.body, KO_TERMS.studioCollection);
  expectAbsent('…and has no maker block', studio.body, 'data-template-maker');

  console.log('\n/{locale}/makers/[handle] — a public maker page');
  for (const locale of ['ko', 'en'] as const) {
    const page = await get(`/${locale}/makers/jun`);
    expectEqual(`${locale}: renders 200`, page.status, 200);
    expectPresent(`${locale}: is the maker page`, page.body, 'data-maker-profile="jun"');
    expectPresent(`${locale}: shows the maker's template`, page.body, 'data-prompt-card="cafe-window-timelapse"');
    expectAbsent(`${locale}: and nobody else's`, page.body, 'data-prompt-card="skate-park-golden-hour"');
    expectPresent(`${locale}: canonical`, page.body, `rel="canonical" href="http`);
    expectPresent(`${locale}: hreflang`, page.body, 'hrefLang="ko"');
    expectAbsent(`${locale}: indexable`, page.body, 'noindex');
    expectAbsent(`${locale}: no account id`, page.body, 'f0000000-0000-4000-8000-000000000002');
    expectAbsent(`${locale}: no email`, page.body, 'pro@playbook.test');
    expectAbsent(`${locale}: no recipe claim without an open recipe`, page.body, 'data-maker-recipe-hub');
  }
  expectPresent('ko: the count line', (await get('/ko/makers/jun')).body, '템플릿 1편');

  // §20 — the creative's identity, works and doors (local fixture `@jun`, every value marked TEST).
  console.log('\n/{locale}/makers/jun — the AI creative page (§20)');
  const creative = await get('/ko/makers/jun');
  expectPresent('the creative name', creative.body, LOCAL_MAKER.displayName);
  expectPresent('the headline', creative.body, 'data-creative-headline');
  expectPresent('where they work', creative.body, 'data-creative-place');
  expectPresent('…in Korean', creative.body, '대한민국');
  expectPresent('open to brand work', creative.body, 'data-creative-open');
  expectPresent('their tools', creative.body, 'data-creative-tools');
  expectPresent('their links', creative.body, 'data-creative-link="website"');
  expectPresent('their works', creative.body, 'data-creative-works="3"');
  expectPresent('…served from the cacheable media path', creative.body, '/creative-media/wrk_');
  expectPresent('an avatar', creative.body, '/creative-media/avatar-jun-');
  expectPresent('a cover banner (0071)', creative.body, 'data-creative-cover="photo"');
  const coverPath = /\/creative-media\/cover-jun-[0-9a-f]{16,32}\.jpg/.exec(creative.body)?.[0];
  const cover = coverPath ? await get(coverPath) : null;
  expectEqual('…which streams', cover?.status, 200);
  expectEqual('…as an image', cover?.contentType, 'image/jpeg');
  expectPresent('…publicly cacheable', cover?.cacheControl ?? '', 'public');
  expectEqual('no "my cover" for an anonymous reader', (await get('/api/makers/media/cover-me')).status, 404);
  expectPresent('the email sits behind a button', creative.body, 'data-creative-email="hidden"');
  expectAbsent('…and never as text', creative.body, LOCAL_MAKER.publicEmail);
  expectAbsent('…or as a mailto', creative.body, `mailto:${LOCAL_MAKER.publicEmail}`);
  expectPresent('ProfilePage structured data', creative.body, '"@type":"ProfilePage"');
  expectPresent('the share button', creative.body, 'data-creative-share');
  const workPath = /\/creative-media\/wrk_[0-9a-f]{32}\.jpg/.exec(creative.body)?.[0];
  const work = workPath ? await get(workPath) : null;
  expectEqual('a public work streams', work?.status, 200);
  expectEqual('…as an image', work?.contentType, 'image/jpeg');
  expectPresent('…publicly cacheable', work?.cacheControl ?? '', 'public');
  expectEqual('an unknown work is a 404', (await get(`/creative-media/wrk_${'0'.repeat(32)}.jpg`)).status, 404);
  expectEqual('a malformed media name is a 404', (await get('/creative-media/..%2F..%2Fsecret.jpg')).status, 404);
  expectEqual('the studio preview path stays private', (await get(`/api/makers/media/wrk_${'0'.repeat(32)}`)).status, 404);
  expectEqual('no "my avatar" for an anonymous reader', (await get('/api/makers/media/avatar-me')).status, 404);

  console.log('\n/@handle — the short link');
  const short = await request('/@jun', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
  expectEqual('/@jun redirects', short.status, 307);
  expectEqual('…to the creative page', short.location?.replace(/^https?:\/\/[^/]+/, ''), '/en/makers/jun');
  const shortKo = await request('/ko/@jun');
  expectEqual('/ko/@jun keeps the language', shortKo.location?.replace(/^https?:\/\/[^/]+/, ''), '/ko/makers/jun');

  console.log('\n/{locale}/t/[slug] — the recipe opens for members only (§20.3)');
  const recipePage = await get(`/en/t/${LOCAL_RECIPE_SLUG}`);
  expectEqual('renders 200', recipePage.status, 200);
  expectPresent('the recipe section', recipePage.body, 'data-recipe-how');
  expectPresent('…with the creative\'s intro', recipePage.body, 'data-recipe-intro');
  expectPresent('…behind the members\' gate', recipePage.body, 'data-recipe-gate');
  expectPresent('…with the opening of step 1', recipePage.body, 'TEST ONLY · the person in');
  expectAbsent('…and never the rest of the prompt', recipePage.body, LOCAL_RECIPE_CANARY);
  expectAbsent('…nor a step tip', recipePage.body, 'TEST tip:');
  expectAbsent('…nor the closing line', recipePage.body, '태그해 주세요');
  expectAbsent('…and no clip section without guide', recipePage.body, 'data-recipe-clips');
  const anonRecipe = await get(`/api/renders/access?template=${LOCAL_RECIPE_SLUG}&locale=en`);
  expectEqual('the access answer renders 200', anonRecipe.status, 200);
  expectPresent('…with no recipe for a visitor', anonRecipe.body, '"recipe":null');
  expectAbsent('…and no prompt', anonRecipe.body, LOCAL_RECIPE_CANARY);
  expectPresent('…never cached publicly', anonRecipe.cacheControl ?? '', 'no-store');

  console.log('\n/api/mcp — the creative agent door');
  const mcp = await request('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  expectEqual('needs a creative token', mcp.status, 401);
  const forged = await request('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer twk_${'a'.repeat(40)}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expectEqual('…and refuses an unknown one', forged.status, 401);
  expectEqual('GET is not a session stream', (await get('/api/mcp')).status, 405);
  expectEqual('a handle with no maker page is a 404', (await get('/ko/makers/hana')).status, 404);
  expectEqual('an unknown handle is a 404', (await get('/en/makers/nobody_here')).status, 404);
  const sitemap = await get('/sitemap.xml');
  expectPresent('the maker page is in the sitemap', sitemap.body, '/ko/makers/jun</loc>');
  expectAbsent('…a handle without one is not', sitemap.body, '/makers/hana');
}

/** Public monthly outcomes, no per-template price table or account data. */
/**
 * docs/CAST-CATEGORIES.md §4·§5 — pets have their own section and page, each split into a labelled
 * 영상 rail and 이미지 rail; couples do not exist while TWINGS_COUPLE_TEMPLATES is off (the default,
 * and how this sweep runs). The local snapshot carries sample templates for both casts.
 */
async function sweepCastCategories(): Promise<void> {
  const couples = CAST_SENTINELS.filter((item) => item.cast === 'couple');
  const pets = CAST_SENTINELS.filter((item) => item.cast === 'pet');
  // Pets are off by default (TWINGS_PET_TEMPLATES): then they must not exist anywhere. Run the sweep
  // against a server built and started with the flag on, plus SWEEP_PET_TEMPLATES=on, for the pet screens.
  if (process.env.SWEEP_PET_TEMPLATES !== 'on') {
    for (const locale of ['en', 'ko'] as const) {
      console.log(`\n/${locale} — pets and couples off (the default)`);
      const home = await get(`/${locale}`);
      expectEqual('home renders 200', home.status, 200);
      expectAbsent('no cast section at all', home.body, 'data-cast-home');
      expectAbsent('…no door to the pet page', home.body, `href="/${locale}/pet"`);
      for (const item of [...pets, ...couples]) expectAbsent(`…no ${item.slug} card`, home.body, item.slug);
      expectEqual('the pet page is a 404', (await get(`/${locale}/pet`)).status, 404);
      expectEqual('the couple page is a 404', (await get(`/${locale}/couple`)).status, 404);
      for (const item of [...pets, ...couples]) expectEqual(`…and so is ${item.slug}`, (await get(`/${locale}/t/${item.slug}`)).status, 404);
    }
    for (const tab of ['/en/video', '/en/image']) {
      const page = await get(tab);
      expectAbsent(`${tab}: no cast rail`, page.body, 'data-cast-rail=');
      for (const item of [...pets, ...couples]) expectAbsent(`${tab}: no ${item.slug} card`, page.body, item.slug);
    }
    const sitemap = await get('/sitemap.xml');
    expectAbsent('the sitemap names no pet page', sitemap.body, '/pet<');
    expectAbsent('…no couple page', sitemap.body, '/couple<');
    expectAbsent('…and no sample pet or couple template', sitemap.body, 'sample-pet-');
    return;
  }
  for (const locale of ['en', 'ko'] as const) {
    console.log(`\n/${locale} — the pet section on the home, no couples`);
    const home = await get(`/${locale}`);
    expectEqual('home renders 200', home.status, 200);
    expectPresent('the cast sections sit under the gallery', home.body, 'data-cast-home');
    expectPresent('…a pet section', home.body, 'data-cast-section="pet"');
    expectPresent('…with a labelled video rail', home.body, 'data-cast-rail="pet-video"');
    expectPresent('…and a labelled image rail', home.body, 'data-cast-rail="pet-image"');
    expectPresent('…and a door to the pet page', home.body, `href="/${locale}/pet"`);
    {
      const section = home.body.indexOf('data-cast-home');
      const firstPet = home.body.indexOf('data-prompt-card="sample-pet-');
      if (firstPet > section && section > -1) ok('the gallery above holds no pet card', `${firstPet} > ${section}`);
      else fail('the gallery above holds no pet card', `first pet card at ${firstPet}, section at ${section}`);
    }
    expectAbsent('no couple section while the flag is off', home.body, 'data-cast-section="couple"');
    expectAbsent('…no door to it', home.body, `href="/${locale}/couple"`);
    for (const item of couples) expectAbsent(`…no couple card (${item.slug})`, home.body, item.slug);
    for (const item of CAST_SENTINELS) expectAbsent(`no recipe text on a card (${item.token})`, home.body, item.token);

    console.log(`\n/${locale}/pet — the pet page`);
    const pet = await get(`/${locale}/pet`);
    expectEqual('renders 200', pet.status, 200);
    expectPresent('is the pet page', pet.body, 'data-cast-page="pet"');
    expectPresent('…with the video rail', pet.body, 'data-cast-rail="pet-video"');
    expectPresent('…and the image rail', pet.body, 'data-cast-rail="pet-image"');
    expectPresent('…one pill row that jumps between them', pet.body, 'data-cast-jump');
    expectPresent('…a CollectionPage for search', pet.body, '"@type":"CollectionPage"');
    expectPresent('…self-canonical', pet.body, `/${locale}/pet"`);
    expectPresent('…and the GEO definition', pet.body, 'data-service-definition');
    expectAbsent('cards wear no price', pet.body, 'data-price-chip');
    if (locale === 'ko') expectAbsent('…not even the number', pet.body, '2,500원');
    for (const item of CAST_SENTINELS) expectAbsent(`no recipe text (${item.token})`, pet.body, item.token);
    expectAbsent('no couple card on the pet page', pet.body, 'sample-couple-');

    console.log(`\n/${locale}/couple — off`);
    expectEqual('the couple page is a 404 while the flag is off', (await get(`/${locale}/couple`)).status, 404);
    for (const item of couples) expectEqual(`…and so is ${item.slug}`, (await get(`/${locale}/t/${item.slug}`)).status, 404);
  }

  console.log('\n/en/video and /en/image — each tab keeps its own cast rail under the grid');
  const video = await get('/en/video');
  expectPresent('the video tab shows the pet video rail', video.body, 'data-cast-rail="pet-video"');
  expectAbsent('…not the pet image rail', video.body, 'data-cast-rail="pet-image"');
  const image = await get('/en/image');
  expectPresent('the image tab shows the pet image rail', image.body, 'data-cast-rail="pet-image"');
  expectAbsent('…not the pet video rail', image.body, 'data-cast-rail="pet-video"');
  for (const page of [video, image]) for (const item of couples) expectAbsent(`no couple card on a tab (${item.slug})`, page.body, item.slug);

  console.log('\n/en/t/sample-pet-studio-portrait — a pet-only template page');
  const petOnly = await get('/en/t/sample-pet-studio-portrait');
  expectEqual('renders 200', petOnly.status, 200);
  expectAbsent('no "my selfie" tile on a pet-only template', petOnly.body, 'data-selfie-tile');
  expectPresent('…the pet line instead', petOnly.body, 'One photo and your pet is the lead');
  expectAbsent('…no face photo guide', petOnly.body, 'data-template-photo-guide');
  expectAbsent('…and no face wording in its description', petOnly.body, 'with your own face using one photo');

  console.log('\n/sitemap.xml — the pet page, never the couple page');
  const sitemap = await get('/sitemap.xml');
  expectPresent('lists /ko/pet', sitemap.body, '/ko/pet<');
  expectAbsent('never /couple while off', sitemap.body, '/couple<');
  expectAbsent('…nor a couple template', sitemap.body, 'sample-couple-');
}

async function sweepPricingTemplates(): Promise<void> {
  console.log('\n/en/pricing + /ko/pricing — monthly plan comparison, anonymous');
  for (const locale of ['en', 'ko']) {
    const page = await get(`/${locale}/pricing`);
    expectEqual(`/${locale}/pricing renders 200`, page.status, 200);
    expectPresent('…with the upcoming monthly plan', page.body, 'data-pricing-subscription="preparing"');
    // §15.3-3: what is sold comes first — single films over the monthly teaser while monthly is preparing.
    expectPresent('…single films first', page.body, 'data-pricing-order="single-first"');
    expectAbsent('…no engine name on the price page', page.body, 'Seedance');
    expectAbsent('…no engine label either', page.body, 'SEEDANCE');
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
    for (const marker of ['data-campaign-hero', 'data-campaign-proof', 'data-brands', 'data-morphic-card', 'data-audience-switch']) {
      expectPresent(`/${locale}/brands carries ${marker}`, brand.body, marker);
    }
    // 2026-10-30 landing: the brand's own AI media engine. Hero film, learns your brand (three chapters), remix,
    // the work, local fixes, creator campaign, production + what comes next, blue closing.
    for (const marker of ['data-v7-hero', 'data-hero-film', 'data-hero-doors', 'data-v7-first', 'data-v7-remix', 'data-remix', 'data-v7-work', 'data-v7-finish', 'data-studio-assets', 'data-studio-vto', 'data-v7-campaign', 'data-campaign-scale', 'data-studio-feed', 'data-v7-production', 'data-production-service', 'data-v7-next', 'data-v7-closing']) {
      expectPresent(`/${locale}/brands carries ${marker}`, brand.body, marker);
    }
    expectPresent(`/${locale}/brands hero plays the blue-world film`, brand.body, '/reel/landing/v7/hero.mp4');
    expectEqual(`/${locale}/brands hero opens three doors`, (brand.body.match(/data-hero-door=/g) ?? []).length, 3);
    expectPresent(`/${locale}/brands shows the wide shot behind the local fixes`, brand.body, '/reel/landing/c-logo-wide.webp');
    expectPresent(`/${locale}/brands boxes the region it fixes`, brand.body, 'data-fix-box=');
    expectPresent(`/${locale}/brands closes beside nine images`, brand.body, 'data-closing-grid');
    expectPresent(`/${locale}/brands gives phones the 9:16 hero`, brand.body, '/reel/landing/v7/hero-phone.mp4');
    expectEqual(`/${locale}/brands shows three real local fixes`, (brand.body.match(/data-contrast-pair=/g) ?? []).length, 3);
    expectEqual(`/${locale}/brands offers two remix formats`, (brand.body.match(/data-remix-format=/g) ?? []).length, 2);
    expectEqual(`/${locale}/brands shows the runway's four real edits`, (brand.body.match(/data-remix-edit=/g) ?? []).length, 4);
    expectPresent(`/${locale}/brands remix starts from an attached look`, brand.body, '/reel/landing/v7/rx-attach-look.webp');
    expectEqual(`/${locale}/brands shows nine fashion looks`, (brand.body.match(/data-asset-look=/g) ?? []).length, 9);
    expectEqual(`/${locale}/brands shows six beauty shots`, (brand.body.match(/data-asset-cut=/g) ?? []).length, 6);
    expectEqual(`/${locale}/brands ships every ad in the HTML`, (brand.body.match(/data-asset-clip=/g) ?? []).length, 2);
    expectEqual(`/${locale}/brands pairs each ad with what it features`, (brand.body.match(/data-asset-ad-still=/g) ?? []).length, 2);
    expectPresent(`/${locale}/brands ships the perfume ad's product shot`, brand.body, '/reel/landing/highteen-product.webp');
    expectPresent(`/${locale}/brands ships the fashion film's outfit detail`, brand.body, '/reel/landing/ad-denim.webp');
    expectPresent(`/${locale}/brands offers the 4K hero to large screens`, brand.body, '/reel/landing/v7/hero-2160.mp4');
    for (const gone of ['data-v7-problem', 'data-v7-engine', 'data-v7-workflow']) expectAbsent(`/${locale}/brands retired ${gone}`, brand.body, gone);
    expectAbsent(`/${locale}/brands links no price estimate`, brand.body, 'pricing.yagiworkshop.xyz');
    expectAbsent(`/${locale}/brands makes no data-destruction promise`, brand.body, locale === 'ko' ? '즉시 파기' : 'deleted right after');
    for (const gone of ['data-studio-orbit', 'data-mood-tile', 'data-format-select', 'data-service-example']) {
      expectAbsent(`/${locale}/brands retired ${gone}`, brand.body, gone);
    }
    expectEqual(`/${locale}/brands never shows the retired client-packaging frames`, (brand.body.match(/reel\/studio\/[a-z]+-yagi/g) ?? []).length, 0);
    expectEqual(`/${locale}/brands uses no YAGI red`, (brand.body.match(/ed1e1e/gi) ?? []).length, 0);
    // Landing media slots: with no override every image is its own file under /reel/.
    expectEqual(`/${locale}/brands shows its own files when nothing is replaced`, (brand.body.match(/\/api\/landing-media\//g) ?? []).length, 0);
    expectAbsent(`/${locale}/brands has no hidden service tabs`, brand.body, 'data-use-case-select');
    expectAbsent(`/${locale}/brands has no misplaced workspace card`, brand.body, 'data-brand-workspace-entry');
    // 2026-10-30: the Morphic case is one compact card on the landing; the full story lives on its own page.
    expectAbsent(`/${locale}/brands no longer embeds the customer story`, brand.body, 'data-customer-story=');
    expectPresent(`/${locale}/brands names the founder-approved client`, brand.body, 'Morphic');
    expectPresent(`/${locale}/brands links the Morphic story page`, brand.body, `href="/${locale}/brands/stories/morphic"`);
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
    expectAbsent(`/${locale}/brands does not send case visitors to Morphic`, brand.body, 'href="https://morphic.com/');
    expectAbsent(`/${locale}/brands removes the generic Morphic guide`, brand.body, 'make-90s-street-style-interview-video');
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
    expectEqual(`/${locale}/brands/stories/morphic shows real August film links`, (story.body.match(/href="https:\/\/www.instagram.com\/p\/(?:DcXjygPg8fE|DcShoikJklw)\/"/g) ?? []).length >= 2, true);
    for (const code of ['DdqhUUvRUik', 'DdqirU_yjr-', 'Dd1CiCDSlix', 'Dd0VQJaz8h-']) {
      expectPresent(`/${locale}/brands/stories/morphic links the published September original ${code}`, story.body, `href="https://www.instagram.com/p/${code}/"`);
    }
    expectPresent(`/${locale}/brands/stories/morphic self-canonicals`, story.body, `rel="canonical" href="${BASE}/${locale}/brands/stories/morphic"`);
    // Founder, 2026-10-28: the old caveat sentence stays out (05bab0d); the totals still say what they count.
    expectPresent(`/${locale}/brands/stories/morphic says what the totals count`, story.body, locale === 'ko' ? '2026년 8월 캠페인 누적 공개 집계입니다.' : 'Public campaign totals from August 2026.');
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

  // docs/ADMIN.md §7.1–7.3 — the render board, one render, the payment check and the user view are admin-only.
  for (const path of [
    '/admin/renders',
    '/admin/renders?status=failed',
    '/admin/renders/00000000-0000-4000-8000-000000000000',
    '/admin/payments',
    '/admin/users',
    '/admin/users?role=creative',
  ]) {
    const admin = await get(path);
    expectOneOf(`${path} refuses anon`, admin.status, [302, 307, 308, 404]);
    expectAbsent('…and leaks no render board', admin.body, 'data-admin-render-board');
    expectAbsent('…and no render detail', admin.body, 'data-admin-render-detail');
    expectAbsent('…and no payment check', admin.body, 'data-admin-payments');
    expectAbsent('…and no user directory', admin.body, 'data-admin-users');
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
  for (const path of ['/brand', '/brand/identity', `/brand/projects/${fixture.id}`, `/admin/brand-workspace/${fixture.id}`,
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
  // The studio's campaign preparation door (docs/BRAND-STAFF-ACCESS.md): admins only, and it does not confirm it exists.
  const studioForm = new FormData();
  studioForm.set('_op', 'brandWorkspace.createProject');
  const studioPrep = await request('/api/brand-workspace/studio', { method: 'POST', headers: { origin: base.origin }, body: studioForm });
  expectEqual('brand studio door answers anonymous posts with a bare 404', studioPrep.status, 404);
  expectEqual('brand studio door 404 has no body', studioPrep.body, '');
  expectEqual('brand studio door refusal is private no-store', studioPrep.cacheControl, 'private, no-store');
  // The workspace pages' nonce CSP, end to end: the page that opens without a session must carry the
  // policy, and Next.js must have stamped its nonce on every script it rendered.
  const invite = await get('/brand/invite');
  expectEqual('/brand/invite renders for anonymous visitors', invite.status, 200);
  const nonce = invite.csp?.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  const policy = invite.csp ?? '';
  if (nonce && policy.includes("'strict-dynamic'") && policy.includes("object-src 'none'") && policy.includes("base-uri 'none'")
    && policy.includes("frame-ancestors 'none'") && policy.includes("form-action 'self'") && !policy.includes('unsafe-eval'))
    ok('workspace page sends the strict nonce CSP');
  else fail('workspace page sends the strict nonce CSP', policy || 'no Content-Security-Policy header');
  const scripts = [...invite.body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expectEqual('workspace page has scripts to stamp', scripts.length > 0, true);
  expectEqual('every script on a workspace page carries the nonce', scripts.filter((tag) => !nonce || !tag.includes(`nonce="${nonce}"`)).length, 0);
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
  // docs/PLATFORM-2.0.md §5.3 — a device's push subscription needs a session, even from our own page.
  // A well-formed body, so the 401 shows the session check comes first. The browser keys are made
  // here, never written as literals (the secret scan reads long base64url strings as leaked keys).
  const browserKey = createECDH('prime256v1');
  browserKey.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/sweep', keys: { p256dh: browserKey.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const pushOn = await request('/api/notify/push', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });
  expectEqual('push subscription refuses anon', pushOn.status, 401);
  expectPresent('…privately', pushOn.cacheControl ?? '', 'no-store');
  const pushOff = await request('/api/notify/push', { method: 'DELETE', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
  expectEqual('push unsubscribe refuses anon', pushOff.status, 401);
  const campaignEnqueue = await fetch(`${BASE}/api/campaign-production`, { method: 'POST', redirect: 'manual', headers: { Origin: BASE } });
  expectEqual('campaign production refuses anon', campaignEnqueue.status, 401);
  expectPresent('campaign production refusal is private', campaignEnqueue.headers.get('cache-control') ?? '', 'no-store');
  const collaboration = await request('/api/campaign-collaboration', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
  expectEqual('campaign collaboration refuses anonymous writes', collaboration.status, 401);
  expectPresent('campaign collaboration refusal is private', collaboration.cacheControl ?? '', 'no-store');
  const funding = await request('/api/campaign-funding', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
  expectEqual('campaign funding refuses anonymous writes', funding.status, 401);
  expectPresent('campaign funding refusal is private', funding.cacheControl ?? '', 'no-store');
  const fundingStatus = await request('/api/campaign-funding');
  expectEqual('campaign funding conceals order status from anonymous', fundingStatus.status, 401);
  expectPresent('campaign funding status is private', fundingStatus.cacheControl ?? '', 'no-store');
  const participantFile = await request(`/api/campaign-collaboration/files/${ID}`);
  expectEqual('participant file conceals existence from anonymous', participantFile.status, 404);
  expectEqual('participant file returns no bytes to anonymous', participantFile.bytes.length, 0);
  expectPresent('participant file refusal is private', participantFile.cacheControl ?? '', 'no-store');
  for (const path of [`/campaigns/participations/${ID}`]) {
    const participantPage = await request(path, { headers: { 'user-agent': CHROME_UA } });
    expectOneOf(`${path} redirects anonymous`, participantPage.status, [302, 303, 307]);
    expectPresent(`${path} redirects to sign-in`, participantPage.location ?? '', 'signin=1');
  }
  const invitationLanding = await request('/campaigns/fixture-campaign/join', { headers: { 'user-agent': CHROME_UA } });
  expectEqual('campaign invitation landing can preserve a fragment before sign-in', invitationLanding.status, 200);
  expectPresent('campaign invitation landing is private and uncached', invitationLanding.cacheControl ?? '', 'no-store');
  expectPresent('campaign invitation landing is not indexed', invitationLanding.robotsTag ?? '', 'noindex');
  for (const action of ['claim', 'complete', 'heartbeat', 'slack']) {
    const worker = await request(`/api/campaign-risk-worker/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expectEqual(`campaign risk ${action} rejects unsigned requests`, worker.status, 404);
    expectPresent(`campaign risk ${action} refusal is private`, worker.cacheControl ?? '', 'no-store');
  }
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
  // docs/IDENTITY-SELFIE.md — the one photo is app surface; its bytes and state are owner-only.
  const selfiePage = await request('/identity/selfie', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('selfie page redirects anonymous', selfiePage.status, [302,303,307]);
  expectPresent('selfie page redirects to sign-in', selfiePage.location ?? '', 'signin=1');
  const selfieState = await request('/api/identity/selfie');
  expectEqual('selfie state refuses anonymous', selfieState.status, 401);
  expectPresent('selfie response is private', selfieState.cacheControl ?? '', 'no-store');
  const selfieImage = await request('/api/identity/selfie/00000000-0000-4000-8000-000000000000/image');
  expectEqual('selfie image refuses anonymous', selfieImage.status, 401);
  expectPresent('selfie image response is private', selfieImage.cacheControl ?? '', 'no-store');
  const selfieCreate = await fetch(`${BASE}/api/identity/selfie`, {method:'POST',headers:{origin:BASE}});
  expectEqual('selfie upload refuses anonymous', selfieCreate.status, 401);
  const selfieCross = await fetch(`${BASE}/api/identity/selfie`, {method:'POST',headers:{origin:'https://evil.example'}});
  expectEqual('selfie upload refuses cross-origin', selfieCross.status, 403);
  // docs/IDENTITY-SELFIE.md §4 — "make default", the note and soft delete are owner-only, same-origin writes.
  for (const method of ['PATCH', 'DELETE'] as const) {
    const body = JSON.stringify(method === 'PATCH' ? {id:'00000000-0000-4000-8000-000000000000',isDefault:true} : {id:'00000000-0000-4000-8000-000000000000'});
    const anonymous = await request('/api/identity/selfie', {method,headers:{origin:BASE,'content-type':'application/json'},body});
    expectEqual(`selfie ${method} refuses anonymous`, anonymous.status, 401);
    expectPresent(`selfie ${method} response is private`, anonymous.cacheControl ?? '', 'no-store');
    const cross = await request('/api/identity/selfie', {method,headers:{origin:'https://evil.example','content-type':'application/json'},body});
    expectEqual(`selfie ${method} refuses cross-origin`, cross.status, 403);
    expectPresent(`selfie ${method} cross-origin response is private`, cross.cacheControl ?? '', 'no-store');
  }
  // docs/PLATFORM-2.0.md §17 — linked SNS accounts: app surface, owner-only screenshots, a worker door shut without its secret.
  const socialPage = await request('/identity/social', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('SNS page redirects anonymous', socialPage.status, [302,303,307]);
  expectPresent('SNS page redirects to sign-in', socialPage.location ?? '', 'signin=1');
  const socialState = await request('/api/identity/social');
  expectOneOf('SNS state refuses anonymous (closed or sign-in)', socialState.status, [401,404]);
  expectPresent('SNS state response is private', socialState.cacheControl ?? '', 'no-store');
  const socialCross = await fetch(`${BASE}/api/identity/social`, {method:'POST',headers:{origin:'https://evil.example'}});
  expectOneOf('SNS submit refuses cross-origin (closed or forbidden)', socialCross.status, [403,404]);
  const socialShot = await request('/api/identity/social/00000000-0000-4000-8000-000000000000/evidence');
  expectEqual('SNS screenshot refuses anonymous', socialShot.status, 401);
  expectPresent('SNS screenshot response is private', socialShot.cacheControl ?? '', 'no-store');
  const socialAdminShot = await request('/api/admin/social/00000000-0000-4000-8000-000000000000/evidence');
  expectEqual('SNS review screenshot hides from anonymous', socialAdminShot.status, 404);
  for (const action of ['claim', 'complete', 'heartbeat', 'evidence']) {
    const worker = await request(`/api/social-verify-worker/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expectEqual(`SNS worker ${action} rejects unsigned requests`, worker.status, 404);
    expectPresent(`SNS worker ${action} refusal is private`, worker.cacheControl ?? '', 'no-store');
  }
  const poolInvite = await request('/api/brand-creators', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
  expectOneOf('creator pool invite refuses anonymous (closed or sign-in)', poolInvite.status, [401, 404]);
  expectPresent('creator pool invite refusal is private', poolInvite.cacheControl ?? '', 'no-store');
  const openCampaigns = await request('/campaigns/open', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('signed-in campaign list redirects anonymous', openCampaigns.status, [302,303,307]);
  expectPresent('signed-in campaign list redirects to sign-in', openCampaigns.location ?? '', 'signin=1');
  const selfieOrder = await fetch(`${BASE}/api/billing/toss/orders`, {method:'POST',headers:{origin:BASE},body:new FormData()});
  expectEqual('toss order without a session refuses', selfieOrder.status, 401);
  expectEqual('the identity callback answers a bare hit with a redirect', callback.status, 303);
  expectPresent('…to the verify page, result unknown', callback.location ?? '', '/identity/verify?result=unknown');

  const community = await request('/community', { headers: { 'user-agent': CHROME_UA } });
  expectOneOf('private content conversations redirect anonymous', community.status, [302,303,307]);
  const communityState = await request('/api/community');
  expectEqual('community state refuses anonymous', communityState.status, 401);
  expectPresent('community response is private', communityState.cacheControl ?? '', 'no-store');
  const communityCreate = await fetch(`${BASE}/api/community`, {method:'POST',headers:{origin:BASE,'content-type':'application/json'},body:'{}'});
  expectEqual('community mutation refuses anonymous', communityCreate.status, 401);
  // docs/CREATOR-PLATFORM.md — the format creator program. The two leaves are login-gated app
  // surface; the public page exists only while BOTH gates were on at build (same shell as start:local).
  for (const leaf of ['/creators/apply', '/creators/workspace']) {
    const gated = await request(leaf, { headers: { 'user-agent': CHROME_UA } });
    expectOneOf(`${leaf} redirects anonymous`, gated.status, [302, 303, 307]);
    expectPresent(`${leaf} → sign-in`, gated.location ?? '', 'signin=1');
    expectPresent(`${leaf} refusal is private`, gated.cacheControl ?? '', 'no-store');
    expectPresent(`${leaf} refusal is noindex`, gated.robotsTag ?? '', 'noindex');
  }
  const programBare = await request('/creators', { headers: { 'accept-language': 'ko' } });
  expectEqual('/creators is a public page: 308 to its locale', programBare.status, 308);
  expectPresent('…to /ko/creators', programBare.location ?? '', '/ko/creators');
  const programOpen = process.env.TWINGS_FORMAT_CREATORS === 'on' && process.env.TWINGS_CREATOR_APPLICATIONS === 'on';
  console.log(`  (format creator program gate in this shell: ${programOpen ? 'open' : 'closed'})`);
  for (const locale of ['ko', 'en']) {
    const program = await request(`/${locale}/creators`);
    if (!programOpen) { expectEqual(`/${locale}/creators is absent while intake is closed`, program.status, 404); continue; }
    expectEqual(`/${locale}/creators renders`, program.status, 200);
    expectPresent(`/${locale}/creators program marker`, program.body, 'data-creator-program');
    expectPresent(`/${locale}/creators steps marker`, program.body, 'data-creator-steps');
    expectAbsent(`/${locale}/creators carries no recipe canary`, program.body, 'PRIVATE_RECIPE');
    for (const sentinel of PROMPT_SENTINELS.filter((s) => !s.publicToAnon)) expectAbsent(`/${locale}/creators omits ${sentinel.slug} prompt`, program.body, sentinel.token);
  }
  const revision = await fetch(`${BASE}/api/community`, {method:'POST',headers:{origin:BASE,'content-type':'application/json'},body:JSON.stringify({action:'format',requestId:ID,revisionOf:ID})});
  expectEqual('format revision refuses anonymous', revision.status, 401);

  const evidence = await request(`/api/admin/community/${ID}/media`);
  expectEqual('reward evidence conceals existence from anonymous', evidence.status, 404);
  expectPresent('reward evidence response is private', evidence.cacheControl ?? '', 'no-store');

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
  await sweepAccountDeletion();
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
  await sweepMakers();
  await sweepCastCategories();


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
