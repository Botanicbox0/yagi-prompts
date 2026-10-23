import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { loadOwnRender } from './service';
import { loadRenderExtras, posterKeyFor, recordRenderPoster } from './extras';
import type { RenderStore } from './store';

/**
 * The film's own share frame (TEMPLATES-IA §12 "공유 카드": their frame + make yours). Vercel
 * functions have no ffmpeg, so the owner's browser draws one frame of the finished film onto a
 * canvas (`components/renders/frame-capture.ts`) and sends the JPEG here. The server never trusts
 * those bytes as they came: `sharp` decodes them, caps the long edge, re-encodes and drops every
 * metadata block, then stores `{renderId}/poster.jpg` in the private `renders` bucket. First frame
 * wins.
 */

/** What the browser may send; the capture util aims under this. */
export const POSTER_MAX_BYTES = 300_000;
export const POSTER_MAX_EDGE = 1080;
/** A frame is never bigger than this many pixels before resizing (a forged 30k×30k JPEG stays out). */
const POSTER_MAX_INPUT_PIXELS = 4096 * 4096;

export type PosterOutcome =
  | { ok: true; stored: boolean }
  | { ok: false; code: 'sign_in_required' | 'not_found' | 'not_ready' | 'bad_image' | 'unavailable' };

/** Decode, bound, re-encode. Throws on anything that is not a JPEG frame. */
export async function cleanPoster(bytes: Uint8Array): Promise<Uint8Array> {
  const image = sharp(bytes, { limitInputPixels: POSTER_MAX_INPUT_PIXELS, failOn: 'error' });
  const meta = await image.metadata();
  if (meta.format !== 'jpeg' || !meta.width || !meta.height) throw new Error('not a jpeg frame');
  // sharp writes no EXIF/ICC/XMP unless asked (`withMetadata`), so the output carries pixels only.
  const out = await image
    .resize({ width: POSTER_MAX_EDGE, height: POSTER_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(out);
}

export async function savePosterFrame(deps: { sql: SqlRunner; store: RenderStore }, viewer: Viewer, renderId: string, bytes: Uint8Array): Promise<PosterOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const view = await loadOwnRender(deps.sql, viewer, renderId);
  if (view === null) return { ok: false, code: 'not_found' };
  const { job } = view;
  if (job.status !== 'succeeded' || !job.resultMime?.startsWith('video/')) return { ok: false, code: 'not_ready' };
  const extras = await loadRenderExtras(deps.sql, job.id);
  if (!extras.ready) return { ok: false, code: 'unavailable' };
  if (extras.posterKey !== null) return { ok: true, stored: false };

  let clean: Uint8Array;
  try {
    clean = await cleanPoster(bytes);
  } catch {
    return { ok: false, code: 'bad_image' };
  }
  const key = posterKeyFor(job.id);
  await deps.store.put(key, clean, 'image/jpeg');
  try {
    return { ok: true, stored: await recordRenderPoster(deps.sql, job.id, key) };
  } catch {
    // 0055 not applied yet: nothing points at the object, so it does not stay behind either.
    if (deps.store.delete) await deps.store.delete(key).catch(() => undefined);
    return { ok: false, code: 'unavailable' };
  }
}
