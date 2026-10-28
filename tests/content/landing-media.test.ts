import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANDING_MEDIA_SLOTS, NO_LANDING_MEDIA, evidenceWithMedia, landingMediaSlot, mediaSrc, studioSrc } from '@/lib/content/landing-media';
import { DEFAULT_HERO_EVIDENCE } from '@/lib/content/slots';

/** The slot registry is the contract between the landings and /admin/landing-media. */
describe('landing media slots', () => {
  it('names every slot once, with a default file that exists and a key the database accepts', () => {
    const keys = LANDING_MEDIA_SLOTS.map((slot) => slot.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const slot of LANDING_MEDIA_SLOTS) {
      expect(slot.key, slot.key).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(existsSync(join(process.cwd(), 'public', slot.src)), slot.src).toBe(true);
      expect(slot.width).toBeGreaterThan(0);
    }
  });

  it('covers every image the brand studio ships', () => {
    const files = readdirSync(join(process.cwd(), 'public', 'reel', 'studio')).filter((file) => file.endsWith('.webp'));
    for (const file of files) expect(landingMediaSlot(`studio/${file.replace(/\.webp$/, '')}`), file).toBeDefined();
  });

  it('resolves an override, else the file, and refuses names it does not know', () => {
    const media = { 'studio/p-red-1': 'https://cdn.example/red.webp' };
    expect(mediaSrc(media, 'studio/p-red-1')).toBe('https://cdn.example/red.webp');
    expect(studioSrc(media, 'p-red-2')).toBe('/reel/studio/p-red-2.webp');
    expect(studioSrc(NO_LANDING_MEDIA, 'bottle-red')).toBe('/reel/studio/bottle-red.webp');
    expect(() => studioSrc(media, 'amber-yagi')).toThrow(/unknown landing media slot/);
  });

  it('keeps the hero film only while its still is the original', () => {
    expect(evidenceWithMedia(DEFAULT_HERO_EVIDENCE, NO_LANDING_MEDIA)).toEqual(DEFAULT_HERO_EVIDENCE);
    expect(evidenceWithMedia(DEFAULT_HERO_EVIDENCE, { 'studio-demo/reference-selfie': '/new-selfie.webp' })).toEqual({ ...DEFAULT_HERO_EVIDENCE, before: '/new-selfie.webp' });
    expect(evidenceWithMedia(DEFAULT_HERO_EVIDENCE, { 'studio-demo/different-person': '/new-scene.webp' })).toEqual({ before: DEFAULT_HERO_EVIDENCE.before, after: '/new-scene.webp' });
  });
});
