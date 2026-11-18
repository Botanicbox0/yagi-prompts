import { describe, expect, it } from 'vitest';
import { muxAvc1ToMp4 } from '@/lib/brand-studio/compose/mp4-muxer';
import { checkUpload, sniffMime, videoInfo } from '@/lib/brand-studio/files';

describe('muxAvc1ToMp4 (ISO-BMFF faststart H.264 + AAC)', () => {
  it('writes a valid faststart MP4 whose MIME, dimensions, and duration pass checkUpload & videoInfo', () => {
    // Minimal Annex-B keyframe (SPS + PPS + IDR slice) followed by 89 non-IDR frames = 90 frames @ 30fps (3.0s).
    const annexBKey = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5, 0x84,
      0x00, 0x00, 0x00, 0x01, 0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0,
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10, 0xff,
    ]);
    const annexBDelta = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x41, 0x9a, 0x24, 0x6c, 0xff]);

    const videoSamples = Array.from({ length: 90 }, (_, idx) => ({
      data: idx === 0 || idx === 30 || idx === 60 ? annexBKey : annexBDelta,
      isKeyFrame: idx % 30 === 0,
    }));

    const mp4 = muxAvc1ToMp4({
      width: 1920,
      height: 1080,
      fps: 30,
      videoSamples,
      audio: {
        sampleRate: 48_000,
        channelCount: 2,
        samples: Array.from({ length: 140 }, () => ({
          data: new Uint8Array([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]),
          sampleCount: 1024,
        })),
      },
    });

    expect(sniffMime(mp4)).toBe('video/mp4');
    expect(checkUpload(mp4, { mime: 'video/mp4', sizeBytes: mp4.byteLength })).toEqual({
      ok: true,
      mime: 'video/mp4',
      kind: 'video',
    });

    const info = videoInfo(mp4);
    expect(info).toEqual({
      width: 1920,
      height: 1080,
      durationMs: 3000,
    });

    // Faststart invariant: `moov` appears before `mdat`.
    const buf = Buffer.from(mp4.buffer, mp4.byteOffset, mp4.byteLength);
    expect(buf.indexOf('moov', 0, 'latin1')).toBeGreaterThan(0);
    expect(buf.indexOf('moov', 0, 'latin1')).toBeLessThan(buf.indexOf('mdat', 0, 'latin1'));
  });

  it('preserves vertical 1080×1920 dimensions for 9:16 exports', () => {
    const avccFrame = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x00]);
    const mp4 = muxAvc1ToMp4({
      width: 1080,
      height: 1920,
      fps: 30,
      videoSamples: Array.from({ length: 45 }, (_, idx) => ({ data: avccFrame, isKeyFrame: idx === 0 })),
    });
    expect(sniffMime(mp4)).toBe('video/mp4');
    expect(videoInfo(mp4)).toEqual({ width: 1080, height: 1920, durationMs: 1500 });
  });
});

describe('muxAvc1ToMp4 keeps length-prefixed samples byte for byte', () => {
  /** One length-prefixed sample holding a single non-IDR slice NAL of `naluLength` bytes. */
  function avccSample(naluLength: number, fill: number): Uint8Array {
    const out = new Uint8Array(4 + naluLength);
    new DataView(out.buffer).setUint32(0, naluLength, false);
    out[4] = 0x41;
    out.fill(fill, 5);
    return out;
  }

  function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
    return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).indexOf(
      Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength),
    );
  }

  const keyFrame = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x00]);
  const avcDecoderConfigRecord = new Uint8Array([
    1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x02, 0x68, 0xeb,
  ]);

  // A NAL of 256..511 bytes makes the sample begin with 00 00 01 xx, which reads like a 3-byte start
  // code; a NAL of exactly 1 byte begins with 00 00 00 01, the 4-byte start code. Small frames of this
  // size are common (a repeated picture encodes to a few hundred bytes).
  it.each([256, 300, 409, 511])('does not rewrite a sample whose first NAL is %i bytes long', (naluLength) => {
    const small = avccSample(naluLength, 0xab);
    const mp4 = muxAvc1ToMp4({
      width: 1080,
      height: 1920,
      fps: 30,
      avcDecoderConfigRecord,
      videoSamples: [
        { data: keyFrame, isKeyFrame: true },
        { data: small, isKeyFrame: false },
        { data: keyFrame, isKeyFrame: true },
      ],
    });
    expect(indexOfBytes(mp4, small)).toBeGreaterThan(0);
  });

  it('does not rewrite such a sample when the encoder configuration record is missing either', () => {
    const small = avccSample(300, 0xcd);
    const mp4 = muxAvc1ToMp4({
      width: 1080,
      height: 1920,
      fps: 30,
      videoSamples: [
        { data: keyFrame, isKeyFrame: true },
        { data: small, isKeyFrame: false },
      ],
    });
    expect(indexOfBytes(mp4, small)).toBeGreaterThan(0);
  });

  it('keeps a sample made of several length-prefixed NALs whose first length is 256', () => {
    const first = avccSample(256, 0x11);
    const second = avccSample(40, 0x22);
    const sample = new Uint8Array(first.byteLength + second.byteLength);
    sample.set(first, 0);
    sample.set(second, first.byteLength);
    const mp4 = muxAvc1ToMp4({
      width: 1080,
      height: 1920,
      fps: 30,
      avcDecoderConfigRecord,
      videoSamples: [
        { data: keyFrame, isKeyFrame: true },
        { data: sample, isKeyFrame: false },
      ],
    });
    expect(indexOfBytes(mp4, sample)).toBeGreaterThan(0);
  });

  it('still converts start-code samples to length-prefixed ones', () => {
    const annexB = new Uint8Array([0x00, 0x00, 0x01, 0x41, 0x9a, 0x24, 0x6c, 0xff, 0x00, 0x00, 0x00, 0x01, 0x41, 0x9a, 0x01]);
    const mp4 = muxAvc1ToMp4({
      width: 1080,
      height: 1920,
      fps: 30,
      videoSamples: [
        { data: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00]), isKeyFrame: true },
        { data: annexB, isKeyFrame: false },
      ],
    });
    const converted = new Uint8Array([
      0x00, 0x00, 0x00, 0x05, 0x41, 0x9a, 0x24, 0x6c, 0xff, 0x00, 0x00, 0x00, 0x03, 0x41, 0x9a, 0x01,
    ]);
    expect(indexOfBytes(mp4, converted)).toBeGreaterThan(0);
    expect(indexOfBytes(mp4, annexB)).toBe(-1);
  });
});
