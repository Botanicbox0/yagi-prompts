/** System instruction = shared core + the model's profile + this run's task. */
import type { StudioPromptProfile } from '@/lib/brand-studio/models';
import type { PlannedShot } from '../lines';
import type { Binding } from '../references';
import type { EnhanceInput } from '../types';
import { coreBlock } from './core';
import { GPT_IMAGE_PROFILE } from './gpt-image';
import { NANO_BANANA_PROFILE } from './nano-banana';
import { SEEDANCE_PROFILE } from './seedance';
import { SEEDREAM_PROFILE } from './seedream';
import { taskBlock } from './tasks';

export const PROFILE_BLOCKS: Record<StudioPromptProfile, string> = {
  seedream: SEEDREAM_PROFILE,
  'nano-banana': NANO_BANANA_PROFILE,
  'gpt-image': GPT_IMAGE_PROFILE,
  seedance: SEEDANCE_PROFILE,
};

function regionEditProfileBlock(profile: StudioPromptProfile, wide = false): string {
  const tokenSyntax = profile === 'seedream' ? '"Figure N"' : '"image N"';
  const firstToken = profile === 'seedream' ? 'Figure 1' : 'image 1';
  const formatLine =
    profile === 'seedream'
      ? 'Write ONE compact paragraph of plain English (two to five sentences, no line breaks, no bullet lists).'
      : 'Write short, surgical plain-English edit instructions (two to five sentences, no scene-generation boilerplate).';
  return `Model: a precision local-repair image editor. Do NOT write a full-scene generation brief.
${formatLine}
References: name attached images only as ${tokenSyntax} with the exact numbers given (${firstToken} is ${wide ? "the customer's picture, shown wide, with one part to change in place" : 'the enlarged region crop to repair in place'}; any source references start at 2).
A logo, label or product source gets: "use the exact mark from <token>; do not redraw, mirror, restyle or enlarge it".
Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with exact surface placement and proportion.
People: keep facial identity, head angle, gaze and expression locked unless asked; natural skin texture without plastic or waxy retouching.`;
}

export function buildSystemInstruction(
  input: EnhanceInput,
  binding: Binding,
  seconds: number | null,
  shots: readonly PlannedShot[],
): string {
  const wide = input.kind === 'region_edit' && Boolean(input.regionWindow);
  const profileBlock = input.kind === 'region_edit' ? regionEditProfileBlock(input.profile, wide) : PROFILE_BLOCKS[input.profile];
  return [coreBlock(input.locale, input.kind, wide), profileBlock, taskBlock(input, binding, seconds, shots)].join('\n\n');
}
