/**
 * "말로 편집" on the screen (docs/BRAND-EDITING-STUDIO.md §4.1, §4.6): the pure part.
 *
 * - The server answers with steps, patches, a question or a code (`assist.plan`). The screen builds the
 *   draft itself, on ITS current timeline, with the same engine functions the server dry-ran
 *   (`applyEditSteps` / `applyTimelinePatches`), and describes it from the diff (`diffTimelines`).
 * - One change that deletes nothing applies at once; anything else is a proposal shown as a preview.
 * - A draft that no longer fits the timeline is `stale`, never half-applied.
 * - Applied edits carry a history mark (the committed timeline object): their "undo" works only while
 *   that object is the current timeline, i.e. while the edit is the top of the history.
 *
 * Client-safe and React-free; the hook (`use-edit-assist.ts`) holds the state.
 */
import { applyTimelinePatches, type ComposeClip, type ComposerProject, type TimelinePatch } from '@/lib/brand-studio/compose';
import { applyEditSteps, type ResolvedStep } from '@/lib/brand-studio/edit-assist/apply';
import { diffTimelines, isInstantEdit, sameValue, type EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import { ASK_ABOUT, CANNOT_REASONS, type AskAbout, type AskChoice, type CannotReason } from '@/lib/brand-studio/edit-assist/plan';

/* ---------------------------------------------------------------- server answer */

export type AssistCannotCode = CannotReason | 'could_not_plan' | 'unavailable';

export type AssistServerAnswer =
  | { ok: false; code: string; retryAfterSec?: number }
  | { ok: true; kind: 'undo' }
  | { ok: true; kind: 'patches'; patches: TimelinePatch[] }
  | { ok: true; kind: 'plan'; steps: ResolvedStep[] }
  | { ok: true; kind: 'ask'; about: AskAbout; choices: AskChoice[] }
  | { ok: true; kind: 'cannot'; reason: AssistCannotCode };

const CANNOT_CODES: readonly string[] = [...CANNOT_REASONS, 'could_not_plan', 'unavailable'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the JSON body of `assist.plan` defensively; anything unexpected reads as `{ ok: false }`. */
export function readAssistAnswer(raw: unknown): AssistServerAnswer {
  if (!isRecord(raw)) return { ok: false, code: 'invalid' };
  if (raw.ok !== true) {
    const code = typeof raw.code === 'string' ? raw.code : 'invalid';
    return typeof raw.retryAfterSec === 'number'
      ? { ok: false, code, retryAfterSec: raw.retryAfterSec }
      : { ok: false, code };
  }
  switch (raw.kind) {
    case 'undo':
      return { ok: true, kind: 'undo' };
    case 'patches':
      return Array.isArray(raw.patches) ? { ok: true, kind: 'patches', patches: raw.patches as TimelinePatch[] } : { ok: false, code: 'invalid' };
    case 'plan':
      return Array.isArray(raw.steps) ? { ok: true, kind: 'plan', steps: raw.steps as ResolvedStep[] } : { ok: false, code: 'invalid' };
    case 'ask':
      return typeof raw.about === 'string' && (ASK_ABOUT as readonly string[]).includes(raw.about) && Array.isArray(raw.choices)
        ? { ok: true, kind: 'ask', about: raw.about as AskAbout, choices: raw.choices as AskChoice[] }
        : { ok: false, code: 'invalid' };
    case 'cannot':
      return {
        ok: true,
        kind: 'cannot',
        reason: typeof raw.reason === 'string' && CANNOT_CODES.includes(raw.reason) ? (raw.reason as AssistCannotCode) : 'unavailable',
      };
    default:
      return { ok: false, code: 'invalid' };
  }
}

/* ---------------------------------------------------------------- automatic scene split */

/** The rule parser's "split at the scene changes" patch: the screen finds the cuts itself. */
export function needsSceneDetection(patches: readonly TimelinePatch[]): boolean {
  return patches.some((patch) => patch.op === 'split_clip_cuts' && patch.cutMediaSecs.length === 0);
}

/**
 * Resolves every empty `split_clip_cuts` with the screen's own detector, exactly as the chat panel does:
 * the detected cuts are stored on the clip and the clip is split at them.
 */
export async function resolveSceneSplitPatches(
  patches: readonly TimelinePatch[],
  project: ComposerProject,
  detect: (clip: ComposeClip) => Promise<number[]>,
): Promise<TimelinePatch[]> {
  const resolved: TimelinePatch[] = [];
  for (const patch of patches) {
    if (patch.op === 'split_clip_cuts' && patch.cutMediaSecs.length === 0) {
      const clip = project.clips[patch.clipIndex];
      if (clip) {
        const detected = await detect(clip);
        resolved.push({ op: 'set_clip_cuts', clipIndex: patch.clipIndex, cutMarkers: detected });
        resolved.push({ op: 'split_clip_cuts', clipIndex: patch.clipIndex, cutMediaSecs: detected });
        continue;
      }
    }
    resolved.push(patch);
  }
  return resolved;
}

/* ---------------------------------------------------------------- drafts and the decision */

/**
 * How a draft is (re)built from the real timeline. Plans name cuts by id and can be re-run on a timeline
 * that changed; patches name cuts by position, so they only fit the exact timeline they were made for.
 */
export type DraftSource =
  | { kind: 'plan'; steps: ResolvedStep[] }
  | { kind: 'patches'; patches: TimelinePatch[]; base: ComposerProject };

export type DraftOutcome =
  | { type: 'draft'; draft: ComposerProject; deltas: EditDelta[] }
  | { type: 'nothing' }
  | { type: 'stale' };

export function draftFrom(real: ComposerProject, source: DraftSource): DraftOutcome {
  let draft: ComposerProject;
  if (source.kind === 'plan') {
    const result = applyEditSteps(real, source.steps);
    if (result.problems.length > 0) {
      return result.problems.every((problem) => problem.code === 'no_change') ? { type: 'nothing' } : { type: 'stale' };
    }
    draft = result.project;
  } else {
    if (source.base !== real) return { type: 'stale' };
    const result = applyTimelinePatches(real, source.patches);
    if (result.appliedCount === 0) return { type: 'nothing' };
    draft = result.project;
  }
  const deltas = diffTimelines(real, draft);
  return deltas.length === 0 ? { type: 'nothing' } : { type: 'draft', draft, deltas };
}

export type AssistNoteCode =
  | AssistCannotCode
  | 'no_change'
  | 'stale'
  | 'rate_limited'
  | 'undone'
  | 'nothing_to_undo';

export type AssistDecision =
  | { type: 'instant'; draft: ComposerProject; deltas: EditDelta[]; source: DraftSource }
  | { type: 'proposal'; draft: ComposerProject; deltas: EditDelta[]; source: DraftSource }
  | { type: 'nothing' }
  | { type: 'stale' }
  | { type: 'undo' }
  | { type: 'ask'; about: AskAbout; choices: AskChoice[] }
  | { type: 'note'; code: AssistNoteCode; seconds?: number };

/**
 * What the screen does with one answer. `real` is the timeline now; `sent` the one the request carried
 * (index-based patches only fit that one). Any auto scene split must be resolved before this call.
 */
export function decideAssist(real: ComposerProject, answer: AssistServerAnswer, sent: ComposerProject): AssistDecision {
  if (!answer.ok) {
    return answer.code === 'rate_limited'
      ? { type: 'note', code: 'rate_limited', seconds: answer.retryAfterSec ?? 60 }
      : { type: 'note', code: 'unavailable' };
  }
  switch (answer.kind) {
    case 'undo':
      return { type: 'undo' };
    case 'ask':
      return { type: 'ask', about: answer.about, choices: answer.choices };
    case 'cannot':
      return { type: 'note', code: answer.reason };
    case 'plan':
    case 'patches': {
      const source: DraftSource =
        answer.kind === 'plan'
          ? { kind: 'plan', steps: answer.steps }
          : { kind: 'patches', patches: answer.patches, base: sent };
      const outcome = draftFrom(real, source);
      if (outcome.type !== 'draft') return outcome;
      return isInstantEdit(outcome.deltas)
        ? { type: 'instant', draft: outcome.draft, deltas: outcome.deltas, source }
        : { type: 'proposal', draft: outcome.draft, deltas: outcome.deltas, source };
    }
  }
}

/**
 * Ids of the cuts in `draft` that differ from the real timeline: new cuts (split pieces), cuts whose
 * values changed, and cuts the diff says moved. Removed cuts are not in the draft (their line says so).
 */
export function changedCutIds(real: ComposerProject, draft: ComposerProject, deltas: readonly EditDelta[]): Set<string> {
  const before = applyTimelinePatches(real, []).project;
  const byId = new Map(before.clips.map((clip) => [clip.id, clip]));
  const draftIds = new Set(draft.clips.map((clip) => clip.id));
  const out = new Set<string>();
  for (const clip of draft.clips) {
    const previous = byId.get(clip.id);
    if (!previous || !sameValue(previous, clip)) out.add(clip.id);
  }
  for (const delta of deltas) {
    if (delta.kind !== 'clip_moved') continue;
    const id = before.clips[delta.cut - 1]?.id;
    if (id && draftIds.has(id)) out.add(id);
  }
  return out;
}

/* ---------------------------------------------------------------- the log */

export type ProposalStatus = 'open' | 'applied' | 'dismissed' | 'stale';
export type AskStatus = 'open' | 'answered' | 'closed';

export type AssistEntry =
  | { id: string; type: 'user'; text: string }
  /** An instant edit: committed at once. `undone` is sticky (see `settleUndone`). */
  | { id: string; type: 'applied'; deltas: EditDelta[]; historyMark: ComposerProject; undone: boolean }
  | {
      id: string;
      type: 'proposal';
      deltas: EditDelta[];
      status: ProposalStatus;
      /** Set when applied. */
      historyMark?: ComposerProject;
      undone?: boolean;
    }
  | {
      id: string;
      type: 'ask';
      about: AskAbout;
      choices: AskChoice[];
      status: AskStatus;
      /** The instruction to send again with the picked answer. */
      message: string;
      picked?: number;
    }
  | { id: string; type: 'note'; code: AssistNoteCode; seconds?: number };

/** The open proposal, if any (there is at most one). */
export function openProposal(entries: readonly AssistEntry[]): Extract<AssistEntry, { type: 'proposal' }> | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.type === 'proposal' && entry.status === 'open') return entry;
  }
  return null;
}

/**
 * The log as a new instruction starts: an open proposal becomes `dismissed`, open questions `closed`
 * (or, when this instruction answers one, that one `answered` with the pick), and the user's words are
 * added unless the instruction is the answer to a question (the question shows the pick instead).
 */
export function startExchange(
  entries: readonly AssistEntry[],
  next: { userEntry?: { id: string; text: string }; answering?: { entryId: string; picked: number } },
): AssistEntry[] {
  const out: AssistEntry[] = entries.map((entry) => {
    if (entry.type === 'proposal' && entry.status === 'open') return { ...entry, status: 'dismissed' };
    if (entry.type === 'ask' && entry.status === 'open') {
      return next.answering?.entryId === entry.id
        ? { ...entry, status: 'answered', picked: next.answering.picked }
        : { ...entry, status: 'closed' };
    }
    return entry;
  });
  if (next.userEntry) out.push({ id: next.userEntry.id, type: 'user', text: next.userEntry.text });
  return out;
}

/** Marks one proposal entry. */
export function withProposal(
  entries: readonly AssistEntry[],
  entryId: string,
  patch: { status: ProposalStatus; deltas?: EditDelta[]; historyMark?: ComposerProject },
): AssistEntry[] {
  return entries.map((entry) =>
    entry.id === entryId && entry.type === 'proposal'
      ? {
          ...entry,
          status: patch.status,
          ...(patch.deltas ? { deltas: patch.deltas } : {}),
          ...(patch.historyMark ? { historyMark: patch.historyMark, undone: false } : {}),
        }
      : entry,
  );
}

/* ---------------------------------------------------------------- history marks */

export interface HistoryView {
  current: ComposerProject;
  undo: readonly ComposerProject[];
  redo: readonly ComposerProject[];
}

/**
 * Where a committed timeline sits in the history: `top` (it is the current timeline), `buried` (later
 * edits sit on top of it), `undone` (it waits on the redo stack), `gone` (in neither stack: undone and
 * then replaced by a new edit, or pushed past the 25-step limit).
 */
export type MarkState = 'top' | 'buried' | 'undone' | 'gone';

export function markState(mark: ComposerProject, view: HistoryView): MarkState {
  if (view.current === mark) return 'top';
  if (view.redo.includes(mark)) return 'undone';
  if (view.undo.includes(mark)) return 'buried';
  return 'gone';
}

export function entryMark(entry: AssistEntry): { mark: ComposerProject; undone: boolean } | null {
  if (entry.type === 'applied') return { mark: entry.historyMark, undone: entry.undone };
  if (entry.type === 'proposal' && entry.status === 'applied' && entry.historyMark) {
    return { mark: entry.historyMark, undone: entry.undone === true };
  }
  return null;
}

/** What an applied entry shows: its undo button works only on `top`. `null` for other entries. */
export function entryHistory(entry: AssistEntry, view: HistoryView): 'top' | 'buried' | 'undone' | null {
  const marked = entryMark(entry);
  if (!marked) return null;
  const state = markState(marked.mark, view);
  if (state === 'gone') return marked.undone ? 'undone' : 'buried';
  return state;
}

/**
 * Keeps each applied entry's sticky `undone` flag in step with the history: set while its timeline waits
 * on the redo stack, cleared when it is current or buried again (redo), kept when it is gone. Returns the
 * same array when nothing changed.
 */
export function settleUndone(entries: readonly AssistEntry[], view: HistoryView): readonly AssistEntry[] {
  let changed = false;
  const out = entries.map((entry) => {
    const marked = entryMark(entry);
    if (!marked) return entry;
    const state = markState(marked.mark, view);
    const undone = state === 'undone' ? true : state === 'gone' ? marked.undone : false;
    if (undone === marked.undone) return entry;
    changed = true;
    return { ...entry, undone } as AssistEntry;
  });
  return changed ? out : entries;
}

/** The entry's own "undo": only for the top of the history, never while a proposal is open. */
export function canUndoEntry(
  entry: AssistEntry,
  view: HistoryView,
  flags: { proposalOpen: boolean; canCreate: boolean },
): boolean {
  return flags.canCreate && !flags.proposalOpen && entryHistory(entry, view) === 'top';
}

/* ---------------------------------------------------------------- recent turns for the model */

export interface RecentTurn {
  said: string;
  did: string[];
  kept: boolean;
}

export const RECENT_TURNS = 3;
const SAID_MAX = 500;
const DID_MAX = 12;
const DID_TEXT_MAX = 200;

/**
 * The last exchanges (oldest first) for "a bit shorter" follow-ups: what the user said, the change lines
 * of the edit it led to (applied or only proposed), and whether that edit is still kept.
 */
export function buildRecent(
  entries: readonly AssistEntry[],
  describe: (delta: EditDelta) => string,
  view: HistoryView,
  max = RECENT_TURNS,
): RecentTurn[] {
  const turns: RecentTurn[] = [];
  let current: RecentTurn | null = null;
  for (const entry of entries) {
    if (entry.type === 'user') {
      current = { said: entry.text.slice(0, SAID_MAX), did: [], kept: false };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    if (entry.type === 'applied' || entry.type === 'proposal') {
      current.did = entry.deltas.slice(0, DID_MAX).map((delta) => describe(delta).slice(0, DID_TEXT_MAX));
      const history = entryHistory(entry, view);
      current.kept = history !== null && history !== 'undone';
    }
  }
  return turns.slice(-max);
}
