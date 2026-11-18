import { describe, expect, it } from 'vitest';
import { muxAvc1ToMp4 } from '@/lib/brand-studio/compose/mp4-muxer';
import { videoFrameRate, videoInfo } from '@/lib/brand-studio/files';
import { mp4, track } from '@/tests/helpers/mp4-boxes';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the frame rate read from an MP4/MOV's own boxes at delivery and upload.
 * The files are built here byte by byte: ftyp, the picture data, and a moov with one or two tracks whose
 * `mdhd` gives the time scale and whose `stts` gives the samples and their durations.
 */
describe('the frame rate in the file', () => {
  it('reads 23.976 from a 24000 time scale with 1001-tick samples', () => {
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[240, 1001]])] }))).toBe(23.976);
  });

  it('reads 30, 25, 29.97 and 59.94 the same way', () => {
    expect(videoFrameRate(mp4({ tracks: [track('vide', 15_360, [[90, 512]])] }))).toBe(30);
    expect(videoFrameRate(mp4({ tracks: [track('vide', 12_800, [[125, 512]])] }))).toBe(25);
    expect(videoFrameRate(mp4({ tracks: [track('vide', 30_000, [[300, 1001]])] }))).toBe(29.97);
    expect(videoFrameRate(mp4({ tracks: [track('vide', 60_000, [[600, 1001]])] }))).toBe(59.94);
  });

  it('averages several stts entries, and snaps a near-common average', () => {
    // 23 samples of 1000 ticks and one of 1010 at 24 000 per second: 23.990 fps on average, nearer 24 than 23.976.
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[23, 1000], [1, 1010]])] }))).toBe(24);
    // 23 of 1000 and one of 1024: exactly 24000/1001.
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[23, 1000], [1, 1024]])] }))).toBe(23.976);
    // A slow, uncommon rate stays as measured.
    expect(videoFrameRate(mp4({ tracks: [track('vide', 1_000, [[25, 80]])] }))).toBe(12.5);
  });

  it('finds the moov at the end of the file, a 64-bit box and a version 1 mdhd', () => {
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[48, 1001]])], moovAtEnd: true }))).toBe(23.976);
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[48, 1001]])], moovAtEnd: true, largeMdat: true }))).toBe(23.976);
    expect(videoFrameRate(mp4({ tracks: [track('vide', 90_000, [[60, 3000]], 1)] }))).toBe(30);
  });

  it('takes the picture track, not the sound before it', () => {
    expect(videoFrameRate(mp4({ tracks: [track('soun', 48_000, [[100, 1024]]), track('vide', 25, [[50, 1]])] }))).toBe(25);
  });

  it('gives null for a fragmented file, no picture track, a single picture, or bytes that are not a film', () => {
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[0, 1001]])], fragmented: true }))).toBeNull();
    expect(videoFrameRate(mp4({ tracks: [track('soun', 48_000, [[100, 1024]])] }))).toBeNull();
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [[1, 1001]])] }))).toBeNull();
    expect(videoFrameRate(mp4({ tracks: [track('vide', 24_000, [])] }))).toBeNull();
    expect(videoFrameRate(Uint8Array.from(Buffer.from('not a film at all, but long enough to read', 'latin1')))).toBeNull();
    expect(videoFrameRate(new Uint8Array(0))).toBeNull();
  });

  it('gives null rather than reading past a cut-off file', () => {
    const whole = mp4({ tracks: [track('vide', 24_000, [[240, 1001]])], moovAtEnd: true });
    expect(videoFrameRate(whole.subarray(0, whole.byteLength - 20))).toBeNull();
  });

  it('reads the studio muxer output and leaves videoInfo as it was', () => {
    const frame = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x00]);
    const film = muxAvc1ToMp4({ width: 1080, height: 1920, fps: 30, videoSamples: Array.from({ length: 45 }, (_, i) => ({ data: frame, isKeyFrame: i === 0 })) });
    expect(videoFrameRate(film)).toBe(30);
    expect(videoInfo(film)).toEqual({ width: 1080, height: 1920, durationMs: 1500 });
  });
});
