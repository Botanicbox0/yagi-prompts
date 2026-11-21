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
  const parts = [fullBox('stsd', 0, 0, u32(0)), stts];
  if (spec.offsets) {
    const version = spec.cttsVersion ?? 0;
    const cttsRuns: Runs = runs(spec.offsets);
    parts.push(fullBox('ctts', version, 0, u32(cttsRuns.length), ...cttsRuns.flatMap(([n, o]) => [u32(n), version === 1 ? i32(o) : u32(o)])));
  }
  parts.push(fullBox('stsz', 0, 0, u32(0), u32(spec.durations.length), ...spec.durations.map(() => u32(100))));
  const stbl = box('stbl', ...parts);
  const minf = box('minf', box(spec.handler === 'vide' ? 'vmhd' : 'smhd'), stbl);
  const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(0), new Uint8Array(60));
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
}

export function moof(sequence: number, tracks: readonly FragmentTrack[]): Uint8Array {
  const trafs = tracks.map((track) => {
    const tfhdFlags = 0x020000 | (track.defaultDuration !== undefined ? 0x08 : 0);
    const tfhd = fullBox('tfhd', 0, tfhdFlags, u32(track.trackId), ...(track.defaultDuration !== undefined ? [u32(track.defaultDuration)] : []));
    const tfdt = track.base === undefined ? [] : [track.wide ? fullBox('tfdt', 1, 0, u64(track.base)) : fullBox('tfdt', 0, 0, u32(track.base))];
    const flags = 0x01 | (track.durations ? 0x100 : 0) | 0x200 | (track.offsets ? 0x800 : 0);
    const rows: Uint8Array[] = [];
    for (let i = 0; i < track.count; i += 1) {
      if (track.durations) rows.push(u32(track.durations[i]!));
      rows.push(u32(100));
      if (track.offsets) rows.push(track.trunVersion === 1 ? i32(track.offsets[i]!) : u32(track.offsets[i]!));
    }
    const trun = fullBox('trun', track.trunVersion ?? 0, flags, u32(track.count), i32(0), ...rows);
    return box('traf', tfhd, ...tfdt, trun);
  });
  return box('moof', fullBox('mfhd', 0, 0, u32(sequence)), ...trafs);
}

export const ftyp = (brand = 'isom') => box('ftyp', enc(brand), u32(0x200), enc(brand), enc('mp41'));

/** An `mdat` of `size` zero bytes (its contents are never read). */
export const mdat = (size: number) => box('mdat', new Uint8Array(size));

/** A free-form top-level box QuickTime writes before `mdat`. */
export const wide = () => box('wide');
