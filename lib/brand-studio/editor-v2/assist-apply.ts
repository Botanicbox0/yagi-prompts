/**
 * Editing studio v2 — frame-exact mapper from `assist.plan` steps and rule patches onto `FrameSequence`
 * (slice E-C, Batch 2).
 *
 * Pure and client-safe.
 * - Maps seconds to integer frames with `Math.round(sec * fps)` on the film's grid.
 * - Atomic: any unsupported V1 workspace step (`look`, `sound(music)`, `caption_*`, `split_clip_cuts`)
 *   or invalid/missing target refuses the ENTIRE plan with an honest reason code, never a partial apply.
 * - Speed curves: accepts whatever `trimClipEdge` can apply on a curved cut (refusing only when
 *   nothing applied at all), so proposal/applied cards describe the actual diff.
 * - Split IDs: second piece id uses `${clip.id.slice(0, 60)}-b` (with `-b2`, … collision fallback)
 *   matching `lib/brand-studio/edit-assist/apply.ts:304-306`, tracked in `splits` for later `{ splitOf, part }`.
 * - Rule-path `patches`: mapped ONLY when `current === base` (strict index safety).
 */
import {
  MAX_COMPOSE_CLIPS,
  MIN_CLIP_PLAY_SEC,
  clamp,
  roundTenths,
  type TimelinePatch,
} from '@/lib/brand-studio/compose/timeline';
import { FIT_TOTAL_FLOOR_SEC, type ClipTarget, type ResolvedStep } from '@/lib/brand-studio/edit-assist/apply';
import {
  moveClip,
  removeClips,
  setAspect,
  setClipAudio,
  spansOf,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  wholeFrameViolations,
  type FrameSequence,
} from './frames';
import { reconcileLinkedOverlays } from './tracks';

/** Half a tenth of a second: matches `EDGE_SEC` in `lib/brand-studio/edit-assist/apply.ts:82`. */
const EDGE_SEC = 0.05;

export type AssistMapFailureReason =
  | 'stale'
  | 'no_change'
  | 'target_missing'
  | 'too_short'
  | 'not_possible'
  | 'clip_limit'
  | 'unsupported_color'
  | 'unsupported_music'
  | 'unsupported_captions'
  | 'unsupported_scene_split'
  | 'unmapped_step';

export type AssistInheritPair = readonly [string, string];

export type AssistMapResult =
  | {
      ok: true;
      sequence: FrameSequence;
      inherit: AssistInheritPair[];
      movedClipIds?: string[];
      /** W5: true ONLY when the plan included a total-length step (`fit_total` / `even_pace`). */
      affectsFilmLength?: boolean;
    }
  | { ok: false; reason: AssistMapFailureReason; sequence: FrameSequence };

interface FrameApplyState {
  sequence: FrameSequence;
  /** Pieces of every cut split so far in this plan, keyed by original cut id. */
  splits: ReadonlyMap<string, { a: string; b: string }>;
  /** Ordered `[newPieceId, parentId]` pairs for `use-editor`'s `remember()` so splits inherit parent metadata/lineage. */
  inherit: AssistInheritPair[];
  /** Root clip IDs explicitly moved by a `move` step (W11). */
  movedClipIds: string[];
}

type FrameStepOutcome =
  | { ok: true; state: FrameApplyState }
  | { ok: false; reason: AssistMapFailureReason };

const okState = (state: FrameApplyState): FrameStepOutcome => ({ ok: true, state });
const failStep = (reason: AssistMapFailureReason): FrameStepOutcome => ({ ok: false, reason });

export function secToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

function freshId(make: (n: number) => string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const id = make(n);
    if (!taken.has(id)) return id;
  }
}

function stableSplitPieceBId(clipId: string, sequence: FrameSequence): string {
  const taken = new Set(sequence.clips.map((c) => c.id));
  const stem = `${clipId.slice(0, 60)}-b`;
  return freshId((n) => (n === 1 ? stem : `${stem}${n}`), taken);
}

function clipIndexOf(state: FrameApplyState, target: ClipTarget): number {
  const id = 'clipId' in target ? target.clipId : state.splits.get(target.splitOf)?.[target.part];
  return id ? state.sequence.clips.findIndex((c) => c.id === id) : -1;
}

function sameSequence(a: FrameSequence, b: FrameSequence): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Integer largest-remainder proportional allocator (mirrors `edit-assist/apply.ts:466-499`, in integer frames). */
function proportionalFrameCuts(lengths: readonly number[], caps: readonly number[], need: number): number[] {
  const cuts = lengths.map(() => 0);
  let active = lengths.map((_, i) => i).filter((i) => caps[i]! > 0);
  let remaining = need;
  for (;;) {
    const sum = active.reduce((total, i) => total + lengths[i]!, 0);
    if (sum === 0 || remaining === 0) return cuts;
    const capped = active.filter((i) => remaining * lengths[i]! >= caps[i]! * sum);
    if (capped.length === 0) {
      const shares = active.map((i) => {
        const num = remaining * lengths[i]!;
        const whole = Math.floor(num / sum);
        return { i, whole, rest: num - whole * sum };
      });
      let leftover = remaining - shares.reduce((total, s) => total + s.whole, 0);
      for (const share of shares) cuts[share.i] = share.whole;
      shares
        .filter((s) => s.rest > 0)
        .sort((x, y) => y.rest - x.rest || lengths[y.i]! - lengths[x.i]! || x.i - y.i)
        .forEach((share) => {
          if (leftover > 0) {
            cuts[share.i]! += 1;
            leftover -= 1;
          }
        });
      return cuts;
    }
    for (const i of capped) {
      cuts[i] = caps[i]!;
      remaining -= caps[i]!;
    }
    active = active.filter((i) => !capped.includes(i));
  }
}

function trimStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'trim' }>): FrameStepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return failStep('target_missing');
  const seq = state.sequence;
  const clip = seq.clips[index]!;
  const fps = seq.fps;
  const playSec = clip.frames / fps;

  let range: [number, number] | null = null;
  if (step.keep === 'range') {
    if (step.from !== undefined && step.to !== undefined) range = [step.from, step.to];
  } else if (step.seconds !== undefined) {
    const s = step.seconds;
    range =
      step.keep === 'start'
        ? [0, s]
        : step.keep === 'end'
          ? [playSec - s, playSec]
          : [(playSec - s) / 2, (playSec + s) / 2];
  }
  if (!range || !(range[0] < range[1])) return failStep('unmapped_step');
  if (range[0] < -EDGE_SEC || range[1] > playSec + EDGE_SEC) return failStep('not_possible');

  const fromSec = Math.max(0, range[0]);
  const toSec = Math.min(playSec, range[1]);
  const startDrop = Math.max(0, Math.min(clip.frames - 1, secToFrames(fromSec, fps)));
  const endFrame = Math.max(startDrop + 1, Math.min(clip.frames, secToFrames(toSec, fps)));

  if (startDrop === 0 && endFrame === clip.frames) return okState(state);

  let working = seq;
  let totalApplied = 0;
  let actualStart = 0;
  if (startDrop !== 0) {
    const res = trimClipEdge(working, index, 'start', startDrop);
    working = res.seq;
    actualStart = Math.abs(res.applied);
    totalApplied += actualStart;
  }
  // Recompute the end edit from the post-start-trim clip so curved cuts never use stale pre-start frames.
  const clipAfterStart = working.clips[index]!;
  const desiredFramesAfterStart = Math.max(1, endFrame - actualStart);
  const endDelta = endFrame < clip.frames ? desiredFramesAfterStart - clipAfterStart.frames : 0;
  if (endDelta !== 0) {
    const res = trimClipEdge(working, index, 'end', endDelta);
    working = res.seq;
    totalApplied += Math.abs(res.applied);
  }
  if (totalApplied === 0) return failStep('too_short');
  return okState({ ...state, sequence: working });
}

function splitStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'split' }>): FrameStepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return failStep('target_missing');
  const seq = state.sequence;
  if (seq.clips.length >= MAX_COMPOSE_CLIPS) return failStep('clip_limit');
  const clip = seq.clips[index]!;
  const playSec = clip.frames / seq.fps;
  if (!(step.at > EDGE_SEC && step.at < playSec - EDGE_SEC)) return failStep('not_possible');

  const offset = secToFrames(step.at, seq.fps);
  if (offset < 1 || offset >= clip.frames) return failStep('too_short');
  const span = spansOf(seq)[index]!;
  const pieceB = stableSplitPieceBId(clip.id, seq);
  const next = splitAtFrame(seq, span.start + offset, pieceB);
  if (next === seq) return failStep('too_short');
  const splits = new Map(state.splits);
  splits.set(clip.id, { a: clip.id, b: pieceB });
  return okState({ sequence: next, splits, inherit: [...state.inherit, [pieceB, clip.id]], movedClipIds: state.movedClipIds });
}

function removeStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'remove' }>): FrameStepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return failStep('target_missing');
  if (state.sequence.clips.length <= 1) return failStep('not_possible');
  const id = state.sequence.clips[index]!.id;
  const next = removeClips(state.sequence, [id]);
  if (next === state.sequence) return failStep('not_possible');
  return okState({ ...state, sequence: next });
}

function moveStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'move' }>): FrameStepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return failStep('target_missing');
  const count = state.sequence.clips.length;
  let toIndex: number;
  if (step.to === 'first') toIndex = 0;
  else if (step.to === 'last') toIndex = count - 1;
  else {
    const anchor = clipIndexOf(state, 'before' in step.to ? step.to.before : step.to.after);
    if (anchor < 0) return failStep('target_missing');
    if (anchor === index) return failStep('unmapped_step');
    const anchorWithout = anchor > index ? anchor - 1 : anchor;
    toIndex = 'before' in step.to ? anchorWithout : anchorWithout + 1;
  }
  if (toIndex === index) return okState(state);
  const movedId = state.sequence.clips[index]!.id;
  const movedClipIds = state.movedClipIds.includes(movedId) ? state.movedClipIds : [...state.movedClipIds, movedId];
  return okState({ ...state, sequence: moveClip(state.sequence, index, toIndex), movedClipIds });
}

function soundStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'sound' }>): FrameStepOutcome {
  if (step.target === 'music') return failStep('unsupported_music');
  const seq = state.sequence;
  let indices: number[];
  if (step.target === 'all_clips') {
    indices = seq.clips.map((_, i) => i);
  } else {
    const index = clipIndexOf(state, step.target);
    indices = index < 0 ? [] : [index];
  }
  if (indices.length === 0) return failStep('target_missing');

  let working = seq;
  for (const idx of indices) {
    const clip = working.clips[idx]!;
    const rawVol = step.volume !== undefined ? Math.round(Math.min(1, Math.max(0, step.volume)) * 100) / 100 : clip.volume;
    const nextMuted = step.muted ?? rawVol === 0;
    const nextVolume = !nextMuted && rawVol === 0 ? 0.5 : rawVol;
    working = setClipAudio(working, idx, nextVolume, nextMuted);
  }
  return okState({ ...state, sequence: working });
}

function fitTotalStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'fit_total' }>): FrameStepOutcome {
  const seq = state.sequence;
  if (seq.clips.length === 0) return failStep('target_missing');
  const protectedIds = new Set<string>();
  for (const target of step.protect ?? []) {
    const index = clipIndexOf(state, target);
    if (index < 0) return failStep('target_missing');
    protectedIds.add(seq.clips[index]!.id);
  }

  const fps = seq.fps;
  const total = totalFrames(seq);
  const targetFrames = Math.max(1, secToFrames(step.seconds, fps));
  const edgeFrames = Math.max(1, secToFrames(EDGE_SEC, fps));
  if (targetFrames > total + edgeFrames) return failStep('not_possible');
  const need = total - targetFrames;
  if (need <= 0) return okState(state);

  const floorFrames = Math.max(1, secToFrames(FIT_TOTAL_FLOOR_SEC, fps));
  const lengths = seq.clips.map((c) => c.frames);
  const floors = lengths.map((len) => Math.min(len, floorFrames));
  const caps = seq.clips.map((c, i) => (protectedIds.has(c.id) ? 0 : Math.max(0, lengths[i]! - floors[i]!)));
  if (need > caps.reduce((sum, cap) => sum + cap, 0)) return failStep('not_possible');

  const cuts = proportionalFrameCuts(lengths, caps, need);
  let working = seq;
  let carry = 0;
  let anyApplied = false;
  for (let i = 0; i < working.clips.length; i += 1) {
    const wantDrop = cuts[i]! + carry;
    if (wantDrop <= 0) continue;
    const clip = working.clips[i]!;
    const maxDrop = protectedIds.has(clip.id) ? 0 : Math.max(0, clip.frames - floors[i]!);
    const drop = Math.min(wantDrop, maxDrop);
    if (drop <= 0) {
      carry = wantDrop;
      continue;
    }
    const res = trimClipEdge(working, i, 'end', -drop);
    working = res.seq;
    const actualDrop = Math.abs(res.applied);
    if (actualDrop > 0) anyApplied = true;
    carry = Math.max(0, wantDrop - actualDrop);
  }
  // Second pass over earlier unprotected cuts when a later curved/short cut left carry frames behind.
  if (carry > 0) {
    for (let i = 0; i < working.clips.length && carry > 0; i += 1) {
      const clip = working.clips[i]!;
      if (protectedIds.has(clip.id)) continue;
      const maxDrop = Math.max(0, clip.frames - floors[i]!);
      const drop = Math.min(carry, maxDrop);
      if (drop <= 0) continue;
      const res = trimClipEdge(working, i, 'end', -drop);
      working = res.seq;
      const actualDrop = Math.abs(res.applied);
      if (actualDrop > 0) {
        anyApplied = true;
        carry = Math.max(0, carry - actualDrop);
      }
    }
  }
  if (!anyApplied) return failStep('not_possible');
  return okState({ ...state, sequence: working });
}

function evenPaceStep(state: FrameApplyState, step: Extract<ResolvedStep, { do: 'even_pace' }>): FrameStepOutcome {
  const seq = state.sequence;
  if (seq.clips.length === 0) return failStep('target_missing');
  const fps = seq.fps;
  const capFrames = Math.max(1, secToFrames(step.secondsPerClip, fps));
  const edgeFrames = Math.max(1, secToFrames(EDGE_SEC, fps));
  let working = seq;
  let anyChanged = false;
  for (let i = 0; i < working.clips.length; i += 1) {
    const clip = working.clips[i]!;
    if (clip.frames <= capFrames + edgeFrames) continue;
    const res = trimClipEdge(working, i, 'end', capFrames - clip.frames);
    working = res.seq;
    if (res.applied !== 0) anyChanged = true;
  }
  if (!anyChanged) return failStep('no_change');
  return okState({ ...state, sequence: working });
}

function applyOneStep(state: FrameApplyState, step: ResolvedStep): FrameStepOutcome {
  switch (step.do) {
    case 'trim':
      return trimStep(state, step);
    case 'split':
      return splitStep(state, step);
    case 'remove':
      return removeStep(state, step);
    case 'move':
      return moveStep(state, step);
    case 'sound':
      return soundStep(state, step);
    case 'aspect':
      return okState({ ...state, sequence: setAspect(state.sequence, step.aspect) });
    case 'fit_total':
      return fitTotalStep(state, step);
    case 'even_pace':
      return evenPaceStep(state, step);
    case 'look':
      return failStep('unsupported_color');
    case 'caption_add':
    case 'caption_edit':
    case 'caption_remove':
      return failStep('unsupported_captions');
    default:
      return failStep('unmapped_step');
  }
}

function hasFrameViolations(next: FrameSequence, inputFps: number): boolean {
  const violations = wholeFrameViolations(next);
  if (violations.length === 0) return false;
  if (Number.isFinite(inputFps) && inputFps > 0 && !Number.isInteger(inputFps)) {
    return violations.some((v) => !v.startsWith('fps '));
  }
  return true;
}

export interface AssistApplyOptions {
  /** Whether linked overlays follow main-track edits (B2; defaults to `false`). */
  linkage?: boolean;
}

/**
 * Applies `assist.plan` resolved steps atomically on `sequence`.
 * Any unsupported step or failed constraint returns `{ ok: false, reason, sequence }` unchanged.
 * B1: returns the UNADJUSTED `sequence` so `withSequence` is the single place that reconciles linked overlays
 * (avoiding double-adjustment between preview and apply); reconciliation runs here only to validate constraints.
 */
export function applyResolvedStepsToSequence(
  sequence: FrameSequence,
  steps: readonly ResolvedStep[],
  options: AssistApplyOptions = {},
): AssistMapResult {
  if (steps.length === 0) return { ok: false, reason: 'no_change', sequence };
  let state: FrameApplyState = { sequence, splits: new Map(), inherit: [], movedClipIds: [] };
  for (const step of steps) {
    const outcome = applyOneStep(state, step);
    if (!outcome.ok) return { ok: false, reason: outcome.reason, sequence };
    state = outcome.state;
  }
  const linkageOn = options.linkage ?? false;
  const reconciled = reconcileLinkedOverlays(sequence, state.sequence, linkageOn, state.inherit).sequence;
  if (hasFrameViolations(reconciled, sequence.fps)) {
    return { ok: false, reason: 'unmapped_step', sequence };
  }
  if (sameSequence(reconciled, sequence)) {
    return { ok: false, reason: 'no_change', sequence };
  }
  const affectsFilmLength = steps.some((step) => step.do === 'fit_total' || step.do === 'even_pace');
  return {
    ok: true,
    sequence: state.sequence,
    inherit: state.inherit,
    ...(state.movedClipIds.length > 0 ? { movedClipIds: state.movedClipIds } : {}),
    ...(affectsFilmLength ? { affectsFilmLength: true } : {}),
  };
}

/**
 * Maps rule-path index-addressed `TimelinePatch[]` onto `sequence` ONLY if `sequence === baseSequence`.
 * Any unsupported workspace patch (`split_clip_cuts`, color, music, captions) refuses the whole batch.
 */
export function applyRulePatchesToSequence(
  sequence: FrameSequence,
  patches: readonly TimelinePatch[],
  baseSequence: FrameSequence,
  options: AssistApplyOptions = {},
): AssistMapResult {
  if (sequence !== baseSequence) {
    return { ok: false, reason: 'stale', sequence };
  }
  if (patches.length === 0) {
    return { ok: false, reason: 'no_change', sequence };
  }
  let working = sequence;
  const inherit: AssistInheritPair[] = [];
  const movedClipIds: string[] = [];
  for (const patch of patches) {
    switch (patch.op) {
      case 'set_aspect':
        working = setAspect(working, patch.aspect);
        break;
      case 'trim_clip': {
        const clip = working.clips[patch.clipIndex];
        if (!clip) return { ok: false, reason: 'target_missing', sequence };
        const fps = working.fps;
        const playSec = clip.frames / fps;
        // Mirror `lib/brand-studio/compose/timeline.ts:869-877` using the server's imported
        // `MIN_CLIP_PLAY_SEC` (0.3 s), `roundTenths`, and `clamp` directly (B2).
        const minPlaySec = Math.min(playSec, MIN_CLIP_PLAY_SEC);
        let fromSec = patch.trimStartSec !== undefined ? clamp(patch.trimStartSec, 0, playSec) : 0;
        let toSec = patch.trimEndSec !== undefined ? clamp(patch.trimEndSec, 0, playSec) : playSec;
        if (patch.targetDurationSec !== undefined) {
          const desired = clamp(roundTenths(patch.targetDurationSec), minPlaySec, playSec);
          toSec = clamp(roundTenths(fromSec + desired), roundTenths(fromSec + minPlaySec), playSec);
          if (roundTenths(toSec - fromSec) < desired) {
            fromSec = clamp(roundTenths(toSec - desired), 0, Math.max(0, roundTenths(playSec - minPlaySec)));
          }
        }
        if (fromSec >= toSec) return { ok: false, reason: 'too_short', sequence };
        const startDrop = Math.max(0, Math.min(clip.frames - 1, secToFrames(fromSec, fps)));
        const endFrame = Math.max(startDrop + 1, Math.min(clip.frames, secToFrames(toSec, fps)));
        let applied = 0;
        let actualStart = 0;
        if (startDrop !== 0) {
          const res = trimClipEdge(working, patch.clipIndex, 'start', startDrop);
          working = res.seq;
          actualStart = Math.abs(res.applied);
          applied += actualStart;
        }
        const clipAfterStart = working.clips[patch.clipIndex]!;
        const desiredFramesAfterStart = Math.max(1, endFrame - actualStart);
        const endDelta = endFrame < clip.frames ? desiredFramesAfterStart - clipAfterStart.frames : 0;
        if (endDelta !== 0) {
          const res = trimClipEdge(working, patch.clipIndex, 'end', endDelta);
          working = res.seq;
          applied += Math.abs(res.applied);
        }
        if ((startDrop !== 0 || endFrame < clip.frames) && applied === 0) {
          return { ok: false, reason: 'too_short', sequence };
        }
        break;
      }
      case 'split_clip_at': {
        const clip = working.clips[patch.clipIndex];
        if (!clip) return { ok: false, reason: 'target_missing', sequence };
        if (working.clips.length >= MAX_COMPOSE_CLIPS) return { ok: false, reason: 'clip_limit', sequence };
        const offset = secToFrames(patch.atMediaSec, working.fps);
        if (offset < 1 || offset >= clip.frames) return { ok: false, reason: 'too_short', sequence };
        const span = spansOf(working)[patch.clipIndex]!;
        const pieceB = stableSplitPieceBId(clip.id, working);
        const next = splitAtFrame(working, span.start + offset, pieceB);
        if (next === working) return { ok: false, reason: 'too_short', sequence };
        inherit.push([pieceB, clip.id]);
        working = next;
        break;
      }
      case 'remove_clip': {
        const clip = working.clips[patch.clipIndex];
        if (!clip) return { ok: false, reason: 'target_missing', sequence };
        if (working.clips.length <= 1) return { ok: false, reason: 'not_possible', sequence };
        working = removeClips(working, [clip.id]);
        break;
      }
      case 'move_clip': {
        if (patch.fromIndex < 0 || patch.fromIndex >= working.clips.length) {
          return { ok: false, reason: 'target_missing', sequence };
        }
        const movedId = working.clips[patch.fromIndex]!.id;
        if (patch.fromIndex !== patch.toIndex && !movedClipIds.includes(movedId)) {
          movedClipIds.push(movedId);
        }
        working = moveClip(working, patch.fromIndex, patch.toIndex);
        break;
      }
      case 'swap_clips': {
        if (
          patch.indexA < 0 ||
          patch.indexA >= working.clips.length ||
          patch.indexB < 0 ||
          patch.indexB >= working.clips.length
        ) {
          return { ok: false, reason: 'target_missing', sequence };
        }
        if (patch.indexA !== patch.indexB) {
          const clips = [...working.clips];
          const tmp = clips[patch.indexA]!;
          clips[patch.indexA] = clips[patch.indexB]!;
          clips[patch.indexB] = tmp;
          working = { ...working, clips };
        }
        break;
      }
      case 'set_clip_audio': {
        const targets =
          patch.clipIndex === 'all'
            ? working.clips.map((_, i) => i)
            : patch.clipIndex >= 0 && patch.clipIndex < working.clips.length
              ? [patch.clipIndex]
              : [];
        if (targets.length === 0) return { ok: false, reason: 'target_missing', sequence };
        for (const idx of targets) {
          const clip = working.clips[idx]!;
          const rawVol = patch.volume !== undefined ? Math.round(Math.min(1, Math.max(0, patch.volume)) * 100) / 100 : clip.volume;
          const nextMuted = patch.muted ?? rawVol === 0;
          const nextVolume = !nextMuted && rawVol === 0 ? 0.5 : rawVol;
          working = setClipAudio(working, idx, nextVolume, nextMuted);
        }
        break;
      }
      case 'split_clip_cuts':
      case 'set_clip_cuts':
        return { ok: false, reason: 'unsupported_scene_split', sequence };
      case 'set_color_grade':
        return { ok: false, reason: 'unsupported_color', sequence };
      case 'set_bgm_volume':
      case 'remove_bgm':
      case 'add_sfx':
      case 'remove_sfx':
      case 'set_sfx_volume':
        return { ok: false, reason: 'unsupported_music', sequence };
      case 'add_caption':
      case 'update_caption':
      case 'remove_caption':
        return { ok: false, reason: 'unsupported_captions', sequence };
      case 'set_clip_speed':
      case 'slip_clip':
      case 'set_clip_audio_offset':
      case 'set_clip_transition':
      case 'add_overlay':
      case 'remove_overlay':
      default:
        return { ok: false, reason: 'unmapped_step', sequence };
    }
  }
  const linkageOn = options.linkage ?? false;
  const reconciled = reconcileLinkedOverlays(sequence, working, linkageOn, inherit).sequence;
  if (hasFrameViolations(reconciled, sequence.fps)) {
    return { ok: false, reason: 'unmapped_step', sequence };
  }
  if (sameSequence(reconciled, sequence)) {
    return { ok: false, reason: 'no_change', sequence };
  }
  return {
    ok: true,
    sequence: working,
    inherit,
    ...(movedClipIds.length > 0 ? { movedClipIds } : {}),
  };
}
