import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { estimateImageUsd, IMAGE_ENGINES, isImageAspect, type ImageAspect, type ImageEngineId } from '@/lib/images/engines';
import { centsForKrw } from '@/lib/recipes/pricing';
import { baseKrw } from '@/lib/twings/template-price';
import { loadTemplateRecipe, recipeSchemaReady } from '@/lib/recipes/repo';
import { engineStepPrompt, isMakerEngine, isStudioRecipeEngine, legacyPromptText, MAX_RECIPE_STEPS, MAX_STEP_PROMPT_CHARS, parseRecipe, SELFIE_SLOT, setFrameStepPrompt, setPromptTooLong, type Recipe } from '@/lib/recipes/schema';
import type { StorageDriver } from '@/lib/storage';
import { promptStagingKey, publishPromptMedia, sha256Hex } from './media';
import { insertPrompt, slugExists } from './repo';
import { PROMPT_GALLERY_MAX, PROMPT_TEXT_MAX, PROMPT_TEXT_MIN, PROMPT_TITLE_MAX, setPromptIssue, SlugSchema } from './schemas';

/**
 * A studio IMAGE SET from a production manifest (Video-Creator's `twings_templates_manifest.json`;
 * first used for the 2026-10-27 five-shot bridal set): one template, one order, one result per
 * manifest entry. Founder, 2026-10-27: "모든 이미지가 하나의 세트로 나와야".
 *
 *   recipe    a recipe-v2 carousel (lib/recipes/schema.ts), one image step per entry, each reading the
 *             buyer's selfie. The entry's own words for the photo, "Image 1", become `{{selfie}}`,
 *             which `engineStepPrompt` turns back into "Image 1" — so every frame's prompt reaches the
 *             engine exactly as the manifest wrote it, followed only by the recipe path's standard
 *             identity line. `buildImageTemplateSet` proves that round trip before anything is written.
 *   media     poster = the set's chosen thumbnail; gallery = every entry's image, in manifest order.
 *   the rest  what `/admin` writes for a YAGI template: published, `pro` text, no use-case chip, not
 *             featured — and price 0, not for sale until the founder prices it in `/admin`
 *             (AGENTS.md §5).
 *
 * Two doors, one writer: this script path, and `/admin/prompts/new/set` (`prompt.createSet`,
 * 2026-11-01), which an operator can use without a manifest or database access. The one-prompt
 * `/admin` form cannot make a set. Recipe steps are never shown publicly (`loadPublicRecipe` answers
 * only for an accepted maker format).
 */

/**
 * The manifest's model ids (Higgsfield CLI names) → the engine TWINGS renders on and the one tier
 * that engine renders at here (lib/images/engines.ts). A manifest asking for another tier is
 * refused rather than quietly rendered at ours.
 */
export const MANIFEST_MODEL_ENGINES: Readonly<Record<string, { engine: ImageEngineId; resolution: string }>> = {
  seedream_v5_5: { engine: 'seedream-5.5', resolution: '2k' },
  seedream_v5_pro: { engine: 'seedream-5.5', resolution: '2k' },
  nano_banana_pro: { engine: 'nano-banana-pro', resolution: '2k' },
};

export const ImageTemplateManifestEntrySchema = z.object({
  template_slug: SlugSchema,
  title_ko: z.string().trim().min(1).max(PROMPT_TITLE_MAX),
  title_en: z.string().trim().min(3).max(PROMPT_TITLE_MAX),
  file_name: z.string().regex(/^[\w.-]+\.(png|jpe?g|webp)$/i, 'file_name must be a bare image file name'),
  model_id: z.string().min(1),
  resolution: z.string().min(1),
  aspect_ratio: z.string().min(1),
  // Not trimmed: the engine gets this exact string, so it has to arrive without padding.
  prompt: z
    .string()
    .min(PROMPT_TEXT_MIN)
    .max(PROMPT_TEXT_MAX)
    .refine((text) => text === text.trim(), 'prompt must not start or end with whitespace'),
});

/** One manifest entry, mapped onto TWINGS names. */
export interface ImageFrameSpec {
  key: string;
  title: string;
  titleKo: string;
  promptText: string;
  engine: ImageEngineId;
  aspect: ImageAspect;
  fileName: string;
}

export type ManifestParse = { ok: true; frames: ImageFrameSpec[] } | { ok: false; errors: string[] };

/** The whole manifest or nothing: one bad entry refuses it, so a half-made set never happens. */
export function parseImageTemplateManifest(raw: unknown): ManifestParse {
  const list = z.array(z.unknown()).min(1).safeParse(raw);
  if (!list.success) return { ok: false, errors: ['the manifest must be a non-empty JSON array'] };

  const errors: string[] = [];
  const frames: ImageFrameSpec[] = [];
  list.data.forEach((item, index) => {
    const parsed = ImageTemplateManifestEntrySchema.safeParse(item);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`#${index + 1} ${issue.path.join('.')}: ${issue.message}`);
      return;
    }
    const entry = parsed.data;
    const label = `#${index + 1} ${entry.template_slug}`;
    const model = MANIFEST_MODEL_ENGINES[entry.model_id];
    if (!model) {
      errors.push(`${label}: unknown model_id ${entry.model_id}`);
      return;
    }
    if (entry.resolution.toLowerCase() !== model.resolution) {
      errors.push(`${label}: ${IMAGE_ENGINES[model.engine].label} renders at ${model.resolution}, not ${entry.resolution}`);
      return;
    }
    if (!isImageAspect(entry.aspect_ratio)) {
      errors.push(`${label}: ${entry.aspect_ratio} is not an image aspect`);
      return;
    }
    frames.push({
      key: entry.template_slug,
      title: entry.title_en,
      titleKo: entry.title_ko,
      promptText: entry.prompt,
      engine: model.engine,
      aspect: entry.aspect_ratio,
      fileName: entry.file_name,
    });
  });

  for (const key of new Set(frames.map((frame) => frame.key))) {
    if (frames.filter((frame) => frame.key === key).length > 1) errors.push(`${key}: listed twice`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, frames };
}

/** What makes the manifest a TWINGS template: its address, its name, and which image is its face. */
export const ImageTemplateSetDescriptorSchema = z.object({
  slug: SlugSchema,
  title_ko: z.string().trim().min(1).max(PROMPT_TITLE_MAX),
  title_en: z.string().trim().min(3).max(PROMPT_TITLE_MAX),
  /** A manifest `file_name`: the card and the template page's main image. */
  thumbnail: z.string().min(1),
});

export interface ImageTemplateSet {
  slug: string;
  title: string;
  titleKo: string;
  engine: ImageEngineId;
  aspect: ImageAspect;
  thumbnail: string;
  frames: ImageFrameSpec[];
  recipe: Recipe;
}

export type SetBuild = { ok: true; set: ImageTemplateSet } | { ok: false; errors: string[] };

const MAX_SET_FRAMES = Math.min(MAX_RECIPE_STEPS, PROMPT_GALLERY_MAX);

export function buildImageTemplateSet(rawDescriptor: unknown, frames: readonly ImageFrameSpec[]): SetBuild {
  const descriptor = ImageTemplateSetDescriptorSchema.safeParse(rawDescriptor);
  if (!descriptor.success) {
    return { ok: false, errors: descriptor.error.issues.map((issue) => `set ${issue.path.join('.')}: ${issue.message}`) };
  }
  const { slug, title_ko: titleKo, title_en: title, thumbnail } = descriptor.data;
  const errors: string[] = [];
  if (frames.length < 2 || frames.length > MAX_SET_FRAMES) errors.push(`a set has 2 to ${MAX_SET_FRAMES} frames, not ${frames.length}`);
  if (!frames.some((frame) => frame.fileName === thumbnail)) errors.push(`thumbnail ${thumbnail} is not one of the manifest's files`);
  const first = frames[0];
  if (first && frames.some((frame) => frame.engine !== first.engine)) errors.push('every frame must render on the same engine');
  if (first && frames.some((frame) => frame.aspect !== first.aspect)) errors.push('every frame must share one aspect');
  if (first && !isMakerEngine(first.engine) && !isStudioRecipeEngine(first.engine)) errors.push(`${first.engine} cannot run a recipe step`);
  for (const frame of frames) {
    const issue = setPromptIssue(frame.promptText);
    if (issue === 'no_photo') errors.push(`${frame.key}: the prompt never names the photo as "Image 1"`);
    if (issue === 'other_reference') errors.push(`${frame.key}: the prompt names a reference a set does not carry`);
    if (issue === 'braces') errors.push(`${frame.key}: the prompt contains "{{" or "}}"`);
    if (setPromptTooLong(frame.promptText)) errors.push(`${frame.key}: the prompt is over ${MAX_STEP_PROMPT_CHARS} characters`);
  }
  if (errors.length > 0 || !first) return { ok: false, errors };

  const raw: Recipe = {
    version: 2,
    slots: { [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true } },
    steps: frames.map((frame, index) => ({
      id: `shot${index + 1}`,
      kind: 'image' as const,
      engine: frame.engine,
      inputs: [SELFIE_SLOT],
      prompt: setFrameStepPrompt(frame.promptText),
      params: { aspect: frame.aspect },
    })),
    output: { frames: frames.map((_, index) => `shot${index + 1}`) },
  };
  const checked = parseRecipe(raw, { studio: true });
  if (!checked.ok) return { ok: false, errors: checked.issues.map((issue) => `recipe ${issue.code}${issue.step ? ` (${issue.step})` : ''}`) };
  if (checked.medium !== 'carousel') return { ok: false, errors: ['the recipe is not a carousel'] };

  // The round trip: what the engine will read starts with the manifest's prompt, byte for byte.
  checked.recipe.steps.forEach((step, index) => {
    const prompt = frames[index]!.promptText;
    const engineText = engineStepPrompt(checked.recipe, step);
    if (engineText !== prompt && !engineText.startsWith(`${prompt}\n\n`)) errors.push(`${frames[index]!.key}: the engine would not receive the manifest prompt verbatim`);
  });
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, set: { slug, title, titleKo, engine: first.engine, aspect: first.aspect, thumbnail, frames: [...frames], recipe: checked.recipe } };
}

export interface PosterImage {
  bytes: Uint8Array;
  mime: 'image/webp' | 'image/jpeg' | 'image/png';
  w: number;
  h: number;
}

export type RegisterOutcome = { slug: string; status: 'created'; id: string } | { slug: string; status: 'exists' };

const EXTENSIONS: Record<PosterImage['mime'], string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * The set in: images staged and published to the public bucket, the row and its recipe written in
 * one transaction, then read back. A slug that is already taken is left alone — re-running never
 * edits a live template (edits go through `/admin`, which revalidates the catalogue).
 */
export async function registerImageTemplateSet(
  deps: { sql: SqlRunner; storage: StorageDriver },
  set: ImageTemplateSet,
  imageFor: (fileName: string) => PosterImage,
): Promise<RegisterOutcome> {
  if (await slugExists(deps.sql, set.slug)) return { slug: set.slug, status: 'exists' };

  const id = randomUUID();
  const staged = new Map<string, AssetRef>();
  for (const fileName of new Set([set.thumbnail, ...set.frames.map((frame) => frame.fileName)])) {
    const image = imageFor(fileName);
    const key = promptStagingKey(id, EXTENSIONS[image.mime]);
    await deps.storage.putStaging(key, image.bytes, image.mime);
    staged.set(fileName, AssetRefSchema.parse({ staging_key: key, sha256: sha256Hex(image.bytes), mime: image.mime, w: image.w, h: image.h }));
  }
  await writeImageTemplateSet(deps, id, set, staged);
  return { slug: set.slug, status: 'created', id };
}

/**
 * The staged images published, the row and its recipe written in one transaction, then read back.
 * `staged` holds one ref per file name in the set. The price starts at the base price of all its
 * frames (lib/twings/template-price.ts, founder rule 2026-11-02); `/admin` can still change it.
 */
export async function writeImageTemplateSet(
  deps: { sql: SqlRunner; storage: StorageDriver },
  id: string,
  set: ImageTemplateSet,
  staged: ReadonlyMap<string, AssetRef>,
  extra: { useCase?: string[] } = {},
): Promise<void> {
  if (!(await recipeSchemaReady(deps.sql))) throw new Error('recipe tables are missing (migration 0059): a set cannot render without them');
  const { media } = await publishPromptMedia(deps.storage, {
    poster: staged.get(set.thumbnail)!,
    gallery: set.frames.map((frame) => staged.get(frame.fileName)!),
  });
  const priceKrw = baseKrw({ medium: 'image', providerUsd: set.frames.reduce((sum, frame) => sum + estimateImageUsd(frame.engine, 1), 0) });

  await deps.sql.transaction(async (tx) => {
    await insertPrompt(tx, {
      id,
      slug: set.slug,
      source: 'yagi',
      authorId: null,
      authorHandle: null,
      status: 'published',
      models: [set.engine],
      title: set.title,
      titleKo: set.titleKo,
      // Legacy readers get the first frame in the catalogue's `@image1` dialect, as a maker template does.
      promptText: legacyPromptText(set.recipe),
      textVisibility: 'pro',
      media,
      useCase: extra.useCase ?? [],
      featured: false,
      medium: 'image',
      priceCents: centsForKrw(priceKrw),
      priceKrw,
      runtimeSeconds: null,
      engine: set.engine,
      aspectDefault: set.aspect,
      publishedAt: 'now',
    });
    await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [id, JSON.stringify(set.recipe)]);
  });

  const stored = await loadTemplateRecipe(deps.sql, id);
  if (!stored || JSON.stringify(stored.steps.map((step) => step.prompt)) !== JSON.stringify(set.recipe.steps.map((step) => step.prompt))) {
    throw new Error(`${set.slug}: the stored recipe differs from the manifest`);
  }
}
