import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_TAG, CATALOG_TTL_SECONDS } from '@/lib/cache';
import {
  isAppPath,
  isContestDetailPath,
  isContestSubmitPath,
  isPlaybookDetailPath,
  isPromptDetailPath,
} from '@/lib/i18n/config';

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
  walk(base);
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
      // §13.2 — the prompts gallery joins them: static, tagged, TTL-floored. It can only be
      // static because its card projection carries zero gated bytes.
      ['app', '(marketing)', '[locale]', 'prompts', 'page.tsx'],
      // §14.2 — and the contests listing, for a related but distinct reason: nothing on it varies
      // by reader at all, and the one thing that varies (the phase) is derived at RENDER time from
      // a projection that stores dates, so an ISR regeneration re-derives it.
      ['app', '(marketing)', '[locale]', 'contests', 'page.tsx'],
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
   * M6 added a SECOND tagged projection (§13.2 tag `prompts`), so the static surfaces no longer
   * all read the same one: the landing reads both, pricing and the gallery count prompts. What has
   * not changed — and what this asserts — is that every static page reads a TAGGED, TTL-floored
   * projection rather than the database directly or a fixture shortcut.
   */
  it('reads the catalog through the tagged projections, not a fixture shortcut', () => {
    const expected: Array<[string[], string[]]> = [
      [
        ['app', '(marketing)', '[locale]', 'page.tsx'],
        ["from '@/lib/content/public-catalog'", "from '@/lib/prompts/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'pricing', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'prompts', 'page.tsx'],
        ["from '@/lib/prompts/public-catalog'"],
      ],
      [
        ['app', '(marketing)', '[locale]', 'contests', 'page.tsx'],
        ["from '@/lib/contests/public-catalog'"],
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
      [read('lib', 'contests', 'public-catalog.ts'), 'tags: [CONTESTS_TAG]'],
    ]) {
      expect(projection).toContain('unstable_cache');
      expect(projection).toContain(tag!);
      expect(projection).toContain('revalidate: CATALOG_TTL_SECONDS');
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
      ...sourcesUnder('components', 'pricing'),
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
      ['app', '(admin)', 'admin', 'p', '[id]', 'page.tsx'],
      ['app', '(admin)', 'admin', 'p', '[id]', 'preview', 'page.tsx'],
      ['app', '(admin)', 'admin', 'policy', 'page.tsx'],
      ['app', 'api', 'admin', 'media', '[ref]', 'route.ts'],
      ['app', 'api', 'media', '[blockId]', 'route.ts'],
      ['app', 'api', 'stripe', 'webhook', 'route.ts'],
      // M6 §13.2: the prompt detail is shaped per viewer, the copy endpoint IS the per-viewer
      // decision, the submission form is login-gated, and the moderation queue is admin surface.
      ['app', '(marketing)', '[locale]', 'prompts', '[slug]', 'page.tsx'],
      ['app', 'api', 'prompts', 'copy', '[id]', 'route.ts'],
      ['app', 'api', 'prompts', 'media', '[ref]', 'route.ts'],
      ['app', '(app)', 'prompts', 'submit', 'page.tsx'],
      ['app', '(admin)', 'admin', 'prompts', 'page.tsx'],
      // M9 §14.2: the contest detail is shaped per CLOCK, the entry form is login-gated, the media
      // route reads a row per request, and both admin screens are admin surface.
      ['app', '(marketing)', '[locale]', 'contests', '[slug]', 'page.tsx'],
      ['app', '(app)', 'contests', '[slug]', 'submit', 'page.tsx'],
      ['app', 'api', 'contests', 'media', '[ref]', 'route.ts'],
      ['app', '(admin)', 'admin', 'contests', 'page.tsx'],
      ['app', '(admin)', 'admin', 'contests', '[slug]', 'preview', 'page.tsx'],
    ]) {
      expect(read(...file), file.join('/')).toContain("export const dynamic = 'force-dynamic'");
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
    // M6 §13.2: the prompt detail is the SECOND viewer-shaped public route and joins the same
    // branch. The gallery is deliberately not in it — it is static and identical for every tier.
    expect(middleware).toContain('isPromptDetailPath(rest)');
    // M9 §14.2: the contest detail is the third, and the only one whose HTML varies by CLOCK
    // rather than by reader. The listing is deliberately not in it.
    expect(middleware).toContain('isContestDetailPath(rest)');
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

  it('routes every admin mutation through one guarded server action', () => {
    const action = read('app', '(admin)', 'admin', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('requireAdmin');
    expect(action).toContain('dispatchAdmin');
    // The only exported action; a second one would be a second place to forget the guard.
    expect(action.match(/export async function/g)).toHaveLength(1);
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

  it('never lets a copy response — refusals included — enter a cache', () => {
    expect(copy).toContain("'Cache-Control': 'private, no-store'");
    expect(copy).toContain("'X-Robots-Tag': 'noindex, nofollow'");
  });

  it('exposes copy as POST only: it has a side effect and must not be prefetchable', () => {
    expect(copy).toContain('export async function POST');
    expect(copy).not.toContain('export async function GET');
  });

  it('speaks the full §13.3-5 refusal vocabulary and logs the conversion signal', () => {
    for (const marker of ["'not_found' }, 404", "'sign_in_required'", "'pro_required'"]) {
      expect(copy, marker).toContain(marker);
    }
    expect(copy).toContain('authorizePromptCopy');
    expect(copy).toContain("type: 'copy_prompt'");
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

  /**
   * The no-store branch must catch the per-viewer DETAIL and miss the static GALLERY. Getting this
   * backwards either leaks one reader's unlocked render into a shared cache, or throws away the
   * cache mode the whole §13.2 gallery design is built on.
   */
  it('matches the prompt detail path and not the gallery', () => {
    expect(isPromptDetailPath('/prompts/neon-alley-dolly')).toBe(true);
    expect(isPromptDetailPath('/prompts')).toBe(false);
    expect(isPromptDetailPath('/p/character-sheet-generation')).toBe(false);
    expect(isPlaybookDetailPath('/prompts/neon-alley-dolly')).toBe(false);
  });
});

/**
 * M6 §13.2 — the submission surface. Login-gated at the EDGE (unprefixed app path) and served by
 * one guarded server action, exactly like the admin CMS.
 */
describe('prompt submission contract (§13.1/E)', () => {
  it('gates /prompts/submit at the edge without catching the public gallery', () => {
    const config = read('lib', 'i18n', 'config.ts');
    expect(config).toContain("'/prompts/submit'");
    // `/prompts` itself must stay a locale-prefixed PUBLIC path.
    expect(config).not.toMatch(/APP_PREFIXES[\s\S]*'\/prompts'[,\s]/);
  });

  it('routes the submission through one server action that never trusts the form', () => {
    const action = read('app', '(app)', 'prompts', 'submit', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    expect(action).toContain('submitPrompt');
    expect(action.match(/export async function/g)).toHaveLength(1);
    /**
     * The action reads EXACTLY the fields a submitter is allowed to choose. Author id, status,
     * source, featured and text visibility are supplied by `lib/prompts/submit.ts` and appear
     * nowhere in what is read from the request, so there is no field a caller could add to
     * publish their own row.
     */
    const readFields = [...action.matchAll(/(?:str|text|bool|file)\(form, '([^']+)'\)/g)].map(
      (match) => match[1]!,
    );
    expect([...new Set(readFields)].sort()).toEqual([
      'consent',
      'handle',
      'poster',
      'promptText',
      'title',
      'video',
    ]);
    for (const forbidden of ['status', 'source', 'authorId', 'userId', 'textVisibility', 'featured']) {
      expect(action.includes(`form, '${forbidden}'`), forbidden).toBe(false);
      expect(action.includes(`form.get('${forbidden}')`), forbidden).toBe(false);
    }
  });
});

/**
 * M10 §15 — the cookies surface's route contract.
 *
 * The unlock is a server action ON the (already-dynamic) detail page; the static surfaces gained
 * nothing session-shaped — the marketing-tree scan above keeps proving that, and the assertions
 * here pin the action to the same one-guarded-entry shape every other mutation has.
 */
describe('cookie unlock contract (§15.3)', () => {
  it('keeps the pricing page static and session-free after the rewrite', () => {
    const pricing = read('app', '(marketing)', '[locale]', 'pricing', 'page.tsx');
    // The §15 model is presented, never a balance: a static page cannot know the viewer.
    expect(pricing).toContain('CookieTable');
    expect(pricing).not.toContain('getWallet');
    expect(pricing).not.toContain('getViewer');
    const table = read('components', 'pricing', 'cookie-table.tsx');
    for (const needle of ['next/headers', 'getViewer', 'getWallet', 'auth-client']) {
      expect(table.includes(needle), `cookie-table must not use ${needle}`).toBe(false);
    }
  });

  it('routes the unlock through one server action that never trusts the form', () => {
    const action = read('app', '(marketing)', '[locale]', 'prompts', '[slug]', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    expect(action).toContain('unlockPrompt');
    expect(action.match(/export async function/g)).toHaveLength(1);

    /**
     * The action reads EXACTLY the two fields the form may choose: the prompt id (the OBJECT of
     * the action, re-verified against the row inside the spending transaction) and the locale
     * (redirect cosmetics). Identity, balance and price appear nowhere in what is read from the
     * request — there is no field a caller could add to spend someone else's cookie or to set
     * the cost of their own.
     */
    const readFields = [...action.matchAll(/form\.get\('([^']+)'\)/g)].map((match) => match[1]!);
    expect([...new Set(readFields)].sort()).toEqual(['id', 'locale']);
    for (const forbidden of ['userId', 'profileId', 'balance', 'delta', 'cost']) {
      expect(action.includes(`form.get('${forbidden}')`), forbidden).toBe(false);
    }
  });

  it('spends only inside the repo transaction — the action carries no SQL of its own', () => {
    const action = read('app', '(marketing)', '[locale]', 'prompts', '[slug]', 'actions.ts');
    // Every wallet rule lives in lib/cookies/repo.ts (§15.1-6); an inline statement here would be
    // a second place to get the lock order wrong.
    expect(action).not.toContain('cookie_balance');
    expect(action).not.toContain('insert into');
  });

  /**
   * §15.1-5 — the purchase seam. The action exists ahead of the gateway that will make it
   * reachable, so its trust posture is pinned NOW: the request may name a prompt to return to and
   * a locale, and nothing else — the price and the count live in lib/cookies, and the credit
   * (`creditCookiePack`) always books the pack size, never a caller-supplied number.
   */
  it('keeps the pack purchase behind the same one-action discipline, price never in the form', () => {
    const action = read('app', '(marketing)', '[locale]', 'prompts', '[slug]', 'purchase-action.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    expect(action).toContain('startCookiePackPurchase');
    expect(action.match(/export async function/g)).toHaveLength(1);

    const readFields = [...action.matchAll(/form\.get\('([^']+)'\)/g)].map((match) => match[1]!);
    expect([...new Set(readFields)].sort()).toEqual(['id', 'locale']);
    for (const forbidden of ['cookies', 'count', 'price', 'amount', 'userId', 'profileId']) {
      expect(action.includes(`form.get('${forbidden}')`), forbidden).toBe(false);
    }

    // The webhook-side credit is pinned to the pack: no count parameter reaches grantPurchase.
    const seam = read('lib', 'cookies', 'purchase.ts');
    expect(seam).toContain('grantPurchase(sql, profileId, PACK_COOKIES)');
  });
});

/**
 * M9 §14.2 — the contests surface's route contract.
 *
 * Three properties, and each of them is a different kind of decision:
 *   `/[locale]/contests`             static + tag, because nothing on it varies by reader
 *   `/[locale]/contests/[slug]`      no-store, because it varies by CLOCK
 *   `/api/contests/media/[ref]`      cacheable, because the bytes are public and content-addressed
 */
describe('contests route + API contract (§14.2)', () => {
  const media = read('app', 'api', 'contests', 'media', '[ref]', 'route.ts');

  it('serves contest media from the PUBLIC bucket only, for published rows only', () => {
    expect(media).toContain("asset.bucket !== 'public-content'");
    expect(media).toContain("row.status !== 'published'");
    // The key is read from the ROW, never from the request — there is no key parameter at all.
    expect(media).toContain('loadContestById');
    expect(media).not.toContain("searchParams.get('key')");
  });

  /**
   * M9 review, finding 3 — the `{contestId}:{kind}` ref is a MUTABLE ALIAS, not an object.
   *
   * Unpublishing a contest, archiving it or replacing its poster all change what the ref resolves
   * to. The first version of this route answered `immutable, s-maxage=86400`, so a withdrawn poster
   * kept being served from a CDN for a day — the §6 disclosure doctrine's failure mode, arrived at
   * from the caching side. The alias must therefore be re-checked on every request; the immutable
   * thing is the content-addressed `{sha256}.{ext}` object it redirects to.
   */
  it('never caches the mutable alias immutably', () => {
    // Header VALUES only — the file's own comment uses the word to explain the split, and that
    // sentence is the reason the code is right rather than something to grep away.
    const headerValues = [...media.matchAll(/'Cache-Control':\s*'([^']*)'/g)].map((m) => m[1]!);
    expect(headerValues.length).toBeGreaterThan(0);
    for (const value of headerValues) {
      expect(value, `Cache-Control: ${value}`).not.toContain('immutable');
    }
    expect(media).toContain("'Cache-Control': 'no-store'");
    expect(media).toContain("'Cache-Control': 'public, max-age=0, must-revalidate'");
    // The redirect target is the content-addressed URL, which IS safe to keep forever.
    expect(media).toContain('publicContentUrl(asset.published_key)');
    expect(media).toContain('status: 302');
    // The streamed fallback offers a validator so a revalidation is cheap.
    expect(media).toContain('ETag');
  });

  /**
   * The no-store branch must catch the per-clock DETAIL and miss the static LISTING. Getting this
   * backwards either serves a stale countdown from a CDN, or throws away the cache mode the whole
   * §14.2 listing design is built on.
   */
  it('matches the contest detail path and not the listing', () => {
    expect(isContestDetailPath('/contests/launch-film-contest')).toBe(true);
    expect(isContestDetailPath('/contests')).toBe(false);
    expect(isPromptDetailPath('/contests/launch-film-contest')).toBe(false);
    expect(isPlaybookDetailPath('/contests/launch-film-contest')).toBe(false);
  });

  /**
   * §14.2's entry form is the one app path whose slug sits in the MIDDLE, so it cannot be a prefix.
   * The gate must catch exactly the leaf and nothing around it.
   */
  it('gates only /contests/{slug}/submit at the edge', () => {
    expect(isContestSubmitPath('/contests/launch-film-contest/submit')).toBe(true);
    expect(isAppPath('/contests/launch-film-contest/submit')).toBe(true);

    for (const path of [
      '/contests',
      '/contests/launch-film-contest',
      '/contests/launch-film-contest/submit/extra',
      '/en/contests',
      '/en/contests/launch-film-contest',
    ]) {
      expect(isContestSubmitPath(path), path).toBe(false);
      expect(isAppPath(path), path).toBe(false);
    }
  });

  it('routes the entry through one server action that never trusts the form', () => {
    const action = read('app', '(app)', 'contests', '[slug]', 'submit', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('getViewer');
    expect(action).toContain('submitEntry');
    expect(action.match(/export async function/g)).toHaveLength(1);

    /**
     * The action reads EXACTLY the fields an entrant is allowed to choose (plus the slug, which
     * grants no authority — the server re-resolves the contest from it and refuses anything
     * unpublished). Author id, status, placement and reject reason are supplied or cleared by
     * `lib/contests/submit.ts` and appear nowhere in what is read from the request.
     */
    const readFields = [...action.matchAll(/(?:str|text|bool|file)\(form, '([^']+)'\)/g)].map(
      (match) => match[1]!,
    );
    expect([...new Set(readFields)].sort()).toEqual([
      'consent',
      'note',
      'slug',
      'snsUrl',
      'title',
      'videoUrl',
    ]);
    for (const forbidden of ['status', 'authorId', 'userId', 'placement', 'rejectReason', 'contestId']) {
      expect(action.includes(`form, '${forbidden}'`), forbidden).toBe(false);
      expect(action.includes(`form.get('${forbidden}')`), forbidden).toBe(false);
    }
  });

  /**
   * §14.2: "draft = admin preview path". The public route must have no admin branch at all — the
   * moment it grows one, a draft prize is one crafted URL away from being public.
   */
  it('keeps the draft preview OUT of the public detail route', () => {
    const page = read('app', '(marketing)', '[locale]', 'contests', '[slug]', 'page.tsx');
    expect(page).toContain('getShapedContest');
    expect(page).not.toContain('getContestPreview');
    // Import-level, not text-level: the file's own comment names `requireAdmin()` when explaining
    // where drafts DO render, and that sentence should stay.
    expect(page).not.toMatch(/^import .*requireAdmin/m);
    expect(page).not.toMatch(/^import .*getViewer/m);

    // …and the preview lives inside the (admin) group, whose layout is the gate.
    const preview = read('app', '(admin)', 'admin', 'contests', '[slug]', 'preview', 'page.tsx');
    expect(preview).toContain('getContestPreview');
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
    expect(action.match(/export async function/g)).toHaveLength(1);
  });

  it('gives the admin publish form a notify checkbox but never a kind picker', () => {
    const panel = read('components', 'admin', 'editor-panels.tsx');
    expect(panel).toContain('name="notify"');
    // The kind is derived in `lib/admin/operations.ts` from `published_revision_id`.
    expect(panel).not.toContain('new_playbook');
    expect(panel).not.toContain('playbook_update');
    expect(read('lib', 'admin', 'operations.ts')).toContain('notifyKindFor(');
  });

  it('keeps the unsubscribe endpoint out of every cache and every index', () => {
    const route = read('app', 'api', 'notify', 'unsubscribe', 'route.ts');
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    expect(route).toContain("'X-Robots-Tag': 'noindex, nofollow'");
    expect(route).toContain('verifyUnsubscribeToken');
    // GET only: a mail client follows links, not forms.
    expect(route).toContain('export async function GET');
    expect(route).not.toContain('export async function POST');
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
    const matcher = read('middleware.ts');
    expect(matcher).toContain('sitemap\\\\.xml');
    expect(matcher).toContain('robots\\\\.txt');
  });
});
