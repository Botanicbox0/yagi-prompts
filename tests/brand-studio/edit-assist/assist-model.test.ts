import { describe, expect, it, vi } from 'vitest';
import {
  buildRecent,
  canUndoEntry,
  changedCutIds,
  decideAssist,
  draftFrom,
  entryHistory,
  markState,
  needsSceneDetection,
  openProposal,
  readAssistAnswer,
  resolveSceneSplitPatches,
  settleUndone,
  startExchange,
  withProposal,
  type AssistEntry,
  type AssistServerAnswer,
  type HistoryView,
} from '@/components/brand-studio/compose/assist/assist-model';
import { applyTimelinePatches, type ComposerProject, type TimelinePatch } from '@/lib/brand-studio/compose/timeline';
import { resolveEditPlan, type ResolvedStep } from '@/lib/brand-studio/edit-assist/apply';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import type { EditStep } from '@/lib/brand-studio/edit-assist/plan';
import { assistFixture, deepFreeze, FIXTURE_IDS, FIXTURE_REFS } from './fixture';

function steps(list: EditStep[]): ResolvedStep[] {
  const resolved = resolveEditPlan(list, FIXTURE_REFS);
  if (!resolved.ok) throw new Error(`unresolved: ${JSON.stringify(resolved.problems)}`);
  return resolved.steps;
}

const plan = (list: EditStep[]): AssistServerAnswer => ({ ok: true, kind: 'plan', steps: steps(list) });
const patches = (list: TimelinePatch[]): AssistServerAnswer => ({ ok: true, kind: 'patches', patches: list });

function frozenFixture(): ComposerProject {
  return deepFreeze(assistFixture());
}

describe('decideAssist — the decision table', () => {
  it('applies one change that deletes nothing at once (the new total is not a second change)', () => {
    const real = frozenFixture();
    const decision = decideAssist(real, plan([{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }]), real);
    expect(decision.type).toBe('instant');
    if (decision.type !== 'instant') return;
    expect(decision.deltas).toEqual([
      { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 },
      { kind: 'total', beforeSec: 20, afterSec: 17 },
    ]);
    expect(decision.draft.clips[1]!.trimEndSec).toBe(3);
    // The real timeline is never written.
    expect(real.clips[1]!.trimEndSec).toBe(6);
  });

  it('previews a deletion, even a single one', () => {
    const real = frozenFixture();
    const decision = decideAssist(real, plan([{ do: 'remove', clip: 'c3' }]), real);
    expect(decision.type).toBe('proposal');
    if (decision.type !== 'proposal') return;
    expect(decision.deltas[0]).toEqual({ kind: 'clip_removed', cut: 3, label: '거리 달리기' });
    expect(decision.draft.clips.map((c) => c.id)).not.toContain(FIXTURE_IDS.c3);
  });

  it('previews an edit that changes more than one thing', () => {
    const real = frozenFixture();
    const decision = decideAssist(
      real,
      plan([
        { do: 'trim', clip: 'c2', keep: 'start', seconds: 2 },
        { do: 'caption_add', text: '지금 만나보세요', where: 'end' },
      ]),
      real,
    );
    expect(decision.type).toBe('proposal');
    if (decision.type !== 'proposal') return;
    expect(decision.deltas.map((d) => d.kind)).toEqual(['clip_trimmed', 'caption_added', 'total']);
    expect(decision.source.kind).toBe('plan');
  });

  it('says nothing changed when the plan is already true', () => {
    const real = frozenFixture();
    expect(decideAssist(real, plan([{ do: 'aspect', aspect: '9:16' }]), real)).toEqual({ type: 'nothing' });
  });

  it('is stale when a step no longer fits the timeline (the cut was removed by hand meanwhile)', () => {
    const sent = frozenFixture();
    const real = applyTimelinePatches(sent, [{ op: 'remove_clip', clipIndex: 1 }]).project;
    const decision = decideAssist(real, plan([{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }]), sent);
    expect(decision).toEqual({ type: 'stale' });
  });

  it('runs id-based steps on the CURRENT timeline, keeping a hand edit made after sending', () => {
    const sent = frozenFixture();
    const real = applyTimelinePatches(sent, [{ op: 'set_aspect', aspect: '1:1' }]).project;
    const decision = decideAssist(real, plan([{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }]), sent);
    expect(decision.type).toBe('instant');
    if (decision.type !== 'instant') return;
    expect(decision.draft.aspect).toBe('1:1');
  });

  it('applies rule-parser patches to the timeline they were made for', () => {
    const real = frozenFixture();
    const decision = decideAssist(real, patches([{ op: 'set_aspect', aspect: '1:1' }]), real);
    expect(decision.type).toBe('instant');
    if (decision.type !== 'instant') return;
    expect(decision.deltas).toEqual([{ kind: 'aspect', before: '9:16', after: '1:1' }]);
    expect(decision.source).toEqual({ kind: 'patches', patches: [{ op: 'set_aspect', aspect: '1:1' }], base: real });
  });

  it('treats index-based patches as stale once the timeline changed, and as nothing when none applies', () => {
    const sent = frozenFixture();
    const changed = applyTimelinePatches(sent, [{ op: 'set_aspect', aspect: '4:5' }]).project;
    expect(decideAssist(changed, patches([{ op: 'remove_clip', clipIndex: 0 }]), sent)).toEqual({ type: 'stale' });
    expect(decideAssist(sent, patches([{ op: 'remove_clip', clipIndex: 99 }]), sent)).toEqual({ type: 'nothing' });
    expect(decideAssist(sent, patches([{ op: 'set_aspect', aspect: '9:16' }]), sent)).toEqual({ type: 'nothing' });
  });

  it('passes questions, refusals, undo and failures through as values', () => {
    const real = frozenFixture();
    expect(decideAssist(real, { ok: true, kind: 'undo' }, real)).toEqual({ type: 'undo' });
    expect(
      decideAssist(real, { ok: true, kind: 'ask', about: 'which_clip', choices: [{ clipId: 'clip-open' }, 'all'] }, real),
    ).toEqual({ type: 'ask', about: 'which_clip', choices: [{ clipId: 'clip-open' }, 'all'] });
    expect(decideAssist(real, { ok: true, kind: 'cannot', reason: 'not_timeline_edit' }, real)).toEqual({
      type: 'note',
      code: 'not_timeline_edit',
    });
    expect(decideAssist(real, { ok: false, code: 'rate_limited', retryAfterSec: 12 }, real)).toEqual({
      type: 'note',
      code: 'rate_limited',
      seconds: 12,
    });
    expect(decideAssist(real, { ok: false, code: 'invalid' }, real)).toEqual({ type: 'note', code: 'unavailable' });
  });
});

describe('automatic scene split passthrough', () => {
  it('lets the screen find the cuts, exactly as the chat panel does, and then decides as usual', async () => {
    const real = frozenFixture();
    const answer: TimelinePatch[] = [{ op: 'split_clip_cuts', clipIndex: 0, cutMediaSecs: [] }];
    expect(needsSceneDetection(answer)).toBe(true);
    expect(needsSceneDetection([{ op: 'split_clip_cuts', clipIndex: 0, cutMediaSecs: [2] }])).toBe(false);

    const detect = vi.fn(async () => [2, 3.5]);
    const resolved = await resolveSceneSplitPatches(answer, real, detect);
    expect(detect).toHaveBeenCalledWith(real.clips[0]);
    expect(resolved).toEqual([
      { op: 'set_clip_cuts', clipIndex: 0, cutMarkers: [2, 3.5] },
      { op: 'split_clip_cuts', clipIndex: 0, cutMediaSecs: [2, 3.5] },
    ]);

    const decision = decideAssist(real, patches(resolved), real);
    expect(decision.type).toBe('proposal');
    if (decision.type !== 'proposal') return;
    expect(decision.draft.clips.length).toBe(real.clips.length + 2);
  });
});

describe('readAssistAnswer', () => {
  it('reads every answer kind and turns anything unexpected into a failure', () => {
    expect(readAssistAnswer({ ok: true, kind: 'plan', steps: [], creditsUsed: 0 })).toEqual({ ok: true, kind: 'plan', steps: [] });
    expect(readAssistAnswer({ ok: true, kind: 'cannot', reason: 'something new' })).toEqual({
      ok: true,
      kind: 'cannot',
      reason: 'unavailable',
    });
    expect(readAssistAnswer({ ok: true, kind: 'ask', about: 'which_clip', choices: ['all'] })).toEqual({
      ok: true,
      kind: 'ask',
      about: 'which_clip',
      choices: ['all'],
    });
    expect(readAssistAnswer({ ok: true, kind: 'ask', about: 'mood', choices: [] })).toEqual({ ok: false, code: 'invalid' });
    expect(readAssistAnswer({ ok: false, code: 'rate_limited', retryAfterSec: 30 })).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSec: 30,
    });
    expect(readAssistAnswer('<html>')).toEqual({ ok: false, code: 'invalid' });
    expect(readAssistAnswer({ ok: true, kind: 'patches' })).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('draftFrom — rebuilding a proposal at Apply', () => {
  it('rebuilds a plan from the timeline now, and refuses patches made for another timeline', () => {
    const real = frozenFixture();
    const outcome = draftFrom(real, { kind: 'plan', steps: steps([{ do: 'remove', clip: 'c4' }]) });
    expect(outcome.type).toBe('draft');
    const other = applyTimelinePatches(real, [{ op: 'set_aspect', aspect: '1:1' }]).project;
    expect(draftFrom(other, { kind: 'patches', patches: [{ op: 'remove_clip', clipIndex: 3 }], base: real })).toEqual({
      type: 'stale',
    });
  });
});

describe('changedCutIds', () => {
  it('marks trimmed, moved and split cuts, and nothing else', () => {
    const real = frozenFixture();
    const trim = decideAssist(real, plan([{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }]), real);
    if (trim.type !== 'instant') throw new Error('expected instant');
    expect([...changedCutIds(real, trim.draft, trim.deltas)]).toEqual([FIXTURE_IDS.c2]);

    const move = decideAssist(real, plan([{ do: 'move', clip: 'c4', to: 'first' }]), real);
    if (move.type !== 'instant') throw new Error('expected instant');
    expect([...changedCutIds(real, move.draft, move.deltas)]).toEqual([FIXTURE_IDS.c4]);

    const split = decideAssist(real, plan([{ do: 'split', clip: 'c1', at: 2 }]), real);
    if (split.type !== 'instant' && split.type !== 'proposal') throw new Error('expected a draft');
    const ids = changedCutIds(real, split.draft, split.deltas);
    expect(ids.has(FIXTURE_IDS.c1)).toBe(true);
    expect(ids.size).toBe(2);
    expect(ids.has(FIXTURE_IDS.c2)).toBe(false);
  });
});

/* ------------------------------------------------------------------ history marks and the log */

const trimDelta: EditDelta = { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 };
const removeDelta: EditDelta = { kind: 'clip_removed', cut: 3, label: '거리 달리기' };

function timelines() {
  const base = assistFixture();
  const a = applyTimelinePatches(base, [{ op: 'set_aspect', aspect: '1:1' }]).project;
  const b = applyTimelinePatches(a, [{ op: 'set_aspect', aspect: '4:5' }]).project;
  return { base, a, b };
}

describe('history marks', () => {
  it('knows where a committed timeline sits: top, buried, undone or gone', () => {
    const { base, a, b } = timelines();
    expect(markState(a, { current: a, undo: [base], redo: [] })).toBe('top');
    expect(markState(a, { current: b, undo: [base, a], redo: [] })).toBe('buried');
    expect(markState(a, { current: base, undo: [], redo: [a] })).toBe('undone');
    expect(markState(a, { current: b, undo: [base], redo: [] })).toBe('gone');
  });

  it("enables an entry's undo only while its edit is the top of the history and no proposal is open", () => {
    const { base, a, b } = timelines();
    const entry: AssistEntry = { id: 'a1', type: 'applied', deltas: [trimDelta], historyMark: a, undone: false };
    const top: HistoryView = { current: a, undo: [base], redo: [] };
    const buried: HistoryView = { current: b, undo: [base, a], redo: [] };
    expect(canUndoEntry(entry, top, { proposalOpen: false, canCreate: true })).toBe(true);
    expect(canUndoEntry(entry, top, { proposalOpen: true, canCreate: true })).toBe(false);
    expect(canUndoEntry(entry, top, { proposalOpen: false, canCreate: false })).toBe(false);
    expect(canUndoEntry(entry, buried, { proposalOpen: false, canCreate: true })).toBe(false);
    // Undoing the later edit makes this one the top again.
    expect(canUndoEntry(entry, { current: a, undo: [base], redo: [b] }, { proposalOpen: false, canCreate: true })).toBe(true);
  });

  it('keeps "undone" after the undone edit leaves the redo stack, and clears it on redo', () => {
    const { base, a, b } = timelines();
    const entries: AssistEntry[] = [{ id: 'a1', type: 'applied', deltas: [trimDelta], historyMark: a, undone: false }];

    const afterUndo = settleUndone(entries, { current: base, undo: [], redo: [a] });
    expect(afterUndo).not.toBe(entries);
    expect(entryHistory(afterUndo[0]!, { current: base, undo: [], redo: [a] })).toBe('undone');

    // A new edit clears the redo stack: the mark is gone, the entry still reads as undone.
    const gone: HistoryView = { current: b, undo: [base], redo: [] };
    const settled = settleUndone(afterUndo, gone);
    expect(settled).toBe(afterUndo);
    expect(entryHistory(settled[0]!, gone)).toBe('undone');

    // Redo brings it back.
    const redone = settleUndone(afterUndo, { current: a, undo: [base], redo: [] });
    expect(redone[0]).toMatchObject({ undone: false });
    expect(entryHistory(redone[0]!, { current: a, undo: [base], redo: [] })).toBe('top');

    // An entry pushed past the history limit stays applied.
    expect(entryHistory(entries[0]!, gone)).toBe('buried');
  });

  it('treats an applied proposal like an instant edit', () => {
    const { base, a } = timelines();
    const open: AssistEntry[] = [{ id: 'p1', type: 'proposal', deltas: [removeDelta], status: 'open' }];
    expect(entryHistory(open[0]!, { current: base, undo: [], redo: [] })).toBeNull();
    const applied = withProposal(open, 'p1', { status: 'applied', historyMark: a });
    expect(applied[0]).toMatchObject({ status: 'applied', historyMark: a, undone: false });
    expect(entryHistory(applied[0]!, { current: a, undo: [base], redo: [] })).toBe('top');
  });
});

describe('the log as a new instruction starts', () => {
  it('dismisses the open proposal, closes open questions and adds the words', () => {
    const entries: AssistEntry[] = [
      { id: 'u1', type: 'user', text: '로고 컷 지워줘' },
      { id: 'p1', type: 'proposal', deltas: [removeDelta], status: 'open' },
      { id: 'q1', type: 'ask', about: 'which_clip', choices: ['all'], status: 'open', message: '줄여줘' },
    ];
    expect(openProposal(entries)?.id).toBe('p1');
    const next = startExchange(entries, { userEntry: { id: 'u2', text: '전체를 15초로 맞춰줘' } });
    expect(next.map((e) => [e.id, 'status' in e ? e.status : null])).toEqual([
      ['u1', null],
      ['p1', 'dismissed'],
      ['q1', 'closed'],
      ['u2', null],
    ]);
    expect(openProposal(next)).toBeNull();
  });

  it('marks the answered question with the pick and adds no new words', () => {
    const entries: AssistEntry[] = [
      { id: 'u1', type: 'user', text: '줄여줘' },
      { id: 'q1', type: 'ask', about: 'which_clip', choices: [{ clipId: 'clip-hand' }, 'all'], status: 'open', message: '줄여줘' },
    ];
    const next = startExchange(entries, { answering: { entryId: 'q1', picked: 1 } });
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ status: 'answered', picked: 1 });
  });
});

describe('buildRecent', () => {
  it('keeps the last three exchanges with their change lines and whether they were kept', () => {
    const { base, a } = timelines();
    const view: HistoryView = { current: a, undo: [base], redo: [] };
    const entries: AssistEntry[] = [
      { id: 'u0', type: 'user', text: '오래된 지시' },
      { id: 'n0', type: 'note', code: 'no_change' },
      { id: 'u1', type: 'user', text: '로고 컷 지워줘' },
      { id: 'p1', type: 'proposal', deltas: [removeDelta], status: 'dismissed' },
      { id: 'u2', type: 'user', text: '줄여줘' },
      { id: 'q2', type: 'ask', about: 'which_clip', choices: ['all'], status: 'answered', picked: 0, message: '줄여줘' },
      { id: 'a2', type: 'applied', deltas: [trimDelta], historyMark: a, undone: false },
      { id: 'u3', type: 'user', text: '음악 꺼줘' },
      { id: 'n3', type: 'note', code: 'nothing_to_edit' },
    ];
    const say = (delta: EditDelta) => `line:${delta.kind}`;
    expect(buildRecent(entries, say, view)).toEqual([
      { said: '로고 컷 지워줘', did: ['line:clip_removed'], kept: false },
      { said: '줄여줘', did: ['line:clip_trimmed'], kept: true },
      { said: '음악 꺼줘', did: [], kept: false },
    ]);
    // Undone edits are not kept.
    expect(buildRecent(entries, say, { current: base, undo: [], redo: [a] })[1]).toMatchObject({ kept: false });
  });
});
