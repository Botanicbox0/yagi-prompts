import { randomUUID } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';
import { landingMediaSlot } from '@/lib/content/landing-media';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminOutcome } from './context';
import { sha256Hex } from './assets';
import * as f from './form';

/**
 * `/admin/landing-media` (lib/content/landing-media.ts): replace one landing image, or put the
 * default back. Admin-only through the one door like every operation (dispatcher + registry).
 *
 * The upload is re-encoded here whatever arrives: oriented, scaled down to the slot's useful width
 * (never up), WebP, metadata stripped. The editor already scales in the browser so a phone photo
 * fits under Vercel's request limit; this pass is what makes the stored file trustworthy either way.
 * The object is content-addressed in the public bucket, so the CDN URL never serves a stale image.
 */

/** Without the browser step (no JS, local), a camera original still fits. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const QUALITY = 82;

const missingTable = (error: unknown) => (error as { code?: string }).code === '42P01';
const tableMissing = (): AdminOutcome => fail('unknown', 'landing_media is missing: apply migrations 0067 and 0147 first');

function slotFrom(form: FormData): { ok: true; value: string } | { ok: false; detail: string } {
  const slot = f.str(form, 'slot');
  return landingMediaSlot(slot) ? { ok: true, value: slot } : { ok: false, detail: 'slot: not a landing media slot' };
}

const replaceLandingMedia: AdminOperation<{ slot: string; file: File }> = {
  parse(form) {
    const slot = slotFrom(form);
    if (!slot.ok) return slot;
    const file = f.file(form, 'file');
    if (file === null) return { ok: false, detail: 'file: choose an image' };
    return { ok: true, value: { slot: slot.value, file } };
  },
  async run(ctx, input) {
    const slot = landingMediaSlot(input.slot)!;
    if (input.file.size > MAX_UPLOAD_BYTES) return fail('upload', 'file: larger than 20 MB');
    if (input.file.type && !ACCEPTED.has(input.file.type)) return fail('upload', 'file: use a JPEG, PNG, WebP or AVIF image');

    let encoded: { data: Buffer; info: OutputInfo };
    try {
      encoded = await sharp(Buffer.from(await input.file.arrayBuffer()), { limitInputPixels: 64_000_000 })
        .rotate()
        .resize({ width: slot.width, withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 5, alphaQuality: 90 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      return fail('upload', 'file: not a readable image');
    }

    const bytes = new Uint8Array(encoded.data);
    const objectKey = `${sha256Hex(bytes)}.webp`;
    try {
      const staged = `content/landing/${randomUUID()}.webp`;
      await ctx.storage.putStaging(staged, bytes, 'image/webp');
      await ctx.storage.copy({ fromKey: staged, toBucket: 'public-content', toKey: objectKey });
    } catch (error) {
      console.error('[landing-media] store failed', error);
      return fail('storage', 'the image could not be stored');
    }

    try {
      await ctx.sql.query(
        `insert into landing_media (slot, object_key, mime, width, height, size_bytes, original_name, updated_by, updated_at)
         values ($1, $2, 'image/webp', $3, $4, $5, $6, (select id from profiles where id = $7::uuid), now())
         on conflict (slot) do update set object_key = excluded.object_key, mime = excluded.mime, width = excluded.width,
           height = excluded.height, size_bytes = excluded.size_bytes, original_name = excluded.original_name,
           updated_by = excluded.updated_by, updated_at = now()`,
        [input.slot, objectKey, encoded.info.width, encoded.info.height, bytes.byteLength, input.file.name.slice(0, 200) || null, ctx.viewer.userId],
      );
    } catch (error) {
      if (missingTable(error)) return tableMissing();
      throw error;
    }
    ctx.revalidateLandingMedia?.();
    return ok('saved', { detail: input.slot });
  },
};

const resetLandingMedia: AdminOperation<{ slot: string }> = {
  parse(form) {
    const slot = slotFrom(form);
    return slot.ok ? { ok: true, value: { slot: slot.value } } : slot;
  },
  async run(ctx, input) {
    try {
      await ctx.sql.query('delete from landing_media where slot = $1', [input.slot]);
    } catch (error) {
      if (missingTable(error)) return tableMissing();
      throw error;
    }
    ctx.revalidateLandingMedia?.();
    return ok('saved', { detail: input.slot });
  },
};

export const LANDING_MEDIA_OPERATIONS = {
  'landingMedia.replace': replaceLandingMedia,
  'landingMedia.reset': resetLandingMedia,
} as const;
