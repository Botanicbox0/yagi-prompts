import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_TAG, CATALOG_TTL_SECONDS } from '@/lib/cache';
import { isAppPath, isCampaignAppPath, isCreatorProgramAppPath, isPlaybookDetailPath } from '@/lib/i18n/config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

function sourcesUnder(...parts: string[]): string[] {
  const base = join(ROOT, ...parts);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  // A folder git does not carry (an emptied `components/ad`) is absent in a fresh checkout: nothing to scan.
  if (existsSync(base)) walk(base);
  return out;
}

/**
 * PLAN §4 route table + §3.4 cache contract.
 *
 * Static marketing surfaces vs `force-dynamic` + `private, no-store` viewer-shaped surfaces is a
 * security property, not a performance preference: a cached gated page is a leak. These
 * assertions are cheap and fail loudly if someone flips a segment config by accident.
 */
describe('route cache modes (§3.4 / §4)', () => {
  it('keeps landing and pricing static with the catalog TTL floor', () => {
    for (const file of [
      ['app', '(marketing)', '[locale]', 'page.tsx'],
      ['app', '(marketing)', '[locale]', 'pricing', 'page.tsx'],
      ['app', '(marketing)', '[locale]', 'brands', 'page.tsx'],
      // docs/TEMPLATES-IA.md — the two tabs and the template detail: static, tagged, TTL-floored.
      // The detail can only be static because nothing on it is gated any more (the prompt text is
      // the studio's private recipe and never rendered).
      ['app', '(marketing)', '[locale]', 'video', 'page.tsx'],
      ['app', '(marketing)', '[locale]', 'image', 'page.tsx'],
      ['app', '(marketing)', '[locale]', 't', '[slug]', 'page.tsx'],
      // docs/PLATFORM-2.0.md §7.5 — a public maker page reads the same tagged catalogue.
      ['app', '(marketing)', '[locale]', 'makers', '[handle]', 'page.tsx'],
    ]) {
      const source = read(...file);
      expect(source, file.join('/')).toContain(`export const revalidate = ${CATALOG_TTL_SECONDS}`);
      expect(source, file.join('/')).not.toContain("dynamic = 'force-dynamic'");
      // dynamic APIs would silently downgrade these to SSR
      expect(source, file.join('/')).not.toContain('next/headers');
    }
    expect(CATALOG_TAG).toBe('catalog');
  });

  /**
   * 2026-11-24: the video list filters by length and NEW, the image list by use case — all of it in
   * the browser over cards already in the HTML. Reading `searchParams` would opt these pages out of
   * the shared static document, so the filter state lives in the client (`lib/navigation/public-state.ts`).
   */
  it('video and image pages do not read searchParams', () => {
    // Comments may name the rule ("no `searchParams`"); only code counts.
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    for (const medium of ['video', 'image']) {
      const source = code(read('app', '(marketing)', '[locale]', medium, 'page.tsx'));
      expect(source, medium).toContain('export default');
      expect(source, medium).not.toContain('searchParams');
      expect(source, medium).not.toContain('useSearchParams');
    }
    expect(code(read('components', 'templates', 'listing.tsx'))).not.toContain('searchParams');
  });

  /**
   * M6 added a SECOND tagged projection (§13.2 tag `prompts`), so the static surfaces no longer
   * all read the same one: the landing reads both, pricing and the gallery count prompts. What has
   * not changed — and what this asserts — is that every static page reads a TAGGED, TTL-floored
   * projection rather than the database directly or a fixture shortcut.
   */
  it('reads the catalog through the tagged projections, not a fixture shortcut', () => {
    const expected: Array<[string[], string[]]> = [
      [
        ['app', '(marketing)', '[locale]', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'", "from '@/lib/campaigns/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'pricing', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'video', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'image', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 't', '[slug]', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'", "from '@/lib/campaigns/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'makers', '[handle]', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'"],
      ],
    ];
    for (const [file, imports] of expected) {
      for (const needle of imports) {
        expect(read(...file), `${file.join('/')} → ${needle}`).toContain(needle);
      }
    }

    for (const [projection, tag] of [
      [read('lib', 'content', 'public-catalog.ts'), 'tags: [CATALOG_TAG]'],
      [read('lib', 'prompts', 'public-catalog.ts'), 'tags: [PROMPTS_TAG]'],
    ]) {
      expect(projection).toContain('unstable_cache');
      expect(projection).toContain(tag!);
      expect(projection).toContain('revalidate: CATALOG_TTL_SECONDS');
    }
  });

  /**
   * Design review F4. The projections are `server-only` and unimportable here, so the wiring is a
   * source-level pin: both readers go through `readPublicProjection` (behaviour tested in
   * tests/db/read-policy.test.ts), and neither swallows a read failure into the designed empty
   * catalog any more — a swallowed outage was being ISR-cached for an hour as intentional design.
   */
  it('lets a prompts/contests catalog outage throw instead of caching as designed-empty', () => {
    for (const file of [read('lib', 'prompts', 'public-catalog.ts')]) {
      expect(file).toContain('readPublicProjection');
      expect(file).not.toContain('catch');
      expect(file).not.toContain('console.warn');
    }
  });

  /**
   * §3.1's cache mode is load-bearing, and the easiest way to lose it is a nav that renders
   * "Sign in / avatar" from the session: one `cookies()` anywhere in the marketing tree and both
   * pages become SSR. Authed chrome lives in the (app) group; the marketing nav is static.
   */
  it('never reads the session anywhere on the marketing surface', () => {
    const forbidden = [
      'next/headers',
      'getSessionUser',
      'auth-client',
      'data-client',
      'createDataClient',
    ];
    const files = [
      ...sourcesUnder('app', '(marketing)'),
      ...sourcesUnder('components', 'landing'),
      ...sourcesUnder('components', 'nav'),
      ...sourcesUnder('components', 'ad'),
      ...sourcesUnder('components', 'ui'),
      ...sourcesUnder('components', 'marketing'),
      ...sourcesUnder('components', 'motion'),
    ];
    expect(files.length).toBeGreaterThan(15);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        expect(source.includes(needle), `${relative(ROOT, file)} must not use ${needle}`).toBe(
          false,
        );
      }
    }
  });

  it('forces every viewer-shaped surface dynamic', () => {
    for (const file of [
      ['app', '(app)', 'layout.tsx'],
      ['app', '(app)', 'library', 'page.tsx'],
      // M2: the one locale-prefixed PUBLIC route that is shaped per viewer (§3.3).
      ['app', '(marketing)', '[locale]', 'p', '[slug]', 'page.tsx'],
      ['app', '(app)', 'account', 'page.tsx'],
      ['app', '(app)', 'billing', 'success', 'page.tsx'],
      ['app', '(app)', 'billing', 'cancelled', 'page.tsx'],
      // M3 additions to the §4 route table.
      ['app', '(app)', 'billing', 'upgrade', 'page.tsx'],
      ['app', 'api', 'billing', 'checkout', 'route.ts'],
      ['app', 'api', 'billing', 'portal', 'route.ts'],
      ['app', 'api', 'events', 'route.ts'],
      ['app', '(admin)', 'layout.tsx'],
      ['app', '(admin)', 'admin', 'page.tsx'],
      // M4: the rest of the CMS surface.
      ['app', 'api', 'admin', 'media', '[ref]', 'route.ts'],
      ['app', 'api', 'media', '[blockId]', 'route.ts'],
      ['app', 'api', 'stripe', 'webhook', 'route.ts'],
      // M6 §13.2: the copy endpoint (410 since 2026-09-05, still never cached) and the moderation queue.
      ['app', 'api', 'prompts', 'copy', '[id]', 'route.ts'],
      ['app', 'api', 'prompts', 'media', '[ref]', 'route.ts'],
      ['app', '(admin)', 'admin', 'prompts', 'page.tsx'],
      // M9 §14.2 (retired 2026-09-05): the admin screens stay for the data.
      ['app', '(admin)', 'admin', 'contests', 'page.tsx'],
      ['app', '(admin)', 'admin', 'contests', '[slug]', 'preview', 'page.tsx'],
      // docs/CAMPAIGNS.md §6: the apply form and "my campaigns" are login-gated and read the
      // viewer's own rows; the three admin screens are admin surface.
      ['app', '(app)', 'campaigns', '[slug]', 'apply', 'page.tsx'],
      ['app', '(app)', 'campaigns', 'mine', 'page.tsx'],
      // docs/TEMPLATES-IA.md §8 — the sign-in door, under the (app) root like the WebView interstitial.
      ['app', '(app)', 'auth', 'choose', 'page.tsx'],
      // docs/TEMPLATES-IA.md §8 — the render queue: the owner's pages, the 3-day link, its routes.
      ['app', '(app)', 'renders', 'page.tsx'],
      ['app', '(app)', 'renders', '[id]', 'page.tsx'],
      ['app', '(app)', 'r', '[id]', '[token]', 'page.tsx'],
      ['app', 'api', 'renders', 'route.ts'],
      ['app', 'api', 'renders', 'access', 'route.ts'],
      ['app', 'api', 'renders', 'tick', 'route.ts'],
      ['app', 'api', 'renders', 'callback', 'route.ts'],
      ['app', 'api', 'renders', 'media', '[id]', 'route.ts'],
      // docs/TEMPLATES-IA.md §8.2 — the face check and the bank's callback.
      ['app', '(app)', 'identity', 'verify', 'page.tsx'],
      ['app', 'api', 'identity', 'callback', 'route.ts'],
      ['app', '(admin)', 'admin', 'campaigns', 'page.tsx'],
      ['app', '(admin)', 'admin', 'campaigns', 'new', 'page.tsx'],
      ['app', '(admin)', 'admin', 'campaigns', '[id]', 'page.tsx'],
      // lib/content/landing-media.ts — the replace screen and the local-mode image route.
      ['app', '(admin)', 'admin', 'landing-media', 'page.tsx'],
      ['app', 'api', 'landing-media', '[...slot]', 'route.ts'],
      // The closed studio's "access request already sent" answer: per member, never cached.
      ['app', 'api', 'brand-workspace', 'access-request', 'route.ts'],
    ]) {
      expect(read(...file), file.join('/')).toMatch(/export const dynamic\s*=\s*(['"])force-dynamic\1/);
    }
  });

  /** M3: the money and analytics routes join the media gateway on `private, no-store` + noindex. */
  it('never lets a billing or analytics response enter a cache', () => {
    for (const file of [
      ['app', 'api', 'billing', 'checkout', 'route.ts'],
      ['app', 'api', 'billing', 'portal', 'route.ts'],
      ['app', 'api', 'events', 'route.ts'],
      ['app', 'api', 'stripe', 'webhook', 'route.ts'],
    ]) {
      const source = read(...file);
      expect(source, file.join('/')).toContain("'Cache-Control': 'private, no-store'");
      expect(source, file.join('/')).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    }
  });

  /**
   * §3.3 + §3.9 ask for two independent properties on `/[locale]/p/[slug]`: it must be INDEXABLE
   * (showcase revisions are the public SEO surface) and it must never be STORED (it is shaped per
   * viewer). Middleware is where the second one is enforced, and it must not pick up the app
   * surface's `noindex` on the way.
   */
  it('stamps no-store on the public detail routes without deindexing them', () => {
    const middleware = read('middleware.ts');
    expect(middleware).toContain('isPlaybookDetailPath(rest)');
    // docs/TEMPLATES-IA.md: the prompt and contest details that used to share this branch are
    // gone; the template detail is static because nothing on it is gated.
    expect(middleware).not.toContain('isPromptDetailPath');
    expect(middleware).not.toContain('isContestDetailPath');
    const detailBranch = middleware.slice(middleware.indexOf('isPlaybookDetailPath(rest)'));
    const branchBody = detailBranch.slice(0, detailBranch.indexOf('\n  }'));
    expect(branchBody).toContain("'Cache-Control', NO_STORE");
    expect(branchBody).not.toContain('X-Robots-Tag');
  });

  it('marks the app and admin surfaces noindex', () => {
    expect(read('app', '(app)', 'layout.tsx')).toContain('robots');
    expect(read('app', '(admin)', 'layout.tsx')).toContain('robots');
    expect(read('middleware.ts')).toContain("'X-Robots-Tag', 'noindex, nofollow'");
  });

  it('gates the admin surface on is_admin in the layout, not only at the edge', () => {
    const layout = read('app', '(admin)', 'layout.tsx');
    expect(layout).toContain('requireAdmin');
    expect(layout).toContain('notFound');
  });
});

/**
 * M2 replaced the media stub with the real gateway, which pulls in the service-role client and is
 * therefore `server-only` — it cannot be imported into a vitest process at all, by construction.
 * Its BEHAVIOUR is covered where it actually lives: `tests/media/*` drives the authorization chain
 * and the token scheme directly, and `npm run sweep:anon` drives the HTTP surface against a real
 * `next start`. What stays here is the cache contract itself, which is a source-level property.
 */
describe('media gateway cache + refusal contract (§3.3 / §3.4)', () => {
  const route = read('app', 'api', 'media', '[blockId]', 'route.ts');

  it('never lets a media response enter a cache, refusals included', () => {
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    expect(route).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    // every exit goes through the two helpers that carry HEADERS
    expect(route).not.toMatch(/new NextResponse\((?!null,|new Uint8Array)/);
  });

  it('speaks the full §3.3 refusal vocabulary', () => {
    for (const marker of ["refuse(404, 'not_found')", "refuse(401,", "refuse(403,"]) {
      expect(route, marker).toContain(marker);
    }
    expect(route).toContain('authorizeMedia');
    expect(route).toContain('verifyMediaToken');
  });

  it('forces workflow files to download rather than redirecting them (§3.3)', () => {
    expect(route).toContain("object.kind === 'workflow_file'");
    expect(route).toContain('Content-Disposition');
  });
});

/**
 * M3 replaced the 501 stub with the real webhook, which pulls in `lib/billing/service.ts` and is
 * therefore `server-only` — like the media gateway, it cannot be imported into a vitest process at
 * all. Its BEHAVIOUR lives where it can be tested: `tests/billing/*` drives the ledger, the fence
 * and the real signature verification directly. What belongs here is the source-level contract.
 */
describe('stripe webhook route contract (§3.4)', () => {
  const route = read('app', 'api', 'stripe', 'webhook', 'route.ts');

  it('verifies the signature before anything else touches the database', () => {
    expect(route).toContain('constructWebhookEvent');
    expect(route).toContain('StripeSignatureError');
    expect(route).toContain("json({ error: 'invalid_signature' }, 400)");
    // Signature verification is over RAW BYTES; `.json()` would re-serialise and never verify.
    expect(route).toContain('request.text()');
    expect(route).not.toContain('request.json()');
  });

  it('delegates the ledger semantics rather than reimplementing them', () => {
    expect(route).toContain('ingestEvent');
    expect(route).not.toContain('stripe_events');
  });

  it('degrades to 503 rather than crashing with no Stripe configured (§11)', () => {
    expect(route).toContain("json({ error: 'billing_not_configured' }, 503)");
  });
});

describe('the money CTAs never create a session on GET (§3.4)', () => {
  it('exposes checkout and portal as POST only', () => {
    for (const file of [
      ['app', 'api', 'billing', 'checkout', 'route.ts'],
      ['app', 'api', 'billing', 'portal', 'route.ts'],
    ]) {
      const source = read(...file);
      expect(source, file.join('/')).toContain('export async function POST');
      expect(source, file.join('/')).not.toContain('export async function GET');
    }
  });

  it('renders the checkout CTA as a form, not a link', () => {
    const cta = read('components', 'billing', 'upgrade-cta.tsx');
    expect(cta).toContain('method="post"');
    expect(cta).toContain('type="submit"');
  });
});

/**
 * M4. The admin CMS is `noindex` through the `(admin)` layout and `private, no-store` through
 * middleware (`/admin` is in APP_PREFIXES). Its own API route is NOT middleware-covered — the
 * matcher excludes `/api/*` — so it carries the same headers itself, exactly like `/api/media`.
 */
describe('admin CMS cache + gate contract (§3.4 / §3.8)', () => {
  it('keeps the admin media endpoint out of every cache, refusals included', () => {
    const route = read('app', 'api', 'admin', 'media', '[ref]', 'route.ts');
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    expect(route).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    expect(route).toContain('authorizeAdminMedia');
    expect(route).toContain('verifyMediaToken');
    // Staging bytes only, and never a bucket the public gateway serves from.
    expect(route).toContain('STAGING_BUCKET');
    expect(route).toContain("refuse(401, 'sign_in_required')");
    expect(route).toContain("refuse(403, 'admin_only')");
  });

  it('routes every admin mutation through one guarded door', () => {
    // 2026-08-14: the door moved from a server action to `POST /admin/do` — an action id is
    // build-scoped, and the founder's long-lived admin tab kept posting one the newest deployment
    // no longer knew. Same guard, same dispatcher, stable address.
    const route = read('app', '(admin)', 'admin', 'do', 'route.ts');
    expect(route).toContain('requireAdmin');
    expect(route).toContain('dispatchAdmin');
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    // POST is the only verb: a GET door would make every mutation a link a crawler can pull.
    expect(route).toContain('export async function POST');
    expect(route.match(/export async function (GET|PUT|PATCH|DELETE)/g)).toBeNull();
  });

  it('never lets the admin editor read the session outside the guard', () => {
    for (const file of sourcesUnder('components', 'admin')) {
      const source = readFileSync(file, 'utf8');
      for (const needle of ['getViewer', 'createDataClient', 'auth-client']) {
        expect(source.includes(needle), `${relative(ROOT, file)} must not use ${needle}`).toBe(
          false,
        );
      }
    }
  });
});

/**
 * M6 §13.2. Two new API routes with deliberately OPPOSITE cache postures, and the difference is
 * the whole doctrine:
 *
 *   `/api/prompts/copy/[id]`   per-viewer answer  ⇒ `private, no-store`, POST only, noindex
 *   `/api/prompts/media/[ref]` public marketing bytes, content-addressed ⇒ cacheable, GET
 *
 * Both routes are `server-only` (service-role client) and cannot be imported into vitest, so this
 * is a source-level contract exactly like the media gateway's above; the BEHAVIOUR lives in
 * `tests/prompts/access.test.ts` and in `npm run sweep:anon`.
 */
describe('prompts API contract (§13.2)', () => {
  const copy = read('app', 'api', 'prompts', 'copy', '[id]', 'route.ts');
  const media = read('app', 'api', 'prompts', 'media', '[ref]', 'route.ts');

  it('answers 410 for every copy request — the text no longer leaves the server (2026-09-05)', () => {
    expect(copy).toContain('status: 410');
    expect(copy).toContain("'Cache-Control': 'private, no-store'");
    expect(copy).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    expect(copy).not.toContain('authorizePromptCopy');
    expect(copy).not.toContain('getSqlRunner');
    expect(copy).toContain('export async function POST');
    expect(copy).not.toContain('export async function GET');
  });

  it('serves prompt media from the PUBLIC bucket only, for published rows only', () => {
    expect(media).toContain("asset.bucket !== 'public-content'");
    expect(media).toContain("row.status !== 'published'");
    // The key is read from the ROW, never from the request — there is no key parameter at all.
    expect(media).toContain('loadPromptById');
    expect(media).not.toContain('searchParams.get(\'key\')');
  });

  it('lets those public bytes be cached — they are content-addressed and tier-independent', () => {
    expect(media).toContain("'Cache-Control': 'public,");
    expect(media).toContain('immutable');
  });

});




/**
 * docs/CAMPAIGNS.md §6 — the campaigns surface's route contract, the contests one with a second
 * unprefixed leaf: the apply form (slug in the middle) and the creator's own `/campaigns/mine`.
 * Found the hard way on 2026-09-05: both pages built and both 308'd into `/ko/campaigns/…` → 404
 * until the edge learned them, which is what this block pins.
 */
describe('campaigns route contract (docs/CAMPAIGNS.md §6)', () => {
  it('gates exactly /campaigns/{slug}/apply and /campaigns/mine at the edge', () => {
    for (const path of ['/campaigns/seoul-94-reel/apply', '/campaigns/seoul-94-reel/apply/', '/campaigns/mine', '/campaigns/open']) {
      expect(isCampaignAppPath(path), path).toBe(true);
      expect(isAppPath(path), path).toBe(true);
    }
    for (const path of [
      '/campaigns',
      '/campaigns/seoul-94-reel',
      '/campaigns/seoul-94-reel/apply/extra',
      '/campaigns/mine/extra',
      '/campaigns/open/extra',
      '/ko/campaigns/open',
      '/en/campaigns',
      '/en/campaigns/seoul-94-reel',
      '/ko/campaigns/mine',
    ]) {
      expect(isCampaignAppPath(path), path).toBe(false);
      expect(isAppPath(path), path).toBe(false);
    }
  });

  it('routes the application through one server action that never trusts the form', () => {
    const action = read('app', '(app)', 'campaigns', '[slug]', 'apply', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    expect(action).toContain('applyToCampaign');
    expect(action.match(/export async function/g)).toHaveLength(1);

    // Exactly the fields a creator owns (plus the slug, which grants nothing — the service
    // re-resolves the campaign and refuses anything not public). Status, creator id, selection,
    // payout and reject reason are supplied by `lib/campaigns/service.ts` and the admin operations.
    const readFields = [...action.matchAll(/(?:str|text|bool|file)\(form, '([^']+)'\)/g)].map((match) => match[1]!);
    expect([...new Set(readFields)].sort()).toEqual(['consent', 'followerCount', 'pitch', 'rememberSns', 'slug', 'snsUrl']);
    for (const forbidden of ['status', 'creatorId', 'userId', 'payoutCents', 'rejectReason', 'campaignId', 'version']) {
      expect(action.includes(`form, '${forbidden}'`), forbidden).toBe(false);
      expect(action.includes(`form.get('${forbidden}')`), forbidden).toBe(false);
    }
  });

  it('lets the creator name only the post link and the view count on their own rows', () => {
    const actions = read('app', '(app)', 'campaigns', 'mine', 'actions.ts');
    expect(actions).toContain("'use server'");
    expect(actions).toContain('submitCampaignPost');
    expect(actions).toContain('reportCampaignViews');
    const readFields = [...actions.matchAll(/(?:str|text|bool|file)\(form, '([^']+)'\)/g)].map((match) => match[1]!);
    expect([...new Set(readFields)].sort()).toEqual(['id', 'postUrl', 'views']);
    // Ownership is decided in the service by creator id, never by a field.
    expect(actions.includes("form, 'creatorId'")).toBe(false);
    expect(actions.includes("form, 'status'")).toBe(false);
  });
});

/**
 * docs/CREATOR-PLATFORM.md — the format creator program: a public `/{locale}/creators` page and two
 * unprefixed login-gated leaves. Without the edge pattern both leaves would 308 into a locale 404.
 */
describe('format creator program route contract', () => {
  it('gates exactly /creators/apply and /creators/workspace at the edge', () => {
    for (const path of [
      '/creators/apply',
      '/creators/apply/',
      '/creators/workspace',
      '/creators/workspace/',
      '/creators/workspace/formats/new',
      '/creators/workspace/formats/11111111-1111-4111-8111-111111111111',
      '/creators/workspace/posts/new',
      '/creators/workspace/posts/11111111-1111-4111-8111-111111111111',
    ]) {
      expect(isCreatorProgramAppPath(path), path).toBe(true);
      expect(isAppPath(path), path).toBe(true);
    }
    for (const path of [
      '/creators',
      '/creators/',
      '/ko/creators',
      '/en/creators/apply',
      '/creators/workspace/extra',
      '/creators/applyx',
      '/creators/workspace/formats/other',
      '/creators/workspace/formats/',
      '/creators/workspace/posts/other',
      '/creators/workspace/posts/',
    ]) {
      expect(isCreatorProgramAppPath(path), path).toBe(false);
      expect(isAppPath(path), path).toBe(false);
    }
  });

  it('routes an application through one server action that resolves the viewer and its own gates', () => {
    const action = read('app', '(app)', 'creators', 'apply', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    expect(action).toContain('platformAccess');
    expect(action).toContain('submitCreatorApplication');
    // One boundary, two entry points: the hydrated call and the native POST before hydration/without JS.
    expect(action.match(/export async function \w+/g)).toEqual(['export async function submitApplicationAction', 'export async function submitApplicationForm']);
    expect(action.match(/submitCreatorApplication\(/g)).toHaveLength(1);
    for (const forbidden of ['userId:', 'status:', 'isAdmin:', 'decision']) expect(action.includes(forbidden), forbidden).toBe(false);
  });

  it('keeps the application and workspace private and dynamic, the program page static', () => {
    for (const leaf of ['apply', 'workspace']) {
      expect(read('app', '(app)', 'creators', leaf, 'page.tsx')).toContain("export const dynamic = 'force-dynamic'");
    }
    const program = read('app', '(marketing)', '[locale]', 'creators', 'page.tsx');
    expect(program).toContain('export const revalidate = 3600');
    expect(program).toContain('creatorProgramOpen');
    expect(program).toContain('notFound');
  });
});

/**
 * M5 turns the notification surface ON. These are the same assertions inverted — the M4 versions
 * pinned "none of this exists yet", and flipping them is the point of the milestone. What has NOT
 * changed is the shape of the switch: `p_notify_kind` still reaches the RPC through exactly one
 * expression, so "notifications are off" stays a one-line, greppable property.
 */
describe('notification surface (§3.5, M5)', () => {
  it('flips the server flag that gates every notification path', () => {
    expect(read('lib', 'flags.ts')).toContain('export const NOTIFICATIONS_ENABLED = true');
  });

  it('still routes p_notify_kind through the one flagged expression', () => {
    expect(read('lib', 'publish', 'pipeline.ts')).toContain(
      'NOTIFICATIONS_ENABLED ? (args.notifyKind ?? null) : null',
    );
  });

  it('puts the two toggles on /account behind a server action', () => {
    const account = read('app', '(app)', 'account', 'page.tsx');
    expect(account).toContain('type="checkbox"');
    expect(account).toContain('saveNotificationPreferences');
    // The columns are named in `lib/notify/preferences.ts`, never inline in a page.
    for (const column of ['notif_new_playbook', 'notif_updates']) {
      expect(account, column).not.toContain(column);
    }

    const action = read('app', '(app)', 'account', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    // Identity from the session, never from the form.
    expect(action).not.toContain("form.get('userId')");
    expect(action).toContain('export async function saveNotificationPreferences');
    expect(action).toContain('export async function saveCreatorProfile');
    expect(action.match(/export async function/g)).toHaveLength(2);
  });

  it('gives the admin publish form a notify checkbox but never a kind picker', () => {
    const panel = read('components', 'admin', 'editor-panels.tsx');
    expect(panel).toContain('name="notify"');
    // The kind is derived in `lib/admin/playbook-operations.ts` from `published_revision_id`.
    expect(panel).not.toContain('new_playbook');
    expect(panel).not.toContain('playbook_update');
    const opsSource = [
      read('lib', 'admin', 'operations.ts'),
      read('lib', 'admin', 'playbook-operations.ts'),
    ].join('\n');
    expect(opsSource).toContain('notifyKindFor(');
  });

  it('keeps the unsubscribe endpoint out of every cache and every index', () => {
    const route = read('app', 'api', 'notify', 'unsubscribe', 'route.ts');
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    expect(route).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    expect(route).toContain('verifyUnsubscribeToken');
    // GET for the link a person clicks. POST only for RFC 8058 one-click (the live mailer's
    // `List-Unsubscribe-Post` header): same token, same write, no page — and the same no-store headers.
    // Its behaviour per scope is pinned in tests/brand-rooms/notices/one-click.test.ts.
    expect(route).toContain('export async function GET');
    expect(route).toContain('export async function POST');
    expect(route).toContain("'Cache-Control': HEADERS['Cache-Control']!");
    expect(route).toContain("'X-Robots-Tag': HEADERS['X-Robots-Tag']!");
  });
});

/**
 * M5 SEO. The sitemap reads the SAME tagged projection the marketing pages read, so a publish
 * invalidates all three together; robots and the sitemap must agree on what is public.
 */
describe('sitemap + robots (§8 M5)', () => {
  it('builds the sitemap from the cached catalog with the catalog TTL floor', () => {
    const sitemap = read('app', 'sitemap.ts');
    expect(sitemap).toContain("from '@/lib/content/public-catalog'");
    // Next parses segment config statically, so this one is a literal — kept in step here.
    expect(sitemap).toContain(`export const revalidate = ${CATALOG_TTL_SECONDS}`);
  });

  it('disallows exactly the noindex surfaces the route table lists', () => {
    const seo = read('lib', 'seo', 'sitemap.ts');
    for (const path of ['/admin', '/library', '/account', '/billing', '/api']) {
      expect(seo, path).toContain(`'${path}'`);
    }
  });

  /**
   * Regression from the M5 sweep: both crawler endpoints live at the ROOT and are therefore
   * unprefixed public URLs — precisely what middleware 308-redirects into a locale. Without the
   * exclusion, `/sitemap.xml` answered 308 → `/en/sitemap.xml` → 404, and the site had no sitemap.
   */
  it('exempts the crawler endpoints from the locale redirect', () => {
    const policy = read('lib', 'routing', 'surfaces.ts');
    expect(policy).toContain('sitemap\\.xml');
    expect(policy).toContain('robots\\.txt');
  });
});

/**
 * docs/TEMPLATES-IA.md (2026-09-05) — the template surface's route contract, and the prompt site's
 * retirement pinned so it cannot creep back: the old paths redirect, the old leaves are not gated
 * any more (there is nothing behind them), and the pricing page never learned the viewer.
 */
describe('templates route contract (docs/TEMPLATES-IA.md)', () => {
  it('redirects every prompt-site URL onto the template site, permanently', () => {
    const config = read('next.config.ts');
    for (const [source, destination] of [
      ['/:locale(en|ko)/studio', '/:locale/video'],
      ['/:locale(en|ko)/prompts', '/:locale/video'],
      ['/:locale(en|ko)/prompts/:slug', '/:locale/t/:slug'],
      ['/:locale(en|ko)/contests', '/:locale/campaigns'],
      ['/:locale(en|ko)/contests/:slug', '/:locale/campaigns'],
      ['/prompts/submit', '/en/video'],
      ['/contests/:slug/submit', '/en/campaigns'],
    ]) {
      expect(config, source).toContain(`{ source: '${source}', destination: '${destination}', permanent: true }`);
    }
  });

  it('no longer gates the retired leaves at the edge — they are redirects now', () => {
    for (const path of ['/prompts/submit', '/contests/launch-film-contest/submit']) {
      expect(isAppPath(path), path).toBe(false);
    }
    // …while the surfaces that are still app surface are still gated.
    for (const path of ['/account', '/library', '/admin/prompts', '/campaigns/mine']) {
      expect(isAppPath(path), path).toBe(true);
    }
  });

  it('keeps pricing static and session-free, with public examples and authoritative plan quotes', () => {
    const pricing = read('app', '(marketing)', '[locale]', 'pricing', 'page.tsx');
    expect(pricing).toContain("from '@/lib/prompts/public-catalog'");
    expect(pricing).toContain("from '@/lib/twings/subscription-plan'");
    expect(pricing).toMatch(/\bquoteSubscriptionVideo\(/);
    expect(pricing).not.toMatch(/\bpriceRangeFor\(/);
    for (const needle of ['getWallet', 'getViewer', 'CookieTable', 'next/headers']) {
      expect(pricing.includes(needle), `pricing must not use ${needle}`).toBe(false);
    }
  });

  it('never renders the prompt text on the template page', () => {
    const page = read('app', '(marketing)', '[locale]', 't', '[slug]', 'page.tsx');
    for (const needle of ['promptText', 'getShapedPrompt', 'PromptBody', 'unlockPromptAction', 'PromptCopyButton']) {
      expect(page.includes(needle), `template page must not use ${needle}`).toBe(false);
    }
    // The card projection is the only source, and it has no text field (tests/prompts/catalog.test.ts).
    expect(page).toContain('getPromptCatalog');
  });

  it('gates nothing new: the nav offers only the template tabs, campaigns and pricing', () => {
    const chrome = read('components', 'marketing', 'chrome.tsx');
    expect(chrome).toContain("templatesHref(locale, 'video')");
    expect(chrome).toContain("templatesHref(locale, 'image')");
    expect(chrome).toContain('campaignsHref(locale)');
    for (const needle of ['/studio', 'contestsHref', 'promptsHref(locale)']) {
      expect(chrome.includes(needle), `nav must not offer ${needle}`).toBe(false);
    }
  });
});

/**
 * docs/TEMPLATES-IA.md §8 — two OAuth doors. The sign-in handler never trusts the provider string:
 * anything outside the vocabulary lands on the chooser, and only Google is routed through the
 * embedded-WebView interstitial (Kakao's login works inside KakaoTalk's own browser).
 */
describe('sign-in doors (Google + Kakao)', () => {
  it('routes an unnamed or unknown provider to the chooser and the named ones to Supabase', () => {
    const route = read('app', 'auth', 'signin', 'route.ts');
    expect(route).toContain('isAuthProvider(rawProvider)');
    expect(route).toContain('chooseProviderHref(next, locale)');
    expect(route).toContain('needsRealBrowser(provider) && isEmbeddedWebView');
    expect(route).toMatch(/signInWithOAuth\(\{\s*provider,/); // CRLF-safe: the shape, not the line ending
    expect(route).not.toContain("provider: 'google'");
  });

  it('lists Google first, Kakao second, in both languages (founder, 2026-09-06)', async () => {
    const { providersForLocale, isAuthProvider, needsRealBrowser } = await import('@/lib/auth/providers');
    expect(providersForLocale('ko')).toEqual(['google', 'kakao']);
    expect(providersForLocale('en')).toEqual(['google', 'kakao']);
    expect(isAuthProvider('naver')).toBe(false);
    expect(needsRealBrowser('kakao')).toBe(false);
    expect(needsRealBrowser('google')).toBe(true);
  });

  it('shapes the chooser as a door, not a landing: continue-with labels and the consent line with both legal links', () => {
    const page = read('app', '(app)', 'auth', 'choose', 'page.tsx');
    expect(page).toContain('dict.auth.continueWithGoogle');
    expect(page).toContain('dict.auth.continueWithKakao');
    expect(page).toContain("legalHref(locale, 'terms')");
    expect(page).toContain("legalHref(locale, 'privacy')");
    expect(page).not.toContain('startWithKakao');
    expect(page).not.toContain('chooseBody');
  });
});

/**
 * docs/TEMPLATES-IA.md §8 — the render queue. The owner's pages sit behind the session gate, the
 * 3-day link is public by token and never enters middleware (no locale redirect, no gate), every
 * route is `private, no-store`, and the enqueue request runs the pass AFTER its response.
 */
describe('render queue (docs/TEMPLATES-IA.md §8)', () => {
  it('gates the owner pages at the edge and keeps the 3-day link outside middleware', () => {
    expect(isAppPath('/renders')).toBe(true);
    expect(isAppPath('/renders/11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isAppPath('/r/11111111-1111-4111-8111-111111111111/token')).toBe(false);
    expect(isAppPath('/identity/verify')).toBe(true);
    // Host checks now cover every request. Token links still skip locale/session work only
    // after that boundary; excluding them in the matcher would expose them on brand/admin hosts.
    expect(read('middleware.ts')).toContain('bypassConsumerLocale(pathname)');
    expect(read('lib', 'routing', 'surfaces.ts')).toContain('auth\\/|r\\/');
  });

  it('keeps every render surface out of the index and on the daily tick', () => {
    const sitemap = read('lib', 'seo', 'sitemap.ts');
    expect(sitemap).toContain("'/renders'");
    expect(sitemap).toContain("'/r/'");
    const vercel = JSON.parse(read('vercel.json')) as { crons?: Array<{ path: string; schedule: string }> };
    expect(vercel.crons).toEqual([
      { path: '/api/renders/tick', schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) },
      { path: '/api/brands/inquiries/tick', schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) },
      // Project room notices (docs/BRAND-ROOMS-FEEDBACK.md §2.2): every 10 minutes, which needs Vercel Pro
      // (docs/SCALE-RISKS-2026-11.md R-02). The bundled mail's 10-minute wait is measured on this tick.
      { path: '/api/brand-rooms/notices/tick', schedule: '*/10 * * * *' },
      // Brand B2B recurring billing (docs/BRAND-RECURRING-BILLING.md §14, B1a): hourly.
      { path: '/api/brand-billing/tick', schedule: '0 * * * *' },
    ]);
  });

  it('never lets a render response enter a cache, refusals included', () => {
    for (const file of [
      ['app', 'api', 'renders', 'route.ts'],
      ['app', 'api', 'renders', 'access', 'route.ts'],
      ['app', 'api', 'renders', 'tick', 'route.ts'],
      ['app', 'api', 'renders', 'callback', 'route.ts'],
      ['app', 'api', 'renders', 'media', '[id]', 'route.ts'],
      ['app', 'api', 'identity', 'callback', 'route.ts'],
    ]) {
      const source = read(...file);
      expect(source, file.join('/')).toContain("'Cache-Control': 'private, no-store'");
      expect(source, file.join('/')).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    }
  });

  it('runs the pass after the enqueue response, inside the function budget, and gates the tick on the cron secret', () => {
    const enqueue = read('app', 'api', 'renders', 'route.ts');
    expect(enqueue).toContain('export const maxDuration = 300');
    expect(enqueue).toMatch(/after\(async \(\) => \{/);
    expect(enqueue).toContain("json({ ok: true, id: outcome.id, href: renderHref(outcome.id), held: false }, 201)");
    // Held behind the face check: the answer names the door and no pass runs (docs §8.2, 0020).
    expect(enqueue).toContain('if (outcome.held) {');
    expect(enqueue).toContain('verifyHref: identityVerifyHref(renderHref(outcome.id))');
    const tick = read('app', 'api', 'renders', 'tick', 'route.ts');
    expect(tick).toContain('export const maxDuration = 300');
    expect(tick).toContain('process.env.CRON_SECRET');
    // The gate lives in the service, and the UI only asks about it.
    expect(read('lib', 'renders', 'service.ts')).toContain('RENDER_PIPELINE_PUBLIC');
    expect(read('components', 'twings', 'studio.tsx')).not.toContain('RENDER_PIPELINE_PUBLIC');
  });
});
