import { describe, expect, it } from 'vitest';
import { applyChange, mergeWindow, runCurveEdit, type ChangeMark } from '@/lib/brand-studio/editor-v2/edit-steps';
import { applyClipSpeedCurve, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { EditorDoc, EditorHistory } from '@/lib/brand-studio/editor-v2/model';
import { realDoc } from '@/lib/brand-studio/editor-v2/real';
import type { SpeedCurveRefusal } from '@/lib/brand-studio/editor-v2/frames';
import type { SpeedPoint } from '@/lib/brand-studio/editor-v2/speed-curve';

/**
 * Review item 8: dragging a curve point is one undo step (moves within 900 ms of each other join it). The
 * refusal of a shape the cut cannot take (audit A2) returned before the change, so a refused move no longer kept
 * that window open: a drag that lingered where it is refused and came back made a second undo step. And every
 * accepted move worked the retime out twice. These tests run the editor's own pieces (the hook's `change` is
 * `mergeWindow` + `applyChange`, its curve edit is `runCurveEdit`) through a drag.
 */
const KEY = 'clip-speed:c1';
const cut: FrameClip = {
  id: 'c1',
  label: 'c1',
  srcUrl: '/media/a.mp4',
  thumbUrl: null,
  sourceFps: 24,
  sourceFrames: 240,
  inFrame: 0,
  phase: 0,
  frames: 1,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
};
const film: FrameSequence = { fps: 24, aspect: '9:16', captions: [], clips: [cut] };
const middle = (speed: number): SpeedPoint[] => [
  { pos: 0, speed: 1 },
  { pos: 0.5, speed },
  { pos: 1, speed: 1 },
];

/** The editor's state and its `change`, as the hook wires them. */
function editor(start: EditorDoc) {
  let stored: { doc: EditorDoc; history: EditorHistory } = { doc: start, history: { past: [], future: [] } };
  let mark: ChangeMark | null = null;
  const said: SpeedCurveRefusal[] = [];
  let applied = 0;
  const counted: typeof applyClipSpeedCurve = (...args) => {
    applied += 1;
    return applyClipSpeedCurve(...args);
  };
  const move = (points: readonly SpeedPoint[], at: number, coalesce = true) =>
    runCurveEdit(
      {
        doc: stored.doc,
        change: (mutate, key) => {
          const window = mergeWindow(mark, key, at);
          mark = window.mark;
          stored = applyChange(stored, mutate(stored.doc), window.merge);
        },
        say: (refused) => said.push(refused),
      },
      0,
      points,
      coalesce ? KEY : undefined,
      counted,
    );
  return { move, said, state: () => stored, applied: () => applied };
}

describe('a curve drag through a refused stretch is still one undo step', () => {
  it('accepted, refused for 1.5 s, accepted again 0.3 s after the last refused move: one step', () => {
    const ed = editor(realDoc(film));
    ed.move(middle(0.8), 0);
    ed.move(middle(3), 500);
    ed.move(middle(5), 1000);
    ed.move(middle(4), 1500);
    ed.move(middle(0.7), 1800);
    expect(ed.said).toEqual(['too_short', 'too_short', 'too_short']);
    expect(ed.state().history.past).toHaveLength(1);
    expect(ed.state().doc.sequence.clips[0]!.speedCurve?.points[1]?.speed).toBeCloseTo(0.7, 6);
  });

  it('a pause longer than the window still starts a new step', () => {
    const ed = editor(realDoc(film));
    ed.move(middle(0.8), 0);
    ed.move(middle(0.7), 2000);
    expect(ed.state().history.past).toHaveLength(2);
  });

  it('a refused click on a shape (no drag) changes nothing and makes no step', () => {
    const ed = editor(realDoc(film));
    ed.move(middle(3), 0, false);
    expect(ed.said).toEqual(['too_short']);
    expect(ed.state().history.past).toHaveLength(0);
  });

  it('each accepted move works the retime out once', () => {
    const ed = editor(realDoc(film));
    ed.move(middle(0.8), 0);
    ed.move(middle(0.6), 100);
    expect(ed.applied()).toBe(2);
  });
});
