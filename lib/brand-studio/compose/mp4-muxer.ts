/**
 * Pure-TypeScript ISO-BMFF (MP4) faststart muxer for H.264 (`avc1`) video + optional AAC (`mp4a`) audio
 * (`docs/BRAND-VIDEO-COMPOSE-D.md` §3).
 *
 * Layout: `ftyp` -> `moov` -> `mdat` (faststart), so `sniffMime` (`video/mp4`) and `videoInfo`
 * (`width`, `height`, `durationMs` in `lib/brand-studio/files.ts`) read exported bytes directly,
 * and mobile/desktop browsers play immediately without seeking to the end of the file.
 */

export interface EncodedVideoSample {
  /** Raw bytes from WebCodecs `EncodedVideoChunk.copyTo` (either AVCC 4-byte length-prefixed or Annex-B). */
  data: Uint8Array;
  isKeyFrame: boolean;
  /** Duration of this frame in microseconds (`1_000_000 / fps` when omitted). */
  durationUs?: number;
}

export interface EncodedAudioSample {
  data: Uint8Array;
  /** Samples per AAC frame (1024 for AAC-LC). */
  sampleCount?: number;
}

export interface Mp4MuxInput {
  width: number;
  height: number;
  fps: number;
  videoSamples: readonly EncodedVideoSample[];
  /** `decoderConfig.description` emitted by WebCodecs `VideoEncoder` when in `avc` format. */
  avcDecoderConfigRecord?: Uint8Array | null;
  audio?: {
    sampleRate: number;
    channelCount: number;
    samples: readonly EncodedAudioSample[];
    /** Optional AudioSpecificConfig from WebCodecs `AudioEncoder` `decoderConfig.description`. */
    audioSpecificConfig?: Uint8Array | null;
  } | null;
}

const VIDEO_TIMESCALE = 90_000;

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function u16(value: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, value >>> 0, false);
  return b;
}

function u32(value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, false);
  return b;
}

function ascii(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  let bodyLen = 0;
  for (const p of payloads) bodyLen += p.byteLength;
  const out = new Uint8Array(8 + bodyLen);
  new DataView(out.buffer).setUint32(0, out.byteLength, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i) & 0xff;
  let offset = 8;
  for (const p of payloads) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function fullBox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  const vf = new Uint8Array(4);
  vf[0] = version & 0xff;
  vf[1] = (flags >>> 16) & 0xff;
  vf[2] = (flags >>> 8) & 0xff;
  vf[3] = flags & 0xff;
  return box(type, vf, ...payloads);
}

/** Splits an Annex-B byte stream into individual NAL units (without start codes). */
function splitAnnexBNalus(data: Uint8Array): Uint8Array[] {
  const nalus: Uint8Array[] = [];
  let i = 0;
  const findStart = (from: number): { pos: number; len: number } | null => {
    for (let p = from; p + 2 < data.byteLength; p += 1) {
      if (data[p] === 0 && data[p + 1] === 0) {
        if (data[p + 2] === 1) return { pos: p, len: 3 };
        if (p + 3 < data.byteLength && data[p + 2] === 0 && data[p + 3] === 1) return { pos: p, len: 4 };
      }
    }
    return null;
  };
  let current = findStart(0);
  while (current) {
    const start = current.pos + current.len;
    const next = findStart(start);
    const end = next ? next.pos : data.byteLength;
    if (end > start) nalus.push(data.subarray(start, end));
    current = next;
    i = end;
    if (i >= data.byteLength) break;
  }
  return nalus;
}

function looksLikeAnnexB(data: Uint8Array): boolean {
  if (data.byteLength < 4) return false;
  return (
    (data[0] === 0 && data[1] === 0 && data[2] === 1) ||
    (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1)
  );
}

/** Ensures sample data is 4-byte big-endian length-prefixed AVCC NALUs and extracts SPS/PPS if present. */
function normalizeAvcSample(raw: Uint8Array): { avccData: Uint8Array; sps: Uint8Array | null; pps: Uint8Array | null } {
  let sps: Uint8Array | null = null;
  let pps: Uint8Array | null = null;
  if (looksLikeAnnexB(raw)) {
    const nalus = splitAnnexBNalus(raw);
    const keep: Uint8Array[] = [];
    for (const nalu of nalus) {
      if (nalu.byteLength === 0) continue;
      const nalType = nalu[0]! & 0x1f;
      if (nalType === 7 && !sps) sps = nalu;
      if (nalType === 8 && !pps) pps = nalu;
      keep.push(u32(nalu.byteLength), nalu);
    }
    return { avccData: concatBytes(keep), sps, pps };
  }
  // Already AVCC 4-byte length-prefixed; scan NALUs for SPS/PPS just in case avcC wasn't supplied.
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let pos = 0;
  while (pos + 4 <= raw.byteLength) {
    const len = view.getUint32(pos, false);
    pos += 4;
    if (len === 0 || pos + len > raw.byteLength) break;
    const nalu = raw.subarray(pos, pos + len);
    const nalType = nalu[0]! & 0x1f;
    if (nalType === 7 && !sps) sps = nalu;
    if (nalType === 8 && !pps) pps = nalu;
    pos += len;
  }
  return { avccData: raw, sps, pps };
}

function buildAvcCBox(explicitRecord: Uint8Array | null | undefined, sps: Uint8Array | null, pps: Uint8Array | null): Uint8Array {
  if (explicitRecord && explicitRecord.byteLength >= 7) {
    return box('avcC', explicitRecord);
  }
  const spsBytes = sps ?? new Uint8Array([0x67, 0x42, 0xc0, 0x28, 0xd9, 0x00, 0x78, 0x02, 0x27, 0xe5, 0x84, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xf0, 0x3c, 0x60, 0xc9, 0x20]);
  const ppsBytes = pps ?? new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
  const profile = spsBytes[1] ?? 0x42;
  const compat = spsBytes[2] ?? 0xc0;
  const level = spsBytes[3] ?? 0x28;
  return box(
    'avcC',
    new Uint8Array([
      1, // configurationVersion
      profile,
      compat,
      level,
      0xff, // lengthSizeMinusOne = 3 (4-byte length prefix)
      0xe1, // numOfSequenceParameterSets = 1
    ]),
    u16(spsBytes.byteLength),
    spsBytes,
    new Uint8Array([1]), // numOfPictureParameterSets = 1
    u16(ppsBytes.byteLength),
    ppsBytes,
  );
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function defaultAudioSpecificConfig(sampleRate: number, channelCount: number): Uint8Array {
  const srIdx = Math.max(0, AAC_SAMPLE_RATES.indexOf(sampleRate) === -1 ? 3 : AAC_SAMPLE_RATES.indexOf(sampleRate));
  const objectType = 2; // AAC-LC
  const b0 = ((objectType << 3) | (srIdx >>> 1)) & 0xff;
  const b1 = (((srIdx & 1) << 7) | ((channelCount & 0x0f) << 3)) & 0xff;
  return new Uint8Array([b0, b1]);
}

function buildEsdsBox(asc: Uint8Array): Uint8Array {
  // Minimal ISO 14496-1 ES_Descriptor wrapping DecoderConfigDescriptor (0x40 = Audio ISO/IEC 14496-3) + DecSpecificInfo.
  const decSpecific = concatBytes([new Uint8Array([0x05, asc.byteLength]), asc]);
  const decConfigBody = concatBytes([
    new Uint8Array([
      0x40, // objectTypeIndication: MPEG-4 Audio
      0x15, // streamType (5 = AudioStream) << 2 | 1
      0x00, 0x00, 0x00, // bufferSizeDB
    ]),
    u32(128_000), // maxBitrate
    u32(128_000), // avgBitrate
    decSpecific,
  ]);
  const decConfig = concatBytes([new Uint8Array([0x04, decConfigBody.byteLength]), decConfigBody]);
  const slConfig = new Uint8Array([0x06, 0x01, 0x02]);
  const esBody = concatBytes([u16(2), new Uint8Array([0x00]), decConfig, slConfig]);
  const esDescr = concatBytes([new Uint8Array([0x03, esBody.byteLength]), esBody]);
  return fullBox('esds', 0, 0, esDescr);
}

function buildStts(deltas: readonly number[]): Uint8Array {
  const runs: Array<{ count: number; delta: number }> = [];
  for (const d of deltas) {
    const safeDelta = Math.max(1, Math.round(d));
    const last = runs[runs.length - 1];
    if (last && last.delta === safeDelta) last.count += 1;
    else runs.push({ count: 1, delta: safeDelta });
  }
  const entries: Uint8Array[] = [u32(runs.length)];
  for (const r of runs) entries.push(u32(r.count), u32(r.delta));
  return fullBox('stts', 0, 0, ...entries);
}

function buildTrackBox(params: {
  trackId: number;
  movieDuration90k: number;
  mediaTimescale: number;
  mediaDuration: number;
  width: number;
  height: number;
  isAudio: boolean;
  stsdEntry: Uint8Array;
  sampleDeltas: readonly number[];
  sampleSizes: readonly number[];
  chunkOffsets: readonly number[];
  keySampleNumbers?: readonly number[];
}): Uint8Array {
  const matrix = concatBytes([
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
  ]);
  // Version-0 tkhd: exact 92-byte box so width sits at `tkhd_type_offset + 80` and height at `+ 84`.
  const tkhd = fullBox(
    'tkhd',
    0,
    0x000003,
    u32(0), // creation_time
    u32(0), // modification_time
    u32(params.trackId),
    u32(0), // reserved
    u32(params.movieDuration90k),
    u32(0), u32(0), // reserved[2]
    u16(0), // layer
    u16(0), // alternate_group
    u16(params.isAudio ? 0x0100 : 0x0000), // volume
    u16(0), // reserved
    matrix,
    u32(params.isAudio ? 0 : (params.width << 16) >>> 0),
    u32(params.isAudio ? 0 : (params.height << 16) >>> 0),
  );

  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    u32(0), // creation_time
    u32(0), // modification_time
    u32(params.mediaTimescale),
    u32(params.mediaDuration),
    u16(0x55c4), // 'und' language
    u16(0),
  );

  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    u32(0),
    ascii(params.isAudio ? 'soun' : 'vide'),
    u32(0), u32(0), u32(0),
    ascii(params.isAudio ? 'SoundHandler\0' : 'VideoHandler\0'),
  );

  const mediaHeader = params.isAudio
    ? fullBox('smhd', 0, 0, u16(0), u16(0))
    : fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0));

  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
  const stsd = fullBox('stsd', 0, 0, u32(1), params.stsdEntry);
  const stts = buildStts(params.sampleDeltas);
  // One sample per chunk keeps random seeking and interleaving simple and exact.
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(params.sampleSizes.length), ...params.sampleSizes.map(u32));
  const stco = fullBox('stco', 0, 0, u32(params.chunkOffsets.length), ...params.chunkOffsets.map(u32));

  const stblChildren: Uint8Array[] = [stsd, stts];
  if (!params.isAudio && params.keySampleNumbers && params.keySampleNumbers.length > 0) {
    stblChildren.push(fullBox('stss', 0, 0, u32(params.keySampleNumbers.length), ...params.keySampleNumbers.map(u32)));
  }
  stblChildren.push(stsc, stsz, stco);

  const stbl = box('stbl', ...stblChildren);
  const minf = box('minf', mediaHeader, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  return box('trak', tkhd, mdia);
}

export function muxAvc1ToMp4(input: Mp4MuxInput): Uint8Array {
  const width = Math.max(2, Math.round(input.width / 2) * 2);
  const height = Math.max(2, Math.round(input.height / 2) * 2);
  const fps = Math.max(1, input.fps || 30);
  const defaultFrameTicks = Math.max(1, Math.round(VIDEO_TIMESCALE / fps));

  let foundSps: Uint8Array | null = null;
  let foundPps: Uint8Array | null = null;
  const videoPayloads: Uint8Array[] = [];
  const videoDeltas: number[] = [];
  const videoSizes: number[] = [];
  const keySampleNumbers: number[] = [];

  input.videoSamples.forEach((sample, idx) => {
    const normalized = normalizeAvcSample(sample.data);
    if (!foundSps && normalized.sps) foundSps = normalized.sps;
    if (!foundPps && normalized.pps) foundPps = normalized.pps;
    videoPayloads.push(normalized.avccData);
    videoSizes.push(normalized.avccData.byteLength);
    const ticks =
      sample.durationUs && sample.durationUs > 0
        ? Math.max(1, Math.round((sample.durationUs / 1_000_000) * VIDEO_TIMESCALE))
        : defaultFrameTicks;
    videoDeltas.push(ticks);
    if (sample.isKeyFrame || idx === 0) keySampleNumbers.push(idx + 1);
  });

  const videoDuration90k = videoDeltas.reduce((acc, d) => acc + d, 0);
  const avcC = buildAvcCBox(input.avcDecoderConfigRecord, foundSps, foundPps);
  const compressorName = new Uint8Array(32); // 32 zero bytes
  const avc1Entry = box(
    'avc1',
    new Uint8Array(6), // reserved
    u16(1), // data_reference_index
    u16(0), u16(0), // pre_defined + reserved
    u32(0), u32(0), u32(0), // pre_defined[3]
    u16(width),
    u16(height),
    u32(0x00480000), // horizresolution 72 dpi
    u32(0x00480000), // vertresolution 72 dpi
    u32(0), // reserved
    u16(1), // frame_count
    compressorName,
    u16(0x0018), // depth = 24
    u16(0xffff), // pre_defined = -1
    avcC,
  );

  const hasAudio = Boolean(input.audio && input.audio.samples.length > 0);
  const audioPayloads = hasAudio ? input.audio!.samples.map((s) => s.data) : [];
  const audioSizes = audioPayloads.map((b) => b.byteLength);
  const audioDeltas = hasAudio ? input.audio!.samples.map((s) => s.sampleCount ?? 1024) : [];
  const audioSampleRate = hasAudio ? input.audio!.sampleRate : 48_000;
  const audioChannelCount = hasAudio ? input.audio!.channelCount : 2;
  const audioDurationSamples = audioDeltas.reduce((acc, d) => acc + d, 0);

  const asc = hasAudio
    ? input.audio!.audioSpecificConfig && input.audio!.audioSpecificConfig.byteLength >= 2
      ? input.audio!.audioSpecificConfig
      : defaultAudioSpecificConfig(audioSampleRate, audioChannelCount)
    : new Uint8Array(0);
  const mp4aEntry = hasAudio
    ? box(
        'mp4a',
        new Uint8Array(6),
        u16(1),
        u32(0), u32(0),
        u16(audioChannelCount),
        u16(16), // sampleSize = 16
        u16(0), u16(0),
        u32((audioSampleRate << 16) >>> 0),
        buildEsdsBox(asc),
      )
    : new Uint8Array(0);

  // Relative offsets within `mdat` payload: video samples first, then audio samples.
  const relVideoOffsets: number[] = [];
  let cursor = 0;
  for (const buf of videoPayloads) {
    relVideoOffsets.push(cursor);
    cursor += buf.byteLength;
  }
  const relAudioOffsets: number[] = [];
  for (const buf of audioPayloads) {
    relAudioOffsets.push(cursor);
    cursor += buf.byteLength;
  }

  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso2avc1mp41'));

  const buildMoov = (mdatDataStart: number): Uint8Array => {
    const matrix = concatBytes([
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
    ]);
    const mvhd = fullBox(
      'mvhd',
      0,
      0,
      u32(0), // creation_time
      u32(0), // modification_time
      u32(VIDEO_TIMESCALE), // timescale at mvhd + 16
      u32(videoDuration90k), // duration at mvhd + 20
      u32(0x00010000), // rate = 1.0
      u16(0x0100), // volume = 1.0
      new Uint8Array(10), // reserved
      matrix,
      new Uint8Array(24), // pre_defined[6]
      u32(hasAudio ? 3 : 2), // next_track_ID
    );

    const videoTrak = buildTrackBox({
      trackId: 1,
      movieDuration90k: videoDuration90k,
      mediaTimescale: VIDEO_TIMESCALE,
      mediaDuration: videoDuration90k,
      width,
      height,
      isAudio: false,
      stsdEntry: avc1Entry,
      sampleDeltas: videoDeltas,
      sampleSizes: videoSizes,
      chunkOffsets: relVideoOffsets.map((o) => mdatDataStart + o),
      keySampleNumbers,
    });

    if (!hasAudio) return box('moov', mvhd, videoTrak);

    const audioTrak = buildTrackBox({
      trackId: 2,
      movieDuration90k: videoDuration90k,
      mediaTimescale: audioSampleRate,
      mediaDuration: audioDurationSamples,
      width: 0,
      height: 0,
      isAudio: true,
      stsdEntry: mp4aEntry,
      sampleDeltas: audioDeltas,
      sampleSizes: audioSizes,
      chunkOffsets: relAudioOffsets.map((o) => mdatDataStart + o),
    });

    return box('moov', mvhd, videoTrak, audioTrak);
  };

  // Pass 1 computes exact moov byte size; Pass 2 fills exact `stco` offsets into `mdat`.
  const placeholderMoov = buildMoov(0);
  const mdatDataStart = ftyp.byteLength + placeholderMoov.byteLength + 8;
  const moov = buildMoov(mdatDataStart);
  const mdat = box('mdat', ...videoPayloads, ...audioPayloads);

  return concatBytes([ftyp, moov, mdat]);
}
