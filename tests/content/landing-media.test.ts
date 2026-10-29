import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILM_BOUND_STILLS, LANDING_MEDIA_SLOTS, NO_LANDING_MEDIA, evidenceWithMedia, landingMediaSlot, landingSrc, mediaSrc, studioSrc } from '@/lib/content/landing-media';
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

  it('covers every still the brand landing ships', () => {
    for (const area of ['landing', 'studio']) {
      const files = readdirSync(join(process.cwd(), 'public', 'reel', area)).filter((file) => file.endsWith('.webp'));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const key = `${area}/${file.replace(/\.webp$/, '')}`;
        // A still that shows a film's product moves with the film, never on its own.
        if (FILM_BOUND_STILLS.includes(key)) expect(landingMediaSlot(key), file).toBeUndefined();
        else expect(landingMediaSlot(key), file).toBeDefined();
      }
    }
    for (const key of FILM_BOUND_STILLS) expect(existsSync(join(process.cwd(), 'public', 'reel', `${key}.webp`)), key).toBe(true);
  });

  it('resolves an override, else the file, and refuses names it does not know', () => {
    const media = { 'landing/sc-balm': 'https://cdn.example/balm.webp' };
    expect(mediaSrc(media, 'landing/sc-balm')).toBe('https://cdn.example/balm.webp');
    expect(landingSrc(media, 'pk-balm')).toBe('/reel/landing/pk-balm.webp');
    expect(studioSrc(NO_LANDING_MEDIA, 'vto-garment')).toBe('/reel/studio/vto-garment.webp');
    // Retired files are not slots any more: the orbit bottles and the old mood library.
    expect(() => studioSrc(media, 'bottle-red')).toThrow(/unknown landing media slot/);
    expect(() => landingSrc(media, 'amber-yagi')).toThrow(/unknown landing media slot/);
  });

  it('keeps the hero film only while its still is the original', () => {
    expect(evidenceWithMedia(DEFAULT_HERO_EVIDENCE, NO_LANDING_MEDIA)).toEqual(DEFAULT_HERO_EVIDENCE);
    expect(evidenceWithMedia(DEFAULT_HERO_EVIDENCE, { 'studio-demo/reference-selfie': '/new-selfie.webp' })).toEqual({ ...DEFAULT_HERO_EVIDENCE, before: '/new-selfie.webp' });
    expect(evidenceWithMedia(DEFAULT_HERO_EVIDENCE, { 'studio-demo/different-person': '/new-scene.webp' })).toEqual({ before: DEFAULT_HERO_EVIDENCE.before, after: '/new-scene.webp' });
  });
});
