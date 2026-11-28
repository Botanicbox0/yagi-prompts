import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { AssetRefSchema } from '@/lib/content/schemas';
import { approvedCreator, lockUser } from '@/lib/creator-platform/service';
import { isVideoAspect } from '@/lib/images/engines';
import { WORK_ID } from '@/lib/makers/works';
import { probeVideoDurationSeconds, promptStagingKey, publishPromptMedia, sha256Hex } from '@/lib/prompts/media';
import { insertPrompt } from '@/lib/prompts/repo';
import { centsForKrw, isRoyalty, price1080KrwFor, quoteRecipeBase } from '@/lib/recipes/pricing';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import {
  legacyPromptText,
  parseRecipe,
  primaryStep,
  recipeCast,
  SELFIE_SLOT,
  type Recipe,
} from '@/lib/recipes/schema';
import { selfPublishSlug } from '@/lib/recipes/self-publish';
import type { RenderStore } from '@/lib/renders/store';
import type { StorageDriver } from '@/lib/storage';
import { PostError } from './repo';
import { POST_PROMPT_MAX, POST_PROMPT_MIN } from './schema';

const SELFIE_ALIASES = /(?:\{\{\s*selfie\s*\}\}|@Image\s*1\b|\[내\s*사진\]|\[My\s*photo\])/gi;
const HAS_SELFIE_TOKEN = /\{\{selfie\}\}/;

const IMAGE_ASPECTS = ['1:1', '4:5', '3:4', '4:3', '16:9', '9:16'] as const;

export const CreateBlogMakeCardInput = z
  .object({
    title: z.string().trim().min(3).max(120),
    titleKo: z.string().trim().max(120).nullable().optional(),
    workId: z.string().regex(WORK_ID),
    kind: z.enum(['image', 'video']),
    prompt: z.string().trim().min(POST_PROMPT_MIN).max(POST_PROMPT_MAX),
    aspect: z.string().trim().min(3).max(8).optional(),
    duration: z.number().int().min(4).max(15).optional(),
    royaltyKrw: z.number().int().default(0),
    rightsConfirmed: z.literal(true),
  })
  .strict();

export type CreateBlogMakeCardInput = z.infer<typeof CreateBlogMakeCardInput>;

export interface CreatedBlogMakeCard {
  formatId: string;
  templateId: string;
  slug: string;
  priceKrw: number;
}

/** Replaces `@Image 1`, `[내 사진]`, or `[My photo]` with canonical `{{selfie}}`. */
export function normalizeBlogMakePrompt(raw: string): string | null {
  const normalized = raw.trim().replace(/\r\n?/g, '\n').replace(SELFIE_ALIASES, `{{${SELFIE_SLOT}}}`);
  if (!HAS_SELFIE_TOKEN.test(normalized)) return null;
  return normalized;
}

/**
 * Mints an unlisted (`catalog_listed = false`, `status = 'published'`) runnable creator format
 * directly from a blog post's prompt + uploaded `maker_works` item so readers can generate with
 * their own selfie inside TWINGS and the creator earns royalties without official catalog placement.
 */
export async function createUnlistedMakeCard(
  deps: { sql: SqlRunner; store: RenderStore; storage: StorageDriver },
  userId: string,
  rawInput: unknown,
): Promise<CreatedBlogMakeCard> {
  if (!(await approvedCreator(deps.sql, userId))) throw new PostError('forbidden');
  if (!(await recipeSchemaReady(deps.sql))) throw new PostError('unavailable');

  const parsed = CreateBlogMakeCardInput.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'rightsConfirmed') throw new PostError('rights_required');
    throw new PostError('invalid');
  }
  const input = parsed.data;
  if (!isRoyalty(input.royaltyKrw)) throw new PostError('invalid');

  const normalizedPrompt = normalizeBlogMakePrompt(input.prompt);
  if (!normalizedPrompt) throw new PostError('invalid', 'selfie_slot_required');

  const aspect =
    input.kind === 'video'
      ? input.aspect && isVideoAspect(input.aspect)
        ? input.aspect
        : '16:9'
      : input.aspect && (IMAGE_ASPECTS as readonly string[]).includes(input.aspect)
        ? input.aspect
        : '4:5';
  const duration = input.kind === 'video' ? (input.duration ?? 10) : undefined;

  const candidateRecipe =
    input.kind === 'video'
      ? {
          version: 2,
          slots: { [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true } },
          steps: [
            {
              id: 'film',
              kind: 'video',
              engine: 'seedance-2.5',
              inputs: [SELFIE_SLOT],
              prompt: normalizedPrompt,
              params: { aspect, duration: duration!, resolution: '720p' },
            },
          ],
          output: { from: 'film' },
        }
      : {
          version: 2,
          slots: { [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true } },
          steps: [
            {
              id: 'still',
              kind: 'image',
              engine: 'nano-banana-pro',
              inputs: [SELFIE_SLOT],
              prompt: normalizedPrompt,
              params: { aspect },
            },
          ],
          output: { from: 'still' },
        };

  const checked = parseRecipe(candidateRecipe);
  if (!checked.ok) throw new PostError('invalid', 'recipe_invalid');
  const recipe: Recipe = checked.recipe;

  const { rows: workRows } = await deps.sql.query<{
    id: string;
    kind: 'image' | 'video';
    storage_key: string;
    mime: string;
  }>('select id, kind, storage_key, mime from maker_works where id = $1 and user_id = $2', [
    input.workId,
    userId,
  ]);
  const work = workRows[0];
  if (!work) throw new PostError('invalid_work');

  const bytes = await deps.store.read(work.storage_key).catch(() => {
    throw new PostError('invalid_work');
  });

  const templateId = randomUUID();
  const formatId = randomUUID();
  const ext =
    work.mime === 'image/png'
      ? 'png'
      : work.mime === 'image/webp'
        ? 'webp'
        : work.mime === 'video/quicktime'
          ? 'mov'
          : work.kind === 'video'
            ? 'mp4'
            : 'jpg';
  const stagingKey = promptStagingKey(templateId, ext);
  await deps.storage.putStaging(stagingKey, bytes, work.mime);

  let mediaRef;
  if (work.kind === 'image') {
    const meta = await sharp(bytes).metadata().catch(() => null);
    mediaRef = AssetRefSchema.parse({
      staging_key: stagingKey,
      sha256: sha256Hex(bytes),
      mime: work.mime,
      ...(meta?.width && meta?.height ? { w: meta.width, h: meta.height } : {}),
    });
  } else {
    const seconds = probeVideoDurationSeconds(bytes, work.mime);
    mediaRef = AssetRefSchema.parse({
      staging_key: stagingKey,
      sha256: sha256Hex(bytes),
      mime: work.mime,
      ...(seconds ? { duration_s: Math.round(seconds * 100) / 100 } : {}),
    });
  }
  const { media } = await publishPromptMedia(
    deps.storage,
    work.kind === 'image' ? { poster: mediaRef } : { video: mediaRef },
  );

  const primary = primaryStep(recipe);
  const film = recipe.steps.find((step) => step.kind === 'video');
  const priceKrw = quoteRecipeBase(recipe, input.royaltyKrw).proposedKrw;
  const price1080Krw = price1080KrwFor(recipe, priceKrw);
  const slug = selfPublishSlug(input.title, templateId);
  const titleKo = input.titleKo?.trim() ? input.titleKo.trim() : input.title;
  const disclosure = { prompts: true, assets: false };

  await deps.sql.transaction(async (tx) => {
    await lockUser(tx, userId);
    await insertPrompt(tx, {
      id: templateId,
      slug,
      source: 'yagi',
      authorId: userId,
      authorHandle: null,
      status: 'published',
      publishedAt: 'now',
      models: [primary.engine],
      title: input.title,
      titleKo,
      promptText: legacyPromptText(recipe),
      textVisibility: 'hidden',
      media,
      useCase: [],
      featured: false,
      medium: primary.kind,
      engine: primary.engine,
      aspectDefault: primary.params.aspect,
      runtimeSeconds: film?.kind === 'video' ? film.params.duration : null,
      priceKrw,
      priceCents: centsForKrw(priceKrw),
      ...(price1080Krw > 0 ? { price1080Krw, price1080Cents: centsForKrw(price1080Krw) } : {}),
      cast: recipeCast(recipe),
    });
    await tx.query(
      "update prompt_items set recipe = $2::jsonb, disclosure = $3::jsonb, presentation = 'story-first' where id = $1",
      [templateId, JSON.stringify(recipe), JSON.stringify(disclosure)],
    );
    try {
      await tx.query('update prompt_items set catalog_listed = false where id = $1', [templateId]);
    } catch {
      // Pre-0208 schema fallback
    }
    await tx.query(
      `insert into platform_formats (id, user_id, title, title_ko, recipe, recipe_v2, example_url, medium, status, template_id, disclosure, presentation, royalty_krw)
       values ($1, $2, $3, $4, $5, $6::jsonb, null, $7, 'accepted', $8, $9::jsonb, 'story-first', $10)`,
      [
        formatId,
        userId,
        input.title,
        titleKo,
        primary.prompt,
        JSON.stringify(recipe),
        primary.kind,
        templateId,
        JSON.stringify(disclosure),
        input.royaltyKrw,
      ],
    );
    try {
      await tx.query('update platform_formats set catalog_listed = false where id = $1', [formatId]);
    } catch {
      // Pre-0208 schema fallback
    }
  });

  return { formatId, templateId, slug, priceKrw };
}
