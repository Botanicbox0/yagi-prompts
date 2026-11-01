import type { SqlRunner } from '@/lib/db/sql-runner';
import { parseRecipe, type Recipe } from './schema';

/**
 * Recipe rows (0059). Every reader probes first: on a database without 0059 a template simply has no
 * recipe and a job takes the single-prompt path, exactly as before the migration.
 *
 * `prompt_items.recipe` is read ONLY here, by id, never in the catalogue's column list — the public
 * projection cannot carry it by construction (tests/recipes/public-canary.test.ts).
 */

export type RenderPurpose = 'customer' | 'maker_test' | 'studio_review';
export interface StepRecord { key: string; mime: string; bytes: number; usd: number | null }
export interface RecipeState { steps?: Record<string, StepRecord> }
/** `recipe` is null when a stored snapshot no longer passes the rules: the pass refuses it rather than half-running it. */
export interface JobRecipe { renderId: string; purpose: RenderPurpose; formatId: string | null; recipe: Recipe | null; state: RecipeState }
export interface Disclosure { prompts: boolean; assets: boolean }
export type Presentation = 'make-first' | 'story-first';

/** The fixed internal template every test and review render points at (render_jobs.template_id is required). */
export const MAKER_SANDBOX_ID = '7f1c5a00-0000-4000-8000-00000000a7e5';
export const MAKER_SANDBOX_SLUG = 'maker-sandbox';

export async function recipeSchemaReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(`select to_regclass('public.render_job_recipes') is not null and to_regclass('public.render_job_outputs') is not null as ready`);
  return rows[0]?.ready === true;
}

/** A template's recipe, re-validated on the way out; null for every studio original (or before 0059). */
export async function loadTemplateRecipe(sql: SqlRunner, templateId: string): Promise<Recipe | null> {
  const { rows } = await sql.query<{ recipe: unknown }>(`select to_jsonb(p.*)->'recipe' as recipe from prompt_items p where p.id=$1`, [templateId]);
  const raw = rows[0]?.recipe;
  if (raw === null || raw === undefined) return null;
  const checked = parseRecipe(raw, { studio: true });
  return checked.ok ? checked.recipe : null;
}

export async function loadJobRecipe(sql: SqlRunner, renderId: string): Promise<JobRecipe | null> {
  if (!await recipeSchemaReady(sql)) return null;
  const { rows } = await sql.query<{ render_id: string; purpose: RenderPurpose; format_id: string | null; recipe: unknown; state: RecipeState }>(
    'select render_id,purpose,format_id,recipe,state from render_job_recipes where render_id=$1', [renderId]);
  const row = rows[0];
  if (!row) return null;
  const checked = parseRecipe(row.recipe, { studio: true });
  return { renderId: row.render_id, purpose: row.purpose, formatId: row.format_id, recipe: checked.ok ? checked.recipe : null, state: row.state ?? {} };
}

export async function insertJobRecipe(sql: SqlRunner, args: { renderId: string; purpose: RenderPurpose; formatId: string | null; recipe: Recipe }): Promise<void> {
  await sql.query('insert into render_job_recipes(render_id,purpose,format_id,recipe) values($1,$2,$3,$4::jsonb) on conflict (render_id) do nothing',
    [args.renderId, args.purpose, args.formatId, JSON.stringify(args.recipe)]);
}

/** A customer job of a recipe template: snapshot the recipe on first run, so a retry runs the same steps. */
export async function ensureJobRecipe(sql: SqlRunner, renderId: string, templateId: string): Promise<JobRecipe | null> {
  if (!await recipeSchemaReady(sql)) return null;
  const existing = await loadJobRecipe(sql, renderId);
  if (existing) return existing;
  const recipe = await loadTemplateRecipe(sql, templateId);
  if (!recipe) return null;
  await insertJobRecipe(sql, { renderId, purpose: 'customer', formatId: null, recipe });
  return loadJobRecipe(sql, renderId);
}

export async function saveStepRecord(sql: SqlRunner, renderId: string, stepId: string, record: StepRecord): Promise<void> {
  await sql.query(`update render_job_recipes set state=jsonb_set(case when state ? 'steps' then state else state||'{"steps":{}}'::jsonb end,array['steps',$2::text],$3::jsonb,true) where render_id=$1`,
    [renderId, stepId, JSON.stringify(record)]);
}

export async function insertJobOutputs(sql: SqlRunner, renderId: string, outputs: ReadonlyArray<{ stepId: string; key: string; mime: string; bytes: number }>): Promise<void> {
  for (const [position, output] of outputs.entries()) {
    await sql.query('insert into render_job_outputs(render_id,position,step_id,storage_key,mime,bytes) values($1,$2,$3,$4,$5,$6) on conflict (render_id,position) do nothing',
      [renderId, position, output.stepId, output.key, output.mime, output.bytes]);
  }
}

export interface JobOutput { position: number; stepId: string; key: string; mime: string; bytes: number }
export async function listJobOutputs(sql: SqlRunner, renderId: string): Promise<JobOutput[]> {
  if (!await recipeSchemaReady(sql)) return [];
  const { rows } = await sql.query<{ position: number; step_id: string; storage_key: string; mime: string; bytes: number }>(
    'select position,step_id,storage_key,mime,bytes from render_job_outputs where render_id=$1 order by position', [renderId]);
  return rows.map((row) => ({ position: row.position, stepId: row.step_id, key: row.storage_key, mime: row.mime, bytes: row.bytes }));
}

/** Test and review renders are not orders: no email, no share link, no place in "내 결과물". */
export async function renderPurpose(sql: SqlRunner, renderId: string): Promise<RenderPurpose> {
  if (!await recipeSchemaReady(sql)) return 'customer';
  const { rows } = await sql.query<{ purpose: RenderPurpose }>('select purpose from render_job_recipes where render_id=$1', [renderId]);
  return rows[0]?.purpose ?? 'customer';
}

/**
 * The internal template row test and review jobs point at. Brand audience (so no public reader and
 * no editor update can touch it — 0033's guard), archived, not for sale. Created on first use.
 */
export async function ensureMakerSandbox(sql: SqlRunner): Promise<string> {
  await sql.query(`insert into prompt_items(id,slug,source,status,models,title,title_ko,prompt_text,text_visibility,use_case,featured,medium,price_cents,price_krw,audience)
    values($1,$2,'yagi','archived','{gpt-image-2}','Maker test render (internal)','메이커 테스트 렌더(내부)','Internal: the recipe snapshot on each job is what runs.','hidden','{}',false,'image',0,0,'brand')
    on conflict (id) do nothing`, [MAKER_SANDBOX_ID, MAKER_SANDBOX_SLUG]);
  return MAKER_SANDBOX_ID;
}

export function parseDisclosure(raw: unknown): Disclosure {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { prompts: value.prompts === true, assets: value.assets === true };
}
export function parsePresentation(raw: unknown): Presentation {
  return raw === 'story-first' ? 'story-first' : 'make-first';
}
