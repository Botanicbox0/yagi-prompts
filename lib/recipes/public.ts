import type { SqlRunner } from '@/lib/db/sql-runner';
import { engineLabel, isEngineId } from '@/lib/images/engines';
import { parseDisclosure, parsePresentation, recipeSchemaReady, type Presentation } from './repo';
import { SELFIE_SLOT, creatorSlotNames, displayStepPrompt, parseRecipe, type Recipe } from './schema';

/**
 * What a template's page may show of its recipe (docs/PLATFORM-2.0.md §7.3·§20.3), in two layers:
 *
 *   outline   anyone, in the static page: the order the creative chose, their intro, how many steps
 *             and which engines, what each step takes in, how many source files. NO prompt text, NO
 *             step notes, NO file address — `recipeOutline` builds it field by field from the full
 *             projection, so a field added there cannot leak here by accident.
 *   full      a signed-in member only (`/api/recipes/{id}`): the prompts in reader form, the notes,
 *             and — only when the creative chose so — the source files with a download address.
 *
 * Both exist only when the creative disclosed something. With `disclosure.prompts` off there is no
 * prompt text in either object at all; with `disclosure.assets` off there are no files. A studio
 * original (`source='yagi'`, no accepted format) answers only when the studio itself turned
 * `disclosure.prompts` on, and never with files: studio-held references stay private.
 */

export type RecipeInput = { kind: 'selfie' } | { kind: 'reference'; n: number } | { kind: 'step'; n: number };
export interface PublicRecipeStep { n: number; kind: 'image' | 'video'; engine: string; inputs: RecipeInput[]; prompt: string; note: string | null }
export interface PublicRecipeFile { n: number; kind: 'image' | 'video'; href: string; download: string }
export interface PublicRecipe {
  presentation: Presentation;
  intro: string | null;
  outro: string | null;
  steps: PublicRecipeStep[] | null;
  files: PublicRecipeFile[] | null;
}
export interface PublicRecipeLabels { selfie: string; reference: string; step: string }

export interface RecipeOutlineStep { n: number; kind: 'image' | 'video'; engine: string; inputs: RecipeInput[] }
export interface RecipeOutline {
  presentation: Presentation;
  intro: string | null;
  /** Null when the prompts are private; the steps' shape otherwise — never their text. */
  steps: RecipeOutlineStep[] | null;
  /** How many source files a member can open and download, by kind; null when none are shown. */
  files: Array<{ kind: 'image' | 'video' }> | null;
}

function inputsOf(recipe: Recipe, inputs: readonly string[]): RecipeInput[] {
  const creators = creatorSlotNames(recipe);
  return inputs.map((name): RecipeInput => {
    if (name === SELFIE_SLOT) return { kind: 'selfie' };
    const creator = creators.indexOf(name);
    if (creator >= 0) return { kind: 'reference', n: creator + 1 };
    return { kind: 'step', n: recipe.steps.findIndex((step) => step.id === name) + 1 };
  });
}

const text = (value: string | undefined) => (value && value.trim() ? value.trim() : null);
const labelOf = (engine: string) => (isEngineId(engine) ? engineLabel(engine) : engine.replace(/-/g, ' ').toUpperCase());

export async function loadPublicRecipe(sql: SqlRunner, templateId: string, labels: PublicRecipeLabels): Promise<PublicRecipe | null> {
  if (!await recipeSchemaReady(sql)) return null;
  const { rows } = await sql.query<{ recipe: unknown; disclosure: unknown; presentation: string; maker: boolean }>(`select p.recipe,p.disclosure,p.presentation,(f.id is not null) as maker from prompt_items p
    left join platform_formats f on f.template_id=p.id and f.status='accepted'
    where p.id=$1 and p.status='published' and p.audience='public' and p.recipe is not null
      and (f.id is not null or p.source='yagi')
    limit 1`, [templateId]);
  const row = rows[0];
  if (!row) return null;
  const checked = parseRecipe(row.recipe);
  if (!checked.ok) return null;
  const disclosure = parseDisclosure(row.disclosure);
  if (!row.maker && !disclosure.prompts) return null;
  const recipe = checked.recipe;
  let files: PublicRecipe['files'] = null;
  if (row.maker && disclosure.assets) {
    const handles = Object.values(recipe.slots).flatMap((slot) => (slot.source === 'creator' ? [{ handle: slot.asset, kind: slot.kind }] : []));
    files = handles.map(({ handle, kind }, i) => ({ n: i + 1, kind, href: `/api/makers/files/${handle}`, download: `/api/makers/files/${handle}?download=1` }));
  }
  return {
    presentation: parsePresentation(row.presentation),
    intro: disclosure.prompts ? text(recipe.notes?.intro) : null,
    outro: disclosure.prompts ? text(recipe.notes?.outro) : null,
    steps: disclosure.prompts ? recipe.steps.map((step, index) => ({
      n: index + 1, kind: step.kind, engine: labelOf(step.engine), inputs: inputsOf(recipe, step.inputs),
      prompt: displayStepPrompt(recipe, step, labels), note: text(step.note),
    })) : null,
    files,
  };
}

/** The public layer of a full projection — built by naming every field, never by spreading. */
export function recipeOutline(recipe: PublicRecipe): RecipeOutline | null {
  if (!recipe.steps && !recipe.files?.length) return null;
  return {
    presentation: recipe.presentation,
    intro: recipe.intro,
    steps: recipe.steps ? recipe.steps.map((step) => ({
      n: step.n, kind: step.kind, engine: step.engine,
      inputs: step.inputs.map((input): RecipeInput => (input.kind === 'selfie' ? { kind: 'selfie' } : { kind: input.kind, n: input.n })),
    })) : null,
    files: recipe.files?.length ? recipe.files.map((file) => ({ kind: file.kind })) : null,
  };
}

/**
 * A member opened this template's full recipe: one row per (template, member), the count of opens
 * and the last one. Best effort — a failure here never withholds the recipe.
 */
export async function recordRecipeOpen(sql: SqlRunner, templateId: string, userId: string): Promise<void> {
  try {
    const { rows } = await sql.query<{ ok: boolean }>("select to_regclass('public.recipe_unlocks') is not null ok");
    if (!rows[0]?.ok) return;
    await sql.query(`insert into recipe_unlocks(template_id,user_id) values($1,$2)
      on conflict (template_id,user_id) do update set opens=recipe_unlocks.opens+1,last_at=now()
      where recipe_unlocks.last_at < now() - interval '1 minute'`, [templateId, userId]);
  } catch { /* counting is not worth an error page */ }
}
