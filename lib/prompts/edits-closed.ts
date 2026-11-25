import type { SqlRunner } from '@/lib/db/sql-runner';
import { toTemplateCast } from '@/lib/prompts/schemas';
import type { PromptRow } from '@/lib/prompts/repo';
import { editFit, templateEditsClosed, type EditRefs, type TemplateLengthInput } from '@/lib/prompts/prompt-length';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { CUSTOM_DIRECTOR_REF_SLOTS, type PersonalDirectorSpec } from '@/lib/template-director/schema';

/**
 * Founder 2026-11-25: a buyer who pays for an edit must get it. Two checks before any order, job, payment or file:
 *   `edits_closed`  — the template leaves less room than the smallest useful edit (`templateEditsClosed`): it takes no
 *                     change requests, and its page shows one line instead of the edit panel;
 *   `edit_too_long` — this buyer's edit, compiled the way the fallback compiles it, would not fit the clip
 *                     (`editFit`). The edit panel and the make card check the same thing first.
 */

/** Whether a director spec asks for anything the compile would add: a sheet line, a note, chips, an intent, BGM, an own part. */
export function directorSpecAsksEdits(spec: PersonalDirectorSpec | null | undefined): boolean {
  if (!spec) return false;
  const sheet = spec.sheet;
  const intent = spec.structuredIntent;
  return Boolean(
    (sheet && (sheet.change.length > 0 || sheet.keep.length > 0 || sheet.exclude.length > 0)) ||
      spec.userMessage?.trim() ||
      spec.summaryChips?.length ||
      (intent && (intent.hairOverrideEn || intent.makeupOverrideEn || intent.outfitOverrideEn || intent.propOverrideEn || intent.shotEdits.length > 0 || intent.strictExclusionsEn.length > 0)) ||
      spec.audioMode === 'bgm' ||
      spec.own?.length ||
      spec.slotOverrides?.length,
  );
}

/** The reference photos an order form attaches (`slot_look_ref`, `slot_prop_ref`, `slot_scene_ref`), as the compile reads them. */
export function formEditRefs(form: FormData): EditRefs {
  const has = (slot: (typeof CUSTOM_DIRECTOR_REF_SLOTS)[number]): boolean => {
    const file = form.get(`slot_${slot}`);
    return typeof file === 'object' && file !== null && 'size' in file && (file as { size: number }).size > 0;
  };
  return { hasOutfitRef: has('look_ref'), hasPropRef: has('prop_ref'), hasSceneRef: has('scene_ref') };
}

const anyRef = (refs: EditRefs): boolean => Boolean(refs.hasOutfitRef || refs.hasPropRef || refs.hasSceneRef);

/** The published template with this slug, as the length checks read it; null when there is none. */
export async function loadTemplateLengthInput(sql: SqlRunner, slug: string): Promise<TemplateLengthInput | null> {
  if (!slug) return null;
  const { rows } = await sql.query<{ prompt_text: string; medium: string; engine: string | null; runtime_seconds: number | null; cast_kind: string | null; recipe: unknown }>(
    `select prompt_text, medium::text as medium, engine, runtime_seconds,
            coalesce(to_jsonb(p.*)->>'cast_kind', 'solo') as cast_kind, to_jsonb(p.*)->'recipe' as recipe
       from prompt_items p where slug = $1 and status = 'published' limit 1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    promptText: row.prompt_text, recipe: row.recipe, recipeReady: await recipeSchemaReady(sql),
    medium: row.medium, engine: row.engine, runtimeSeconds: row.runtime_seconds, cast: toTemplateCast(row.cast_kind),
  };
}

/**
 * The same for a template row already loaded (the director route): its recipe is read on the side, and a recipe that
 * cannot be read leaves the main text to judge, as the render pass does without one.
 */
export async function promptRowLengthInput(sql: SqlRunner, row: PromptRow): Promise<TemplateLengthInput | null> {
  if (typeof row.promptText !== 'string' || row.medium !== 'video') return null;
  let recipe: unknown = null;
  let recipeReady = false;
  try {
    const read = await sql.query<{ recipe: unknown }>("select to_jsonb(p.*)->'recipe' as recipe from prompt_items p where id = $1", [row.id]);
    recipe = read?.rows?.[0]?.recipe ?? null;
    recipeReady = recipe !== null && (await recipeSchemaReady(sql));
  } catch {
    recipe = null;
  }
  return { promptText: row.promptText, recipe, recipeReady, medium: row.medium, engine: row.engine, runtimeSeconds: row.runtimeSeconds, cast: row.cast };
}

/** Whether the published template with this slug takes no change requests. Unknown slug: false (the order refuses it itself). */
export async function loadTemplateEditsClosed(sql: SqlRunner, slug: string): Promise<boolean> {
  const input = await loadTemplateLengthInput(sql, slug);
  return input !== null && templateEditsClosed(input);
}

export type OrderEditRefusal = 'edits_closed' | 'edit_too_long';

/** The order and render routes' check, before anything exists: a request with an edit that the template cannot take. */
export async function orderEditRefusal(
  sql: SqlRunner,
  form: FormData,
  spec: PersonalDirectorSpec | null,
  env: Record<string, string | undefined> = process.env,
): Promise<OrderEditRefusal | null> {
  return specEditRefusal(sql, String(form.get('template') ?? ''), spec, formEditRefs(form), env);
}

/** The same check for a template slug, a spec and the photos it carries (the order retry reads them from the old order). */
export async function specEditRefusal(
  sql: SqlRunner,
  slug: string,
  spec: PersonalDirectorSpec | null,
  refs: EditRefs = {},
  env: Record<string, string | undefined> = process.env,
): Promise<OrderEditRefusal | null> {
  if (!directorSpecAsksEdits(spec) && !anyRef(refs)) return null;
  const input = await loadTemplateLengthInput(sql, slug);
  if (input === null) return null;
  if (templateEditsClosed(input)) return 'edits_closed';
  return editFit(input, spec, refs, env).fits ? null : 'edit_too_long';
}

/** HTTP status for an order refusal: both are the request's own problem, answered before anything exists. */
export const ORDER_EDIT_REFUSAL_STATUS: Record<OrderEditRefusal, number> = { edits_closed: 409, edit_too_long: 422 };
