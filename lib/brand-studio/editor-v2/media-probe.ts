/**
 * Editing studio v2 — does a media file have a sound track (review round 1, item 10)?
 *
 * The export decodes each cut's sound with the browser. A file with no sound track decodes to nothing
 * and the cut is simply silent; a file that HAS a sound track the browser cannot decode must not become
 * silence without a word. So the fetched bytes are inspected first: MP4 / MOV boxes (a track whose
 * handler is `soun`), or a WebM / Matroska track of type 2 (audio). Anything else, or bytes that end or
 * lie mid-way, is `unknown`, and the export treats a failed decode of an unknown file as a warning too.
 * Pure: bytes in, an answer out.
 */
export type SoundTrack = 'yes' | 'no' | 'unknown';

const TOP_LEVEL = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'styp', 'sidx', 'moof', 'mfra', 'pdin', 'uuid', 'meta']);

const type4 = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
const u32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;

interface Box {
  type: string;
  /** First byte of the box's contents. */
  body: number;
  /** One past its last byte. */
  end: number;
}

/** The boxes between `start` and `end`, or `null` when one of them runs past `end` (cut off or broken). */
function boxes(bytes: Uint8Array, start: number, end: number): Box[] | null {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = u32(bytes, at);
    const type = type4(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return null;
      size = u32(bytes, at + 8) * 2 ** 32 + u32(bytes, at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return null;
    out.push({ type, body: at + header, end: at + size });
    at += size;
  }
  return out;
}

function mp4Sound(bytes: Uint8Array): SoundTrack {
  const top = boxes(bytes, 0, bytes.length);
  if (!top || top.length === 0 || !TOP_LEVEL.has(top[0]!.type)) return 'unknown';
  const moov = top.find((entry) => entry.type === 'moov');
  if (!moov) return 'unknown';
  const traks = boxes(bytes, moov.body, moov.end);
  if (!traks) return 'unknown';
  let readable = true;
  for (const trak of traks.filter((entry) => entry.type === 'trak')) {
    const mdia = boxes(bytes, trak.body, trak.end)?.find((entry) => entry.type === 'mdia');
    const hdlr = mdia ? boxes(bytes, mdia.body, mdia.end)?.find((entry) => entry.type === 'hdlr') : undefined;
    // version and flags (4 bytes), pre_defined (4 bytes), then the handler type.
    if (!hdlr || hdlr.body + 12 > hdlr.end) {
      readable = false;
      continue;
    }
    if (type4(bytes, hdlr.body + 8) === 'soun') return 'yes';
  }
  return readable ? 'no' : 'unknown';
}

const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const TRACKS = [0x16, 0x54, 0xae, 0x6b];
/** How far after the Tracks element its track entries are looked for. */
const TRACKS_SPAN = 64 * 1024;

function indexOf(bytes: Uint8Array, pattern: readonly number[], from = 0, to = bytes.length): number {
  outer: for (let i = from; i + pattern.length <= to; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

function webmSound(bytes: Uint8Array): SoundTrack {
  const tracks = indexOf(bytes, TRACKS);
  if (tracks < 0) return 'unknown';
  const end = Math.min(bytes.length, tracks + TRACKS_SPAN);
  // TrackType (0x83), one byte long (0x81): 1 video, 2 audio.
  if (indexOf(bytes, [0x83, 0x81, 0x02], tracks, end) >= 0) return 'yes';
  return indexOf(bytes, [0x83, 0x81, 0x01], tracks, end) >= 0 ? 'no' : 'unknown';
}

export function soundTrackOf(bytes: Uint8Array): SoundTrack {
  if (bytes.length < 8) return 'unknown';
  if (EBML.every((value, i) => bytes[i] === value)) return webmSound(bytes);
  return mp4Sound(bytes);
}
