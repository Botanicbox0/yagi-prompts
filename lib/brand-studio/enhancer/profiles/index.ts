/**
 * System instruction = shared core + the model family's profile + the model's own block (when it has one)
 * + this run's task + the people rules. A profile is found by model id first, then by family
 * (models.ts `promptProfile`), so a version-specific rule has a home without forking the family.
 */
import type { StudioPromptProfile } from '@/lib/brand-studio/models';
import type { PlannedShot } from '../lines';
import type { Binding } from '../references';
import type { EnhanceInput } from '../types';
import { CORE_HEADER, coreBlock } from './core';
import { GPT_IMAGE_26_BLOCK, GPT_IMAGE_HEADER, GPT_IMAGE_MARKUP_RULE, GPT_IMAGE_PROFILE } from './gpt-image';
import type { ModelBlock, ProfileHeader } from './meta';
import { NANO_BANANA_21_BLOCK, NANO_BANANA_HEADER, NANO_BANANA_PRO_BLOCK, NANO_BANANA_PROFILE } from './nano-banana';
import { SEEDANCE_HEADER, SEEDANCE_PROFILE } from './seedance';
import { SEEDREAM_HEADER, SEEDREAM_PROFILE } from './seedream';
import { planSkin, skinRules, type SkinPlan, type SkinVariant } from './skin';
import { taskBlock } from './tasks';

export { CORE_HEADER } from './core';
export type { ModelBlock, ProfileHeader, ProfileSource } from './meta';
export { planSkin, skinVariantOf, mentionsPerson, wantsRealSkin, wantsToneKept, type SkinMode, type SkinPlan, type SkinVariant } from './skin';

export const PROFILE_BLOCKS: Record<StudioPromptProfile, string> = {
  seedream: SEEDREAM_PROFILE,
  'nano-banana': NANO_BANANA_PROFILE,
  'gpt-image': GPT_IMAGE_PROFILE,
  seedance: SEEDANCE_PROFILE,
};

export const PROFILE_HEADERS: Record<StudioPromptProfile, ProfileHeader> = {
  seedream: SEEDREAM_HEADER,
  'nano-banana': NANO_BANANA_HEADER,
  'gpt-image': GPT_IMAGE_HEADER,
  seedance: SEEDANCE_HEADER,
};

/** Blocks for one model id; they follow the family block. */
export const MODEL_BLOCKS: Readonly<Record<string, ModelBlock>> = {
  'nano-banana-pro': NANO_BANANA_PRO_BLOCK,
  'nano-banana-2.1': NANO_BANANA_21_BLOCK,
  'gpt-image-2.6-flare': GPT_IMAGE_26_BLOCK,
  'gpt-image-2.6-sunburst': GPT_IMAGE_26_BLOCK,
};

/** `seedream@2026-11-19.1` or `nano-banana@2026-11-19.1+nano-banana-2.1@2026-11-19.1`: what a job records. */
export function profileVersionOf(profile: StudioPromptProfile, model?: string | null): string {
  const family = PROFILE_HEADERS[profile];
  const own = model ? MODEL_BLOCKS[model] : undefined;
  return own ? `${family.id}@${family.version}+${own.header.id}@${own.header.version}` : `${family.id}@${family.version}`;
}

export const CORE_VERSION = `${CORE_HEADER.id}@${CORE_HEADER.version}`;

function regionEditProfileBlock(profile: StudioPromptProfile, wide = false): string {
  const tokenSyntax = profile === 'seedream' ? '"Image N" (a capital I)' : '"image N"';
  const firstToken = profile === 'seedream' ? 'Image 1' : 'image 1';
  const formatLine =
    profile === 'seedream'
      ? 'Write ONE compact paragraph of plain English (two to five sentences, no line breaks, no bullet lists).'
      : 'Write short, surgical plain-English edit instructions (two to five sentences, no scene-generation boilerplate).';
  const logo =
    profile === 'nano-banana'
      ? 'A logo, label or product source gets: "reproduce the mark from <token> exactly as drawn: the same letterforms, orientation, proportions and colours, at the size the part has now".'
      : 'A logo, label or product source gets: "use the exact mark from <token>; do not redraw, mirror, restyle or enlarge it".';
  return `Model: a precision local-repair image editor. Do NOT write a full-scene generation brief.
${formatLine}
References: name attached images only as ${tokenSyntax} with the exact numbers given (${firstToken} is ${wide ? "the customer's picture, shown wide, with one part to change in place" : 'the enlarged region crop to repair in place'}; any source references start at 2).
${logo}
Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with exact surface placement and proportion.
People: keep facial identity, head angle, gaze and expression locked unless asked; natural skin texture without plastic or waxy retouching.`;
}

export interface SystemOptions {
  /** Tone-match variant (profiles/skin.ts); the run's env decides it. */
  skinVariant?: SkinVariant;
  /** GPT Image 2.6 only: a markup overlay is sent with the edit (no studio path does yet). */
  markup?: boolean;
}

/** The people rules this run gets, and the plan they come from (also recorded on the job). */
export function skinFor(input: EnhanceInput, binding: Binding, variant: SkinVariant = 'short'): { plan: SkinPlan; text: string } {
  const plan = planSkin({
    kind: input.kind,
    prompt: input.prompt,
    change: input.video?.change ?? null,
    references: input.references,
    brandRules: input.brand?.rules ?? null,
  });
  const personTokens = binding.bound.filter((b) => b.ref.role === 'person' && b.token).map((b) => b.token as string);
  return { plan, text: input.profile === 'seedance' ? '' : skinRules({ profile: input.profile, plan, variant, personTokens }) };
}

export function buildSystemInstruction(
  input: EnhanceInput,
  binding: Binding,
  seconds: number | null,
  shots: readonly PlannedShot[],
  options: SystemOptions = {},
): string {
  const wide = input.kind === 'region_edit' && Boolean(input.regionWindow);
  const profileBlock = input.kind === 'region_edit' ? regionEditProfileBlock(input.profile, wide) : PROFILE_BLOCKS[input.profile];
  const own = input.kind !== 'region_edit' && input.model ? MODEL_BLOCKS[input.model]?.text : undefined;
  const markup = options.markup && input.model?.startsWith('gpt-image-2.6') ? GPT_IMAGE_MARKUP_RULE : '';
  const skin = skinFor(input, binding, options.skinVariant).text;
  return [coreBlock(input.locale, input.kind, wide), profileBlock, own ?? '', taskBlock(input, binding, seconds, shots), markup, skin]
    .filter(Boolean)
    .join('\n\n');
}
