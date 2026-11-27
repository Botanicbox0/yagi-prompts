import { describe, expect, it } from 'vitest';
import { parseAssistClientBody } from '@/components/brand-studio/editor-v2/assist-client';
import {
  applyResolvedStepsToSequence,
  applyRulePatchesToSequence,
  secToFrames,
} from '@/lib/brand-studio/editor-v2/assist-apply';
import {
  diffFrameSequences,
  formatAskChoices,
  formatAskQuestion,
  formatFrameLength,
  mapFailureNoteText,
} from '@/lib/brand-studio/editor-v2/assist-diff';
import { buildPlannerProject } from '@/lib/brand-studio/editor-v2/assist-project';
import {
  applyClipSpeedCurve,
  formatTimecode,
  removeClips,
  setAspect,
  setClipConstantSpeed,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  wholeFrameViolations,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import {
  applyTimelinePatches,
  emptyComposerProject,
  type ComposeClip,
  type TimelinePatch,
} from '@/lib/brand-studio/compose/timeline';
import { fromStored, inheritClip, lineageOf, toStored } from '@/lib/brand-studio/editor-v2/stored';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatKo } from '@/messages/studio-editor-chat';

function makeClip(overrides: Partial<FrameClip> & { id: string; frames: number; fps?: number }): FrameClip {
  const fps = overrides.fps ?? 30;
  return {
    id: overrides.id,
    label: overrides.label ?? `${overrides.id}.mp4`,
    srcUrl: overrides.srcUrl ?? `/media/${overrides.id}.mp4`,
    thumbUrl: overrides.thumbUrl ?? null,
    sourceFps: overrides.sourceFps ?? fps,
    sourceFrames: overrides.sourceFrames ?? Math.max(overrides.frames * 3, 600),
    inFrame: overrides.inFrame ?? 0,
    frames: overrides.frames,
    speedNum: overrides.speedNum ?? 1,
    speedDen: overrides.speedDen ?? 1,
    phase: overrides.phase ?? 0,
    volume: overrides.volume ?? 1,
    muted: overrides.muted ?? false,
    ...(overrides.speedCurve ? { speedCurve: overrides.speedCurve } : {}),
  };
}

function makeSequence(fps = 30): FrameSequence {
  return {
    fps,
    aspect: '16:9',
    clips: [
      makeClip({ id: 'c1', frames: Math.round(4 * fps), fps }),
      makeClip({ id: 'c2', frames: Math.round(6 * fps), fps }),
      makeClip({ id: 'c3', frames: Math.round(5 * fps), fps }),
    ],
    captions: [],
  };
}

function frameViolationsFor(seq: FrameSequence): string[] {
  return wholeFrameViolations(seq).filter((v) => Number.isInteger(seq.fps) || !v.startsWith('fps '));
}

describe('editor-v2 assist-apply & assist-diff (Batch 2)', () => {
  it('maps every supported ResolvedStep cleanly in integer frames across 30, 24, 24000/1001, and 30000/1001 fps', () => {
    for (const fps of [30, 24, 24000 / 1001, 30000 / 1001]) {
      const seq = makeSequence(fps);

      // trim: start / end / middle / range
      const trimStart = applyResolvedStepsToSequence(seq, [{ do: 'trim', clip: { clipId: 'c2' }, keep: 'start', seconds: 2 }]);
      expect(trimStart.ok).toBe(true);
      if (trimStart.ok) {
        expect(trimStart.sequence.clips[1]!.frames).toBe(secToFrames(2, fps));
        expect(frameViolationsFor(trimStart.sequence)).toEqual([]);
        expect(diffFrameSequences(seq, trimStart.sequence, studioEditorKo, studioEditorChatKo)[0]).toContain('2번 컷 길이');
      }

      const trimEnd = applyResolvedStepsToSequence(seq, [{ do: 'trim', clip: { clipId: 'c2' }, keep: 'end', seconds: 3 }]);
      expect(trimEnd.ok).toBe(true);
      if (trimEnd.ok) {
        expect(trimEnd.sequence.clips[1]!.frames).toBe(secToFrames(3, fps));
        expect(trimEnd.sequence.clips[1]!.inFrame).toBeGreaterThan(0);
        expect(frameViolationsFor(trimEnd.sequence)).toEqual([]);
      }

      const trimMid = applyResolvedStepsToSequence(seq, [{ do: 'trim', clip: { clipId: 'c2' }, keep: 'middle', seconds: 2 }]);
      expect(trimMid.ok).toBe(true);
      if (trimMid.ok) {
        expect(trimMid.sequence.clips[1]!.frames).toBe(secToFrames(2, fps));
        expect(frameViolationsFor(trimMid.sequence)).toEqual([]);
      }

      const trimRange = applyResolvedStepsToSequence(seq, [{ do: 'trim', clip: { clipId: 'c2' }, keep: 'range', from: 1, to: 4 }]);
      expect(trimRange.ok).toBe(true);
      if (trimRange.ok) {
        expect(trimRange.sequence.clips[1]!.frames).toBe(secToFrames(3, fps));
        expect(frameViolationsFor(trimRange.sequence)).toEqual([]);
      }

      // split + follow-up `{ splitOf, part }` targeting second piece (`${id.slice(0, 60)}-b`)
      const splitAndRemoveB = applyResolvedStepsToSequence(seq, [
        { do: 'split', clip: { clipId: 'c2' }, at: 2 },
        { do: 'remove', clip: { splitOf: 'c2', part: 'b' } },
      ]);
      expect(splitAndRemoveB.ok).toBe(true);
      if (splitAndRemoveB.ok) {
        expect(splitAndRemoveB.sequence.clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
        expect(splitAndRemoveB.sequence.clips[1]!.frames).toBe(secToFrames(2, fps));
        expect(frameViolationsFor(splitAndRemoveB.sequence)).toEqual([]);
      }

      // split alone creates `${id.slice(0,60)}-b`
      const splitOnly = applyResolvedStepsToSequence(seq, [{ do: 'split', clip: { clipId: 'c1' }, at: 1.5 }]);
      expect(splitOnly.ok).toBe(true);
      if (splitOnly.ok) {
        expect(splitOnly.sequence.clips.map((c) => c.id)).toEqual(['c1', 'c1-b', 'c2', 'c3']);
        expect(splitOnly.sequence.clips[0]!.frames + splitOnly.sequence.clips[1]!.frames).toBe(seq.clips[0]!.frames);
        expect(frameViolationsFor(splitOnly.sequence)).toEqual([]);
        expect(diffFrameSequences(seq, splitOnly.sequence, studioEditorKo, studioEditorChatKo)[0]).toContain('1번 컷을');
      }

      // remove
      const removed = applyResolvedStepsToSequence(seq, [{ do: 'remove', clip: { clipId: 'c3' } }]);
      expect(removed.ok).toBe(true);
      if (removed.ok) {
        expect(removed.sequence.clips.map((c) => c.id)).toEqual(['c1', 'c2']);
        expect(diffFrameSequences(seq, removed.sequence, studioEditorKo, studioEditorChatKo)).toEqual(['3번 컷 삭제']);
      }

      // move: first / last / before / after
      const moveFirst = applyResolvedStepsToSequence(seq, [{ do: 'move', clip: { clipId: 'c3' }, to: 'first' }]);
      expect(moveFirst.ok).toBe(true);
      if (moveFirst.ok) expect(moveFirst.sequence.clips.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);

      const moveLast = applyResolvedStepsToSequence(seq, [{ do: 'move', clip: { clipId: 'c1' }, to: 'last' }]);
      expect(moveLast.ok).toBe(true);
      if (moveLast.ok) expect(moveLast.sequence.clips.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);

      const moveBefore = applyResolvedStepsToSequence(seq, [{ do: 'move', clip: { clipId: 'c3' }, to: { before: { clipId: 'c2' } } }]);
      expect(moveBefore.ok).toBe(true);
      if (moveBefore.ok) expect(moveBefore.sequence.clips.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);

      const moveAfter = applyResolvedStepsToSequence(seq, [{ do: 'move', clip: { clipId: 'c1' }, to: { after: { clipId: 'c2' } } }]);
      expect(moveAfter.ok).toBe(true);
      if (moveAfter.ok) expect(moveAfter.sequence.clips.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);

      // sound: clip mute, unmute from 0 (restores 0.5), all_clips volume
      const mutedOne = applyResolvedStepsToSequence(seq, [{ do: 'sound', target: { clipId: 'c1' }, muted: true }]);
      expect(mutedOne.ok).toBe(true);
      if (mutedOne.ok) {
        expect(mutedOne.sequence.clips[0]!.muted).toBe(true);
        expect(diffFrameSequences(seq, mutedOne.sequence, studioEditorKo, studioEditorChatKo)).toEqual(['1번 컷 소리 끄기']);
      }

      const zeroMuted: FrameSequence = {
        ...seq,
        clips: seq.clips.map((c, i) => (i === 0 ? { ...c, volume: 0, muted: true } : c)),
      };
      const unmuted = applyResolvedStepsToSequence(zeroMuted, [{ do: 'sound', target: { clipId: 'c1' }, muted: false }]);
      expect(unmuted.ok).toBe(true);
      if (unmuted.ok) {
        expect(unmuted.sequence.clips[0]!.muted).toBe(false);
        expect(unmuted.sequence.clips[0]!.volume).toBe(0.5);
      }

      const allHalf = applyResolvedStepsToSequence(seq, [{ do: 'sound', target: 'all_clips', volume: 0.5 }]);
      expect(allHalf.ok).toBe(true);
      if (allHalf.ok) {
        expect(allHalf.sequence.clips.every((c) => c.volume === 0.5 && !c.muted)).toBe(true);
        expect(diffFrameSequences(seq, allHalf.sequence, studioEditorKo, studioEditorChatKo)).toEqual(['모든 컷 소리 50%']);
      }

      // aspect
      const aspect = applyResolvedStepsToSequence(seq, [{ do: 'aspect', aspect: '9:16' }]);
      expect(aspect.ok).toBe(true);
      if (aspect.ok) expect(aspect.sequence.aspect).toBe('9:16');

      // fit_total with protect
      const fitProtected = applyResolvedStepsToSequence(seq, [
        { do: 'fit_total', seconds: 9, protect: [{ clipId: 'c1' }] },
      ]);
      expect(fitProtected.ok).toBe(true);
      if (fitProtected.ok) {
        expect(fitProtected.sequence.clips[0]!.frames).toBe(seq.clips[0]!.frames);
        expect(totalFrames(fitProtected.sequence)).toBe(secToFrames(9, fps));
        expect(frameViolationsFor(fitProtected.sequence)).toEqual([]);
        const lines = diffFrameSequences(seq, fitProtected.sequence, studioEditorKo, studioEditorChatKo);
        expect(lines.some((l) => l.startsWith('전체 길이'))).toBe(true);
      }

      // even_pace
      const even = applyResolvedStepsToSequence(seq, [{ do: 'even_pace', secondsPerClip: 3 }]);
      expect(even.ok).toBe(true);
      if (even.ok) {
        expect(even.sequence.clips.every((c) => c.frames === secToFrames(3, fps))).toBe(true);
        expect(frameViolationsFor(even.sequence)).toEqual([]);
      }
    }
  });

  it('handles speed-changed cuts and speedCurve cuts cleanly and words proposal lines from the actual diff', () => {
    const base = makeSequence(30);
    // Constant 2x speed cut
    const fastSeq = setClipConstantSpeed(base, 1, 2);
    const beforeFastFrames = fastSeq.clips[1]!.frames; // 3s = 90f
    const trimFast = applyResolvedStepsToSequence(fastSeq, [
      { do: 'trim', clip: { clipId: 'c2' }, keep: 'start', seconds: 1.5 },
    ]);
    expect(trimFast.ok).toBe(true);
    if (trimFast.ok) {
      expect(trimFast.sequence.clips[1]!.frames).toBe(45);
      expect(trimFast.sequence.clips[1]!.frames).toBeLessThan(beforeFastFrames);
      expect(wholeFrameViolations(trimFast.sequence)).toEqual([]);
    }

    // Speed-curved cut via applyClipSpeedCurve
    const curvedResult = applyClipSpeedCurve(base, 1, [
      { pos: 0, speed: 0.5 },
      { pos: 0.5, speed: 2 },
      { pos: 1, speed: 1 },
    ]);
    expect(curvedResult.refused).toBeNull();
    const curvedSeq = curvedResult.seq;
    const beforeFrames = curvedSeq.clips[1]!.frames;
    const targetSec = (beforeFrames / 30) * 0.6;
    const trimCurved = applyResolvedStepsToSequence(curvedSeq, [
      { do: 'trim', clip: { clipId: 'c2' }, keep: 'start', seconds: targetSec },
    ]);
    expect(trimCurved.ok).toBe(true);
    if (trimCurved.ok) {
      expect(trimCurved.sequence.clips[1]!.frames).toBeLessThan(beforeFrames);
      expect(wholeFrameViolations(trimCurved.sequence)).toEqual([]);
      const diffLines = diffFrameSequences(curvedSeq, trimCurved.sequence, studioEditorKo, studioEditorChatKo);
      expect(diffLines).toHaveLength(1);
      expect(diffLines[0]).toContain(formatFrameLength(trimCurved.sequence.clips[1]!.frames, 30));
    }

    // SMALL #3: curved cut range trim (`from` + `to`) recomputes end edit after start trim
    const curvedForRange = applyClipSpeedCurve(base, 1, [
      { pos: 0, speed: 0.5 },
      { pos: 0.5, speed: 2 },
      { pos: 1, speed: 1 },
    ]).seq;
    const rangeRes = applyResolvedStepsToSequence(curvedForRange, [
      { do: 'trim', clip: { clipId: 'c2' }, keep: 'range', from: 1, to: 3 },
    ]);
    expect(rangeRes.ok).toBe(true);
    if (rangeRes.ok) {
      expect(wholeFrameViolations(rangeRes.sequence)).toEqual([]);
      expect(rangeRes.sequence.clips[1]!.frames).toBeLessThan(curvedForRange.clips[1]!.frames);
    }

    // SMALL #4: fit_total second pass redistributes leftover carry to earlier cuts when a later curved cut cannot drop further
    const curvedTail = applyClipSpeedCurve(makeSequence(30), 2, [
      { pos: 0, speed: 4 },
      { pos: 0.5, speed: 0.25 },
      { pos: 1, speed: 4 },
    ]).seq;
    const beforeTot = totalFrames(curvedTail);
    const fitTargetSec = Math.max(4, Math.floor((beforeTot / 30) - 3));
    const fitCurved = applyResolvedStepsToSequence(curvedTail, [{ do: 'fit_total', seconds: fitTargetSec }]);
    expect(fitCurved.ok).toBe(true);
    if (fitCurved.ok) {
      expect(wholeFrameViolations(fitCurved.sequence)).toEqual([]);
      expect(totalFrames(fitCurved.sequence)).toBeLessThan(beforeTot);
    }
  });

  it('refuses unsupported V1 workspace steps and invalid plans atomically (zero partial apply)', () => {
    const seq = makeSequence(30);

    // Valid step + unsupported step in the SAME plan -> ENTIRE plan refused, original sequence returned
    const withColor = applyResolvedStepsToSequence(seq, [
      { do: 'aspect', aspect: '9:16' },
      { do: 'look', preset: 'kodak-2383-warm' },
    ]);
    expect(withColor).toEqual({ ok: false, reason: 'unsupported_color', sequence: seq });

    const withMusic = applyResolvedStepsToSequence(seq, [
      { do: 'aspect', aspect: '9:16' },
      { do: 'sound', target: 'music', muted: true },
    ]);
    expect(withMusic).toEqual({ ok: false, reason: 'unsupported_music', sequence: seq });

    const withCaption = applyResolvedStepsToSequence(seq, [
      { do: 'aspect', aspect: '9:16' },
      { do: 'caption_add', text: '안녕', where: 'start' },
    ]);
    expect(withCaption).toEqual({ ok: false, reason: 'unsupported_captions', sequence: seq });

    // Missing target cut
    const missing = applyResolvedStepsToSequence(seq, [{ do: 'remove', clip: { clipId: 'does-not-exist' } }]);
    expect(missing).toEqual({ ok: false, reason: 'target_missing', sequence: seq });

    // Single-cut remove refused
    const single: FrameSequence = { ...seq, clips: [seq.clips[0]!] };
    expect(applyResolvedStepsToSequence(single, [{ do: 'remove', clip: { clipId: 'c1' } }])).toEqual({
      ok: false,
      reason: 'not_possible',
      sequence: single,
    });

    // No-op plan refused as no_change
    expect(applyResolvedStepsToSequence(seq, [{ do: 'aspect', aspect: '16:9' }])).toEqual({
      ok: false,
      reason: 'no_change',
      sequence: seq,
    });
  });

  it('maps rule-path TimelinePatch[] only when baseSequence matches, and refuses split_clip_cuts & unsupported workspaces', () => {
    const seq = makeSequence(30);
    const otherSeq = setAspect(seq, '9:16');

    // Stale base -> refused immediately
    expect(applyRulePatchesToSequence(otherSeq, [{ op: 'trim_clip', clipIndex: 0, targetDurationSec: 2 }], seq)).toEqual({
      ok: false,
      reason: 'stale',
      sequence: otherSeq,
    });

    // Matching base -> exact frame edit
    const okPatch = applyRulePatchesToSequence(
      seq,
      [
        { op: 'set_aspect', aspect: '9:16' },
        { op: 'trim_clip', clipIndex: 1, targetDurationSec: 2 },
        { op: 'swap_clips', indexA: 0, indexB: 2 },
      ],
      seq,
    );
    expect(okPatch.ok).toBe(true);
    if (okPatch.ok) {
      expect(okPatch.sequence.aspect).toBe('9:16');
      expect(okPatch.sequence.clips.map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
      expect(okPatch.sequence.clips[1]!.frames).toBe(60);
      expect(wholeFrameViolations(okPatch.sequence)).toEqual([]);
    }

    // Scene split refused honestly
    expect(applyRulePatchesToSequence(seq, [{ op: 'split_clip_cuts', clipIndex: 0, cutMediaSecs: [1.5] }], seq)).toEqual({
      ok: false,
      reason: 'unsupported_scene_split',
      sequence: seq,
    });

    // Color / BGM / Captions refused atomically
    expect(applyRulePatchesToSequence(seq, [{ op: 'set_color_grade', enabled: true, presetId: 'kodak-2383-warm' }], seq)).toEqual({
      ok: false,
      reason: 'unsupported_color',
      sequence: seq,
    });
    expect(applyRulePatchesToSequence(seq, [{ op: 'remove_bgm' }], seq)).toEqual({
      ok: false,
      reason: 'unsupported_music',
      sequence: seq,
    });
    expect(
      applyRulePatchesToSequence(seq, [{ op: 'add_caption', text: 'hello', startSec: 0, endSec: 2, position: 'bottom' }], seq),
    ).toEqual({
      ok: false,
      reason: 'unsupported_captions',
      sequence: seq,
    });
  });

  it('produces the exact same stored ComposerProject as doing the edit by hand and undoing', () => {
    const storedBase = {
      ...emptyComposerProject('16:9'),
      clips: [
        {
          id: 'c1',
          sourceKind: 'asset',
          assetId: 'a1',
          label: 'c1.mp4',
          srcUrl: '/media/c1.mp4',
          thumbUrl: null,
          durationSec: 4,
          trimStartSec: 0,
          trimEndSec: 4,
          volume: 1,
          muted: false,
        },
        {
          id: 'c2',
          sourceKind: 'asset',
          assetId: 'a2',
          label: 'c2.mp4',
          srcUrl: '/media/c2.mp4',
          thumbUrl: null,
          durationSec: 6,
          trimStartSec: 0,
          trimEndSec: 6,
          volume: 1,
          muted: false,
        },
      ] satisfies ComposeClip[],
    };
    const loaded = fromStored(storedBase, {
      '/media/c1.mp4': { fps: 30, frames: 120 },
      '/media/c2.mp4': { fps: 30, frames: 180 },
    });
    const initial = loaded.sequence;

    // Hand edit: aspect 9:16 + trim c2 end by -90 frames (6s -> 3s)
    const handSeq = trimClipEdge(setAspect(initial, '9:16'), 1, 'end', -90).seq;
    // Planner edit: same steps
    const planRes = applyResolvedStepsToSequence(initial, [
      { do: 'aspect', aspect: '9:16' },
      { do: 'trim', clip: { clipId: 'c2' }, keep: 'start', seconds: 3 },
    ]);
    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;

    const handStored = toStored(handSeq, storedBase);
    const planStored = toStored(planRes.sequence, storedBase);
    expect(planStored).toEqual(handStored);

    // Undo restores exact initial stored film
    const afterUndoStored = toStored(initial, planStored);
    expect(afterUndoStored).toEqual(toStored(initial, storedBase));
  });

  it('preserves parent inherit lineage identically to manual splits on single split, middle cut-out, and speed-changed split, plus undo parity (B1)', () => {
    const storedBase = {
      ...emptyComposerProject('16:9'),
      clips: [
        {
          id: 'c1',
          sourceKind: 'asset',
          assetId: 'a1',
          label: 'c1.mp4',
          srcUrl: '/media/c1.mp4',
          thumbUrl: null,
          durationSec: 6,
          trimStartSec: 0,
          trimEndSec: 6,
          volume: 0.85,
          muted: false,
          soundOffsetSec: 0.3,
        } as ComposeClip,
        {
          id: 'c2',
          sourceKind: 'asset' as const,
          assetId: 'a2',
          label: 'c2.mp4',
          srcUrl: '/media/c1.mp4', // Same footage as c1: without inherit, toStored would pick c2 with empty `from`!
          thumbUrl: null,
          durationSec: 6,
          trimStartSec: 0,
          trimEndSec: 6,
          volume: 1,
          muted: false,
        } satisfies ComposeClip,
      ] as ComposeClip[],
    };
    const loaded = fromStored(storedBase, { '/media/c1.mp4': { fps: 30, frames: 180 } });
    const initial = loaded.sequence;

    const rememberInto = (cat: Record<string, ComposeClip>, pairs: ReadonlyArray<readonly [string, string]>) => {
      for (const [to, from] of pairs) {
        const origin = cat[from];
        if (origin && !cat[to]) cat[to] = inheritClip(origin, to);
      }
    };

    // 1. Single split via chat plan vs manual split -> identical toStored & frameV2.from & undo
    const planSingle = applyResolvedStepsToSequence(initial, [{ do: 'split', clip: { clipId: 'c1' }, at: 2 }]);
    expect(planSingle.ok).toBe(true);
    if (!planSingle.ok) return;
    expect(planSingle.inherit).toEqual([['c1-b', 'c1']]);
    const catChat1: Record<string, ComposeClip> = Object.fromEntries(storedBase.clips.map((c) => [c.id, c]));
    rememberInto(catChat1, planSingle.inherit);
    const chatStored1 = toStored(planSingle.sequence, storedBase, { known: catChat1 });

    const manualSingleSeq = splitAtFrame(initial, 60, 'c1-b');
    const catManual1: Record<string, ComposeClip> = Object.fromEntries(storedBase.clips.map((c) => [c.id, c]));
    rememberInto(catManual1, [['c1-b', 'c1']]);
    const manualStored1 = toStored(manualSingleSeq, storedBase, { known: catManual1 });

    expect(chatStored1).toEqual(manualStored1);
    expect(lineageOf(chatStored1.clips[1]!)).toEqual(['c1']);
    expect(toStored(initial, chatStored1, { known: catChat1 })).toEqual(toStored(initial, manualStored1, { known: catManual1 }));

    // Also via rule-path split_clip_at
    const patchSingle = applyRulePatchesToSequence(initial, [{ op: 'split_clip_at', clipIndex: 0, atMediaSec: 2 }], initial);
    expect(patchSingle.ok).toBe(true);
    if (!patchSingle.ok) return;
    expect(patchSingle.inherit).toEqual([['c1-b', 'c1']]);
    const catPatch: Record<string, ComposeClip> = Object.fromEntries(storedBase.clips.map((c) => [c.id, c]));
    rememberInto(catPatch, patchSingle.inherit);
    expect(toStored(patchSingle.sequence, storedBase, { known: catPatch })).toEqual(manualStored1);

    // 2. Middle cut-out (split at 1s -> split c1-b at 3s -> remove c1-b) vs manual -> identical toStored & nested frameV2.from
    const planMiddle = applyResolvedStepsToSequence(initial, [
      { do: 'split', clip: { clipId: 'c1' }, at: 1 },
      { do: 'split', clip: { splitOf: 'c1', part: 'b' }, at: 3 },
      { do: 'remove', clip: { splitOf: 'c1-b', part: 'a' } },
    ]);
    expect(planMiddle.ok).toBe(true);
    if (!planMiddle.ok) return;
    expect(planMiddle.inherit).toEqual([
      ['c1-b', 'c1'],
      ['c1-b-b', 'c1-b'],
    ]);
    const catChat2: Record<string, ComposeClip> = Object.fromEntries(storedBase.clips.map((c) => [c.id, c]));
    rememberInto(catChat2, planMiddle.inherit);
    const chatStored2 = toStored(planMiddle.sequence, storedBase, { known: catChat2 });

    const m1 = splitAtFrame(initial, 30, 'c1-b');
    const m2 = splitAtFrame(m1, 30 + 90, 'c1-b-b');
    const m3 = removeClips(m2, ['c1-b']);
    const catManual2: Record<string, ComposeClip> = Object.fromEntries(storedBase.clips.map((c) => [c.id, c]));
    rememberInto(catManual2, [
      ['c1-b', 'c1'],
      ['c1-b-b', 'c1-b'],
    ]);
    const manualStored2 = toStored(m3, storedBase, { known: catManual2 });

    expect(chatStored2).toEqual(manualStored2);
    expect(lineageOf(chatStored2.clips[1]!)).toEqual(['c1-b', 'c1']);
    expect(toStored(initial, chatStored2, { known: catChat2 })).toEqual(toStored(initial, manualStored2, { known: catManual2 }));

    // 3. Split on a speed-changed (2x) cut -> identical toStored & frameV2.from & undo
    const fastInitial = setClipConstantSpeed(initial, 0, 2); // c1 is now 90 frames (3s at 2x)
    const fastStoredBase = toStored(fastInitial, storedBase);
    const planFastSplit = applyResolvedStepsToSequence(fastInitial, [{ do: 'split', clip: { clipId: 'c1' }, at: 1.5 }]);
    expect(planFastSplit.ok).toBe(true);
    if (!planFastSplit.ok) return;
    const catChat3: Record<string, ComposeClip> = Object.fromEntries(fastStoredBase.clips.map((c) => [c.id, c]));
    rememberInto(catChat3, planFastSplit.inherit);
    const chatStored3 = toStored(planFastSplit.sequence, fastStoredBase, { known: catChat3 });

    const manualFastSplit = splitAtFrame(fastInitial, 45, 'c1-b');
    const catManual3: Record<string, ComposeClip> = Object.fromEntries(fastStoredBase.clips.map((c) => [c.id, c]));
    rememberInto(catManual3, [['c1-b', 'c1']]);
    const manualStored3 = toStored(manualFastSplit, fastStoredBase, { known: catManual3 });

    expect(chatStored3).toEqual(manualStored3);
    expect(lineageOf(chatStored3.clips[1]!)).toEqual(['c1']);
    expect(toStored(fastInitial, chatStored3, { known: catChat3 })).toEqual(
      toStored(fastInitial, manualStored3, { known: catManual3 }),
    );
  });

  it('mirrors server applyTimelinePatches on trim_clip including 0.3s, 0.4s, 0.5s MIN_CLIP_PLAY_SEC and shift-back cases (S2 + B2)', () => {
    const seq = makeSequence(30); // c2 is 6.0s (180 frames)
    const serverProject = buildPlannerProject(seq);
    const cases: Array<{ name: string; patch: TimelinePatch }> = [
      { name: 'targetDurationSec 0.3s (MIN_CLIP_PLAY_SEC)', patch: { op: 'trim_clip', clipIndex: 1, targetDurationSec: 0.3 } },
      { name: 'targetDurationSec 0.4s (must NOT clamp to 0.5s)', patch: { op: 'trim_clip', clipIndex: 1, targetDurationSec: 0.4 } },
      { name: 'targetDurationSec 0.5s', patch: { op: 'trim_clip', clipIndex: 1, targetDurationSec: 0.5 } },
      { name: 'targetDurationSec only', patch: { op: 'trim_clip', clipIndex: 1, targetDurationSec: 2.5 } },
      { name: 'trimStartSec + targetDurationSec within end', patch: { op: 'trim_clip', clipIndex: 1, trimStartSec: 1.2, targetDurationSec: 2.0 } },
      { name: 'trimStartSec + targetDurationSec running past end (shifts start back)', patch: { op: 'trim_clip', clipIndex: 1, trimStartSec: 4.5, targetDurationSec: 3.0 } },
    ];
    for (const c of cases) {
      const serverOut = applyTimelinePatches(serverProject, [c.patch]);
      const serverClip = serverOut.project.clips[1]!;
      const clientOut = applyRulePatchesToSequence(seq, [c.patch], seq);
      expect(clientOut.ok, c.name).toBe(true);
      if (!clientOut.ok) continue;
      const clientClip = clientOut.sequence.clips[1]!;
      expect(clientClip.inFrame, `${c.name} inFrame`).toBe(secToFrames(serverClip.trimStartSec, 30));
      expect(clientClip.frames, `${c.name} frames`).toBe(secToFrames(serverClip.trimEndSec - serverClip.trimStartSec, 30));
    }
    // Pin exact frame count for 0.4s at 30fps = 12 frames (B2)
    const trim04 = applyRulePatchesToSequence(seq, [{ op: 'trim_clip', clipIndex: 1, targetDurationSec: 0.4 }], seq);
    expect(trim04.ok && trim04.sequence.clips[1]!.frames).toBe(12);
  });

  it('reports complete actual diffs using editor timecode for middle cut-out, two moves, split+trim, and 24fps exact lengths (S3 + W2)', () => {
    // 1. Middle cut-out: never understated as a trim; names pieces, removed, and kept in editor timecode
    const seq = makeSequence(30); // c1=4s, c2=6s, c3=5s
    const midOut = applyResolvedStepsToSequence(seq, [
      { do: 'split', clip: { clipId: 'c2' }, at: 1 },
      { do: 'split', clip: { splitOf: 'c2', part: 'b' }, at: 3 },
      { do: 'remove', clip: { splitOf: 'c2-b', part: 'a' } },
    ]);
    expect(midOut.ok).toBe(true);
    if (midOut.ok) {
      const lines = diffFrameSequences(seq, midOut.sequence, studioEditorKo, studioEditorChatKo, midOut.inherit);
      expect(lines).toEqual(['2번 컷을 2개로 나누고 0:03:00 삭제 (남은 길이 0:03:00)']);
    }

    // 2. Two independent moves -> BOTH moves reported (not just the first)
    const seq4: FrameSequence = {
      fps: 30,
      aspect: '16:9',
      clips: [
        makeClip({ id: 'c1', frames: 90 }),
        makeClip({ id: 'c2', frames: 90 }),
        makeClip({ id: 'c3', frames: 90 }),
        makeClip({ id: 'c4', frames: 90 }),
      ],
      captions: [],
    };
    const twoMoves = applyResolvedStepsToSequence(seq4, [
      { do: 'move', clip: { clipId: 'c3' }, to: 'first' },
      { do: 'move', clip: { clipId: 'c1' }, to: 'last' },
    ]);
    expect(twoMoves.ok).toBe(true);
    if (twoMoves.ok) {
      const lines = diffFrameSequences(seq4, twoMoves.sequence, studioEditorKo, studioEditorChatKo, twoMoves.inherit);
      expect(lines).toEqual(['3번 컷을 1번 자리로 옮기기', '1번 컷을 4번 자리로 옮기기']);
    }

    // 3. Split + trim on same cut -> reports 2 pieces + removed + kept
    const splitTrim = applyResolvedStepsToSequence(seq, [
      { do: 'split', clip: { clipId: 'c2' }, at: 3 },
      { do: 'trim', clip: { splitOf: 'c2', part: 'b' }, keep: 'start', seconds: 1 },
    ]);
    expect(splitTrim.ok).toBe(true);
    if (splitTrim.ok) {
      const lines = diffFrameSequences(seq, splitTrim.sequence, studioEditorKo, studioEditorChatKo, splitTrim.inherit);
      expect(lines).toEqual(['2번 컷을 2개로 나누고 0:02:00 삭제 (남은 길이 0:04:00)']);
    }

    // 4. W2: 24fps exact timecode matches inspector/timeline (`0:12:01 -> 0:11:01`, never rounded ad hoc to `12초 -> 11초`)
    const film24: FrameSequence = {
      fps: 24,
      aspect: '16:9',
      clips: [makeClip({ id: 'c1', frames: 289, fps: 24, sourceFrames: 400 })],
      captions: [],
    };
    const trimmed24 = trimClipEdge(film24, 0, 'end', -24).seq; // 289 -> 265 frames (12.04s -> 11.04s)
    const lines24 = diffFrameSequences(film24, trimmed24, studioEditorKo, studioEditorChatKo);
    expect(lines24).toEqual([`1번 컷 길이 ${formatTimecode(289, 24)} → ${formatTimecode(265, 24)}`]);
    expect(lines24[0]).toBe('1번 컷 길이 0:12:01 → 0:11:01');
  });

  it('accepts EVERY real server AssistPlanResult (all 12 step kinds incl. music remove:true, and every rule patch op incl. set_clip_cuts) through parseAssistClientBody without rejecting as malformed (B1 + S2)', async () => {
    const { planEditAssist } = await import('@/lib/brand-studio/edit-assist/service');
    const { parseComposeChatCommand } = await import('@/lib/brand-studio/compose/chat-intent');
    const seq = makeSequence(30);
    const project = {
      ...buildPlannerProject(seq),
      captions: [{ id: 'cap-1', text: '안녕', startSec: 0, endSec: 2, position: 'bottom' as const, size: 'md' as const }],
      bgm: { label: 'track.mp3', sourceKind: 'asset' as const, srcUrl: '/media/bgm.mp3', durationSec: 20, trimStartSec: 0, volume: 0.5 },
      colorGrade: null,
    };

    const geminiFetch = (planBody: unknown): typeof fetch =>
      (async () =>
        new Response(
          JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(planBody) }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )) as unknown as typeof fetch;

    // Every one of the 12 server step kinds (including `sound` with `target: 'music', remove: true`)
    const serverPlans: Array<{ name: string; steps: unknown[]; expectedFailure?: string }> = [
      { name: 'trim', steps: [{ do: 'trim', clip: 'c1', keep: 'start', seconds: 2 }] },
      { name: 'split', steps: [{ do: 'split', clip: 'c2', at: 2 }] },
      { name: 'remove', steps: [{ do: 'remove', clip: 'c3' }] },
      { name: 'move', steps: [{ do: 'move', clip: 'c3', to: 'first' }] },
      { name: 'sound clip', steps: [{ do: 'sound', target: 'c1', muted: true }] },
      { name: 'sound music remove:true (B1)', steps: [{ do: 'sound', target: 'music', remove: true }], expectedFailure: 'unsupported_music' },
      { name: 'aspect', steps: [{ do: 'aspect', aspect: '9:16' }] },
      { name: 'look', steps: [{ do: 'look', preset: 'kodak-2383-warm' }], expectedFailure: 'unsupported_color' },
      { name: 'fit_total', steps: [{ do: 'fit_total', seconds: 9 }] },
      { name: 'even_pace', steps: [{ do: 'even_pace', secondsPerClip: 3 }] },
      { name: 'caption_add', steps: [{ do: 'caption_add', text: '새 자막', where: 'start' }], expectedFailure: 'unsupported_captions' },
      { name: 'caption_edit', steps: [{ do: 'caption_edit', caption: 't1', text: '수정' }], expectedFailure: 'unsupported_captions' },
      { name: 'caption_remove', steps: [{ do: 'caption_remove', caption: 't1' }], expectedFailure: 'unsupported_captions' },
    ];

    for (const item of serverPlans) {
      const serverResult = await planEditAssist(
        {
          organizationId: '00000000-0000-4000-8000-0000000000aa',
          message: '자유 요청',
          locale: 'ko',
          project,
          playheadSec: 0,
        },
        { env: { GEMINI_API_KEY: 'fake-key' }, fetchImpl: geminiFetch({ kind: 'plan', steps: item.steps }), providerMode: 'live' },
      );
      expect(serverResult.ok, item.name).toBe(true);
      const parsed = parseAssistClientBody(serverResult, 200);
      expect(parsed.ok, `${item.name} must NOT be rejected as malformed`).toBe(true);
      if (parsed.ok && parsed.kind === 'plan' && item.expectedFailure) {
        const mapped = applyResolvedStepsToSequence(seq, parsed.steps);
        expect(mapped).toEqual({ ok: false, reason: item.expectedFailure, sequence: seq });
      }
    }

    // Rule-parser outputs (including `set_clip_cuts` & `split_clip_cuts` & every TimelinePatch op)
    const ruleUtterances = [
      '세로 영상으로 바꿔 줘',
      '1번 컷을 2초로 줄여 줘',
      '마지막 컷 삭제해 줘',
      '1번 컷 소리 꺼 줘',
      '1번 컷 장면 자동으로 나눠 줘',
    ];
    for (const msg of ruleUtterances) {
      const cmd = parseComposeChatCommand(msg, project);
      if (cmd && cmd.kind === 'patches' && cmd.patches.length > 0) {
        const parsed = parseAssistClientBody({ ok: true, kind: 'patches', patches: cmd.patches }, 200);
        expect(parsed.ok, `rule "${msg}" must NOT be malformed`).toBe(true);
      }
    }

    // Explicitly verify `set_clip_cuts` -> accepted at boundary -> refused as `unsupported_scene_split`
    const setCutsParsed = parseAssistClientBody(
      { ok: true, kind: 'patches', patches: [{ op: 'set_clip_cuts', clipIndex: 0, cutMarkers: [1.5, 3.0] }] },
      200,
    );
    expect(setCutsParsed.ok).toBe(true);
    if (setCutsParsed.ok && setCutsParsed.kind === 'patches') {
      expect(applyRulePatchesToSequence(seq, setCutsParsed.patches, seq)).toEqual({
        ok: false,
        reason: 'unsupported_scene_split',
        sequence: seq,
      });
    }

    // S2: empty steps / patches pass boundary validation -> mapper returns `no_change`
    const emptyPlan = parseAssistClientBody({ ok: true, kind: 'plan', steps: [] }, 200);
    expect(emptyPlan).toEqual({ ok: true, kind: 'plan', steps: [] });
    if (emptyPlan.ok && emptyPlan.kind === 'plan') {
      expect(applyResolvedStepsToSequence(seq, emptyPlan.steps)).toEqual({ ok: false, reason: 'no_change', sequence: seq });
    }
    const emptyPatches = parseAssistClientBody({ ok: true, kind: 'patches', patches: [] }, 200);
    expect(emptyPatches).toEqual({ ok: true, kind: 'patches', patches: [] });

    // B1: well-formed unknown kind / step.do / patch.op -> `unsupported` (generic not-available note), NEVER malformed
    expect(parseAssistClientBody({ ok: true, kind: 'future_kind', data: 1 }, 200)).toEqual({ ok: false, code: 'unsupported' });
    expect(parseAssistClientBody({ ok: true, kind: 'plan', steps: [{ do: 'future_step', clip: { clipId: 'c1' } }] }, 200)).toEqual({
      ok: false,
      code: 'unsupported',
    });
    expect(parseAssistClientBody({ ok: true, kind: 'patches', patches: [{ op: 'future_patch', clipIndex: 0 }] }, 200)).toEqual({
      ok: false,
      code: 'unsupported',
    });
  });

  it('rejects every malformed planner payload at the runtime boundary without throwing (S1)', () => {
    const badPayloads: Array<{ name: string; body: unknown }> = [
      { name: 'missing clip', body: { ok: true, kind: 'plan', steps: [{ do: 'trim', keep: 'start', seconds: 2 }] } },
      { name: 'NaN seconds', body: { ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'c1' }, keep: 'start', seconds: Number.NaN }] } },
      { name: 'null seconds (Round 5 #6)', body: { ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'c1' }, keep: 'start', seconds: null }] } },
      { name: 'string seconds where number expected (Round 5 #6)', body: { ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'c1' }, keep: 'start', seconds: '2' }] } },
      { name: 'Infinity seconds', body: { ok: true, kind: 'plan', steps: [{ do: 'fit_total', seconds: Number.POSITIVE_INFINITY }] } },
      { name: 'negative seconds', body: { ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'c1' }, keep: 'start', seconds: -2 }] } },
      { name: 'string where number expected', body: { ok: true, kind: 'plan', steps: [{ do: 'split', clip: { clipId: 'c1' }, at: '2' }] } },
      { name: 'non-string kind', body: { ok: true, kind: 123 } },
      { name: 'bad patch clipIndex string', body: { ok: true, kind: 'patches', patches: [{ op: 'remove_clip', clipIndex: '0' }] } },
      { name: 'bad ask choices', body: { ok: true, kind: 'ask', about: 'which_clip', choices: [{ nope: 1 }] } },
    ];
    for (const item of badPayloads) {
      expect(parseAssistClientBody(item.body, 200), item.name).toEqual({ ok: false, code: 'malformed' });
    }
  });

  it('formats ask questions, ask choices, and failure notes cleanly in Korean', () => {
    const seq = makeSequence(30);
    expect(formatAskQuestion('which_clip', studioEditorChatKo)).toBe(studioEditorChatKo.askWhichClip);
    expect(formatAskQuestion('how_long', studioEditorChatKo)).toBe(studioEditorChatKo.askHowLong);

    const choices = formatAskChoices(
      [{ clipId: 'c1' }, { clipId: 'c3' }, { clipId: 'missing' }, 'all', 2.5, 'start'],
      seq,
      studioEditorChatKo,
    );
    expect(choices.map((c) => c.label)).toEqual(['1번 컷', '3번 컷', '모든 컷', '2.5초', '처음']);
    expect(mapFailureNoteText('unsupported_color', studioEditorChatKo)).toBe(studioEditorChatKo.noteUnsupportedColor);
    expect(mapFailureNoteText('unsupported_scene_split', studioEditorChatKo)).toBe(studioEditorChatKo.noteUnsupportedSceneSplit);
  });
});
