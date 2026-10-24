import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from '@/lib/content/asset-url';
import { shapePromptMedia, type ShapedPromptMedia } from './shape';
import { loadPublishedPrompts, type PromptRow } from './repo';
import { PROMPT_MODEL_LABEL, promptModelLabel, type PromptSource, type TemplateMedium } from './schemas';
import { promptLock, type PromptLock } from './lock';
import { loadPublicMakerRows } from '@/lib/makers/profile';

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

/**
 * docs/PLATFORM-2.0.md §7.5·§14.1 — who made the template. `studio` is TWINGS 오리지널; `maker` is a
 * template maker's (a `source='yagi'` row with an `author_id`, 0046) or a legacy community prompt.
 * Derived from `source`/`author_id` here; the id itself never enters the card.
 */
export type PromptOrigin = 'studio' | 'maker';

export interface PromptCard {
  id: string;
  slug: string;
  title: string;
  titleKo: string | null;
  /** The public credit. For a maker template it is set only while the maker's profile is public (0060). */
  authorHandle: string | null;
  origin: PromptOrigin;
  /** True when `authorHandle` has a public maker page (`/{locale}/makers/{handle}`). */
  makerProfile: boolean;
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
  /** The 1080p price (0039); 0 = not offered. lib/twings/resolution.ts decides what sells. */
  price1080Cents: number;
  price1080Krw: number;
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

/** A maker who opted in (0060): handle and bio only — never the account behind them. */
export interface PublicMaker {
  handle: string;
  bio: string | null;
  templateCount: number;
  /** The newest published template's date, for the sitemap's `lastmod`; null with none. */
  latestPublishedAt: string | null;
}

export interface PromptCatalog {
  /** TWINGS 오리지널 (`origin: 'studio'`) — featured first, then newest (repo ordering). */
  yagi: PromptCard[];
  /** 메이커 템플릿 (`origin: 'maker'`) — @handle credits where the maker opted in. */
  community: PromptCard[];
  /** docs/TEMPLATES-IA.md — the two tabs: every published template by what it produces. */
  video: PromptCard[];
  image: PromptCard[];
  /** Public maker profiles, handle order. A maker with no published template is still listed. */
  makers: PublicMaker[];
  totals: PromptTotals;
}

export const EMPTY_PROMPT_CATALOG: PromptCatalog = {
  yagi: [],
  community: [],
  video: [],
  image: [],
  makers: [],
  totals: { yagi: 0, community: 0, published: 0, useCases: [], modelLabel: PROMPT_MODEL_LABEL },
};

export interface PromptCatalogOptions {
  /** Injected so the projection is testable without an env var. */
  publicUrl?: (key: string) => string | null;
}

export function promptOrigin(row: Pick<PromptRow, 'source' | 'authorId'>): PromptOrigin {
  return row.source === 'community' || row.authorId !== null ? 'maker' : 'studio';
}

/**
 * One row → one card. The ONLY place a `PromptCard` is constructed.
 *
 * `makerHandles` maps an author's account id to their PUBLIC maker handle; it is the only place the
 * id is used, and only to look the handle up.
 */
export function toPromptCard(
  row: PromptRow,
  options: PromptCatalogOptions = {},
  makerHandles: ReadonlyMap<string, string> = new Map(),
): PromptCard {
  const { poster, video } = shapePromptMedia(row.id, row.media, {
    publicUrl: options.publicUrl ?? publicContentUrl,
  });
  const origin = promptOrigin(row);
  const makerHandle = row.authorId === null ? null : makerHandles.get(row.authorId) ?? null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    titleKo: row.titleKo,
    authorHandle: makerHandle ?? row.authorHandle,
    origin,
    makerProfile: makerHandle !== null,
    source: row.source,
    models: row.models,
    modelLabels: row.models.map(promptModelLabel),
    useCase: row.useCase,
    medium: row.medium,
    priceCents: row.priceCents,
    priceKrw: row.priceKrw,
    price1080Cents: row.price1080Cents,
    price1080Krw: row.price1080Krw,
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
  const makerRows = await loadPublicMakerRows(sql);
  const makerHandles = new Map(makerRows.map((maker) => [maker.userId, maker.handle]));
  const cards = rows.map((row) => toPromptCard(row, options, makerHandles));

  // The two rails are by ORIGIN: a maker's template is a `source='yagi'` row too (0046).
  const yagi = cards.filter((card) => card.origin === 'studio');
  const community = cards.filter((card) => card.origin === 'maker');
  const video = cards.filter((card) => card.medium === 'video');
  const image = cards.filter((card) => card.medium === 'image');
  const useCases = [...new Set(cards.flatMap((card) => card.useCase))].sort((a, b) =>
    a.localeCompare(b),
  );

  const cardsByMaker = new Map<string, PromptCard[]>();
  for (const card of cards) {
    if (card.makerProfile && card.authorHandle) {
      const list = cardsByMaker.get(card.authorHandle);
      if (list) list.push(card);
      else cardsByMaker.set(card.authorHandle, [card]);
    }
  }

  const makers = makerRows.map(({ handle, bio }): PublicMaker => {
    const own = cardsByMaker.get(handle) ?? [];
    const dates = own.map((card) => card.publishedAt).filter((value): value is string => value !== null).sort();
    return { handle, bio, templateCount: own.length, latestPublishedAt: dates.at(-1) ?? null };
  });

  return {
    yagi,
    community,
    video,
    image,
    makers,
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
