import { describe, expect, it } from 'vitest';
import {
  clipPlaybackRate,
  emptyComposerProject,
  parseStoredProject,
  serializeProjectForStorage,
  timelineSpans,
  type ComposeClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { cutAnchor, storedSecToFrame } from '@/lib/brand-studio/editor-v2/cut-anchor';
import { clipFrameAt, setClipConstantSpeed, setClipSpeedCurve, spansOf, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { SPEED_PRESETS } from '@/lib/brand-studio/editor-v2/speed-curve';
import { fromStored, toStored } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Audit B5 (2026-11-24). The new editor keeps any speed from 0.10× to 10× and speed curves; the seconds both
 * editors read (`trimStartSec`, `trimEndSec`, `playbackRate`) carry the speed clamped to the old editor's 0.25–4,
 * or a curve's average speed. The locked workspaces (colour, sound, captions) send people to the old editor,
 * which lays the cuts out from those seconds. These tests MEASURE what the old editor's own reader makes of a
 * film the new editor saved, so the warning next to the old-editor link rests on a fact, not a guess.
 */
const FPS = 24;
const SRC = ['/media/slow.mp4', '/media/fast.mp4', '/media/curve.mp4'];

/** Three ten-second, 24 fps pieces of footage as the old editor stored them: whole, at 1×. */
function storedFilm(): ComposerProject {
  const clip = (id: string, srcUrl: string): ComposeClip => ({ id, label: id, sourceKind: 'asset', srcUrl, durationSec: 10, trimStartSec: 0, trimEndSec: 10, volume: 1, muted: false });
  return { ...emptyComposerProject('9:16'), clips: [clip('slow', SRC[0]!), clip('fast', SRC[1]!), clip('curve', SRC[2]!)] };
}

/** The same film in the new editor, then 0.1× on the first cut, 10× on the second and a "slow middle" curve on the third. */
function retimed(): { film: ComposerProject; sequence: FrameSequence } {
  const film = storedFilm();
  const measured = Object.fromEntries(SRC.map((src) => [src, { fps: FPS, frames: 240, counted: true }]));
  let sequence = fromStored(film, measured).sequence;
  sequence = setClipConstantSpeed(sequence, 0, 0.1);
  sequence = setClipConstantSpeed(sequence, 1, 10);
  sequence = setClipSpeedCurve(sequence, 2, SPEED_PRESETS.find((preset) => preset.id === 'slowMiddle')!.points);
  return { film, sequence };
}

/** What the old editor reads back: the new editor's save, through the old editor's own storage format and layout. */
function throughOldEditor(sequence: FrameSequence, film: ComposerProject) {
  const saved = parseStoredProject(serializeProjectForStorage(toStored(sequence, film)))!;
  return { saved, spans: timelineSpans(saved) };
}

describe('a film the new editor retimed, read by the old editor (measured, B5)', () => {
  const { film, sequence } = retimed();
  const { saved, spans } = throughOldEditor(sequence, film);
  const newSeconds = sequence.clips.map((clip) => clip.frames / FPS);

  it('the new editor: 0.1× is 100 s, 10× is 1 s, the "slow middle" curve 538 frames (22.42 s)', () => {
    expect(sequence.clips.map((clip) => clip.frames)).toEqual([2400, 24, 538]);
    expect(newSeconds.map((s) => Number(s.toFixed(2)))).toEqual([100, 1, 22.42]);
    expect(sequence.clips[2]!.speedCurve).toBeDefined();
  });

  it('the stored speed is clamped to 0.25–4, or the curve’s average', () => {
    expect(saved.clips.map((clip) => clipPlaybackRate(clip))).toEqual([0.25, 4, 0.45]);
    expect(saved.clips.map((clip) => [clip.trimStartSec, clip.trimEndSec])).toEqual([
      [0, 10],
      [0, 10],
      [0, 10],
    ]);
  });

  it('the old editor lays the cuts out at 40 s, 2.5 s and 22.2 s (new editor: 100 s, 1 s, 22.42 s)', () => {
    // The 0.1× cut 2.5 times shorter, the 10× cut 2.5 times longer, the curve cut 0.22 s shorter.
    expect(spans.map((span) => span.durationSec)).toEqual([40, 2.5, 22.2]);
  });

  it('the curve cut: the old editor plays it at one average speed, so a moment inside it shows another picture', () => {
    const curve = sequence.clips[2]!;
    const oldSpan = spans[2]!;
    const oldRate = clipPlaybackRate(saved.clips[2]!);
    // A quarter of the way into the cut, as the old editor shows it (constant average speed) and as the new one does.
    const offsetSec = oldSpan.durationSec / 4;
    const oldPicture = Math.floor((saved.clips[2]!.trimStartSec + offsetSec * oldRate) * FPS);
    const newPicture = clipFrameAt(curve, Math.round(offsetSec * FPS), FPS).mediaFrame;
    // 5.55 s in: the old editor shows source frame 59, the new editor 72.
    expect([oldPicture, newPicture]).toEqual([59, 72]);
  });

  it('a caption placed in the old editor lands on another picture in the new editor’s file', () => {
    const anchor = cutAnchor(saved, sequence);
    const span = spansOf(sequence);
    // Halfway into the 10× cut on the old editor's timeline: 1.25 s in, past the new cut's 1 s, so it is pushed to the cut's last frame.
    const fastMiddle = spans[1]!.timelineStartSec + spans[1]!.durationSec / 2;
    expect(storedSecToFrame(anchor, fastMiddle)).toBe(span[1]!.start + span[1]!.frames - 1);
    // 30 s into the 0.1× cut: the old editor shows the footage at 30 × 0.25 = 7.5 s, the new editor at 30 × 0.1 = 3 s.
    const slowAt = spans[0]!.timelineStartSec + 30;
    const newFrame = storedSecToFrame(anchor, slowAt);
    const shownNew = clipFrameAt(sequence.clips[0]!, newFrame - span[0]!.start, FPS).mediaFrame;
    const shownOld = Math.floor(30 * clipPlaybackRate(saved.clips[0]!) * FPS);
    expect(shownOld).toBe(180);
    expect(shownNew).toBe(72);
  });
});
