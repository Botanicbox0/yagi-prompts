import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import type { RenderStore } from '@/lib/renders/store';
import { demand } from '@/lib/creator-platform/contract';
import { audit } from '@/lib/creator-platform/service';
import { listSelfies, savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { createRecipeSandboxRender } from '@/lib/renders/service';
import { listMakerFiles, type MakerAsset } from './assets';
import { quoteRecipe, type RecipeQuote } from './pricing';
import { parseDisclosure, parsePresentation, recipeSchemaReady, type Disclosure, type Presentation } from './repo';
import { parseRecipe, recipeCast, recipeMedium, type Recipe, type RecipeMedium } from './schema';

/**
 * The studio's review of a maker recipe (docs/PLATFORM-2.0.md §7.4, §18 R1): three review renders
 * side by side, each with a different face the studio holds — the admin's own saved photos first,
 * then the public portrait-guide people (`public/images/portrait-guide/*`, studio-owned images) —
 * so "the face stays" is judged on more than the maker's own face. Admin only (`platform.review`),
 * audited, never counted against the maker's three test renders.
 */

export const REVIEW_RENDERS = 3;
/** Studio-owned guide portraits, in the order they fill the set. */
export const STUDIO_REVIEW_FACES = ['/images/portrait-guide/front-facing.webp', '/images/portrait-guide/clear-face.webp', '/images/portrait-guide/turned-face.webp'] as const;

export const PlatformReviewInput = z.object({ action: z.literal('render'), id: z.uuid(), reason: z.string().trim().min(3).max(2000) }).strict();
export type PlatformReviewInput = z.infer<typeof PlatformReviewInput>;

export type ReviewFace = { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/webp'; selfieId?: string };

/** The admin's own photos, then the guide portraits (fetched from the site — `public/` is not on a function's disk). */
export async function studioReviewFaces(sql: SqlRunner, store: RenderStore, adminId: string, fetchGuide: (path: string) => Promise<Uint8Array | null>): Promise<ReviewFace[]> {
  const faces: ReviewFace[] = [];
  for (const row of await listSelfies(sql, adminId)) {
    if (faces.length >= REVIEW_RENDERS) break;
    const photo = await savedSelfiePhoto(sql, store, adminId, row.id);
    if (photo) faces.push({ ...photo, selfieId: row.id });
  }
  for (const path of STUDIO_REVIEW_FACES) {
    if (faces.length >= REVIEW_RENDERS) break;
    const bytes = await fetchGuide(path);
    if (bytes?.byteLength) faces.push({ bytes, mime: 'image/webp' });
  }
  return faces;
}

export async function startReviewRenders(deps: { sql: SqlRunner; store: RenderStore; faces: () => Promise<ReviewFace[]> }, viewer: Viewer, raw: unknown): Promise<{ id: string; renderIds: string[] }> {
  demand(viewer.isAdmin && viewer.userId, 'forbidden');
  const parsed = PlatformReviewInput.safeParse(raw);
  demand(parsed.success, 'invalid');
  const input = parsed.data;
  demand(await recipeSchemaReady(deps.sql), 'not_open');
  const faces = (await deps.faces()).slice(0, REVIEW_RENDERS);
  demand(faces.length, 'no_faces');
  return deps.sql.transaction(async (tx) => {
    const { rows } = await tx.query<{ status: string; recipe_v2: unknown }>('select status,recipe_v2 from platform_formats where id=$1 for update', [input.id]);
    const row = rows[0];
    demand(row, 'not_found');
    demand(row.status === 'submitted', 'conflict');
    const checked = parseRecipe(row.recipe_v2);
    demand(checked.ok, 'recipe_invalid');
    // docs/CAST-CATEGORIES.md §3: review renders send studio faces only; a pet or couple recipe would fail
    // every one of them ("user slot pet is missing"), so it is refused before any render is made.
    demand(recipeCast(checked.recipe) === 'solo', 'cast_test_unavailable');
    const renderIds: string[] = [];
    for (const face of faces) {
      const created = await createRecipeSandboxRender({ sql: tx, store: deps.store }, { userId: viewer.userId!, locale: viewer.locale ?? null, formatId: input.id, purpose: 'studio_review', recipe: checked.recipe, photo: face, selfieId: face.selfieId });
      demand(created.ok, 'bad_photo');
      renderIds.push(created.id);
    }
    await audit(tx, viewer.userId!, input.id, 'review_render', input.reason, { renders: renderIds.length });
    return { id: input.id, renderIds };
  });
}

export interface ReviewStep { id: string; kind: 'image' | 'video'; engine: string; inputs: string[]; aspect: string; duration: number | null; resolution: string | null; prompt: string }
export interface ReviewRender { id: string; status: string; errorCode: string | null; outputs: number; createdAt: string }
export interface ReviewEntry {
  id: string; titleKo: string | null; medium: RecipeMedium | null; valid: boolean; steps: ReviewStep[];
  slots: Array<{ name: string; source: 'user' | 'creator'; kind: 'image' | 'video'; asset: string | null }>;
  files: MakerAsset[]; disclosure: Disclosure; presentation: Presentation; royaltyKrw: number | null; quote: RecipeQuote | null;
  testRendersUsed: number; renders: ReviewRender[];
}

/** The v2 half of the review queue, keyed by format id; empty before 0059 or for v1 submissions. */
export async function loadReviewEntries(sql: SqlRunner, ids: string[]): Promise<Map<string, ReviewEntry>> {
  const entries = new Map<string, ReviewEntry>();
  if (!ids.length || !await recipeSchemaReady(sql)) return entries;
  const { rows } = await sql.query<{ id: string; title_ko: string | null; recipe_v2: unknown; disclosure: unknown; presentation: string; royalty_krw: number | null; test_renders_used: number }>(
    'select id,title_ko,recipe_v2,disclosure,presentation,royalty_krw,test_renders_used from platform_formats where id=any($1::uuid[]) and recipe_v2 is not null', [ids]);
  for (const row of rows) {
    const checked = parseRecipe(row.recipe_v2);
    const recipe: Recipe | null = checked.ok ? checked.recipe : null;
    const renders = await sql.query<{ id: string; status: string; error_code: string | null; outputs: number; created_at: unknown }>(`select j.id,j.status,j.error_code,(select count(*)::int from render_job_outputs o where o.render_id=j.id) outputs,j.created_at
      from render_job_recipes r join render_jobs j on j.id=r.render_id where r.format_id=$1 and r.purpose='studio_review' order by j.created_at desc limit 12`, [row.id]);
    entries.set(row.id, {
      id: row.id, titleKo: row.title_ko, medium: recipe ? recipeMedium(recipe) : null, valid: !!recipe,
      steps: recipe ? recipe.steps.map((step) => ({ id: step.id, kind: step.kind, engine: step.engine, inputs: step.inputs, aspect: step.params.aspect, duration: step.kind === 'video' ? step.params.duration : null, resolution: step.kind === 'video' ? step.params.resolution : null, prompt: step.prompt })) : [],
      slots: recipe ? Object.entries(recipe.slots).map(([name, slot]) => ({ name, source: slot.source, kind: slot.kind, asset: slot.source === 'creator' ? slot.asset : null })) : [],
      files: await listMakerFiles(sql, row.id),
      disclosure: parseDisclosure(row.disclosure), presentation: parsePresentation(row.presentation), royaltyKrw: row.royalty_krw,
      quote: recipe && row.royalty_krw !== null ? quoteRecipe(recipe, row.royalty_krw) : null,
      testRendersUsed: row.test_renders_used,
      renders: renders.rows.map((r) => ({ id: r.id, status: r.status, errorCode: r.error_code, outputs: r.outputs, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) })),
    });
  }
  return entries;
}

