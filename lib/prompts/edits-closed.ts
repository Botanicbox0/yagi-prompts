import type { SqlRunner } from '@/lib/db/sql-runner';
import { toTemplateCast } from '@/lib/prompts/schemas';
import type { PromptRow } from '@/lib/prompts/repo';
import { templateEditsClosed } from '@/lib/prompts/prompt-length';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { CUSTOM_DIRECTOR_REF_SLOTS, type PersonalDirectorSpec } from '@/lib/template-director/schema';

/**
 * Founder 2026-11-25: a buyer who paid for an edit must get it. A template whose text leaves too little room for the
 * fullest edit (lib/prompts/prompt-length.ts `templateEditsClosed`) takes no change requests: its page hides the
 * director, and the order and director routes refuse a request that carries one (`edits_closed`) before any order
 * exists, so a crafted request cannot pay for an edit the compile would have to drop.
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

/** Whether an order form carries a reference photo for an edit (`slot_look_ref`, `slot_prop_ref`, `slot_scene_ref`). */
export function formCarriesEditPhotos(form: FormData): boolean {
  return CUSTOM_DIRECTOR_REF_SLOTS.some((slot) => {
    const file = form.get(`slot_${slot}`);
    return typeof file === 'object' && file !== null && 'size' in file && (file as { size: number }).size > 0;
  });
}

/** Whether the published template with this slug takes no change requests. Unknown slug: false (the order refuses it itself). */
export async function loadTemplateEditsClosed(sql: SqlRunner, slug: string): Promise<boolean> {
  if (!slug) return false;
  const { rows } = await sql.query<{ prompt_text: string; medium: string; engine: string | null; runtime_seconds: number | null; cast_kind: string | null; recipe: unknown }>(
    `select prompt_text, medium::text as medium, engine, runtime_seconds,
            coalesce(to_jsonb(p.*)->>'cast_kind', 'solo') as cast_kind, to_jsonb(p.*)->'recipe' as recipe
       from prompt_items p where slug = $1 and status = 'published' limit 1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return false;
  return templateEditsClosed({
    promptText: row.prompt_text,
    recipe: row.recipe,
    recipeReady: await recipeSchemaReady(sql),
    medium: row.medium,
    engine: row.engine,
    runtimeSeconds: row.runtime_seconds,
    cast: toTemplateCast(row.cast_kind),
  });
}

/**
 * The same for a template row already loaded (the director route): its recipe is read on the side, and a recipe that
 * cannot be read leaves the main text to judge, as the render pass does without one.
 */
export async function promptRowEditsClosed(sql: SqlRunner, row: PromptRow): Promise<boolean> {
  if (typeof row.promptText !== 'string' || row.medium !== 'video') return false;
  let recipe: unknown = null;
  let recipeReady = false;
  try {
    const read = await sql.query<{ recipe: unknown }>("select to_jsonb(p.*)->'recipe' as recipe from prompt_items p where id = $1", [row.id]);
    recipe = read?.rows?.[0]?.recipe ?? null;
    recipeReady = recipe !== null && (await recipeSchemaReady(sql));
  } catch {
    recipe = null;
  }
  return templateEditsClosed({ promptText: row.promptText, recipe, recipeReady, medium: row.medium, engine: row.engine, runtimeSeconds: row.runtimeSeconds, cast: row.cast });
}

/** The order routes' check: a request with an edit, for a template that takes none. */
export async function ordersEditOnClosedTemplate(sql: SqlRunner, form: FormData, spec: PersonalDirectorSpec | null): Promise<boolean> {
  if (!directorSpecAsksEdits(spec) && !formCarriesEditPhotos(form)) return false;
  return loadTemplateEditsClosed(sql, String(form.get('template') ?? ''));
}
