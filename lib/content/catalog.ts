import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AssetRef, Localized } from './schemas';
import type { Visibility } from './visibility';

/**
 * PLAN §7 — catalog projection #1 of two: `getPublicCatalog()`.
 *
 * "showcase-safe card fields only (slug, title, summary, category, difficulty, public hero URL,
 * lock counts, totals)". It backs the landing's featured cards, the marquee's tool list and the
 * pricing page's "N prompts across M playbooks" line. Cached under tag `catalog` + a 1h TTL floor
 * by `lib/content/public-catalog.ts`; the library grid is a DIFFERENT, authenticated, dynamic query
 * and never comes through here.
 *
 * Two rules this file owns:
 *   1. Card metadata of every *published* playbook is public marketing surface (§3.1 public
 *      metadata rule) — showcase or not. `isShowcase` rides along so the link target can differ.
 *   2. Only `public-content` hero keys are ever emitted. `staging_key` and private published keys
 *      never enter the projection at all, so there is nothing to strip downstream.
 *
 * Driver-agnostic like `load.ts`: the acceptance test reads the seeded fixtures through PGlite,
 * the app reads Supabase Postgres through `pg`.
 */

export interface CatalogHero {
  /** Object key inside the PUBLIC `public-content` bucket. Heroes are always public (§3.1). */
  key: string;
  mime: string;
  w?: number;
  h?: number;
  duration_s?: number;
}

export interface CatalogCard {
  slug: string;
  category: string;
  difficulty: string;
  title: Localized;
  summary: Localized;
  tools: string[];
  models: string[];
  estTimeMin: number | null;
  estCostUsd: number | null;
  isShowcase: boolean;
  publishedAt: string | null;
  hero: CatalogHero | null;
  stepCount: number;
  blockCount: number;
  /** Blocks stamped `pro` — the "N pro blocks" indicator and the conversion story. */
  proBlockCount: number;
  /** Prompt blocks a viewer could ever reach (admin-only `hidden` prompts are not advertised). */
  promptCount: number;
}

export interface CatalogTotals {
  playbooks: number;
  steps: number;
  blocks: number;
  proBlocks: number;
  prompts: number;
  /** Distinct tools + models across the catalog — the marquee's real content (§5.3-5). */
  tools: string[];
  models: string[];
}

export interface PublicCatalog {
  cards: CatalogCard[];
  totals: CatalogTotals;
}

/**
 * The same row with its identifiers still attached.
 *
 * §7 keeps two projections: this one feeds the AUTHENTICATED library grid (`lib/content/library.ts`
 * — dynamic, no-store), which needs the revision id to address hero media through the entitlement
 * gateway. `getPublicCatalog()` strips both ids before caching, so the public projection stays
 * exactly the "showcase-safe card fields" §7 specifies.
 */
export interface CatalogRow extends CatalogCard {
  playbookId: string;
  revisionId: string;
}

export const EMPTY_CATALOG: PublicCatalog = {
  cards: [],
  totals: { playbooks: 0, steps: 0, blocks: 0, proBlocks: 0, prompts: 0, tools: [], models: [] },
};

interface CardRow {
  revision_id: string;
  playbook_id: string;
  slug: string;
  category: string;
  difficulty: string;
  title: Localized;
  summary: Localized;
  tools: string[] | null;
  models: string[] | null;
  est_time_min: number | null;
  est_cost_usd: string | number | null;
  is_showcase: boolean;
  published_at: Date | string | null;
  hero_asset: AssetRef | null;
  step_count: number;
}

interface CountRow {
  revision_id: string;
  kind: string;
  visibility: Visibility;
  n: number;
}

/** Newest first (§3.1 "the latest published playbooks, newest first"), ties broken deterministically. */
const CARDS_SQL = `
  select r.id                as revision_id,
         p.id                as playbook_id,
         p.slug, p.category,
         r.difficulty, r.title, r.summary, r.tools, r.models,
         r.est_time_min, r.est_cost_usd, r.is_showcase, r.published_at, r.hero_asset,
         (select count(*)::int from steps s where s.revision_id = r.id) as step_count
    from playbooks p
    join playbook_revisions r on r.id = p.published_revision_id
   where p.status = 'published' and r.state = 'published'
   order by r.published_at desc nulls last, p.sort desc, p.slug asc
`;

const COUNTS_SQL = `
  select s.revision_id,
         b.kind,
         b.resolved_visibility::text as visibility,
         count(*)::int as n
    from blocks b
    join steps s on s.id = b.step_id
    join playbook_revisions r on r.id = s.revision_id
    join playbooks p on p.id = r.playbook_id and p.published_revision_id = r.id
   where p.status = 'published' and r.state = 'published'
     and b.resolved_visibility is not null
   group by 1, 2, 3
`;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Heroes live in the public bucket by construction; anything else is treated as "no hero". */
function toHero(ref: AssetRef | null): CatalogHero | null {
  if (!ref || ref.bucket !== 'public-content' || !ref.published_key) return null;
  const hero: CatalogHero = { key: ref.published_key, mime: ref.mime };
  if (ref.w !== undefined) hero.w = ref.w;
  if (ref.h !== undefined) hero.h = ref.h;
  if (ref.duration_s !== undefined) hero.duration_s = ref.duration_s;
  return hero;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/** Every published playbook's card row, ids included. One query pair, two projections. */
export async function loadCatalogRows(sql: SqlRunner): Promise<CatalogRow[]> {
  const [{ rows: cardRows }, { rows: countRows }] = await Promise.all([
    sql.query<CardRow>(CARDS_SQL),
    sql.query<CountRow>(COUNTS_SQL),
  ]);

  const perRevision = new Map<string, { blocks: number; pro: number; prompts: number }>();
  for (const row of countRows) {
    const bucket = perRevision.get(row.revision_id) ?? { blocks: 0, pro: 0, prompts: 0 };
    bucket.blocks += row.n;
    if (row.visibility === 'pro') bucket.pro += row.n;
    if (row.kind === 'prompt' && row.visibility !== 'hidden') bucket.prompts += row.n;
    perRevision.set(row.revision_id, bucket);
  }

  return cardRows.map((row) => {
    const counts = perRevision.get(row.revision_id) ?? { blocks: 0, pro: 0, prompts: 0 };
    return {
      playbookId: row.playbook_id,
      revisionId: row.revision_id,
      slug: row.slug,
      category: row.category,
      difficulty: row.difficulty,
      title: row.title,
      summary: row.summary,
      tools: row.tools ?? [],
      models: row.models ?? [],
      estTimeMin: row.est_time_min,
      estCostUsd: toNumber(row.est_cost_usd),
      isShowcase: row.is_showcase,
      publishedAt: toIso(row.published_at),
      hero: toHero(row.hero_asset),
      stepCount: row.step_count,
      blockCount: counts.blocks,
      proBlockCount: counts.pro,
      promptCount: counts.prompts,
    };
  });
}

export async function loadPublicCatalog(sql: SqlRunner): Promise<PublicCatalog> {
  const rows = await loadCatalogRows(sql);
  // Strip the identifiers: the public projection is cached and served to anonymous visitors, and
  // §7 scopes it to "showcase-safe card fields only".
  const cards: CatalogCard[] = rows.map(({ playbookId: _p, revisionId: _r, ...card }) => card);

  return {
    cards,
    totals: {
      playbooks: cards.length,
      steps: cards.reduce((n, card) => n + card.stepCount, 0),
      blocks: cards.reduce((n, card) => n + card.blockCount, 0),
      proBlocks: cards.reduce((n, card) => n + card.proBlockCount, 0),
      prompts: cards.reduce((n, card) => n + card.promptCount, 0),
      tools: uniqueSorted(cards.flatMap((card) => card.tools)),
      models: uniqueSorted(cards.flatMap((card) => card.models)),
    },
  };
}

/** §3.1: "the latest 4–6 published playbooks with hero media, newest first, labeled LATEST". */
export const FEATURED_MIN = 4;
export const FEATURED_MAX = 6;

export function featuredCards(catalog: PublicCatalog): CatalogCard[] {
  return catalog.cards.slice(0, FEATURED_MAX);
}
