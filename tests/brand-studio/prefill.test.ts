import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import {
  STUDIO_PREFILL_KEY,
  STUDIO_PREFILL_MAX_AGE_MS,
  takeStudioPrefill,
  writeStudioPrefill,
} from '@/components/brand-studio/prefill';

/**
 * docs/BRAND-STUDIO-V3.md §12 — the home's hand-off to a studio's prompt bar. Read once, never after a
 * reload, never for a member who cannot create, never over words already typed, never for a sandboxed
 * organization, never for another brand or the other screen.
 */
function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const ORG = 'a0000000-0000-4000-8000-00000000000a';
const NOW = 1_800_000_000_000;
const take = (storage: ReturnType<typeof memory>, over: Partial<Parameters<typeof takeStudioPrefill>[1]> = {}) =>
  takeStudioPrefill(storage, { organizationId: ORG, medium: 'image', canCreate: true, currentPrompt: '', now: NOW + 1000, ...over });

describe('the studio prefill hand-off', () => {
  it('is used once: the second read (a reload) finds nothing', () => {
    const storage = memory();
    expect(writeStudioPrefill(storage, { organizationId: ORG, medium: 'image', prompt: '  흰 대리석 위 향수병  ' }, NOW)).toBe(true);
    expect(take(storage)).toBe('흰 대리석 위 향수병');
    expect(storage.map.has(STUDIO_PREFILL_KEY)).toBe(false);
    expect(take(storage)).toBeNull();
  });

  it('is ignored, and still removed, for a member who cannot create (a viewer)', () => {
    const storage = memory();
    writeStudioPrefill(storage, { organizationId: ORG, medium: 'image', prompt: 'a bottle' }, NOW);
    expect(take(storage, { canCreate: false })).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('never replaces words already in the field', () => {
    const storage = memory();
    writeStudioPrefill(storage, { organizationId: ORG, medium: 'image', prompt: 'a bottle' }, NOW);
    expect(take(storage, { currentPrompt: '내가 쓰던 문장' })).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it.each([...SANDBOXED_CLIENT_ORG_IDS])('is ignored on the sandboxed organization %s', (id) => {
    const storage = memory();
    writeStudioPrefill(storage, { organizationId: id, medium: 'image', prompt: 'a bottle' }, NOW);
    expect(take(storage, { organizationId: id })).toBeNull();
  });

  it('belongs to one brand and one screen, and goes stale', () => {
    const storage = memory();
    writeStudioPrefill(storage, { organizationId: ORG, medium: 'video', prompt: 'a slow push-in' }, NOW);
    expect(take(storage, { medium: 'image' })).toBeNull();
    writeStudioPrefill(storage, { organizationId: ORG, medium: 'video', prompt: 'a slow push-in' }, NOW);
    expect(take(storage, { organizationId: 'b0000000-0000-4000-8000-00000000000b', medium: 'video' })).toBeNull();
    writeStudioPrefill(storage, { organizationId: ORG, medium: 'video', prompt: 'a slow push-in' }, NOW);
    expect(take(storage, { medium: 'video', now: NOW + STUDIO_PREFILL_MAX_AGE_MS + 1 })).toBeNull();
    writeStudioPrefill(storage, { organizationId: ORG, medium: 'video', prompt: 'a slow push-in' }, NOW);
    expect(take(storage, { medium: 'video' })).toBe('a slow push-in');
  });

  it('writes nothing for an empty sentence and survives broken or blocked storage', () => {
    const storage = memory();
    expect(writeStudioPrefill(storage, { organizationId: ORG, medium: 'image', prompt: '   ' }, NOW)).toBe(false);
    expect(storage.map.size).toBe(0);
    storage.map.set(STUDIO_PREFILL_KEY, '{not json');
    expect(take(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
    expect(take(null as never)).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
    expect(writeStudioPrefill(blocked, { organizationId: ORG, medium: 'image', prompt: 'x' }, NOW)).toBe(false);
    expect(takeStudioPrefill(blocked, { organizationId: ORG, medium: 'image', canCreate: true, currentPrompt: '' })).toBeNull();
  });

  it('is read by the dock on both studio screens, only where the prompt bar is open', () => {
    const dock = readFileSync('components/brand-studio/use-dock.ts', 'utf8');
    expect(dock).toContain('takeStudioPrefill(');
    for (const file of ['components/brand-studio/studio-app.tsx', 'components/brand-studio/video/workspace.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toMatch(/prefill: \{ ready: Boolean\(studio\.store\.state\), canCreate: Boolean\(studio\.store\.state\?\.canCreate\) && \(studio\.store\.state\?\.allowance\.capKrw \?\? 0\) > 0 \}/);
    }
  });
});

describe('the phone safe area for the help launcher', () => {
  it('moves the launcher into the top bar on phones in the rail shell, out of every tile and the tab bar', () => {
    const rail = readFileSync('app/(brand)/rail.css', 'utf8');
    const phone = rail.slice(rail.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.bw-shell:has\(\[data-brand-layout-mode="rail"\]\) ~ \.bw-support-launch \{\s*position: absolute;\s*top: 12px;\s*right: 112px;\s*bottom: auto;/);
    // The studio's own lift above its dock must not throw it off the top bar.
    expect(phone).toMatch(/~ \.bw-support-launch \{[^}]*translate: none;/);
  });
});
