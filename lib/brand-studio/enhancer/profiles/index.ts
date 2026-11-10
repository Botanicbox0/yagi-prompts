/** System instruction = shared core + the model's profile + this run's task. */
import type { StudioPromptProfile } from '@/lib/brand-studio/models';
import type { PlannedShot } from '../lines';
import type { Binding } from '../references';
import type { EnhanceInput } from '../types';
import { coreBlock } from './core';
import { NANO_BANANA_PROFILE } from './nano-banana';
import { SEEDANCE_PROFILE } from './seedance';
import { SEEDREAM_PROFILE } from './seedream';
import { taskBlock } from './tasks';

export const PROFILE_BLOCKS: Record<StudioPromptProfile, string> = {
  seedream: SEEDREAM_PROFILE,
  'nano-banana': NANO_BANANA_PROFILE,
  seedance: SEEDANCE_PROFILE,
};

export function buildSystemInstruction(
  input: EnhanceInput,
  binding: Binding,
  seconds: number | null,
  shots: readonly PlannedShot[],
): string {
  return [coreBlock(input.locale), PROFILE_BLOCKS[input.profile], taskBlock(input, binding, seconds, shots)].join('\n\n');
}
