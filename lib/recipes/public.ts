import type { SqlRunner } from '@/lib/db/sql-runner';
import { engineLabel, isEngineId } from '@/lib/images/engines';
import { publicPromptText } from '@/lib/template-director/public-text';
import { parseDisclosure, parsePresentation, recipeSchemaReady, type Presentation } from './repo';
import { SELFIE_SLOT, creatorSlotNames, displayStepPrompt, parseRecipe, type Recipe } from './schema';

/**
 * What a template's page may show of its recipe (docs/PLATFORM-2.0.md §7.3·§20.3), in two layers:
 *
 *   teaser    anyone, in the static page: the order the creative chose, their intro and the opening
 *             of step 1 (its first {@link TEASER_CHARS} characters and the `[BGM …]` line). NO other
 *             prompt text, NO step note, NO closing line, NO file address — `recipeTeaser` builds it
 *             field by field from the full projection, so a field added there cannot leak here.
 *   full      a signed-in member only (`/api/renders/access`, the one gate): the prompts in reader
 *             form, the notes and — only when the creative chose so — the source files with a
 *             download address.
 *
 * Both exist only when the creative disclosed something. With `disclosure.prompts` off there is no
 * prompt text in either object at all; with `disclosure.assets` off there are no files. A studio
 * original (`source='yagi'`, no accepted format) answers only when the studio itself turned
 * `disclosure.prompts` on, and never with files: studio-held references stay private.
 *
 * Every shown prompt — and so the teaser and the members' "프롬프트 복사" text, both built from it — goes
 * without its `Template styling:` / `Template locks:` blocks (`publicPromptText`, the one helper for every
 * customer-visible prompt): those are the studio compiler's instructions, not the recipe. The stored recipe and
 * what the compiler reads keep them. The routes' `publicRecipeText` pass over this projection then finds nothing
 * left to take out and hands back the same object, so the text is transformed exactly once.
 */

/** `pet` and `partner` are the buyer's other two photos (docs/CAST-CATEGORIES.md §3). */
export type RecipeInput = { kind: 'selfie' } | { kind: 'pet' } | { kind: 'partner' } | { kind: 'reference'; n: number } | { kind: 'step'; n: number };
export interface PublicRecipeStep { n: number; kind: 'image' | 'video'; engine: string; inputs: RecipeInput[]; prompt: string; note: string | null }
export interface PublicRecipeGuideStep { n: number; title: string; kind: 'image' | 'video'; meta: string | null; prompt: string; note: string | null }
export interface PublicRecipeFile {
  n: number;
  kind: 'image' | 'video' | 'audio';
  href: string;
  download: string | null;
  containsPerson?: boolean;
}
export interface PublicRecipe {
  presentation: Presentation;
  intro: string | null;
  outro: string | null;
  steps: PublicRecipeStep[] | null;
  guide?: PublicRecipeGuideStep[] | null;
  files: PublicRecipeFile[] | null;
}
export interface PublicRecipeLabels { selfie: string; reference: string; step: string; pet?: string; partner?: string }

function inputsOf(recipe: Recipe, inputs: readonly string[]): RecipeInput[] {
  const creators = creatorSlotNames(recipe);
  return inputs.map((name): RecipeInput => {
    if (name === SELFIE_SLOT) return { kind: 'selfie' };
    const role = recipe.slots[name]?.role;
    if (role === 'pet' || role === 'partner') return { kind: role };
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
  const checked = parseRecipe(row.recipe, { studio: !row.maker });
  if (!checked.ok) return null;
  const disclosure = parseDisclosure(row.disclosure);
  if (!row.maker && !disclosure.prompts) return null;
  const recipe = checked.recipe;
  let files: PublicRecipe['files'] = null;
  if (row.maker && disclosure.assets) {
    const handles = Object.values(recipe.slots).flatMap((slot) => (slot.source === 'creator' ? [{ handle: slot.asset, kind: slot.kind }] : []));
    const personSet = new Set<string>();
    if (handles.length > 0) {
      const { rows: assetRows } = await sql.query<{ id: string; contains_person: boolean | null }>(
        'select id, contains_person from platform_format_assets where id = any($1::text[])',
        [handles.map((h) => h.handle)],
      );
      for (const a of assetRows) {
        if (a.contains_person === true) personSet.add(a.id);
      }
    }
    files = handles.map(({ handle, kind }, i) => {
      const isPerson = personSet.has(handle);
      return isPerson
        ? { n: i + 1, kind, href: `/api/makers/files/${handle}`, download: null, containsPerson: true }
        : { n: i + 1, kind, href: `/api/makers/files/${handle}`, download: `/api/makers/files/${handle}?download=1` };
    });
  }
  return {
    presentation: parsePresentation(row.presentation),
    intro: disclosure.prompts ? text(recipe.notes?.intro) : null,
    outro: disclosure.prompts ? text(recipe.notes?.outro) : null,
    steps: disclosure.prompts ? recipe.steps.map((step, index) => ({
      n: index + 1, kind: step.kind, engine: labelOf(step.engine), inputs: inputsOf(recipe, step.inputs),
      prompt: publicPromptText(displayStepPrompt(recipe, step, labels)), note: text(step.note),
    })) : null,
    ...(disclosure.prompts && recipe.guide?.length ? {
      guide: recipe.guide.map((item, index) => ({
        n: index + 1,
        title: item.title,
        kind: item.kind,
        meta: text(item.meta),
        prompt: publicPromptText(displayStepPrompt(recipe, item, labels)),
        note: text(item.note),
      })),
    } : {}),
    files,
  };
}

/** How much of step 1's prompt the static page shows (the members' gate, 2026-10-29). */
export const TEASER_CHARS = 150;

function teaserPrompt(prompt: string): string {
  const bgm = prompt.indexOf('[BGM');
  return `${prompt.slice(0, TEASER_CHARS).trim()}…${bgm >= 0 ? `\n\n${prompt.slice(bgm).trim()}` : ''}`;
}

/** The public layer of a full projection — built by naming every field, never by spreading. */
export function recipeTeaser(recipe: PublicRecipe): PublicRecipe | null {
  if (!recipe.steps && !recipe.files?.length) return null;
  const first = recipe.steps?.[0] ?? null;
  return {
    presentation: recipe.presentation,
    intro: recipe.intro,
    outro: null,
    steps: first ? [{
      n: first.n, kind: first.kind, engine: first.engine,
      inputs: first.inputs.map((input): RecipeInput => (input.kind === 'selfie' || input.kind === 'pet' || input.kind === 'partner' ? { kind: input.kind } : { kind: input.kind, n: input.n })),
      prompt: teaserPrompt(first.prompt), note: null,
    }] : null,
    files: null,
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
