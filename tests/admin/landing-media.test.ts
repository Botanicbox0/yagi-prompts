import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { adminHarness, expectOk, viewerOf, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';
import { landingMediaMap, loadLandingMediaRows } from '@/lib/content/landing-media-repo';
import { mediaSrc } from '@/lib/content/landing-media';

/** lib/content/landing-media.ts — replacing a landing image through the one admin door. */

async function png(width: number, height: number, alpha = false): Promise<File> {
  const bytes = await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 40, b: 40, alpha: 0.5 } : { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], 'campaign shot.png', { type: 'image/png' });
}

let harness: AdminHarness;
beforeEach(async () => { harness = await adminHarness(); });
afterEach(async () => { await harness.close(); });

describe('landingMedia.replace', () => {
  it('re-encodes the upload to WebP at the slot width, stores it publicly and refreshes the landings', async () => {
    const outcome = expectOk(await harness.run('landingMedia.replace', { slot: 'landing/hero-shot', file: await png(2400, 3000) }));
    expect(outcome.detail).toBe('landing/hero-shot');
    expect(harness.landingMediaRevalidated).toBe(1);

    const [row] = await loadLandingMediaRows(runner(harness.db));
    expect(row).toMatchObject({ slot: 'landing/hero-shot', mime: 'image/webp', width: 900, height: 1125, originalName: 'campaign shot.png' });
    expect(row!.objectKey).toMatch(/^[0-9a-f]{64}\.webp$/);
    const stored = await harness.storage.read('public-content', row!.objectKey);
    expect((await sharp(stored).metadata()).format).toBe('webp');

    // The page resolves the slot to the override; local mode serves it from the same-origin route.
    const media = landingMediaMap([row!], '');
    expect(mediaSrc(media, 'landing/hero-shot')).toBe(`/api/landing-media/landing/hero-shot?v=${row!.objectKey.slice(0, 12)}`);
    expect(mediaSrc(media, 'landing/hero-texture')).toBe('/reel/landing/hero-texture.webp');
    // On a Supabase project the page links the public bucket directly.
    expect(landingMediaMap([row!], 'https://abc.supabase.co')['landing/hero-shot']).toBe(`https://abc.supabase.co/storage/v1/object/public/public-content/${row!.objectKey}`);
  });

  it('never enlarges, keeps transparency and replaces an earlier override in place', async () => {
    expectOk(await harness.run('landingMedia.replace', { slot: 'landing/pk-parfum', file: await png(300, 400, true) }));
    expectOk(await harness.run('landingMedia.replace', { slot: 'landing/pk-parfum', file: await png(260, 380, true) }));
    const rows = await loadLandingMediaRows(runner(harness.db));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ width: 260, height: 380 });
    const meta = await sharp(await harness.storage.read('public-content', rows[0]!.objectKey)).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('refuses slots the registry does not name, missing files and things that are not images', async () => {
    expect(await harness.run('landingMedia.replace', { slot: 'landing/nope', file: await png(10, 10) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await harness.run('landingMedia.replace', { slot: '../etc/passwd', file: await png(10, 10) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await harness.run('landingMedia.replace', { slot: 'landing/sc-balm' })).toMatchObject({ ok: false, code: 'invalid' });
    const text = new File([new TextEncoder().encode('not an image')], 'x.png', { type: 'image/png' });
    expect(await harness.run('landingMedia.replace', { slot: 'landing/sc-balm', file: text })).toMatchObject({ ok: false, code: 'upload' });
    const pdf = new File([new TextEncoder().encode('%PDF-1.4')], 'x.pdf', { type: 'application/pdf' });
    expect(await harness.run('landingMedia.replace', { slot: 'landing/sc-balm', file: pdf })).toMatchObject({ ok: false, code: 'upload' });
    expect(await loadLandingMediaRows(runner(harness.db))).toEqual([]);
    expect(harness.landingMediaRevalidated).toBe(0);
  });

  it('is admin-only', async () => {
    const outcome = await harness.run('landingMedia.replace', { slot: 'landing/sc-balm', file: await png(10, 10) }, viewerOf('free'));
    expect(outcome).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('landingMedia.reset', () => {
  it('puts the original file back and refreshes the landings', async () => {
    expectOk(await harness.run('landingMedia.replace', { slot: 'landing/c-logo-ours', file: await png(600, 1066) }));
    expectOk(await harness.run('landingMedia.reset', { slot: 'landing/c-logo-ours' }));
    expect(await loadLandingMediaRows(runner(harness.db))).toEqual([]);
    expect(harness.landingMediaRevalidated).toBe(2);
    expect(await harness.run('landingMedia.reset', { slot: 'c-logo-ours' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});
