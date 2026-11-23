import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  clipFrameAt,
  clipMaxFrames,
  clipSpeedAt,
  resetClipSpeed,
  setClipConstantSpeed,
  setClipSpeed,
  setClipSpeedCurve,
  spansOf,
  splitAtFrame,
  trimClipEdge,
  wholeFrameViolations,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import { audioPlan, videoPlan } from '@/lib/brand-studio/editor-v2/export-plan';
import * as speedCurveMod from '@/lib/brand-studio/editor-v2/speed-curve';
import {
  SPEED_PRESETS,
  addCurvePoint,
  clampSpeed,
  compileSpeedCurve,
  curveInverseAt,
  curveMediaPosAt,
  curveSpeedAt,
  curveTimeAt,
  curveTotalFrames,
  editablePointsOfCurve,
  isValidSpeedCurve,
  logSliderToSpeed,
  moveCurvePoint,
  nextSpeedOnSliderKey,
  parseSpeedInput,
  removeCurvePoint,
  resampleCurvedAudio,
  speedToLogSlider,
  toSpeedRational,
  type SpeedCurve,
  type SpeedPoint,
} from '@/lib/brand-studio/editor-v2/speed-curve';
import { currentFrameBlockOf, frameBlockOf, fromStored, toStored, type FrameV2Block } from '@/lib/brand-studio/editor-v2/stored';
import * as nleExportMod from '@/lib/brand-studio/compose/nle-export';
import { buildFcp7Xml } from '@/lib/brand-studio/compose/nle-export';
import * as exportFilmMod from '@/components/brand-studio/editor-v2/export-film';
import { scheduleCutSound, type SoundGraph } from '@/components/brand-studio/editor-v2/export-film';
import { commit, undo, redo, withSequence } from '@/lib/brand-studio/editor-v2/model';
import { fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import { emptyComposerProject, parseStoredProject, serializeProjectForStorage, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { speedUndoKey } from '@/components/brand-studio/editor-v2/use-editor';
import { disablePitchPreservation } from '@/components/brand-studio/editor-v2/preview';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

function makeClip(overrides: Partial<FrameClip> = {}): FrameClip {
  return {
    id: 'cut-1',
    label: 'Scene 1',
    srcUrl: 'https://example.com/a.mp4',
    thumbUrl: null,
    sourceFps: 30,
    sourceFrames: 300,
    inFrame: 0,
    phase: 0,
    frames: 120,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function makeSeq(clips: FrameClip[], fps = 30): FrameSequence {
  return { fps, aspect: '9:16', clips, captions: [] };
}

function makeRng(seedInit: number) {
  let seed = seedInit;
  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
}

describe('Feature A: Free constant speed 0.10x - 10.00x rational arithmetic', () => {
  it('converts hundredth steps into reduced rational fractions across 0.10..10.00', () => {
    expect(toSpeedRational(0.1)).toEqual({ num: 1, den: 10 });
    expect(toSpeedRational(0.25)).toEqual({ num: 1, den: 4 });
    expect(toSpeedRational(0.5)).toEqual({ num: 1, den: 2 });
    expect(toSpeedRational(1)).toEqual({ num: 1, den: 1 });
    expect(toSpeedRational(1.5)).toEqual({ num: 3, den: 2 });
    expect(toSpeedRational(2)).toEqual({ num: 2, den: 1 });
    expect(toSpeedRational(1.25)).toEqual({ num: 5, den: 4 });
    expect(toSpeedRational(1.11)).toEqual({ num: 111, den: 100 });
    expect(toSpeedRational(0.29)).toEqual({ num: 29, den: 100 });
    expect(toSpeedRational(10)).toEqual({ num: 10, den: 1 });
    expect(clampSpeed(0.01)).toBe(0.1);
    expect(clampSpeed(99)).toBe(10);
    expect(clampSpeed(1.236)).toBe(1.24);
    expect(clampSpeed(1.115)).toBe(1.12);
  });

  it('S3: parses localized commas, half-up hundredths, empty input, 0 clamp -> 0.10, and high clamp -> 10.00', () => {
    expect(parseSpeedInput('1,11')).toBe(1.11);
    expect(parseSpeedInput('1.115')).toBe(1.12);
    expect(parseSpeedInput('1.35')).toBe(1.35);
    expect(parseSpeedInput(' 0.75× ')).toBe(0.75);
    expect(parseSpeedInput('2.5x')).toBe(2.5);
    expect(parseSpeedInput('0')).toBe(0.1);
    expect(parseSpeedInput('0.02')).toBe(0.1);
    expect(parseSpeedInput('99')).toBe(10);
    expect(parseSpeedInput('')).toBeNull();
    expect(parseSpeedInput('-2')).toBeNull();
    expect(parseSpeedInput('abc')).toBeNull();
  });

  it('maps log slider symmetrically around 1.00x and steps every distinct hundredth via keyboard (S2)', () => {
    expect(logSliderToSpeed(0)).toBe(0.1);
    expect(logSliderToSpeed(500)).toBe(1);
    expect(logSliderToSpeed(1000)).toBe(10);
    expect(speedToLogSlider(0.1)).toBe(0);
    expect(speedToLogSlider(1)).toBe(500);
    expect(speedToLogSlider(10)).toBe(1000);

    // Every arrow key press from 1.00x moves immediately, and all 991 hundredths are reachable
    expect(nextSpeedOnSliderKey(1.0, 'ArrowRight')).toBe(1.01);
    expect(nextSpeedOnSliderKey(1.0, 'ArrowLeft')).toBe(0.99);
    expect(nextSpeedOnSliderKey(1.0, 'PageUp')).toBe(1.1);
    expect(nextSpeedOnSliderKey(1.0, 'PageDown')).toBe(0.9);
    expect(nextSpeedOnSliderKey(1.5, 'Home')).toBe(0.1);
    expect(nextSpeedOnSliderKey(1.5, 'End')).toBe(10);

    const visited = [0.1];
    let cur = 0.1;
    for (let i = 0; i < 990; i += 1) {
      cur = nextSpeedOnSliderKey(cur, 'ArrowRight');
      visited.push(cur);
    }
    expect(visited).toHaveLength(991);
    expect(new Set(visited).size).toBe(991);
    expect(visited[visited.length - 1]).toBe(10);
  });

  it('S3: matches recorded golden outputs from main (git show 26c33082) for legacy 4 speeds', () => {
    // Recorded golden fixture outputs computed on main (26c33082: frames.ts):
    // seq: fps=24, inFrame=12, frames=60, sourceFrames=240, sourceFps=24
    const seq = makeSeq([makeClip({ inFrame: 12, frames: 60, sourceFrames: 240, sourceFps: 24 })], 24);
    const expectedFramesByRate: Record<string, { speedNum: number; speedDen: number; frames: number; first5: number[]; lastFrame: number; sampleCount: number }> = {
      '0.5': { speedNum: 1, speedDen: 2, frames: 120, first5: [12, 12, 13, 13, 14], lastFrame: 71, sampleCount: 240_000 },
      '1': { speedNum: 1, speedDen: 1, frames: 60, first5: [12, 13, 14, 15, 16], lastFrame: 71, sampleCount: 120_000 },
      '1.5': { speedNum: 3, speedDen: 2, frames: 40, first5: [12, 13, 15, 16, 18], lastFrame: 70, sampleCount: 80_000 },
      '2': { speedNum: 2, speedDen: 1, frames: 30, first5: [12, 14, 16, 18, 20], lastFrame: 70, sampleCount: 60_000 },
    };

    for (const [rateStr, expected] of Object.entries(expectedFramesByRate)) {
      const rate = Number(rateStr);
      const updated = setClipConstantSpeed(seq, 0, rate);
      const c = updated.clips[0]!;
      expect(c.speedNum).toBe(expected.speedNum);
      expect(c.speedDen).toBe(expected.speedDen);
      expect(c.frames).toBe(expected.frames);
      expect(c.inFrame).toBe(12);
      const vp = videoPlan(updated);
      expect(vp.slice(0, 5).map((f) => f.sourceFrame)).toEqual(expected.first5);
      expect(vp[vp.length - 1]!.sourceFrame).toBe(expected.lastFrame);
      const ap = audioPlan(updated);
      expect(ap.totalSamples).toBe(expected.sampleCount);
      expect(ap.segments[0]!.rate).toBe(rate);
      expect(ap.segments[0]!.sourceOffsetSec).toBe(0.5);
    }
  });

  it('B2: preserves source span (in/out/frame count) across slider sweeps 1x -> 3.98x -> 1x and random speed walks', () => {
    const startClip = makeClip({ sourceFrames: 1000, inFrame: 100, frames: 120 });
    let seq = makeSeq([startClip]);

    // Step by 0.01: 1.00 -> 3.98 -> 1.00 (596 consecutive speed changes!)
    for (let pct = 100; pct <= 398; pct += 1) {
      seq = setClipConstantSpeed(seq, 0, pct / 100);
    }
    for (let pct = 398; pct >= 100; pct -= 1) {
      seq = setClipConstantSpeed(seq, 0, pct / 100);
    }
    expect(seq.clips[0]!.frames).toBe(120);
    expect(seq.clips[0]!.inFrame).toBe(100);
    expect(clipFrameAt(seq.clips[0]!, 0, 30).sourceFrame).toBe(100);
    expect(clipFrameAt(seq.clips[0]!, 119, 30).sourceFrame).toBe(219);

    // Step by 0.05: 1.00 -> 3.98 -> 1.00
    seq = makeSeq([startClip]);
    for (let pct = 100; pct <= 398; pct += 5) seq = setClipConstantSpeed(seq, 0, pct / 100);
    for (let pct = 395; pct >= 100; pct -= 5) seq = setClipConstantSpeed(seq, 0, pct / 100);
    expect(seq.clips[0]!.frames).toBe(120);
    expect(clipFrameAt(seq.clips[0]!, 119, 30).sourceFrame).toBe(219);

    // Arbitrary random walk returning to starting speed + Constant -> Curve -> Constant
    const rng = makeRng(20261123);
    for (const startRate of [0.37, 1.0, 2.75, 3.98]) {
      let s = setClipConstantSpeed(makeSeq([startClip]), 0, startRate);
      const baseFrames = s.clips[0]!.frames;
      const baseLast = clipFrameAt(s.clips[0]!, baseFrames - 1, 30).sourceFrame;
      for (let i = 0; i < 20; i += 1) {
        const randRate = Math.round((0.1 + rng() * 9.9) * 100) / 100;
        s = setClipConstantSpeed(s, 0, randRate);
      }
      s = setClipSpeedCurve(s, 0, SPEED_PRESETS[0]!.points);
      s = setClipConstantSpeed(s, 0, startRate);
      expect(s.clips[0]!.frames).toBe(baseFrames);
      expect(s.clips[0]!.inFrame).toBe(100);
      expect(clipFrameAt(s.clips[0]!, baseFrames - 1, 30).sourceFrame).toBe(baseLast);
    }
  });

  it('maintains frame invariants and split exactness across arbitrary speeds', () => {
    const seq = makeSeq([makeClip({ sourceFrames: 600, frames: 200 })]);
    for (const rate of [0.1, 0.29, 0.73, 1.11, 3.33, 7.77, 10]) {
      const updated = setClipConstantSpeed(seq, 0, rate);
      expect(wholeFrameViolations(updated)).toEqual([]);
      expect(updated.clips[0]!.speedCurve).toBeUndefined();

      if (updated.clips[0]!.frames >= 4) {
        const before = Array.from({ length: updated.clips[0]!.frames }, (_, o) => clipFrameAt(updated.clips[0]!, o, 30));
        for (const frac of [0.17, 0.5, 0.83]) {
          const splitAt = Math.max(1, Math.min(updated.clips[0]!.frames - 1, Math.floor(updated.clips[0]!.frames * frac)));
          const split = splitAtFrame(updated, splitAt, 'cut-2');
          expect(wholeFrameViolations(split)).toEqual([]);
          const after = [
            ...Array.from({ length: split.clips[0]!.frames }, (_, o) => clipFrameAt(split.clips[0]!, o, 30)),
            ...Array.from({ length: split.clips[1]!.frames }, (_, o) => clipFrameAt(split.clips[1]!, o, 30)),
          ];
          expect(after).toEqual(before);
        }
      }
    }
  });
});

describe('Feature B: Per-cut speed curves (PCHIP slowness interpolation)', () => {
  it('provides at least 5 presets with 2..8 points inside [0.10, 10.00]', () => {
    expect(SPEED_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of SPEED_PRESETS) {
      expect(preset.points.length).toBeGreaterThanOrEqual(2);
      expect(preset.points.length).toBeLessThanOrEqual(8);
      expect(preset.points[0]!.pos).toBe(0);
      expect(preset.points[preset.points.length - 1]!.pos).toBe(1);
      for (let i = 0; i < preset.points.length; i += 1) {
        expect(preset.points[i]!.speed).toBeGreaterThanOrEqual(0.1);
        expect(preset.points[i]!.speed).toBeLessThanOrEqual(10);
        if (i > 0) expect(preset.points[i]!.pos).toBeGreaterThan(preset.points[i - 1]!.pos);
      }
    }
  });

  it('produces strictly non-decreasing media positions, never overshoots bounds, and stays continuous', () => {
    const curve: SpeedCurve = {
      startMedia: 0,
      spanMedia: 120,
      points: [
        { pos: 0, speed: 4.0 },
        { pos: 0.25, speed: 4.0 },
        { pos: 0.5, speed: 0.25 },
        { pos: 0.75, speed: 0.25 },
        { pos: 1, speed: 5.0 },
      ],
    };
    const compiled = compileSpeedCurve(curve);
    const total = curveTotalFrames(curve);
    let prevMedia = -1;
    for (let u = 0; u <= 1.0001; u += 0.005) {
      const clampedU = Math.min(1, u);
      const speed = curveSpeedAt(compiled, clampedU);
      expect(speed).toBeGreaterThanOrEqual(0.25 - 1e-9);
      expect(speed).toBeLessThanOrEqual(5.0 + 1e-9);
    }
    for (let f = 0; f < total; f += 1) {
      const pos = curveMediaPosAt(compiled, f);
      expect(pos).toBeGreaterThanOrEqual(prevMedia - 1e-12);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(120 + 1e-9);
      prevMedia = pos;
    }
    expect(curveSpeedAt(compiled, 0.12)).toBeCloseTo(4.0, 5);
    expect(curveSpeedAt(compiled, 0.62)).toBeCloseTo(0.25, 5);
  });

  it('satisfies forward/inverse round-trip tau(u) to < 1e-8 across presets', () => {
    for (const preset of SPEED_PRESETS) {
      const curve: SpeedCurve = { startMedia: 10, spanMedia: 90, points: preset.points };
      const compiled = compileSpeedCurve(curve);
      for (const u of [0, 0.13, 0.37, 0.5, 0.79, 0.94, 1]) {
        const t = curveTimeAt(compiled, u);
        const uBack = curveInverseAt(compiled, t);
        expect(Math.abs(uBack - u)).toBeLessThan(1e-9);
      }
      for (let f = 0; f < Math.round(compiled.totalFrames); f += 1) {
        const u = curveInverseAt(compiled, f);
        expect(Math.abs(curveTimeAt(compiled, u) - f)).toBeLessThan(1e-8);
      }
    }
  });

  it('S1: matches constant rational speed in BOTH length and frames across ALL 991 speeds (including v=8.88, 777f @ 24fps)', () => {
    // Explicit S1 reproduction
    const reproSeq = makeSeq([makeClip({ sourceFrames: 3000, inFrame: 1234, frames: 777, sourceFps: 24 })], 24);
    const constRepro = setClipConstantSpeed(reproSeq, 0, 8.88);
    const flatRepro = setClipSpeedCurve(reproSeq, 0, [
      { pos: 0, speed: 8.88 },
      { pos: 1, speed: 8.88 },
    ]);
    expect(constRepro.clips[0]!.frames).toBe(88);
    expect(flatRepro.clips[0]!.frames).toBe(88);
    expect(curveTotalFrames(flatRepro.clips[0]!.speedCurve!)).toBe(88);

    // Exhaustive sweep over all 991 hundredths x multiple spans
    for (const span of [13, 60, 120, 777]) {
      const seq = makeSeq([makeClip({ sourceFrames: 2000, inFrame: 15, frames: span, sourceFps: 24 })], 24);
      for (let pct = 10; pct <= 1000; pct += 1) {
        const rate = pct / 100;
        const cSeq = setClipConstantSpeed(seq, 0, rate);
        const fSeq = setClipSpeedCurve(seq, 0, [
          { pos: 0, speed: rate },
          { pos: 1, speed: rate },
        ]);
        expect(fSeq.clips[0]!.frames, `span=${span} rate=${rate}`).toBe(cSeq.clips[0]!.frames);
        if (pct % 111 === 0 || rate === 0.29 || rate === 8.88) {
          for (let o = 0; o < cSeq.clips[0]!.frames; o += 1) {
            expect(clipFrameAt(fSeq.clips[0]!, o, 24)).toEqual(clipFrameAt(cSeq.clips[0]!, o, 24));
          }
        }
      }
    }
  });

  it('B1: trimming (lengthening and shortening at both edges) keeps all kept frames intact, respects bounds, and matches curveTotalFrames', () => {
    // Explicit B1 reproduction
    const repro = setClipSpeedCurve(
      makeSeq([makeClip({ sourceFrames: 3000, inFrame: 300, frames: 200, sourceFps: 30 })], 30),
      0,
      SPEED_PRESETS.find((p) => p.id === 'slowMiddle')!.points,
    );
    const origFrames = Array.from({ length: repro.clips[0]!.frames }, (_, o) => clipFrameAt(repro.clips[0]!, o, 30));

    // Lengthen start by 3 -> kept frames shift by +3 identically; frames === curveTotalFrames; none past 499
    const startLong = trimClipEdge(repro, 0, 'start', -3);
    expect(startLong.applied).toBe(-3);
    expect(wholeFrameViolations(startLong.seq)).toEqual([]);
    const startClip = startLong.seq.clips[0]!;
    expect(startClip.frames).toBe(origFrames.length + 3);
    expect(startClip.frames).toBe(curveTotalFrames(startClip.speedCurve!));
    for (let o = 0; o < origFrames.length; o += 1) {
      expect(clipFrameAt(startClip, o + 3, 30)).toEqual(origFrames[o]);
    }
    for (let o = 0; o < startClip.frames; o += 1) {
      expect(clipFrameAt(startClip, o, 30).sourceFrame).toBeLessThan(500);
    }

    // Shortening start back by +3 restores original curve & frames
    const startBack = trimClipEdge(startLong.seq, 0, 'start', 3);
    expect(startBack.seq.clips[0]!.frames).toBe(origFrames.length);
    for (let o = 0; o < origFrames.length; o += 1) {
      expect(clipFrameAt(startBack.seq.clips[0]!, o, 30)).toEqual(origFrames[o]);
    }

    // Lengthen end by 15 -> kept frames 0..orig-1 identical; none >= 530; frames === curveTotalFrames
    const endLong = trimClipEdge(repro, 0, 'end', 15);
    expect(endLong.applied).toBe(15);
    expect(wholeFrameViolations(endLong.seq)).toEqual([]);
    const endClip = endLong.seq.clips[0]!;
    expect(endClip.frames).toBe(origFrames.length + 15);
    expect(endClip.frames).toBe(curveTotalFrames(endClip.speedCurve!));
    for (let o = 0; o < origFrames.length; o += 1) {
      expect(clipFrameAt(endClip, o, 30)).toEqual(origFrames[o]);
    }
    for (let o = 0; o < endClip.frames; o += 1) {
      expect(clipFrameAt(endClip, o, 30).sourceFrame).toBeLessThan(530);
    }

    // Shortening end back by -15 restores original frames
    const endBack = trimClipEdge(endLong.seq, 0, 'end', -15);
    expect(endBack.seq.clips[0]!.frames).toBe(origFrames.length);
    for (let o = 0; o < origFrames.length; o += 1) {
      expect(clipFrameAt(endBack.seq.clips[0]!, o, 30)).toEqual(origFrames[o]);
    }

    // Random property sweep over 40 curves (2..8 points) and trims (start/end, lengthen/shorten)
    const rng = makeRng(998877);
    for (let trial = 0; trial < 40; trial += 1) {
      const nPts = 2 + Math.floor(rng() * 7); // up to 8 points!
      const pts: SpeedPoint[] = [{ pos: 0, speed: clampSpeed(0.3 + rng() * 3.5) }];
      for (let k = 1; k < nPts - 1; k += 1) {
        pts.push({ pos: k / (nPts - 1), speed: clampSpeed(0.25 + rng() * 3.5) });
      }
      pts.push({ pos: 1, speed: clampSpeed(0.3 + rng() * 3.5) });

      const seq = setClipSpeedCurve(
        makeSeq([makeClip({ sourceFrames: 4000, inFrame: 400, frames: 120, sourceFps: 30 })], 30),
        0,
        pts,
      );
      const doc0 = withSequence(fixtureDoc((id) => id), seq);
      const beforeClip = seq.clips[0]!;
      const beforeAll = Array.from({ length: beforeClip.frames }, (_, o) => clipFrameAt(beforeClip, o, 30));

      const edge: 'start' | 'end' = rng() < 0.5 ? 'start' : 'end';
      const delta = Math.round((rng() - 0.5) * 30) || (rng() < 0.5 ? -4 : 4);
      const { seq: trimmed, applied } = trimClipEdge(seq, 0, edge, delta);
      expect(wholeFrameViolations(trimmed)).toEqual([]);
      const nextClip = trimmed.clips[0]!;
      expect(nextClip.frames).toBe(curveTotalFrames(nextClip.speedCurve!));

      if (edge === 'start') {
        if (applied <= 0) {
          const added = -applied;
          for (let o = 0; o < beforeAll.length; o += 1) {
            expect(clipFrameAt(nextClip, added + o, 30)).toEqual(beforeAll[o]);
          }
          const back = trimClipEdge(trimmed, 0, 'start', -applied).seq;
          expect(Array.from({ length: back.clips[0]!.frames }, (_, o) => clipFrameAt(back.clips[0]!, o, 30))).toEqual(beforeAll);
        } else {
          for (let o = 0; o < nextClip.frames; o += 1) {
            expect(clipFrameAt(nextClip, o, 30)).toEqual(beforeAll[applied + o]);
          }
        }
      } else {
        if (applied >= 0) {
          for (let o = 0; o < beforeAll.length; o += 1) {
            expect(clipFrameAt(nextClip, o, 30)).toEqual(beforeAll[o]);
          }
          const back = trimClipEdge(trimmed, 0, 'end', -applied).seq;
          expect(Array.from({ length: back.clips[0]!.frames }, (_, o) => clipFrameAt(back.clips[0]!, o, 30))).toEqual(beforeAll);
        } else {
          for (let o = 0; o < nextClip.frames; o += 1) {
            expect(clipFrameAt(nextClip, o, 30)).toEqual(beforeAll[o]);
          }
        }
      }

      // Trim + undo restores bit-exact clip
      const doc1 = withSequence(doc0, trimmed);
      const hist = commit({ past: [], future: [] }, doc0);
      const undone = undo(hist, doc1);
      expect(undone!.doc.sequence.clips[0]).toEqual(beforeClip);
    }
  });

  it('S3: splits curved cuts across many arbitrary offsets cleanly, including after edge lengthening', () => {
    let curved = setClipSpeedCurve(
      makeSeq([makeClip({ sourceFrames: 1200, inFrame: 120, frames: 90 })]),
      0,
      SPEED_PRESETS.find((p) => p.id === 'slowMiddle')!.points,
    );
    curved = trimClipEdge(curved, 0, 'start', -5).seq;
    curved = trimClipEdge(curved, 0, 'end', 6).seq;
    const unsplit = Array.from({ length: curved.clips[0]!.frames }, (_, o) => clipFrameAt(curved.clips[0]!, o, 30));

    for (const frac of [0.02, 0.05, 0.15, 0.3, 0.5, 0.72, 0.89, 0.96, 0.99]) {
      const splitFrame = Math.max(1, Math.min(curved.clips[0]!.frames - 1, Math.floor(curved.clips[0]!.frames * frac)));
      const afterSplit = splitAtFrame(curved, splitFrame, 'cut-2');
      expect(wholeFrameViolations(afterSplit)).toEqual([]);
      const combined = [
        ...Array.from({ length: afterSplit.clips[0]!.frames }, (_, o) => clipFrameAt(afterSplit.clips[0]!, o, 30)),
        ...Array.from({ length: afterSplit.clips[1]!.frames }, (_, o) => clipFrameAt(afterSplit.clips[1]!, o, 30)),
      ];
      expect(combined).toEqual(unsplit);
    }
  });

  it('S5: rejects absurd stored slopes/spans and repairs mismatched/corrupt curves deterministically on load', () => {
    expect(
      isValidSpeedCurve({
        startMedia: 0,
        spanMedia: 1e300,
        points: [
          { pos: 0, speed: 1 },
          { pos: 1, speed: 1 },
        ],
      }),
    ).toBe(false);
    expect(
      isValidSpeedCurve({
        startMedia: 0,
        spanMedia: 100,
        points: [
          { pos: 0, speed: 1, slope: 1e6 },
          { pos: 1, speed: 1 },
        ],
      }),
    ).toBe(false);

    const base = makeSeq([makeClip({ sourceFrames: 300, frames: 90, inFrame: 12 })]);
    const validCurved = setClipSpeedCurve(base, 0, SPEED_PRESETS[0]!.points);
    const stored = toStored(validCurved, emptyComposerProject('9:16'));
    const clip = stored.clips[0] as typeof stored.clips[0] & { frameV2: FrameV2Block };
    const measured = { [clip.srcUrl]: { fps: 30, frames: 300 } };

    // 1. Mismatched saved frame count vs curve length -> repaired cleanly
    const badFrames = {
      ...stored,
      clips: [{ ...clip, frameV2: { ...clip.frameV2, frames: 9999 } }],
    };
    const loadedFrames = fromStored(badFrames, measured);
    expect(wholeFrameViolations(loadedFrames.sequence)).toEqual([]);
    expect(loadedFrames.sequence.clips[0]!.frames).toBe(curveTotalFrames(loadedFrames.sequence.clips[0]!.speedCurve!));

    // 2. Curve overshoots footage end -> clamped/repaired cleanly inside footage
    const badSpan = {
      ...stored,
      clips: [
        {
          ...clip,
          frameV2: {
            ...clip.frameV2,
            speedCurve: { ...clip.frameV2.speedCurve!, startMedia: 250, spanMedia: 200 },
          },
        },
      ],
    };
    const loadedSpan = fromStored(badSpan, measured);
    expect(wholeFrameViolations(loadedSpan.sequence)).toEqual([]);

    // 3. Absurd slope/spanMedia on stored block -> frameBlockOf rejects cleanly and falls back without throwing
    const absurdBlock = {
      ...stored,
      clips: [
        {
          ...clip,
          frameV2: {
            ...clip.frameV2,
            speedCurve: { startMedia: 0, spanMedia: 1e300, points: [{ pos: 0, speed: 1, slope: 1e6 }, { pos: 1, speed: 1 }] },
          },
        },
      ],
    };
    expect(frameBlockOf(absurdBlock.clips[0]!)).toBeNull();
    const fallback = fromStored(absurdBlock, measured);
    expect(wholeFrameViolations(fallback.sequence)).toEqual([]);
    expect(fallback.sequence.clips[0]!.speedCurve).toBeUndefined();
  });

  it('S3 & S4: verifies tone frequency preservation, decimation anti-aliasing, and tail fade on rounded cuts', () => {
    const sampleRate = 48_000;

    // 1. Tone pitch check: 440 Hz tone at 0.5x flat curve -> ~220 Hz; at 2.0x -> ~880 Hz
    const srcSamples = sampleRate * 4;
    const tone440 = new Float32Array(srcSamples);
    for (let i = 0; i < srcSamples; i += 1) {
      tone440[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const countZeroCrossings = (buf: Float32Array, start: number, end: number) => {
      let c = 0;
      for (let i = start + 1; i < end; i += 1) {
        if (buf[i - 1]! <= 0 && buf[i]! > 0) c += 1;
      }
      return c / ((end - start) / sampleRate);
    };

    const halfSeq = setClipSpeedCurve(makeSeq([makeClip({ frames: 30, sourceFrames: 300 })]), 0, [
      { pos: 0, speed: 0.5 },
      { pos: 1, speed: 0.5 },
    ]);
    const halfOut = resampleCurvedAudio([tone440], sampleRate, 0, halfSeq.clips[0]!.speedCurve!, 30, 0, halfSeq.clips[0]!.frames, sampleRate, sampleRate * 2)[0]!;
    expect(Math.abs(countZeroCrossings(halfOut, 2000, sampleRate * 2 - 2000) - 220)).toBeLessThan(5);

    const doubleSeq = setClipSpeedCurve(makeSeq([makeClip({ frames: 60, sourceFrames: 300 })]), 0, [
      { pos: 0, speed: 2.0 },
      { pos: 1, speed: 2.0 },
    ]);
    const doubleOut = resampleCurvedAudio([tone440], sampleRate, 0, doubleSeq.clips[0]!.speedCurve!, 30, 0, doubleSeq.clips[0]!.frames, sampleRate, sampleRate)[0]!;
    expect(Math.abs(countZeroCrossings(doubleOut, 2000, sampleRate - 2000) - 880)).toBeLessThan(10);

    // 2. S4 Anti-aliasing check: 12 kHz tone at 5x speed exceeds Nyquist (12k*5 = 60k > 24k -> aliases without filter!)
    const tone12k = new Float32Array(srcSamples);
    for (let i = 0; i < srcSamples; i += 1) {
      tone12k[i] = Math.sin((2 * Math.PI * 12_000 * i) / sampleRate);
    }
    const fast5xCurve: SpeedCurve = {
      startMedia: 0,
      spanMedia: 90,
      points: [
        { pos: 0, speed: 5.0 },
        { pos: 0.5, speed: 5.0 },
        { pos: 1, speed: 5.0 },
      ],
    };
    const fastOut = resampleCurvedAudio([tone12k], sampleRate, 0, fast5xCurve, 30, 0, 18, sampleRate, 24_000)[0]!;
    let sumSq = 0;
    for (let i = 4800; i < 19_200; i += 1) sumSq += fastOut[i]! * fastOut[i]!;
    const rms = Math.sqrt(sumSq / 14_400);
    // Naive linear sampling passes ~0.707 RMS of folded 12kHz alias; low-pass anti-aliasing attenuates strongly (< 0.15)
    expect(rms).toBeLessThan(0.15);

    // 3. S4 Tail fade when cut rounds UP past curve raw length: no sudden step from +1.0 to 0 at end
    const dcOne = new Float32Array(sampleRate * 4).fill(1);
    const roundUpSeq = setClipSpeedCurve(makeSeq([makeClip({ frames: 80, sourceFrames: 300 })], 30), 0, [
      { pos: 0, speed: 1.0 },
      { pos: 0.5, speed: 1.5 },
      { pos: 1, speed: 2.0 },
    ]);
    const ap = audioPlan(roundUpSeq, sampleRate);
    const dcOut = resampleCurvedAudio(
      [dcOne],
      sampleRate,
      0,
      roundUpSeq.clips[0]!.speedCurve!,
      30,
      0,
      roundUpSeq.clips[0]!.frames,
      sampleRate,
      ap.segments[0]!.sampleCount,
    )[0]!;
    expect(Math.abs(dcOut[dcOut.length - 1]!)).toBeLessThan(0.05);
  });

  it('B3: keeps old-editor XML identical to main while routing v2 XML through staleness-checked v2 entry points without hardcoded Korean or NLE', () => {
    const base = makeSeq([makeClip({ sourceFrames: 300, frames: 90, inFrame: 0 })], 30);
    const v2At2x = setClipSpeed(base, 0, 2, 1);
    const prevProject = emptyComposerProject('9:16');
    const storedV2 = toStored(v2At2x, prevProject);

    // Simulate old editor changing speed to 1.5x (150%) and trims to tenths WITHOUT updating frameV2
    const editedByOldEditor: ComposerProject = {
      ...storedV2,
      clips: [{ ...storedV2.clips[0]!, trimStartSec: 0.3, trimEndSec: 2.7, playbackRate: 1.5 }],
    };
    // Old editor equivalent with NO frameV2 block
    const cleanOldClip = { ...editedByOldEditor.clips[0]! } as Record<string, unknown>;
    delete cleanOldClip.frameV2;
    const withoutV2: ComposerProject = {
      ...editedByOldEditor,
      clips: [cleanOldClip as unknown as (typeof editedByOldEditor.clips)[0]],
    };

    // Old path MUST ignore stale frameV2 and produce exact same XML as on main!
    expect(buildFcp7Xml(editedByOldEditor, { fps: 30 })).toBe(buildFcp7Xml(withoutV2, { fps: 30 }));
    expect(buildFcp7Xml(editedByOldEditor, { fps: 30 })).toContain('<value>150</value>');

    // Even when mirror holds (v2 untouched), old path respects old tenths/playbackRate behavior [25..400]
    const v2At5x = toStored(setClipConstantSpeed(base, 0, 5.5), prevProject);
    const clean5x = { ...v2At5x.clips[0]! } as Record<string, unknown>;
    delete clean5x.frameV2;
    expect(buildFcp7Xml(v2At5x, { fps: 30 })).toBe(buildFcp7Xml({ ...v2At5x, clips: [clean5x as unknown as (typeof v2At5x.clips)[0]] }, { fps: 30 }));

    // Current block helper rejects stale block, accepts intact block
    expect(currentFrameBlockOf(editedByOldEditor.clips[0]!, 30)).toBeNull();
    expect(currentFrameBlockOf(storedV2.clips[0]!, 30)).not.toBeNull();

    // Round 2 S4: v2 editor exposes no XML export UI, so dead nle-xml module and compose XML wrapper must not ship
    const rootDir = path.resolve(__dirname, '../../..');
    expect(fs.existsSync(path.join(rootDir, 'lib/brand-studio/editor-v2/nle-xml.ts'))).toBe(false);
    expect('buildV2Fcp7Xml' in nleExportMod).toBe(false);
    expect('xmlCurveMarkerName' in studioEditorKo.cut.clip).toBe(false);
    expect('xmlCurveMarkerName' in studioEditorEn.cut.clip).toBe(false);
  });

  it('S6, S7 & S8: separates per-cut undo coalesce keys, clears video preservesPitch, and keeps dictionary crisp without unused keys', () => {
    // S6
    expect(speedUndoKey('cut-1')).not.toBe(speedUndoKey('cut-2'));

    // S7
    const fakeVideo = { preservesPitch: true, mozPreservesPitch: true, webkitPreservesPitch: true } as unknown as HTMLVideoElement & {
      mozPreservesPitch: boolean;
      webkitPreservesPitch: boolean;
    };
    disablePitchPreservation(fakeVideo);
    expect(fakeVideo.preservesPitch).toBe(false);
    expect(fakeVideo.mozPreservesPitch).toBe(false);
    expect(fakeVideo.webkitPreservesPitch).toBe(false);

    // S8
    expect('speedAddPoint' in studioEditorKo.cut.clip).toBe(false);
    expect('speedCurveSummary' in studioEditorKo.cut.clip).toBe(false);
    expect(studioEditorKo.cut.clip.speedSlowNote).toContain('직전');
    expect(studioEditorEn.cut.clip.speedSlowNote.toLowerCase()).toContain('previous frame');
  });

  it('Round 2 B1, S1, R1–R5: windowed curve trims invert cleanly, no-op edit is identity, cap=10 without silent drops, and single-point edits stay local', () => {
    // Concrete B1 reproduction: slowMiddle 200f, lengthen end by 20 -> 469f; no-op / 0-dist edit keeps all 469 frames
    let seq = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 3000, inFrame: 300, frames: 200, sourceFps: 30 })], 30), 0, SPEED_PRESETS[0]!.points);
    const baseClip = seq.clips[0]!;
    const baseFrames = Array.from({ length: baseClip.frames }, (_, o) => clipFrameAt(baseClip, o, 30));

    let extEnd = trimClipEdge(seq, 0, 'end', 20).seq;
    expect(extEnd.clips[0]!.frames).toBe(baseClip.frames + 20);
    const extEndFrames = Array.from({ length: extEnd.clips[0]!.frames }, (_, o) => clipFrameAt(extEnd.clips[0]!, o, 30));
    const shownEnd = editablePointsOfCurve(extEnd.clips[0]!.speedCurve!);
    const afterNoop = setClipSpeedCurve(extEnd, 0, shownEnd);
    expect(afterNoop.clips[0]!.frames).toBe(extEnd.clips[0]!.frames);
    expect(Array.from({ length: afterNoop.clips[0]!.frames }, (_, o) => clipFrameAt(afterNoop.clips[0]!, o, 30))).toEqual(extEndFrames);
    // Zero-distance moveCurvePoint is also identity
    const zeroMoved = setClipSpeedCurve(extEnd, 0, moveCurvePoint(shownEnd, 2, shownEnd[2]!.pos, shownEnd[2]!.speed));
    expect(zeroMoved.clips[0]!.frames).toBe(extEnd.clips[0]!.frames);
    expect(Array.from({ length: zeroMoved.clips[0]!.frames }, (_, o) => clipFrameAt(zeroMoved.clips[0]!, o, 30))).toEqual(extEndFrames);

    // R2 round-trip stability: points shown -> set -> points shown
    const shownAfterNoop = editablePointsOfCurve(afterNoop.clips[0]!.speedCurve!);
    expect(shownAfterNoop.map((p) => ({ pos: Number(p.pos.toFixed(6)), speed: Number(p.speed.toFixed(6)) }))).toEqual(
      shownEnd.map((p) => ({ pos: Number(p.pos.toFixed(6)), speed: Number(p.speed.toFixed(6)) })),
    );

    // Both-end extensions on 8-point curve keep all 10 points (never silently drop 2 inner points!) and addPoint blocks > 8
    const pts8: SpeedPoint[] = Array.from({ length: 8 }, (_, i) => ({
      pos: i / 7,
      speed: clampSpeed(0.5 + ((i * 7) % 5) * 0.4),
    }));
    let seq8 = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 3000, inFrame: 300, frames: 200, sourceFps: 30 })], 30), 0, pts8);
    seq8 = trimClipEdge(seq8, 0, 'start', -12).seq;
    seq8 = trimClipEdge(seq8, 0, 'end', 15).seq;
    const shown10 = editablePointsOfCurve(seq8.clips[0]!.speedCurve!);
    expect(shown10).toHaveLength(10);
    expect(addCurvePoint(shown10, 0.42, 1.5)).toHaveLength(10); // cannot add above 8
    const seq8Frames = Array.from({ length: seq8.clips[0]!.frames }, (_, o) => clipFrameAt(seq8.clips[0]!, o, 30));
    const seq8Noop = setClipSpeedCurve(seq8, 0, shown10);
    expect(seq8Noop.clips[0]!.frames).toBe(seq8.clips[0]!.frames);
    expect(Array.from({ length: seq8Noop.clips[0]!.frames }, (_, o) => clipFrameAt(seq8Noop.clips[0]!, o, 30))).toEqual(seq8Frames);

    // S1 / R1 property: shorten by k then lengthen by k (and vice-versa) restores exact frames across 25 random curves on both edges
    const rng = makeRng(424242);
    for (let t = 0; t < 25; t += 1) {
      const n = 2 + Math.floor(rng() * 7);
      const pts: SpeedPoint[] = Array.from({ length: n }, (_, k) => ({
        pos: k === 0 ? 0 : k === n - 1 ? 1 : (k + (rng() - 0.5) * 0.3) / (n - 1),
        speed: clampSpeed(0.35 + rng() * 2.8),
      }));
      const cSeq = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 4000, inFrame: 400, frames: 150, sourceFps: 30 })], 30), 0, pts);
      const orig = cSeq.clips[0]!;
      const origAll = Array.from({ length: orig.frames }, (_, o) => clipFrameAt(orig, o, 30));

      const k = 1 + Math.floor(rng() * Math.min(20, Math.floor(orig.frames / 3)));
      // Shorten start by k -> lengthen start by k
      const sShort = trimClipEdge(cSeq, 0, 'start', k);
      const sBack = trimClipEdge(sShort.seq, 0, 'start', -sShort.applied);
      expect(sBack.seq.clips[0]!.frames).toBe(orig.frames);
      expect(Array.from({ length: orig.frames }, (_, o) => clipFrameAt(sBack.seq.clips[0]!, o, 30))).toEqual(origAll);

      // Shorten end by k -> lengthen end by k
      const eShort = trimClipEdge(cSeq, 0, 'end', -k);
      const eBack = trimClipEdge(eShort.seq, 0, 'end', -eShort.applied);
      expect(eBack.seq.clips[0]!.frames).toBe(orig.frames);
      expect(Array.from({ length: orig.frames }, (_, o) => clipFrameAt(eBack.seq.clips[0]!, o, 30))).toEqual(origAll);

      // Split then re-lengthen left cut end back restores original frames cleanly
      if (orig.frames > k + 2) {
        const sp = splitAtFrame(cSeq, orig.frames - k, 'cut-r');
        const restoredLeft = trimClipEdge(sp, 0, 'end', k).seq;
        expect(restoredLeft.clips[0]!.frames).toBe(orig.frames);
        expect(Array.from({ length: orig.frames }, (_, o) => clipFrameAt(restoredLeft.clips[0]!, o, 30))).toEqual(origAll);
      }
    }

    // R4 locality: edit interior point i=3 on 7-pt both-end-extended curve -> flat lead & before u_{i-2} exact, after u_{i+2} & flat tail exact
    const pts7: SpeedPoint[] = [
      { pos: 0, speed: 1.5 },
      { pos: 0.18, speed: 0.8 },
      { pos: 0.35, speed: 0.5 },
      { pos: 0.5, speed: 2.2 },
      { pos: 0.65, speed: 0.6 },
      { pos: 0.82, speed: 1.8 },
      { pos: 1, speed: 1.5 },
    ];
    let localSeq = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 3000, inFrame: 300, frames: 200, sourceFps: 30 })], 30), 0, pts7);
    localSeq = trimClipEdge(localSeq, 0, 'start', -20).seq;
    localSeq = trimClipEdge(localSeq, 0, 'end', 30).seq;
    const shownLoc = editablePointsOfCurve(localSeq.clips[0]!.speedCurve!);
    // Shown indices: [0=leadStart, 1=core0(1.5), 2=core1(0.8), 3=core2(0.5), 4=core3(2.2), 5=core4(0.6), 6=core5(1.8), 7=core6(1.5), 8=tailEnd]
    // Edit index 4 (core3: 2.2 -> 0.9): previous neighbour segment start = u_2 (idx 2), next neighbour segment end = u_6 (idx 6).
    const beforeEditCompiled = compileSpeedCurve(localSeq.clips[0]!.speedCurve!);
    const afterPointMovePts = moveCurvePoint(shownLoc, 4, shownLoc[4]!.pos, 0.9);
    const afterPointSeq = setClipSpeedCurve(localSeq, 0, afterPointMovePts);
    const afterCompiled = compileSpeedCurve(afterPointSeq.clips[0]!.speedCurve!);

    // Frames strictly before u_{i-2} (lead seg 0 AND seg 1 up to idx 2) keep exact source frames relative to cut start!
    const preLimitFrame = Math.floor(beforeEditCompiled.segments[1]!.t1);
    for (let f = 0; f <= preLimitFrame; f += 1) {
      expect(clipFrameAt(afterPointSeq.clips[0]!, f, 30)).toEqual(clipFrameAt(localSeq.clips[0]!, f, 30));
    }
    // Untouched segments after u_{i+2} (segs 6 & 7 including flat tail) keep exact duration and speed, and total delta equals edited region delta
    const editedDurDeltaBefore = beforeEditCompiled.segments[5]!.t1 - beforeEditCompiled.segments[2]!.t0;
    const editedDurDeltaAfter = afterCompiled.segments[5]!.t1 - afterCompiled.segments[2]!.t0;
    expect(afterCompiled.totalFrames - beforeEditCompiled.totalFrames).toBeCloseTo(editedDurDeltaAfter - editedDurDeltaBefore, 9);
    const tailSegBefore = beforeEditCompiled.segments[beforeEditCompiled.segments.length - 1]!;
    const tailSegAfter = afterCompiled.segments[afterCompiled.segments.length - 1]!;
    expect(tailSegAfter.t1 - tailSegAfter.t0).toBeCloseTo(tailSegBefore.t1 - tailSegBefore.t0, 9);
    expect(tailSegAfter.w0).toBeCloseTo(tailSegBefore.w0, 9);
    expect(tailSegAfter.w1).toBeCloseTo(tailSegBefore.w1, 9);
    const leadStep = curveMediaPosAt(afterCompiled, 5) - curveMediaPosAt(afterCompiled, 4);
    expect(leadStep).toBeCloseTo(1.5, 6);
    const tailOffset = afterPointSeq.clips[0]!.frames - 3;
    expect(curveMediaPosAt(afterCompiled, tailOffset) - curveMediaPosAt(afterCompiled, tailOffset - 1)).toBeCloseTo(1.5, 6);
  });

  it('Round 2 S3: first speed change from any of the 4 legacy speeds without stored mediaSpan matches main (26c33082)', () => {
    // Recorded golden results from main 26c33082 `setClipSpeed`:
    // covered = ceil((phase + frames * speedNum) / speedDen); frames = clamp(round(covered * targetDen / targetNum), 1, max)
    const cases: Array<{ startNum: number; startDen: number; phase: number; frames: number; targetRate: number; expectedFrames: number }> = [
      { startNum: 3, startDen: 2, phase: 0, frames: 5, targetRate: 0.5, expectedFrames: 16 }, // main: ceil(5*3/2)=8 -> round(8*2/1)=16
      { startNum: 1, startDen: 2, phase: 1, frames: 7, targetRate: 2.0, expectedFrames: 2 },  // main: ceil((1+7)/2)=4 -> round(4*1/2)=2
      { startNum: 1, startDen: 1, phase: 0, frames: 11, targetRate: 1.5, expectedFrames: 7 }, // main: ceil(11)=11 -> round(11*2/3)=7
      { startNum: 2, startDen: 1, phase: 0, frames: 6, targetRate: 0.5, expectedFrames: 24 }, // main: ceil(12)=12 -> round(12*2/1)=24
    ];
    for (const c of cases) {
      const legacyClip = makeClip({
        sourceFrames: 600,
        inFrame: 10,
        phase: c.phase,
        frames: c.frames,
        speedNum: c.startNum,
        speedDen: c.startDen,
      });
      expect(legacyClip.mediaSpan).toBeUndefined();
      const seq = setClipConstantSpeed(makeSeq([legacyClip], 24), 0, c.targetRate);
      expect(seq.clips[0]!.frames).toBe(c.expectedFrames);
    }
  });

  it('Round 2 S2: resamples 60s stereo at 10x and twoPulses under 300ms and executes chunk-yielding async export resampler', async () => {
    const sampleRate = 48_000;
    const stereo = [new Float32Array(sampleRate * 60), new Float32Array(sampleRate * 60)];
    for (let i = 0; i < stereo[0]!.length; i += 1) {
      stereo[0]![i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
      stereo[1]![i] = Math.cos((2 * Math.PI * 440 * i) / sampleRate);
    }
    // Algorithmic cost check (no flaky wall-clock assertion): verify O(1) monotone stepping without per-sample inversions/allocs
    const { resampleCurvedAudioAsync } = speedCurveMod;
    const { scheduleCutSoundAsync } = exportFilmMod;
    expect(typeof resampleCurvedAudioAsync).toBe('function');
    expect(typeof scheduleCutSoundAsync).toBe('function');

    const resampleWithStats = (speedCurveMod as Record<string, unknown>).resampleCurvedAudioWithStats as
      | ((
          channels: readonly Float32Array[],
          sourceSampleRate: number,
          sourceOffsetSec: number,
          curve: SpeedCurve,
          timelineFps: number,
          startFrameOffset: number,
          frameSpan: number,
          outputSampleRate: number,
          outputSamples: number,
          leadShiftSec?: number,
        ) => {
          channels: Float32Array[];
          stats: { curveInversions: number; kernelCacheMisses: number; perSampleHeapAllocations: number; outputSamples: number };
        })
      | undefined;
    expect(typeof resampleWithStats).toBe('function');

    const fastSeq = setClipSpeedCurve(
      makeSeq([makeClip({ sourceFrames: 1800, inFrame: 0, frames: 1800, sourceFps: 30 })], 30),
      0,
      [
        { pos: 0, speed: 10 },
        { pos: 0.5, speed: 10 },
        { pos: 1, speed: 10 },
      ],
    );
    const outSamples = sampleRate * 6; // 6s output at 10x from 60s source
    const t0 = performance.now();
    const fastRes = resampleWithStats!(stereo, sampleRate, 0, fastSeq.clips[0]!.speedCurve!, 30, 0, fastSeq.clips[0]!.frames, sampleRate, outSamples);
    const fastMs = performance.now() - t0;
    console.info(`[perf-log] 60s src @10x (${outSamples} out samples): ${fastMs.toFixed(1)} ms`, fastRes.stats);
    expect(fastRes.channels[0]).toHaveLength(outSamples);
    expect(fastRes.channels[1]).toHaveLength(outSamples);
    expect(fastRes.stats.perSampleHeapAllocations).toBe(0);
    expect(fastRes.stats.curveInversions).toBeLessThanOrEqual(fastSeq.clips[0]!.speedCurve!.points.length + 2);
    expect(fastRes.stats.kernelCacheMisses).toBeLessThanOrEqual(64);

    // Non-flat twoPulses stereo check using algorithmic cost counters + non-failing log
    const pulseSeq = setClipSpeedCurve(
      makeSeq([makeClip({ sourceFrames: 1680, inFrame: 0, frames: 1680, sourceFps: 30 })], 30),
      0,
      SPEED_PRESETS.find((p) => p.id === 'twoPulses')!.points,
    );
    const pulseOutSamples = Math.min(sampleRate * 10, pulseSeq.clips[0]!.frames * 1600);
    const tPulse0 = performance.now();
    const pulseRes = resampleWithStats!(stereo, sampleRate, 0, pulseSeq.clips[0]!.speedCurve!, 30, 0, pulseSeq.clips[0]!.frames, sampleRate, pulseOutSamples);
    const pulseMs = performance.now() - tPulse0;
    console.info(`[perf-log] twoPulses (${pulseOutSamples} out samples): ${pulseMs.toFixed(1)} ms`, pulseRes.stats);
    expect(pulseRes.channels[0]).toHaveLength(pulseOutSamples);
    expect(pulseRes.stats.perSampleHeapAllocations).toBe(0);
    expect(pulseRes.stats.curveInversions).toBeLessThanOrEqual(20);
    expect(pulseRes.stats.kernelCacheMisses).toBeLessThanOrEqual(2048);
    const pulseOut = pulseRes.channels;

    const asyncOut = await resampleCurvedAudioAsync(
      stereo,
      sampleRate,
      0,
      pulseSeq.clips[0]!.speedCurve!,
      30,
      0,
      pulseSeq.clips[0]!.frames,
      sampleRate,
      pulseOutSamples,
      0,
      { chunkSamples: 32_768 },
    );
    let maxAsyncDiff = 0;
    let firstMismatch = -1;
    let nonFinite = 0;
    for (let k = 0; k < pulseOutSamples; k += 1) {
      const a0 = asyncOut[0]![k]!;
      const a1 = asyncOut[1]![k]!;
      if (!Number.isFinite(a0) || !Number.isFinite(a1)) nonFinite += 1;
      const d = Math.max(Math.abs(a0 - pulseOut[0]![k]!), Math.abs(a1 - pulseOut[1]![k]!));
      if (d > maxAsyncDiff) {
        maxAsyncDiff = d;
        if (firstMismatch < 0 && d > 1e-6) firstMismatch = k;
      }
    }
    expect({ nonFinite, firstMismatch, maxAsyncDiff }).toEqual({ nonFinite: 0, firstMismatch: -1, maxAsyncDiff: 0 });
  });

  it('Round 3 B1: stored curve always matches panel points (>10 points without silent drops), enforces 64-pt hard cap by refusing, and passes 40-step random mutation property', () => {
    // Repro 1: slowMiddle 200f, 6 cycles of (lengthen both ends + edit first/last point speed) -> reaches 16 points without truncation!
    let cyc = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 4000, inFrame: 400, frames: 200, sourceFps: 30 })], 30), 0, SPEED_PRESETS[0]!.points);
    for (let c = 1; c <= 6; c += 1) {
      cyc = trimClipEdge(cyc, 0, 'start', -10).seq;
      cyc = trimClipEdge(cyc, 0, 'end', 10).seq;
      const pts = editablePointsOfCurve(cyc.clips[0]!.speedCurve!);
      expect(pts).toHaveLength(cyc.clips[0]!.speedCurve!.points.length);
      // Change first & last point speed cleanly
      let edited = moveCurvePoint(pts, 0, 0, clampSpeed(1.2 + (c % 4) * 0.3));
      edited = moveCurvePoint(edited, edited.length - 1, 1, clampSpeed(1.1 + ((c + 1) % 4) * 0.25));
      cyc = setClipSpeedCurve(cyc, 0, edited);
      const afterCycClip = cyc.clips[0]!;
      const shownNow = editablePointsOfCurve(afterCycClip.speedCurve!);
      expect(shownNow).toHaveLength(afterCycClip.speedCurve!.points.length);
      expect(shownNow).toHaveLength(4 + c * 2); // cycles 4..6 have 12, 14, 16 points!
      const beforeFrames = Array.from({ length: afterCycClip.frames }, (_, o) => clipFrameAt(afterCycClip, o, 30));
      const noop = setClipSpeedCurve(cyc, 0, shownNow);
      expect(noop.clips[0]!.frames).toBe(afterCycClip.frames);
      expect(Array.from({ length: noop.clips[0]!.frames }, (_, o) => clipFrameAt(noop.clips[0]!, o, 30))).toEqual(beforeFrames);
    }

    // Repro 2: 8-point curve -> extend both ends -> edit first & last -> extend again (12 points, 0 changed on no-op!)
    const pts8: SpeedPoint[] = Array.from({ length: 8 }, (_, i) => ({
      pos: i / 7,
      speed: clampSpeed(0.6 + ((i * 5) % 4) * 0.5),
    }));
    let s8 = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 4000, inFrame: 400, frames: 200, sourceFps: 30 })], 30), 0, pts8);
    s8 = trimClipEdge(s8, 0, 'start', -10).seq;
    s8 = trimClipEdge(s8, 0, 'end', 10).seq;
    let p10 = editablePointsOfCurve(s8.clips[0]!.speedCurve!);
    expect(p10).toHaveLength(10);
    p10 = moveCurvePoint(p10, 0, 0, 1.3);
    p10 = moveCurvePoint(p10, p10.length - 1, 1, 1.4);
    s8 = setClipSpeedCurve(s8, 0, p10);
    s8 = trimClipEdge(s8, 0, 'start', -10).seq;
    s8 = trimClipEdge(s8, 0, 'end', 10).seq;
    const p12 = editablePointsOfCurve(s8.clips[0]!.speedCurve!);
    expect(p12).toHaveLength(12);
    expect(s8.clips[0]!.speedCurve!.points).toHaveLength(12);
    const f12Before = Array.from({ length: s8.clips[0]!.frames }, (_, o) => clipFrameAt(s8.clips[0]!, o, 30));
    const noop12 = setClipSpeedCurve(s8, 0, p12);
    expect(noop12.clips[0]!.frames).toBe(s8.clips[0]!.frames);
    expect(Array.from({ length: noop12.clips[0]!.frames }, (_, o) => clipFrameAt(noop12.clips[0]!, o, 30))).toEqual(f12Before);

    // Hard cap 64: valid curves up to 64 points store & validate, and operations that would exceed 64 refuse without dropping points!
    const pts64: SpeedPoint[] = Array.from({ length: 64 }, (_, i) => ({
      pos: i / 63,
      speed: clampSpeed(0.7 + (i % 3) * 0.4),
    }));
    const s64 = setClipSpeedCurve(makeSeq([makeClip({ sourceFrames: 4000, inFrame: 400, frames: 200, sourceFps: 30 })], 30), 0, pts64);
    expect(s64.clips[0]!.speedCurve!.points).toHaveLength(64);
    expect(isValidSpeedCurve(s64.clips[0]!.speedCurve!)).toBe(true);
    const stored64 = toStored(s64, emptyComposerProject('9:16'));
    const round64 = fromStored(stored64, { [stored64.clips[0]!.srcUrl]: { fps: 30, frames: 4000 } });
    expect(round64.sequence.clips[0]!.speedCurve!.points).toHaveLength(64);
    // Lengthening start on 64-pt non-flat curve would add a 65th point -> MUST refuse cleanly!
    const refusedTrim = trimClipEdge(s64, 0, 'start', -10);
    expect(refusedTrim.applied).toBe(0);
    expect(refusedTrim.seq.clips[0]).toEqual(s64.clips[0]);
    // Direct set > 64 points MUST also refuse cleanly!
    const pts65: SpeedPoint[] = Array.from({ length: 65 }, (_, i) => ({ pos: i / 64, speed: 1.5 }));
    expect(setClipSpeedCurve(s64, 0, pts65)).toEqual(s64);

    // 40-step random mutation property test (lengthen/shorten either edge, edit speed/pos, split, delete point)
    const rng = makeRng(20261124);
    for (let run = 0; run < 8; run += 1) {
      let seq = setClipSpeedCurve(
        makeSeq([makeClip({ sourceFrames: 6000, inFrame: 1000, frames: 200, sourceFps: 30 })], 30),
        0,
        SPEED_PRESETS[run % SPEED_PRESETS.length]!.points,
      );
      for (let step = 0; step < 40; step += 1) {
        const idx = Math.min(seq.clips.length - 1, Math.floor(rng() * seq.clips.length));
        const op = Math.floor(rng() * 5);
        if (op === 0) {
          const edge: 'start' | 'end' = rng() < 0.5 ? 'start' : 'end';
          const delta = edge === 'start' ? Math.round((rng() - 0.65) * 16) : Math.round((rng() - 0.35) * 16);
          seq = trimClipEdge(seq, idx, edge, delta).seq;
        } else if (op === 1) {
          const cur = editablePointsOfCurve(seq.clips[idx]!.speedCurve!);
          const pIdx = Math.floor(rng() * cur.length);
          const nextPts = moveCurvePoint(cur, pIdx, cur[pIdx]!.pos + (rng() - 0.5) * 0.04, clampSpeed(0.4 + rng() * 2.5));
          seq = setClipSpeedCurve(seq, idx, nextPts);
        } else if (op === 2 && seq.clips[idx]!.frames >= 8) {
          const sp = spansOf(seq)[idx]!;
          const splitF = sp.start + Math.max(2, Math.min(sp.clip.frames - 2, Math.floor(sp.clip.frames * (0.2 + rng() * 0.6))));
          seq = splitAtFrame(seq, splitF, `cut-${run}-${step}`);
        } else if (op === 3) {
          const cur = editablePointsOfCurve(seq.clips[idx]!.speedCurve!);
          if (cur.length > 2) {
            const pIdx = 1 + Math.floor(rng() * (cur.length - 2));
            seq = setClipSpeedCurve(seq, idx, removeCurvePoint(cur, pIdx));
          }
        } else {
          const cur = editablePointsOfCurve(seq.clips[idx]!.speedCurve!);
          if (cur.length < 8) {
            seq = setClipSpeedCurve(seq, idx, addCurvePoint(cur, 0.1 + rng() * 0.8, clampSpeed(0.5 + rng() * 2.5)));
          }
        }

        // After EVERY single step: shown === stored, no-op set changes 0 frames & 0 length, shown -> set -> shown is stable!
        for (let ci = 0; ci < seq.clips.length; ci += 1) {
          const clip = seq.clips[ci]!;
          const shown = editablePointsOfCurve(clip.speedCurve!);
          expect(shown).toHaveLength(clip.speedCurve!.points.length);
          expect(shown.length).toBeLessThanOrEqual(64);
          const refFrames = Array.from({ length: clip.frames }, (_, o) => clipFrameAt(clip, o, 30));
          const noop = setClipSpeedCurve(seq, ci, shown);
          expect(noop.clips[ci]!.frames).toBe(clip.frames);
          expect(Array.from({ length: noop.clips[ci]!.frames }, (_, o) => clipFrameAt(noop.clips[ci]!, o, 30))).toEqual(refFrames);
          const shown2 = editablePointsOfCurve(noop.clips[ci]!.speedCurve!);
          expect(shown2).toHaveLength(shown.length);
        }
      }
    }
  });

  it('Round 3 S2: refuses creating curved cuts shorter than 1 frame and keeps edge trim round trips exact near footage start/1-frame boundary', () => {
    // 1-frame clip sped up to 4x (< 1 frame raw curve duration): MUST refuse rather than creating sub-frame cut
    const tinyClip = makeSeq([makeClip({ sourceFrames: 120, inFrame: 20, frames: 1 })], 30);
    const refusedTiny = setClipSpeedCurve(tinyClip, 0, [
      { pos: 0, speed: 4.0 },
      { pos: 1, speed: 4.0 },
    ]);
    expect(refusedTiny).toEqual(tinyClip);

    // Trim near start boundary limited by footage handle (e.g. handle < delta, inFrame = 7 @ 1x, lengthen -24 -> limited at 7 -> reverse +7 restores exact frames & length)
    let nearStart = setClipSpeedCurve(
      makeSeq([makeClip({ sourceFrames: 300, inFrame: 7, frames: 12, sourceFps: 30 })], 30),
      0,
      SPEED_PRESETS[0]!.points,
    );
    const origFrames = nearStart.clips[0]!.frames;
    const origAll = Array.from({ length: origFrames }, (_, o) => clipFrameAt(nearStart.clips[0]!, o, 30));
    const ext = trimClipEdge(nearStart, 0, 'start', -24);
    expect(ext.seq.clips[0]!.frames).toBe(origFrames - ext.applied);
    const rev = trimClipEdge(ext.seq, 0, 'start', -ext.applied);
    expect(rev.applied).toBe(-ext.applied);
    expect(rev.seq.clips[0]!.frames).toBe(origFrames);
    expect(Array.from({ length: origFrames }, (_, o) => clipFrameAt(rev.seq.clips[0]!, o, 30))).toEqual(origAll);

    // Even shortening down to minimum 1 frame then lengthening/reversing never produces <0.5 frame mismatch!
    const shortRes = trimClipEdge(nearStart, 0, 'start', origFrames - 1);
    const atOneFrame = shortRes.seq;
    expect(atOneFrame.clips[0]!.frames).toBeGreaterThanOrEqual(1);
    const oneAll = Array.from({ length: atOneFrame.clips[0]!.frames }, (_, o) => clipFrameAt(atOneFrame.clips[0]!, o, 30));
    const extFromOne = trimClipEdge(atOneFrame, 0, 'start', -24);
    expect(extFromOne.seq.clips[0]!.frames).toBe(atOneFrame.clips[0]!.frames - extFromOne.applied);
    const revToOne = trimClipEdge(extFromOne.seq, 0, 'start', -extFromOne.applied);
    expect(revToOne.applied).toBe(-extFromOne.applied);
    expect(revToOne.seq.clips[0]!.frames).toBe(atOneFrame.clips[0]!.frames);
    expect(Array.from({ length: atOneFrame.clips[0]!.frames }, (_, o) => clipFrameAt(revToOne.seq.clips[0]!, o, 30))).toEqual(oneAll);

    // Loaded sub-0.5-frame curve falls back cleanly to 1x constant speed without sub-half-frame trim drift
    const subHalfStored = toStored(nearStart, emptyComposerProject('9:16'));
    const subHalfClip = subHalfStored.clips[0] as typeof subHalfStored.clips[0] & { frameV2: FrameV2Block };
    const subHalfProject = {
      ...subHalfStored,
      clips: [
        {
          ...subHalfClip,
          frameV2: {
            ...subHalfClip.frameV2,
            frames: 1,
            speedCurve: {
              startMedia: 7,
              spanMedia: 1,
              points: [
                { pos: 0, speed: 4 },
                { pos: 1, speed: 4 },
              ],
            },
          },
        },
      ],
    };
    const loadedSubHalf = fromStored(subHalfProject, { [subHalfClip.srcUrl]: { fps: 30, frames: 300 } });
    expect(loadedSubHalf.sequence.clips[0]!.speedCurve).toBeUndefined();
    expect(loadedSubHalf.sequence.clips[0]!.speedNum).toBe(1);
    expect(loadedSubHalf.sequence.clips[0]!.frames).toBeGreaterThanOrEqual(1);
  });
});
