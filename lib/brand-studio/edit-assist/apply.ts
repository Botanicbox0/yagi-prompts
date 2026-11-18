/**
 * Runs a "말로 편집" plan on a timeline (docs/BRAND-EDITING-STUDIO.md §4.3, §4.6).
 *
 * Pure and client-safe. The server dry-runs a plan with it; the screen runs the same steps on ITS current
 * timeline to draw the draft, so whatever the user changed by hand after sending the instruction is kept
 * (the server never sends a whole timeline back).
 *
 * - Ids, not positions. A model plan names cuts by refs (`c2`); `resolveEditPlan` swaps them for clip
 *   ids, and every step looks its cut up by id at the moment it runs. Removing or moving a cut in step 1
 *   therefore cannot shift the target of step 2 — the bug index-based patches have.
 * - Reuse. Each step becomes the existing, tested `applyTimelinePatches` operations with the index valid
 *   at that moment; trimming, splitting and caption placement are not reimplemented here.
 * - All or nothing. One failing step returns the ORIGINAL project and every problem found: a draft is
 *   either what was asked or nothing, never half of it.
 * - Deterministic. Ids `applyTimelinePatches` draws at random (split pieces, new captions) are replaced
 *   with stable ones, so the same plan on the same timeline gives the same result everywhere.
 */
import {
  applyTimelinePatches,
  clamp,
  clipPlayDuration,
  MAX_COMPOSE_CAPTIONS,
  MAX_COMPOSE_CLIPS,
  MIN_CLIP_PLAY_SEC,
  projectDurationSec,
  roundHundredths,
  roundTenths,
  timelineSpans,
  type ComposeClip,
  type ComposerProject,
  type TimelinePatch,
} from '../compose/timeline';
import { sameValue, type DeltaSubject } from './diff';
import {
  CAPTION_PLACES,
  CAPTION_REF_PATTERN,
  CLIP_REF_PATTERN,
  SPLIT_PIECE_REF_PATTERN,
  type AskAbout,
  type AskChoice,
  type CaptionPlace,
  type EditRefs,
  type EditStep,
  type EditStepOf,
} from './plan';

/** A cut by id, or a piece of a cut that an earlier step of the same plan split (`c2a` / `c2b`). */
export type ClipTarget = { clipId: string } | { splitOf: string; part: 'a' | 'b' };
export type CaptionTarget = { captionId: string };

/** A plan step with ids instead of refs: what `assist.plan` returns and the screen applies. */
export type ResolvedStep = EditStepOf<ClipTarget, CaptionTarget>;

export const STEP_PROBLEM_CODES = [
  'unknown_ref',
  'target_missing',
  'no_music',
  'range_outside_cut',
  'outside_timeline',
  'too_short',
  'clip_limit',
  'caption_limit',
  'invalid_step',
  'not_applied',
  'not_possible',
  'no_change',
] as const;
export type StepProblemCode = (typeof STEP_PROBLEM_CODES)[number];

/** `step` is the 0-based step index, or null for the plan as a whole (`no_change`). Codes, never prose. */
export interface StepProblem {
  step: number | null;
  code: StepProblemCode;
  ref?: string;
}

/** `fit_total` never shortens a cut below this, unless the cut is already shorter (then it is left alone). */
export const FIT_TOTAL_FLOOR_SEC = 1;
/** Music volume when "unmute the music" finds it at 0 (the timeline keeps no earlier volume). */
export const MUSIC_UNMUTE_VOLUME = 0.4;
/** Half a tenth: the context shows seconds rounded to tenths, so a request may sit this far past an edge. */
const EDGE_SEC = 0.05;

/* ------------------------------------------------------------- resolve */

function own(record: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function clipTargetOf(ref: string, refs: EditRefs): ClipTarget | null {
  if (CLIP_REF_PATTERN.test(ref)) {
    const clipId = own(refs.clips, ref);
    return clipId ? { clipId } : null;
  }
  if (SPLIT_PIECE_REF_PATTERN.test(ref)) {
    const splitOf = own(refs.clips, ref.slice(0, -1));
    return splitOf ? { splitOf, part: ref.endsWith('a') ? 'a' : 'b' } : null;
  }
  return null;
}

function resolveStep(
  step: EditStep,
  clip: (ref: string) => ClipTarget,
  caption: (ref: string) => CaptionTarget,
): ResolvedStep {
  switch (step.do) {
    case 'trim':
    case 'split':
    case 'remove':
      return { ...step, clip: clip(step.clip) };
    case 'move':
      return {
        ...step,
        clip: clip(step.clip),
        to:
          typeof step.to === 'string'
            ? step.to
            : 'before' in step.to
              ? { before: clip(step.to.before) }
              : { after: clip(step.to.after) },
      };
    case 'sound':
      return { ...step, target: step.target === 'all_clips' || step.target === 'music' ? step.target : clip(step.target) };
    case 'caption_add':
      return {
        ...step,
        where:
          typeof step.where === 'string'
            ? step.where
            : 'clip' in step.where
              ? { clip: clip(step.where.clip) }
              : { from: step.where.from, to: step.where.to },
      };
    case 'caption_edit':
      return { ...step, caption: caption(step.caption) };
    case 'caption_remove':
      return { ...step, caption: step.caption === 'all' ? 'all' : caption(step.caption) };
    case 'fit_total':
      return {
        do: 'fit_total',
        seconds: step.seconds,
        ...(step.protect ? { protect: step.protect.map((ref) => clip(ref)) } : {}),
      };
    case 'aspect':
    case 'look':
    case 'even_pace':
      return { ...step };
  }
}

/** Swaps the refs of a validated model plan for ids. Every unknown ref is a problem (with its step). */
export function resolveEditPlan(
  steps: readonly EditStep[],
  refs: EditRefs,
): { ok: true; steps: ResolvedStep[] } | { ok: false; problems: StepProblem[] } {
  const problems: StepProblem[] = [];
  const resolved = steps.map((step, index) => {
    const clip = (ref: string): ClipTarget => {
      const target = clipTargetOf(ref, refs);
      if (target) return target;
      problems.push({ step: index, code: 'unknown_ref', ref });
      return { clipId: '' };
    };
    const caption = (ref: string): CaptionTarget => {
      const captionId = CAPTION_REF_PATTERN.test(ref) ? own(refs.captions, ref) : undefined;
      if (captionId) return { captionId };
      problems.push({ step: index, code: 'unknown_ref', ref });
      return { captionId: '' };
    };
    return resolveStep(step, clip, caption);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, steps: resolved };
}

/** Turns validated `ask` choices into the values the screen uses; null when a ref is unknown. */
export function resolveAskChoices(about: AskAbout, choices: readonly string[], refs: EditRefs): AskChoice[] | null {
  const out: AskChoice[] = [];
  for (const choice of choices) {
    if (about === 'which_clip') {
      if (choice === 'all') {
        out.push('all');
        continue;
      }
      const clipId = CLIP_REF_PATTERN.test(choice) ? own(refs.clips, choice) : undefined;
      if (!clipId) return null;
      out.push({ clipId });
    } else if (about === 'which_caption') {
      const captionId = CAPTION_REF_PATTERN.test(choice) ? own(refs.captions, choice) : undefined;
      if (!captionId) return null;
      out.push({ captionId });
    } else if (about === 'how_long') {
      const seconds = Number(choice);
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      out.push(seconds);
    } else {
      if (!(CAPTION_PLACES as readonly string[]).includes(choice)) return null;
      out.push(choice as CaptionPlace);
    }
  }
  return out;
}

/* --------------------------------------------------------------- apply */

interface ApplyState {
  project: ComposerProject;
  /** Pieces of every cut split so far in this plan, by the id of the cut that was split (latest split wins). */
  splits: ReadonlyMap<string, { a: string; b: string }>;
}

type StepOutcome = { ok: true; state: ApplyState } | { ok: false; code: StepProblemCode };

const fail = (code: StepProblemCode): StepOutcome => ({ ok: false, code });
const done = (state: ApplyState): StepOutcome => ({ ok: true, state });

function rateOf(clip: ComposeClip): number {
  return clip.playbackRate && Number.isFinite(clip.playbackRate) ? clamp(clip.playbackRate, 0.25, 4) : 1;
}

/** Exact played length (the context shows it rounded to tenths). */
function playedSec(clip: ComposeClip): number {
  return (clip.trimEndSec - clip.trimStartSec) / rateOf(clip);
}

function clipIndexOf(state: ApplyState, target: ClipTarget): number {
  const id = 'clipId' in target ? target.clipId : state.splits.get(target.splitOf)?.[target.part];
  return id ? state.project.clips.findIndex((clip) => clip.id === id) : -1;
}

/** Runs patches; null unless every one of them applied. */
function patched(state: ApplyState, patches: readonly TimelinePatch[]): ApplyState | null {
  const { project, appliedCount } = applyTimelinePatches(state.project, patches);
  return appliedCount === patches.length ? { ...state, project } : null;
}

/** For patches that always "apply": a timeline that came out the same means the step was already true. */
function settle(state: ApplyState, patches: readonly TimelinePatch[]): StepOutcome {
  const next = patched(state, patches);
  if (!next) return fail('not_applied');
  return done(sameValue(next.project, state.project) ? state : next);
}

function freshId(make: (n: number) => string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const id = make(n);
    if (!taken.has(id)) return id;
  }
}

/** Keeps played seconds `[from, to]` of the cut at `index` (the caller has checked the range). */
function keepPlayed(state: ApplyState, index: number, from: number, to: number): StepOutcome {
  const clip = state.project.clips[index]!;
  const rate = rateOf(clip);
  const start = roundTenths(clip.trimStartSec + from * rate);
  const end = Math.min(clip.trimEndSec, roundTenths(clip.trimStartSec + to * rate));
  if (start === clip.trimStartSec && end === clip.trimEndSec) return done(state);
  if (end - start < MIN_CLIP_PLAY_SEC - 1e-9) return fail('too_short');
  const next = patched(state, [{ op: 'trim_clip', clipIndex: index, trimStartSec: start, trimEndSec: end }]);
  const after = next?.project.clips[index];
  if (!next || !after || after.trimStartSec !== start || after.trimEndSec !== end) return fail('not_applied');
  return done(next);
}

function trimStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'trim' }>): StepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return fail('target_missing');
  const play = playedSec(state.project.clips[index]!);
  let range: [number, number] | null = null;
  if (step.keep === 'range') {
    if (step.from !== undefined && step.to !== undefined) range = [step.from, step.to];
  } else if (step.seconds !== undefined) {
    const s = step.seconds;
    range = step.keep === 'start' ? [0, s] : step.keep === 'end' ? [play - s, play] : [(play - s) / 2, (play + s) / 2];
  }
  if (!range || !(range[0] < range[1])) return fail('invalid_step');
  if (range[0] < -EDGE_SEC || range[1] > play + EDGE_SEC) return fail('range_outside_cut');
  const from = Math.max(0, range[0]);
  const to = Math.min(play, range[1]);
  if (to - from < MIN_CLIP_PLAY_SEC - 1e-9) return fail('too_short');
  return keepPlayed(state, index, from, to);
}

function splitStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'split' }>): StepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return fail('target_missing');
  const clip = state.project.clips[index]!;
  const play = playedSec(clip);
  if (!(step.at > EDGE_SEC && step.at < play - EDGE_SEC)) return fail('range_outside_cut');
  if (step.at < MIN_CLIP_PLAY_SEC || play - step.at < MIN_CLIP_PLAY_SEC) return fail('too_short');
  if (state.project.clips.length >= MAX_COMPOSE_CLIPS) return fail('clip_limit');
  const atMediaSec = roundTenths(clip.trimStartSec + step.at * rateOf(clip));
  if (
    atMediaSec < roundTenths(clip.trimStartSec + MIN_CLIP_PLAY_SEC) ||
    atMediaSec > roundTenths(clip.trimEndSec - MIN_CLIP_PLAY_SEC)
  ) {
    return fail('too_short');
  }
  const next = patched(state, [{ op: 'split_clip_at', clipIndex: index, atMediaSec }]);
  if (!next) return fail('not_applied');
  // `split_clip_at` keeps the id on the first piece and draws a random id for the second; give the
  // second a stable one (`<id>-b`, `<id>-b2`, …) so the draft and the dry run agree.
  const clips = [...next.project.clips];
  const taken = new Set(clips.map((c) => c.id));
  const stem = `${clip.id.slice(0, 60)}-b`;
  const pieceB = freshId((n) => (n === 1 ? stem : `${stem}${n}`), taken);
  clips[index + 1] = { ...clips[index + 1]!, id: pieceB };
  const splits = new Map(state.splits);
  splits.set(clip.id, { a: clip.id, b: pieceB });
  return done({ project: { ...next.project, clips }, splits });
}

function moveStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'move' }>): StepOutcome {
  const index = clipIndexOf(state, step.clip);
  if (index < 0) return fail('target_missing');
  const count = state.project.clips.length;
  let toIndex: number;
  if (step.to === 'first') toIndex = 0;
  else if (step.to === 'last') toIndex = count - 1;
  else {
    const anchor = clipIndexOf(state, 'before' in step.to ? step.to.before : step.to.after);
    if (anchor < 0) return fail('target_missing');
    if (anchor === index) return fail('invalid_step');
    // `move_clip` takes the index in the list without the moved cut.
    const anchorWithout = anchor > index ? anchor - 1 : anchor;
    toIndex = 'before' in step.to ? anchorWithout : anchorWithout + 1;
  }
  if (toIndex === index) return done(state);
  const next = patched(state, [{ op: 'move_clip', fromIndex: index, toIndex }]);
  return next ? done(next) : fail('not_applied');
}

function soundStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'sound' }>): StepOutcome {
  const volume = step.volume !== undefined ? roundHundredths(clamp(step.volume, 0, 1)) : undefined;
  if (step.target === 'music') {
    const bgm = state.project.bgm;
    if (!bgm) return fail('no_music');
    if (step.remove) {
      const next = patched(state, [{ op: 'remove_bgm' }]);
      return next ? done(next) : fail('not_applied');
    }
    // The music track has no mute flag: muted music is volume 0.
    const wanted = step.muted === true ? 0 : volume !== undefined ? volume : bgm.volume > 0 ? bgm.volume : MUSIC_UNMUTE_VOLUME;
    if (wanted === bgm.volume) return done(state);
    const next = patched(state, [{ op: 'set_bgm_volume', volume: wanted, ...(wanted === 0 ? { muted: true } : {}) }]);
    return next ? done(next) : fail('not_applied');
  }

  const clips = state.project.clips;
  let indices: number[];
  if (step.target === 'all_clips') {
    indices = clips.map((_, i) => i);
  } else {
    const index = clipIndexOf(state, step.target);
    indices = index < 0 ? [] : [index];
  }
  if (indices.length === 0) return fail('target_missing');
  // Mirrors `set_clip_audio`: a new volume unmutes unless it is 0, and unmuting at volume 0 gives 0.5.
  const alreadySo = indices.every((i) => {
    const clip = clips[i]!;
    const nextVolume = volume ?? clip.volume;
    const nextMuted = step.muted ?? nextVolume === 0;
    return clip.volume === (nextVolume === 0 && !nextMuted ? 0.5 : nextVolume) && clip.muted === nextMuted;
  });
  if (alreadySo) return done(state);
  const next = patched(state, [
    {
      op: 'set_clip_audio',
      clipIndex: step.target === 'all_clips' ? 'all' : indices[0]!,
      ...(volume !== undefined ? { volume } : {}),
      ...(step.muted !== undefined ? { muted: step.muted } : {}),
    },
  ]);
  return next ? done(next) : fail('not_applied');
}

function captionAddStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'caption_add' }>): StepOutcome {
  const project = state.project;
  if (project.captions.length >= MAX_COMPOSE_CAPTIONS) return fail('caption_limit');
  const look = { ...(step.position ? { position: step.position } : {}), ...(step.size ? { size: step.size } : {}) };
  const seconds = step.seconds !== undefined ? { durationSec: step.seconds } : {};
  let patch: TimelinePatch;
  if (step.where === 'start' || step.where === 'end') {
    patch = { op: 'add_caption', text: step.text, anchor: step.where, ...seconds, ...look };
  } else if (step.where === 'whole') {
    patch = { op: 'add_caption', text: step.text, anchor: 'full', ...look };
  } else if ('clip' in step.where) {
    const index = clipIndexOf(state, step.where.clip);
    if (index < 0) return fail('target_missing');
    const span = timelineSpans(project)[index]!;
    const endSec = step.seconds !== undefined ? roundTenths(span.timelineStartSec + step.seconds) : span.timelineEndSec;
    patch = { op: 'add_caption', text: step.text, startSec: span.timelineStartSec, endSec, ...look };
  } else {
    if (step.where.from > projectDurationSec(project) - MIN_CLIP_PLAY_SEC + EDGE_SEC) return fail('outside_timeline');
    patch = { op: 'add_caption', text: step.text, startSec: roundTenths(step.where.from), endSec: roundTenths(step.where.to), ...look };
  }
  const next = patched(state, [patch]);
  if (!next) return fail('not_applied');
  // `add_caption` draws a random id; give the new caption a stable one (`ea-cap-1`, …).
  const captions = [...next.project.captions];
  const taken = new Set(captions.map((c) => c.id));
  captions[captions.length - 1] = { ...captions[captions.length - 1]!, id: freshId((n) => `ea-cap-${n}`, taken) };
  return done({ ...next, project: { ...next.project, captions } });
}

function captionEditStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'caption_edit' }>): StepOutcome {
  const index = state.project.captions.findIndex((c) => c.id === step.caption.captionId);
  if (index < 0) return fail('target_missing');
  const caption = state.project.captions[index]!;
  if (step.from !== undefined && step.from > projectDurationSec(state.project) - MIN_CLIP_PLAY_SEC + EDGE_SEC) {
    return fail('outside_timeline');
  }
  if ((step.to ?? caption.endSec) <= (step.from ?? caption.startSec)) return fail('invalid_step');
  return settle(state, [
    {
      op: 'update_caption',
      captionIndex: index,
      ...(step.text !== undefined ? { text: step.text } : {}),
      ...(step.from !== undefined ? { startSec: roundTenths(step.from) } : {}),
      ...(step.to !== undefined ? { endSec: roundTenths(step.to) } : {}),
      ...(step.position ? { position: step.position } : {}),
      ...(step.size ? { size: step.size } : {}),
    },
  ]);
}

function captionRemoveStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'caption_remove' }>): StepOutcome {
  if (step.caption === 'all') {
    if (state.project.captions.length === 0) return done(state);
    const next = patched(state, [{ op: 'remove_caption', captionIndex: 'all' }]);
    return next ? done(next) : fail('not_applied');
  }
  const { captionId } = step.caption;
  const index = state.project.captions.findIndex((c) => c.id === captionId);
  if (index < 0) return fail('target_missing');
  const next = patched(state, [{ op: 'remove_caption', captionIndex: index }]);
  return next ? done(next) : fail('not_applied');
}

function lookStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'look' }>): StepOutcome {
  const grade = state.project.colorGrade ?? null;
  if (step.preset === 'off') {
    return grade ? settle(state, [{ op: 'set_color_grade', enabled: false }]) : done(state);
  }
  // A preset look replaces any reference look; the grade keeps its scope (whole video unless set otherwise).
  return settle(state, [
    {
      op: 'set_color_grade',
      enabled: true,
      presetId: step.preset,
      intensity: roundHundredths(step.strength ?? grade?.intensity ?? 0.85),
      referenceLabel: null,
      referenceUrl: null,
      referenceAssetId: null,
      referenceOutputId: null,
      referenceProfile: null,
    },
  ]);
}

/**
 * Splits `need` tenths of a second over the eligible cuts in proportion to their length, never past a
 * cut's cap. Integer arithmetic throughout; the rounding remainder goes to the largest fractional share,
 * then the longer cut, then the earlier cut — so the same timeline always gives the same answer.
 */
function proportionalCuts(lengths: readonly number[], caps: readonly number[], need: number): number[] {
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

function fitTotalStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'fit_total' }>): StepOutcome {
  const clips = state.project.clips;
  if (clips.length === 0) return fail('target_missing');
  const protectedIds = new Set<string>();
  for (const target of step.protect ?? []) {
    const index = clipIndexOf(state, target);
    if (index < 0) return fail('target_missing');
    protectedIds.add(clips[index]!.id);
  }
  const total = projectDurationSec(state.project);
  const target = roundTenths(step.seconds);
  if (target > total + EDGE_SEC) return fail('not_possible');
  const need = Math.round((total - target) * 10);
  if (need <= 0) return done(state);

  // Lengths in tenths, as the timeline counts them; a cut already under the floor keeps its length.
  const lengths = clips.map((clip) => Math.round(clipPlayDuration(clip) * 10));
  const floors = lengths.map((length) => Math.min(length, Math.round(FIT_TOTAL_FLOOR_SEC * 10)));
  const caps = clips.map((clip, i) => (protectedIds.has(clip.id) ? 0 : lengths[i]! - floors[i]!));
  if (need > caps.reduce((sum, cap) => sum + cap, 0)) return fail('not_possible');
  const cuts = proportionalCuts(lengths, caps, need);

  // Cuts shorten from their tails. A cut at another speed cannot land on every tenth, so what one cut
  // misses is carried to the next.
  const patches: TimelinePatch[] = [];
  let carry = 0;
  clips.forEach((clip, i) => {
    if (cuts[i] === 0) return;
    const rate = rateOf(clip);
    const desired = (lengths[i]! - cuts[i]!) / 10 + carry;
    const keep = clamp(desired, floors[i]! / 10, playedSec(clip));
    const trimEndSec = Math.min(clip.trimEndSec, roundTenths(clip.trimStartSec + keep * rate));
    carry = desired - Math.max(MIN_CLIP_PLAY_SEC, roundTenths((trimEndSec - clip.trimStartSec) / rate));
    if (trimEndSec !== clip.trimEndSec) patches.push({ op: 'trim_clip', clipIndex: i, trimEndSec });
  });
  if (patches.length === 0) return fail('not_possible');
  const next = patched(state, patches);
  if (!next) return fail('not_applied');
  if (Math.abs(projectDurationSec(next.project) - target) > 0.1 + 1e-9) return fail('not_possible');
  return done(next);
}

function evenPaceStep(state: ApplyState, step: Extract<ResolvedStep, { do: 'even_pace' }>): StepOutcome {
  const patches: TimelinePatch[] = [];
  state.project.clips.forEach((clip, i) => {
    if (playedSec(clip) <= step.secondsPerClip + EDGE_SEC) return;
    const trimEndSec = roundTenths(clip.trimStartSec + step.secondsPerClip * rateOf(clip));
    if (trimEndSec < clip.trimEndSec) patches.push({ op: 'trim_clip', clipIndex: i, trimEndSec });
  });
  // "Even the pace" with every cut already short enough asks for nothing: say so instead of a silent no-op.
  if (patches.length === 0) return fail('no_change');
  const next = patched(state, patches);
  return next ? done(next) : fail('not_applied');
}

function applyStep(state: ApplyState, step: ResolvedStep): StepOutcome {
  switch (step.do) {
    case 'trim':
      return trimStep(state, step);
    case 'split':
      return splitStep(state, step);
    case 'remove': {
      const index = clipIndexOf(state, step.clip);
      if (index < 0) return fail('target_missing');
      const next = patched(state, [{ op: 'remove_clip', clipIndex: index }]);
      return next ? done(next) : fail('not_applied');
    }
    case 'move':
      return moveStep(state, step);
    case 'sound':
      return soundStep(state, step);
    case 'caption_add':
      return captionAddStep(state, step);
    case 'caption_edit':
      return captionEditStep(state, step);
    case 'caption_remove':
      return captionRemoveStep(state, step);
    case 'aspect': {
      if (state.project.aspect === step.aspect) return done(state);
      const next = patched(state, [{ op: 'set_aspect', aspect: step.aspect }]);
      return next ? done(next) : fail('not_applied');
    }
    case 'look':
      return lookStep(state, step);
    case 'fit_total':
      return fitTotalStep(state, step);
    case 'even_pace':
      return evenPaceStep(state, step);
  }
}

/**
 * What each step is about, in step order, for `diffTimelines` to put the change lines in the order the user
 * asked for them. A split piece (`c2b`) is its cut; "fit the length" and "even the pace" touch every cut.
 */
export function stepSubjects(steps: readonly ResolvedStep[]): DeltaSubject[] {
  const cut = (target: ClipTarget): DeltaSubject => ({ clip: 'clipId' in target ? target.clipId : target.splitOf });
  return steps.map((step): DeltaSubject => {
    switch (step.do) {
      case 'trim':
      case 'split':
      case 'remove':
      case 'move':
        return cut(step.clip);
      case 'sound':
        return step.target === 'all_clips' ? 'clips' : step.target === 'music' ? 'music' : cut(step.target);
      case 'caption_add':
        return 'new_caption';
      case 'caption_edit':
        return { caption: step.caption.captionId };
      case 'caption_remove':
        return step.caption === 'all' ? 'captions' : { caption: step.caption.captionId };
      case 'aspect':
        return 'aspect';
      case 'look':
        return 'look';
      case 'fit_total':
      case 'even_pace':
        return 'clips';
    }
  });
}

/**
 * Applies resolved steps in order. Success: the new project and no problems. Any problem: the ORIGINAL
 * project object and every problem (later steps still run on the last good state so the list is complete).
 * A step that is already true is fine on its own; a plan that changes nothing at all is `no_change`.
 */
export function applyEditSteps(
  project: ComposerProject,
  steps: readonly ResolvedStep[],
): { project: ComposerProject; problems: StepProblem[] } {
  const start = applyTimelinePatches(project, []).project;
  let state: ApplyState = { project: start, splits: new Map() };
  const problems: StepProblem[] = [];
  steps.forEach((step, index) => {
    const outcome = applyStep(state, step);
    if (outcome.ok) state = outcome.state;
    else problems.push({ step: index, code: outcome.code });
  });
  if (problems.length > 0) return { project, problems };
  if (sameValue(state.project, start)) return { project, problems: [{ step: null, code: 'no_change' }] };
  return { project: state.project, problems: [] };
}
