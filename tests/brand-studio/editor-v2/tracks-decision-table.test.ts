import { describe, expect, it } from 'vitest';
import {
  applyClipSpeedCurve,
  filmFrames,
  insertClips,
  moveClip,
  removeClips,
  setClipConstantSpeed,
  spansOf,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  wholeFrameViolations,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import { commit, undo, withSequence, type EditorDoc, type EditorHistory } from '@/lib/brand-studio/editor-v2/model';
import { realDoc } from '@/lib/brand-studio/editor-v2/real';
import {
  MAX_OVERLAY_TRACKS,
  SNAP_ENGAGE_PX,
  SNAP_RELEASE_PX,
  TRACK_LIFT_HYSTERESIS_PX,
  activeOverlaysAt,
  allOverlayClips,
  canMoveClipUpOneTrack,
  collectSnapTargets,
  computeDropTarget,
  dropOverlayToMain,
  findOverlayClip,
  liftMainCutToOverlay,
  moveClipDownOneTrack,
  moveClipUpOneTrack,
  moveOverlayClip,
  overlayTracksOf,
  p1LinkTargetForStart,
  p2PropagateLinkedShift,
  p3HandleTrimmedLinkSource,
  p4ReassignLinkAfterSplit,
  p5ResolveOccupiedOverlayDrop,
  p6PruneEmptyOverlayTracks,
  p7MainTrackDropAndReorder,
  p8ComputeSnap,
  p9DefaultOverlayFraming,
  p10DefaultTrackToggles,
  parseTracksPrefs,
  removeOverlayClips,
  setOverlayAudio,
  setOverlayConstantSpeed,
  splitAllTracksAtFrame,
  splitOverlayAtFrame,
  trimOverlayEdge,
  type OverlayClip,
  type TrackRowRect,
} from '@/lib/brand-studio/editor-v2/tracks';

function makeClip(
  id: string,
  frames = 72,
  overrides: Partial<FrameClip> = {},
): FrameClip {
  return {
    id,
    label: id,
    srcUrl: `https://media.example.invalid/${id}.mp4`,
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 240,
    inFrame: 0,
    phase: 0,
    frames,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function makeSeq(clips: FrameClip[], fps = 24, overlayTracks?: FrameSequence['overlayTracks']): FrameSequence {
  return {
    fps,
    aspect: '9:16',
    clips,
    captions: [],
    ...(overlayTracks ? { overlayTracks } : {}),
  };
}

function makeOverlay(
  id: string,
  startFrame: number,
  frames: number,
  seq: FrameSequence,
  overrides: Partial<OverlayClip> = {},
): OverlayClip {
  return {
    ...makeClip(id, frames),
    startFrame,
    link: p1LinkTargetForStart(seq, startFrame),
    ...overrides,
  };
}

function seededPrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('E-T Batch T1 — reference behaviour decision table (spec §12)', () => {
  it('Row 1: delete a middle main clip with magnet ON closes the gap', () => {
    const seq = makeSeq([makeClip('A', 48), makeClip('B', 72), makeClip('C', 60)]);
    const doc = realDoc(seq);
    const next = withSequence(doc, removeClips(seq, ['B']), [], { linkage: true }).sequence;
    expect(next.clips.map((c) => c.id)).toEqual(['A', 'C']);
    expect(spansOf(next).map((s) => [s.clip.id, s.start, s.end])).toEqual([
      ['A', 0, 48],
      ['C', 48, 108],
    ]);
    expect(totalFrames(next)).toBe(108);
  });

  it('Row 3: delete a main clip with linkage ON deletes its linked overlays (1 undo step restores all)', () => {
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72), makeClip('C', 72)]);
    const ovB = makeOverlay('ovB', 80, 40, base); // start inside B (72..144)
    const ovC = makeOverlay('ovC', 160, 30, base); // start inside C (144..216)
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB, ovC] }]);
    const before = realDoc(seq);
    let history: EditorHistory = { past: [], future: [] };

    history = commit(history, before);
    const after = withSequence(before, removeClips(seq, ['B']), [], { linkage: true });

    expect(after.sequence.clips.map((c) => c.id)).toEqual(['A', 'C']);
    expect(allOverlayClips(after.sequence).map((c) => c.id)).toEqual(['ovC']);
    // ovC shifted left by B's 72 frames with C (160 - 72 = 88).
    expect(findOverlayClip(after.sequence, 'ovC')?.clip.startFrame).toBe(88);

    const restored = undo(history, after);
    expect(restored?.doc).toEqual(before);
  });

  it('Row 4: delete a main clip with linkage OFF leaves overlays at their absolute time', () => {
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72), makeClip('C', 72)]);
    const ovB = makeOverlay('ovB', 80, 40, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    const after = withSequence(realDoc(seq), removeClips(seq, ['B']), [], { linkage: false }).sequence;

    expect(allOverlayClips(after).map((c) => c.id)).toEqual(['ovB']);
    expect(findOverlayClip(after, 'ovB')?.clip.startFrame).toBe(80);
    // No dangling link to deleted 'B': re-linked to 'C' now under frame 80.
    expect(findOverlayClip(after, 'ovB')?.clip.link?.clipId).toBe('C');
    expect(wholeFrameViolations(after)).toEqual([]);
  });

  it('Row 6: drag a main clip to another place on the main track reorders head-to-tail', () => {
    const seq = makeSeq([makeClip('A', 48), makeClip('B', 72), makeClip('C', 60)]);
    const next = withSequence(realDoc(seq), moveClip(seq, 2, 0), [], { linkage: true }).sequence;
    expect(next.clips.map((c) => c.id)).toEqual(['C', 'A', 'B']);
    expect(spansOf(next).map((s) => [s.clip.id, s.start, s.end])).toEqual([
      ['C', 0, 60],
      ['A', 60, 108],
      ['B', 108, 180],
    ]);
  });

  it('Row 8: move a main clip with linkage ON moves its linked overlay by the same amount', () => {
    const base = makeSeq([makeClip('A', 48), makeClip('B', 72), makeClip('C', 60)]);
    const ovB = makeOverlay('ovB', 60, 36, base); // 12 frames into B (start 48 -> 60)
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    // Move B from index 1 to index 2: B moves from start 48 to start 108 (+60 frames).
    const after = withSequence(realDoc(seq), moveClip(seq, 1, 2), [], { linkage: true }).sequence;
    expect(findOverlayClip(after, 'ovB')?.clip.startFrame).toBe(120);
    expect(findOverlayClip(after, 'ovB')?.clip.link?.clipId).toBe('B');
  });

  it('Row 9: move a main clip with linkage OFF leaves overlays at their absolute time', () => {
    const base = makeSeq([makeClip('A', 48), makeClip('B', 72), makeClip('C', 60)]);
    const ovB = makeOverlay('ovB', 60, 36, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    const after = withSequence(realDoc(seq), moveClip(seq, 1, 2), [], { linkage: false }).sequence;
    expect(findOverlayClip(after, 'ovB')?.clip.startFrame).toBe(60);
  });

  it('Row 10: moving or deleting an overlay clip does not move or delete another overlay stacked above it', () => {
    const base = makeSeq([makeClip('A', 120)]);
    const lower = makeOverlay('ovLow', 10, 60, base);
    const upper = makeOverlay('ovHigh', 20, 40, base);
    const seq = makeSeq(base.clips, 24, [
      { id: 'ov-1', clips: [lower] },
      { id: 'ov-2', clips: [upper] },
    ]);
    const moved = moveOverlayClip(seq, 'ovLow', { kind: 'overlay-row', trackIndex: 0 }, 40).seq;
    expect(findOverlayClip(moved, 'ovHigh')?.clip.startFrame).toBe(20);
    const deleted = removeOverlayClips(seq, ['ovLow']);
    expect(findOverlayClip(deleted, 'ovHigh')?.clip.startFrame).toBe(20);
  });

  it('Row 11: moving or deleting an overlay clip leaves the main track unaffected (one-way linkage)', () => {
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72)]);
    const ov = makeOverlay('ov1', 20, 40, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov] }]);
    const afterMove = withSequence(realDoc(seq), moveOverlayClip(seq, 'ov1', { kind: 'overlay-row', trackIndex: 0 }, 90).seq, [], { linkage: true }).sequence;
    expect(afterMove.clips).toEqual(seq.clips);
    const afterDel = withSequence(realDoc(seq), removeOverlayClips(seq, ['ov1']), [], { linkage: true }).sequence;
    expect(afterDel.clips).toEqual(seq.clips);
  });

  it('Row 12: delete a clip on an overlay track leaves other clips on that track at their exact time (no ripple)', () => {
    const base = makeSeq([makeClip('A', 200)]);
    const ov1 = makeOverlay('ov1', 10, 30, base);
    const ov2 = makeOverlay('ov2', 60, 40, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov1, ov2] }]);
    const after = removeOverlayClips(seq, ['ov1']);
    expect(findOverlayClip(after, 'ov2')?.clip.startFrame).toBe(60);
    expect(overlayTracksOf(after)).toHaveLength(1);
  });

  it('Row 13: trim a main clip right edge shorter closes gap and pulls later main clips + linked overlays left', () => {
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72)]);
    const ovB = makeOverlay('ovB', 84, 30, base); // 12 frames into B
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    const trimmed = trimClipEdge(seq, 0, 'end', -24).seq;
    const after = withSequence(realDoc(seq), trimmed, [], { linkage: true }).sequence;
    expect(spansOf(after)[1]!.start).toBe(48);
    expect(findOverlayClip(after, 'ovB')?.clip.startFrame).toBe(60);
  });

  it('Row 15: Q / W trim to playhead removes left or right part and closes main gap while shifting linked overlays', () => {
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72)]);
    const ovB = makeOverlay('ovB', 80, 30, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    // Q at frame 24 trims first 24 frames of A
    const afterQ = withSequence(realDoc(seq), trimClipEdge(seq, 0, 'start', 24).seq, [], { linkage: true }).sequence;
    expect(afterQ.clips[0]!.frames).toBe(48);
    expect(findOverlayClip(afterQ, 'ovB')?.clip.startFrame).toBe(56);
    // W at frame 30 on afterQ trims tail of A by -18
    const afterW = withSequence(realDoc(afterQ), trimClipEdge(afterQ, 0, 'end', -18).seq, [], { linkage: true }).sequence;
    expect(afterW.clips[0]!.frames).toBe(30);
    expect(findOverlayClip(afterW, 'ovB')?.clip.startFrame).toBe(38);
  });

  it('Row 16: split selected overlay clip at playhead (and split-all-tracks splits main + all overlays)', () => {
    const base = makeSeq([makeClip('A', 120)]);
    const ov = makeOverlay('ov1', 20, 60, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov] }]);
    const splitSingle = splitOverlayAtFrame(seq, 'ov1', 50, 'ov1-r');
    expect(splitSingle.ok).toBe(true);
    expect(overlayTracksOf(splitSingle.seq)[0]!.clips.map((c) => [c.id, c.startFrame, c.frames])).toEqual([
      ['ov1', 20, 30],
      ['ov1-r', 50, 30],
    ]);

    let n = 0;
    const allOut = splitAllTracksAtFrame(seq, 50, () => `piece-${++n}`);
    expect(allOut.ok).toBe(true);
    const reconciled = withSequence(realDoc(seq), allOut.seq, allOut.inherit, { linkage: true }).sequence;
    expect(reconciled.clips.map((c) => c.frames)).toEqual([50, 70]);
    expect(overlayTracksOf(reconciled)[0]!.clips.map((c) => [c.startFrame, c.frames])).toEqual([
      [20, 30],
      [50, 30],
    ]);
    expect(wholeFrameViolations(reconciled)).toEqual([]);
  });

  it('Row 18: drag to blank area above top track creates a new track at top', () => {
    const base = makeSeq([makeClip('A', 120)]);
    const ov1 = makeOverlay('ov1', 0, 40, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov1] }]);
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 0, top: 40, bottom: 94 },
      { kind: 'main', top: 98, bottom: 162 },
    ];
    const target = computeDropTarget({
      sequence: seq,
      source: { kind: 'overlay', clipId: 'ov1', trackIndex: 0 },
      clientY: 20, // blank area above top track (top=40)
      dropFrame: 12,
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(target.kind).toBe('new-track');
    if (target.kind === 'new-track') {
      expect(target.insertTrackIndex).toBe(1);
      expect(target.lineY).toBe(40);
    }
  });

  it('Row 19: drag a main clip upward creates a video overlay track above and turns it into an overlay', () => {
    const seq = makeSeq([makeClip('A', 72), makeClip('B', 48)]);
    const rows: TrackRowRect[] = [{ kind: 'main', top: 100, bottom: 164 }];
    const target = computeDropTarget({
      sequence: seq,
      source: { kind: 'main', index: 1 },
      clientY: 100 - TRACK_LIFT_HYSTERESIS_PX - 10,
      dropFrame: 24,
      rows,
      mainRow: { top: 100, bottom: 164 },
    });
    expect(target.kind).toBe('new-track');
    if (target.kind === 'new-track') {
      const lifted = liftMainCutToOverlay(seq, 1, target, 24);
      expect(lifted.ok).toBe(true);
      expect(lifted.seq.clips.map((c) => c.id)).toEqual(['A']);
      expect(overlayTracksOf(lifted.seq)).toHaveLength(1);
      expect(findOverlayClip(lifted.seq, 'B')?.clip.startFrame).toBe(24);
    }
  });

  it('Row 20: lifting a main clip closes the main gap first (C2); lifting last main cut is refused', () => {
    const seq = makeSeq([makeClip('A', 48), makeClip('B', 72), makeClip('C', 60)]);
    // Lift middle clip B at frame 60 (on closed main [A:0..48, C:48..108], frame 60 is inside C!)
    const res = liftMainCutToOverlay(seq, 1, { kind: 'new-track', insertTrackIndex: 0 }, 60);
    expect(res.ok).toBe(true);
    expect(spansOf(res.seq).map((s) => [s.clip.id, s.start, s.end])).toEqual([
      ['A', 0, 48],
      ['C', 48, 108],
    ]);
    expect(findOverlayClip(res.seq, 'B')?.clip.link?.clipId).toBe('C');

    // Refuses lifting the last main cut
    const single = makeSeq([makeClip('Only', 72)]);
    const refused = liftMainCutToOverlay(single, 0, { kind: 'new-track', insertTrackIndex: 0 }, 0);
    expect(refused.ok).toBe(false);
    expect(refused.refused).toBe('last_main_cut');
  });

  it('Row 21: drag an overlay clip onto another overlay track free span moves there (no new track)', () => {
    const base = makeSeq([makeClip('A', 200)]);
    const ov1 = makeOverlay('ov1', 0, 40, base);
    const ov2 = makeOverlay('ov2', 100, 40, base);
    const seq = makeSeq(base.clips, 24, [
      { id: 'ov-1', clips: [ov1] },
      { id: 'ov-2', clips: [ov2] },
    ]);
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 1, top: 40, bottom: 94 },
      { kind: 'overlay', trackIndex: 0, top: 98, bottom: 152 },
      { kind: 'main', top: 156, bottom: 220 },
    ];
    const target = computeDropTarget({
      sequence: seq,
      source: { kind: 'overlay', clipId: 'ov2', trackIndex: 1 },
      clientY: 120, // inside track 0, dropFrame 60 is free (touching or past ov1 0..40)
      dropFrame: 40, // touching edge legal!
      rows,
      mainRow: { top: 156, bottom: 220 },
    });
    expect(target).toEqual({ kind: 'overlay-row', trackIndex: 0, startFrame: 40 });
    const moved = moveOverlayClip(seq, 'ov2', target as { kind: 'overlay-row'; trackIndex: number }, 40);
    expect(moved.ok).toBe(true);
    // Track 1 became empty and disappeared immediately (Row 31 / P6).
    expect(overlayTracksOf(moved.seq)).toHaveLength(1);
    expect(overlayTracksOf(moved.seq)[0]!.clips.map((c) => [c.id, c.startFrame])).toEqual([
      ['ov1', 0],
      ['ov2', 40],
    ]);
  });

  it('Row 22 (C4 observed): drop onto occupied span of overlay track ALWAYS creates a new track directly ABOVE', () => {
    const base = makeSeq([makeClip('A', 200)]);
    const ov1 = makeOverlay('ov1', 20, 60, base);
    const ov2 = makeOverlay('ov2', 100, 40, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov1, ov2] }]);
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 0, top: 40, bottom: 94 },
      { kind: 'main', top: 98, bottom: 162 },
    ];
    const upperTarget = computeDropTarget({
      sequence: seq,
      source: { kind: 'overlay', clipId: 'ov2', trackIndex: 0 },
      clientY: 50,
      dropFrame: 30, // overlaps ov1 (20..80)
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(upperTarget).toEqual({ kind: 'new-track', insertTrackIndex: 1, startFrame: 30, lineY: 40 });

    // Even in the lower half of the hovered row, C4 places an occupied overlay video directly ABOVE (lineY = row.top).
    const lowerTarget = computeDropTarget({
      sequence: seq,
      source: { kind: 'overlay', clipId: 'ov2', trackIndex: 0 },
      clientY: 85,
      dropFrame: 30,
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(lowerTarget).toEqual({ kind: 'new-track', insertTrackIndex: 1, startFrame: 30, lineY: 40 });
  });

  it('Row 23 (S2, W4): overlay on main inserts at pointer boundary; drop below main is refused', () => {
    const base = makeSeq([makeClip('A', 50), makeClip('B', 50)]);
    const ov = makeOverlay('ov1', 10, 60, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov] }]);
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 0, top: 40, bottom: 94 },
      { kind: 'main', top: 98, bottom: 162 },
    ];
    // S2: clip starts at dropFrame=10 (near boundary 0), but pointer is at frame 85 (near boundary 100 -> index 2).
    const targetOnMain = computeDropTarget({
      sequence: seq,
      source: { kind: 'overlay', clipId: 'ov1', trackIndex: 0 },
      clientY: 130,
      dropFrame: 10,
      pointerFrame: 85,
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(targetOnMain).toEqual({ kind: 'main-track', insertIndex: 2, isReorder: false });

    // W4: pointer below mainRow.bottom (e.g., caption lane at y=250) is refused for both overlay and main clips.
    const refusedOverlay = computeDropTarget({
      sequence: seq,
      source: { kind: 'overlay', clipId: 'ov1', trackIndex: 0 },
      clientY: 250,
      dropFrame: 48,
      pointerFrame: 48,
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(refusedOverlay).toEqual({ kind: 'refused', reason: 'below_main' });
    const refusedMain = computeDropTarget({
      sequence: seq,
      source: { kind: 'main', index: 0 },
      clientY: 250,
      dropFrame: 48,
      pointerFrame: 48,
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(refusedMain).toEqual({ kind: 'refused', reason: 'below_main' });

    const dropped = dropOverlayToMain(seq, 'ov1', 1);
    expect(dropped.ok).toBe(true);
    expect(dropped.seq.clips.map((c) => c.id)).toEqual(['A', 'ov1', 'B']);
    expect(overlayTracksOf(dropped.seq)).toHaveLength(0);
  });

  it('Row 25 (D1–D3, D5 observed): snap engages at <= 2px on both edges (playhead, clip edges, and time 0) with 6px release hysteresis', () => {
    const base = makeSeq([makeClip('A', 100), makeClip('B', 100)]);
    const targets = collectSnapTargets(base, 45);
    expect(targets).toContain(0);
    // Start edge within 2px of playhead 45 (1 frame at ppf=2 -> 2px <= SNAP_ENGAGE_PX)
    const snapStart = p8ComputeSnap({ frame: 44, clipFrames: 30, targets, pxPerFrame: 2, enabled: true });
    expect(snapStart).toEqual({ snappedFrame: 45, guideFrame: 45 });
    // End edge within 2px of cut boundary 100 (start 69 + length 30 = 99 -> 1 frame = 2px <= 2px)
    const snapEnd = p8ComputeSnap({ frame: 69, clipFrames: 30, targets, pxPerFrame: 2, enabled: true });
    expect(snapEnd).toEqual({ snappedFrame: 70, guideFrame: 100 });
    // Release hysteresis (D5): once snapped at 45, 3 frames away = 6px still holds; 4 frames = 8px releases!
    expect(p8ComputeSnap({ frame: 48, clipFrames: 30, targets, pxPerFrame: 2, enabled: true, prevGuideFrame: 45 })).toEqual({
      snappedFrame: 45,
      guideFrame: 45,
    });
    expect(p8ComputeSnap({ frame: 49, clipFrames: 30, targets, pxPerFrame: 2, enabled: true, prevGuideFrame: 45 })).toEqual({
      snappedFrame: 49,
      guideFrame: null,
    });
  });

  it('Row 26 (D6 observed): snapping OFF stays free with no guide line (switch N is the control)', () => {
    const targets = [0, 50, 100];
    expect(p8ComputeSnap({ frame: 49, clipFrames: 30, targets, pxPerFrame: 2, enabled: false })).toEqual({
      snappedFrame: 49,
      guideFrame: null,
    });
  });

  it('Row 31: when the last clip leaves an overlay track, that track disappears immediately', () => {
    const base = makeSeq([makeClip('A', 120)]);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [makeOverlay('ov1', 10, 30, base)] }]);
    const after = removeOverlayClips(seq, ['ov1']);
    expect(after.overlayTracks).toBeUndefined();
  });

  it('Row 33: clip on a higher track covers lower tracks in draw order', () => {
    const base = makeSeq([makeClip('A', 120)]);
    const seq = makeSeq(base.clips, 24, [
      { id: 'ov-1', clips: [makeOverlay('low', 0, 60, base)] },
      { id: 'ov-2', clips: [makeOverlay('high', 10, 40, base)] },
    ]);
    const layers = activeOverlaysAt(seq, 25);
    expect(layers.map((l) => l.clip.id)).toEqual(['low', 'high']); // drawn in order -> 'high' covers 'low'
  });
});

describe('E-T Batch T1 — isolated provisional rules P1–P10', () => {
  it('P1: p1LinkTargetForStart links to the main clip under START (not overlap)', () => {
    const seq = makeSeq([makeClip('A', 48), makeClip('B', 72)]);
    // Overlay starting at 40 and spanning 40..90 overlaps B, but links ONLY to A (under start 40)
    expect(p1LinkTargetForStart(seq, 40)).toEqual({ clipId: 'A', sourceFrame: 40 });
    expect(p1LinkTargetForStart(seq, 48)).toEqual({ clipId: 'B', sourceFrame: 0 });
    expect(p1LinkTargetForStart(seq, 120)).toBeNull();
  });

  it('P2: p2PropagateLinkedShift shifts linked overlay when an earlier main clip changes', () => {
    const before = makeSeq([makeClip('A', 72), makeClip('B', 72)]);
    const after = insertClips(before, 0, [makeClip('Intro', 24)]);
    const shifted = p2PropagateLinkedShift(spansOf(before)[1]!, spansOf(after)[2]!, 84, 12, 24);
    expect(shifted).toBe(108);
  });

  it('P3 (A10 observed once): left-trimmed head slides overlay to parent new start keeping full length; right-trimmed tail keeps absolute start', () => {
    // Left-trim head case (A10, observed once): B starts at frame 48, ovB starts at frame 54 (6 frames into B, length 30).
    // Trim B's left edge right by +20 frames -> sourceFrame 6 was in the removed head -> ovB slides to B's new start (48) and keeps length 30!
    const baseLeft = makeSeq([makeClip('A', 48), makeClip('B', 72)]);
    const ovB = makeOverlay('ovB', 54, 30, baseLeft);
    const seqLeft = makeSeq(baseLeft.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    const trimmedLeft = trimClipEdge(seqLeft, 1, 'start', 20).seq;
    const afterLeft = withSequence(realDoc(seqLeft), trimmedLeft, [], { linkage: true }).sequence;
    const slid = findOverlayClip(afterLeft, 'ovB')?.clip;
    expect(slid?.startFrame).toBe(48);
    expect(slid?.frames).toBe(30);
    expect(slid?.link).toEqual({ clipId: 'B', sourceFrame: 20 });

    // Right-trim tail case: A trimmed from 72 to 48 -> ovA at frame 60 keeps absolute start 60 and re-links to B.
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72)]);
    const ovA = makeOverlay('ovA', 60, 30, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovA] }]);
    const trimmed = trimClipEdge(seq, 0, 'end', -24).seq;
    const after = withSequence(realDoc(seq), trimmed, [], { linkage: true }).sequence;
    const kept = findOverlayClip(after, 'ovA')?.clip;
    expect(kept?.startFrame).toBe(60);
    expect(kept?.frames).toBe(30);
    expect(kept?.link?.clipId).toBe('B');
    expect(p3HandleTrimmedLinkSource(after, 60)).toEqual({ startFrame: 60, link: { clipId: 'B', sourceFrame: 12 } });
  });

  it('P4: p4ReassignLinkAfterSplit links to the piece under start; deleting one piece deletes only overlays on that piece', () => {
    const base = makeSeq([makeClip('A', 100), makeClip('B', 60)]);
    const ovLeft = makeOverlay('ovLeft', 20, 20, base);
    const ovRight = makeOverlay('ovRight', 70, 20, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovLeft, ovRight] }]);
    const splitSeq = splitAtFrame(seq, 50, 'A-right');
    const afterSplit = withSequence(realDoc(seq), splitSeq, [['A-right', 'A']], { linkage: true }).sequence;
    expect(findOverlayClip(afterSplit, 'ovLeft')?.clip.link?.clipId).toBe('A');
    expect(findOverlayClip(afterSplit, 'ovRight')?.clip.link?.clipId).toBe('A-right');
    expect(p4ReassignLinkAfterSplit(afterSplit, 'A', 'A-right', 70, 70)).toEqual({ clipId: 'A-right', sourceFrame: 70 });

    // Deleting A-right deletes ONLY ovRight; ovLeft remains intact.
    const afterDel = withSequence(realDoc(afterSplit), removeClips(afterSplit, ['A-right']), [], { linkage: true }).sequence;
    expect(allOverlayClips(afterDel).map((c) => c.id)).toEqual(['ovLeft']);
  });

  it('P5 (C4 observed): p5ResolveOccupiedOverlayDrop always places directly above hovered track and enforces MAX_OVERLAY_TRACKS cap', () => {
    expect(p5ResolveOccupiedOverlayDrop(0, 1)).toEqual({ ok: true, insertTrackIndex: 1 });
    expect(p5ResolveOccupiedOverlayDrop(1, 2)).toEqual({ ok: true, insertTrackIndex: 2 });
    expect(p5ResolveOccupiedOverlayDrop(2, MAX_OVERLAY_TRACKS)).toEqual({ ok: false, reason: 'track_limit' });
  });

  it('P6 (C11 observed): p6PruneEmptyOverlayTracks removes empty tracks immediately', () => {
    const base = makeSeq([makeClip('A', 72)]);
    const tracks = [
      { id: 'ov-1', clips: [] },
      { id: 'ov-2', clips: [makeOverlay('x', 0, 20, base)] },
      { id: 'ov-3', clips: [] },
    ];
    expect(p6PruneEmptyOverlayTracks(tracks).map((t) => t.id)).toEqual(['ov-2']);
  });

  it('P7 (B3, B4, C10 observed): inserts at nearest boundary for overlay and uses closed-up neighbour midpoint for main reorder', () => {
    const spans = spansOf(makeSeq([makeClip('A', 40), makeClip('B', 60)]));
    // Overlay drop: boundaries at 0, 40, 100
    expect(p7MainTrackDropAndReorder(spans, null, 15)).toBe(0);
    expect(p7MainTrackDropAndReorder(spans, null, 35)).toBe(1);
    expect(p7MainTrackDropAndReorder(spans, null, 85)).toBe(2);
    // Main reorder (B4): with A (40f) removed and track closed up, B sits at 0..60 -> closed midpoint is 30!
    expect(p7MainTrackDropAndReorder(spans, 0, 29)).toBe(0);
    expect(p7MainTrackDropAndReorder(spans, 0, 31)).toBe(1);
  });

  it('P8 (D5 once, D6 observed): p8ComputeSnap enforces 2px engage / 6px release hysteresis and both-edge snapping', () => {
    expect(SNAP_ENGAGE_PX).toBe(2);
    expect(SNAP_RELEASE_PX).toBe(6);
    // At ppf=1: 2px engages, 3px does NOT engage fresh
    expect(p8ComputeSnap({ frame: 98, clipFrames: 20, targets: [100], pxPerFrame: 1, enabled: true })).toEqual({
      snappedFrame: 100,
      guideFrame: 100,
    });
    expect(p8ComputeSnap({ frame: 97, clipFrames: 20, targets: [100], pxPerFrame: 1, enabled: true })).toEqual({
      snappedFrame: 97,
      guideFrame: null,
    });
    // Once snapped at 100, 6px still holds; 7px releases
    expect(p8ComputeSnap({ frame: 106, clipFrames: 20, targets: [100], pxPerFrame: 1, enabled: true, prevGuideFrame: 100 })).toEqual({
      snappedFrame: 100,
      guideFrame: 100,
    });
    expect(p8ComputeSnap({ frame: 107, clipFrames: 20, targets: [100], pxPerFrame: 1, enabled: true, prevGuideFrame: 100 })).toEqual({
      snappedFrame: 107,
      guideFrame: null,
    });
  });

  it('P9 (F observed): p9DefaultOverlayFraming returns 100% scale, centred, fit defaults', () => {
    expect(p9DefaultOverlayFraming()).toEqual({ fit: 'fit', x: 0.5, y: 0.5, scale: 1, opacity: 1 });
  });

  it('P10 (§1, A1 observed): linkage ON, Overlay kind OFF, auto snap ON by default + parseTracksPrefs', () => {
    expect(p10DefaultTrackToggles()).toEqual({ linkage: true, linkageOverlay: false, snap: true });
    expect(parseTracksPrefs(null)).toEqual({ linkage: true, linkageOverlay: false, snap: true });
    expect(parseTracksPrefs({ linkage: false, linkageOverlay: true, snap: false })).toEqual({
      linkage: false,
      linkageOverlay: true,
      snap: false,
    });
  });
});

describe('E-T Batch T1 — C1 property tests, fractional rates, speed/curved parents & undo identity', () => {
  it('handles fractional frame rates (24000/1001, 30000/1001) and speed-changed / curved parents with integer frames', () => {
    const c1 = makeClip('ntsc24', 96, { sourceFps: 24000 / 1001, sourceFrames: 240 });
    const c2 = makeClip('ntsc30', 96, { sourceFps: 30000 / 1001, sourceFrames: 300 });
    const base = makeSeq([c1, c2], 24);
    const ov1 = makeOverlay('ov1', 24, 36, base, { sourceFps: 30000 / 1001, sourceFrames: 300 });
    const ov2 = makeOverlay('ov2', 120, 48, base, { sourceFps: 24000 / 1001, sourceFrames: 240 });
    let doc = realDoc(makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ov1, ov2] }]));

    // Speed-change parent c1 to 2x (96 -> 48 frames): ov1 follows its source frame & ov2 shifts left with c2!
    doc = withSequence(doc, setClipConstantSpeed(doc.sequence, 0, 2), [], { linkage: true });
    expect(wholeFrameViolations(doc.sequence)).toEqual([]);
    expect(Number.isInteger(findOverlayClip(doc.sequence, 'ov1')?.clip.startFrame)).toBe(true);
    expect(findOverlayClip(doc.sequence, 'ov2')?.clip.startFrame).toBe(120 - 48);

    // Apply a speed curve to c2: ov2 tracks its source frame on integer grid with zero violations.
    const curved = applyClipSpeedCurve(doc.sequence, 1, [
      { pos: 0, speed: 0.5 },
      { pos: 0.5, speed: 2 },
      { pos: 1, speed: 1 },
    ]);
    expect(curved.refused).toBeNull();
    doc = withSequence(doc, curved.seq, [], { linkage: true });
    expect(wholeFrameViolations(doc.sequence)).toEqual([]);
    expect(Number.isInteger(findOverlayClip(doc.sequence, 'ov2')?.clip.startFrame)).toBe(true);
    expect(filmFrames(doc.sequence)).toBeGreaterThanOrEqual(totalFrames(doc.sequence));
  });

  it('property test (C1): 250 random main + overlay edits never leave dangling links, overlaps, or non-integer frames', () => {
    const rand = seededPrng(20261128);
    let seqId = 0;
    const makeNextId = (p: string) => `${p}-${++seqId}`;

    const initialMain = [
      makeClip('m1', 72, { sourceFps: 24000 / 1001, sourceFrames: 300 }),
      makeClip('m2', 60, { sourceFps: 30000 / 1001, sourceFrames: 360 }),
      makeClip('m3', 84, { sourceFps: 24, sourceFrames: 300 }),
      makeClip('m4', 48, { sourceFps: 24000 / 1001, sourceFrames: 240 }),
    ];
    let doc: EditorDoc = realDoc(makeSeq(initialMain, 24));
    // Seed 3 overlay clips across 2 tracks
    const s0 = liftMainCutToOverlay(doc.sequence, 3, { kind: 'new-track', insertTrackIndex: 0 }, 24);
    doc = withSequence(doc, s0.seq, [], { linkage: true, liftedClipIds: ['m4'] });

    for (let step = 0; step < 250; step += 1) {
      const seq = doc.sequence;
      const linkage = rand() > 0.25;
      const op = Math.floor(rand() * 11);

      if (op === 0 && seq.clips.length < 12) {
        // Insert a fresh main cut
        const at = Math.floor(rand() * (seq.clips.length + 1));
        const fpsChoice = rand() < 0.5 ? 24000 / 1001 : 30000 / 1001;
        const fresh = makeClip(makeNextId('m'), 24 + Math.floor(rand() * 60), { sourceFps: fpsChoice, sourceFrames: 360 });
        doc = withSequence(doc, insertClips(seq, at, [fresh]), [], { linkage });
      } else if (op === 1 && seq.clips.length > 1) {
        // Reorder main cut
        const from = Math.floor(rand() * seq.clips.length);
        const to = Math.floor(rand() * seq.clips.length);
        doc = withSequence(doc, moveClip(seq, from, to), [], { linkage });
      } else if (op === 2 && seq.clips.length > 1) {
        // Trim main cut edge
        const idx = Math.floor(rand() * seq.clips.length);
        const edge = rand() < 0.5 ? 'start' : 'end';
        const delta = Math.floor(rand() * 31) - 15;
        doc = withSequence(doc, trimClipEdge(seq, idx, edge, delta).seq, [], { linkage });
      } else if (op === 3 && seq.clips.length < 12) {
        // Split main cut
        const spans = spansOf(seq);
        const span = spans[Math.floor(rand() * spans.length)]!;
        if (span.frames >= 4) {
          const at = span.start + 1 + Math.floor(rand() * (span.frames - 2));
          const nid = makeNextId('sp');
          doc = withSequence(doc, splitAtFrame(seq, at, nid), [[nid, span.clip.id]], { linkage });
        }
      } else if (op === 4 && seq.clips.length > 2) {
        // Delete main cut
        const idx = Math.floor(rand() * seq.clips.length);
        doc = withSequence(doc, removeClips(seq, [seq.clips[idx]!.id]), [], { linkage });
      } else if (op === 5 && seq.clips.length > 0) {
        // Constant speed on main cut
        const idx = Math.floor(rand() * seq.clips.length);
        const rates = [0.5, 1, 1.5, 2];
        const r = rates[Math.floor(rand() * rates.length)]!;
        doc = withSequence(doc, setClipConstantSpeed(seq, idx, r), [], { linkage });
      } else if (op === 6 && seq.clips.length > 2) {
        // Lift main cut to overlay
        const idx = Math.floor(rand() * seq.clips.length);
        const dropFrame = Math.floor(rand() * Math.max(1, totalFrames(seq)));
        const out = liftMainCutToOverlay(seq, idx, { kind: 'new-track', insertTrackIndex: 0 }, dropFrame);
        if (out.ok) doc = withSequence(doc, out.seq, [], { linkage, liftedClipIds: [seq.clips[idx]!.id] });
      } else if (op === 7 && allOverlayClips(seq).length > 0) {
        // Move overlay clip horizontally or vertically
        const ovs = allOverlayClips(seq);
        const pick = ovs[Math.floor(rand() * ovs.length)]!;
        const start = Math.floor(rand() * Math.max(1, totalFrames(seq) + 40));
        const out = moveOverlayClip(seq, pick.id, { kind: 'overlay-row', trackIndex: 0 }, start);
        if (out.ok) doc = withSequence(doc, out.seq, [], { linkage });
      } else if (op === 8 && allOverlayClips(seq).length > 0) {
        // Trim overlay edge
        const ovs = allOverlayClips(seq);
        const pick = ovs[Math.floor(rand() * ovs.length)]!;
        const edge = rand() < 0.5 ? 'start' : 'end';
        const delta = Math.floor(rand() * 21) - 10;
        doc = withSequence(doc, trimOverlayEdge(seq, pick.id, edge, delta).seq, [], { linkage });
      } else if (op === 9 && allOverlayClips(seq).length > 0 && seq.clips.length < 12) {
        // Drop overlay back to main
        const ovs = allOverlayClips(seq);
        const pick = ovs[Math.floor(rand() * ovs.length)]!;
        const out = dropOverlayToMain(seq, pick.id, Math.floor(rand() * (seq.clips.length + 1)));
        if (out.ok) doc = withSequence(doc, out.seq, [], { linkage });
      } else if (op === 10 && allOverlayClips(seq).length > 0) {
        // Delete an overlay clip
        const ovs = allOverlayClips(seq);
        const pick = ovs[Math.floor(rand() * ovs.length)]!;
        doc = withSequence(doc, removeOverlayClips(seq, [pick.id]), [], { linkage });
      }

      expect(wholeFrameViolations(doc.sequence), `step ${step} op ${op}`).toEqual([]);
      expect(overlayTracksOf(doc.sequence).length).toBeLessThanOrEqual(MAX_OVERLAY_TRACKS);
    }
  });

  it('undo identity holds for every track command (lift, move up/down, move, trim, split, splitAll, speed, audio, remove, drop)', () => {
    const base = makeSeq([makeClip('A', 72), makeClip('B', 72), makeClip('C', 72)]);
    const checkUndo = (doc: EditorDoc, next: EditorDoc) => {
      const history = commit({ past: [], future: [] }, doc);
      const undone = undo(history, next);
      expect(undone?.doc).toEqual(doc);
    };

    const d0 = realDoc(base);
    // Lift B up
    const d1 = withSequence(d0, moveClipUpOneTrack(d0.sequence, 'B').seq, [], { liftedClipIds: ['B'] });
    checkUndo(d0, d1);
    // Move B horizontally
    const d2 = withSequence(d1, moveOverlayClip(d1.sequence, 'B', { kind: 'overlay-row', trackIndex: 0 }, 24).seq);
    checkUndo(d1, d2);
    // Trim B end
    const d3 = withSequence(d2, trimOverlayEdge(d2.sequence, 'B', 'end', -12).seq);
    checkUndo(d2, d3);
    // Split B
    const sp = splitOverlayAtFrame(d3.sequence, 'B', 48, 'B-r');
    const d4 = withSequence(d3, sp.seq, sp.inherit);
    checkUndo(d3, d4);
    // Split all
    let c = 0;
    const spa = splitAllTracksAtFrame(d4.sequence, 36, () => `sa-${++c}`);
    const d5 = withSequence(d4, spa.seq, spa.inherit);
    checkUndo(d4, d5);
    // Speed + audio on overlay
    const d6 = withSequence(d5, setOverlayConstantSpeed(d5.sequence, 'B', 2));
    checkUndo(d5, d6);
    const d7 = withSequence(d6, setOverlayAudio(d6.sequence, 'B', 0.4, false));
    checkUndo(d6, d7);
    // Delete main cut A with linked overlays -> 1 undo restores main + overlays
    const d8 = withSequence(d7, removeClips(d7.sequence, ['A']), [], { linkage: true });
    checkUndo(d7, d8);
    // Move B-r down onto main
    const d9 = withSequence(d7, moveClipDownOneTrack(d7.sequence, 'B-r').seq);
    checkUndo(d7, d9);
  });

  it('B2: withSequence default fallback is linkage=false; default settings paste/duplicate keep overlays at absolute time', () => {
    const base = makeSeq([makeClip('A', 48), makeClip('B', 72)]);
    const ovB = makeOverlay('ovB', 60, 30, base); // 12f into B
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    const doc = realDoc(seq);

    // Omitting options defaults to linkage=false (observed default: switch ON, overlay kind OFF).
    const afterPasteDefault = withSequence(doc, insertClips(seq, 0, [makeClip('Pasted', 36)])).sequence;
    expect(findOverlayClip(afterPasteDefault, 'ovB')?.clip.startFrame).toBe(60);

    // Explicit linkage=false (default settings) on paste & duplicate keeps absolute start 60.
    const afterDupDefault = withSequence(doc, insertClips(seq, 1, [makeClip('DupA', 48)]), [], { linkage: false }).sequence;
    expect(findOverlayClip(afterDupDefault, 'ovB')?.clip.startFrame).toBe(60);

    // Explicit linkage=true moves ovB forward by the inserted cut's length (60 + 36 = 96).
    const afterPasteLinked = withSequence(doc, insertClips(seq, 0, [makeClip('Pasted', 36)]), [], { linkage: true }).sequence;
    expect(findOverlayClip(afterPasteLinked, 'ovB')?.clip.startFrame).toBe(96);
  });

  it('B2 + SMALL property test: asserts exact FINAL POSITIONS across multi-track overlays, default-settings, paste, duplicate, move, trim, and delete', () => {
    const rand = seededPrng(20261129);
    let idN = 0;
    const base = makeSeq([makeClip('m1', 60), makeClip('m2', 60), makeClip('m3', 60)]);
    const ov2 = makeOverlay('ov2', 70, 24, base); // +10 into m2 (track 0)
    const ov3 = makeOverlay('ov3', 135, 24, base); // +15 into m3 (track 0)
    const ov2Top = makeOverlay('ov2Top', 80, 20, base); // +20 into m2 (track 1)
    let doc = realDoc(
      makeSeq(base.clips, 24, [
        { id: 'ov-1', clips: [ov2, ov3] },
        { id: 'ov-2', clips: [ov2Top] },
      ]),
    );
    expect(overlayTracksOf(doc.sequence)).toHaveLength(2);

    for (let step = 0; step < 80; step += 1) {
      const seq = doc.sequence;
      const beforeStarts = new Map(allOverlayClips(seq).map((c) => [c.id, { start: c.startFrame, link: c.link }]));
      const beforeMainStarts = new Map(spansOf(seq).map((s) => [s.clip.id, s.start]));
      const linkage = step % 3 === 0 ? false : rand() > 0.5;
      const op = step % 5;

      if (op === 0 && seq.clips.length < 10) {
        // Paste cut at index 0
        const copy = makeClip(`paste-${++idN}`, 24);
        doc = withSequence(doc, insertClips(seq, 0, [copy]), [], { linkage });
      } else if (op === 1 && seq.clips.length < 10) {
        // Duplicate first cut right after it
        const dup = { ...seq.clips[0]!, id: `dup-${++idN}` };
        doc = withSequence(doc, insertClips(seq, 1, [dup]), [], { linkage });
      } else if (op === 2 && seq.clips.length >= 2) {
        // Reorder last cut to front
        doc = withSequence(doc, moveClip(seq, seq.clips.length - 1, 0), [], { linkage });
      } else if (op === 3) {
        // Trim first cut end
        const delta = seq.clips[0]!.frames > 36 ? -12 : 12;
        doc = withSequence(doc, trimClipEdge(seq, 0, 'end', delta).seq, [], { linkage });
      } else if (op === 4 && seq.clips.length > 3) {
        // Delete a cut that is not currently linked by any overlay so both overlay tracks remain active across all 80 steps.
        const linkedIds = new Set(allOverlayClips(seq).map((ov) => ov.link?.clipId).filter((id): id is string => Boolean(id)));
        const removable = seq.clips.find((c) => !linkedIds.has(c.id));
        if (removable) {
          doc = withSequence(doc, removeClips(seq, [removable.id]), [], { linkage });
        }
      }

      const afterMainStarts = new Map(spansOf(doc.sequence).map((s) => [s.clip.id, s.start]));
      // Assert linked overlay final positions across ALL track counts (multi-track included!).
      expect(overlayTracksOf(doc.sequence).length).toBeGreaterThanOrEqual(2);
      for (const ov of allOverlayClips(doc.sequence)) {
        const prev = beforeStarts.get(ov.id);
        if (!prev) continue;
        if (!linkage) {
          // Default settings / linkage OFF: overlay MUST stay at its exact prior absolute start frame.
          expect(ov.startFrame, `step ${step} unlinked ${ov.id}`).toBe(prev.start);
        } else if (prev.link && beforeMainStarts.has(prev.link.clipId) && afterMainStarts.has(prev.link.clipId)) {
          const delta = afterMainStarts.get(prev.link.clipId)! - beforeMainStarts.get(prev.link.clipId)!;
          expect(ov.startFrame, `step ${step} linked ${ov.id}`).toBe(Math.max(0, prev.start + delta));
        }
      }
      expect(wholeFrameViolations(doc.sequence), `step ${step}`).toEqual([]);
    }
  });

  it('S2: deleting a linked parent across multi-track deletes linked overlays whole, shifts later overlays by exact delta, and prunes empty tracks', () => {
    const base = makeSeq([makeClip('m1', 60), makeClip('m2', 60), makeClip('m3', 60)]);
    const ov1 = makeOverlay('ov1', 15, 20, base); // linked to m1 (track 0)
    const ov2a = makeOverlay('ov2a', 70, 24, base); // linked to m2 (track 0)
    const ov2b = makeOverlay('ov2b', 80, 90, base); // linked to m2 (track 1 — reaches past m2 into m3!)
    const ov3 = makeOverlay('ov3', 140, 24, base); // linked to m3 (track 0)
    const seq = makeSeq(base.clips, 24, [
      { id: 'ov-1', clips: [ov1, ov2a, ov3] },
      { id: 'ov-2', clips: [ov2b] },
    ]);

    // Linkage ON: deleting m2 removes BOTH ov2a (track 0) and ov2b (track 1, whole even though it extended into m3),
    // prunes empty track 1 immediately (P6), keeps ov1 at 15, and shifts ov3 left by -60 (140 -> 80)!
    const linked = withSequence(realDoc(seq), removeClips(seq, ['m2']), [], { linkage: true }).sequence;
    expect(overlayTracksOf(linked)).toHaveLength(1);
    expect(allOverlayClips(linked).map((c) => [c.id, c.startFrame])).toEqual([
      ['ov1', 15],
      ['ov3', 80],
    ]);
    expect(wholeFrameViolations(linked)).toEqual([]);

    // Linkage OFF: deleting m2 deletes NO overlays and keeps every overlay at its exact prior startFrame!
    const unlinked = withSequence(realDoc(seq), removeClips(seq, ['m2']), [], { linkage: false }).sequence;
    expect(overlayTracksOf(unlinked)).toHaveLength(2);
    expect(allOverlayClips(unlinked).map((c) => [c.id, c.startFrame])).toEqual([
      ['ov1', 15],
      ['ov2a', 70],
      ['ov3', 140],
      ['ov2b', 80],
    ]);
    expect(wholeFrameViolations(unlinked)).toEqual([]);
  });

  it('S4: main-cut drag slightly below mainRow.bottom stays a horizontal reorder, while overlay drops below main are refused', () => {
    const seq = makeSeq([makeClip('m1', 60), makeClip('m2', 60)], 24, [
      { id: 'ov-1', clips: [makeOverlay('o1', 10, 30, makeSeq([makeClip('m1', 60), makeClip('m2', 60)]))] },
    ]);
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 0, top: 40, bottom: 94 },
      { kind: 'main', top: 98, bottom: 162 },
    ];
    const mainRow = { top: 98, bottom: 162 };

    // Main cut drifting 8px below mainRow.bottom (inside 16px tolerance) -> stays horizontal reorder!
    expect(
      computeDropTarget({
        sequence: seq,
        source: { kind: 'main', index: 0 },
        clientY: mainRow.bottom + 8,
        dropFrame: 80,
        pointerFrame: 80,
        rows,
        mainRow,
      }),
    ).toEqual({ kind: 'main-track', insertIndex: 1, isReorder: true });

    // Main cut dragged past 16px below mainRow.bottom -> refused.
    expect(
      computeDropTarget({
        sequence: seq,
        source: { kind: 'main', index: 0 },
        clientY: mainRow.bottom + 24,
        dropFrame: 80,
        pointerFrame: 80,
        rows,
        mainRow,
      }),
    ).toEqual({ kind: 'refused', reason: 'below_main' });

    // Overlay dragged even 4px below mainRow.bottom -> refused.
    expect(
      computeDropTarget({
        sequence: seq,
        source: { kind: 'overlay', clipId: 'o1', trackIndex: 0 },
        clientY: mainRow.bottom + 4,
        dropFrame: 80,
        pointerFrame: 80,
        rows,
        mainRow,
      }),
    ).toEqual({ kind: 'refused', reason: 'below_main' });
  });

  it('S1: lifting a main cut checks free space against post-close adjusted overlay positions without double-shifting', () => {
    // A (48f) + B (72f). ovB starts at frame 72 (24f into B, length 24f -> 72..96).
    // Lift A (index 0) onto track 0 at dropFrame 60 with linkage ON:
    // Before closing gap, track 0 had ovB at 72..96 (which overlapped 60..108).
    // After closing A's 48f gap with linkage ON, ovB shifts left to 24..48 -> 60..108 is FREE on track 0!
    const base = makeSeq([makeClip('A', 48), makeClip('B', 72)]);
    const ovB = makeOverlay('ovB', 72, 24, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovB] }]);
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 0, top: 40, bottom: 94 },
      { kind: 'main', top: 98, bottom: 162 },
    ];
    const target = computeDropTarget({
      sequence: seq,
      source: { kind: 'main', index: 0 },
      clientY: 65,
      dropFrame: 60,
      linkage: true,
      rows,
      mainRow: { top: 98, bottom: 162 },
    });
    expect(target).toEqual({ kind: 'overlay-row', trackIndex: 0, startFrame: 60 });

    const lifted = liftMainCutToOverlay(seq, 0, { kind: 'overlay-row', trackIndex: 0 }, 60, { linkage: true });
    expect(lifted.ok).toBe(true);
    const committed = withSequence(realDoc(seq), lifted.seq, [], { linkage: true, liftedClipIds: ['A'] }).sequence;
    // Track 0 holds BOTH ovB at 24 (shifted ONCE: 72 - 48 = 24) and lifted A at 60!
    expect(overlayTracksOf(committed)).toHaveLength(1);
    expect(findOverlayClip(committed, 'ovB')?.clip.startFrame).toBe(24);
    expect(findOverlayClip(committed, 'A')?.clip.startFrame).toBe(60);
    expect(wholeFrameViolations(committed)).toEqual([]);
  });

  it('SMALL: split link reassignment relies strictly on inherit pairs (never guesses from -b id suffix)', () => {
    const base = makeSeq([makeClip('cut1', 100), makeClip('cut2', 60)]);
    const ovRight = makeOverlay('ovR', 70, 20, base);
    const seq = makeSeq(base.clips, 24, [{ id: 'ov-1', clips: [ovRight] }]);
    // Split cut1 into cut1 + cut1-b WITHOUT passing inherit -> should NOT guess cut1-b from suffix!
    const splitSeq = splitAtFrame(seq, 50, 'cut1-b');
    const withoutInherit = withSequence(realDoc(seq), splitSeq, [], { linkage: true }).sequence;
    // Without inherit, cut1's right trim dropped sourceFrame 70 -> P3 keeps absolute start 70 and re-links to cut1-b at offset 20.
    // With inherit, P4 explicitly recognizes cut1-b as split child of cut1.
    const withInherit = withSequence(realDoc(seq), splitSeq, [['cut1-b', 'cut1']], { linkage: true }).sequence;
    expect(findOverlayClip(withInherit, 'ovR')?.clip.link).toEqual({ clipId: 'cut1-b', sourceFrame: 70 });
    expect(findOverlayClip(withoutInherit, 'ovR')?.clip.startFrame).toBe(70);
  });

  it('W9: overlay split uses the exact same playhead -> frame rule as main cut split across playheads and speeds', () => {
    for (const playhead of [100, 209, 210, 399, 400]) {
      for (const [speedNum, speedDen] of [
        [1, 1],
        [3, 2],
        [1, 2],
      ] as const) {
        const mainClip = makeClip('M', 480, { sourceFrames: 1200, speedNum, speedDen });
        const ovClip: OverlayClip = {
          ...makeClip('O', 480, { sourceFrames: 1200, speedNum, speedDen }),
          startFrame: 0,
          link: { clipId: 'M', sourceFrame: 0 },
        };
        const seq = makeSeq([mainClip], 24, [{ id: 'ov-1', clips: [ovClip] }]);

        const mainSplit = splitAtFrame(seq, playhead, 'M-r');
        const ovSplit = splitOverlayAtFrame(seq, 'O', playhead, 'O-r');
        expect(ovSplit.ok, `playhead=${playhead}`).toBe(true);

        const [mLeft, mRight] = mainSplit.clips;
        const [oLeft, oRight] = overlayTracksOf(ovSplit.seq)[0]!.clips;
        expect(oLeft!.frames).toBe(mLeft!.frames);
        expect(oRight!.frames).toBe(mRight!.frames);
        expect(oRight!.startFrame).toBe(spansOf(mainSplit)[1]!.start);
        expect(oRight!.startFrame).toBe(playhead);
        expect(oRight!.inFrame).toBe(mRight!.inFrame);
        expect(oRight!.phase).toBe(mRight!.phase);
      }
    }
  });

  it('W10: canMoveClipUpOneTrack reflects exact enabled conditions (main cuts, track above, sibling + room under cap, and cap 3)', () => {
    const oneMain = makeSeq([makeClip('A', 72)]);
    expect(canMoveClipUpOneTrack(oneMain, 'A')).toBe(false);

    const twoMain = makeSeq([makeClip('A', 72), makeClip('B', 72)]);
    expect(canMoveClipUpOneTrack(twoMain, 'B')).toBe(true);
    expect(canMoveClipUpOneTrack(twoMain, 'B', { maxOwnedOverlays: 0 })).toBe(false);

    // Lone clip on top track (track 0 of 1): disabled (creating a new track would prune empty track 0).
    const loneTop = makeSeq([makeClip('A', 120)], 24, [
      { id: 'ov-1', clips: [makeOverlay('o1', 0, 40, makeSeq([makeClip('A', 120)]))] },
    ]);
    expect(canMoveClipUpOneTrack(loneTop, 'o1')).toBe(false);

    // Two clips on track 0 (under cap 3): enabled -> creates track 1 above!
    const twoOnRow = makeSeq([makeClip('A', 120)], 24, [
      {
        id: 'ov-1',
        clips: [
          makeOverlay('o1', 0, 40, makeSeq([makeClip('A', 120)])),
          makeOverlay('o2', 50, 40, makeSeq([makeClip('A', 120)])),
        ],
      },
    ]);
    expect(canMoveClipUpOneTrack(twoOnRow, 'o1')).toBe(true);
    const movedUp = moveClipUpOneTrack(twoOnRow, 'o1');
    expect(movedUp.ok).toBe(true);
    expect(overlayTracksOf(movedUp.seq)).toHaveLength(2);
    expect(findOverlayClip(movedUp.seq, 'o1')?.trackIndex).toBe(1);

    // Clip on track 0 when track 1 exists above: enabled!
    expect(canMoveClipUpOneTrack(movedUp.seq, 'o2')).toBe(true);
    // Lone clip on track 1 (now top): disabled!
    expect(canMoveClipUpOneTrack(movedUp.seq, 'o1')).toBe(false);

    // At cap 3 with two clips on top track: disabled!
    const atCap = makeSeq([makeClip('A', 120)], 24, [
      { id: 'ov-1', clips: [makeOverlay('o1', 0, 30, oneMain)] },
      { id: 'ov-2', clips: [makeOverlay('o2', 0, 30, oneMain)] },
      { id: 'ov-3', clips: [makeOverlay('o3', 0, 30, oneMain), makeOverlay('o4', 40, 30, oneMain)] },
    ]);
    expect(canMoveClipUpOneTrack(atCap, 'o3')).toBe(false);
  });
});
