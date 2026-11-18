/**
 * The timeline as the "말로 편집" model sees it (docs/BRAND-EDITING-STUDIO.md §4.4).
 *
 * Cuts and captions get short refs (`c1`…, `t1`… in timeline order) instead of ids or positions: the
 * model names them, `apply.ts` swaps the refs back for ids. Seconds are what the user sees on the
 * timeline — a cut's played length honours its trim and speed. Labels, caption text and recent turns are
 * data for the model, never instructions; the server puts this whole object in a delimited data block.
 *
 * Client-safe: no server imports, no Node APIs.
 */
import {
  clipPlayDuration,
  MAX_COMPOSE_CAPTIONS,
  MAX_COMPOSE_CLIPS,
  MIN_CLIP_PLAY_SEC,
  normalizeColorGradeState,
  projectDurationSec,
  roundHundredths,
  roundTenths,
  timelineSpans,
  type CaptionPosition,
  type ComposeAspect,
  type ComposeColorPresetId,
  type ComposerProject,
} from '../compose/timeline';
import { CAPTION_TEXT_MAX, type AskAbout, type AskChoice, type EditRefs } from './plan';

export const CONTEXT_LABEL_MAX = 60;
export const CONTEXT_RECENT_MAX = 3;
export const CONTEXT_SAID_MAX = 200;
export const CONTEXT_DID_MAX = 6;
const CONTEXT_DID_TEXT_MAX = 120;

export interface EditContextCut {
  ref: string;
  label: string;
  /** Seconds it plays on the timeline now (trim and speed applied). */
  playSec: number;
  /** Full length of the source media. */
  sourceSec: number;
  /** The part of the source it plays, in source seconds. */
  trim: [number, number];
  /** Where it starts on the timeline. */
  startsAt: number;
  muted: boolean;
  volume: number;
  /** Speed multiplier, only when not 1. */
  speed?: number;
}

export interface EditContextCaption {
  ref: string;
  text: string;
  from: number;
  to: number;
  position: CaptionPosition;
}

export interface EditContextTurn {
  said: string;
  did: string[];
  kept: boolean;
}

export interface EditContext {
  aspect: ComposeAspect;
  totalSec: number;
  limits: { minClipSec: number; maxClips: number; maxCaptions: number; captionMaxChars: number };
  cuts: EditContextCut[];
  captions: EditContextCaption[];
  music: { label: string; volume: number } | null;
  look: { preset: ComposeColorPresetId | 'custom'; strength: number } | null;
  /** Where the user is looking: the cut under the playhead and the played seconds into it. */
  playhead?: { sec: number; cut: string | null; inCut: number | null };
  /** The cut the user picked ("이 컷"). */
  selected?: string;
  recent?: EditContextTurn[];
  /** The user's pick for the model's earlier `ask`, in ref form. */
  answer?: { about: AskAbout; value: string | number };
}

export interface EditContextOptions {
  playheadSec?: number;
  selectedClipId?: string | null;
  recent?: readonly EditContextTurn[];
  answer?: { about: AskAbout; value: AskChoice };
}

function clipText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function refFor(record: Record<string, string>, id: string): string | undefined {
  return Object.keys(record).find((ref) => record[ref] === id);
}

/** The earlier answer in the form the model knows (refs, not ids); undefined when it no longer fits. */
function answerAsRef(answer: NonNullable<EditContextOptions['answer']>, refs: EditRefs): EditContext['answer'] {
  const { about, value } = answer;
  if (about === 'which_clip') {
    if (value === 'all') return { about, value: 'all' };
    const ref = typeof value === 'object' && 'clipId' in value ? refFor(refs.clips, value.clipId) : undefined;
    return ref ? { about, value: ref } : undefined;
  }
  if (about === 'which_caption') {
    const ref = typeof value === 'object' && 'captionId' in value ? refFor(refs.captions, value.captionId) : undefined;
    return ref ? { about, value: ref } : undefined;
  }
  if (about === 'how_long') {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? { about, value: roundTenths(value) } : undefined;
  }
  return value === 'start' || value === 'end' || value === 'whole' ? { about, value } : undefined;
}

export function buildEditContext(
  project: ComposerProject,
  options: EditContextOptions = {},
): { context: EditContext; refs: EditRefs } {
  const spans = timelineSpans(project);
  const refs: EditRefs = { clips: {}, captions: {} };

  const cuts: EditContextCut[] = spans.map((span, i) => {
    const ref = `c${i + 1}`;
    refs.clips[ref] = span.clip.id;
    const rate = span.clip.playbackRate ?? 1;
    return {
      ref,
      label: clipText(span.clip.label, CONTEXT_LABEL_MAX),
      playSec: clipPlayDuration(span.clip),
      sourceSec: span.clip.durationSec,
      trim: [span.clip.trimStartSec, span.clip.trimEndSec],
      startsAt: span.timelineStartSec,
      muted: span.clip.muted,
      volume: roundHundredths(span.clip.volume),
      ...(rate !== 1 ? { speed: rate } : {}),
    };
  });

  // Captions in the order they appear on screen; the array order is only the order they were added.
  const ordered = project.captions
    .map((caption, index) => ({ caption, index }))
    .sort((a, b) => a.caption.startSec - b.caption.startSec || a.index - b.index);
  const captions: EditContextCaption[] = ordered.map(({ caption }, i) => {
    const ref = `t${i + 1}`;
    refs.captions[ref] = caption.id;
    return { ref, text: caption.text, from: caption.startSec, to: caption.endSec, position: caption.position };
  });

  const grade = normalizeColorGradeState(project.colorGrade);
  const context: EditContext = {
    aspect: project.aspect,
    totalSec: projectDurationSec(project),
    limits: {
      minClipSec: MIN_CLIP_PLAY_SEC,
      maxClips: MAX_COMPOSE_CLIPS,
      maxCaptions: MAX_COMPOSE_CAPTIONS,
      captionMaxChars: CAPTION_TEXT_MAX,
    },
    cuts,
    captions,
    music: project.bgm ? { label: clipText(project.bgm.label, CONTEXT_LABEL_MAX), volume: roundHundredths(project.bgm.volume) } : null,
    look: grade ? { preset: grade.presetId ?? 'custom', strength: grade.intensity } : null,
  };

  if (options.playheadSec !== undefined && Number.isFinite(options.playheadSec)) {
    const sec = roundTenths(Math.max(0, Math.min(options.playheadSec, context.totalSec)));
    const at = spans.findIndex(
      (span, i) => sec >= span.timelineStartSec && (sec < span.timelineEndSec || (i === spans.length - 1 && sec <= span.timelineEndSec)),
    );
    context.playhead =
      at < 0
        ? { sec, cut: null, inCut: null }
        : { sec, cut: `c${at + 1}`, inCut: roundTenths(sec - spans[at]!.timelineStartSec) };
  }

  if (options.selectedClipId) {
    const selected = refFor(refs.clips, options.selectedClipId);
    if (selected) context.selected = selected;
  }

  if (options.recent && options.recent.length > 0) {
    context.recent = options.recent.slice(-CONTEXT_RECENT_MAX).map((turn) => ({
      said: clipText(turn.said, CONTEXT_SAID_MAX),
      did: turn.did.slice(0, CONTEXT_DID_MAX).map((line) => clipText(line, CONTEXT_DID_TEXT_MAX)),
      kept: turn.kept,
    }));
  }

  if (options.answer) {
    const answer = answerAsRef(options.answer, refs);
    if (answer) context.answer = answer;
  }

  return { context, refs };
}
