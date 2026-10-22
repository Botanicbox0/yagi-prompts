import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * docs/PLATFORM-2.0.md §5.2 — the manifest is what makes the home-screen app look like ours: the
 * brand black behind the splash and the status bar, maskable icons Android can crop into any
 * shape, a stable id, and the two shortcuts a long-press offers.
 */

const ROOT = process.cwd();
const BRAND_BG = '#0A0A0A';

describe('app/manifest.ts (docs/PLATFORM-2.0.md §5.2)', () => {
  const m = manifest();

  it('paints the splash and the status bar brand black, not white', () => {
    expect(m.theme_color).toBe(BRAND_BG);
    expect(m.background_color).toBe(BRAND_BG);
    expect(m.display).toBe('standalone');
  });

  it('keeps the app id fixed so existing installs stay the same app', () => {
    // The id the first manifest shipped with. Changing it would make every installed copy a
    // different app in the browser's eyes.
    expect(m.id).toBe('/');
    expect(m.scope).toBe('/');
  });

  it('starts on the video formats, resolved to the reader’s own locale, tagged as a PWA launch', () => {
    // `/ko/video` would rewrite an English reader's locale cookie on every launch (middleware
    // remembers a visited prefix); the unprefixed path 308s to `/{locale}/video?source=pwa`.
    expect(m.start_url).toBe('/video?source=pwa');
  });

  it('declares 192 and 512 icons for both the `any` and the `maskable` purpose', () => {
    const icons = m.icons ?? [];
    for (const purpose of ['any', 'maskable'] as const) {
      for (const size of ['192x192', '512x512']) {
        expect(icons.some((icon) => icon.purpose === purpose && icon.sizes === size && icon.type === 'image/png'), `${purpose} ${size}`).toBe(true);
      }
    }
  });

  it('ships every declared icon as a real PNG of the declared size', async () => {
    for (const icon of m.icons ?? []) {
      const file = join(ROOT, 'public', icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const meta = await sharp(file).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
      expect(meta.format, icon.src).toBe('png');
    }
  });

  it('keeps the maskable art inside the 80% safe zone on a full-bleed background', async () => {
    const maskable = (m.icons ?? []).find((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512');
    expect(maskable).toBeDefined();
    const { data, info } = await sharp(join(ROOT, 'public', maskable!.src)).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i]!, data[i + 1]!, data[i + 2]!, info.channels === 4 ? data[i + 3]! : 255];
    };
    // Full bleed: the corners are opaque background, not transparency.
    expect(pixel(0, 0)[3]).toBe(255);
    const background = pixel(0, 0);
    // Every pixel that differs from the background sits within the safe circle (radius 40%).
    const radius = info.width * 0.4;
    let outside = 0;
    for (let y = 0; y < info.height; y += 2) {
      for (let x = 0; x < info.width; x += 2) {
        const p = pixel(x, y);
        const differs = Math.abs(p[0]! - background[0]!) + Math.abs(p[1]! - background[1]!) + Math.abs(p[2]! - background[2]!) > 48;
        if (differs && Math.hypot(x - info.width / 2, y - info.height / 2) > radius) outside += 1;
      }
    }
    expect(outside).toBe(0);
  });

  it('offers the formats and my work as shortcuts, named from the dictionary', () => {
    const copy = getDictionary('ko').appShell.shortcuts;
    const shortcuts = m.shortcuts ?? [];
    expect(shortcuts.map((s) => s.url)).toEqual(['/video?source=pwa', '/renders']);
    expect(shortcuts.map((s) => s.name)).toEqual([copy.formats, copy.renders]);
    expect(shortcuts.map((s) => s.short_name)).toEqual([copy.formatsShort, copy.rendersShort]);
  });

  it('keeps one language: the Korean tagline under `lang: ko`', () => {
    expect(m.lang).toBe('ko');
    expect(m.description).toBe(getDictionary('ko').meta.tagline);
  });
});
