import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRenderJob } from '@/lib/renders/service';
import { loadRenderExtras } from '@/lib/renders/extras';
import { POSTER_MAX_EDGE, savePosterFrame } from '@/lib/renders/poster';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * The film's share frame (lib/renders/poster.ts): owner only, finished films only, re-encoded with
 * no metadata and a capped long edge, first frame wins, and a database without 0055 stores nothing.
 */

const VIDEO_TEMPLATE = 'neon-alley-dolly';
const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mime: 'image/jpeg' };

async function frame(width = 2000, height = 1200): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#2f6fd6' } })
    .jpeg({ quality: 90 })
    .withMetadata({ exif: { IFD0: { Copyright: 'someone', Artist: 'gps-and-all' } } })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe('the share frame', () => {
  let h: PromptHarness;
  let store: RenderStore;
  let root: string;
  let id: string;

  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-poster-'));
    store = createLocalRenderStore(root);
    const created = await createRenderJob({ sql: h.sql, store, mode: 'liveness' }, ADMIN_VIEWER, { templateSlug: VIDEO_TEMPLATE, aspect: '9:16', photo: PHOTO, locale: 'ko', holdForIdentity: true });
    if (!created.ok) throw new Error(created.code);
    id = created.id;
    await h.sql.query(`update render_jobs set status = 'succeeded', result_key = $2, result_mime = 'video/mp4', share_token = $3, share_expires_at = now() + interval '3 days', finished_at = now() where id = $1`, [id, `${id}/result.mp4`, 'a'.repeat(43)]);
  });
  afterEach(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  const save = (bytes: Uint8Array, viewer = ADMIN_VIEWER) => savePosterFrame({ sql: h.sql, store }, viewer, id, bytes);

  it('re-encodes the frame without its metadata, caps the long edge, and records the key once', async () => {
    expect(await save(await frame())).toEqual({ ok: true, stored: true });
    const extras = await loadRenderExtras(h.sql, id);
    expect(extras.posterKey).toBe(`${id}/poster.jpg`);
    const stored = await store.read(`${id}/poster.jpg`);
    const meta = await sharp(stored).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: POSTER_MAX_EDGE, height: 648 });
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(stored).includes(Buffer.from('gps-and-all'))).toBe(false);

    // First frame wins: a second capture changes nothing.
    expect(await save(await frame(800, 600))).toEqual({ ok: true, stored: false });
    expect((await sharp(await store.read(`${id}/poster.jpg`)).metadata()).width).toBe(POSTER_MAX_EDGE);
  });

  it('is the owner’s alone, and only for a finished film', async () => {
    expect(await save(await frame(), viewerOf('anon'))).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await save(await frame(), viewerOf('free'))).toEqual({ ok: false, code: 'not_found' });
    await h.sql.query(`update render_jobs set status = 'running' where id = $1`, [id]);
    expect(await save(await frame())).toEqual({ ok: false, code: 'not_ready' });
    await h.sql.query(`update render_jobs set status = 'succeeded', result_mime = 'image/png' where id = $1`, [id]);
    expect(await save(await frame())).toEqual({ ok: false, code: 'not_ready' });
    expect((await loadRenderExtras(h.sql, id)).posterKey).toBeNull();
  });

  it('refuses bytes that are not a JPEG frame', async () => {
    expect(await save(new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, code: 'bad_image' });
    const png = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer());
    expect(await save(png)).toEqual({ ok: false, code: 'bad_image' });
    expect((await loadRenderExtras(h.sql, id)).posterKey).toBeNull();
  });

  it('stores nothing on a database without 0055', async () => {
    await h.sql.query('alter table render_jobs drop column finishing_at, drop column poster_key');
    expect(await save(await frame())).toEqual({ ok: false, code: 'unavailable' });
    await expect(store.read(`${id}/poster.jpg`)).rejects.toThrow();
  });
});
