import sharp from 'sharp';

export const SOCIAL_EVIDENCE_MAX_BYTES = 5_000_000;
export const SOCIAL_EVIDENCE_MAX_SIDE = 1600;
const MIN_SIDE = 200;

/** Render-store key of an account's one screenshot; re-submitting overwrites it. */
export const socialEvidenceKey = (id: string) => `social/${id}/evidence.jpg`;

/**
 * A follower screenshot as the private bucket keeps it: JPEG or PNG in, one still JPEG out, EXIF
 * orientation applied and every other byte of metadata (location, device) dropped, the long side
 * at most 1600px. Animated or tiny images are refused.
 */
export async function cleanEvidence(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (!['image/png', 'image/jpeg'].includes(mime) || !bytes.length || bytes.length > SOCIAL_EVIDENCE_MAX_BYTES) throw Error('bad_photo');
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['png', 'jpeg'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1 || !meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE) throw Error('bad_photo');
    const data = await image
      .rotate()
      .resize({ width: SOCIAL_EVIDENCE_MAX_SIDE, height: SOCIAL_EVIDENCE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return new Uint8Array(data);
  } catch {
    throw Error('bad_photo');
  }
}
