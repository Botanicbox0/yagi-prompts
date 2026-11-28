import {
  EDIT_HEADROOM_MIN_CHARS,
  promptLengthRefusalDetail,
  templatePromptCharLimit,
  verifiedPromptCharLimit,
  type ClipHeadroom,
  type ClipLength,
} from '@/lib/engines/prompt-limits';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { toTemplateCast, type TemplateCast } from '@/lib/prompts/schemas';
import { buildRenderPrompt } from '@/lib/renders/prompt';
import { templateCompileSource, type CompileSourceInput } from '@/lib/template-director/compile-prompts';
import { deterministicDirectorPrompt } from '@/lib/template-director/flash-director';
import type { PersonalDirectorSpec, PersonalOwnStylePart } from '@/lib/template-director/schema';
import { isVideoEngine } from '@/lib/images/engines';
import { videoModelForEngine } from '@/lib/video/models';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters PER CLIP. A template over that is not acceptable from
 * now on (checked before it reaches buyers), and a buyer's paid edit must always fit (checked before payment).
 *
 * A clip is one prompt the personal compile reads (`templateCompileSource`): the main text of a plain template, or each
 * result step of a recipe. It is measured as the render pass hands it to the compile — a plain template's text through
 * `buildRenderPrompt` (with the one identity line it adds when the text does not name the photo), a recipe step as the
 * engine reads it (`engineStepPrompt`, with its person line) — the `Template locks:` and `Template styling:` blocks
 * included, against the verified limit of the model the clip renders on (only Seedance 2.5 has one). So a clip written
 * at exactly 15,000 cannot go out at 15,100. Image engines are held to their own cap by the recipe rules and the
 * image-set form, not here.
 */

export type { ClipLength, ClipHeadroom };
export { promptLengthRefusalDetail, readPromptLengthRefusal } from '@/lib/engines/prompt-limits';

export interface TemplateLengthInput extends CompileSourceInput {
  medium: string;
  engine: string | null;
  runtimeSeconds: number | null;
  cast?: TemplateCast | null;
}

/** One clip exactly as the render pass hands it to the personal compile (lib/renders/service.ts, lib/recipes/execute.ts). */
export interface CompileClip {
  clip: number;
  stepId: string | null;
  base: string;
  limit: number;
  /** The model the clip renders on. */
  engine: string;
  medium: 'image' | 'video';
  /** The cast the render passes to the compile (a recipe step passes none). */
  cast?: TemplateCast;
  hasPersonSlot: boolean;
}

/** The clips of a template with a verified limit, each as the compile receives it. */
export function templateCompileClips(input: TemplateLengthInput): CompileClip[] {
  const source = templateCompileSource(input);
  if (source.kind === 'text') {
    const limit = templatePromptCharLimit(input);
    if (limit === null || input.medium !== 'video') return [];
    // `renderNow`: the text through `buildRenderPrompt` (no cast: the solo identity line), then the compile with the
    // template's cast and the person's photo.
    const base = buildRenderPrompt({ promptText: input.promptText, medium: 'video', hasPhoto: true }).text;
    const knownEngine = input.engine && isVideoEngine(input.engine) ? input.engine : null;
    const engine = videoModelForEngine(knownEngine, input.runtimeSeconds ?? 0).model;
    return [{ clip: 1, stepId: null, base, limit, engine, medium: 'video', cast: toTemplateCast(input.cast ?? 'solo'), hasPersonSlot: true }];
  }
  return source.prompts.flatMap((prompt, index) => {
    const step = source.recipe.steps.find((s) => s.id === prompt.stepId);
    const limit = step ? verifiedPromptCharLimit(step.engine) : null;
    // `renderRecipe`: each result step as the engine reads it; the photo only when the step takes the selfie, no cast.
    return step && limit !== null
      ? [{ clip: index + 1, stepId: step.id, base: prompt.text, limit, engine: step.engine, medium: step.kind, hasPersonSlot: step.inputs.includes('selfie') }]
      : [];
  });
}

/** Every clip of a template that has a verified limit, with the length the compile receives. */
export function templateClipLengths(input: TemplateLengthInput): ClipLength[] {
  return templateCompileClips(input).map((c) => ({ clip: c.clip, stepId: c.stepId, chars: c.base.length, limit: c.limit }));
}

export const overLimitClips = (clips: readonly ClipLength[]): ClipLength[] => clips.filter((c) => c.chars > c.limit);

/** Each clip's room for a buyer's edits: its limit less the length the compile receives. */
export function templateEditHeadroom(input: TemplateLengthInput): ClipHeadroom[] {
  return templateCompileClips(input).map((c) => ({ clip: c.clip, stepId: c.stepId, compiledChars: c.base.length, headroom: c.limit - c.base.length }));
}

/** A template with less room than the smallest useful edit takes (`EDIT_HEADROOM_MIN_CHARS`): no change requests at all. */
export function templateEditsClosed(input: TemplateLengthInput): boolean {
  return templateEditHeadroom(input).some((clip) => clip.headroom < EDIT_HEADROOM_MIN_CHARS);
}

/** The reference photos an order attaches, as they change the compiled text. */
export interface EditRefs {
  hasOutfitRef?: boolean;
  hasPropRef?: boolean;
  hasSceneRef?: boolean;
}

export interface EditFit {
  fits: boolean;
  clips: Array<{ clip: number; stepId: string | null; chars: number; limit: number }>;
}

/**
 * The per-request check (founder 2026-11-25: an accepted order's edit always fits). For this template and this spec, the
 * length of the DETERMINISTIC compile of every clip — the text the fallback after a failed rewrite sends, the template's
 * lock and styling blocks and the render's person line included — against the clip's limit. Pure; no model call. The
 * same function builds that fallback (`deterministicDirectorPrompt`), so a spec that fits here fits at render time.
 */
export function editFit(input: TemplateLengthInput, spec: PersonalDirectorSpec | null, refs: EditRefs = {}, env: Record<string, string | undefined> = process.env): EditFit {
  const clips = templateCompileClips(input).map((c) => {
    const text = deterministicDirectorPrompt(
      { basePrompt: c.base, medium: c.medium, ...(c.cast ? { cast: c.cast } : {}), hasPersonSlot: c.hasPersonSlot, ...refs, directorSpec: spec, engine: c.engine },
      env,
    );
    return { clip: c.clip, stepId: c.stepId, chars: text.length, limit: c.limit };
  });
  return { fits: clips.every((c) => c.chars <= c.limit), clips };
}

/**
 * What the make card needs to know about the template's room (names and numbers only, never prompt text): the smallest
 * headroom of its clips and what switching each styled part to "내 사진 그대로" adds on its own (the largest over the
 * clips). Null without a clip on a verified limit.
 */
export function templateEditRoom(input: TemplateLengthInput): { headroom: number; own: Partial<Record<PersonalOwnStylePart, number>> } | null {
  const room = templateEditHeadroom(input);
  if (room.length === 0) return null;
  const headroom = Math.min(...room.map((r) => r.headroom));
  const own: Partial<Record<PersonalOwnStylePart, number>> = {};
  for (const part of ['hair', 'makeup'] as const) {
    const fit = editFit(input, { audioMode: 'ambient', own: [part] } as PersonalDirectorSpec, {}, {});
    const cost = Math.max(...fit.clips.map((c, i) => c.chars - room[i]!.compiledChars));
    if (cost > 0) own[part] = cost;
  }
  return { headroom, own };
}

/** The first clip over its limit, as a refusal detail; null when every clip fits. */
export function promptLengthRefusal(field: string, input: TemplateLengthInput): string | null {
  const over = templateCompileClips(input).find((c) => c.base.length > c.limit);
  return over
    ? promptLengthRefusalDetail(field, { clip: over.clip, stepId: over.stepId, chars: over.base.length, limit: over.limit }, over.engine)
    : null;
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
  for (const clip of templateCompileClips(after)) {
    if (clip.base.length <= clip.limit) continue;
    const was = old.find((c) => c.clip === clip.clip && c.stepId === clip.stepId);
    if (!(was && was.chars > was.limit && clip.base.length <= was.chars)) {
      return promptLengthRefusalDetail(field, { clip: clip.clip, stepId: clip.stepId, chars: clip.base.length, limit: clip.limit }, clip.engine);
    }
  }
  return null;
}

/** Only texts this long can be near a 15,000 limit once the render's line is added; shorter ones are not even read. */
const NEAR_LIMIT_CHARS = 14_000;

/**
 * The published catalogue templates with a clip over its limit, and that limit — for the admin list's marker. The
 * database reads lengths first and hands back only the near-limit texts and recipes, measured here the way the gate
 * measures them. A marker, not a gate.
 */
export async function loadOverLimitTemplates(sql: SqlRunner, recipeReady: boolean): Promise<Map<string, number>> {
  const { rows } = await sql.query<{ id: string; medium: string; engine: string | null; runtime_seconds: number | null; cast_kind: string | null; prompt_text: string | null; recipe: unknown }>(
    `select id, medium::text as medium, engine, runtime_seconds, coalesce(to_jsonb(p.*)->>'cast_kind', 'solo') as cast_kind,
            case when char_length(prompt_text) > $1 then prompt_text end as prompt_text,
            case when char_length((to_jsonb(p.*)->'recipe')::text) > $1 then to_jsonb(p.*)->'recipe' end as recipe
       from prompt_items p
      where audience = 'public' and status = 'published'
        and (char_length(prompt_text) > $1 or char_length((to_jsonb(p.*)->'recipe')::text) > $1)`,
    [NEAR_LIMIT_CHARS],
  );
  const over = new Map<string, number>();
  for (const row of rows) {
    const clip = overLimitClips(templateClipLengths({
      promptText: row.prompt_text ?? '', recipe: row.recipe, recipeReady: recipeReady && row.recipe !== null,
      medium: row.medium, engine: row.engine, runtimeSeconds: row.runtime_seconds, cast: toTemplateCast(row.cast_kind),
    }))[0];
    if (clip) over.set(row.id, clip.limit);
  }
  return over;
}
