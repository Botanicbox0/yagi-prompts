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
