import { promptLengthRefusalDetail, templatePromptCharLimit, verifiedPromptCharLimit, type ClipLength } from '@/lib/engines/prompt-limits';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { templateCompileSource, type CompileSourceInput } from '@/lib/template-director/compile-prompts';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters PER CLIP, and a template over that is not acceptable
 * from now on ("그 15000자 원칙 잘 지켜졌나 여부" — checked before a template reaches buyers). This file is that check.
 *
 * A clip is one prompt the personal compile reads (`templateCompileSource`): the main text of a plain template, or each
 * result step of a recipe template. Counted as written — the text the author saved, its `Template locks:` and
 * `Template styling:` blocks included — and held to the verified limit of the model the clip renders on (only
 * Seedance 2.5 has one; lib/engines/prompt-limits.ts). The render adds its own one-line identity note to that text;
 * that line is not the author's and is not counted. Image engines are held to their own cap by the recipe rules and
 * the image-set form, not here.
 */

export type { ClipLength };
export { promptLengthRefusalDetail, readPromptLengthRefusal } from '@/lib/engines/prompt-limits';

export interface TemplateLengthInput extends CompileSourceInput {
  medium: string;
  engine: string | null;
  runtimeSeconds: number | null;
}

/** Every clip of a template that has a verified limit, with its length. */
export function templateClipLengths(input: TemplateLengthInput): ClipLength[] {
  const source = templateCompileSource(input);
  if (source.kind === 'text') {
    const limit = templatePromptCharLimit(input);
    return limit === null ? [] : [{ clip: 1, stepId: null, chars: input.promptText.trim().length, limit }];
  }
  return source.prompts.flatMap((prompt, index) => {
    const step = source.recipe.steps.find((s) => s.id === prompt.stepId);
    const limit = step ? verifiedPromptCharLimit(step.engine) : null;
    return step && limit !== null ? [{ clip: index + 1, stepId: step.id, chars: step.prompt.length, limit }] : [];
  });
}

export const overLimitClips = (clips: readonly ClipLength[]): ClipLength[] => clips.filter((c) => c.chars > c.limit);

/** The first clip over its limit, as a refusal detail; null when every clip fits. */
export function promptLengthRefusal(field: string, input: TemplateLengthInput): string | null {
  const over = overLimitClips(templateClipLengths(input))[0];
  return over ? promptLengthRefusalDetail(field, over) : null;
}

/**
 * A save of a template's text (`prompt.update`) is refused when a clip ends up over its limit — unless that clip was
 * already over and the save does not make it longer, so an older template can be shortened step by step (founder,
 * 2026-11-25: nothing over the limit is cut or unpublished automatically). A save that does not change the text is
 * never refused here.
 */
export function promptLengthUpdateRefusal(field: string, before: TemplateLengthInput, after: TemplateLengthInput): string | null {
  if (before.promptText === after.promptText) return null;
  const old = templateClipLengths(before);
  for (const clip of overLimitClips(templateClipLengths(after))) {
    const was = old.find((c) => c.clip === clip.clip && c.stepId === clip.stepId);
    if (!(was && was.chars > was.limit && clip.chars <= was.chars)) return promptLengthRefusalDetail(field, clip);
  }
  return null;
}

/**
 * The published catalogue templates with a clip over its limit, and that limit — for the admin list's marker. Reads
 * lengths in the database (no prompt bodies): the main text, and the result steps of a template with a recipe. The
 * recipe is not re-validated here (the template page's own check does that); a marker, not a gate.
 */
export async function loadOverLimitTemplates(sql: SqlRunner, recipeReady: boolean): Promise<Map<string, number>> {
  const { rows } = await sql.query<{
    id: string; medium: string; engine: string | null; runtime_seconds: number | null; chars: number;
    output: { from?: unknown; frames?: unknown } | null; steps: Array<{ id: string; engine: string | null; chars: number }>;
  }>(
    `select id, medium::text as medium, engine, runtime_seconds, char_length(btrim(prompt_text))::int as chars,
            to_jsonb(p.*)->'recipe'->'output' as output,
            (select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'engine', s->>'engine', 'chars', char_length(btrim(s->>'prompt')))), '[]'::jsonb)
               from jsonb_array_elements(case when jsonb_typeof(to_jsonb(p.*)->'recipe'->'steps') = 'array' then to_jsonb(p.*)->'recipe'->'steps' else '[]'::jsonb end) s) as steps
       from prompt_items p
      where audience = 'public' and status = 'published'`,
  );
  const over = new Map<string, number>();
  for (const row of rows) {
    const output = recipeReady ? row.output : null;
    const ids = output === null ? null : typeof output.from === 'string' ? [output.from] : Array.isArray(output.frames) ? output.frames : null;
    if (ids === null) {
      const limit = templatePromptCharLimit({ medium: row.medium, engine: row.engine, runtimeSeconds: row.runtime_seconds });
      if (limit !== null && row.chars > limit) over.set(row.id, limit);
      continue;
    }
    for (const step of row.steps.filter((s) => ids.includes(s.id))) {
      const limit = verifiedPromptCharLimit(step.engine);
      if (limit !== null && step.chars > limit) over.set(row.id, limit);
    }
  }
  return over;
}
