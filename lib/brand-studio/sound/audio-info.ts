/**
 * The length of a stored audio result (docs/BRAND-SOUND-STUDIO.md §7.2 `duration_ms`), read from the file
 * itself so a result never shows a length the engine merely claimed. WAV from its header; MP3 from the Xing /
 * Info frame count when present, else from the first frame's bit rate (constant bit rate). Null when the
 * bytes say nothing usable; the caller then keeps the engine's reported length.
 */
const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function wavSeconds(b: Buffer): number | null {
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= b.length) {
    const id = b.toString('latin1', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ' && at + 16 <= b.length) byteRate = b.readUInt32LE(at + 16);
    if (id === 'data') return byteRate > 0 ? Math.min(size, b.length - at - 8) / byteRate : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

function id3Size(b: Buffer): number {
  if (b.length < 10 || b.toString('latin1', 0, 3) !== 'ID3') return 0;
  return 10 + ((b[6]! & 0x7f) << 21) + ((b[7]! & 0x7f) << 14) + ((b[8]! & 0x7f) << 7) + (b[9]! & 0x7f);
}

function mp3Seconds(b: Buffer): number | null {
  let at = id3Size(b);
  while (at + 4 <= b.length && !(b[at] === 0xff && (b[at + 1]! & 0xe0) === 0xe0)) at += 1;
  if (at + 4 > b.length) return null;
  const version = (b[at + 1]! >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[at + 1]! >> 1) & 0x03; // 1 = Layer III
  const bitrateIndex = b[at + 2]! >> 4;
  const rateIndex = (b[at + 2]! >> 2) & 0x03;
  const mono = b[at + 3]! >> 6 === 3;
  const rates = SAMPLE_RATES[version];
  if (layer !== 1 || !rates || rateIndex > 2 || version === 1) return null;
  const sampleRate = rates[rateIndex]!;
  const samplesPerFrame = version === 3 ? 1152 : 576;
  // Xing / Info header: the side info sits after the 4-byte header (MPEG1 32/17, MPEG2 17/9 bytes).
  const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const tag = at + 4 + side;
  if (tag + 12 <= b.length) {
    const name = b.toString('latin1', tag, tag + 4);
    if ((name === 'Xing' || name === 'Info') && b.readUInt32BE(tag + 4) & 0x1) {
      const frames = b.readUInt32BE(tag + 8);
      if (frames > 0) return (frames * samplesPerFrame) / sampleRate;
    }
  }
  const kbps = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[bitrateIndex] ?? 0;
  return kbps > 0 ? ((b.length - at) * 8) / (kbps * 1000) : null;
}

/** Seconds of audio in `bytes`, or null when unknown. */
export function audioSeconds(bytes: Uint8Array, mime: string | null): number | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seconds = mime === 'audio/wav' ? wavSeconds(b) : mime === 'audio/mpeg' ? mp3Seconds(b) : null;
  return seconds !== null && Number.isFinite(seconds) && seconds > 0 && seconds < 3600 ? seconds : null;
}
