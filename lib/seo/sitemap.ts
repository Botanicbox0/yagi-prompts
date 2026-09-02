import type { MetadataRoute } from 'next';
import type { CatalogCard } from '@/lib/content/catalog';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { ContestCard } from '@/lib/contests/catalog';
import { promptRest } from '@/lib/prompts/links';
import { contestRest } from '@/lib/contests/links';
import { LEGAL_DOCS } from '@/lib/legal/documents';
import { legalRest } from '@/lib/legal/links';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { localeAlternates } from './playbook-metadata';

/**
 * PLAN §8 M5 — "sitemap + locale alternates", built as a pure function of (catalog, origin).
 *
 * What goes in is exactly the **public** surface of §3.9, and nothing else:
 *
 *   `/{locale}`            landing
 *   `/{locale}/pricing`    pricing
 *   `/{locale}/p/{slug}`   published **showcase** playbooks only
 *
 * The showcase filter is the load-bearing line. A non-showcase playbook's *card metadata* is public
 * (§3.1) and appears on the landing, but the page itself is behind the login wall and emits
 * `noindex` — listing it here would ask crawlers to fetch a page we have told them not to index,
 * and would publish the full slug inventory of the gated library. `/library`, `/account`,
 * `/billing/*`, `/admin/*` and `/api/*` are `noindex` app surface and never appear (robots.ts
 * disallows them too, so the two agree).
 *
 * Every URL is absolute — a sitemap of relative paths is not a sitemap — and every entry carries
 * the reciprocal en/ko alternates Google reads as hreflang.
 */

export interface SitemapInput {
  /** Absolute origin, no trailing slash (`lib/seo/site-url.ts`). */
  origin: string;
  cards: CatalogCard[];
  /**
   * §13.2 — "published prompt details join the sitemap with locale alternates; gallery indexed;
   * submit/admin noindex."
   *
   * Note the difference from playbooks: there is NO showcase filter here, and there should not be.
   * A Pro-gated prompt is still a fully public page — poster, clip, title, credit and model chip
   * are all public marketing surface (§13.1) and only the text is gated. The catalog projection
   * itself is the filter: it only ever contains `published` rows, so pending, rejected and
   * archived items cannot reach the sitemap by construction.
   */
  prompts?: PromptCard[];
  /**
   * §14.2 — published contests, with locale alternates.
   *
   * Like prompts and unlike playbooks there is no showcase filter, and for a stronger reason: a
   * contest page has no gated half at all. The catalog projection is itself the filter — it only
   * ever contains `published` rows, so a draft cannot reach the sitemap by construction, which is
   * the property that matters (an unannounced prize must not be discoverable).
   */
  contests?: ContestCard[];
  /** Falls back to the card's own publish time; only used when that is missing. */
  now?: Date;
}

function absolute(origin: string, path: string): string {
  return `${origin}${path}`;
}

function absoluteAlternates(origin: string, rest: string): Record<string, string> {
  const relative = localeAlternates(rest);
  return Object.fromEntries(
    Object.entries(relative).map(([key, value]) => [key, absolute(origin, value)]),
  );
}

export function buildSitemap(input: SitemapInput): MetadataRoute.Sitemap {
  const { origin, cards, prompts = [], contests = [], now = new Date() } = input;
  const entries: MetadataRoute.Sitemap = [];

  const marketing: Array<{
    rest: string;
    priority: number;
    changeFrequency: 'daily' | 'weekly' | 'yearly';
  }> = [
    { rest: '/', priority: 1, changeFrequency: 'daily' },
    // The studio is the product's front door (2026-09-03); weekly, because a style is added
    // about as often as a contest, not as often as a prompt.
    { rest: '/studio', priority: 0.9, changeFrequency: 'weekly' },
    // §13.2 — the gallery is the v1.5 front door and is indexed; it changes as often as the studio
    // publishes, which is the same cadence as the landing it now leads.
    { rest: '/prompts', priority: 0.9, changeFrequency: 'daily' },
    // §14.2 — the contests listing. Weekly rather than daily: a contest is a month-long object, and
    // claiming daily change on a page that gains a row every few weeks is noise for a crawler.
    { rest: '/contests', priority: 0.8, changeFrequency: 'weekly' },
    { rest: '/pricing', priority: 0.8, changeFrequency: 'weekly' },
    // The legal surface. Low priority — nobody searches for it — but LISTED, because a payment
    // provider's merchant review and 전자상거래법 §21 both expect these to be publicly reachable,
    // and a crawler that has them indexed is the cheapest evidence that they are.
    ...LEGAL_DOCS.map((doc) => ({
      rest: legalRest(doc),
      priority: 0.2,
      changeFrequency: 'yearly' as const,
    })),
  ];

  for (const page of marketing) {
    for (const locale of LOCALES) {
      entries.push({
        url: absolute(origin, `/${locale}${page.rest === '/' ? '' : page.rest}`),
        lastModified: now,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
        alternates: { languages: absoluteAlternates(origin, page.rest) },
      });
    }
  }

  // §13.2 — every published prompt, both rails, with reciprocal alternates.
  for (const prompt of prompts) {
    const rest = promptRest(prompt.slug);
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        lastModified: prompt.publishedAt ? new Date(prompt.publishedAt) : now,
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  // §14.2 — every published contest, both locales, with reciprocal alternates.
  for (const contest of contests) {
    const rest = contestRest(contest.slug);
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        lastModified: contest.publishedAt ? new Date(contest.publishedAt) : now,
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  // §3.1 keeps the catalog newest-first; a sitemap wants the same order for the same reason.
  for (const card of cards) {
    if (!card.isShowcase) continue;
    const rest = `/p/${card.slug}`;
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        lastModified: card.publishedAt ? new Date(card.publishedAt) : now,
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  return entries;
}

/**
 * §4 route table — everything that is `noindex` behind auth, plus the API surface.
 *
 * `robots.txt` is a crawler courtesy, never a control: the actual protection is the server-side
 * gate on every one of these paths. Listing them stops a crawler wasting requests on redirects to
 * a sign-in page, and stops `/api/media/...` capability URLs being followed at all.
 */
export const DISALLOWED_PATHS = [
  '/admin',
  '/library',
  '/account',
  '/billing',
  '/api',
  // §13.2 — the submission form is login-gated app surface. `/prompts` itself is locale-prefixed
  // and indexed, so this entry cannot catch the gallery.
  '/prompts/submit',
  /**
   * §14.2 — the entry form, whose slug sits in the MIDDLE of the path.
   *
   * A prefix rule cannot express that, so this is the one wildcard in the file (`*` is supported by
   * every major crawler). `Disallow: /contests` would take the listing and every contest page down
   * with it, which is the opposite of what we want.
   */
  '/contests/*/submit',
] as const;

export function buildRobots(origin: string): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
