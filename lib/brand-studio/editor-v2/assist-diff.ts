/**
 * Editing studio v2 — actual-diff change lines and ask wording (slice E-C, Batch 2 + Fix Round 3).
 *
 * Every proposal and applied card line is computed from the ACTUAL difference between `before` and
 * `after` `FrameSequence` objects — never from the user's request or model prose.
 * - Uses the editor's own frame timecode formatter (`formatTimecode`, matching timeline & inspector).
 * - Groups every surviving piece (including nested `-b` descendants) by original cut so splits,
 *   middle cut-outs, and split+trim never understate what changes on the timeline.
 * - Reports every moved cut (via Longest Increasing Subsequence of surviving original cuts).
 * Pure and client-safe.
 */
import { fill } from '@/components/brand-studio/copy';
import type { AskAbout, AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import type { StudioEditorChatCopy } from '@/messages/studio-editor-chat';
import type { AssistInheritPair, AssistMapFailureReason } from './assist-apply';
import { formatTimecode, totalFrames, type FrameClip, type FrameSequence } from './frames';

const ASPECT_COPY_KEYS = {
  '16:9': 'r16x9',
  '9:16': 'r9x16',
  '1:1': 'r1x1',
  '4:5': 'r4x5',
} as const;

/** Formats integer frames using the editor's own timeline/inspector timecode (`m:ss:ff`). */
export function formatFrameLength(frames: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps >= 1 ? Math.round(fps) : 30;
  return formatTimecode(Math.max(0, Math.round(frames)), safeFps);
}

/** Formats ask choice seconds (numeric choices from server `ask` payload). */
export function formatDiffSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildRootOwnerResolver(
  before: FrameSequence,
  inherit?: readonly AssistInheritPair[],
): (clipId: string) => string | null {
  const beforeIds = new Set(before.clips.map((c) => c.id));
  const parentOf = new Map<string, string>();
  for (const [child, parent] of inherit ?? []) {
    parentOf.set(child, parent);
  }
  const origSorted = [...before.clips].map((c) => c.id).sort((a, b) => b.length - a.length);

  return (clipId: string): string | null => {
    if (beforeIds.has(clipId)) return clipId;
    let cur: string | undefined = clipId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (beforeIds.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    // Fallback when `inherit` wasn't passed: trace `${orig.slice(0,60)}-b...` descendant ids.
    for (const origId of origSorted) {
      const stem = `${origId.slice(0, 60)}-b`;
      if (clipId === stem || clipId.startsWith(`${stem}-`) || (clipId.startsWith(stem) && /^\d+/.test(clipId.slice(stem.length)))) {
        return origId;
      }
    }
    return null;
  };
}

/**
 * Indices in `arr` that form a Longest Increasing Subsequence (minimum moves = elements outside LIS).
 * Ties of equal length prefer keeping elements that stayed at their original index (`arr[i] === i`),
 * so an unmoved cut is never reported as "moved to its own position".
 */
function longestIncreasingSet(arr: readonly number[]): Set<number> {
  const n = arr.length;
  if (n === 0) return new Set();
  const dpLen = new Array<number>(n).fill(1);
  const dpSame: number[] = arr.map((v, i) => (v === i ? 1 : 0));
  const prev = new Array<number>(n).fill(-1);
  let bestIdx = 0;
  for (let i = 0; i < n; i += 1) {
    const selfSame = arr[i] === i ? 1 : 0;
    for (let j = 0; j < i; j += 1) {
      if (arr[j]! < arr[i]!) {
        const candLen = dpLen[j]! + 1;
        const candSame = dpSame[j]! + selfSame;
        if (candLen > dpLen[i]! || (candLen === dpLen[i]! && candSame > dpSame[i]!)) {
          dpLen[i] = candLen;
          dpSame[i] = candSame;
          prev[i] = j;
        }
      }
    }
    if (dpLen[i]! > dpLen[bestIdx]! || (dpLen[i]! === dpLen[bestIdx]! && dpSame[i]! > dpSame[bestIdx]!)) {
      bestIdx = i;
    }
  }
  const keep = new Set<number>();
  for (let k = bestIdx; k !== -1; k = prev[k]!) {
    keep.add(k);
  }
  return keep;
}

/**
 * Produces human-readable change lines from the ACTUAL diff between `before` and `after`.
 */
export function diffFrameSequences(
  before: FrameSequence,
  after: FrameSequence,
  copy: StudioEditorCopy,
  chatCopy: StudioEditorChatCopy,
  inherit?: readonly AssistInheritPair[],
): string[] {
  const lines: string[] = [];
  const fps = before.fps > 0 ? before.fps : 30;
  const fmt = (frames: number) => formatFrameLength(frames, fps);

  if (before.aspect !== after.aspect) {
    lines.push(
      fill(copy.assist.lines.aspect, {
        aspect: copy.aspectNames[ASPECT_COPY_KEYS[after.aspect]],
      }),
    );
  }

  const rootOf = buildRootOwnerResolver(before, inherit);
  const beforeById = new Map(before.clips.map((clip, i) => [clip.id, { clip, index: i }]));
  const afterById = new Map(after.clips.map((clip, i) => [clip.id, { clip, index: i }]));

  // Group all surviving after-cuts by their original root cut.
  const piecesByRoot = new Map<string, Array<{ clip: FrameClip; afterIndex: number }>>();
  for (const orig of before.clips) {
    piecesByRoot.set(orig.id, []);
  }
  after.clips.forEach((clip, afterIndex) => {
    const root = rootOf(clip.id);
    if (root && piecesByRoot.has(root)) {
      piecesByRoot.get(root)!.push({ clip, afterIndex });
    }
  });

  // Report per original cut: removal, split / middle cut-out / split+trim, or trim.
  let lengthChangedRoots = 0;
  for (const [id, info] of beforeById) {
    const pieces = piecesByRoot.get(id) ?? [];
    const n = info.index + 1;
    if (pieces.length === 0) {
      lines.push(fill(chatCopy.diffClipRemoved, { n }));
      continue;
    }
    const keptFrames = pieces.reduce((sum, p) => sum + p.clip.frames, 0);
    const removedFrames = Math.max(0, info.clip.frames - keptFrames);
    if (pieces.length >= 2) {
      if (removedFrames === 0 && pieces.length === 2) {
        lines.push(
          fill(chatCopy.diffClipSplit, {
            n,
            at: fmt(pieces[0]!.clip.frames),
          }),
        );
      } else if (removedFrames > 0) {
        lengthChangedRoots += 1;
        lines.push(
          fill(chatCopy.diffClipSplitTrimmed, {
            n,
            pieces: pieces.length,
            removed: fmt(removedFrames),
            kept: fmt(keptFrames),
          }),
        );
      } else {
        lines.push(
          fill(chatCopy.diffClipSplitPieces, {
            n,
            pieces: pieces.length,
            kept: fmt(keptFrames),
          }),
        );
      }
    } else if (keptFrames !== info.clip.frames) {
      lengthChangedRoots += 1;
      lines.push(
        fill(chatCopy.diffClipTrimmed, {
          n,
          before: fmt(info.clip.frames),
          after: fmt(keptFrames),
        }),
      );
    }
  }

  // Detect EVERY reorder among surviving original cuts (minimum move set via LIS, never `break` after first).
  const survivingBefore = before.clips.filter((c) => (piecesByRoot.get(c.id)?.length ?? 0) > 0).map((c) => c.id);
  const seenAfterRoots = new Set<string>();
  const survivingAfter: Array<{ rootId: string; firstAfterIndex: number }> = [];
  after.clips.forEach((clip, afterIndex) => {
    const root = rootOf(clip.id);
    if (root && !seenAfterRoots.has(root) && beforeById.has(root)) {
      seenAfterRoots.add(root);
      survivingAfter.push({ rootId: root, firstAfterIndex: afterIndex });
    }
  });
  if (survivingBefore.length === survivingAfter.length && survivingBefore.length > 1) {
    const beforeRank = new Map(survivingBefore.map((id, rank) => [id, rank]));
    const ranks = survivingAfter.map((item) => beforeRank.get(item.rootId)!);
    const stationary = longestIncreasingSet(ranks);
    if (stationary.size < ranks.length) {
      survivingAfter.forEach((item, pos) => {
        if (stationary.has(pos)) return;
        const origIdx = beforeById.get(item.rootId)!.index;
        lines.push(fill(chatCopy.diffClipMoved, { n: origIdx + 1, to: item.firstAfterIndex + 1 }));
      });
    }
  }

  // Detect sound changes across surviving original cuts.
  const soundChanges: Array<{ n: number; muted: boolean; volumePct: number; wasMuted: boolean; wasVolPct: number }> = [];
  for (const [id, info] of beforeById) {
    const afterInfo = afterById.get(id);
    if (!afterInfo) continue;
    const prevMuted = info.clip.muted;
    const nextMuted = afterInfo.clip.muted;
    const prevPct = Math.round(info.clip.volume * 100);
    const nextPct = Math.round(afterInfo.clip.volume * 100);
    if (prevMuted !== nextMuted || prevPct !== nextPct) {
      soundChanges.push({ n: info.index + 1, muted: nextMuted, volumePct: nextPct, wasMuted: prevMuted, wasVolPct: prevPct });
    }
  }
  if (soundChanges.length > 0) {
    const survivingDirect = before.clips.filter((c) => afterById.has(c.id)).length;
    const allSameMute =
      survivingDirect > 1 &&
      soundChanges.length === survivingDirect &&
      soundChanges.every((s) => s.muted === soundChanges[0]!.muted && s.volumePct === soundChanges[0]!.volumePct);
    if (allSameMute) {
      const first = soundChanges[0]!;
      if (first.muted) lines.push(chatCopy.diffAllMuted);
      else if (soundChanges.some((s) => s.wasVolPct !== s.volumePct)) {
        lines.push(fill(chatCopy.diffAllVolume, { pct: first.volumePct }));
      } else {
        lines.push(chatCopy.diffAllUnmuted);
      }
    } else {
      for (const s of soundChanges) {
        if (s.muted) lines.push(fill(chatCopy.diffClipMuted, { n: s.n }));
        else if (s.wasVolPct !== s.volumePct && s.volumePct !== 100) {
          lines.push(fill(chatCopy.diffClipVolume, { n: s.n, pct: s.volumePct }));
        } else if (s.wasMuted && !s.muted) {
          lines.push(fill(chatCopy.diffClipUnmuted, { n: s.n }));
        } else {
          lines.push(fill(chatCopy.diffClipVolume, { n: s.n, pct: s.volumePct }));
        }
      }
    }
  }

  // Add total length line whenever multiple cuts changed length (fit_total / even_pace / multi-trim).
  const beforeTotal = totalFrames(before);
  const afterTotal = totalFrames(after);
  if (lengthChangedRoots >= 2 && beforeTotal !== afterTotal) {
    lines.push(
      fill(chatCopy.diffTotal, {
        before: fmt(beforeTotal),
        after: fmt(afterTotal),
      }),
    );
  }

  return lines;
}

export function formatAskQuestion(about: AskAbout, chatCopy: StudioEditorChatCopy): string {
  switch (about) {
    case 'which_clip':
      return chatCopy.askWhichClip;
    case 'which_caption':
      return chatCopy.askWhichCaption;
    case 'how_long':
      return chatCopy.askHowLong;
    case 'where_caption':
      return chatCopy.askWhereCaption;
  }
}

export function formatAskChoices(
  choices: readonly AskChoice[],
  sequence: FrameSequence,
  chatCopy: StudioEditorChatCopy,
): Array<{ value: AskChoice; key: string; label: string }> {
  const out: Array<{ value: AskChoice; key: string; label: string }> = [];
  for (const choice of choices) {
    if (choice === 'all') {
      out.push({ value: choice, key: 'all', label: chatCopy.askChoiceAll });
    } else if (choice === 'start') {
      out.push({ value: choice, key: 'start', label: chatCopy.askChoiceStart });
    } else if (choice === 'end') {
      out.push({ value: choice, key: 'end', label: chatCopy.askChoiceEnd });
    } else if (choice === 'whole') {
      out.push({ value: choice, key: 'whole', label: chatCopy.askChoiceWhole });
    } else if (typeof choice === 'number') {
      out.push({
        value: choice,
        key: `sec:${choice}`,
        label: fill(chatCopy.askChoiceSeconds, { n: formatDiffSeconds(choice) }),
      });
    } else if ('clipId' in choice) {
      const idx = sequence.clips.findIndex((c) => c.id === choice.clipId);
      if (idx >= 0) {
        out.push({
          value: choice,
          key: `clip:${choice.clipId}`,
          label: fill(chatCopy.askChoiceClip, { n: idx + 1 }),
        });
      }
    }
  }
  return out;
}

export function mapFailureNoteText(reason: AssistMapFailureReason, chatCopy: StudioEditorChatCopy): string {
  switch (reason) {
    case 'stale':
      return chatCopy.noteStale;
    case 'no_change':
      return chatCopy.noteNoChange;
    case 'target_missing':
      return chatCopy.noteTargetMissing;
    case 'too_short':
      return chatCopy.noteTooShort;
    case 'not_possible':
    case 'clip_limit':
      return chatCopy.noteNotPossible;
    case 'unsupported_color':
      return chatCopy.noteUnsupportedColor;
    case 'unsupported_music':
      return chatCopy.noteUnsupportedMusic;
    case 'unsupported_captions':
      return chatCopy.noteUnsupportedCaptions;
    case 'unsupported_scene_split':
      return chatCopy.noteUnsupportedSceneSplit;
    case 'unmapped_step':
      return chatCopy.noteUnmapped;
  }
}
