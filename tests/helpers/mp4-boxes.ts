/**
 * Small MP4/MOV files built byte by byte for the frame-rate probe (lib/brand-studio/files.ts `videoFrameRate`):
 * ftyp, picture data that itself contains the word "moov", and a moov with tracks whose `mdhd` gives the time
 * scale and whose `stts` gives the samples. No binary fixtures.
 */
const ascii = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return Uint8Array.from(b);
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return Uint8Array.from(b);
};
const cat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts.map((p) => Buffer.from(p))));
export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = cat(...payload);
  return cat(u32(8 + body.byteLength), ascii(type), body);
}
/** A box written with the 64-bit size form. */
function largeBox(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = cat(...payload);
  return cat(u32(1), ascii(type), u64(16 + body.byteLength), body);
}
const mdhd = (timescale: number, version: 0 | 1 = 0) =>
  version === 1
    ? box('mdhd', Uint8Array.of(1, 0, 0, 0), u64(0), u64(0), u32(timescale), u64(0), u32(0))
    : box('mdhd', Uint8Array.of(0, 0, 0, 0), u32(0), u32(0), u32(timescale), u32(0), u32(0));
const hdlr = (handler: string) => box('hdlr', u32(0), u32(0), ascii(handler), new Uint8Array(12), Uint8Array.of(0));
const stts = (entries: Array<[number, number]>) => box('stts', u32(0), u32(entries.length), ...entries.flatMap(([count, delta]) => [u32(count), u32(delta)]));
export const track = (handler: string, timescale: number, entries: Array<[number, number]>, version: 0 | 1 = 0) =>
  box('trak', box('tkhd', new Uint8Array(84)), box('mdia', mdhd(timescale, version), hdlr(handler), box('minf', box('stbl', stts(entries)))));

export function mp4(options: { tracks: Uint8Array[]; moovAtEnd?: boolean; fragmented?: boolean; largeMdat?: boolean }): Uint8Array {
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isomiso2avc1mp41'));
  // The picture data says "moov" too: the probe must walk boxes, not search for the word.
  const payload = cat(ascii('....moov....trak....mdhd'), new Uint8Array(64));
  const mdat = options.largeMdat ? largeBox('mdat', payload) : box('mdat', payload);
  const moov = box('moov', box('mvhd', new Uint8Array(100)), ...options.tracks, ...(options.fragmented ? [box('mvex', box('trex', new Uint8Array(24)))] : []));
  return options.moovAtEnd ? cat(ftyp, mdat, moov) : cat(ftyp, moov, mdat);
}

