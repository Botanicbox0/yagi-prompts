/**
 * Editing studio v2 — frame-faithful planner project and request builder (slice E-C, Batch 2).
 *
 * Pure and client-safe. Builds a dedicated `ComposerProject` for `POST /api/brand-studio/compose`
 * (`assist.plan`) ONLY, without altering the editor's own storage (`stored.ts`):
 * - every cut keeps its exact `id`, `volume`, and `muted`;
 * - `trimStartSec: 0`, `trimEndSec = durationSec = clip.frames / sequence.fps`;
 * - NO `playbackRate` (so speed-changed and speed-curved cuts report their exact played seconds).
 *
 * Rounding: IEEE-754 double stores `frames / fps` with 53-bit precision, so
 * `Math.round((frames / fps) * fps) === frames` is exact for 24, 30, 24000/1001, and 30000/1001 fps
 * with zero drift across 24 cuts.
 */
import { MAX_COMPOSE_CLIPS, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { EDIT_SECONDS_MAX, type AskAbout, type AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import type { FrameSequence } from './frames';

/** Mirrors `AssistPlanInputSchema.shape.message.maxLength` (`lib/brand-studio/edit-assist/service.ts:157`). */
export const ASSIST_MESSAGE_MAX_CHARS = 500;
/** Mirrors `EDIT_SECONDS_MAX` (`lib/brand-studio/edit-assist/plan.ts:29`, `service.ts:83`). */
export const ASSIST_CUT_MAX_SEC = EDIT_SECONDS_MAX;
/** Mirrors `MAX_COMPOSE_CLIPS` (`lib/brand-studio/compose/timeline.ts`). */
export const ASSIST_MAX_CUTS = MAX_COMPOSE_CLIPS;
/** Mirrors clip id max length in `AssistPlanInputSchema` (`lib/brand-studio/edit-assist/service.ts`). */
export const ASSIST_CLIP_ID_MAX_CHARS = 80;
/** Mirrors `RECENT_TURNS` in `components/brand-studio/compose/assist/assist-model.ts:390`. */
export const ASSIST_RECENT_TURNS = 3;
const ASSIST_DID_MAX = 12;
const ASSIST_DID_TEXT_MAX = 200;

export interface AssistRecentTurn {
  said: string;
  did: string[];
  kept: boolean;
}

export type AssistPrecheckResult =
  | { ok: true }
  | { ok: false; reason: 'too_long_cut' | 'too_many_cuts' | 'id_too_long' };

/**
 * Checks client-side bounds before calling `assist.plan`:
 * - cut count must match editor cap (`<= 24`, `MAX_COMPOSE_CLIPS`);
 * - every cut id must fit the server's 80-char id cap without slicing (slicing would cause `target_missing`);
 * - every cut's played duration (`frames / fps`) must be `<= 600s` (`EDIT_SECONDS_MAX`).
 */
export function validateSequenceForAssist(sequence: FrameSequence): AssistPrecheckResult {
  if (sequence.clips.length > ASSIST_MAX_CUTS) {
    return { ok: false, reason: 'too_many_cuts' };
  }
  const fps = sequence.fps > 0 ? sequence.fps : 30;
  for (const clip of sequence.clips) {
    if (clip.id.length > ASSIST_CLIP_ID_MAX_CHARS) {
      return { ok: false, reason: 'id_too_long' };
    }
    if (clip.frames / fps > ASSIST_CUT_MAX_SEC + 1e-9) {
      return { ok: false, reason: 'too_long_cut' };
    }
  }
  return { ok: true };
}

/**
 * Builds the frame-faithful seconds project sent to `assist.plan`.
 * Every cut keeps its exact `id`, `volume`, and `muted`, with `trimStartSec = 0`,
 * `trimEndSec = durationSec = clip.frames / sequence.fps`, and NO `playbackRate`.
 */
export function buildPlannerProject(sequence: FrameSequence): ComposerProject {
  const fps = sequence.fps > 0 ? sequence.fps : 30;
  const clips: ComposeClip[] = sequence.clips.map((clip) => {
    // Server schema requires `durationSec >= 0.1`; the client mapper (`assist-apply.ts`) always
    // maps edits against the cut's true integer frame length (`clip.frames`).
    const playedSec = Math.max(0.1, clip.frames / fps);
    return {
      id: clip.id,
      label: clip.label.slice(0, 160),
      sourceKind: 'asset',
      srcUrl: clip.srcUrl.slice(0, 500),
      thumbUrl: clip.thumbUrl ? clip.thumbUrl.slice(0, 500) : null,
      durationSec: playedSec,
      trimStartSec: 0,
      trimEndSec: playedSec,
      volume: Math.min(1, Math.max(0, clip.volume)),
      muted: Boolean(clip.muted),
    };
  });
  return {
    version: 1,
    aspect: sequence.aspect,
    clips,
    captions: [],
    bgm: null,
  };
}

export interface AssistPlanRequestParams {
  organizationId: string;
  message: string;
  locale: 'ko' | 'en';
  project: ComposerProject;
  /** Omitted when the playhead chip is absent or dismissed so the request matches the visible chips. */
  playheadSec?: number;
  selectedClipId?: string | null;
  recent?: readonly AssistRecentTurn[];
  answer?: { about: AskAbout; value: AskChoice };
}

/**
 * Builds the exact `input` object for `POST /api/brand-studio/compose` `{ operation: 'assist.plan', input }`,
 * matching `components/brand-studio/compose/assist/use-edit-assist.ts:252-261`.
 */
export function buildAssistPlanInput(params: AssistPlanRequestParams): Record<string, unknown> {
  const recent = (params.recent ?? [])
    .slice(-ASSIST_RECENT_TURNS)
    .map((turn) => ({
      said: turn.said.slice(0, ASSIST_MESSAGE_MAX_CHARS),
      did: turn.did.slice(0, ASSIST_DID_MAX).map((line) => line.slice(0, ASSIST_DID_TEXT_MAX)),
      kept: Boolean(turn.kept),
    }));
  const hasPlayhead = params.playheadSec !== undefined && Number.isFinite(params.playheadSec);
  const playheadSec = hasPlayhead ? Math.min(3600, Math.max(0, params.playheadSec!)) : undefined;
  return {
    organizationId: params.organizationId,
    message: params.message.trim().slice(0, ASSIST_MESSAGE_MAX_CHARS),
    locale: params.locale,
    project: params.project,
    ...(playheadSec !== undefined ? { playheadSec } : {}),
    ...(params.selectedClipId ? { selectedClipId: params.selectedClipId } : {}),
    ...(recent.length > 0 ? { recent } : {}),
    ...(params.answer ? { answer: params.answer } : {}),
  };
}
