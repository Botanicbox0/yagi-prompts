/**
 * Decoding with one normalisation for every input: EXIF orientation applied, sRGB, 8 bits per
 * channel, RGBA. CMYK, greyscale, 16-bit and palette files all arrive in this shape, so "the same
 * pixel as the original" has one meaning across crop, composite and tests.
 */
import sharp from 'sharp';

export const SHARP_INPUT = { failOn: 'error', limitInputPixels: 100_000_000 } as const;

export interface RgbaImage {
  data: Buffer;
  width: number;
  height: number;
  /** Whether the source had an alpha channel (the output keeps one only then). */
  hasAlpha: boolean;
}

export async function decodeRgba(bytes: Uint8Array): Promise<RgbaImage> {
  const meta = await sharp(bytes, SHARP_INPUT).metadata();
  const { data, info } = await sharp(bytes, SHARP_INPUT)
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('region_decode_channels');
  return { data, width: info.width, height: info.height, hasAlpha: Boolean(meta.hasAlpha) };
}

/** Upright size of a picture (EXIF orientation applied), for `planRegion`. */
export async function measureImage(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes, SHARP_INPUT).metadata();
  if (!meta.width || !meta.height) throw new Error('region_measure');
  const turned = (meta.orientation ?? 1) >= 5;
  return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** PNG from an RGBA buffer, dropping alpha when the source had none. */
export async function encodePng(image: RgbaImage): Promise<Buffer> {
  const pipeline = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
  return (image.hasAlpha ? pipeline : pipeline.removeAlpha()).png({ compressionLevel: 6 }).toBuffer();
}
