import type { MetadataRoute } from 'next';
import type { CatalogCard } from '@/lib/content/catalog';
import { CAST_SECTIONS, cardCast, type PromptCard, type PublicMaker } from '@/lib/prompts/catalog';
import { castRest } from '@/lib/prompts/links';
import { makerRest } from '@/lib/makers/links';
import type { SitemapPostEntry } from '@/lib/posts/public';
import { makerBlogPostRest } from '@/lib/posts/links';
import { TEMPLATE_LISTING_REST, templateRest } from '@/lib/prompts/links';
import { LEGAL_DOCS } from '@/lib/legal/documents';
import { legalRest } from '@/lib/legal/links';
import { ACCOUNT_DELETION_REST } from '@/lib/account/links';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { localeAlternates } from './playbook-metadata';
import { BRAND_STORIES } from '@/lib/campaigns/brand-stories';

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
   * docs/TEMPLATES-IA.md — every published template, with locale alternates. No showcase filter:
   * a template page has no gated half at all. The catalogue projection is itself the filter — it
   * only ever contains `published` rows, so pending, rejected and archived items cannot reach the
   * sitemap by construction.
   */
  templates?: PromptCard[];
  /** The template maker program page exists only while its public intake gate is open. */
  includeCreatorProgram?: boolean;
  /**
   * docs/PLATFORM-2.0.md §7.5 — public maker pages. Only makers who opted in are in the catalogue at
   * all; a page with no published template yet is thin, so it waits until there is one.
   */
  makers?: PublicMaker[];
  /** Published maker blog posts (Batch 3, only when `TWINGS_MAKER_BLOG` is on). */
  makerPosts?: SitemapPostEntry[];
  /** Real editorial dates only, keyed by locale-independent path. Omit when unknown. */
  pageModifiedAt?: Partial<Record<string, string>>;
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
  const { origin, cards, templates = [], pageModifiedAt = {}, includeCreatorProgram = false, makers = [], makerPosts = [] } = input;
  const entries: MetadataRoute.Sitemap = [];

  const marketing: Array<{
    rest: string;
    priority: number;
    changeFrequency: 'daily' | 'weekly' | 'yearly';
  }> = [
    { rest: '/', priority: 1, changeFrequency: 'daily' },
    // docs/TEMPLATES-IA.md — the two tabs are the front doors; daily, because a template is
    // published about as often as the landing changes.
    { rest: TEMPLATE_LISTING_REST.video, priority: 0.9, changeFrequency: 'daily' },
    { rest: TEMPLATE_LISTING_REST.image, priority: 0.9, changeFrequency: 'daily' },
    // docs/CAMPAIGNS.md — the campaigns listing. Weekly: a campaign is a month-long object.
    { rest: '/campaigns', priority: 0.8, changeFrequency: 'weekly' },
    { rest: '/brands', priority: 0.8, changeFrequency: 'weekly' },
    { rest: '/brands/stories', priority: 0.7, changeFrequency: 'weekly' },
    ...BRAND_STORIES.map(story => ({ rest: `/brands/stories/${story.slug}`, priority: 0.7, changeFrequency: 'weekly' as const })),
    { rest: '/pricing', priority: 0.8, changeFrequency: 'weekly' },
    { rest: '/faq', priority: 0.6, changeFrequency: 'weekly' },
    // docs/RUNBOOK-deletion.md — the Google Play listing's account deletion URL: public on purpose.
    { rest: ACCOUNT_DELETION_REST, priority: 0.2, changeFrequency: 'yearly' },
    ...(includeCreatorProgram ? [{ rest: '/creators', priority: 0.6, changeFrequency: 'weekly' as const }] : []),
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
        ...modifiedDate(pageModifiedAt[page.rest]),
        changeFrequency: page.changeFrequency,
        priority: page.priority,
        alternates: { languages: absoluteAlternates(origin, page.rest) },
      });
    }
  }

  // docs/CAST-CATEGORIES.md §5 — a cast page exists only while it has a published template (the
  // catalogue already dropped couple templates while their flag is off, so their page stays out too).
  for (const cast of CAST_SECTIONS) {
    if (!templates.some((template) => cardCast(template) === cast)) continue;
    const rest = castRest(cast);
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  // docs/TEMPLATES-IA.md — every published template, both tabs, with reciprocal alternates.
  for (const template of templates) {
    const rest = templateRest(template.slug);
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        ...modifiedDate(template.publishedAt),
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  for (const maker of makers) {
    if (maker.templateCount === 0) continue;
    const rest = makerRest(maker.handle);
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        ...modifiedDate(maker.latestPublishedAt),
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  for (const post of makerPosts) {
    const rest = makerBlogPostRest(post.handle, post.slug);
    for (const locale of LOCALES as readonly Locale[]) {
      entries.push({
        url: absolute(origin, `/${locale}${rest}`),
        ...modifiedDate(post.updatedAt),
        changeFrequency: 'weekly',
        priority: 0.5,
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
        ...modifiedDate(card.updatedAt ?? card.publishedAt),
        changeFrequency: 'monthly',
        priority: 0.7,
        alternates: { languages: absoluteAlternates(origin, rest) },
      });
    }
  }

  return entries;
}

/** Rendering a sitemap is not a content update. Unknown/invalid timestamps stay absent. */
function modifiedDate(value: string | null | undefined): { lastModified?: Date } {
  return value && Number.isFinite(Date.parse(value)) ? { lastModified: new Date(value) } : {};
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
  // Exact root plus private workspace leaves: `/brand/` also contains public logo assets.
  '/brand$',
  '/brand/projects',
  '/brand/members',
  '/brand/invite',
  '/library',
  '/account',
  '/billing',
  '/api',
  // docs/CAMPAIGNS.md §6 — the same shape again: the apply form (slug in the middle) and the
  // creator's own standing page are noindex app surface; `/campaigns` and every campaign page stay.
  '/campaigns/*/apply',
  '/campaigns/*/make',
  '/campaigns/mine',
  // docs/PLATFORM-2.0.md §17.2 — the signed-in, per-viewer campaign list.
  '/campaigns/open',
  // docs/TEMPLATES-IA.md §8 — the owner's renders and the 3-day links: never indexable.
  '/renders',
  '/r/',
  '/identity',
  // The format creator application and workspace; `/{locale}/creators` itself stays public.
  '/creators/apply',
  '/creators/workspace',
] as const;

export function buildRobots(origin: string): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
