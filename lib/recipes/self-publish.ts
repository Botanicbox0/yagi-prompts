import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import type { StorageDriver } from '@/lib/storage';
import { demand } from '@/lib/creator-platform/contract';
import { lockUser } from '@/lib/creator-platform/service';
import { insertPrompt } from '@/lib/prompts/repo';
import { probeVideoDurationSeconds, promptStagingKey, publishPromptMedia, sha256Hex } from '@/lib/prompts/media';
import { AssetRefSchema } from '@/lib/content/schemas';
import { centsForKrw, isRoyalty, price1080KrwFor, quoteRecipeBase } from './pricing';
import { parseDisclosure, parsePresentation } from './repo';
import { legacyPromptText, primaryStep, recipeCast, type Recipe } from './schema';
import { defaultTimelineKeyframes, parseVideoKeyframes } from '@/lib/prompts/keyframes';
import { imageTestRecipe } from './test-render';

/**
 * docs/PLATFORM-2.0.md §20.6 — an AI creative publishes their own template, no studio review in
 * between (founder decision 2026-10-28: "스튜디오 승인 없이 올릴 수 있게 하자 일단은").
 *
 * What replaces the human review is a set of checks a machine can make, all of them required:
 *
 *   · the recipe passes every rule the render pass enforces (`parseRecipe` + files belong here);
 *   · the creative confirmed they hold the rights to everything in it;
 *   · an uploaded example file exists — it becomes the card's media, so a page never goes up blank;
 *   · at least one of the creative's own TEST RENDERS succeeded: the recipe's image steps have run
 *     on a real face through the real pipeline (provider moderation included) before anyone pays.
 *     A test makes no video (founder decision 2026-11-24, lib/recipes/test-render.ts), so a recipe
 *     with nothing to test — a film only — publishes on its uploaded example FILM instead.
 *
 * The price is the base price (lib/twings/template-price.ts) plus the creative's raise — the price
 * they typed in the studio, never below the base — through the same `quoteRecipeBase` the studio uses. The template goes live published,
 * credited `by @handle`, and the studio's archive control takes it down after the fact.
 * `TWINGS_MAKER_SELF_PUBLISH=off` restores review-only (the `submit` path), without a deploy of code.
 */

export function selfPublishOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TWINGS_MAKER_SELF_PUBLISH !== 'off';
}

/** `Neon Diner — Night!` + id → `neon-diner-night-1a2b3c`: readable, URL-safe, unique by the id tail. */
export function selfPublishSlug(title: string, id: string): string {
  const base = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 48).replace(/^-+|-+$/g, '');
  return `${base || 'template'}-${id.replace(/-/g, '').slice(0, 6)}`;
}

export interface SelfPublishRow { id: string; user_id: string; status: string; title: string; title_ko: string | null; recipe_v2: unknown; disclosure: unknown; presentation: string; royalty_krw: number | null }
export interface SelfPublished { id: string; templateId: string; slug: string; priceKrw: number }

/**
 * Runs inside the caller's transaction, after the caller has authorised the creative and locked
 * their format row. Storage writes happen first and are content-addressed, so a rolled-back
 * transaction leaves at most an orphaned private staging object and an unreferenced public copy.
 */
export async function selfPublishFormat(
  tx: SqlRunner,
  deps: { store: RenderStore; storage: StorageDriver },
  userId: string,
  row: SelfPublishRow,
  recipe: Recipe,
): Promise<SelfPublished> {
  await lockUser(tx, userId);
  demand(row.royalty_krw !== null && isRoyalty(row.royalty_krw), 'invalid');
  // In the order a creative meets them: the example file, then a test render that worked.
  const { rows: files } = await tx.query<{ storage_key: string; mime: string; kind: 'image' | 'video' }>(
    "select storage_key,mime,kind from platform_format_assets where format_id=$1 and role='example' order by created_at desc limit 1", [row.id]);
  const example = files[0];
  demand(example, 'example_file_required');
  if (imageTestRecipe(recipe).ok) {
    const tested = await tx.query(`select 1 from render_job_recipes r join render_jobs j on j.id=r.render_id
      where r.format_id=$1 and r.purpose='maker_test' and j.user_id=$2 and j.status='succeeded' limit 1`, [row.id, userId]);
    demand(tested.rows.length, 'test_required');
  } else {
    demand(example.kind === 'video', 'example_film_required');
  }

  // The example file becomes the card's media through the same staging → public copy the studio uses.
  const templateId = randomUUID();
  const bytes = await deps.store.read(example.storage_key);
  const ext = example.mime === 'image/png' ? 'png' : example.mime === 'image/webp' ? 'webp' : example.mime === 'video/quicktime' ? 'mov' : example.kind === 'video' ? 'mp4' : 'jpg';
  const stagingKey = promptStagingKey(templateId, ext);
  await deps.storage.putStaging(stagingKey, bytes, example.mime);
  let ref;
  if (example.kind === 'image') {
    const meta = await sharp(bytes).metadata().catch(() => null);
    ref = AssetRefSchema.parse({ staging_key: stagingKey, sha256: sha256Hex(bytes), mime: example.mime, ...(meta?.width && meta.height ? { w: meta.width, h: meta.height } : {}) });
  } else {
    const seconds = probeVideoDurationSeconds(bytes, example.mime);
    ref = AssetRefSchema.parse({ staging_key: stagingKey, sha256: sha256Hex(bytes), mime: example.mime, ...(seconds ? { duration_s: Math.round(seconds * 100) / 100 } : {}) });
  }
  const { media } = await publishPromptMedia(deps.storage, example.kind === 'image' ? { poster: ref } : { video: ref });

  const primary = primaryStep(recipe);
  const film = recipe.steps.find((step) => step.kind === 'video');
  // 720p is the price; 1080p is its own, the 1080p base plus the same raise (lib/recipes/resolution.ts).
  const priceKrw = quoteRecipeBase(recipe, row.royalty_krw!).proposedKrw;
  const price1080Krw = price1080KrwFor(recipe, priceKrw);
  const slug = selfPublishSlug(row.title, templateId);
  await insertPrompt(tx, {
    id: templateId, slug, source: 'yagi', authorId: userId, authorHandle: null, status: 'published', publishedAt: 'now',
    models: [primary.engine], title: row.title, titleKo: row.title_ko, promptText: legacyPromptText(recipe), textVisibility: 'hidden',
    media, useCase: [], featured: false, medium: primary.kind, engine: primary.engine, aspectDefault: primary.params.aspect,
    runtimeSeconds: film?.kind === 'video' ? film.params.duration : null, priceKrw, priceCents: centsForKrw(priceKrw),
    ...(price1080Krw > 0 ? { price1080Krw, price1080Cents: centsForKrw(price1080Krw) } : {}),
    // docs/CAST-CATEGORIES.md §1: the recipe's photo slots say who is in it.
    cast: recipeCast(recipe),
  });
  // Written before the format links to the row, so 0059's guard freezes it from then on (as at acceptance).
  await tx.query('update prompt_items set recipe=$2::jsonb,disclosure=$3::jsonb,presentation=$4 where id=$1',
    [templateId, JSON.stringify(recipe), JSON.stringify(parseDisclosure(row.disclosure)), parsePresentation(row.presentation)]);
  if (film?.kind === 'video') {
    try {
      const { rows: kfRows } = await tx.query<{ keyframes: unknown }>(
        "select coalesce(to_jsonb(f.*)->'keyframes', 'null'::jsonb) as keyframes from platform_formats f where f.id=$1",
        [row.id],
      );
      const keyframes = parseVideoKeyframes(kfRows[0]?.keyframes ?? null) ?? defaultTimelineKeyframes(film.params.duration);
      await tx.query('update prompt_items set keyframes=$2::jsonb where id=$1', [templateId, JSON.stringify(keyframes)]);
    } catch {
      // Pre-0088 schemas lack prompt_items.keyframes; publish still succeeds and runtime falls back to default beats.
    }
  }
  await tx.query("update platform_formats set status='accepted',template_id=$2,rights_at=coalesce(rights_at,now()),updated_at=now() where id=$1", [row.id, templateId]);
  return { id: row.id, templateId, slug, priceKrw };
}
