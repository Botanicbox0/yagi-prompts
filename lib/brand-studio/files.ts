/**
 * What an uploaded or generated file really is: magic bytes, size limits, image measurements and the
 * 512 px library thumbnail. `sharp` only (it runs inside a Vercel function).
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { STUDIO_LIMITS, STUDIO_UPLOAD_MIMES, type StudioAssetKind } from './contracts';
import { snapFps } from './review-frames';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The type the bytes say they are, among the types the studio accepts. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return 'audio/wav';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') return b.toString('latin1', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  if (b.length >= 3 && b.toString('latin1', 0, 3) === 'ID3') return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0) return 'audio/mpeg';
  return null;
}

export function kindOfMime(mime: string): StudioAssetKind | null {
  for (const kind of Object.keys(STUDIO_UPLOAD_MIMES) as StudioAssetKind[]) {
    if ((STUDIO_UPLOAD_MIMES[kind] as readonly string[]).includes(mime)) return kind;
  }
  return null;
}

export function bytesLimit(kind: StudioAssetKind): number {
  return kind === 'image' ? STUDIO_LIMITS.imageBytesMax : kind === 'video' ? STUDIO_LIMITS.videoBytesMax : STUDIO_LIMITS.audioBytesMax;
}

export type FileVerdict =
  | { ok: true; mime: string; kind: StudioAssetKind }
  | { ok: false; code: 'unsupported_file' | 'file_too_large' };

/**
 * The reserved type decides the kind; the bytes must be a type of that kind (an mp4 and a mov are
 * both video and may be told apart only by their bytes) and within the kind's size limit.
 */
export function checkUpload(bytes: Uint8Array, reserved: { mime: string; sizeBytes: number }): FileVerdict {
  const kind = kindOfMime(reserved.mime);
  if (!kind) return { ok: false, code: 'unsupported_file' };
  if (bytes.byteLength > bytesLimit(kind)) return { ok: false, code: 'file_too_large' };
  if (bytes.byteLength !== reserved.sizeBytes || bytes.byteLength === 0) return { ok: false, code: 'unsupported_file' };
  const actual = sniffMime(bytes);
  if (!actual || kindOfMime(actual) !== kind) return { ok: false, code: 'unsupported_file' };
  return { ok: true, mime: actual, kind };
}

/** Width and height as the decoder reads them (EXIF rotation applied). Null when it is not a picture. */
export async function imageInfo(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: 12_000 * 12_000 }).metadata();
    if (!meta.width || !meta.height) return null;
    const rotated = (meta.orientation ?? 1) >= 5;
    return rotated ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/**
 * Width, height and length of an MP4/MOV, read from its `moov` box (first track with a picture).
 * No decoding; null when the box is not where a plain file keeps it.
 */
export function videoInfo(bytes: Uint8Array): { width: number | null; height: number | null; durationMs: number | null } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = b.indexOf('moov', 0, 'latin1');
  if (moov < 4) return null;
  const size = b.readUInt32BE(moov - 4);
  const end = size >= 8 ? Math.min(b.length, moov - 4 + size) : b.length;
  let durationMs: number | null = null;
  const mvhd = b.indexOf('mvhd', moov, 'latin1');
  if (mvhd > 0 && mvhd + 32 <= end) {
    const v1 = b[mvhd + 4] === 1;
    const scale = b.readUInt32BE(mvhd + (v1 ? 24 : 16));
    const duration = v1 ? Number(b.readBigUInt64BE(mvhd + 28)) : b.readUInt32BE(mvhd + 20);
    if (scale > 0) durationMs = Math.round((duration / scale) * 1000);
  }
  let width: number | null = null, height: number | null = null;
  for (let at = b.indexOf('tkhd', moov, 'latin1'); at > 0 && at + 12 <= end; at = b.indexOf('tkhd', at + 4, 'latin1')) {
    const offset = b[at + 4] === 1 ? 92 : 80;
    if (at + offset + 8 > end) break;
    const w = b.readUInt32BE(at + offset) >>> 16, h = b.readUInt32BE(at + offset + 4) >>> 16;
    if (w > 0 && h > 0) {
      width = w;
      height = h;
      break;
    }
  }
  return { width, height, durationMs };
}

interface Mp4Box {
  type: string;
  /** Where the box starts, where its contents start, and where it ends (exclusive). */
  start: number;
  body: number;
  end: number;
}

/** The boxes laid one after another in [start, end). Stops at the first one that does not fit (a cut file). */
function boxesIn(b: Buffer, start: number, end: number): Mp4Box[] {
  const found: Mp4Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const large = b.readBigUInt64BE(at + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    found.push({ type, start: at, body: at + header, end: at + size });
    at += size;
  }
  return found;
}

const childBox = (b: Buffer, parent: Mp4Box | null, type: string): Mp4Box | null =>
  parent ? (boxesIn(b, parent.body, parent.end).find((box) => box.type === type) ?? null) : null;

/**
 * The picture track's average frame rate from an MP4/MOV, snapped to a common rate (review-frames.ts), or
 * null. It walks the box tree from the top (so `moov` at the end of the file is found, and the word "moov"
 * inside the picture data is not), takes the first track whose handler is `vide`, and divides its sample
 * count by its length in `mdhd` time units (`stts`). A fragmented file (`mvex`: samples live in fragments)
 * or anything unreadable gives null; the player then measures the rate itself.
 */
export function videoFrameRate(bytes: Uint8Array): number | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = boxesIn(b, 0, b.length).find((box) => box.type === 'moov');
  if (!moov || childBox(b, moov, 'mvex')) return null;
  for (const trak of boxesIn(b, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = childBox(b, trak, 'mdia');
    const hdlr = childBox(b, mdia, 'hdlr');
    // hdlr: version and flags (4), pre_defined (4), handler type (4).
    if (!hdlr || hdlr.body + 12 > hdlr.end || b.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'vide') continue;
    const mdhd = childBox(b, mdia, 'mdhd');
    if (!mdhd || mdhd.body + 24 > mdhd.end) return null;
    // mdhd v0: version+flags (4), created (4), modified (4), timescale (4); v1: the two times are 8 bytes each.
    const timescale = b[mdhd.body] === 1 ? (mdhd.body + 24 <= mdhd.end ? b.readUInt32BE(mdhd.body + 20) : 0) : b.readUInt32BE(mdhd.body + 12);
    const stts = childBox(b, childBox(b, childBox(b, mdia, 'minf'), 'stbl'), 'stts');
    if (!timescale || !stts || stts.body + 8 > stts.end) return null;
    const entries = b.readUInt32BE(stts.body + 4);
    if (entries === 0 || stts.body + 8 + entries * 8 > stts.end) return null;
    let samples = 0;
    let ticks = 0;
    for (let i = 0; i < entries; i += 1) {
      const count = b.readUInt32BE(stts.body + 8 + i * 8);
      const delta = b.readUInt32BE(stts.body + 12 + i * 8);
      samples += count;
      ticks += count * delta;
    }
    // One picture is a still, not a film; nothing to step through.
    if (samples < 2 || ticks <= 0) return null;
    return snapFps((samples * timescale) / ticks);
  }
  return null;
}

/** The library grid still: webp, longest side `side` px, never enlarged. */
export async function thumbnailWebp(bytes: Uint8Array, side = 512): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(bytes, { limitInputPixels: 12_000 * 12_000 })
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(),
  );
}
