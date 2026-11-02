import sharp from 'sharp';

export const SELFIE_MAX_BYTES = 3_000_000;
export const SELFIE_MIN_SIDE = 256;
export const SELFIE_MAX_SIDE = 1600;

/**
 * Decode the whole selfie, reject animated/oversized input, apply the EXIF orientation and strip
 * every other byte of metadata. The face is never cropped, warped or resized up — only downscaled
 * to fit SELFIE_MAX_SIDE so the private bucket holds what the engines actually receive.
 */
export async function cleanSelfie(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || !bytes.length || bytes.length > SELFIE_MAX_BYTES) throw Error('bad_photo');
  const image = sharp(bytes, { limitInputPixels: 36_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1 || !meta.width || !meta.height || Math.min(meta.width, meta.height) < SELFIE_MIN_SIDE) throw Error('bad_photo');
  const { data, info } = await image.rotate().resize({ width: SELFIE_MAX_SIDE, height: SELFIE_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height };
}
