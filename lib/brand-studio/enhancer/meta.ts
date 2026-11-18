/**
 * What a job records about the prompt it sent (`work.enhancer`): which profile version and core rules wrote
 * it, which model wrote it (or that the deterministic fallback did, and why), and which skin rules applied.
 * Internal only; nothing here is shown to a customer. Pure.
 */
import { CORE_VERSION, profileVersionOf, skinFor, skinVariantOf, type SkinVariant } from './profiles';
import { bindReferences } from './references';
import type { EnhanceInput, EnhanceMeta } from './types';

export function enhanceMeta(
  input: EnhanceInput,
  source: 'model' | 'fallback',
  options: { llmModel?: string | null; fallbackReason?: string; env?: Record<string, string | undefined> } = {},
): EnhanceMeta {
  const binding = bindReferences(input);
  const variant: SkinVariant = skinVariantOf(input.model, options.env ?? {});
  const { plan } = skinFor(input, binding, variant);
  return {
    profile: input.profile,
    profileVersion: profileVersionOf(input.profile, input.model),
    coreVersion: CORE_VERSION,
    llmModel: source === 'model' ? (options.llmModel ?? null) : null,
    source,
    ...(source === 'fallback' && options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}),
    skinMode: plan.mode,
    toneMatch: plan.toneMatch,
    ...(plan.toneMatch ? { skinVariant: variant } : {}),
  };
}
