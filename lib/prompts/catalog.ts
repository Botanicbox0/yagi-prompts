import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from '@/lib/content/asset-url';
import { shapePromptMedia, type ShapedPromptMedia } from './shape';
import { loadPublishedPrompts, type PromptRow } from './repo';
import { PROMPT_MODEL_LABEL, type PromptSource } from './schemas';

/**
 * PLAN §13.2 — the public card projection: "cards carry NO prompt text".
 *
 * This is `lib/content/catalog.ts` for prompts, and it owns the same one rule: the projection is
 * built by NAMING every field, so there is no spread, no `...row`, and nothing downstream to
 * strip. `prompt_text` is not omitted here — it is never read into the object at all, which is why
 * `tests/prompts/catalog.test.ts` can assert the exact key set and have that mean something.
 *
 * Cached under tag `prompts` + a TTL floor by `lib/prompts/public-catalog.ts`; the gallery, the
 * landing's featured strip and the sitemap all read THIS, so one `revalidateTag('prompts')` moves
 * them together.
 */

export interface PromptCard {
  id: string;
  slug: string;
  title: string;
  titleKo: string | null;
  authorHandle: string | null;
  source: PromptSource;
  /** Raw model id (`seedance-2.5`); `modelLabel` is what the chip renders. */
  model: string;
  modelLabel: string;
  useCase: string[];
  poster: ShapedPromptMedia | null;
  video: ShapedPromptMedia | null;
  /** True when the text sits behind a gate — the lock chip, and nothing about WHAT is locked. */
  hasLock: boolean;
  featured: boolean;
  publishedAt: string | null;
}

export interface PromptTotals {
  yagi: number;
  community: number;
  published: number;
  /** Distinct use cases actually present, in vocabulary order — the filter rail's real content. */
  useCases: string[];
  modelLabel: string;
}

export interface PromptCatalog {
  /** "ORIGINAL PROMPTS BY YAGI" — featured first, then newest (repo ordering). */
  yagi: PromptCard[];
  /** "FROM THE COMMUNITY" — @handle credits. */
  community: PromptCard[];
  totals: PromptTotals;
}

export const EMPTY_PROMPT_CATALOG: PromptCatalog = {
  yagi: [],
  community: [],
  totals: { yagi: 0, community: 0, published: 0, useCases: [], modelLabel: PROMPT_MODEL_LABEL },
};

export interface PromptCatalogOptions {
  /** Injected so the projection is testable without an env var. */
  publicUrl?: (key: string) => string | null;
}

/** One row → one card. The ONLY place a `PromptCard` is constructed. */
export function toPromptCard(row: PromptRow, options: PromptCatalogOptions = {}): PromptCard {
  const { poster, video } = shapePromptMedia(row.id, row.media, {
    publicUrl: options.publicUrl ?? publicContentUrl,
  });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    titleKo: row.titleKo,
    authorHandle: row.authorHandle,
    source: row.source,
    model: row.model,
    modelLabel: PROMPT_MODEL_LABEL,
    useCase: row.useCase,
    poster,
    video,
    // The card advertises that a lock exists. It never says which tier opens it and never carries
    // a byte of what is behind it — the detail page's shaper is the only thing that can.
    hasLock: row.textVisibility !== 'public',
    featured: row.featured,
    publishedAt: row.publishedAt,
  };
}

export async function loadPromptCatalog(
  sql: SqlRunner,
  options: PromptCatalogOptions = {},
): Promise<PromptCatalog> {
  const rows = await loadPublishedPrompts(sql);
  const cards = rows.map((row) => toPromptCard(row, options));

  const yagi = cards.filter((card) => card.source === 'yagi');
  const community = cards.filter((card) => card.source === 'community');
  const useCases = [...new Set(cards.flatMap((card) => card.useCase))].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    yagi,
    community,
    totals: {
      yagi: yagi.length,
      community: community.length,
      published: cards.length,
      useCases,
      modelLabel: PROMPT_MODEL_LABEL,
    },
  };
}

/** The landing's featured strip: YAGI cards only, featured-first (repo ordering), capped. */
export const LANDING_PROMPTS_MAX = 6;

export function landingPromptCards(
  catalog: PromptCatalog,
  max = LANDING_PROMPTS_MAX,
): PromptCard[] {
  return catalog.yagi.slice(0, max);
}
