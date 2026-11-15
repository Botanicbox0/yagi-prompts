import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { isVideoAspect } from '@/lib/images/engines';
import { centsForKrw, isRoyalty, quoteRecipe, quoteRecipeBase } from '@/lib/recipes/pricing';
import { loadTemplateRecipe, recipeSchemaReady } from '@/lib/recipes/repo';
import { legacyPromptText, parseRecipe, SELFIE_SLOT, type Recipe } from '@/lib/recipes/schema';
import type { StorageDriver } from '@/lib/storage';
import { promptStagingKey, publishPromptMedia, sha256Hex } from './media';
import { insertPrompt, slugExists } from './repo';
import { PROMPT_TITLE_MAX, SlugSchema, USE_CASES } from './schemas';

/**
 * A creative's FILM as their template (first used 2026-10-29 for @yunseolfromseoul's
 * `aquarium-goldfish-daydream`): the exact prompt behind their post becomes a one-step recipe, and
 * the row lands exactly where `/admin`'s format acceptance + publish would put it — a `source='yagi'`
 * row with the creative as author, `hidden` text, the recipe and the creative's page choices, and an
 * accepted `platform_formats` row so the template counts as theirs (credit, royalty, settlement).
 *
 *   prompt   the post's prompt with the photo written `@Image 1` (Higgsfield's dialect). It becomes
 *            `{{selfie}}`, which the page shows as `[내 사진]` / `[My photo]` and the engine reads
 *            back as "Image 1" (`engineStepPrompt`). Nothing else in the text changes; `buildMakerFilm`
 *            refuses a prompt that names any other input.
 *   price    the studio's won price for the 720p make, never below its cost floor (`quoteRecipeBase`),
 *            the same rule the acceptance enforces. An order renders at the resolution it names
 *            (lib/recipes/resolution.ts), so 1080p is a second price, `price_1080_krw`: optional, never
 *            below the 1080p floor nor below `price_krw`. Left out, the film sells at 720p only.
 *            `resolution` in the file is what the creative wrote and tested the film at.
 *
 * Re-running never edits a live template: a taken slug is left as it is (edits go through `/admin`).
 */

const PHOTO = /@Image\s*1\b/g;
const NAMES_PHOTO = /@Image\s*1\b/;
const OTHER_INPUT = /@(Image|Video|Audio)\s*\d+/i;

export const MakerFilmSchema = z.object({
  slug: SlugSchema,
  title_en: z.string().trim().min(1).max(PROMPT_TITLE_MAX),
  title_ko: z.string().trim().min(1).max(120),
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
  engine: z.literal('seedance-2.5'),
  aspect: z.string().refine(isVideoAspect, 'aspect'),
  duration: z.number().int().min(4).max(15),
  resolution: z.enum(['720p', '1080p']),
  price_krw: z.number().int().min(100).max(1_000_000),
  price_1080_krw: z.number().int().min(100).max(1_000_000).optional(),
  royalty_krw: z.number().refine(isRoyalty, 'royalty'),
  use_case: z.array(z.enum(USE_CASES)).max(4),
  presentation: z.enum(['make-first', 'story-first']),
  disclosure: z.object({ prompts: z.boolean(), assets: z.literal(false) }).strict(),
  example_url: z.string().regex(/^https:\/\/\S+$/).max(500).nullable(),
}).strict();
export type MakerFilmFile = z.infer<typeof MakerFilmSchema>;

export interface MakerFilm extends MakerFilmFile { recipe: Recipe }

export interface FilmMedia {
  video: { bytes: Uint8Array; mime: 'video/mp4'; w: number; h: number; seconds: number };
  poster: { bytes: Uint8Array; mime: 'image/jpeg' | 'image/webp'; w: number; h: number };
}

export type FilmOutcome = { slug: string; status: 'created'; id: string } | { slug: string; status: 'exists' };

/** The template file + the post's prompt → a checked film, or every reason it is refused. */
export function buildMakerFilm(raw: unknown, prompt: string): { ok: true; film: MakerFilm } | { ok: false; errors: string[] } {
  const file = MakerFilmSchema.safeParse(raw);
  if (!file.success) return { ok: false, errors: file.error.issues.map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`) };
  const text = prompt.trim().replace(/\r\n?/g, '\n');
  if (!NAMES_PHOTO.test(text)) return { ok: false, errors: ['prompt: never names @Image 1, the buyer\'s photo'] };
  const withSlot = text.replace(PHOTO, `{{${SELFIE_SLOT}}}`);
  if (OTHER_INPUT.test(withSlot)) return { ok: false, errors: ['prompt: names an input other than @Image 1'] };
  const f = file.data;
  const checked = parseRecipe({
    version: 2,
    slots: { [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true } },
    steps: [{ id: 'film', kind: 'video', engine: f.engine, inputs: [SELFIE_SLOT], prompt: withSlot, params: { aspect: f.aspect, duration: f.duration, resolution: f.resolution } }],
    output: { from: 'film' },
  });
  if (!checked.ok) return { ok: false, errors: checked.issues.map((issue) => `recipe: ${issue.code}${'step' in issue && issue.step ? ` (${issue.step})` : ''}`) };
  const floor = quoteRecipeBase(checked.recipe, f.royalty_krw).floorKrw;
  if (f.price_krw < floor) return { ok: false, errors: [`price_krw: ${f.price_krw} is below the 720p cost floor ${floor}`] };
  if (f.price_1080_krw !== undefined) {
    const floor1080 = quoteRecipe(checked.recipe, f.royalty_krw, '1080p').floorKrw;
    if (f.price_1080_krw < floor1080) return { ok: false, errors: [`price_1080_krw: ${f.price_1080_krw} is below the 1080p cost floor ${floor1080}`] };
    if (f.price_1080_krw < f.price_krw) return { ok: false, errors: [`price_1080_krw: ${f.price_1080_krw} is below price_krw ${f.price_krw}`] };
  }
  return { ok: true, film: { ...f, recipe: checked.recipe } };
}

const EXTENSIONS: Record<string, string> = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function registerMakerFilm(deps: { sql: SqlRunner; storage: StorageDriver }, film: MakerFilm, media: FilmMedia): Promise<FilmOutcome> {
  if (await slugExists(deps.sql, film.slug)) return { slug: film.slug, status: 'exists' };
  if (!(await recipeSchemaReady(deps.sql))) throw new Error('recipe tables are missing (migration 0059)');
  const maker = (await deps.sql.query<{ user_id: string }>(
    'select user_id from platform_creators where handle = $1 and active and public_profile', [film.handle],
  )).rows[0];
  if (!maker) throw new Error(`@${film.handle} is not an active maker with a public profile`);

  const id = randomUUID();
  const stage = async (asset: { bytes: Uint8Array; mime: string; w: number; h: number }, extra: Partial<AssetRef> = {}): Promise<AssetRef> => {
    const key = promptStagingKey(id, EXTENSIONS[asset.mime]!);
    await deps.storage.putStaging(key, asset.bytes, asset.mime);
    return AssetRefSchema.parse({ staging_key: key, sha256: sha256Hex(asset.bytes), mime: asset.mime, w: asset.w, h: asset.h, ...extra });
  };
  const { media: published } = await publishPromptMedia(deps.storage, {
    video: await stage(media.video, { duration_s: media.video.seconds }),
    poster: await stage(media.poster),
  });

  await deps.sql.transaction(async (tx) => {
    await insertPrompt(tx, {
      id, slug: film.slug, source: 'yagi', authorId: maker.user_id, authorHandle: null, status: 'published',
      models: [film.engine], title: film.title_en, titleKo: film.title_ko,
      promptText: legacyPromptText(film.recipe), textVisibility: 'hidden', media: published,
      useCase: film.use_case, featured: false, medium: 'video',
      priceCents: centsForKrw(film.price_krw), priceKrw: film.price_krw,
      ...(film.price_1080_krw !== undefined ? { price1080Krw: film.price_1080_krw, price1080Cents: centsForKrw(film.price_1080_krw) } : {}),
      runtimeSeconds: film.duration, engine: film.engine, aspectDefault: film.aspect, publishedAt: 'now',
    });
    // Recipe and disclosure before the format links the row: 0059's guard freezes both from then on.
    await tx.query('update prompt_items set recipe = $2::jsonb, disclosure = $3::jsonb, presentation = $4 where id = $1',
      [id, JSON.stringify(film.recipe), JSON.stringify(film.disclosure), film.presentation]);
    await tx.query(
      `insert into platform_formats (id, user_id, title, recipe, example_url, medium, status, template_id, recipe_v2, title_ko, disclosure, presentation, royalty_krw)
       values ($1, $2, $3, $4, $5, 'video', 'accepted', $6, $7::jsonb, $8, $9::jsonb, $10, $11)`,
      [randomUUID(), maker.user_id, film.title_en, film.recipe.steps[0]!.prompt, film.example_url, id,
        JSON.stringify(film.recipe), film.title_ko, JSON.stringify(film.disclosure), film.presentation, film.royalty_krw],
    );
  });

  const stored = await loadTemplateRecipe(deps.sql, id);
  if (!stored || stored.steps[0]?.prompt !== film.recipe.steps[0]!.prompt) throw new Error(`${film.slug}: the stored recipe differs from the prompt file`);
  return { slug: film.slug, status: 'created', id };
}
