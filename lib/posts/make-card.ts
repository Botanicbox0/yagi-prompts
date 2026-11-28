import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { PlatformError } from '@/lib/creator-platform/contract';
import { approvedCreator, lockUser } from '@/lib/creator-platform/service';
import { isImageAspect, isVideoAspect } from '@/lib/images/engines';
import { WORK_ID } from '@/lib/makers/works';
import { catalogListedReady } from '@/lib/prompts/repo';
import { MAKER_DRAFTS_PER_DAY } from '@/lib/recipes/maker';
import { isRoyalty } from '@/lib/recipes/pricing';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import {
  makerEnginesFor,
  parseRecipe,
  primaryStep,
  SELFIE_SLOT,
  type Recipe,
} from '@/lib/recipes/schema';
import { selfPublishFormat, selfPublishOpen, type SelfPublishRow } from '@/lib/recipes/self-publish';
import type { RenderStore } from '@/lib/renders/store';
import type { StorageDriver } from '@/lib/storage';
import { makerBlogOpen } from './flag';
import { PostError } from './repo';
import { POST_PROMPT_MAX, POST_PROMPT_MIN } from './schema';

const SELFIE_ALIASES = /(?:\{\{\s*selfie\s*\}\}|@Image\s*1\b|\[내\s*사진\]|\[My\s*photo\])/gi;
const HAS_SELFIE_TOKEN = /\{\{selfie\}\}/;
const MAKE_CARD_HOURLY_LIMIT = 12;

export const CreateBlogMakeCardInput = z
  .object({
    formatId: z.uuid().optional(),
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
 * through the canonical `selfPublishFormat` gate — enforcing `TWINGS_MAKER_SELF_PUBLISH`, hourly
 * and 3-per-day format limits, media kind match, `rights_at`, and `maker_test` verification.
 */
export async function createUnlistedMakeCard(
  deps: { sql: SqlRunner; store: RenderStore; storage: StorageDriver },
  userId: string,
  rawInput: unknown,
): Promise<CreatedBlogMakeCard> {
  if (!makerBlogOpen() || !selfPublishOpen()) throw new PostError('not_open');
  if (!(await approvedCreator(deps.sql, userId))) throw new PostError('forbidden');
  if (!(await recipeSchemaReady(deps.sql)) || !(await catalogListedReady(deps.sql))) {
    throw new PostError('unavailable');
  }

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

  const videoEngines = makerEnginesFor('video');
  const imageEngines = makerEnginesFor('image');
  const videoEngine = videoEngines.includes('seedance-2.5') ? 'seedance-2.5' : videoEngines[0]!;
  const imageEngine = imageEngines[0]!;

  const aspect =
    input.kind === 'video'
      ? input.aspect && isVideoAspect(input.aspect)
        ? input.aspect
        : '16:9'
      : input.aspect && isImageAspect(input.aspect)
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
              engine: videoEngine,
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
              engine: imageEngine,
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
  if (!work || work.kind !== input.kind) throw new PostError('invalid_work');

  if (deps.store.head) {
    const info = await deps.store.head(work.storage_key).catch(() => null);
    if (!info) throw new PostError('invalid_work');
  } else {
    await deps.store.read(work.storage_key).catch(() => {
      throw new PostError('invalid_work');
    });
  }

  const primary = primaryStep(recipe);
  const titleKo = input.titleKo?.trim() ? input.titleKo.trim() : input.title;
  const disclosure = { prompts: true, assets: false };

  try {
    return await deps.sql.transaction(async (tx) => {
      await lockUser(tx, userId);

      const rate = await tx.query(
        `insert into platform_rate_limits(user_id, window_start, hits)
         values ($1, date_trunc('hour', now()), 1)
         on conflict (user_id, window_start)
         do update set hits = platform_rate_limits.hits + 1
         where platform_rate_limits.hits < $2
         returning hits`,
        [userId, MAKE_CARD_HOURLY_LIMIT],
      );
      if (rate.rows.length === 0) throw new PostError('limit_reached', 'make_limit_reached');
      await tx.query(
        "delete from platform_rate_limits where user_id = $1 and window_start < now() - interval '2 hours'",
        [userId],
      );

      let formatId: string;
      if (input.formatId) {
        const existing = (
          await tx.query<{ id: string; user_id: string; status: string }>(
            'select id, user_id, status from platform_formats where id = $1 for update',
            [input.formatId],
          )
        ).rows[0];
        if (!existing || existing.user_id !== userId) throw new PostError('not_found');
        if (existing.status !== 'draft' && existing.status !== 'submitted') {
          throw new PostError('invalid');
        }
        formatId = existing.id;
        await tx.query(
          `update platform_formats
              set title = $2,
                  title_ko = $3,
                  recipe = $4,
                  recipe_v2 = $5::jsonb,
                  medium = $6,
                  disclosure = $7::jsonb,
                  presentation = 'story-first',
                  royalty_krw = $8,
                  rights_at = now(),
                  catalog_listed = false,
                  updated_at = now()
            where id = $1`,
          [
            formatId,
            input.title,
            titleKo,
            primary.prompt,
            JSON.stringify(recipe),
            primary.kind,
            JSON.stringify(disclosure),
            input.royaltyKrw,
          ],
        );
      } else {
        const daily = await tx.query<{ n: number }>(
          "select count(*)::int as n from platform_formats where user_id = $1 and created_at > now() - interval '1 day'",
          [userId],
        );
        if ((daily.rows[0]?.n ?? 0) >= MAKER_DRAFTS_PER_DAY) {
          throw new PostError('limit_reached', 'make_limit_reached');
        }
        formatId = randomUUID();
        await tx.query(
          `insert into platform_formats (
             id, user_id, title, title_ko, recipe, recipe_v2, example_url,
             medium, status, disclosure, presentation, royalty_krw, rights_at, catalog_listed
           )
           values ($1, $2, $3, $4, $5, $6::jsonb, null, $7, 'draft', $8::jsonb, 'story-first', $9, now(), false)`,
          [
            formatId,
            userId,
            input.title,
            titleKo,
            primary.prompt,
            JSON.stringify(recipe),
            primary.kind,
            JSON.stringify(disclosure),
            input.royaltyKrw,
          ],
        );
      }

      const formatRow: SelfPublishRow = {
        id: formatId,
        user_id: userId,
        status: 'draft',
        title: input.title,
        title_ko: titleKo,
        recipe_v2: recipe,
        disclosure,
        presentation: 'story-first',
        royalty_krw: input.royaltyKrw,
      };

      const published = await selfPublishFormat(
        tx,
        { store: deps.store, storage: deps.storage },
        userId,
        formatRow,
        recipe,
        {
          catalogListed: false,
          example: { storage_key: work.storage_key, mime: work.mime, kind: work.kind },
        },
      );

      return {
        formatId: published.id,
        templateId: published.templateId,
        slug: published.slug,
        priceKrw: published.priceKrw,
      };
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    if (error instanceof PlatformError) {
      if (error.code === 'test_required') throw new PostError('test_required');
      if (error.code === 'example_file_required' || error.code === 'example_film_required') {
        throw new PostError('invalid_work');
      }
      if (error.code === 'unavailable') throw new PostError('unavailable');
      throw new PostError('invalid');
    }
    throw error;
  }
}
