import { describe, expect, it } from 'vitest';
import { FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH } from '@/lib/brand-studio/editor-v2/fixture';
import {
  DUCK_DEPTH_DB,
  DUCK_LEVELS,
  PLATFORM_LUFS,
  duckEnvelope,
  envelopeGainAt,
  loudnessReadout,
  soundFindings,
  waveform,
  type SoundState,
} from '@/lib/brand-studio/editor-v2/model';

const BASE: SoundState = { speechClear: false, duck: null, loudness: false, fades: false, musicVolume: 0.8 };
const MUSIC = { id: 't1', label: 'Track', mood: 'calm', durationSec: 62 };

describe('duckEnvelope', () => {
  it('stays flat without a level or without speech', () => {
    expect(duckEnvelope(FIXTURE_SPEECH, 20, null)).toEqual([{ sec: 0, gain: 1 }, { sec: 20, gain: 1 }]);
    expect(duckEnvelope([], 20, 'strong')).toEqual([{ sec: 0, gain: 1 }, { sec: 20, gain: 1 }]);
  });

  it('is empty for a film with no length', () => {
    expect(duckEnvelope(FIXTURE_SPEECH, 0, 'medium')).toEqual([]);
    expect(duckEnvelope(FIXTURE_SPEECH, -1, 'medium')).toEqual([]);
  });

  for (const level of DUCK_LEVELS) {
    it(`sits at -${DUCK_DEPTH_DB[level]} dB under every spoken stretch (${level})`, () => {
      const low = 10 ** (-DUCK_DEPTH_DB[level] / 20);
      const points = duckEnvelope(FIXTURE_SPEECH, 18.9, level);
      for (let i = 1; i < points.length; i += 1) expect(points[i]!.sec).toBeGreaterThanOrEqual(points[i - 1]!.sec);
      for (const p of points) {
        expect(p.gain).toBeGreaterThanOrEqual(low - 0.001);
        expect(p.gain).toBeLessThanOrEqual(1);
        expect(p.sec).toBeGreaterThanOrEqual(0);
        expect(p.sec).toBeLessThanOrEqual(18.9);
      }
      expect(Math.min(...points.map((p) => p.gain))).toBeCloseTo(low, 3);
      for (const region of FIXTURE_SPEECH) {
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          const t = region.startSec + f * (region.endSec - region.startSec);
          expect(envelopeGainAt(points, t), `t=${t}`).toBeCloseTo(low, 3);
        }
        // Well after the stretch (the next one starts 1.6 s or more later), the music is back.
        expect(envelopeGainAt(points, region.endSec + 0.7)).toBe(1);
      }
      expect(envelopeGainAt(points, 0)).toBe(1);
      expect(points.at(-1)).toEqual({ sec: 18.9, gain: 1 });
    });
  }

  it('treats stretches closer than the two ramps as one', () => {
    const points = duckEnvelope([{ startSec: 2, endSec: 3 }, { startSec: 3.5, endSec: 5 }], 10, 'medium');
    const low = Math.round(10 ** (-10 / 20) * 1000) / 1000;
    for (let t = 2; t <= 5; t += 0.1) expect(envelopeGainAt(points, t)).toBeCloseTo(low, 3);
    expect(points.filter((p) => p.gain === 1 && p.sec > 2 && p.sec < 5)).toEqual([]);
  });

  it('clamps stretches to the film', () => {
    const points = duckEnvelope([{ startSec: 8, endSec: 20 }, { startSec: 12, endSec: 15 }], 10, 'light');
    for (const p of points) expect(p.sec).toBeLessThanOrEqual(10);
    expect(points.at(-1)!.sec).toBe(10);
    expect(envelopeGainAt(points, 9)).toBeLessThan(1);
    const outside = duckEnvelope([{ startSec: 12, endSec: 15 }], 10, 'light');
    expect(outside).toEqual([{ sec: 0, gain: 1 }, { sec: 10, gain: 1 }]);
  });

  it('starts low when speech begins at the very start', () => {
    const points = duckEnvelope([{ startSec: 0.1, endSec: 2 }], 10, 'strong');
    expect(points[0]!.gain).toBeLessThan(1);
  });
});

describe('envelopeGainAt', () => {
  const points = [
    { sec: 1, gain: 1 },
    { sec: 2, gain: 0.5 },
    { sec: 2, gain: 0.2 },
    { sec: 4, gain: 0.6 },
  ];
  it('interpolates between points and holds the ends', () => {
    expect(envelopeGainAt([], 3)).toBe(1);
    expect(envelopeGainAt(points, 0)).toBe(1);
    expect(envelopeGainAt(points, 1.5)).toBeCloseTo(0.75, 6);
    expect(envelopeGainAt(points, 3)).toBeCloseTo(0.4, 6);
    expect(envelopeGainAt(points, 9)).toBe(0.6);
  });
});

describe('loudnessReadout', () => {
  it('reads the measurement until loudness is applied', () => {
    expect(loudnessReadout(-19.6, BASE)).toEqual({ lufs: -19.6, onTarget: false });
    expect(loudnessReadout(-14.8, BASE)).toEqual({ lufs: -14.8, onTarget: true });
    expect(loudnessReadout(-19.6, { ...BASE, loudness: true })).toEqual({ lufs: PLATFORM_LUFS, onTarget: true });
  });
});

describe('soundFindings', () => {
  it('flags music over speech and loudness', () => {
    expect(soundFindings({ sound: BASE, music: MUSIC }, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH)).toEqual([
      { kind: 'music_over_speech', count: FIXTURE_SPEECH.length },
      { kind: 'loudness', measured: FIXTURE_MEASURED_LUFS, target: PLATFORM_LUFS },
    ]);
  });

  it('says there is no music', () => {
    expect(soundFindings({ sound: BASE, music: null }, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH)).toEqual([
      { kind: 'loudness', measured: FIXTURE_MEASURED_LUFS, target: PLATFORM_LUFS },
      { kind: 'no_music' },
    ]);
    expect(soundFindings({ sound: { ...BASE, loudness: true }, music: null }, FIXTURE_MEASURED_LUFS, [])).toEqual([{ kind: 'no_music' }]);
  });

  it('lists only what remains', () => {
    expect(soundFindings({ sound: { ...BASE, duck: 'medium' }, music: MUSIC }, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH)).toEqual([
      { kind: 'loudness', measured: FIXTURE_MEASURED_LUFS, target: PLATFORM_LUFS },
    ]);
    expect(soundFindings({ sound: { ...BASE, loudness: true }, music: MUSIC }, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH)).toEqual([
      { kind: 'music_over_speech', count: FIXTURE_SPEECH.length },
    ]);
    expect(
      soundFindings({ sound: { ...BASE, duck: 'medium', loudness: true }, music: MUSIC }, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH),
    ).toEqual([]);
    expect(soundFindings({ sound: BASE, music: MUSIC }, FIXTURE_MEASURED_LUFS, [])).toEqual([
      { kind: 'loudness', measured: FIXTURE_MEASURED_LUFS, target: PLATFORM_LUFS },
    ]);
  });
});

describe('waveform', () => {
  it('is deterministic, the right length and inside 0.12..1', () => {
    for (const seed of [0, 1, 7, 12345, -9, 2.5]) {
      const a = waveform(seed, 64);
      expect(a).toEqual(waveform(seed, 64));
      expect(a).toHaveLength(64);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(0.12);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(waveform(3, 0)).toEqual([]);
    expect(waveform(1, 32)).not.toEqual(waveform(2, 32));
  });
});
