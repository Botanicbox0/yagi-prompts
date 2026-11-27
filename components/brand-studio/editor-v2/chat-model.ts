/**
 * Pure thread, selection-chip, and Batch 1 sample-utterance model for Editing Studio v2 right-side chat.
 *
 * Pure data only: no DOM, no storage, no network calls.
 */
import { fill } from '@/components/brand-studio/copy';
import type { AskAbout, AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import {
  ASSIST_MESSAGE_MAX_CHARS,
  ASSIST_RECENT_TURNS,
  type AssistRecentTurn,
} from '@/lib/brand-studio/editor-v2/assist-project';
import {
  formatTimecode,
  frameStateAt,
  removeClips as removeClipsFromSequence,
  setAspect as setSequenceAspect,
  trimClipEdge,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import { interpretUtterance, type AssistIntent } from '@/lib/brand-studio/editor-v2/model';
import { realAssistAllowed } from '@/lib/brand-studio/editor-v2/real';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import type { StudioEditorChatCopy } from '@/messages/studio-editor-chat';
import type { StoredChatChipSummary, StoredChatEntry } from './chat-store';

export const EDITOR_CHAT_MAX_CHARS = ASSIST_MESSAGE_MAX_CHARS;
export const PLAYHEAD_CHIP_KEY = 'playhead';

export type SelectionChip =
  | { key: string; kind: 'cut'; clipId: string; cutNumber: number; label: string }
  | { key: typeof PLAYHEAD_CHIP_KEY; kind: 'playhead'; frame: number; sec: number; timecode: string; label: string };

export interface ChatContextPayload {
  selectedClipIds: string[];
  selectedClipId?: string;
  playheadSec?: number;
  playheadFrame?: number;
}

export type ChatEntry =
  | { id: string; kind: 'user'; text: string; chips?: StoredChatChipSummary[] }
  | { id: string; kind: 'applied'; lines: string[]; undone: boolean; historySequence?: FrameSequence }
  | {
      id: string;
      kind: 'proposal';
      lines: string[];
      status: 'open' | 'applied' | 'dismissed' | 'stale';
      baseSequence?: FrameSequence;
      nextSequence?: FrameSequence;
      /** In-memory `[newPieceId, parentId]` split lineage pairs for `use-editor`'s `remember()` (never persisted). */
      inherit?: ReadonlyArray<readonly [string, string]>;
      historySequence?: FrameSequence;
    }
  | {
      id: string;
      kind: 'ask';
      about: AskAbout | string;
      message: string;
      choices: Array<{ value: string; label: string }>;
      status: 'open' | 'answered' | 'closed';
      picked?: string;
      /** In-memory original instruction and structured choices for `assist.plan` follow-up (never persisted). */
      originalMessage?: string;
      choiceValues?: AskChoice[];
    }
  | { id: string; kind: 'note'; text: string; showExamples?: boolean }
  | { id: string; kind: 'pending'; text: string };

/**
 * Builds the last `max` exchanges (`recent`) sent to `assist.plan`, mirroring
 * `components/brand-studio/compose/assist/assist-model.ts:399-421`.
 */
export function buildChatRecentTurns(
  entries: readonly ChatEntry[],
  max = ASSIST_RECENT_TURNS,
): AssistRecentTurn[] {
  const turns: AssistRecentTurn[] = [];
  let current: AssistRecentTurn | null = null;
  for (const entry of entries) {
    if (entry.kind === 'user') {
      current = { said: entry.text.slice(0, EDITOR_CHAT_MAX_CHARS), did: [], kept: false };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    if (entry.kind === 'applied') {
      current.did = entry.lines.slice(0, 12);
      current.kept = !entry.undone;
    } else if (entry.kind === 'proposal') {
      current.did = entry.lines.slice(0, 12);
      current.kept = entry.status === 'applied';
    }
  }
  return turns.slice(-max);
}

export interface ChatExampleChip {
  key: 'aspect' | 'trim' | 'removeLast';
  text: string;
}

/**
 * Largest whole number of seconds `>= 1` whose frame count is at least 1 frame shorter than `frames`,
 * or `null` when no whole-second shorten is possible (e.g., a 0.8 s cut).
 */
function shortenTargetSeconds(frames: number, fps: number): number | null {
  if (frames <= 1 || !Number.isFinite(fps) || fps <= 0) return null;
  let candidate = Math.min(2, Math.floor((frames - 1) / fps));
  while (candidate >= 1 && Math.round(candidate * fps) > frames - 1) {
    candidate -= 1;
  }
  return candidate >= 1 ? candidate : null;
}

/**
 * Returns example utterances that are guaranteed valid for the open film (W6 + S1):
 * - Aspect example names an aspect the film does NOT currently have (`9:16` vs `16:9`).
 * - Trim example names a cut that exists and shortens it to a whole number of seconds at least
 *   one frame shorter than that cut; omitted if no cut in the film can be shortened to >= 1 s.
 * - "Remove the last cut" is offered only when 2 or more cuts exist.
 */
export function validChatExamples(
  sequence: FrameSequence,
  copy: StudioEditorCopy,
  chatCopy: StudioEditorChatCopy,
): ChatExampleChip[] {
  const out: ChatExampleChip[] = [];
  out.push({
    key: 'aspect',
    text: sequence.aspect === '9:16' ? chatCopy.exampleAspectWide : copy.assist.examples.cut1,
  });

  if (sequence.clips.length > 0) {
    const order = sequence.clips.length >= 2
      ? [1, 0, ...sequence.clips.map((_, i) => i).filter((i) => i > 1)]
      : [0];
    for (const idx of order) {
      const targetClip = sequence.clips[idx]!;
      const targetSec = shortenTargetSeconds(targetClip.frames, sequence.fps);
      if (targetSec === null) continue;
      if (idx === 1 && targetSec === 2) {
        out.push({ key: 'trim', text: copy.assist.examples.cut2 });
      } else {
        out.push({
          key: 'trim',
          text: fill(chatCopy.exampleTrimCut, { n: idx + 1, sec: targetSec }),
        });
      }
      break;
    }
  }

  if (sequence.clips.length >= 2) {
    out.push({ key: 'removeLast', text: copy.assist.examples.cut3 });
  }

  return out;
}

const ASPECT_COPY_KEYS = {
  '16:9': 'r16x9',
  '9:16': 'r9x16',
  '1:1': 'r1x1',
  '4:5': 'r4x5',
} as const;

export function buildSelectionChips(input: {
  sequence: FrameSequence;
  selection: readonly string[];
  playhead: number;
  chatCopy: StudioEditorChatCopy;
}): SelectionChip[] {
  const { sequence, selection, playhead, chatCopy } = input;
  if (sequence.clips.length === 0) return [];
  // At most ONE cut chip in this slice (S4): pick the primary/anchor selection (first id in `selection`
  // that exists on the timeline) so the visible chip always equals the single `selectedClipId` sent.
  if (selection.length > 0) {
    const indexById = new Map(sequence.clips.map((clip, i) => [clip.id, i]));
    for (const id of selection) {
      const index = indexById.get(id);
      if (index !== undefined) {
        const cutNumber = index + 1;
        return [
          {
            key: `cut:${id}`,
            kind: 'cut',
            clipId: id,
            cutNumber,
            label: fill(chatCopy.chipCut, { n: cutNumber }),
          },
        ];
      }
    }
  }
  const safeFrame = Math.max(0, Math.round(playhead));
  const timecode = formatTimecode(safeFrame, sequence.fps);
  return [
    {
      key: PLAYHEAD_CHIP_KEY,
      kind: 'playhead',
      frame: safeFrame,
      sec: safeFrame / sequence.fps,
      timecode,
      label: fill(chatCopy.chipPlayhead, { time: timecode }),
    },
  ];
}

export function visibleSelectionChips(
  chips: readonly SelectionChip[],
  dismissedKeys: ReadonlySet<string>,
): SelectionChip[] {
  if (dismissedKeys.size === 0) return [...chips];
  return chips.filter((chip) => !dismissedKeys.has(chip.key));
}

/**
 * Produces the exact context payload represented by the visible selection chips.
 * What is on the chips is exactly what is sent; dismissing a chip excludes it.
 */
export function chatContextFromChips(visibleChips: readonly SelectionChip[]): ChatContextPayload {
  const selectedClipIds: string[] = [];
  let playheadChip: Extract<SelectionChip, { kind: 'playhead' }> | null = null;
  for (const chip of visibleChips) {
    if (chip.kind === 'cut') selectedClipIds.push(chip.clipId);
    else if (chip.kind === 'playhead') playheadChip = chip;
  }
  const payload: ChatContextPayload = { selectedClipIds };
  if (selectedClipIds.length === 1) {
    payload.selectedClipId = selectedClipIds[0];
  }
  if (playheadChip) {
    payload.playheadFrame = playheadChip.frame;
    payload.playheadSec = playheadChip.sec;
  }
  return payload;
}

export function chipSummaries(visibleChips: readonly SelectionChip[]): StoredChatChipSummary[] | undefined {
  if (visibleChips.length === 0) return undefined;
  return visibleChips.map((chip) => ({ kind: chip.kind, label: chip.label }));
}

export function hydrateStoredEntries(stored: readonly StoredChatEntry[]): ChatEntry[] {
  return stored.map((entry) => ({ ...entry }));
}

export function startChatExchange(entries: readonly ChatEntry[]): ChatEntry[] {
  return entries.map((entry) => {
    if (entry.kind === 'proposal' && entry.status === 'open') {
      return { id: entry.id, kind: 'proposal', lines: entry.lines, status: 'dismissed' };
    }
    if (entry.kind === 'ask' && entry.status === 'open') {
      return { ...entry, status: 'closed' };
    }
    return entry;
  });
}

export function hasOpenProposal(entries: readonly ChatEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'proposal' && entry.status === 'open');
}

export function focusEntryIdOf(entries: readonly ChatEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if ((entry.kind === 'proposal' || entry.kind === 'ask') && entry.status === 'open') {
      return entry.id;
    }
  }
  return null;
}

export type EntryHistoryState = 'top' | 'buried' | 'none';

export function entryHistoryState(
  entry: ChatEntry,
  currentSequence: FrameSequence,
  canUndo: boolean,
): EntryHistoryState {
  if (entry.kind !== 'applied' || entry.undone || !entry.historySequence) return 'none';
  if (canUndo && currentSequence === entry.historySequence) return 'top';
  return 'buried';
}

export function canUndoChatEntry(
  entry: ChatEntry,
  currentSequence: FrameSequence,
  canUndo: boolean,
  openProposal: boolean,
  blocked: boolean,
): boolean {
  if (blocked || openProposal) return false;
  return entryHistoryState(entry, currentSequence, canUndo) === 'top';
}

/**
 * Marks an applied entry undone while preserving its in-memory `historySequence` so a subsequent Redo
 * can restore the applied state of the card (`syncEntriesWithSequence`).
 */
export function markAppliedEntryUndone(entries: ChatEntry[], entryId: string): ChatEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.kind === 'applied' && entry.id === entryId && !entry.undone) {
      changed = true;
      return { ...entry, undone: true };
    }
    return entry;
  });
  return changed ? next : entries;
}

/**
 * Marks any open proposal stale if the film's sequence changed underneath it.
 * Strict stale check: `currentSequence !== entry.baseSequence`.
 */
export function markStaleProposals(entries: ChatEntry[], currentSequence: FrameSequence): ChatEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.kind === 'proposal' && entry.status === 'open' && entry.baseSequence && entry.baseSequence !== currentSequence) {
      changed = true;
      return { id: entry.id, kind: 'proposal' as const, lines: entry.lines, status: 'stale' as const };
    }
    return entry;
  });
  return changed ? next : entries;
}

/**
 * Keeps applied cards in sync with editor Undo and Redo:
 * - if `currentSequence === base` for an active applied entry -> `undone: true` (preserving `historySequence`);
 * - if `currentSequence === entry.historySequence` for an undone entry -> `undone: false` (Redo restored it).
 * Returns the exact same array reference when nothing changes.
 */
export function syncEntriesWithSequence(
  entries: ChatEntry[],
  currentSequence: FrameSequence,
  baseByEntryId: ReadonlyMap<string, FrameSequence>,
): ChatEntry[] {
  const afterStale = markStaleProposals(entries, currentSequence);
  let appliedChanged = false;
  const afterApplied = afterStale.map((entry) => {
    if (entry.kind !== 'applied' || !entry.historySequence) return entry;
    if (!entry.undone) {
      const base = baseByEntryId.get(entry.id);
      if (base && currentSequence === base) {
        appliedChanged = true;
        return { ...entry, undone: true };
      }
    } else if (currentSequence === entry.historySequence) {
      appliedChanged = true;
      return { ...entry, undone: false };
    }
    return entry;
  });
  if (afterStale === entries && !appliedChanged) return entries;
  return appliedChanged ? afterApplied : afterStale;
}

export type Batch1SampleResult =
  | { kind: 'proposal'; lines: string[]; baseSequence: FrameSequence; nextSequence: FrameSequence }
  | { kind: 'note'; text: string; showExamples?: boolean };

function resolveChipTargetIndices(sequence: FrameSequence, context: ChatContextPayload): number[] {
  if (context.selectedClipIds.length > 0) {
    const selected = new Set(context.selectedClipIds);
    const indices: number[] = [];
    sequence.clips.forEach((clip, idx) => {
      if (selected.has(clip.id)) indices.push(idx);
    });
    return indices;
  }
  if (context.playheadFrame !== undefined) {
    const active = frameStateAt(sequence, context.playheadFrame).active;
    return active ? [active.index] : [];
  }
  return [];
}

function parseChipScopedTrimSeconds(text: string): number | null {
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(초|s\b|sec)/i);
  if (!seconds) return null;
  if (!/(줄여|맞춰|짧게|잘라|trim|shorten|cut)/i.test(text)) return null;
  const value = Number(seconds[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isChipScopedDelete(text: string): boolean {
  if (/마지막/.test(text) || /\blast\b/i.test(text)) return false;
  return /(지워|삭제|빼\s*줘|없애|delete|remove)/i.test(text);
}

/**
 * Batch 1 sample-parser evaluation (zero network calls): reuses `interpretUtterance` + `realAssistAllowed`,
 * and when the sentence names no cut, uses the exact visible chip context (`selectedClipIds` or
 * `playheadFrame`). A dismissed chip is absent from `context` and is never used.
 */
export function evaluateBatch1Utterance(
  utterance: string,
  sequence: FrameSequence,
  context: ChatContextPayload,
  copy: StudioEditorCopy,
  chatCopy: StudioEditorChatCopy,
): Batch1SampleResult {
  const trimmed = utterance.trim();
  if (trimmed.length > EDITOR_CHAT_MAX_CHARS) {
    return { kind: 'note', text: fill(chatCopy.noteTooLongMessage, { max: EDITOR_CHAT_MAX_CHARS }) };
  }
  const intent: AssistIntent | null = interpretUtterance(trimmed);
  const lines = copy.assist.lines;

  if (intent) {
    if (!realAssistAllowed(intent)) {
      return { kind: 'note', text: copy.real.assistNotReady, showExamples: true };
    }
    switch (intent.kind) {
      case 'aspect': {
        if (intent.aspect === sequence.aspect) {
          return { kind: 'note', text: copy.assist.nothing };
        }
        const nextSequence = setSequenceAspect(sequence, intent.aspect);
        return {
          kind: 'proposal',
          lines: [fill(lines.aspect, { aspect: copy.aspectNames[ASPECT_COPY_KEYS[intent.aspect]] })],
          baseSequence: sequence,
          nextSequence,
        };
      }
      case 'trim': {
        const clip = sequence.clips[intent.clipNumber - 1];
        const want = Math.max(1, Math.round(intent.seconds * sequence.fps));
        if (!clip || want === clip.frames) {
          return { kind: 'note', text: copy.assist.nothing };
        }
        const result = trimClipEdge(sequence, intent.clipNumber - 1, 'end', want - clip.frames);
        if (result.applied === 0) {
          return { kind: 'note', text: copy.assist.nothing };
        }
        return {
          kind: 'proposal',
          lines: [fill(lines.trim, { number: intent.clipNumber, seconds: intent.seconds })],
          baseSequence: sequence,
          nextSequence: result.seq,
        };
      }
      case 'remove_last': {
        if (sequence.clips.length < 2) {
          return { kind: 'note', text: copy.assist.nothing };
        }
        const last = sequence.clips[sequence.clips.length - 1]!;
        const nextSequence = removeClipsFromSequence(sequence, [last.id]);
        return {
          kind: 'proposal',
          lines: [fill(lines.removeLast, { number: sequence.clips.length })],
          baseSequence: sequence,
          nextSequence,
        };
      }
      default:
        return { kind: 'note', text: copy.real.assistNotReady, showExamples: true };
    }
  }

  // No explicit cut named in the sentence: fall back to the active visible chip(s).
  const chipTrimSec = parseChipScopedTrimSeconds(trimmed);
  if (chipTrimSec !== null) {
    const targets = resolveChipTargetIndices(sequence, context);
    if (targets.length === 0) {
      return { kind: 'note', text: copy.real.assistUnknown, showExamples: true };
    }
    const want = Math.max(1, Math.round(chipTrimSec * sequence.fps));
    let working = sequence;
    const changeLines: string[] = [];
    for (const index of targets) {
      const clip = working.clips[index];
      if (!clip || want === clip.frames) continue;
      const result = trimClipEdge(working, index, 'end', want - clip.frames);
      if (result.applied === 0) continue;
      working = result.seq;
      changeLines.push(fill(lines.trim, { number: index + 1, seconds: chipTrimSec }));
    }
    if (changeLines.length === 0) {
      return { kind: 'note', text: copy.assist.nothing };
    }
    return { kind: 'proposal', lines: changeLines, baseSequence: sequence, nextSequence: working };
  }

  if (isChipScopedDelete(trimmed)) {
    const targets = resolveChipTargetIndices(sequence, context);
    if (targets.length === 0) {
      return { kind: 'note', text: copy.real.assistUnknown, showExamples: true };
    }
    if (targets.length >= sequence.clips.length) {
      return { kind: 'note', text: copy.assist.nothing };
    }
    const ids = targets.map((index) => sequence.clips[index]!.id);
    const nextSequence = removeClipsFromSequence(sequence, ids);
    const changeLines = targets.map((index) => fill(lines.removeLast, { number: index + 1 }));
    return { kind: 'proposal', lines: changeLines, baseSequence: sequence, nextSequence };
  }

  return { kind: 'note', text: copy.real.assistUnknown, showExamples: true };
}
