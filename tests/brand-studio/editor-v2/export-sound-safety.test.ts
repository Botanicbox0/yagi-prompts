import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND_BYTES_LIMIT, soundBytesCheck, soundReads } from '@/lib/brand-studio/editor-v2/export-plan';
import { soundTrackOf } from '@/lib/brand-studio/editor-v2/media-probe';
import type { FrameClip, FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';

/**
 * Review round 1, item 10: the export must not make a clip silent without a word, and must not let a
 * tab die reading sources too large to hold.
 *  - A clip whose bytes HAVE a sound track that cannot be decoded is named in a warning; a clip with no
 *    sound track is simply silent. The bytes are inspected for a sound track (MP4/MOV boxes, WebM tracks).
 *  - Before the export starts, the sizes of everything it will read for sound are added up; above the
 *    limit it refuses with a plain sentence.
 */

// ── A tiny ISO-BMFF writer for the tests ──
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, ...children: number[][]) => {
  const body = children.flat();
  return [...u32(8 + body.length), ...ascii(type), ...body];
};
const hdlr = (handler: string) => box('hdlr', [0, 0, 0, 0], u32(0), ascii(handler), u32(0), u32(0), u32(0), [0]);
const trak = (handler: string) => box('trak', box('tkhd', new Array(84).fill(0)), box('mdia', box('mdhd', new Array(24).fill(0)), hdlr(handler)));
const mp4 = (...handlers: string[]) => new Uint8Array([...box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso2mp41')), ...box('moov', box('mvhd', new Array(100).fill(0)), ...handlers.map(trak)), ...box('mdat', new Array(64).fill(7))]);

describe('is there a sound track in these bytes', () => {
  it('reads MP4 / MOV boxes: a sound handler is a sound track', () => {
    expect(soundTrackOf(mp4('vide', 'soun'))).toBe('yes');
    expect(soundTrackOf(mp4('vide'))).toBe('no');
    expect(soundTrackOf(mp4('soun'))).toBe('yes');
  });

  it('finds the movie box after the media data too (files written without moving it to the front)', () => {
    const tail = new Uint8Array([...box('ftyp', ascii('isom'), u32(0)), ...box('mdat', new Array(4000).fill(1)), ...box('moov', trak('vide'), trak('soun'))]);
    expect(soundTrackOf(tail)).toBe('yes');
  });

  it('a 64-bit box size is followed correctly', () => {
    const big = [...u32(1), ...ascii('mdat'), ...u32(0), ...u32(16 + 32), ...new Array(32).fill(0)];
    expect(soundTrackOf(new Uint8Array([...box('ftyp', ascii('isom'), u32(0)), ...big, ...box('moov', trak('soun'))]))).toBe('yes');
  });

  it('WebM: an audio track type is a sound track; video only is none', () => {
    const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x84, 0x77];
    const tracks = (...types: number[]) => [0x16, 0x54, 0xae, 0x6b, 0x90, ...types.flatMap((t) => [0xae, 0x83, 0x83, 0x81, t])];
    expect(soundTrackOf(new Uint8Array([...ebml, ...tracks(1, 2)]))).toBe('yes');
    expect(soundTrackOf(new Uint8Array([...ebml, ...tracks(1)]))).toBe('no');
  });

  it('cannot tell: not a container it knows, cut off, or broken', () => {
    expect(soundTrackOf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe('unknown');
    expect(soundTrackOf(new Uint8Array(0))).toBe('unknown');
    const cut = mp4('vide', 'soun').slice(0, 60);
    expect(soundTrackOf(cut)).toBe('unknown');
    const lying = new Uint8Array([...u32(0xfffffff0), ...ascii('moov'), ...trak('soun')]);
    expect(soundTrackOf(lying)).toBe('unknown');
  });
});

describe('the sources the export reads for sound, and their size', () => {
  const clip = (id: string, srcUrl: string, extra: Partial<FrameClip> = {}): FrameClip => ({
    id, label: id, srcUrl, thumbUrl: null, sourceFps: 24, sourceFrames: 240, inFrame: 0, phase: 0, frames: 24, speedNum: 1, speedDen: 1, volume: 1, muted: false, ...extra,
  });
  const sequence: FrameSequence = {
    fps: 24,
    aspect: '9:16',
    captions: [],
    clips: [clip('a', '/a.mp4'), clip('b', '/a.mp4'), clip('c', '/c.mp4', { muted: true }), clip('d', '/d.mp4', { volume: 0 }), clip('e', '/e.mp4')],
  };
  const extras = {
    bgm: { label: 'm', sourceKind: 'asset', srcUrl: '/m.mp3', durationSec: 30, trimStartSec: 0, volume: 0.5 },
    sfxClips: [
      { id: 'f1', label: 'f1', sourceKind: 'asset', srcUrl: '/f1.mp3', startSec: 0, durationSec: 1, volume: 1 },
      { id: 'f2', label: 'f2', sourceKind: 'asset', srcUrl: '/f2.mp3', startSec: 0, durationSec: 1, volume: 0 },
    ],
  } as unknown as ComposerProject;

  it('only what is mixed: heard cuts once each, music and effects that are not silent', () => {
    expect(soundReads(sequence, extras)).toEqual(['/a.mp4', '/e.mp4', '/m.mp3', '/f1.mp3']);
    expect(soundReads(sequence, null)).toEqual(['/a.mp4', '/e.mp4']);
  });

  it('adds the sizes up and refuses above the limit; an unknown size is counted as unknown, not as zero bytes refused', () => {
    expect(SOUND_BYTES_LIMIT).toBe(1024 ** 3);
    expect(soundBytesCheck([100, 200, null])).toEqual({ total: 300, unknown: 1, over: false });
    expect(soundBytesCheck([SOUND_BYTES_LIMIT, 1])).toMatchObject({ over: true });
    expect(soundBytesCheck([SOUND_BYTES_LIMIT])).toMatchObject({ over: false });
    expect(soundBytesCheck([600 * 1024 ** 2, 500 * 1024 ** 2])).toMatchObject({ over: true });
  });
});

describe('the exporter uses them', () => {
  const source = readFileSync(join(process.cwd(), 'components/brand-studio/editor-v2/export-film.ts'), 'utf8');

  it('checks the sizes before the first frame, and inspects the bytes before decoding them', () => {
    const run = source.slice(source.indexOf('export async function exportFilm('));
    expect(run.indexOf('soundBytesCheck(')).toBeGreaterThan(-1);
    expect(run.indexOf('soundBytesCheck(')).toBeLessThan(run.indexOf('for (const entry of plan)'));
    const mix = source.slice(source.indexOf('async function mixSound('), source.indexOf('async function encodeAac('));
    expect(mix.indexOf('soundTrackOf(')).toBeGreaterThan(-1);
    expect(mix.indexOf('soundTrackOf(')).toBeLessThan(mix.indexOf('decodeAudioData('));
  });
});
