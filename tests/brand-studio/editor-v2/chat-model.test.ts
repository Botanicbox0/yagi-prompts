import { describe, expect, it } from 'vitest';
import {
  EDITOR_CHAT_MAX_CHARS,
  PLAYHEAD_CHIP_KEY,
  buildSelectionChips,
  canUndoChatEntry,
  chatContextFromChips,
  entryHistoryState,
  evaluateBatch1Utterance,
  focusEntryIdOf,
  markAppliedEntryUndone,
  markStaleProposals,
  startChatExchange,
  syncEntriesWithSequence,
  validChatExamples,
  visibleSelectionChips,
  type ChatEntry,
} from '@/components/brand-studio/editor-v2/chat-model';
import { type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { emptyFilm } from '@/lib/brand-studio/editor-v2/real';
import { fill } from '@/components/brand-studio/copy';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatEn, studioEditorChatKo } from '@/messages/studio-editor-chat';

function makeClip(id: string, frames: number): FrameClip {
  return {
    id,
    label: id,
    srcUrl: `/media/${id}.mp4`,
    thumbUrl: null,
    sourceFps: 30,
    sourceFrames: frames * 2,
    inFrame: 0,
    frames,
    speedNum: 1,
    speedDen: 1,
    phase: 0,
    volume: 1,
    muted: false,
  };
}

function makeSequence(): FrameSequence {
  return {
    fps: 30,
    aspect: '16:9',
    clips: [makeClip('c1', 90), makeClip('c2', 120), makeClip('c3', 150)],
    captions: [],
  };
}

describe('editor-v2 chat-model', () => {
  it('derives selection chips and feeds exact visible chip context into the parser for selected, removed, and playhead states', () => {
    const seq = makeSequence();

    // Nothing selected -> playhead chip inside cut 2 (frame 105 is inside c2: frames 90..209)
    const playheadChips = buildSelectionChips({ sequence: seq, selection: [], playhead: 105, chatCopy: studioEditorChatKo });
    expect(playheadChips).toHaveLength(1);
    expect(playheadChips[0]).toMatchObject({ key: PLAYHEAD_CHIP_KEY, kind: 'playhead', frame: 105, sec: 3.5, label: '재생 위치 0:03:15' });
    const playheadCtx = chatContextFromChips(playheadChips);
    expect(playheadCtx).toEqual({
      selectedClipIds: [],
      playheadFrame: 105,
      playheadSec: 3.5,
    });

    // Cut-less trim with playhead chip -> targets cut 2 under playhead!
    const trimAtPlayhead = evaluateBatch1Utterance('2초로 줄여 줘', seq, playheadCtx, studioEditorKo, studioEditorChatKo);
    expect(trimAtPlayhead.kind).toBe('proposal');
    if (trimAtPlayhead.kind === 'proposal') {
      expect(trimAtPlayhead.lines).toEqual(['2번 컷이 2초가 됩니다']);
      expect(trimAtPlayhead.nextSequence.clips[1]!.frames).toBe(60);
      expect(trimAtPlayhead.nextSequence.clips[0]!.frames).toBe(90);
      expect(trimAtPlayhead.nextSequence.clips[2]!.frames).toBe(150);
    }

    // Dismissing playhead chip removes it from context -> parser does NOT use it
    const dismissedPlayhead = visibleSelectionChips(playheadChips, new Set([PLAYHEAD_CHIP_KEY]));
    expect(dismissedPlayhead).toEqual([]);
    const emptyCtx = chatContextFromChips(dismissedPlayhead);
    expect(emptyCtx).toEqual({ selectedClipIds: [] });
    expect(evaluateBatch1Utterance('2초로 줄여 줘', seq, emptyCtx, studioEditorKo, studioEditorChatKo)).toEqual({
      kind: 'note',
      text: studioEditorKo.real.assistUnknown,
      showExamples: true,
    });

    // Cut 3 selected -> chip says "컷 3" and "3초로 줄여 줘" trims cut 3!
    const cut3Chips = buildSelectionChips({ sequence: seq, selection: ['c3'], playhead: 0, chatCopy: studioEditorChatKo });
    expect(cut3Chips).toHaveLength(1);
    expect(cut3Chips[0]).toMatchObject({ kind: 'cut', clipId: 'c3', cutNumber: 3, label: '컷 3' });
    const cut3Ctx = chatContextFromChips(cut3Chips);
    expect(cut3Ctx).toEqual({ selectedClipIds: ['c3'], selectedClipId: 'c3' });

    const trimCut3 = evaluateBatch1Utterance('3초로 줄여 줘', seq, cut3Ctx, studioEditorKo, studioEditorChatKo);
    expect(trimCut3.kind).toBe('proposal');
    if (trimCut3.kind === 'proposal') {
      expect(trimCut3.lines).toEqual(['3번 컷이 3초가 됩니다']);
      expect(trimCut3.nextSequence.clips[2]!.frames).toBe(90);
      expect(trimCut3.nextSequence.clips[0]!.frames).toBe(90);
      expect(trimCut3.nextSequence.clips[1]!.frames).toBe(120);
    }

    // Cut-less delete with selected cut 3 removes cut 3; with chip removed it does not
    const delCut3 = evaluateBatch1Utterance('이 컷 지워 줘', seq, cut3Ctx, studioEditorKo, studioEditorChatKo);
    expect(delCut3.kind).toBe('proposal');
    if (delCut3.kind === 'proposal') {
      expect(delCut3.nextSequence.clips.map((c) => c.id)).toEqual(['c1', 'c2']);
    }
    const cut3DismissedCtx = chatContextFromChips(visibleSelectionChips(cut3Chips, new Set(['cut:c3'])));
    expect(evaluateBatch1Utterance('3초로 줄여 줘', seq, cut3DismissedCtx, studioEditorKo, studioEditorChatKo)).toEqual({
      kind: 'note',
      text: studioEditorKo.real.assistUnknown,
      showExamples: true,
    });
    expect(evaluateBatch1Utterance('이 컷 지워 줘', seq, cut3DismissedCtx, studioEditorKo, studioEditorChatKo)).toEqual({
      kind: 'note',
      text: studioEditorKo.real.assistUnknown,
      showExamples: true,
    });

    // Multi-selection -> S4: at most ONE cut chip for the primary/anchor selection (`c3`), matching `selectedClipId`
    const twoCuts = buildSelectionChips({ sequence: seq, selection: ['c3', 'c1'], playhead: 0, chatCopy: studioEditorChatKo });
    expect(twoCuts.map((c) => c.label)).toEqual(['컷 3']);
    expect(chatContextFromChips(twoCuts)).toEqual({ selectedClipIds: ['c3'], selectedClipId: 'c3' });
    const afterDismiss = visibleSelectionChips(twoCuts, new Set(['cut:c3']));
    expect(chatContextFromChips(afterDismiss)).toEqual({ selectedClipIds: [] });

    // Empty film -> no chips
    expect(buildSelectionChips({ sequence: emptyFilm(), selection: [], playhead: 0, chatCopy: studioEditorChatKo })).toEqual([]);
  });

  it('evaluates explicit Batch 1 sample utterances honestly with zero network calls', () => {
    const seq = makeSequence();
    const noCtx = { selectedClipIds: [] };

    const aspect = evaluateBatch1Utterance('세로 영상으로 바꿔 줘', seq, noCtx, studioEditorKo, studioEditorChatKo);
    expect(aspect.kind).toBe('proposal');
    if (aspect.kind === 'proposal') {
      expect(aspect.baseSequence).toBe(seq);
      expect(aspect.nextSequence.aspect).toBe('9:16');
      expect(aspect.lines).toEqual(['화면을 세로 비율로 바꿉니다']);
    }

    const trim = evaluateBatch1Utterance('두 번째 컷을 2초로 줄여 줘', seq, noCtx, studioEditorKo, studioEditorChatKo);
    expect(trim.kind).toBe('proposal');
    if (trim.kind === 'proposal') {
      expect(trim.nextSequence.clips[1]!.frames).toBe(60);
    }

    const removeLast = evaluateBatch1Utterance('마지막 컷 지워 줘', seq, noCtx, studioEditorKo, studioEditorChatKo);
    expect(removeLast.kind).toBe('proposal');
    if (removeLast.kind === 'proposal') {
      expect(removeLast.nextSequence.clips.map((c) => c.id)).toEqual(['c1', 'c2']);
    }

    const color = evaluateBatch1Utterance('영상 전체 색을 균형 있게 맞춰 줘', seq, noCtx, studioEditorKo, studioEditorChatKo);
    expect(color).toEqual({ kind: 'note', text: studioEditorKo.real.assistNotReady, showExamples: true });

    const unknown = evaluateBatch1Utterance('비트 맞춰서 멋지게 편집해 줘', seq, noCtx, studioEditorKo, studioEditorChatKo);
    expect(unknown).toEqual({ kind: 'note', text: studioEditorKo.real.assistUnknown, showExamples: true });

    const tooLong = evaluateBatch1Utterance('가'.repeat(EDITOR_CHAT_MAX_CHARS + 1), seq, noCtx, studioEditorKo, studioEditorChatKo);
    expect(tooLong).toEqual({
      kind: 'note',
      text: fill(studioEditorChatKo.noteTooLongMessage, { max: EDITOR_CHAT_MAX_CHARS }),
    });
    expect(tooLong.kind === 'note' ? tooLong.text : '').toContain(String(EDITOR_CHAT_MAX_CHARS));
    // Numeric limits come from constants via placeholders, and neither language mentions an old/earlier/classic editor.
    expect(studioEditorChatKo.noteTooLongCut).toContain('{minutes}');
    expect(studioEditorChatKo.attachTooLong).toContain('{minutes}');
    expect(studioEditorChatKo.noteTooManyCuts).toContain('{max}');
    expect(studioEditorChatKo.noteTooLongMessage).toContain('{max}');
    expect(studioEditorChatEn.noteTooLongCut).toContain('{minutes}');
    expect(studioEditorChatEn.attachTooLong).toContain('{minutes}');
    expect(studioEditorChatEn.noteTooManyCuts).toContain('{max}');
    expect(studioEditorChatEn.noteTooLongMessage).toContain('{max}');
    for (const [key, val] of Object.entries(studioEditorChatKo)) {
      expect(val, `ko.${key}`).not.toMatch(/예전 편집기|기존 편집기|클래식/);
    }
    for (const [key, val] of Object.entries(studioEditorChatEn)) {
      expect(val, `en.${key}`).not.toMatch(/earlier editor|old editor|classic editor/i);
    }

    const singleSeq: FrameSequence = { ...seq, clips: [seq.clips[0]!] };
    expect(evaluateBatch1Utterance('마지막 컷 지워 줘', singleSeq, noCtx, studioEditorKo, studioEditorChatKo)).toEqual({
      kind: 'note',
      text: studioEditorKo.assist.nothing,
    });
  });

  it('tracks open-entry focus, strict stale proposals, and undo -> redo -> undo synchronization', () => {
    const seq1 = makeSequence();
    const seq2: FrameSequence = { ...seq1, aspect: '9:16' };
    const seq3: FrameSequence = { ...seq2, aspect: '1:1' };

    const entries: ChatEntry[] = [
      { id: 'u1', kind: 'user', text: '세로' },
      { id: 'p1', kind: 'proposal', lines: ['세로'], status: 'open', baseSequence: seq1, nextSequence: seq2 },
    ];
    expect(focusEntryIdOf(entries)).toBe('p1');
    expect(markStaleProposals(entries, seq1)).toBe(entries);

    const staled = markStaleProposals(entries, seq2);
    expect(staled[1]).toEqual({ id: 'p1', kind: 'proposal', lines: ['세로'], status: 'stale' });
    expect(focusEntryIdOf(staled)).toBeNull();

    const closed = startChatExchange(entries);
    expect(closed[1]).toEqual({ id: 'p1', kind: 'proposal', lines: ['세로'], status: 'dismissed' });

    // Undo -> Redo -> Undo lifecycle preserves historySequence so Redo restores active applied card
    const applied: ChatEntry = { id: 'a1', kind: 'applied', lines: ['세로'], undone: false, historySequence: seq2 };
    const bases = new Map<string, FrameSequence>([['a1', seq1]]);
    expect(entryHistoryState(applied, seq2, true)).toBe('top');
    expect(canUndoChatEntry(applied, seq2, true, false, false)).toBe(true);
    expect(canUndoChatEntry(applied, seq2, true, true, false)).toBe(false);
    expect(canUndoChatEntry(applied, seq2, true, false, true)).toBe(false);
    expect(entryHistoryState(applied, seq3, true)).toBe('buried');

    const afterUndo = markAppliedEntryUndone([applied], 'a1');
    expect(afterUndo[0]).toMatchObject({ id: 'a1', undone: true, historySequence: seq2 });
    expect(canUndoChatEntry(afterUndo[0]!, seq1, false, false, false)).toBe(false);

    // Redo restores seq2 -> applied card becomes active & undoable again
    const afterRedo = syncEntriesWithSequence(afterUndo, seq2, bases);
    expect(afterRedo[0]).toMatchObject({ id: 'a1', undone: false, historySequence: seq2 });
    expect(canUndoChatEntry(afterRedo[0]!, seq2, true, false, false)).toBe(true);

    // Undo again returns seq1 -> undone again
    const afterSecondUndo = syncEntriesWithSequence(afterRedo, seq1, bases);
    expect(afterSecondUndo[0]).toMatchObject({ id: 'a1', undone: true, historySequence: seq2 });
    expect(syncEntriesWithSequence(afterSecondUndo, seq1, bases)).toBe(afterSecondUndo);
  });

  it('builds film-valid example chips for vertical, horizontal, single-cut, and empty films (W6)', () => {
    const noCtx = { selectedClipIds: [] };

    // 9:16 vertical film with 3 cuts -> aspect example asks for horizontal (never vertical!), trim & removeLast valid
    const vertical3: FrameSequence = { ...makeSequence(), aspect: '9:16' };
    const exV3 = validChatExamples(vertical3, studioEditorKo, studioEditorChatKo);
    expect(exV3.map((e) => e.key)).toEqual(['aspect', 'trim', 'removeLast']);
    expect(exV3[0]!.text).toBe(studioEditorChatKo.exampleAspectWide);
    expect(exV3[0]!.text).not.toBe(studioEditorKo.assist.examples.cut1);
    for (const ex of exV3) {
      const res = evaluateBatch1Utterance(ex.text, vertical3, noCtx, studioEditorKo, studioEditorChatKo);
      expect(res.kind, ex.text).toBe('proposal');
    }

    // 16:9 film with 1 cut -> aspect asks for vertical, trim names cut 1 (not cut 2), removeLast is omitted
    const single16x9: FrameSequence = {
      fps: 30,
      aspect: '16:9',
      clips: [makeClip('c1', 120)],
      captions: [],
    };
    const exS1 = validChatExamples(single16x9, studioEditorKo, studioEditorChatKo);
    expect(exS1.map((e) => e.key)).toEqual(['aspect', 'trim']);
    expect(exS1[0]!.text).toBe(studioEditorKo.assist.examples.cut1);
    expect(exS1[1]!.text).toContain('1번 컷');
    for (const ex of exS1) {
      const res = evaluateBatch1Utterance(ex.text, single16x9, noCtx, studioEditorKo, studioEditorChatKo);
      expect(res.kind, ex.text).toBe('proposal');
    }

    // Empty 9:16 film -> aspect wide only (no trim, no removeLast); empty 16:9 -> vertical only
    const empty = emptyFilm();
    const exEmpty = validChatExamples(empty, studioEditorKo, studioEditorChatKo);
    expect(exEmpty.map((e) => e.key)).toEqual(['aspect']);
    expect(exEmpty[0]!.text).toBe(studioEditorChatKo.exampleAspectWide);

    const emptyWide: FrameSequence = { ...empty, aspect: '16:9' };
    const exEmptyWide = validChatExamples(emptyWide, studioEditorKo, studioEditorChatKo);
    expect(exEmptyWide.map((e) => e.key)).toEqual(['aspect']);
    expect(exEmptyWide[0]!.text).toBe(studioEditorKo.assist.examples.cut1);

    // S1: trim example only offers whole seconds >= 1 strictly shorter by >= 1 frame
    const cut08s: FrameSequence = { fps: 30, aspect: '16:9', clips: [makeClip('c1', 24)], captions: [] }; // 0.8s
    const ex08 = validChatExamples(cut08s, studioEditorKo, studioEditorChatKo);
    expect(ex08.map((e) => e.key)).toEqual(['aspect']);

    const all08s: FrameSequence = { fps: 30, aspect: '9:16', clips: [makeClip('c1', 24), makeClip('c2', 24)], captions: [] };
    const exAll08 = validChatExamples(all08s, studioEditorKo, studioEditorChatKo);
    expect(exAll08.map((e) => e.key)).toEqual(['aspect', 'removeLast']);
    for (const ex of exAll08) {
      expect(evaluateBatch1Utterance(ex.text, all08s, noCtx, studioEditorKo, studioEditorChatKo).kind, ex.text).toBe('proposal');
    }

    const cut15s: FrameSequence = { fps: 30, aspect: '16:9', clips: [makeClip('c1', 45)], captions: [] }; // 1.5s -> offers 1s (30f < 45f)
    const ex15 = validChatExamples(cut15s, studioEditorKo, studioEditorChatKo);
    expect(ex15.map((e) => e.key)).toEqual(['aspect', 'trim']);
    expect(ex15[1]!.text).toContain('1초');
    const trim15 = evaluateBatch1Utterance(ex15[1]!.text, cut15s, noCtx, studioEditorKo, studioEditorChatKo);
    expect(trim15.kind).toBe('proposal');
    if (trim15.kind === 'proposal') {
      expect(trim15.nextSequence.clips[0]!.frames).toBe(30);
    }

    const cut3s: FrameSequence = { fps: 30, aspect: '16:9', clips: [makeClip('c1', 90)], captions: [] }; // 3s -> offers 2s (60f < 90f)
    const ex3 = validChatExamples(cut3s, studioEditorKo, studioEditorChatKo);
    expect(ex3.map((e) => e.key)).toEqual(['aspect', 'trim']);
    expect(ex3[1]!.text).toContain('2초');
    const trim3 = evaluateBatch1Utterance(ex3[1]!.text, cut3s, noCtx, studioEditorKo, studioEditorChatKo);
    expect(trim3.kind).toBe('proposal');
    if (trim3.kind === 'proposal') {
      expect(trim3.nextSequence.clips[0]!.frames).toBe(60);
    }

    // If cut 2 is 0.8s but cut 1 is 3s, scans cuts [1, 0, ...] and picks cut 1!
    const mixed: FrameSequence = { fps: 30, aspect: '16:9', clips: [makeClip('c1', 90), makeClip('c2', 24)], captions: [] };
    const exMixed = validChatExamples(mixed, studioEditorKo, studioEditorChatKo);
    expect(exMixed.map((e) => e.key)).toEqual(['aspect', 'trim', 'removeLast']);
    expect(exMixed[1]!.text).toContain('1번 컷');
    expect(exMixed[1]!.text).toContain('2초');
    for (const ex of exMixed) {
      expect(evaluateBatch1Utterance(ex.text, mixed, noCtx, studioEditorKo, studioEditorChatKo).kind, ex.text).toBe('proposal');
    }
  });
});
