import { describe, expect, it } from 'vitest';
import { timingOfFile } from '@/lib/brand-studio/editor-v2/container';
import { av1Codec, avcCodec, gatherIndexBoxes, hevcCodec, readSampleEntry, readSampleIndex, readSps, rotationOf, spsChroma, stampUs, vp9Codec, type IndexBoxes } from '@/lib/brand-studio/editor-v2/sample-index';
import {
  IDENTITY,
  NON_SYNC,
  SYNC,
  av1C,
  avcC,
  box,
  clap,
  concat,
  fullBox,
  i32,
  ftyp,
  hvcC,
  mdat,
  moof,
  moov,
  trak,
  nclx,
  pasp,
  u32,
  visualEntry,
  vpcC,
  type TrackSpec,
} from './mp4-bytes';

/**
 * Spec F, F1: the decoder path's index of a source — where every sample's bytes are, which are sync
 * samples, which picture each is (the edit list applied, presentation order), and how to configure the
 * decoder — read from boxes built here. Picture k must be the seek path's picture k: the index counts the
 * pictures the frame facts count (lib/brand-studio/editor-v2/container.ts), or it is refused.
 */
const frames = (n: number, d: number) => Array.from({ length: n }, () => d);

/** x264's B-pyramid composition offsets in decode order (as in container.test.ts). */
function pyramidOffsets(n: number, d: number): number[] {
  const shown: number[] = [0];
  for (let k = 1; shown.length < n; k += 4) {
    const group = k + 3 < n ? [k + 3, k + 1, k, k + 2] : Array.from({ length: n - k }, (_, j) => k + j);
    shown.push(...group);
  }
  return shown.slice(0, n).map((p, i) => (p + 2 - i) * d);
}

const AVC = visualEntry('avc1', 640, 360, avcC(0x64, 0x00, 0x1f));

async function found(bytes: Uint8Array): Promise<IndexBoxes> {
  const result = await gatherIndexBoxes({ read: async (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length)) });
  if ('failure' in result) throw new Error(result.failure);
  return result;
}

async function indexOf(bytes: Uint8Array) {
  return readSampleIndex(await found(bytes));
}

/** Offsets a chunk layout gives: chunk c holds `perChunk[c]` samples from `offsets[c]` on. */
function expectedOffsets(sizes: readonly number[], perChunk: readonly number[], offsets: readonly number[]): number[] {
  const out: number[] = [];
  let sample = 0;
  perChunk.forEach((n, c) => {
    let at = offsets[c]!;
    for (let k = 0; k < n; k += 1) {
      out.push(at);
      at += sizes[sample]!;
      sample += 1;
    }
  });
  return out;
}

const SIZES = [5000, 900, 300, 280, 310, 950, 320, 290, 4800, 880, 330, 300];

describe('an ordinary file: every sample located, pictures in presentation order', () => {
  const track: TrackSpec = {
    handler: 'vide',
    timescale: 12288,
    durations: frames(12, 512),
    offsets: pyramidOffsets(12, 512),
    edits: [{ duration: 0, mediaTime: 1024 }],
    sizes: SIZES,
    chunks: { perChunk: [4, 4, 4], offsets: [2000, 9000, 20000] },
    sync: [1, 9],
    entry: AVC,
  };

  it('B-frames with ctts, stss and stco: offsets, sync samples, pictures by composition time', async () => {
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [track] }), mdat(64)));
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const { index } = answer;
    expect(index.offsets).toEqual(expectedOffsets(SIZES, [4, 4, 4], [2000, 9000, 20000]));
    expect(index.sizes).toEqual(SIZES);
    expect(index.syncs).toEqual([0, 8]);
    expect(index.sync.filter(Boolean)).toHaveLength(2);
    // Picture k is the sample shown k-th: composition times 1024, 1536, 2048 … with the edit at 1024.
    expect(index.pictures.map((sample) => index.cts[sample])).toEqual(Array.from({ length: 12 }, (_, k) => (k + 2) * 512));
    expect(index.pictures.slice(0, 6)).toEqual([0, 3, 2, 4, 1, 7]);
    expect(index.variable).toBe(false);
    expect(index.rotation).toBe(0);
    expect(index.config.codec).toBe('avc1.64001f');
    expect(index.config.codedWidth).toBe(640);
    expect(index.config.codedHeight).toBe(360);
    // The description is the avcC record itself.
    expect(index.config.description?.[0]).toBe(1);
    expect(index.config.description?.[1]).toBe(0x64);
  });

  it('co64 and stz2 (8- and 16-bit) give the same places', async () => {
    const plain = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, sizes: SIZES.map((s) => s % 256) }] }), mdat(64)));
    const wide = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, sizes: SIZES.map((s) => s % 256), stz2: 8, chunks: { ...track.chunks!, co64: true } }] }), mdat(64)));
    const sixteen = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, stz2: 16 }] }), mdat(64)));
    expect(plain.ok && wide.ok && sixteen.ok).toBe(true);
    if (!plain.ok || !wide.ok || !sixteen.ok) return;
    expect(wide.index.offsets).toEqual(plain.index.offsets);
    expect(wide.index.sizes).toEqual(plain.index.sizes);
    expect(sixteen.index.offsets).toEqual(expectedOffsets(SIZES, [4, 4, 4], [2000, 9000, 20000]));
  });

  it('stz2 with 4-bit sizes', async () => {
    const small = SIZES.map((_, i) => (i % 15) + 1);
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, sizes: small, stz2: 4 }] }), mdat(64)));
    expect(answer.ok && answer.index.sizes).toEqual(small);
  });

  it('a 64-bit chunk offset past 4 GiB is kept exactly', async () => {
    const far = 2 ** 32 + 1234;
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, chunks: { perChunk: [12], offsets: [far], co64: true } }] }), mdat(64)));
    expect(answer.ok && answer.index.offsets[0]).toBe(far);
    expect(answer.ok && answer.index.offsets[1]).toBe(far + SIZES[0]!);
  });

  it('no stss: every sample is a sync sample', async () => {
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, offsets: undefined, edits: undefined, sync: undefined }] }), mdat(64)));
    expect(answer.ok && answer.index.syncs).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('an edit list that trims leading frames: picture 0 is the first frame inside the edit; the trimmed samples stay in the table for decoding', async () => {
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, offsets: undefined, edits: [{ duration: 0, mediaTime: 3 * 512 }] }] }), mdat(64)));
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.index.pictures).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(answer.index.offsets).toHaveLength(12);
  });

  it('a picture behind an empty edit: every picture is shown, from sample 0', async () => {
    const answer = await indexOf(concat(ftyp(), moov({ timescale: 1000, tracks: [{ ...track, offsets: undefined, edits: [{ duration: 500, mediaTime: -1 }, { duration: 0, mediaTime: 0 }] }] }), mdat(64)));
    expect(answer.ok && answer.index.pictures).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('a sample table that does not add up is not located: the source is seeked, the timing is untouched', async () => {
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, chunks: { perChunk: [4, 4], offsets: [2000, 9000] } }] }), mdat(64)));
    expect(answer).toEqual({ ok: false, reason: 'not-located' });
  });

  it('two samples at one time cannot be told apart by the decoder: refused', async () => {
    const answer = await indexOf(concat(ftyp(), moov({ tracks: [{ ...track, edits: undefined, offsets: [512, 0, ...frames(10, 0)] }] }), mdat(64)));
    expect(answer).toEqual({ ok: false, reason: 'times' });
  });

  it('timestamps are whole microseconds of composition time', () => {
    expect(stampUs(512, 12288)).toBe(41667);
    expect(stampUs(1001, 24000)).toBe(41708);
  });
});

describe('a fragmented file: the fragments’ own sample data', () => {
  const entry = visualEntry('avc1', 320, 180, avcC(0x42, 0xc0, 0x1e));
  const header = concat(ftyp('iso5'), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [], entry }], fragmented: { defaultDuration: { 1: 512 } } }));

  it('default-base-is-moof with a data offset, then an explicit base: sizes, places and sync flags', async () => {
    const first = (dataOffset: number) =>
      moof(1, [{ trackId: 1, base: 0, count: 4, sizes: [4000, 500, 400, 450], firstFlags: SYNC, defaultFlags: NON_SYNC, dataOffset }]);
    const size1 = first(0).length;
    const moof1 = first(size1 + 8);
    const data1 = mdat(5350);
    const at2 = header.length + moof1.length + data1.length;
    const second = (base: number) => moof(2, [{ trackId: 1, base: 2048, count: 3, sizes: [3900, 520, 410], flags: [SYNC, NON_SYNC, NON_SYNC], baseDataOffset: base }]);
    const size2 = second(0).length;
    const moof2 = second(at2 + size2 + 8);
    const bytes = concat(header, moof1, data1, moof2, mdat(4830));
    const answer = await indexOf(bytes);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const firstData = header.length + size1 + 8;
    const secondData = at2 + size2 + 8;
    expect(answer.index.offsets).toEqual([firstData, firstData + 4000, firstData + 4500, firstData + 4900, secondData, secondData + 3900, secondData + 4420]);
    expect(answer.index.sizes).toEqual([4000, 500, 400, 450, 3900, 520, 410]);
    expect(answer.index.syncs).toEqual([0, 4]);
    expect(answer.index.pictures).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(answer.index.cts).toEqual([0, 512, 1024, 1536, 2048, 2560, 3072]);
    expect(answer.index.config.codec).toBe('avc1.42c01e');
  });
});

describe('the codec string and configuration for VideoDecoder.configure', () => {
  const index = (entry: Uint8Array) => indexOf(concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 30, durations: frames(4, 1), chunks: { perChunk: [4], offsets: [100] }, entry }] }), mdat(500)));

  it('AVC: avc1 / avc3 with profile, compatibility and level from avcC', async () => {
    expect(avcCodec('avc1', Uint8Array.of(1, 0x64, 0x00, 0x28))).toBe('avc1.640028');
    expect(avcCodec('avc3', Uint8Array.of(1, 0x4d, 0x40, 0x1e))).toBe('avc3.4d401e');
    const answer = await index(visualEntry('avc3', 1920, 1080, avcC(0x4d, 0x40, 0x28)));
    expect(answer.ok && answer.index.config.codec).toBe('avc3.4d4028');
  });

  it('HEVC: hvc1 / hev1 from hvcC (ISO/IEC 14496-15 Annex E)', async () => {
    const main = hvcC(0x01, 0x60000000, [0xb0, 0, 0, 0, 0, 0], 93);
    expect(hevcCodec('hvc1', main.subarray(8))).toBe('hvc1.1.6.L93.B0');
    expect(hevcCodec('hev1', hvcC(0x22, 0x20000000, [0x90, 0, 0, 0, 0, 0], 120).subarray(8))).toBe('hev1.2.4.H120.90');
    expect(hevcCodec('hvc1', hvcC(0x41, 0x60000000, [0, 0, 0, 0, 0, 0], 63).subarray(8))).toBe('hvc1.A1.6.L63');
    const answer = await index(visualEntry('hvc1', 1920, 1080, main));
    expect(answer.ok && answer.index.config.codec).toBe('hvc1.1.6.L93.B0');
    expect(answer.ok && answer.index.config.description?.length).toBe(23);
  });

  it('VP9 from vpcC version 1; no description', async () => {
    expect(vp9Codec(vpcC(0, 10, 8, 1, 0, 1, 1, 1).subarray(8))).toBe('vp09.00.10.08.01.01.01.01.00');
    const answer = await index(visualEntry('vp09', 640, 360, vpcC(2, 31, 10, 1, 1, 9, 16, 9)));
    expect(answer.ok && answer.index.config.codec).toBe('vp09.02.31.10.01.09.16.09.01');
    expect(answer.ok && answer.index.config.description).toBeNull();
  });

  it('AV1 from av1C', async () => {
    expect(av1Codec(av1C(0, 4, 0, 8).subarray(8))).toBe('av01.0.04M.08');
    expect(av1Codec(av1C(0, 13, 1, 10).subarray(8))).toBe('av01.0.13H.10');
    expect(av1Codec(av1C(2, 8, 0, 12).subarray(8))).toBe('av01.2.08M.12');
    const answer = await index(visualEntry('av01', 640, 360, av1C(0, 8, 0, 8)));
    expect(answer.ok && answer.index.config.codec).toBe('av01.0.08M.08');
  });

  it('anything else (MPEG-4 part 2, encrypted, an entry without its record) is refused: the source is seeked', async () => {
    expect(await index(visualEntry('mp4v', 640, 360))).toEqual({ ok: false, reason: 'codec' });
    expect(await index(visualEntry('encv', 640, 360, avcC(0x64, 0, 0x1f)))).toEqual({ ok: false, reason: 'codec' });
    expect(await index(visualEntry('avc1', 640, 360))).toEqual({ ok: false, reason: 'codec' });
    expect(readSampleEntry(null)).toEqual({ ok: false, reason: 'entry' });
  });

  it('non-square pixels (pasp) and the colour description (colr nclx) are read; a whole-picture clean aperture is no crop', () => {
    const stsd = (entry: Uint8Array) => concat(Uint8Array.of(0, 0, 0, 0), u32(1), entry);
    const read = readSampleEntry(stsd(visualEntry('avc1', 720, 480, avcC(0x64, 0, 0x1e), pasp(32, 27), nclx(1, 1, 1, false), clap(720, 480))));
    expect(read.ok && read.config.pixelAspect).toEqual([32, 27]);
    expect(read.ok && read.config.colour).toEqual({ primaries: 1, transfer: 1, matrix: 1, fullRange: false });
    const full = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcC(0x64, 0, 0x1e), nclx(1, 13, 6, true))));
    expect(full.ok && full.config.colour?.fullRange).toBe(true);
    expect(full.ok && full.config.pixelAspect).toEqual([1, 1]);
  });

  it('a clean aperture that crops is not followed: refused', () => {
    const stsd = concat(Uint8Array.of(0, 0, 0, 0), u32(1), visualEntry('avc1', 720, 480, avcC(0x64, 0, 0x1e), clap(704, 480, -4, 0)));
    expect(readSampleEntry(stsd)).toEqual({ ok: false, reason: 'aperture' });
  });
});

describe('only plain 8-bit SDR footage is decoded (review 1, item 1): the rest is seeked, reason colour', () => {
  const stsd = (entry: Uint8Array) => concat(Uint8Array.of(0, 0, 0, 0), u32(1), entry);
  const colr = (kind: string, ...rest: Uint8Array[]) => box('colr', Uint8Array.from(kind, (c) => c.charCodeAt(0)), ...rest);
  /** An hvcC record with a stated luma bit depth (byte 17) and chroma bit depth (byte 18). */
  const hvcCDepth = (luma: number, chroma: number) => {
    const record = hvcC(0x02, 0x20000000, [0x90, 0, 0, 0, 0, 0], 120);
    record[8 + 16] = 0xfc | 1; // chromaFormat 4:2:0
    record[8 + 17] = 0xf8 | (luma - 8);
    record[8 + 18] = 0xf8 | (chroma - 8);
    return record;
  };
  /** An avcC record with the High-profile tail (chroma format, luma and chroma bit depth). */
  const avcCTail = (profile: number, luma: number) =>
    box('avcC', Uint8Array.of(1, profile, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, profile, 0, 0x28, 1, 0, 2, 0x68, 0xce, 0xfd, 0xf8 | (luma - 8), 0xf8 | (luma - 8), 0));

  it('HEVC Main10 (hvcC bit depth 10): not 8-bit', () => {
    const read = readSampleEntry(stsd(visualEntry('hvc1', 1920, 1080, hvcCDepth(10, 10))));
    expect(read.ok && read.config.bitDepth).toBe(10);
    const main = readSampleEntry(stsd(visualEntry('hvc1', 1920, 1080, hvcCDepth(8, 8))));
    expect(main.ok && main.config.bitDepth).toBe(8);
  });

  it('spec H, F7: the chroma format is read: implied 4:2:0 for Baseline/Main/Extended, the High tail, else the SPS; hvcC chromaFormat', () => {
    const baseline = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcC(66, 0xc0, 0x1e))));
    expect(baseline.ok && baseline.config.chroma).toBe(1);
    const high = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcCTail(100, 8))));
    expect(high.ok && high.config.chroma).toBe(1);
    // High with no tail: the SPS says (profile 100, level 31, sps_id 0, chroma_format_idc 3 = 4:4:4).
    const sps444 = Uint8Array.of(0x67, 100, 0, 31, 0b1_00100_00);
    const noTail = box('avcC', Uint8Array.of(1, 100, 0, 31, 0xff, 0xe1, 0, sps444.length), sps444, Uint8Array.of(1, 0, 2, 0x68, 0xce));
    const read444 = readSampleEntry(stsd(visualEntry('avc1', 640, 360, noTail)));
    expect(read444.ok && read444.config.chroma).toBe(3);
    // An emulation prevention byte (00 00 03) is taken out before reading.
    expect(spsChroma(Uint8Array.of(0x67, 100, 0, 0, 3, 0b1_010_0000))).toBe(1);
    // Nothing readable: not known.
    const opaque = box('avcC', Uint8Array.of(1, 100, 0, 31, 0xff, 0xe0, 0));
    const unknown = readSampleEntry(stsd(visualEntry('avc1', 640, 360, opaque)));
    expect(unknown.ok && unknown.config.chroma).toBeNull();
    const main10 = readSampleEntry(stsd(visualEntry('hvc1', 1920, 1080, hvcCDepth(10, 10))));
    expect(main10.ok && main10.config.chroma).toBe(1);
  });

  it('spec G, A0: the profile is read (hvcC general_profile_idc, avcC profile_idc)', () => {
    const main10 = readSampleEntry(stsd(visualEntry('hvc1', 1920, 1080, hvcCDepth(10, 10))));
    expect(main10.ok && main10.config.profile).toBe(2);
    const high = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcC(0x64, 0, 0x1f))));
    expect(high.ok && high.config.profile).toBe(100);
    const vp9 = readSampleEntry(stsd(visualEntry('vp09', 640, 360, vpcC(2, 31, 10, 1, 0, 1, 1, 1))));
    expect(vp9.ok && vp9.config.profile).toBe(2);
  });

  it('AVC: the High-profile tail gives the bit depth; High 10 and the 4:2:2 / 4:4:4 profiles without a tail are not taken as 8', () => {
    expect(readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcCTail(110, 10)))).ok && true).toBe(true);
    const ten = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcCTail(110, 10))));
    expect(ten.ok && ten.config.bitDepth).toBe(10);
    const high = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcCTail(100, 8))));
    expect(high.ok && high.config.bitDepth).toBe(8);
    const untold = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcC(110, 0, 0x28))));
    expect(untold.ok && untold.config.bitDepth).toBeNull();
    const plain = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcC(0x64, 0, 0x1f))));
    expect(plain.ok && plain.config.bitDepth).toBe(8);
  });

  it('VP9 and AV1 state their bit depth in their records', () => {
    const vp9 = readSampleEntry(stsd(visualEntry('vp09', 640, 360, vpcC(2, 31, 10, 1, 0, 1, 1, 1))));
    expect(vp9.ok && vp9.config.bitDepth).toBe(10);
    const av1 = readSampleEntry(stsd(visualEntry('av01', 640, 360, av1C(0, 8, 0, 10))));
    expect(av1.ok && av1.config.bitDepth).toBe(10);
    const av18 = readSampleEntry(stsd(visualEntry('av01', 640, 360, av1C(0, 8, 0, 8))));
    expect(av18.ok && av18.config.bitDepth).toBe(8);
  });

  it('colour: BT.2020 with PQ (nclx 9/16/9) or HLG is not SDR; BT.709 and BT.601 are; no colr is; an ICC profile is not', () => {
    const sdr = (...kids: Uint8Array[]) => {
      const read = readSampleEntry(stsd(visualEntry('avc1', 640, 360, avcC(0x64, 0, 0x1f), ...kids)));
      return read.ok ? read.config.sdr : null;
    };
    expect(sdr(nclx(9, 16, 9, false))).toBe(false);
    expect(sdr(nclx(9, 18, 9, false))).toBe(false);
    expect(sdr(nclx(1, 1, 1, false))).toBe(true);
    expect(sdr(nclx(6, 6, 6, false))).toBe(true);
    expect(sdr(nclx(1, 1, 1, true))).toBe(true);
    expect(sdr()).toBe(true);
    expect(sdr(colr('prof', new Uint8Array(16)))).toBe(false);
    expect(sdr(colr('rICC', new Uint8Array(16)))).toBe(false);
    // VP9 states its colour in vpcC: BT.2020 PQ there is not SDR either.
    const vp9 = readSampleEntry(stsd(visualEntry('vp09', 640, 360, vpcC(0, 31, 8, 1, 0, 9, 16, 9))));
    expect(vp9.ok && vp9.config.sdr).toBe(false);
  });
});

describe('the display matrix: rotations a <video> applies', () => {
  const ONE = 0x10000;
  const W = 0x40000000;

  it('identity, 90, 180 and 270 degrees clockwise', () => {
    expect(rotationOf([...IDENTITY])).toBe(0);
    expect(rotationOf([0, ONE, 0, -ONE, 0, 0, 1080 * ONE, 0, W])).toBe(90);
    expect(rotationOf([-ONE, 0, 0, 0, -ONE, 0, 1920 * ONE, 1080 * ONE, W])).toBe(180);
    expect(rotationOf([0, -ONE, 0, ONE, 0, 0, 0, 1920 * ONE, W])).toBe(270);
    expect(rotationOf(null)).toBe(0);
  });

  it('a mirror, a scale or perspective is not a plain turn: refused', () => {
    expect(rotationOf([-ONE, 0, 0, 0, ONE, 0, 0, 0, W])).toBeNull();
    expect(rotationOf([2 * ONE, 0, 0, 0, 2 * ONE, 0, 0, 0, W])).toBeNull();
    expect(rotationOf([ONE, 0, 1, 0, ONE, 0, 0, 0, W])).toBeNull();
    expect(rotationOf([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('a phone’s rotated clip carries its rotation into the index; a mirrored one is refused', async () => {
    const make = (matrix: readonly number[]) =>
      indexOf(concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 30, durations: frames(4, 1), chunks: { perChunk: [4], offsets: [100] }, entry: AVC, matrix }] }), mdat(500)));
    const turned = await make([0, ONE, 0, -ONE, 0, 0, 360 * ONE, 0, W]);
    expect(turned.ok && turned.index.rotation).toBe(90);
    expect(await make([-ONE, 0, 0, 0, ONE, 0, 640 * ONE, 0, W])).toEqual({ ok: false, reason: 'transform' });
  });
});

describe('the index and the frame facts count the same pictures', () => {
  const layouts: Array<[string, TrackSpec[], number?]> = [
    ['plain', [{ handler: 'vide', timescale: 12288, durations: frames(24, 512), chunks: { perChunk: [24], offsets: [100] }, entry: AVC }]],
    ['B-frames, edit list', [{ handler: 'vide', timescale: 12288, durations: frames(12, 512), offsets: pyramidOffsets(12, 512), edits: [{ duration: 0, mediaTime: 1024 }], chunks: { perChunk: [12], offsets: [100] }, entry: AVC }]],
    ['B-frames, no edit list', [{ handler: 'vide', timescale: 12288, durations: frames(12, 512), offsets: pyramidOffsets(12, 512), chunks: { perChunk: [12], offsets: [100] }, entry: AVC }]],
    ['trimmed by the edit', [{ handler: 'vide', timescale: 12288, durations: frames(24, 512), edits: [{ duration: 0, mediaTime: 3686 }], chunks: { perChunk: [24], offsets: [100] }, entry: AVC }]],
    ['ends early', [{ handler: 'vide', timescale: 12288, durations: frames(24, 512), edits: [{ duration: 500, mediaTime: 0 }], chunks: { perChunk: [24], offsets: [100] }, entry: AVC }], 1000],
    ['empty edit first', [{ handler: 'vide', timescale: 12288, durations: frames(24, 512), edits: [{ duration: 500, mediaTime: -1 }, { duration: 0, mediaTime: 0 }], chunks: { perChunk: [24], offsets: [100] }, entry: AVC }], 1000],
  ];
  for (const [name, tracks, timescale] of layouts) {
    it(name, async () => {
      const bytes = concat(ftyp(), moov({ timescale, tracks }), mdat(64));
      const facts = await timingOfFile(bytes);
      const answer = await indexOf(bytes);
      expect(facts.ok && facts.timing.video).toBeTruthy();
      expect(answer.ok).toBe(true);
      if (!answer.ok || !facts.ok || !facts.timing.video) return;
      expect(answer.index.pictures).toHaveLength(facts.timing.video.frames);
    });
  }

  it('a picture track with no sound track says so (the export then reads nothing for its sound)', async () => {
    const solo = await indexOf(concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 30, durations: frames(4, 1), chunks: { perChunk: [4], offsets: [100] }, entry: AVC }] }), mdat(500)));
    const both = await indexOf(
      concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 30, durations: frames(4, 1), chunks: { perChunk: [4], offsets: [100] }, entry: AVC }, { handler: 'soun', timescale: 48000, durations: frames(4, 1024), chunks: { perChunk: [4], offsets: [900] } }] }), mdat(500)),
    );
    expect(solo.ok && solo.index.sound).toBe('no');
    expect(both.ok && both.index.sound).toBe('yes');
  });
});

describe('what the index refuses', () => {
  it('not readable, no picture track', async () => {
    const sound: TrackSpec = { handler: 'soun', timescale: 48000, durations: frames(10, 1024), chunks: { perChunk: [10], offsets: [100] } };
    expect(await indexOf(concat(ftyp(), moov({ tracks: [sound] }), mdat(64)))).toEqual({ ok: false, reason: 'no-video' });
    expect(readSampleIndex({ moov: box('moov', fullBox('mvhd', 0, 0)), moofs: [] })).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('spec G, B4–B6: fragments read by their own rules', () => {
  const entry = visualEntry('avc1', 320, 180, avcC(0x42, 0xc0, 0x1e));
  const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), new Uint8Array(80));
  const trex = (track: number, duration: number, size: number, flags: number) => fullBox('trex', 0, 0, u32(track), u32(1), u32(duration), u32(size), u32(flags));

  it('B4: a version 0 trun with a negative composition offset is read signed, as ctts is (index and frame facts)', async () => {
    const header = concat(ftyp('iso5'), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [], entry }], fragmented: { defaultDuration: { 1: 512 } } }));
    // Decode order I P B, the P shown after the B: the B's offset is negative, written into a version 0 trun.
    const fragment = (dataOffset: number) =>
      moof(1, [{ trackId: 1, base: 512, count: 3, sizes: [900, 300, 200], offsets: [0, 1024, -512], trunVersion: 0, firstFlags: SYNC, defaultFlags: NON_SYNC, dataOffset }]);
    const size = fragment(0).length;
    const bytes = concat(header, fragment(size + 8), mdat(1400));
    const answer = await indexOf(bytes);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // Decode times 512, 1024, 1536; composition 512, 2048, 1024: the third sample is shown second.
    expect(answer.index.cts).toEqual([512, 2048, 1024]);
    expect(answer.index.pictures).toEqual([0, 2, 1]);
    const facts = await timingOfFile(bytes);
    expect(facts.ok && facts.timing.video).toMatchObject({ frames: 3, variable: false });
  });

  it('B5: another track’s fragment before the picture track’s is measured by ITS trex defaults', async () => {
    const header = concat(
      ftyp('iso5'),
      box(
        'moov',
        mvhd,
        trak(1, { handler: 'vide', timescale: 12288, durations: [], entry }),
        trak(2, { handler: 'soun', timescale: 48000, durations: [] }),
        box('mvex', trex(1, 512, 999, NON_SYNC), trex(2, 1024, 200, 0)),
      ),
    );
    const make = (dataOffset: number) => {
      // The sound traf: no base, no sizes, its data from the moof + offset; three samples of its default 200 bytes.
      const sound = box('traf', fullBox('tfhd', 0, 0, u32(2)), fullBox('tfdt', 0, 0, u32(0)), fullBox('trun', 0, 0x01, u32(3), i32(dataOffset)));
      // The picture traf: no base and no data offset: its data starts where the sound's ended.
      const video = box('traf', fullBox('tfhd', 0, 0, u32(1)), fullBox('tfdt', 0, 0, u32(0)), fullBox('trun', 0, 0x200 | 0x04, u32(2), u32(SYNC), u32(1000), u32(300)));
      return box('moof', fullBox('mfhd', 0, 0, u32(1)), sound, video);
    };
    const size = make(0).length;
    const bytes = concat(header, make(size + 8), mdat(1900));
    const answer = await indexOf(bytes);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const data = header.length + size + 8;
    expect(answer.index.offsets).toEqual([data + 600, data + 1600]);
    expect(answer.index.sizes).toEqual([1000, 300]);
  });

  /** The stsd of the first track holds two sample entries (its entry count says 2). */
  function twoEntries(bytes: Uint8Array): Uint8Array {
    const out = bytes.slice();
    for (let i = 0; i + 4 <= out.length; i += 1) {
      if (out[i] === 0x73 && out[i + 1] === 0x74 && out[i + 2] === 0x73 && out[i + 3] === 0x64) {
        out[i + 11] = 2;
        return out;
      }
    }
    throw new Error('no stsd');
  }

  it('B6: two sample entries on the picture track are not indexed, in a plain file (every sample on entry 1) as in a fragmented one', async () => {
    const plain = concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 30, durations: frames(4, 1), chunks: { perChunk: [4], offsets: [100] }, entry: concat(AVC, AVC) }] }), mdat(500));
    expect(await indexOf(twoEntries(plain))).toEqual({ ok: false, reason: 'mixed-entries' });
    const header = concat(ftyp('iso5'), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [], entry: concat(entry, entry) }], fragmented: { defaultDuration: { 1: 512 } } }));
    const fragment = (dataOffset: number) => moof(1, [{ trackId: 1, base: 0, count: 2, sizes: [900, 300], firstFlags: SYNC, defaultFlags: NON_SYNC, dataOffset }]);
    const size = fragment(0).length;
    expect(await indexOf(twoEntries(concat(header, fragment(size + 8), mdat(1200))))).toEqual({ ok: false, reason: 'mixed-entries' });
    // One entry is still read.
    const single = concat(ftyp('iso5'), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [], entry }], fragmented: { defaultDuration: { 1: 512 } } }));
    expect((await indexOf(concat(single, fragment(size + 8), mdat(1200)))).ok).toBe(true);
  });
});

/**
 * Spec I, G6: interlaced H.264 was never measured on the decoder path, so it is read: `frame_mbs_only_flag` from
 * the first sequence parameter set in `avcC` (the walk passes chroma_format_idc, the bit depths, the scaling lists,
 * log2_max_frame_num, the picture order count fields, max_num_ref_frames, the gaps flag and the two size fields).
 * The ffmpeg bytes: `ffmpeg -f lavfi -i testsrc2=size=320x240:rate=25:duration=0.4 -c:v libx264 -pix_fmt yuv420p
 * -profile:v <main|high|baseline> -bf <0|2> [-flags +ildct+ilme -x264opts interlaced=1]`, the SPS taken from the
 * file's avcC (ffprobe field_order: progressive / tt). x264 writes `cqm=jvt` scaling lists into the PPS, not the
 * SPS, so the SPS with scaling lists and the picture order count type 1 are made by hand (checked with an
 * independent walk, scratch `fixes3/sps_parse.py`).
 */
describe('spec I, G6: progressive or interlaced, from the SPS', () => {
  const hex = (value: string) => Uint8Array.from(value.match(/../g)!.map((b) => parseInt(b, 16)));
  const FFMPEG: Array<[string, string, 0 | 1]> = [
    ['Main progressive', '674d400dd90141fb011000000300100000030320f142a480', 1],
    ['Main interlaced', '674d4015f202821f97011000000300100000030321f142a480', 0],
    ['High progressive', '6764000dacb20283f60220000003002000000641e28549', 1],
    ['High interlaced', '67640015ace405043f2e0220000003002000000643e28549', 0],
    ['High progressive, B-frames (picture order count type 0)', '6764000dacd94141fb011000000300100000030320f1429960', 1],
    ['High interlaced, B-frames', '67640015acd941410fcb808800000300080000030190f8a14cb0', 0],
    ['Constrained Baseline progressive', '6742c00dd90141fb011000000300100000030320f142a480', 1],
  ];
  const BY_HAND: Array<[string, string, 0 | 1]> = [
    ['High with scaling lists (4x4, a default one, 8x8), progressive', '67640028ad98c6318c6318c6318c6342214d34d34d34d34d34d34d34d34d34d34d34d34d34d34d34d36ca03c011380', 1],
    ['High with scaling lists, interlaced', '67640028ad98c6318c6318c6318c6342214d34d34d34d34d34d34d34d34d34d34d34d34d34d34d34d36ca03c0226', 0],
    ['Main, picture order count type 1, interlaced', '674d0028d0a88990a03c0226', 0],
    ['Main, picture order count type 1, progressive', '674d0028d0a88990a03c011380', 1],
  ];

  for (const [name, bytes, flag] of [...FFMPEG, ...BY_HAND]) {
    it(`${name}: frame_mbs_only_flag ${flag}`, () => {
      expect(readSps(hex(bytes))).toEqual({ chroma: 1, frameMbsOnly: flag });
    });
  }

  it('a truncated SPS is not read: cut short of the flag it answers null, never a wrong flag', () => {
    for (const [, bytes, flag] of [...FFMPEG, ...BY_HAND]) {
      const whole = hex(bytes);
      let first: number | null = null;
      for (let length = 1; length <= whole.length; length += 1) {
        const read = readSps(whole.subarray(0, length)).frameMbsOnly;
        expect(read === null || read === flag, `${bytes} cut at ${length}`).toBe(true);
        if (read !== null && first === null) first = length;
      }
      // The flag comes after the sizes: no SPS of these answers within its first six bytes.
      expect(first, bytes).toBeGreaterThan(6);
      for (let length = 1; length < first!; length += 1) expect(readSps(whole.subarray(0, length)).frameMbsOnly).toBeNull();
    }
  });

  it('an odd SPS is not read: chroma_format_idc past 3, a number of more than 31 leading zeros', () => {
    // High, sps_id 0, chroma_format_idc 4 (ue 00101).
    expect(readSps(Uint8Array.of(0x67, 100, 0, 40, 0b1_00101_00, 0xff, 0xff)).frameMbsOnly).toBeNull();
    expect(readSps(Uint8Array.of(0x67, 77, 0, 40, 0, 0, 0, 0, 0, 0x80)).frameMbsOnly).toBeNull();
  });

  const avcCWith = (sps: Uint8Array | null, profile = sps ? sps[1]! : 77) =>
    box('avcC', Uint8Array.of(1, profile, 0, 40, 0xff, sps ? 0xe1 : 0xe0), ...(sps ? [Uint8Array.of(0, sps.length), sps] : []), Uint8Array.of(1, 0, 2, 0x68, 0xce));
  const entry = (type: string, record: Uint8Array) => readSampleEntry(concat(Uint8Array.of(0, 0, 0, 0), u32(1), visualEntry(type, 320, 240, record)));

  it('the sample entry carries it: progressive true / false from the SPS; avc3 with no SPS in the record: not read', () => {
    const progressive = entry('avc1', avcCWith(hex(FFMPEG[0]![1])));
    expect(progressive.ok && progressive.config.progressive).toBe(true);
    const interlaced = entry('avc1', avcCWith(hex(FFMPEG[1]![1])));
    expect(interlaced.ok && interlaced.config.progressive).toBe(false);
    const inBand = entry('avc3', avcCWith(null));
    expect(inBand.ok && inBand.config.progressive).toBeNull();
  });

  it('HEVC: interlaced and not progressive (general_progressive_source_flag 0, general_interlaced_source_flag 1) is false; anything else true', () => {
    const hevc = (first: number) => entry('hvc1', hvcC(0x01, 0x60000000, [first, 0, 0, 0, 0, 0], 93));
    const value = (first: number) => {
      const read = hevc(first);
      return read.ok ? read.config.progressive : 'refused';
    };
    expect(value(0b0100_0000)).toBe(false);
    expect(value(0b1000_0000)).toBe(true);
    expect(value(0b1100_0000)).toBe(true);
    expect(value(0b0000_0000)).toBe(true);
  });
});
