import { z } from 'zod';
import { IMAGE_ASPECTS, IMAGE_ENGINES, VIDEO_ASPECTS, engineProvider, isEngineId, isImageEngine, isVideoEngine, normalizeLegacyEngineId, type EngineId } from '@/lib/images/engines';
import { videoEngineSpec } from '@/lib/video/models';

/**
 * Recipe v2 — a maker template as steps and slots (docs/PLATFORM-2.0.md §7.3).
 *
 *   slots   `selfie` is the ONE thing a customer gives (always `source: 'user'`); every other slot
 *           is a maker file (`source: 'creator'`, an `ast_…` handle into platform_format_assets).
 *   steps   at most two — an image then a film — or one to ten images (a carousel). Each step names
 *           an engine from the registry, the slots or EARLIER steps it reads (`inputs`), a prompt
 *           that refers to them only as `{{name}}`, and the engine's own parameters.
 *   output  `{ from }` one result, or `{ frames }` a carousel.
 *
 * `parseRecipe` is the only door: JSON from the editor, an import, the database and the pass all go
 * through it, so a recipe that reached a render has passed every rule below. Pure.
 */

export const RECIPE_VERSION = 2;
/** Ten since 2026-11-02 (founder): render_job_outputs must accept it first (0072). */
export const MAX_RECIPE_STEPS = 10;
export const MAX_STEP_INPUTS = 6;
/** 4,000 bytes a frame, the room six frames had in 24,000. */
export const MAX_RECIPE_BYTES = 40_000;
/**
 * One step's prompt. 8,000 characters since 2026-10-29: a creative's published Seedance 2.5 film
 * prompt runs ~7,900 (timed shots, look, audio, exclusions), and the recipe page promises the exact
 * prompt behind the post — a shortened copy would not be that.
 */
export const MAX_STEP_PROMPT_CHARS = 8000;
/**
 * The studio's own recipes (the image-set form, the import script): room for every step at its
 * prompt limit in Korean, 3 bytes a character, plus the recipe's structure. Slack 1793592561.362499:
 * a set whose frames were each within their limit was refused whole at the maker's 40,000.
 */
export const MAX_STUDIO_RECIPE_BYTES = 256_000;
export const SELFIE_SLOT = 'selfie';

const NAME = /^[a-z][a-z0-9_]{0,23}$/;
export const ASSET_HANDLE = /^ast_[0-9a-f]{32}$/;
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * The engines a maker may pick. Every one has a known real-person path (`needsIdentity`: OpenAI and
 * Seedream take the photo's bytes, Seedance takes only a verified-library asset). GPT Image 2.5 Flare joined on
 * 2026-10-24 after its real-selfie smoke (founder decision); Sunburst stays out until it is measured
 * the same way (lib/images/engines.ts `IMAGE_ENGINES`). R2's Kling
 * (`kling-omni`) and Nano Banana (`nano-banana-2.1`) are wired (adapters, matrix, prices) but join
 * this list only once `npm run kling:smoke` / `npm run gemini:smoke` has shown what each does with
 * a real selfie — a founder decision after the smoke, not a code default (PLATFORM-2.0 §7.3).
 */
export const MAKER_ENGINE_IDS = ['gpt-image-2.5-flare', 'gpt-image-2', 'seedream-5.5', 'seedream-5.0-lite', 'seedance-2.0', 'seedance-2.5'] as const satisfies readonly EngineId[];
export type MakerEngineId = (typeof MAKER_ENGINE_IDS)[number];
export function isMakerEngine(value: unknown): value is MakerEngineId {
  return typeof value === 'string' && (MAKER_ENGINE_IDS as readonly string[]).includes(value);
}
/**
 * Engines only the studio's own recipes may name (founder, 2026-11-01: the image-set form needs Nano
 * Banana Pro). A maker's save and publish still parse strictly; `parseRecipe(raw, { studio: true })`
 * is for the paths that read a recipe the admin wrote.
 */
export const STUDIO_RECIPE_ENGINE_IDS = ['nano-banana-pro'] as const satisfies readonly EngineId[];
export function isStudioRecipeEngine(value: unknown): value is (typeof STUDIO_RECIPE_ENGINE_IDS)[number] {
  return typeof value === 'string' && (STUDIO_RECIPE_ENGINE_IDS as readonly string[]).includes(value);
}
export function makerEnginesFor(kind: 'image' | 'video'): MakerEngineId[] {
  return MAKER_ENGINE_IDS.filter((id) => (kind === 'image' ? isImageEngine(id) : isVideoEngine(id)));
}
/**
 * How a person reaches this engine: raw bytes (OpenAI, Gemini, Kling, Seedream) or a verified asset
 * (Seedance, ModelArk's films). The same rule as lib/identity/service.ts `needsIdentity` (pinned by a
 * test), kept here because the editor imports this file into the browser and the identity service is
 * server-only.
 */
export function identityPath(engine: EngineId): 'bytes' | 'asset' {
  return engineProvider(engine) === 'modelark' && isVideoEngine(engine) ? 'asset' : 'bytes';
}
/** The most image references one request may carry on this engine (the recipe caps at six anyway). */
export function maxImageInputs(engine: EngineId): number {
  if (isImageEngine(engine)) return Math.min(MAX_STEP_INPUTS, IMAGE_ENGINES[engine].maxReferenceImages);
  return Math.min(MAX_STEP_INPUTS, videoEngineSpec(engine).maxReferenceImages);
}

/**
 * `pet` and `partner` (docs/CAST-CATEGORIES.md §3): the two buyer photos beside the selfie. A pet is
 * not a person — no face check, no identity group, only the provider's moderation. A partner IS a
 * person, but never the account's own face, so it never goes to the verified library.
 */
export const RECIPE_SLOT_ROLES = ['person', 'product', 'scene', 'look', 'mask', 'pet', 'partner'] as const;
export type RecipeSlotRole = (typeof RECIPE_SLOT_ROLES)[number];
/** The fixed slot names of the two cast photos — one pet, one partner, each named after its role. */
export const PET_SLOT = 'pet';
export const PARTNER_SLOT = 'partner';

const Name = z.string().regex(NAME);
const SlotRole = z.enum(RECIPE_SLOT_ROLES).optional();
const UserSlot = z.object({ kind: z.literal('image'), source: z.literal('user'), required: z.boolean(), role: SlotRole }).strict();
const CreatorSlot = z.object({ kind: z.enum(['image', 'video', 'audio']), source: z.literal('creator'), asset: z.string().regex(ASSET_HANDLE), role: SlotRole }).strict();
const Slot = z.discriminatedUnion('source', [UserSlot, CreatorSlot]);
const Prompt = z.string().trim().min(10).max(MAX_STEP_PROMPT_CHARS);
/**
 * docs/PLATFORM-2.0.md §20.3 — what the creative says around the prompts, the way a tutorial post
 * does (an intro, a tip under a step, "post yours and tag me"). Display only: no engine ever reads
 * it, and it is shown exactly where the prompts are (members only, and only when disclosed).
 */
export const NOTE_MAX = 800;
export const INTRO_MAX = 1200;
export const OUTRO_MAX = 600;
const Note = z.string().trim().max(NOTE_MAX).optional();
const Notes = z.object({ intro: z.string().trim().max(INTRO_MAX).optional(), outro: z.string().trim().max(OUTRO_MAX).optional() }).strict();
const ImageStep = z.object({
  id: Name, kind: z.literal('image'),
  engine: z.preprocess((v) => (typeof v === 'string' ? normalizeLegacyEngineId(v) : v), z.string().max(40)),
  inputs: z.array(Name).min(1).max(MAX_STEP_INPUTS), prompt: Prompt, note: Note,
  params: z.object({ aspect: z.enum(IMAGE_ASPECTS) }).strict(),
}).strict();
const VideoStep = z.object({
  id: Name, kind: z.literal('video'), engine: z.string().max(40), inputs: z.array(Name).min(1).max(MAX_STEP_INPUTS), prompt: Prompt, note: Note,
  params: z.object({ aspect: z.enum(VIDEO_ASPECTS), duration: z.number().int(), resolution: z.enum(['720p', '1080p']) }).strict(),
}).strict();
const Step = z.discriminatedUnion('kind', [ImageStep, VideoStep]);
const Output = z.union([z.object({ from: Name }).strict(), z.object({ frames: z.array(Name).min(1).max(MAX_RECIPE_STEPS) }).strict()]);
const RecipeShape = z.object({
  version: z.literal(RECIPE_VERSION),
  slots: z.record(Name, Slot),
  steps: z.array(Step).min(1).max(MAX_RECIPE_STEPS),
  output: Output,
  notes: Notes.optional(),
}).strict();

export type RecipeSlot = z.infer<typeof Slot>;
export type RecipeStep = z.infer<typeof Step>;
export type ImageRecipeStep = z.infer<typeof ImageStep>;
export type VideoRecipeStep = z.infer<typeof VideoStep>;
export type Recipe = z.infer<typeof RecipeShape>;
export type RecipeMedium = 'image' | 'video' | 'carousel';

export type RecipeIssueCode =
  | 'too_large' | 'shape'
  | 'selfie_missing' | 'user_slot' | 'name_clash' | 'duplicate_step' | 'unused_slot'
  | 'engine' | 'engine_kind' | 'unknown_input' | 'forward_input' | 'video_input' | 'too_many_inputs'
  | 'bad_token' | 'unknown_token' | 'unused_input' | 'raw_handle'
  | 'step_layout' | 'output' | 'no_identity' | 'duration' | 'resolution' | 'aspect'
  // docs/CAST-CATEGORIES.md §3 — the pet and partner slots.
  | 'cast_slot' | 'cast_mix' | 'no_pet' | 'no_partner' | 'partner_asset';
export interface RecipeIssue { code: RecipeIssueCode; step?: string; slot?: string }
export type RecipeCheck = { ok: true; recipe: Recipe; medium: RecipeMedium } | { ok: false; issues: RecipeIssue[] };

/** `{{name}}` occurrences in a prompt, in order; null when a brace pair is not a valid name. */
export function promptTokens(prompt: string): string[] | null {
  const names: string[] = [];
  for (const match of prompt.matchAll(TOKEN)) {
    if (!NAME.test(match[1]!)) return null;
    names.push(match[1]!);
  }
  // A lone `{{` or `}}` left after removing the valid pairs is a typo, not text.
  if (/\{\{|\}\}/.test(prompt.replace(TOKEN, ''))) return null;
  return names;
}

export function outputSteps(recipe: Recipe): string[] {
  return 'from' in recipe.output ? [recipe.output.from] : recipe.output.frames;
}

export function recipeMedium(recipe: Recipe): RecipeMedium {
  if ('frames' in recipe.output) return 'carousel';
  return recipe.steps.find((step) => step.id === (recipe.output as { from: string }).from)?.kind === 'video' ? 'video' : 'image';
}

/** The step whose result is the template's result (a carousel's first frame). */
export function primaryStep(recipe: Recipe): RecipeStep {
  return recipe.steps.find((step) => step.id === outputSteps(recipe)[0])!;
}

/** Semantic role of a recipe slot (consumer `selfie` is always `'person'`). */
export function slotRole(name: string, slot: RecipeSlot): RecipeSlotRole {
  if (name === SELFIE_SLOT) return 'person';
  return slot.role ?? 'scene';
}

/** Slot names that carry a real person's face (`selfie`, any `role: 'person'` slot, and the partner). A pet is never one. */
export function personSlots(recipe: Pick<Recipe, 'slots'>): Set<string> {
  const person = new Set<string>();
  for (const [name, slot] of Object.entries(recipe.slots)) {
    if (name === SELFIE_SLOT || slot.role === 'person' || slot.role === 'partner') person.add(name);
  }
  return person;
}

/** The slot names with this role. */
function slotsWithRole(recipe: Pick<Recipe, 'slots'>, role: RecipeSlotRole): Set<string> {
  return new Set(Object.entries(recipe.slots).filter(([, slot]) => slot.role === role).map(([name]) => name));
}

/** `seeds` plus every step that (transitively) read one of them. */
function carriedBy(recipe: Recipe, seeds: Set<string>): Set<string> {
  const carried = new Set(seeds);
  for (const step of recipe.steps) if (step.inputs.some((input) => carried.has(input))) carried.add(step.id);
  return carried;
}

/** Inputs that carry the pet: the pet slot, or a step that (transitively) read it. */
export function petInputs(recipe: Recipe): Set<string> {
  return carriedBy(recipe, slotsWithRole(recipe, 'pet'));
}

/** Inputs that carry the partner's face: the partner slot, or a step that (transitively) read it. */
export function partnerInputs(recipe: Recipe): Set<string> {
  return carriedBy(recipe, slotsWithRole(recipe, 'partner'));
}

/** Inputs that carry the buyer's own face (the selfie or a `role: 'person'` slot), never the partner's. */
function buyerInputs(recipe: Recipe): Set<string> {
  const seeds = new Set(Object.entries(recipe.slots).filter(([name, slot]) => name === SELFIE_SLOT || slot.role === 'person').map(([name]) => name));
  return carriedBy(recipe, seeds);
}

/** docs/CAST-CATEGORIES.md — who the recipe features: a partner makes it a couple, a pet a pet template. */
export function recipeCast(recipe: Pick<Recipe, 'slots'>): 'solo' | 'couple' | 'pet' {
  if (slotsWithRole(recipe, 'partner').size > 0) return 'couple';
  if (slotsWithRole(recipe, 'pet').size > 0) return 'pet';
  return 'solo';
}

/** What the make step asks the buyer for. Display-safe: names no prompt, engine or file. */
export interface RecipeMakeInputs { selfie: boolean; pet: boolean; partner: boolean }
export function recipeMakeInputs(recipe: Pick<Recipe, 'slots'>): RecipeMakeInputs {
  return {
    selfie: recipe.slots[SELFIE_SLOT] !== undefined,
    pet: slotsWithRole(recipe, 'pet').size > 0,
    partner: slotsWithRole(recipe, 'partner').size > 0,
  };
}

/** True when the recipe includes any person slot (so face consent & identity checks apply). */
export function recipeHasPerson(recipe: Pick<Recipe, 'slots'>): boolean {
  return personSlots(recipe).size > 0;
}

/** Inputs that carry a person's face: a person slot (`selfie` or `role: 'person'`), or a step that (transitively) read it. */
export function personInputs(recipe: Recipe): Set<string> {
  const person = personSlots(recipe);
  for (const step of recipe.steps) if (step.inputs.some((input) => person.has(input))) person.add(step.id);
  return person;
}

/** Does any step send a person's face to a ModelArk engine (so the verified library is needed)? */
export function recipeNeedsIdentity(recipe: Recipe): boolean {
  const person = personInputs(recipe);
  if (person.size === 0) return false;
  return recipe.steps.some((step) => (isMakerEngine(step.engine) || isStudioRecipeEngine(step.engine)) && identityPath(step.engine) === 'asset' && step.inputs.some((input) => person.has(input)));
}

/** A set frame's words the way the recipe stores them: the buyer's photo, "Image 1", as its token. */
export function setFrameStepPrompt(prompt: string): string {
  return prompt.replace(/\bImage 1\b/g, `{{${SELFIE_SLOT}}}`);
}

export function setPromptTooLong(prompt: string): boolean {
  return setFrameStepPrompt(prompt).trim().length > MAX_STEP_PROMPT_CHARS;
}

export interface ParseRecipeOptions {
  studio?: boolean;
  /**
   * Brand/studio faceless recipes (BRAND-PRODUCT §8·§9): allows recipes whose slots are only
   * `product | scene | look | mask` without a `selfie` slot. Whenever a `selfie` or `role: 'person'`
   * slot IS present, all identity/consent/output rules remain strictly enforced.
   */
  allowFaceless?: boolean;
  /**
   * Personal customizable templates: keeps `selfie` mandatory (`required: true, role: 'person'`),
   * and allows up to two additional non-person user reference slots (`look | product | scene`).
   */
  allowUserReferenceSlots?: boolean;
}

export function parseRecipe(raw: unknown, options: ParseRecipeOptions = {}): RecipeCheck {
  const maxBytes = options.studio ? MAX_STUDIO_RECIPE_BYTES : MAX_RECIPE_BYTES;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { ok: false, issues: [{ code: 'too_large' }] };
    try { raw = JSON.parse(raw); } catch { return { ok: false, issues: [{ code: 'shape' }] }; }
  } else if (Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8') > maxBytes) return { ok: false, issues: [{ code: 'too_large' }] };
  const parsed = RecipeShape.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: [{ code: 'shape' }] };
  const recipe = parsed.data;
  const issues: RecipeIssue[] = [];
  const slots = Object.entries(recipe.slots);

  // Slots: in consumer/maker mode `selfie` is the one user input; in faceless brand mode, `selfie` is optional
  // when no person is in the shot, while any `selfie` or `person` slot keeps the full identity rules.
  // docs/CAST-CATEGORIES.md §3: a solo or couple recipe requires the selfie; a pet-only recipe requires
  // the pet instead. A partner slot never stands in for the selfie.
  const selfie = recipe.slots[SELFIE_SLOT];
  const castSlots = slots.filter(([, slot]) => slot.role === 'pet' || slot.role === 'partner');
  const hasPet = castSlots.some(([, slot]) => slot.role === 'pet');
  const hasPartner = castSlots.some(([, slot]) => slot.role === 'partner');
  if (selfie) {
    if (selfie.source !== 'user' || selfie.required !== true || (selfie.role !== undefined && selfie.role !== 'person')) {
      issues.push({ code: 'selfie_missing' });
    }
  } else if (!options.allowFaceless && !(hasPet && !hasPartner)) {
    issues.push({ code: 'selfie_missing' });
  }
  for (const [name, slot] of castSlots) {
    // One pet, one partner, each a required buyer photo under its own name.
    const fixedName = slot.role === 'pet' ? PET_SLOT : PARTNER_SLOT;
    if (name !== fixedName || slot.source !== 'user' || slot.required !== true) issues.push({ code: 'cast_slot', slot: name });
  }
  if (hasPet && hasPartner) issues.push({ code: 'cast_mix' });
  let extraUserSlots = 0;
  for (const [name, slot] of slots) {
    if (slot.source === 'user' && name !== SELFIE_SLOT && slot.role !== 'pet' && slot.role !== 'partner') {
      extraUserSlots += 1;
      const validExtraRole = slot.role && slot.role !== 'person';
      const allowedByFaceless = options.allowFaceless && slot.required === true && validExtraRole;
      const allowedByPersonalCustom =
        options.allowUserReferenceSlots &&
        extraUserSlots <= 2 &&
        (slot.role === 'look' || slot.role === 'product' || slot.role === 'scene');
      if (!allowedByFaceless && !allowedByPersonalCustom) {
        issues.push({ code: 'user_slot', slot: name });
      }
    }
  }

  const seen = new Map<string, RecipeStep>();
  const used = new Set<string>();
  recipe.steps.forEach((step, index) => {
    if (recipe.slots[step.id]) issues.push({ code: 'name_clash', step: step.id });
    if (seen.has(step.id)) issues.push({ code: 'duplicate_step', step: step.id });
    if (!isMakerEngine(step.engine) && !(options.studio && isStudioRecipeEngine(step.engine))) issues.push({ code: 'engine', step: step.id });
    else if (step.kind === 'image' ? !isImageEngine(step.engine) : !isVideoEngine(step.engine)) issues.push({ code: 'engine_kind', step: step.id });
    if (new Set(step.inputs).size !== step.inputs.length) issues.push({ code: 'unknown_input', step: step.id });
    let images = 0;
    for (const input of step.inputs) {
      const slot = recipe.slots[input];
      const earlier = seen.get(input);
      if (slot) {
        used.add(input);
        if (slot.kind === 'video' || slot.kind === 'audio') { if (step.kind !== 'video') issues.push({ code: 'video_input', step: step.id }); }
        else images += 1;
      } else if (earlier) {
        used.add(input);
        if (earlier.kind !== 'image') issues.push({ code: 'video_input', step: step.id });
        images += 1;
      } else if (recipe.steps.some((other, at) => other.id === input && at >= index)) issues.push({ code: 'forward_input', step: step.id });
      else issues.push({ code: 'unknown_input', step: step.id });
    }
    if (isEngineId(step.engine) && images > maxImageInputs(step.engine)) issues.push({ code: 'too_many_inputs', step: step.id });

    // Tokens: only the step's own inputs, each at least once; never an engine's own handle syntax.
    const tokens = promptTokens(step.prompt);
    if (tokens === null) issues.push({ code: 'bad_token', step: step.id });
    else {
      if (tokens.some((token) => !step.inputs.includes(token))) issues.push({ code: 'unknown_token', step: step.id });
      if (step.inputs.some((input) => !tokens.includes(input))) issues.push({ code: 'unused_input', step: step.id });
    }
    if (/@(image|video|audio)\s*\d/i.test(step.prompt)) issues.push({ code: 'raw_handle', step: step.id });

    if (step.kind === 'video' && isVideoEngine(step.engine)) {
      // The engine's own range (a 2.0 step is not quietly moved to 2.5), the model's resolutions and frames.
      const spec = videoEngineSpec(step.engine);
      if (step.params.duration < spec.minDurationSeconds || step.params.duration > spec.maxDurationSeconds) issues.push({ code: 'duration', step: step.id });
      if (!spec.resolutions.includes(step.params.resolution)) issues.push({ code: 'resolution', step: step.id });
      if (spec.aspects !== null && !spec.aspects.includes(step.params.aspect)) issues.push({ code: 'aspect', step: step.id });
    }
    seen.set(step.id, step);
  });
  const personSlotSet = personSlots(recipe);
  for (const [name] of slots) if (!used.has(name)) issues.push(personSlotSet.has(name) ? { code: 'no_identity' } : { code: 'unused_slot', slot: name });

  // Layout: one image, one film, an image then a film — or a carousel of one to ten images.
  const kinds = recipe.steps.map((step) => step.kind);
  if ('from' in recipe.output) {
    const layout = kinds.join(',');
    if (!['image', 'video', 'image,video'].includes(layout)) issues.push({ code: 'step_layout' });
    if (recipe.output.from !== recipe.steps[recipe.steps.length - 1]?.id) issues.push({ code: 'output' });
  } else {
    if (kinds.some((kind) => kind !== 'image')) issues.push({ code: 'step_layout' });
    const frames = recipe.output.frames;
    if (new Set(frames).size !== frames.length || frames.some((frame) => !seen.has(frame))) issues.push({ code: 'output' });
    // A step nobody shows and nobody reads is money spent on nothing.
    const read = new Set(recipe.steps.flatMap((step) => step.inputs));
    for (const step of recipe.steps) if (!frames.includes(step.id) && !read.has(step.id)) issues.push({ code: 'output', step: step.id });
  }

  // Whenever a person slot is present (or in consumer mode), every result must feature the person —
  // except a pet-only recipe, whose results feature the pet (checked below).
  const person = personInputs(recipe);
  if (personSlotSet.size > 0 || (!options.allowFaceless && !hasPet)) {
    for (const id of outputSteps(recipe)) if (seen.has(id) && !person.has(id)) issues.push({ code: 'no_identity', step: id });
  }
  // The cast is in every result: a pet template's frames all show the pet, a couple's both people.
  const pets = petInputs(recipe), partners = partnerInputs(recipe);
  for (const id of outputSteps(recipe)) {
    if (!seen.has(id)) continue;
    if (hasPet && !pets.has(id)) issues.push({ code: 'no_pet', step: id });
    if (hasPartner && !partners.has(id)) issues.push({ code: 'no_partner', step: id });
  }
  // The verified library holds the account's own face and nothing else: no step may send the partner
  // (or anything made from the partner) to an engine that registers faces there.
  for (const step of recipe.steps) {
    if (isEngineId(step.engine) && identityPath(step.engine) === 'asset' && step.inputs.some((input) => partners.has(input))) {
      issues.push({ code: 'partner_asset', step: step.id });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, recipe, medium: recipeMedium(recipe) };
}

/** Convenience wrapper for brand/studio recipes that may be faceless (product, scene, look, mask). */
export function parseBrandRecipe(raw: unknown): RecipeCheck {
  return parseRecipe(raw, { studio: true, allowFaceless: true });
}

/** Convenience wrapper for personal customizable templates (requires `selfie`, allows up to 2 extra user reference slots `look | product | scene`). */
export function parsePersonalCustomizableRecipe(raw: unknown): RecipeCheck {
  return parseRecipe(raw, { studio: true, allowUserReferenceSlots: true });
}

/** Creator asset handles a recipe points at (the submission checks each belongs to the format). */
export function recipeAssets(recipe: Recipe): string[] {
  return Object.values(recipe.slots).flatMap((slot) => (slot.source === 'creator' ? [slot.asset] : []));
}

/** The creator slots in declaration order — `[참조 1]`, `[참조 2]`, … on screen. */
export function creatorSlotNames(recipe: Pick<Recipe, 'slots'>): string[] {
  return Object.entries(recipe.slots).filter(([, slot]) => slot.source === 'creator').map(([name]) => name);
}

/**
 * A step's prompt as the engine reads it: `{{name}}` → its position among the request's references
 * ("Image 2", "Video 1"), plus one line naming which of them is the person whose face is kept.
 * The inputs' order IS the request's reference order (lib/recipes/execute.ts builds it the same way).
 */
export function engineStepPrompt(recipe: Recipe, step: RecipeStep): string {
  const person = personInputs(recipe);
  const position = new Map<string, string>();
  let images = 0, videos = 0, audios = 0;
  for (const input of step.inputs) {
    const kind = recipe.slots[input]?.kind ?? 'image';
    position.set(
      input,
      kind === 'video' ? `Video ${++videos}` : kind === 'audio' ? `Audio ${++audios}` : `Image ${++images}`,
    );
  }
  const text = step.prompt.replace(TOKEN, (_match, name: string) => position.get(name.trim()) ?? '');
  const lines: string[] = [];
  const faces = step.inputs.filter((input) => person.has(input));
  if (faces.length) {
    const named = faces.map((input) => position.get(input)!);
    const verb = named.length > 1 ? 'show' : 'shows';
    // docs/CAST-CATEGORIES.md §3: two people when the step carries both the buyer and the partner.
    const partners = partnerInputs(recipe), buyer = buyerInputs(recipe);
    const two = faces.some((input) => partners.has(input)) && faces.some((input) => buyer.has(input));
    lines.push(two
      ? `${named.join(', ')} ${verb} the two people to feature. Keep each person’s identity, face and features exactly as photographed, and keep them two distinct people.`
      : `${named.join(', ')} ${verb} the person to feature. Keep their identity, face and features exactly as photographed.`);
  }
  const pets = petInputs(recipe);
  const animals = step.inputs.filter((input) => pets.has(input) && !person.has(input)).map((input) => position.get(input)!);
  if (animals.length) {
    lines.push(`${animals.join(', ')} ${animals.length > 1 ? 'show' : 'shows'} the pet to feature. Keep its species, breed, coat colour, markings and proportions exactly as photographed.`);
  }
  return lines.length ? `${text}\n\n${lines.join('\n')}` : text;
}

/** The same prompt for a person to read: slots become `[내 사진]`, `[참조 1]`, steps `[1단계 결과]`. */
export function displayStepPrompt(recipe: Recipe, step: RecipeStep, labels: { selfie: string; reference: string; step: string; pet?: string; partner?: string }): string {
  const creators = creatorSlotNames(recipe);
  return step.prompt.replace(TOKEN, (_match, raw: string) => {
    const name = raw.trim();
    if (name === SELFIE_SLOT) return `[${labels.selfie}]`;
    const role = recipe.slots[name]?.role;
    if (role === 'pet') return `[${labels.pet ?? labels.selfie}]`;
    if (role === 'partner') return `[${labels.partner ?? labels.selfie}]`;
    const creator = creators.indexOf(name);
    if (creator >= 0) return `[${labels.reference.replace('{n}', String(creator + 1))}]`;
    const at = recipe.steps.findIndex((other) => other.id === name);
    return `[${labels.step.replace('{n}', String(at + 1))}]`;
  });
}

/** A recipe the way an import/export file holds it: the schema, nothing else, stable key order. */
export function exportRecipe(recipe: Recipe): string {
  return JSON.stringify({ version: recipe.version, slots: recipe.slots, steps: recipe.steps, output: recipe.output, ...(recipe.notes ? { notes: recipe.notes } : {}) }, null, 2);
}

/** The single-prompt fallback stored in prompt_text (legacy readers), in the catalogue's `@imageN` dialect. */
export function legacyPromptText(recipe: Recipe): string {
  const step = primaryStep(recipe);
  return engineStepPrompt(recipe, step).replace(/\bImage (\d+)\b/g, '@image$1').replace(/\bVideo (\d+)\b/g, '@video$1').replace(/\bAudio (\d+)\b/g, '@audio$1');
}
