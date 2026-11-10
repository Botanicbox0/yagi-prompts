/**
 * Reads the length and picture size of an MP4/MOV from its boxes (moov/mvhd, trak/tkhd), so the film
 * sheet is clamped to the real clip rather than to what the model believed. Pure, no dependencies.
 * Returns nulls for anything it cannot read; never throws.
 */

export interface VideoProbe {
  seconds: number | null;
  width: number | null;
  height: number | null;
}

interface Box {
  type: string;
  /** Start of the box's content (after the header). */
  body: number;
  end: number;
}

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      const big = view.getBigUint64(at + 8);
      if (big > BigInt(end - at)) return;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type, body: at + header, end: at + size };
    at += size;
  }
}

function child(view: DataView, parent: Box, type: string): Box | null {
  for (const b of boxes(view, parent.body, parent.end)) if (b.type === type) return b;
  return null;
}

function readMvhd(view: DataView, box: Box): number | null {
  const version = view.getUint8(box.body);
  const need = version === 1 ? 32 : 20;
  if (box.body + need > box.end) return null;
  const timescale = view.getUint32(box.body + (version === 1 ? 20 : 12));
  const duration =
    version === 1 ? Number(view.getBigUint64(box.body + 24)) : view.getUint32(box.body + 16);
  if (!timescale || !duration || duration === 0xffffffff) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) && seconds > 0 && seconds < 36_000 ? seconds : null;
}

function readTkhd(view: DataView, box: Box): { width: number; height: number } | null {
  const version = view.getUint8(box.body);
  // version/flags 4, times + id + reserved + duration (20 or 32), reserved 8, layer/group/volume/reserved 8
  const matrixAt = box.body + 4 + (version === 1 ? 32 : 20) + 16;
  if (matrixAt + 36 + 8 > box.end) return null;
  const a = view.getInt32(matrixAt);
  const d = view.getInt32(matrixAt + 16);
  let width = view.getUint32(matrixAt + 36) / 65536;
  let height = view.getUint32(matrixAt + 40) / 65536;
  if (!width || !height) return null;
  if (a === 0 && d === 0) [width, height] = [height, width]; // rotated a quarter turn
  return { width: Math.round(width), height: Math.round(height) };
}

function isVideoTrack(view: DataView, trak: Box): boolean {
  const mdia = child(view, trak, 'mdia');
  const hdlr = mdia ? child(view, mdia, 'hdlr') : null;
  if (!hdlr || hdlr.body + 12 > hdlr.end) return false;
  const at = hdlr.body + 8;
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)) === 'vide';
}

export function probeMp4(bytes: Uint8Array): VideoProbe {
  const none: VideoProbe = { seconds: null, width: null, height: null };
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const top of boxes(view, 0, bytes.byteLength)) {
      if (top.type !== 'moov') continue;
      const mvhd = child(view, top, 'mvhd');
      const seconds = mvhd ? readMvhd(view, mvhd) : null;
      let size: { width: number; height: number } | null = null;
      for (const trak of boxes(view, top.body, top.end)) {
        if (trak.type !== 'trak' || !isVideoTrack(view, trak)) continue;
        const tkhd = child(view, trak, 'tkhd');
        size = tkhd ? readTkhd(view, tkhd) : null;
        if (size) break;
      }
      return { seconds, width: size?.width ?? null, height: size?.height ?? null };
    }
    return none;
  } catch {
    return none;
  }
}

const NAMED_ASPECTS: ReadonlyArray<[string, number]> = [
  ['9:16', 9 / 16], ['2:3', 2 / 3], ['3:4', 3 / 4], ['4:5', 4 / 5], ['1:1', 1],
  ['5:4', 5 / 4], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['21:9', 21 / 9],
];

/** "9:16" for 1080×1920; the nearest common ratio within 3 %, else the reduced fraction. */
export function aspectLabel(width: number, height: number): string {
  const ratio = width / height;
  let best: [string, number] | null = null;
  for (const entry of NAMED_ASPECTS) {
    const off = Math.abs(Math.log(ratio / entry[1]));
    if (off < 0.03 && (!best || off < best[1])) best = [entry[0], off];
  }
  if (best) return best[0];
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / g}:${Math.round(height) / g}`;
}
