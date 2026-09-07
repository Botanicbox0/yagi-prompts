import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from '@/lib/content/asset-url';
import { shapePromptMedia, type ShapedPromptMedia } from './shape';
import { loadPublishedPrompts, type PromptRow } from './repo';
import { PROMPT_MODEL_LABEL, promptModelLabel, type PromptSource, type TemplateMedium } from './schemas';
import { promptLock, type PromptLock } from './lock';

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
  /** Raw model ids (`seedance-2.5`); `modelLabels` is what the chips render (2026-08-15). */
  models: string[];
  modelLabels: string[];
  useCase: string[];
  /** docs/TEMPLATES-IA.md — the catalogue's first split, and whether a runtime makes sense. */
  medium: TemplateMedium;
  /** One render in USD cents; 0 = not for sale yet. */
  priceCents: number;
  /** The fixed won price for Korean pages; 0 = suggested from the dollar price (lib/twings/products.ts). */
  priceKrw: number;
  runtimeSeconds: number | null;
  /** Render engine id and opening aspect; null = the medium's default (lib/images/engines.ts). */
  engine: string | null;
  aspectDefault: string | null;
  poster: ShapedPromptMedia | null;
  video: ShapedPromptMedia | null;
  /**
   * WHICH gate the text sits behind — not merely THAT one exists (founder report, 2026-08-15:
   * "90s interview는 free인데 왜 cookie 요구?").
   *
   * The card used to carry a boolean and the chip always read COOKIE, so a `free` prompt — one that
   * a signed-in reader opens for nothing — advertised a price it does not charge. Three visibilities
   * collapse to two chips because that is what a reader can DO about them:
   *   · `null`     public — nothing to say;
   *   · 'signin'   free — sign in, spend nothing;
   *   · 'cookie'   pro — one cookie, permanently.
   * It still says nothing about the text itself; the detail page's shaper remains the only thing
   * that can hand it over.
   */
  lock: PromptLock;
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
  /** docs/TEMPLATES-IA.md — the two tabs: every published template by what it produces. */
  video: PromptCard[];
  image: PromptCard[];
  totals: PromptTotals;
}

export const EMPTY_PROMPT_CATALOG: PromptCatalog = {
  yagi: [],
  community: [],
  video: [],
  image: [],
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
    models: row.models,
    modelLabels: row.models.map(promptModelLabel),
    useCase: row.useCase,
    medium: row.medium,
    priceCents: row.priceCents,
    priceKrw: row.priceKrw,
    runtimeSeconds: row.runtimeSeconds,
    engine: row.engine,
    aspectDefault: row.aspectDefault,
    poster,
    video,
    lock: promptLock(row.textVisibility),
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
  const video = cards.filter((card) => card.medium === 'video');
  const image = cards.filter((card) => card.medium === 'image');
  const useCases = [...new Set(cards.flatMap((card) => card.useCase))].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    yagi,
    community,
    video,
    image,
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
