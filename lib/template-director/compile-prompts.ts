import { SELFIE_SLOT, engineStepPrompt, outputSteps, parseRecipe, type Recipe } from '@/lib/recipes/schema';
import type { TemplateCast } from '@/lib/prompts/schemas';
import { TEMPLATE_LOCKS_HEADER_LINE, TEMPLATE_STYLING_HEADER_LINE, headerLineIndexes, readHeaderBlock } from './header-block';
import { parseTemplateLocks, publicLocks } from './locks';
import { checkStylingBlock, parseTemplateStyling, publicStyling, stylingBlockRefusalDetail, type PublicTemplateStyling } from './styling';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — WHICH prompt texts the personal compile reads for a template, and so which
 * `Template styling:` declaration a template's screens may show. The card must claim exactly what the compile honours.
 *
 * The rule, read from the render pass (lib/renders/service.ts, lib/recipes/execute.ts; not changed here):
 *
 *  - A template whose `recipe` column holds a recipe that `parseRecipe(raw, { studio: true })` accepts (and whose
 *    recipe tables exist, `recipeSchemaReady`) runs step by step (`renderRecipe` → `runRecipe`). The compiler is called
 *    once per OUTPUT step (`outputSteps`: the `from` step, or every carousel frame — a buyer's frame pick only drops
 *    frames), with that step's prompt as the engine reads it (`engineStepPrompt`) and
 *    `hasPersonSlot = step.inputs.includes('selfie')`. Non-output steps are never compiled (customer photos attach to
 *    output steps only). The main `prompt_text` is not read at all; for an image set it is only a copy of the first
 *    frame (`legacyPromptText`), and `prompt.update` edits it alone.
 *  - Every other template (no recipe, a recipe that no longer parses, or no recipe tables) renders its main
 *    `prompt_text` (`renderNow`) with the person's photo.
 *  - `own` is honoured per compiled prompt (`ownChoiceFor`): only where THAT prompt's block styles the part, never for
 *    a part its lock block names, never for a pet and never for a prompt compiled without the person's photo.
 *
 * So a card carries a styling projection only when every prompt the compile reads gives the same one: the main text of
 * a text template; for a recipe template, every output step takes the person's photo and carries a block with the same
 * public projection. One step without a block, with a different one, or without the photo = the card claims nothing
 * (a buyer must never be offered a choice that only some frames honour). A pet template claims nothing.
 *
 * `prompt.declareStyling` (lib/admin/prompt-operations.ts) writes one block into every one of these texts (and the main
 * text) at once, so a template declared through it always shows what it declares.
 */

/**
 * One prompt the compile reads: the recipe step it belongs to (null for the main text), the step's kind (null = the
 * template's medium) and whether it is compiled with the person's photo.
 */
export interface CompilePrompt {
  stepId: string | null;
  kind: 'image' | 'video' | null;
  text: string;
  person: boolean;
}

export type CompileSource =
  | { kind: 'text'; prompts: CompilePrompt[] }
  | { kind: 'recipe'; recipe: Recipe; prompts: CompilePrompt[] };

export interface CompileSourceInput {
  promptText: string;
  /** The row's raw `recipe` column (`to_jsonb(p.*)->'recipe'`); null/undefined = none. */
  recipe?: unknown;
  /** `recipeSchemaReady(sql)`: without the recipe tables the render pass never takes the recipe path. */
  recipeReady?: boolean;
}

/** The prompts the personal compile reads for a template (see the rule above). */
export function templateCompileSource(input: CompileSourceInput): CompileSource {
  const text: CompileSource = { kind: 'text', prompts: [{ stepId: null, kind: null, text: input.promptText, person: true }] };
  if (input.recipe === null || input.recipe === undefined || input.recipeReady === false) return text;
  const checked = parseRecipe(input.recipe, { studio: true });
  if (!checked.ok) return text;
  const recipe = checked.recipe;
  const prompts = outputSteps(recipe).flatMap((id) => {
    const step = recipe.steps.find((s) => s.id === id);
    return step ? [{ stepId: step.id, kind: step.kind, text: engineStepPrompt(recipe, step), person: step.inputs.includes(SELFIE_SLOT) }] : [];
  });
  return { kind: 'recipe', recipe, prompts };
}

/** One prompt's public styling (its own locks win); null without a valid block or with nothing left after the locks. */
export function promptStyling(text: string): PublicTemplateStyling | null {
  const styling = publicStyling(parseTemplateStyling(text), parseTemplateLocks(text));
  return styling && (styling.styled.length > 0 || styling.photo.length > 0) ? styling : null;
}

const sameParts = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((part, i) => part === [...b].sort()[i]);

export function sameStyling(a: PublicTemplateStyling, b: PublicTemplateStyling): boolean {
  return sameParts(a.styled, b.styled) && sameParts(a.photo, b.photo);
}

/** The styling a template's card shows: what every compiled prompt honours alike, or null. */
export function templateCardStyling(input: CompileSourceInput & { cast?: TemplateCast | null }): PublicTemplateStyling | null {
  if (input.cast === 'pet') return null;
  const { prompts } = templateCompileSource(input);
  if (prompts.length === 0 || prompts.some((p) => !p.person)) return null;
  const each = prompts.map((p) => promptStyling(p.text));
  const first = each[0] ?? null;
  if (first === null || each.some((s) => s === null || !sameStyling(s, first))) return null;
  return { styled: [...first.styled], photo: [...first.photo] };
}

// --- Writing a block ------------------------------------------------------------------------------------------------

/** [start, end) of each `Template styling:` block in `lines` (a header inside an earlier block belongs to that block). */
function stylingRanges(lines: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const at of headerLineIndexes(lines, TEMPLATE_STYLING_HEADER_LINE)) {
    const last = ranges[ranges.length - 1];
    if (last && at < last[1]) continue;
    ranges.push([at, readHeaderBlock(lines, at, TEMPLATE_LOCKS_HEADER_LINE).end]);
  }
  return ranges;
}

/**
 * The text with its `Template styling:` block replaced by `block` (in place of the first one; any other one goes), or
 * — without one — `block` appended as its own paragraph at the end. An empty `block` removes every styling block and
 * closes the gap. Every other line stays exactly as written; with nothing to do, the same string.
 */
export function withStylingBlock(text: string, block: string): string {
  const next = block.trim();
  const lines = text.split('\n');
  const ranges = stylingRanges(lines);
  if (ranges.length === 0) {
    if (!next) return text;
    const body = text.replace(/\s+$/u, '');
    return body ? `${body}\n\n${next}` : next;
  }
  const out: string[] = [];
  let i = 0;
  ranges.forEach(([start, end], k) => {
    out.push(...lines.slice(i, start));
    if (k === 0 && next) out.push(...next.split('\n'));
    else {
      // Removed: one blank line stays between the paragraphs around it, none at the end.
      while (out.length > 0 && out[out.length - 1]!.trim() === '' && (end >= lines.length || lines[end]!.trim() === '')) out.pop();
    }
    i = end;
  });
  out.push(...lines.slice(i));
  return out.join('\n');
}

// --- One declaration, everywhere the compile reads (`prompt.declareStyling`) ------------------------------------------

export type StylingDeclaration =
  | {
      ok: true;
      /** The main text with the block written (or removed). */
      promptText: string;
      /** The raw recipe with every result step's prompt written; the input value itself when nothing changed. */
      recipe: unknown;
      recipeChanged: boolean;
      /** How many texts carry the block now (the main text and the result steps). */
      texts: number;
      /** What the template's card shows afterwards. */
      styling: PublicTemplateStyling | null;
    }
  | { ok: false; detail: string };

const refuse = (detail: string): StylingDeclaration => ({ ok: false, detail: detail.slice(0, 300) });
const sameLocks = (a: string, b: string): boolean =>
  JSON.stringify(publicLocks(parseTemplateLocks(a))) === JSON.stringify(publicLocks(parseTemplateLocks(b)));

/**
 * Plans one `Template styling:` declaration for a template: the block written into its main text AND into every
 * prompt the compile reads (a recipe's result steps), replacing a block that is there or appended as its own
 * paragraph; an empty block removes it everywhere. Nothing is written unless every text checks: the input is one
 * valid block and nothing else; every text afterwards carries it validly (`checkStylingBlock`: no part its own lock
 * block names) or — removing — carries none; its lock block reads exactly as before; a changed recipe still passes the
 * recipe rules; and a declaration leaves the card showing styling (a result step without the person's photo, or a pet
 * template, would leave the buyer with nothing to choose).
 */
export function planStylingDeclaration(input: CompileSourceInput & { cast?: TemplateCast | null }, rawBlock: string): StylingDeclaration {
  const block = rawBlock.replace(/\r\n?/g, '\n').trim();
  if (block) {
    const check = checkStylingBlock(block);
    if (check.state === 'malformed') return refuse(stylingBlockRefusalDetail('block', check.problems));
    if (check.state !== 'ok' || parseTemplateStyling(block).block.trim() !== block) {
      return refuse('block: one `Template styling:` block and nothing else');
    }
  }

  const texts: Array<{ label: string; before: string; after: string }> = [];
  const promptText = withStylingBlock(input.promptText, block);
  texts.push({ label: 'promptText', before: input.promptText, after: promptText });

  let recipe: unknown = input.recipe ?? null;
  let recipeChanged = false;
  const checked = input.recipe === null || input.recipe === undefined ? null : parseRecipe(input.recipe, { studio: true });
  if (checked?.ok) {
    const raw = structuredClone(input.recipe) as { steps?: Array<{ id?: unknown; prompt?: unknown }> };
    for (const id of outputSteps(checked.recipe)) {
      const step = raw.steps?.find((s) => s.id === id);
      if (!step || typeof step.prompt !== 'string') return refuse(`recipe: result step ${id} has no prompt to write`);
      const after = withStylingBlock(step.prompt, block);
      texts.push({ label: `step ${id}`, before: step.prompt, after });
      if (after !== step.prompt) {
        step.prompt = after;
        recipeChanged = true;
      }
    }
    if (recipeChanged) {
      if (!parseRecipe(raw, { studio: true }).ok) return refuse('recipe: with the block the steps would no longer pass the recipe rules (too long?)');
      recipe = raw;
    }
  }

  for (const text of texts) {
    const after = checkStylingBlock(text.after);
    if (after.state === 'malformed') return refuse(stylingBlockRefusalDetail(text.label, after.problems));
    if (block ? after.state !== 'ok' : after.state !== 'none') return refuse(`${text.label}: the styling block would not read back`);
    if (!sameLocks(text.before, text.after)) return refuse(`${text.label}: the lock block would read differently`);
  }

  const styling = templateCardStyling({ promptText, recipe, recipeReady: input.recipeReady, cast: input.cast });
  if (block && styling === null) {
    return refuse("block: buyers would still see no styling (a result step without the person's photo, every part locked, or a pet template)");
  }
  return { ok: true, promptText, recipe, recipeChanged, texts: texts.length, styling };
}
