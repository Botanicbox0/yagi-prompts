import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from '@/lib/content/asset-url';
import { shapePromptMedia, type ShapedPromptMedia } from './shape';
import { loadPublishedPrompts, type PromptRow } from './repo';
import { PROMPT_MODEL_LABEL, promptModelLabel, type PromptSource, type TemplateCast, type TemplateMedium } from './schemas';
import { promptLock, type PromptLock } from './lock';
import { loadPublicMakerRows } from '@/lib/makers/profile';
import { makerAvatarSrc, makerCoverSrc } from '@/lib/makers/links';
import type { MakerLink } from '@/lib/makers/fields';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { parseTemplateLocks, publicLocks, type PublicTemplateLocks } from '@/lib/template-director/locks';
import type { PublicTemplateStyling } from '@/lib/template-director/styling';
import { templateCardStyling } from '@/lib/template-director/compile-prompts';

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
  /**
   * docs/CAST-CATEGORIES.md — who is in it. Optional so a card built anywhere but `toPromptCard`
   * (a test double) still types; absent reads as `solo`.
   */
  cast?: TemplateCast;
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
   * A set template's example frames in set order (lib/prompts/schemas.ts `gallery`); empty otherwise.
   * Optional so a card built anywhere but `toPromptCard` (a test double) still renders.
   */
  gallery?: ShapedPromptMedia[];
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
  /**
   * The template page shows the recipe's prompts (docs/PLATFORM-2.0.md §7.3: `disclosure.prompts`
   * on). A flag only — the text itself stays with `lib/recipes/public.ts`. Optional like `gallery`.
   */
  recipeOpen?: boolean;
  /**
   * docs/PERSONAL-STUDIO.md §3.3 (C2) — which parts the template fixes, read from the `Template locks:` block in its
   * prompt. Present ONLY on a template that has a block, so every other card is exactly as before. The public
   * projection: never the block or a line's words.
   */
  locks?: PublicTemplateLocks;
  /**
   * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — which parts the template styles (the buyer may keep their own hair or makeup
   * instead) and which it takes from the photo, read from the `Template styling:` block of every prompt the compile
   * reads (lib/template-director/compile-prompts.ts `templateCardStyling`). Present ONLY when they all declare the same
   * styling, so every other card is exactly as before. Names only: never the block or a line's words.
   */
  styling?: PublicTemplateStyling;
}

export interface PromptTotals {
  yagi: number;
  community: number;
  published: number;
  /** Distinct use cases actually present, in vocabulary order — the filter rail's real content. */
  useCases: string[];
  modelLabel: string;
}

/**
 * A creative who opted in (0060, 0065): what they chose to show — never the account behind them.
 * `avatar` and `cover` are gateway addresses (`/creative-media/{avatar|cover}-{handle}-{v}.jpg`), never storage keys.
 */
export interface PublicMaker {
  handle: string;
  bio: string | null;
  /** The English bio (0069); pages pick with `makerBioFor`. Optional so older test doubles still type. */
  bioEn?: string | null;
  displayName: string | null;
  headline: string | null;
  /** ISO 3166-1 alpha-2 where they work, and an optional city. */
  country: string | null;
  city: string | null;
  links: MakerLink[];
  publicEmail: string | null;
  tools: string[];
  openToBrands: boolean;
  avatar: string | null;
  /** The profile banner (0071); null with none. */
  cover: string | null;
  templateCount: number;
  /** How many of their published templates show the recipe's prompts. Optional like `bioEn`. */
  openRecipeCount?: number;
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
  /**
   * docs/CAST-CATEGORIES.md §4 — `coupleTemplatesOpen()`. False (the default) drops every couple
   * template from the projection, so no listing, template page, sitemap entry or maker page can
   * show one: the catalogue is the one filter every public surface reads.
   */
  coupleOpen?: boolean;
  /** `petTemplatesOpen()` — the same rule for pet templates (docs/CAST-CATEGORIES.md §3). */
  petOpen?: boolean;
}

/** A card's cast, `solo` when the card predates the field. */
export function cardCast(card: Pick<PromptCard, 'cast'>): TemplateCast {
  return card.cast ?? 'solo';
}

/** The non-solo casts that get their own section and page. */
export const CAST_SECTIONS = ['pet', 'couple'] as const satisfies readonly TemplateCast[];
export type CastSection = (typeof CAST_SECTIONS)[number];

/** One cast's templates split by what they produce — the two rails of a cast page. */
export interface CastShelf {
  video: PromptCard[];
  image: PromptCard[];
}

export function castShelf(catalog: Pick<PromptCatalog, 'video' | 'image'>, cast: TemplateCast): CastShelf {
  return {
    video: (catalog.video ?? []).filter((card) => cardCast(card) === cast),
    image: (catalog.image ?? []).filter((card) => cardCast(card) === cast),
  };
}

export function castShelfSize(shelf: CastShelf): number {
  return shelf.video.length + shelf.image.length;
}

/**
 * The solo catalogue — what the home gallery and the `/video`·`/image` listings show. Pet and couple
 * templates live in their own sections (docs/CAST-CATEGORIES.md §5); the template page, the sitemap
 * and maker pages keep reading the whole catalogue.
 */
export function soloCatalog(catalog: PromptCatalog): PromptCatalog {
  // `?? []`: test doubles hand over only the lists a page reads.
  const solo = (cards: PromptCard[] | undefined) => (cards ?? []).filter((card) => cardCast(card) === 'solo');
  return { ...catalog, yagi: solo(catalog.yagi), community: solo(catalog.community), video: solo(catalog.video), image: solo(catalog.image) };
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
  openRecipes: ReadonlySet<string> = new Set(),
  recipes: ReadonlyMap<string, unknown> = new Map(),
): PromptCard {
  const { poster, video, gallery } = shapePromptMedia(row.id, row.media, {
    publicUrl: options.publicUrl ?? publicContentUrl,
  });
  const origin = promptOrigin(row);
  const makerHandle = row.authorId === null ? null : makerHandles.get(row.authorId) ?? null;
  // The prompt text is read for two things only, the lock and styling blocks, and only their public projections land
  // on the card. A recipe template's styling is read from the recipe's result steps (the prompts its compile reads),
  // which `loadPromptCatalog` hands in as `recipes`; every other row's from its own text.
  const locks = publicLocks(parseTemplateLocks(row.promptText));
  const styling = templateCardStyling({
    promptText: row.promptText,
    recipe: recipes.get(row.id) ?? null,
    recipeReady: recipes.has(row.id),
    cast: row.cast,
  });
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
    cast: row.cast,
    priceCents: row.priceCents,
    priceKrw: row.priceKrw,
    price1080Cents: row.price1080Cents,
    price1080Krw: row.price1080Krw,
    runtimeSeconds: row.runtimeSeconds,
    engine: row.engine,
    aspectDefault: row.aspectDefault,
    poster,
    video,
    gallery,
    lock: promptLock(row.textVisibility),
    featured: row.featured,
    publishedAt: row.publishedAt,
    recipeOpen: openRecipes.has(row.id),
    ...(locks ? { locks } : {}),
    ...(styling ? { styling } : {}),
  };
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — the raw recipes of the published templates whose card styling must be read
 * from their recipe steps: a recipe is set and either it or the main text mentions a styling block (without one in
 * either, the card claims nothing either way). Empty before 0059, exactly when the render pass never takes the recipe
 * path. A recipe that no longer parses is still handed over: `templateCardStyling` then reads the main text, as the
 * render pass does.
 */
async function loadStylingRecipes(sql: SqlRunner): Promise<Map<string, unknown>> {
  if (!(await recipeSchemaReady(sql))) return new Map();
  const { rows } = await sql.query<{ id: string; recipe: unknown }>(
    `select p.id, to_jsonb(p.*)->'recipe' as recipe from prompt_items p
      where p.status = 'published' and p.audience = 'public' and to_jsonb(p.*)->'recipe' is not null
        and jsonb_typeof(to_jsonb(p.*)->'recipe') = 'object'
        and ((to_jsonb(p.*)->'recipe')::text ilike '%template styling:%' or p.prompt_text ilike '%template styling:%')`,
  );
  return new Map(rows.map((row) => [row.id, row.recipe]));
}

/**
 * The published templates whose page shows the recipe's prompts — the same rule as
 * `loadPublicRecipe` (a maker's accepted format, or a studio original the studio opened), in one
 * query for the whole catalogue. Empty before 0059.
 */
async function loadOpenRecipeIds(sql: SqlRunner): Promise<Set<string>> {
  if (!(await recipeSchemaReady(sql))) return new Set();
  const { rows } = await sql.query<{ id: string }>(
    `select p.id from prompt_items p
      where p.status = 'published' and p.audience = 'public' and p.recipe is not null
        and (p.disclosure->>'prompts')::boolean
        and (p.source::text = 'yagi' or exists (select 1 from platform_formats f where f.template_id = p.id and f.status = 'accepted'))`,
  );
  return new Set(rows.map((row) => row.id));
}

export async function loadPromptCatalog(
  sql: SqlRunner,
  options: PromptCatalogOptions = {},
): Promise<PromptCatalog> {
  const rows = await loadPublishedPrompts(sql);
  const makerRows = await loadPublicMakerRows(sql);
  const openRecipes = await loadOpenRecipeIds(sql);
  const stylingRecipes = await loadStylingRecipes(sql);
  const makerHandles = new Map(makerRows.map((maker) => [maker.userId, maker.handle]));
  const cards = rows
    .filter((row) => (row.cast !== 'couple' || options.coupleOpen === true) && (row.cast !== 'pet' || options.petOpen === true))
    .map((row) => toPromptCard(row, options, makerHandles, openRecipes, stylingRecipes));

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

  const makers = makerRows.map((row): PublicMaker => {
    const own = cardsByMaker.get(row.handle) ?? [];
    const dates = own.map((card) => card.publishedAt).filter((value): value is string => value !== null).sort();
    return {
      handle: row.handle, bio: row.bio, bioEn: row.bioEn, displayName: row.displayName, headline: row.headline, country: row.country, city: row.city,
      links: row.links, publicEmail: row.publicEmail, tools: row.tools, openToBrands: row.openToBrands,
      avatar: row.avatarVersion ? makerAvatarSrc(row.handle, row.avatarVersion) : null,
      cover: row.coverVersion ? makerCoverSrc(row.handle, row.coverVersion) : null,
      templateCount: own.length, openRecipeCount: own.filter((card) => card.recipeOpen).length,
      latestPublishedAt: dates.at(-1) ?? null,
    };
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
  return catalog.yagi.filter((card) => cardCast(card) === 'solo').slice(0, max);
}
