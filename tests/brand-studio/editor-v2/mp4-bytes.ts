/**
 * Builds small MP4 / MOV byte strings for the container reader's tests (lib/brand-studio/editor-v2/
 * container.ts): only the boxes the reader looks at, with sample tables written from plain lists. No
 * media data: the reader never decodes.
 */
const enc = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function u32(value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0);
  return b;
}

export function i32(value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, value);
  return b;
}

export function u64(value: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(value));
  return b;
}

export function i64(value: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(value));
  return b;
}

const u16 = (value: number) => Uint8Array.of((value >> 8) & 0xff, value & 0xff);

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32(8 + body.length), enc(type), body);
}

export function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, Uint8Array.of(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...payload);
}

/** One run-length table: `[count, value]` pairs. */
type Runs = ReadonlyArray<readonly [number, number]>;

/** Run-length pairs from a plain list. */
export function runs(values: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const value of values) {
    const last = out[out.length - 1];
    if (last && last[1] === value) last[0] += 1;
    else out.push([1, value]);
  }
  return out;
}

export interface EditSpec {
  /** Movie time scale units; `0` = to the end. */
  duration: number;
  /** Media time scale units; `-1` = an empty edit. */
  mediaTime: number;
  /** Media rate, `1` unless testing a refusal. */
  rate?: number;
}

export interface TrackSpec {
  handler: 'vide' | 'soun';
  timescale: number;
  /** Decode durations, one per sample (stts). Empty for a fragmented track. */
  durations: readonly number[];
  /** Composition offsets (ctts), one per sample; omitted when none. */
  offsets?: readonly number[];
  /** `ctts` version: 1 allows negative offsets. */
  cttsVersion?: 0 | 1;
  edits?: readonly EditSpec[];
  /** Write `mdhd` / `elst` as version 1 (64-bit). */
  wide?: boolean;
  /** Sample sizes (`stsz`); 100 bytes each when omitted. */
  sizes?: readonly number[];
  /** Write the sizes as `stz2` with this field size instead of `stsz`. */
  stz2?: 4 | 8 | 16;
  /** Chunk tables: samples per chunk (one `stsc` row each, merged when equal) and each chunk's file offset. */
  chunks?: { perChunk: readonly number[]; offsets: readonly number[]; co64?: boolean };
  /** Sync samples (`stss`, 1-based numbers); every sample is one when omitted. */
  sync?: readonly number[];
  /** The `stsd` entry (one sample entry box); none when omitted. */
  entry?: Uint8Array;
  /** The `tkhd` matrix `a b u c d v x y w`; the identity when omitted. */
  matrix?: readonly number[];
}

/** The identity display matrix (16.16 for a b c d x y, 2.30 for u v w). */
export const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000] as const;

/** A VisualSampleEntry: 78 bytes of fields (width and height among them), then its child boxes. */
export function visualEntry(type: string, width: number, height: number, ...kids: Uint8Array[]): Uint8Array {
  const fields = new Uint8Array(78);
  const view = new DataView(fields.buffer);
  view.setUint16(6, 1); // data_reference_index
  view.setUint16(24, width);
  view.setUint16(26, height);
  view.setUint32(28, 0x00480000);
  view.setUint32(32, 0x00480000);
  view.setUint16(40, 1); // frame_count
  view.setUint16(74, 0x18); // depth
  view.setInt16(76, -1);
  return box(type, fields, ...kids);
}

export const avcC = (profile: number, compat: number, level: number) => box('avcC', Uint8Array.of(1, profile, compat, level, 0xff, 0xe1, 0, 4, 0x67, profile, compat, level, 1, 0, 2, 0x68, 0xce));

/** An `hvcC` record's first 13 bytes (what the codec string is made of) and an empty array list. */
export function hvcC(head: number, compat: number, constraints: readonly number[], level: number): Uint8Array {
  const body = new Uint8Array(23);
  body[0] = 1;
  body[1] = head;
  new DataView(body.buffer).setUint32(2, compat >>> 0);
  body.set(constraints.slice(0, 6), 6);
  body[12] = level;
  body[22] = 0; // numOfArrays
  return box('hvcC', body);
}

export const vpcC = (profile: number, level: number, depth: number, chroma: number, full: 0 | 1, primaries: number, transfer: number, matrix: number) =>
  fullBox('vpcC', 1, 0, Uint8Array.of(profile, level, (depth << 4) | (chroma << 1) | full, primaries, transfer, matrix, 0, 0));

export const av1C = (profile: number, level: number, tier: 0 | 1, depth: 8 | 10 | 12) =>
  box('av1C', Uint8Array.of(0x81, (profile << 5) | level, (tier << 7) | (depth > 8 ? 0x40 : 0) | (depth === 12 ? 0x20 : 0) | 0x0c, 0));

export const pasp = (h: number, v: number) => box('pasp', u32(h), u32(v));

export const clap = (width: number, height: number, xOff = 0, yOff = 0) => box('clap', u32(width), u32(1), u32(height), u32(1), i32(xOff), u32(1), i32(yOff), u32(1));

export const nclx = (primaries: number, transfer: number, matrix: number, full: boolean) =>
  box('colr', enc('nclx'), u16(primaries), u16(transfer), u16(matrix), Uint8Array.of(full ? 0x80 : 0));

function sampleTables(spec: TrackSpec): Uint8Array[] {
  const count = spec.durations.length;
  const sizes = spec.sizes ?? spec.durations.map(() => 100);
  const out: Uint8Array[] = [];
  if (spec.stz2) {
    const field = spec.stz2;
    const packed = new Uint8Array(Math.ceil((count * field) / 8));
    sizes.forEach((size, i) => {
      if (field === 16) packed.set([(size >> 8) & 0xff, size & 0xff], i * 2);
      else if (field === 8) packed[i] = size;
      else packed[i >> 1] = (packed[i >> 1] ?? 0) | (i % 2 === 0 ? size << 4 : size);
    });
    out.push(fullBox('stz2', 0, 0, Uint8Array.of(0, 0, 0, field), u32(count), packed));
  } else {
    out.push(fullBox('stsz', 0, 0, u32(0), u32(count), ...sizes.map((size) => u32(size))));
  }
  if (spec.chunks) {
    const rows = runs(spec.chunks.perChunk);
    let chunk = 1;
    const stscRows: Uint8Array[] = [];
    for (const [n, per] of rows) {
      stscRows.push(u32(chunk), u32(per), u32(1));
      chunk += n;
    }
    out.push(fullBox('stsc', 0, 0, u32(rows.length), ...stscRows));
    out.push(
      spec.chunks.co64
        ? fullBox('co64', 0, 0, u32(spec.chunks.offsets.length), ...spec.chunks.offsets.map((offset) => u64(offset)))
        : fullBox('stco', 0, 0, u32(spec.chunks.offsets.length), ...spec.chunks.offsets.map((offset) => u32(offset))),
    );
  }
  if (spec.sync) out.push(fullBox('stss', 0, 0, u32(spec.sync.length), ...spec.sync.map((n) => u32(n))));
  return out;
}

function elst(edits: readonly EditSpec[], wide: boolean): Uint8Array {
  const rows = edits.map((edit) =>
    wide
      ? concat(u64(edit.duration), i64(edit.mediaTime), u16(edit.rate ?? 1), u16(0))
      : concat(u32(edit.duration), i32(edit.mediaTime), u16(edit.rate ?? 1), u16(0)),
  );
  return box('edts', fullBox('elst', wide ? 1 : 0, 0, u32(edits.length), ...rows));
}

export function trak(id: number, spec: TrackSpec): Uint8Array {
  const wide = spec.wide ?? false;
  const total = spec.durations.reduce((a, b) => a + b, 0);
  const mdhd = wide
    ? fullBox('mdhd', 1, 0, u64(0), u64(0), u32(spec.timescale), u64(total), u16(0x55c4), u16(0))
    : fullBox('mdhd', 0, 0, u32(0), u32(0), u32(spec.timescale), u32(total), u16(0x55c4), u16(0));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), enc(spec.handler), u32(0), u32(0), u32(0), enc('handler\0'));
  const sttsRuns: Runs = runs(spec.durations);
  const stts = fullBox('stts', 0, 0, u32(sttsRuns.length), ...sttsRuns.flatMap(([n, d]) => [u32(n), u32(d)]));
  const parts = [spec.entry ? fullBox('stsd', 0, 0, u32(1), spec.entry) : fullBox('stsd', 0, 0, u32(0)), stts];
  if (spec.offsets) {
    const version = spec.cttsVersion ?? 0;
    const cttsRuns: Runs = runs(spec.offsets);
    parts.push(fullBox('ctts', version, 0, u32(cttsRuns.length), ...cttsRuns.flatMap(([n, o]) => [u32(n), version === 1 ? i32(o) : u32(o)])));
  }
  parts.push(...sampleTables(spec));
  const stbl = box('stbl', ...parts);
  const minf = box('minf', box(spec.handler === 'vide' ? 'vmhd' : 'smhd'), stbl);
  // reserved (8), layer, alternate group, volume, reserved (8), the matrix (36), width and height (8).
  const matrix = concat(...(spec.matrix ?? IDENTITY).map((value) => i32(value)));
  const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(0), new Uint8Array(16), matrix, new Uint8Array(8));
  return box('trak', tkhd, ...(spec.edits ? [elst(spec.edits, wide)] : []), box('mdia', mdhd, hdlr, minf));
}

export interface MovieSpec {
  /** Movie time scale (mvhd); the edit lists' durations count in it. */
  timescale?: number;
  tracks: readonly TrackSpec[];
  /** Fragmented: an `mvex` with one `trex` per track (default duration per track id). */
  fragmented?: { defaultDuration: Readonly<Record<number, number>> };
}

export function moov(spec: MovieSpec): Uint8Array {
  const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(spec.timescale ?? 1000), u32(0), new Uint8Array(80));
  const traks = spec.tracks.map((track, i) => trak(i + 1, track));
  const mvex = spec.fragmented
    ? [
        box(
          'mvex',
          ...spec.tracks.map((_, i) => fullBox('trex', 0, 0, u32(i + 1), u32(1), u32(spec.fragmented!.defaultDuration[i + 1] ?? 0), u32(0), u32(0))),
        ),
      ]
    : [];
  return box('moov', mvhd, ...traks, ...mvex);
}

export interface FragmentTrack {
  trackId: number;
  /** `tfdt` base decode time; omitted = continue from the previous fragment. */
  base?: number;
  /** Per-sample durations in the `trun`; omitted = the `tfhd` default (`defaultDuration`) or the `trex` one. */
  durations?: readonly number[];
  count: number;
  defaultDuration?: number;
  offsets?: readonly number[];
  trunVersion?: 0 | 1;
  /** Write `tfdt` as version 1 (64-bit). */
  wide?: boolean;
  /** Sample sizes in the `trun` (100 each when omitted). */
  sizes?: readonly number[];
  /** Per-sample flags in the `trun`; omitted = none written (the `tfhd` / `trex` default applies). */
  flags?: readonly number[];
  /** `first_sample_flags` in the `trun`. */
  firstFlags?: number;
  /** `tfhd` default sample flags. */
  defaultFlags?: number;
  /** The `trun` data offset (from the base). */
  dataOffset?: number;
  /** An explicit `base_data_offset` instead of `default-base-is-moof`. */
  baseDataOffset?: number;
}

/** A sample that is not a sync sample (`sample_is_non_sync_sample`, depends on others). */
export const NON_SYNC = 0x01010000;
/** A sync sample (depends on no other). */
export const SYNC = 0x02000000;

export function moof(sequence: number, tracks: readonly FragmentTrack[]): Uint8Array {
  const trafs = tracks.map((track) => {
    const explicit = track.baseDataOffset !== undefined;
    const tfhdFlags = (explicit ? 0x01 : 0x020000) | (track.defaultDuration !== undefined ? 0x08 : 0) | (track.defaultFlags !== undefined ? 0x20 : 0);
    const tfhd = fullBox(
      'tfhd',
      0,
      tfhdFlags,
      u32(track.trackId),
      ...(explicit ? [u64(track.baseDataOffset!)] : []),
      ...(track.defaultDuration !== undefined ? [u32(track.defaultDuration)] : []),
      ...(track.defaultFlags !== undefined ? [u32(track.defaultFlags)] : []),
    );
    const tfdt = track.base === undefined ? [] : [track.wide ? fullBox('tfdt', 1, 0, u64(track.base)) : fullBox('tfdt', 0, 0, u32(track.base))];
    const flags = 0x01 | (track.firstFlags !== undefined ? 0x04 : 0) | (track.durations ? 0x100 : 0) | 0x200 | (track.flags ? 0x400 : 0) | (track.offsets ? 0x800 : 0);
    const rows: Uint8Array[] = [];
    for (let i = 0; i < track.count; i += 1) {
      if (track.durations) rows.push(u32(track.durations[i]!));
      rows.push(u32(track.sizes?.[i] ?? 100));
      if (track.flags) rows.push(u32(track.flags[i]!));
      if (track.offsets) rows.push(track.trunVersion === 1 ? i32(track.offsets[i]!) : u32(track.offsets[i]!));
    }
    const trun = fullBox('trun', track.trunVersion ?? 0, flags, u32(track.count), i32(track.dataOffset ?? 0), ...(track.firstFlags !== undefined ? [u32(track.firstFlags)] : []), ...rows);
    return box('traf', tfhd, ...tfdt, trun);
  });
  return box('moof', fullBox('mfhd', 0, 0, u32(sequence)), ...trafs);
}

export const ftyp = (brand = 'isom') => box('ftyp', enc(brand), u32(0x200), enc(brand), enc('mp41'));

/** An `mdat` of `size` zero bytes (its contents are never read). */
export const mdat = (size: number) => box('mdat', new Uint8Array(size));

/** A free-form top-level box QuickTime writes before `mdat`. */
export const wide = () => box('wide');
