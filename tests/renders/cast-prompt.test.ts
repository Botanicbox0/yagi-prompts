import { describe, expect, it } from 'vitest';
import { buildRenderPrompt, IDENTITY_LOCK_IMAGE, IDENTITY_LOCK_VIDEO, identityLockFor } from '@/lib/renders/prompt';
import { PREMIUM_EDIT_INSTRUCTIONS, premiumEditInstructions } from '@/lib/premium-editing/guard';
import { enforcePersonalMorphicGuardrails } from '@/lib/template-director/morphic-production-playbook';

/** docs/CAST-CATEGORIES.md §3 — the "one person" locks follow the cast; solo stays byte for byte. */
describe('cast-aware prompt locks', () => {
  it('solo keeps the existing identity locks exactly', () => {
    expect(identityLockFor('solo', 'image')).toBe(IDENTITY_LOCK_IMAGE);
    expect(identityLockFor('solo', 'video')).toBe(IDENTITY_LOCK_VIDEO);
    const before = buildRenderPrompt({ promptText: 'A walk through a night market.', medium: 'video', hasPhoto: true });
    expect(before.text.endsWith(IDENTITY_LOCK_VIDEO)).toBe(true);
    expect(premiumEditInstructions('solo')).toBe(PREMIUM_EDIT_INSTRUCTIONS);
  });

  it('a pet is never described as a person', () => {
    const text = buildRenderPrompt({ promptText: 'A run along the beach at dawn.', medium: 'image', hasPhoto: true, cast: 'pet' }).text;
    expect(text).toContain('The pet in the reference photo is the subject.');
    expect(text).not.toMatch(/person/);
    expect(premiumEditInstructions('pet')).not.toContain('sole person');
    const guarded = enforcePersonalMorphicGuardrails('A dog runs on a beach.', { hasPersonSlot: false, cast: 'pet', hasSlenderArmLock: true });
    expect(guarded).toContain('PET LOCK');
    expect(guarded).not.toContain('SLENDER SILHOUETTE LOCK');
  });

  it('a couple keeps two distinct people', () => {
    expect(identityLockFor('couple', 'video')).toContain('two people');
    expect(premiumEditInstructions('couple')).toContain('two distinct people');
    expect(premiumEditInstructions('couple')).not.toContain('sole person');
    expect(enforcePersonalMorphicGuardrails('Two people dance.', { hasPersonSlot: true, cast: 'couple' })).toContain('TWO-PERSON LOCK');
    // Solo is untouched by the cast locks.
    expect(enforcePersonalMorphicGuardrails('One person dances.', { hasPersonSlot: true })).not.toMatch(/TWO-PERSON LOCK|PET LOCK/);
  });
});
