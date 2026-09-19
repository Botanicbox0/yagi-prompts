import { describe, expect, it } from 'vitest';
import type { CatalogCard } from '@/lib/content/catalog';
import { buildRobots, buildSitemap, DISALLOWED_PATHS } from '@/lib/seo/sitemap';
import { siteUrl, absoluteUrl } from '@/lib/seo/site-url';

/**
 * PLAN §8 M5 — "sitemap + locale alternates … showcase playbook detail pages only".
 *
 * The showcase filter is a disclosure rule, not an SEO nicety: a non-showcase playbook's page is
 * behind the login wall and emits `noindex` (§3.3/§3.9), so listing it would both contradict the
 * page and publish the slug inventory of the gated library.
 */

const ORIGIN = 'https://playbook.example';

function card(overrides: Partial<CatalogCard>): CatalogCard {
  return {
    slug: 'a-playbook',
    category: 'image',
    difficulty: 'intermediate',
    title: { en: 'A', ko: '가' },
    summary: { en: 'S', ko: '요' },
    tools: [],
    models: [],
    estTimeMin: null,
    estCostUsd: null,
    isShowcase: true,
    publishedAt: '2026-08-01T00:00:00.000Z',
    firstPublishedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    hero: null,
    stepCount: 1,
    blockCount: 1,
    proBlockCount: 0,
    promptCount: 0,
    ...overrides,
  };
}

const CARDS: CatalogCard[] = [
  card({ slug: 'character-sheet-generation', isShowcase: true }),
  card({ slug: 'talking-character-clip', isShowcase: false }),
  card({ slug: 'voice-identity-setup', isShowcase: true, publishedAt: null }),
];

describe('sitemap (§8 M5)', () => {
  const entries = buildSitemap({ origin: ORIGIN, cards: CARDS });
  const urls = entries.map((entry) => entry.url);

  it('lists landing and pricing in both locales', () => {
    expect(urls).toContain(`${ORIGIN}/en`);
    expect(urls).toContain(`${ORIGIN}/ko`);
    expect(urls).toContain(`${ORIGIN}/en/pricing`);
    expect(urls).toContain(`${ORIGIN}/ko/pricing`);
    // The two template tabs are the front doors (docs/TEMPLATES-IA.md) — a front door a crawler
    // cannot find is not one.
    for (const rest of ['/video', '/image', '/campaigns', '/faq']) {
      expect(urls).toContain(`${ORIGIN}/en${rest}`);
      expect(urls).toContain(`${ORIGIN}/ko${rest}`);
    }
  });

  it('lists showcase playbook details only', () => {
    expect(urls).toContain(`${ORIGIN}/en/p/character-sheet-generation`);
    expect(urls).toContain(`${ORIGIN}/ko/p/character-sheet-generation`);
    expect(urls).toContain(`${ORIGIN}/en/p/voice-identity-setup`);
    // Published, publicly card-advertised, but behind the login wall — never in the sitemap.
    expect(urls.some((url) => url.includes('talking-character-clip'))).toBe(false);
  });

  it('never lists a noindex surface', () => {
    for (const path of DISALLOWED_PATHS) {
      expect(urls.some((url) => url.includes(path)), path).toBe(false);
    }
  });

  it('is absolute everywhere, URLs and alternates alike', () => {
    for (const entry of entries) {
      expect(entry.url.startsWith(`${ORIGIN}/`), entry.url).toBe(true);
      const languages = entry.alternates?.languages ?? {};
      for (const [tag, href] of Object.entries(languages)) {
        expect(String(href).startsWith(`${ORIGIN}/`), `${entry.url} ${tag}`).toBe(true);
      }
    }
  });

  it('carries reciprocal en/ko/x-default alternates on every entry', () => {
    for (const entry of entries) {
      const languages = entry.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages).sort()).toEqual(['en', 'ko', 'x-default']);
      expect(languages['x-default']).toBe(languages.en);
      // The entry's own URL is one of its alternates — that is what reciprocity means.
      expect([languages.en, languages.ko]).toContain(entry.url);
    }
  });

  it('dates each playbook from its own publication when it has one', () => {
    const detail = entries.find((entry) => entry.url.endsWith('/en/p/character-sheet-generation'));
    expect(new Date(detail!.lastModified as Date).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('degrades to an empty catalog without producing a broken sitemap', () => {
    const empty = buildSitemap({ origin: ORIGIN, cards: [] });
    // Nine marketing pages × two locales: landing, the two template tabs (docs/TEMPLATES-IA.md),
    // the campaigns listing, pricing, FAQ, and the three legal documents (2026-08-14 — a payment
    // provider's merchant review and 전자상거래법 §21 expect them publicly reachable). The listings
    // are in the sitemap even with no rows — each is a real page with a designed empty state.
    expect(empty).toHaveLength(18);
    expect(empty.every((entry) => entry.url.startsWith(ORIGIN))).toBe(true);
  });

  it('never invents modification dates from the time of sitemap generation', () => {
    expect(entries.find((entry) => entry.url === `${ORIGIN}/en`)).not.toHaveProperty('lastModified');
    expect(entries.find((entry) => entry.url.endsWith('/en/p/voice-identity-setup'))).not.toHaveProperty('lastModified');
    const changed = buildSitemap({ origin: ORIGIN, cards: [card({ updatedAt: '2026-09-20T10:00:00Z' })], pageModifiedAt: { '/faq': '2026-09-19T00:00:00Z', '/pricing': 'invalid' } });
    expect(changed.find((entry) => entry.url.endsWith('/en/p/a-playbook'))?.lastModified).toEqual(new Date('2026-09-20T10:00:00Z'));
    expect(changed.find((entry) => entry.url.endsWith('/en/faq'))?.lastModified).toEqual(new Date('2026-09-19T00:00:00Z'));
    expect(changed.find((entry) => entry.url.endsWith('/en/pricing'))).not.toHaveProperty('lastModified');
  });
});

describe('robots (§8 M5)', () => {
  const robots = buildRobots(ORIGIN);

  it('allows the public surface and disallows the gated one', () => {
    const rule = Array.isArray(robots.rules) ? robots.rules[0]! : robots.rules;
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
    // §13.2 adds the submission form; `/prompts` itself stays indexable, which is why the entry
    // names both segments rather than the prefix. §14.2's entry form needs a WILDCARD for the same
    // reason taken one step further — its slug sits in the middle of the path, so `/contests` as a
    // prefix would take the listing and every contest page down with it.
    expect(rule.disallow).toEqual([
      '/admin',
      '/brand$',
      '/brand/projects',
      '/brand/members',
      '/brand/invite',
      '/library',
      '/account',
      '/billing',
      '/api',
      '/campaigns/*/apply',
      '/campaigns/mine',
      // docs/TEMPLATES-IA.md §8 — the owner's renders and the 3-day links.
      '/renders',
      '/r/',
      '/identity',
    ]);
  });

  it('points at the sitemap', () => {
    expect(robots.sitemap).toBe(`${ORIGIN}/sitemap.xml`);
  });
});

describe('site origin', () => {
  /** A bare object, not a copy of the real environment: these tests must not read the machine's. */
  const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

  it('prefers NEXT_PUBLIC_APP_URL, accepts APP_URL, and strips trailing slashes', () => {
    expect(siteUrl(env({ NEXT_PUBLIC_APP_URL: 'https://a.test/' }))).toBe('https://a.test');
    expect(siteUrl(env({ APP_URL: 'https://b.test' }))).toBe('https://b.test');
    expect(
      siteUrl(env({ NEXT_PUBLIC_APP_URL: 'https://a.test', APP_URL: 'https://b.test' })),
    ).toBe('https://a.test');
  });

  it('ignores the .env.example placeholder rather than emitting it into a sitemap', () => {
    expect(siteUrl(env({ NEXT_PUBLIC_APP_URL: 'https://YOUR-PROJECT.example' }))).toBe(
      'http://localhost:3000',
    );
    expect(siteUrl(env({}))).toBe('http://localhost:3000');
  });

  it('joins paths without doubling the slash', () => {
    const configured = env({ NEXT_PUBLIC_APP_URL: 'https://a.test' });
    expect(absoluteUrl('/en/pricing', configured)).toBe('https://a.test/en/pricing');
    expect(absoluteUrl('en/pricing', configured)).toBe('https://a.test/en/pricing');
    expect(absoluteUrl('https://cdn.test/x.png', configured)).toBe('https://cdn.test/x.png');
  });
});
