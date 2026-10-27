import type { SqlRunner } from '@/lib/db/sql-runner';
import { parseDisclosure, parsePresentation, recipeSchemaReady, type Presentation } from './repo';
import { displayStepPrompt, parseRecipe } from './schema';

/**
 * What a maker template's public page may show (docs/PLATFORM-2.0.md §7.3): its page order, and —
 * only when the maker chose so — the steps' prompts in reader form and the reference files.
 *
 * The projection is built HERE, field by field, from the recipe the server holds: with
 * `disclosure.prompts` off there is no prompt text in the object at all (not an empty string, not
 * a hidden field), with `disclosure.assets` off there are no file handles. The template page renders
 * exactly this object, so neither its HTML nor its RSC payload can carry what the maker kept private
 * (tests/recipes/review.test.tsx). A studio original (`source='yagi'`, no accepted format) answers
 * only when the studio itself turned `disclosure.prompts` on, and never with files: studio-held
 * references stay private. Every other studio original answers null.
 */

export interface PublicRecipeStep { n: number; kind: 'image' | 'video'; prompt: string }
export interface PublicRecipe {
  presentation: Presentation;
  steps: PublicRecipeStep[] | null;
  files: Array<{ href: string; kind: 'image' | 'video' }> | null;
}
export interface PublicRecipeLabels { selfie: string; reference: string; step: string }

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
    files = handles.map(({ handle, kind }) => ({ href: `/api/makers/files/${handle}`, kind }));
  }
  return {
    presentation: parsePresentation(row.presentation),
    steps: disclosure.prompts ? recipe.steps.map((step, index) => ({ n: index + 1, kind: step.kind, prompt: displayStepPrompt(recipe, step, labels) })) : null,
    files,
  };
}
