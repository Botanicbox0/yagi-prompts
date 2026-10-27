import type { AssetRef } from '@/lib/content/schemas';
import { canView, type Tier, type Visibility } from '@/lib/content/visibility';
import { promptGalleryRef, promptMediaPath, promptMediaRef } from './links';
import { parsePromptMedia, type MediaKind, type PromptSource, type TemplateMedium } from './schemas';

/**
 * PLAN §13.1 — "Gating doctrine unchanged: `pro` prompt text never enters any payload for
 * non-entitled viewers (server shaping; lock panel + $9 CTA)."
 *
 * This is `lib/content/shape.ts` for prompts: pure, side-effect free, no session, no DB, no env.
 * The façade resolves the viewer and hands a tier down; everything below is a function of
 * (row × tier).
 *
 * The same two rules the block shaper is held to, and they are tested the same way:
 *   1. A gated prompt yields `{ locked: true }` — chrome, title, media and model chip, but the
 *      `text` KEY DOES NOT EXIST on the object. Not empty string, not null: absent, so no
 *      serialisation, Flight chunk or metadata tag can carry it by accident.
 *   2. No storage key ever leaves this function. `staging_key` is dropped unconditionally and the
 *      published key is replaced by a servable URL — posters and videos are public marketing
 *      surface by doctrine (§13.1/§3.1), so that URL is public, never a capability.
 */

// ---------------------------------------------------------------------------
// input — what the repo hands over
// ---------------------------------------------------------------------------

export interface PromptRowInput {
  id: string;
  slug: string;
  source: PromptSource;
  authorHandle: string | null;
  models: string[];
  title: string;
  titleKo: string | null;
  promptText: string;
  /** docs/TEMPLATES-IA.md — optional here so a row shaped before 0015 still reads as a video not for sale. */
  medium?: TemplateMedium;
  priceCents?: number;
  priceKrw?: number;
  price1080Cents?: number;
  price1080Krw?: number;
  runtimeSeconds?: number | null;
  engine?: string | null;
  aspectDefault?: string | null;
  /** The "how it was made" markdown, per locale (2026-08-14). */
  processMd?: string | null;
  processMdKo?: string | null;
  /** The creator's own post (2026-08-15). */
  sourceUrl?: string | null;
  textVisibility: Visibility;
  /** Raw `media` jsonb, parsed here through the §13.1 schema. */
  media: unknown;
  useCase: string[];
  featured: boolean;
  publishedAt: string | null;
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

export interface ShapedPromptMedia {
  /** 'public' = CDN object in `public-content`; 'route' = the public prompt-media route. */
  source: 'public' | 'route';
  src: string;
  mime: string;
  w?: number;
  h?: number;
  duration_s?: number;
}

interface ShapedPromptBase {
  id: string;
  slug: string;
  source: PromptSource;
  authorHandle: string | null;
  models: string[];
  title: string;
  titleKo: string | null;
  useCase: string[];
  featured: boolean;
  /** docs/TEMPLATES-IA.md — what it produces, what one render costs (0 = not for sale), how long. */
  medium: TemplateMedium;
  priceCents: number;
  priceKrw: number;
  price1080Cents: number;
  price1080Krw: number;
  runtimeSeconds: number | null;
  engine: string | null;
  aspectDefault: string | null;
  publishedAt: string | null;
  poster: ShapedPromptMedia | null;
  video: ShapedPromptMedia | null;
  /** The audio result (music/voice prompts) — public like the clip, and downloadable (founder
   *  direction, 2026-08-13). */
  audio: ShapedPromptMedia | null;
  /**
   * The creator's original post. PUBLIC, never gated: it is a link to something already published
   * on the open internet, and hiding it would gate someone else's public page.
   */
  sourceUrl: string | null;
  /** The gate this item's text sits behind — safe to publish; it is what the lock chip renders. */
  visibility: Visibility;
  tier: Tier;
}

export type ShapedPrompt =
  | (ShapedPromptBase & { locked: true })
  | (ShapedPromptBase & {
      locked: false;
      text: string;
      /** The making-of, per locale — present only when the text is (2026-08-14). */
      process: string | null;
      processKo: string | null;
    });

export interface PromptShapeOptions {
  /**
   * `public-content` key → servable URL, or `null` when no CDN is configured (§11).
   *
   * `null` is a meaningful answer, exactly as in `lib/content/shape.ts`: the fallback is the
   * app's own public prompt-media route, which serves the same bytes under the same doctrine.
   */
  publicUrl?: (key: string) => string | null;
  /** Ref (`{id}:poster`) → the public prompt-media route path. */
  mediaUrl?: (ref: string) => string;
  /**
   * §15.1-1 — this (account, prompt) pair holds an unlock row. An unlock grants the PRO view of
   * exactly this prompt: `canView('pro', …)` rather than a blanket bypass, so a `hidden` item
   * stays admin-only whatever rows exist. The caller (lib/prompts/access.ts) resolves it; this
   * module stays pure.
   */
  unlocked?: boolean;
}

const defaultMediaUrl = (ref: string) => promptMediaPath(ref);

/** The two URL resolvers, always both present by the time media is shaped. */
type MediaUrlOptions = Required<Pick<PromptShapeOptions, 'publicUrl' | 'mediaUrl'>>;

function shapeAsset(
  ref: AssetRef,
  mediaRef: string,
  opts: MediaUrlOptions,
): ShapedPromptMedia | null {
  // An asset that has not been copied to the public bucket yet is NOT servable. Returning null is
  // the honest answer: the card falls back to its typographic poster (§13.3-4) rather than
  // emitting a URL that 404s, and a staging key can never be the thing that leaks.
  const published = ref.bucket === 'public-content' && Boolean(ref.published_key);
  if (!published) return null;

  const publicSrc = opts.publicUrl(ref.published_key as string);
  const shaped: ShapedPromptMedia = publicSrc
    ? { source: 'public', src: publicSrc, mime: ref.mime }
    : { source: 'route', src: opts.mediaUrl(mediaRef), mime: ref.mime };
  if (ref.w !== undefined) shaped.w = ref.w;
  if (ref.h !== undefined) shaped.h = ref.h;
  if (ref.duration_s !== undefined) shaped.duration_s = ref.duration_s;
  return shaped;
}

/** The media half on its own — the card projection needs it without any of the text machinery. */
export function shapePromptMedia(
  id: string,
  media: unknown,
  options: PromptShapeOptions = {},
): {
  poster: ShapedPromptMedia | null;
  video: ShapedPromptMedia | null;
  audio: ShapedPromptMedia | null;
  gallery: ShapedPromptMedia[];
} {
  const opts: MediaUrlOptions = {
    publicUrl: options.publicUrl ?? (() => null),
    mediaUrl: options.mediaUrl ?? defaultMediaUrl,
  };
  const parsed = parsePromptMedia(media);
  const shape = (kind: MediaKind, ref: AssetRef | undefined) =>
    ref === undefined ? null : shapeAsset(ref, promptMediaRef(id, kind), opts);
  const gallery = (parsed.gallery ?? [])
    .map((ref, index) => shapeAsset(ref, promptGalleryRef(id, index + 1), opts))
    .filter((frame): frame is ShapedPromptMedia => frame !== null);
  return {
    poster: shape('poster', parsed.poster),
    video: shape('video', parsed.video),
    audio: shape('audio', parsed.audio),
    gallery,
  };
}

/**
 * The gate. §15 widened it from one clause to two: `text` exists iff the TIER may view it
 * (`canView`, which is where admin and the dormant `pro` tier live) OR this account has UNLOCKED
 * this prompt (a per-pair grant of the pro view). Still a pure function of its inputs — the
 * unlock row is a fact the caller looked up, not a query this module makes.
 */
export function shapePrompt(
  row: PromptRowInput,
  tier: Tier,
  options: PromptShapeOptions = {},
): ShapedPrompt {
  const { poster, video, audio } = shapePromptMedia(row.id, row.media, options);

  const base: ShapedPromptBase = {
    id: row.id,
    slug: row.slug,
    source: row.source,
    authorHandle: row.authorHandle,
    models: row.models,
    title: row.title,
    titleKo: row.titleKo,
    useCase: row.useCase,
    featured: row.featured,
    medium: row.medium ?? 'video',
    priceCents: row.priceCents ?? 0,
    priceKrw: row.priceKrw ?? 0,
    price1080Cents: row.price1080Cents ?? 0,
    price1080Krw: row.price1080Krw ?? 0,
    runtimeSeconds: row.runtimeSeconds ?? null,
    engine: row.engine ?? null,
    aspectDefault: row.aspectDefault ?? null,
    publishedAt: row.publishedAt,
    poster,
    video,
    audio,
    // Only ever an http(s) URL: the schema refuses anything else at the boundary and the DB CHECK
    // refuses it underneath, so this cannot become a `javascript:` href.
    sourceUrl: row.sourceUrl ?? null,
    visibility: row.textVisibility,
    tier,
  };

  const visible =
    canView(tier, row.textVisibility) ||
    (options.unlocked === true && canView('pro', row.textVisibility));
  if (!visible) return { ...base, locked: true };
  /**
   * The process write-up rides WITH the text (2026-08-14). One gate, not two: it is the same
   * knowledge in longer form, so a reader who may have the prompt may have the making-of, and a
   * locked payload carries neither — the object simply has no key to leak from.
   */
  return {
    ...base,
    locked: false,
    text: row.promptText,
    process: row.processMd ?? null,
    processKo: row.processMdKo ?? null,
  };
}
