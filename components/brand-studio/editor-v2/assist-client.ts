'use client';

/**
 * Editing studio v2 — `assist.plan` HTTP client (slice E-C, Batch 2 + Fix Round 4).
 *
 * Calls the existing `POST /api/brand-studio/compose` endpoint (`operation: 'assist.plan'`) with
 * the exact same wire shape as `components/brand-studio/compose/assist/use-edit-assist.ts:93-102`.
 * Boundary validation is derived from the server's own types/constants (`plan.ts`, `timeline.ts`):
 * - every valid step kind and patch op the server can emit passes through cleanly;
 * - malformed shapes (missing targets, non-finite/negative numbers, wrong types) map to `malformed`
 *   (shown as `noteCouldNotPlan`);
 * - well-formed unknown kinds/ops map to `unsupported` (shown as the honest generic not-available note).
 * Registered in `NETWORK_FILES` in `tests/brand-studio/editor-v2/flag-gate.test.ts`.
 */
import {
  COMPOSE_ASPECTS,
  COMPOSE_COLOR_PRESET_IDS,
  MIN_CLIP_PLAY_SEC,
  type TimelinePatch,
} from '@/lib/brand-studio/compose/timeline';
import type { ResolvedStep } from '@/lib/brand-studio/edit-assist/apply';
import {
  ASK_ABOUT,
  CANNOT_REASONS,
  CAPTION_PLACES,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  EDIT_STEP_KINDS,
  KEEP_PARTS,
  type AskAbout,
  type AskChoice,
  type CannotReason,
} from '@/lib/brand-studio/edit-assist/plan';

/**
 * Client-side request timeout ceiling (W1): the server allows 12 s per model call and at most
 * two calls, so 30 s bounds any hung request cleanly without cutting off normal replies.
 */
export const ASSIST_CLIENT_TIMEOUT_MS = 30_000;

export type AssistClientCannotReason = CannotReason | 'could_not_plan' | 'unavailable';

export type AssistClientErrorCode =
  | 'rate_limited'
  | 'invalid'
  | 'forbidden'
  | 'closed'
  | 'malformed'
  | 'unsupported'
  | 'unavailable';

export type AssistClientResponse =
  | { ok: true; kind: 'undo' }
  | { ok: true; kind: 'patches'; patches: TimelinePatch[] }
  | { ok: true; kind: 'plan'; steps: ResolvedStep[] }
  | { ok: true; kind: 'ask'; about: AskAbout; choices: AskChoice[] }
  | { ok: true; kind: 'cannot'; reason: AssistClientCannotReason }
  | { ok: false; code: AssistClientErrorCode; retryAfterSec?: number };

const CANNOT_SET: ReadonlySet<string> = new Set([...CANNOT_REASONS, 'could_not_plan', 'unavailable']);
const ASPECT_SET: ReadonlySet<string> = new Set(COMPOSE_ASPECTS);
const PRESET_SET: ReadonlySet<string> = new Set(['off', ...COMPOSE_COLOR_PRESET_IDS]);
const KEEP_SET: ReadonlySet<string> = new Set(KEEP_PARTS);
const STEP_KIND_SET: ReadonlySet<string> = new Set(EDIT_STEP_KINDS);
const CAPTION_PLACE_SET: ReadonlySet<string> = new Set(CAPTION_PLACES);
const CAPTION_POSITION_SET: ReadonlySet<string> = new Set(CAPTION_POSITIONS);
const CAPTION_SIZE_SET: ReadonlySet<string> = new Set(CAPTION_SIZES);

/** Complete list of `TimelinePatch['op']` emitted by `lib/brand-studio/compose/timeline.ts:198-284`. */
const KNOWN_PATCH_OPS: ReadonlySet<TimelinePatch['op']> = new Set([
  'set_aspect',
  'trim_clip',
  'set_clip_cuts',
  'split_clip_at',
  'split_clip_cuts',
  'move_clip',
  'swap_clips',
  'remove_clip',
  'set_clip_audio',
  'add_caption',
  'update_caption',
  'remove_caption',
  'set_bgm_volume',
  'remove_bgm',
  'set_color_grade',
  'set_clip_speed',
  'slip_clip',
  'set_clip_audio_offset',
  'set_clip_transition',
  'add_overlay',
  'remove_overlay',
  'add_sfx',
  'remove_sfx',
  'set_sfx_volume',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Recursively verifies an unknown well-formed step/patch object contains no `NaN` or `±Infinity`. */
function allNumbersFinite(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => allNumbersFinite(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every((v) => allNumbersFinite(v, depth + 1));
  return true;
}

function isValidClipTarget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if ('clipId' in value) return isNonEmptyString(value.clipId);
  if ('splitOf' in value) return isNonEmptyString(value.splitOf) && (value.part === 'a' || value.part === 'b');
  return false;
}

function isValidCaptionTarget(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.captionId);
}

function isValidCaptionWhere(value: unknown): boolean {
  if (typeof value === 'string') return CAPTION_PLACE_SET.has(value);
  if (!isRecord(value)) return false;
  if ('clip' in value) return isValidClipTarget(value.clip);
  if ('from' in value && 'to' in value) {
    return isFiniteNonNegative(value.from) && isFinitePositive(value.to) && value.from < value.to;
  }
  return false;
}

type ItemValidation = 'valid' | 'unsupported' | 'malformed';

function validateResolvedStep(step: unknown): ItemValidation {
  if (!isRecord(step) || !isNonEmptyString(step.do)) return 'malformed';
  if (!STEP_KIND_SET.has(step.do)) {
    return allNumbersFinite(step) ? 'unsupported' : 'malformed';
  }
  switch (step.do) {
    case 'trim': {
      if (!isValidClipTarget(step.clip)) return 'malformed';
      if (typeof step.keep !== 'string' || !KEEP_SET.has(step.keep)) return 'malformed';
      if (step.keep === 'range') {
        return isFiniteNonNegative(step.from) && isFinitePositive(step.to) && step.from < step.to ? 'valid' : 'malformed';
      }
      return isFinitePositive(step.seconds) ? 'valid' : 'malformed';
    }
    case 'split':
      return isValidClipTarget(step.clip) && isFinitePositive(step.at) ? 'valid' : 'malformed';
    case 'remove':
      return isValidClipTarget(step.clip) ? 'valid' : 'malformed';
    case 'move': {
      if (!isValidClipTarget(step.clip)) return 'malformed';
      if (step.to === 'first' || step.to === 'last') return 'valid';
      if (!isRecord(step.to)) return 'malformed';
      if ('before' in step.to) return isValidClipTarget(step.to.before) ? 'valid' : 'malformed';
      if ('after' in step.to) return isValidClipTarget(step.to.after) ? 'valid' : 'malformed';
      return 'malformed';
    }
    case 'sound': {
      const targetOk = step.target === 'all_clips' || step.target === 'music' || isValidClipTarget(step.target);
      if (!targetOk) return 'malformed';
      if (step.remove !== undefined && typeof step.remove !== 'boolean') return 'malformed';
      if (step.muted !== undefined && typeof step.muted !== 'boolean') return 'malformed';
      if (step.volume !== undefined && (!isFiniteNonNegative(step.volume) || step.volume > 1)) return 'malformed';
      if (step.remove === true) {
        // Server `SoundStepSchema` (`lib/brand-studio/edit-assist/plan.ts:192-196`): `remove: true` is valid for `target: 'music'` alone.
        return step.target === 'music' && step.volume === undefined && step.muted === undefined ? 'valid' : 'malformed';
      }
      return step.muted !== undefined || step.volume !== undefined ? 'valid' : 'malformed';
    }
    case 'aspect':
      return typeof step.aspect === 'string' && ASPECT_SET.has(step.aspect) ? 'valid' : 'malformed';
    case 'look': {
      if (typeof step.preset !== 'string' || !PRESET_SET.has(step.preset)) return 'malformed';
      if (step.strength !== undefined && (!isFiniteNonNegative(step.strength) || step.strength > 1)) return 'malformed';
      return 'valid';
    }
    case 'fit_total': {
      if (!isFinitePositive(step.seconds)) return 'malformed';
      if (step.protect !== undefined) {
        if (!Array.isArray(step.protect) || !step.protect.every(isValidClipTarget)) return 'malformed';
      }
      return 'valid';
    }
    case 'even_pace':
      return isFinitePositive(step.secondsPerClip) && step.secondsPerClip >= MIN_CLIP_PLAY_SEC ? 'valid' : 'malformed';
    case 'caption_add': {
      if (!isNonEmptyString(step.text) || !isValidCaptionWhere(step.where)) return 'malformed';
      if (step.seconds !== undefined && !isFinitePositive(step.seconds)) return 'malformed';
      if (step.position !== undefined && (typeof step.position !== 'string' || !CAPTION_POSITION_SET.has(step.position))) return 'malformed';
      if (step.size !== undefined && (typeof step.size !== 'string' || !CAPTION_SIZE_SET.has(step.size))) return 'malformed';
      return 'valid';
    }
    case 'caption_edit': {
      if (!isValidCaptionTarget(step.caption)) return 'malformed';
      if (step.text !== undefined && !isNonEmptyString(step.text)) return 'malformed';
      if (step.position !== undefined && (typeof step.position !== 'string' || !CAPTION_POSITION_SET.has(step.position))) return 'malformed';
      if (step.size !== undefined && (typeof step.size !== 'string' || !CAPTION_SIZE_SET.has(step.size))) return 'malformed';
      if (step.from !== undefined && !isFiniteNonNegative(step.from)) return 'malformed';
      if (step.to !== undefined && !isFinitePositive(step.to)) return 'malformed';
      if (step.from !== undefined && step.to !== undefined && step.from >= step.to) return 'malformed';
      return step.text !== undefined ||
        step.position !== undefined ||
        step.size !== undefined ||
        step.from !== undefined ||
        step.to !== undefined
        ? 'valid'
        : 'malformed';
    }
    case 'caption_remove':
      return step.caption === 'all' || isValidCaptionTarget(step.caption) ? 'valid' : 'malformed';
    default:
      return 'unsupported';
  }
}

function validateTimelinePatch(patch: unknown): ItemValidation {
  if (!isRecord(patch) || !isNonEmptyString(patch.op)) return 'malformed';
  if (!KNOWN_PATCH_OPS.has(patch.op as TimelinePatch['op'])) {
    return allNumbersFinite(patch) ? 'unsupported' : 'malformed';
  }
  switch (patch.op as TimelinePatch['op']) {
    case 'set_aspect':
      return typeof patch.aspect === 'string' && ASPECT_SET.has(patch.aspect) ? 'valid' : 'malformed';
    case 'trim_clip': {
      if (!isNonNegativeInt(patch.clipIndex)) return 'malformed';
      if (patch.trimStartSec !== undefined && !isFiniteNonNegative(patch.trimStartSec)) return 'malformed';
      if (patch.trimEndSec !== undefined && !isFinitePositive(patch.trimEndSec)) return 'malformed';
      if (patch.targetDurationSec !== undefined && !isFinitePositive(patch.targetDurationSec)) return 'malformed';
      return patch.trimStartSec !== undefined || patch.trimEndSec !== undefined || patch.targetDurationSec !== undefined
        ? 'valid'
        : 'malformed';
    }
    case 'set_clip_cuts':
      return isNonNegativeInt(patch.clipIndex) &&
        Array.isArray(patch.cutMarkers) &&
        patch.cutMarkers.every(isFiniteNonNegative)
        ? 'valid'
        : 'malformed';
    case 'split_clip_at':
      return isNonNegativeInt(patch.clipIndex) && isFinitePositive(patch.atMediaSec) ? 'valid' : 'malformed';
    case 'split_clip_cuts':
      return isNonNegativeInt(patch.clipIndex) &&
        Array.isArray(patch.cutMediaSecs) &&
        patch.cutMediaSecs.every(isFinitePositive)
        ? 'valid'
        : 'malformed';
    case 'remove_clip':
      return isNonNegativeInt(patch.clipIndex) ? 'valid' : 'malformed';
    case 'move_clip':
      return isNonNegativeInt(patch.fromIndex) && isNonNegativeInt(patch.toIndex) ? 'valid' : 'malformed';
    case 'swap_clips':
      return isNonNegativeInt(patch.indexA) && isNonNegativeInt(patch.indexB) ? 'valid' : 'malformed';
    case 'set_clip_audio': {
      const idxOk = patch.clipIndex === 'all' || isNonNegativeInt(patch.clipIndex);
      if (!idxOk) return 'malformed';
      if (patch.muted !== undefined && typeof patch.muted !== 'boolean') return 'malformed';
      if (patch.volume !== undefined && (!isFiniteNonNegative(patch.volume) || patch.volume > 1)) return 'malformed';
      return patch.muted !== undefined || patch.volume !== undefined ? 'valid' : 'malformed';
    }
    case 'set_color_grade':
      return typeof patch.enabled === 'boolean' && allNumbersFinite(patch) ? 'valid' : 'malformed';
    case 'set_bgm_volume':
      return isFiniteNonNegative(patch.volume) && patch.volume <= 1 && (patch.muted === undefined || typeof patch.muted === 'boolean')
        ? 'valid'
        : 'malformed';
    case 'remove_bgm':
      return 'valid';
    case 'add_caption':
      return isNonEmptyString(patch.text) && isFiniteNonNegative(patch['startSec']) && isFinitePositive(patch['endSec'])
        ? 'valid'
        : 'malformed';
    case 'update_caption':
      return isNonNegativeInt(patch.captionIndex) && allNumbersFinite(patch) ? 'valid' : 'malformed';
    case 'remove_caption':
      return patch.captionIndex === 'all' || isNonNegativeInt(patch.captionIndex) ? 'valid' : 'malformed';
    case 'set_clip_speed':
      return isNonNegativeInt(patch.clipIndex) && isFinitePositive(patch.playbackRate) ? 'valid' : 'malformed';
    case 'slip_clip':
      return isNonNegativeInt(patch.clipIndex) && isFiniteNumber(patch.deltaSec) ? 'valid' : 'malformed';
    case 'set_clip_audio_offset':
      return isNonNegativeInt(patch.clipIndex) && isFiniteNumber(patch.audioOffsetSec) ? 'valid' : 'malformed';
    case 'set_clip_transition':
      return isNonNegativeInt(patch.clipIndex) && isNonEmptyString(patch.transitionIn) && allNumbersFinite(patch)
        ? 'valid'
        : 'malformed';
    case 'add_overlay':
      return isNonEmptyString(patch.srcUrl) && isFiniteNonNegative(patch['startSec']) && isFinitePositive(patch['endSec'])
        ? 'valid'
        : 'malformed';
    case 'remove_overlay':
      return patch.overlayIndex === 'all' || isNonNegativeInt(patch.overlayIndex) ? 'valid' : 'malformed';
    case 'add_sfx':
      return isNonEmptyString(patch.srcUrl) && isFiniteNonNegative(patch['startSec']) && isFinitePositive(patch.durationSec)
        ? 'valid'
        : 'malformed';
    case 'remove_sfx':
      return patch.sfxIndex === 'all' || isNonNegativeInt(patch.sfxIndex) ? 'valid' : 'malformed';
    case 'set_sfx_volume':
      return isNonNegativeInt(patch.sfxIndex) && isFiniteNonNegative(patch.volume) && patch.volume <= 1 ? 'valid' : 'malformed';
    default:
      return 'unsupported';
  }
}

function isValidAskChoice(choice: unknown): choice is AskChoice {
  if (choice === 'all') return true;
  if (typeof choice === 'string' && CAPTION_PLACE_SET.has(choice)) return true;
  if (isFinitePositive(choice)) return true;
  if (isRecord(choice)) {
    if ('clipId' in choice) return isNonEmptyString(choice.clipId);
    if ('captionId' in choice) return isNonEmptyString(choice.captionId);
  }
  return false;
}

function parseRetryAfter(raw: unknown, header: string | null): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.ceil(raw);
  if (header) {
    const parsed = Number(header.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }
  return undefined;
}

/**
 * Parses and validates `assist.plan` JSON body defensively at the boundary (B1 + S1 + S2):
 * - HTTP 429 / 401-403 / 404 / 400 / 5xx map to typed error codes;
 * - zero-step plans/patches pass through as `{ ok: true, kind: 'plan'|'patches', ...: [] }` so the
 *   mapper reports `no_change` ("이미 같은 상태라 바꿀 내용이 없어요", S2);
 * - well-formed unknown `kind` / unknown `step.do` / unknown `patch.op` map to `{ ok: false, code: 'unsupported' }`
 *   (the honest generic not-available note, B1), never `malformed`;
 * - broken shapes (missing targets, non-finite/negative numbers, wrong types) map to `malformed`.
 */
export function parseAssistClientBody(raw: unknown, status = 200, retryAfterHeader: string | null = null): AssistClientResponse {
  if (status === 429) {
    const retryAfterSec = isRecord(raw) ? parseRetryAfter(raw.retryAfterSec, retryAfterHeader) : parseRetryAfter(undefined, retryAfterHeader);
    return retryAfterSec !== undefined ? { ok: false, code: 'rate_limited', retryAfterSec } : { ok: false, code: 'rate_limited' };
  }
  if (status === 401 || status === 403) return { ok: false, code: 'forbidden' };
  if (status === 404) return { ok: false, code: 'closed' };
  if (status === 400) return { ok: false, code: 'invalid' };
  if (status >= 500 || status < 200) return { ok: false, code: 'unavailable' };

  if (!isRecord(raw)) return { ok: false, code: 'unavailable' };
  if (raw.ok !== true) {
    const code = typeof raw.code === 'string' ? raw.code : 'unavailable';
    if (code === 'rate_limited') {
      const retryAfterSec = parseRetryAfter(raw.retryAfterSec, retryAfterHeader);
      return retryAfterSec !== undefined ? { ok: false, code: 'rate_limited', retryAfterSec } : { ok: false, code: 'rate_limited' };
    }
    if (code === 'forbidden' || code === 'unauthorized') return { ok: false, code: 'forbidden' };
    if (code === 'not_found' || code === 'closed') return { ok: false, code: 'closed' };
    if (code === 'invalid') return { ok: false, code: 'invalid' };
    return { ok: false, code: 'unavailable' };
  }

  switch (raw.kind) {
    case 'undo':
      return { ok: true, kind: 'undo' };
    case 'patches': {
      if (!Array.isArray(raw.patches)) return { ok: false, code: 'malformed' };
      let hasUnsupported = false;
      for (const patch of raw.patches) {
        const check = validateTimelinePatch(patch);
        if (check === 'malformed') return { ok: false, code: 'malformed' };
        if (check === 'unsupported') hasUnsupported = true;
      }
      if (hasUnsupported) return { ok: false, code: 'unsupported' };
      return { ok: true, kind: 'patches', patches: raw.patches as TimelinePatch[] };
    }
    case 'plan': {
      if (!Array.isArray(raw.steps)) return { ok: false, code: 'malformed' };
      let hasUnsupported = false;
      for (const step of raw.steps) {
        const check = validateResolvedStep(step);
        if (check === 'malformed') return { ok: false, code: 'malformed' };
        if (check === 'unsupported') hasUnsupported = true;
      }
      if (hasUnsupported) return { ok: false, code: 'unsupported' };
      return { ok: true, kind: 'plan', steps: raw.steps as ResolvedStep[] };
    }
    case 'ask':
      return typeof raw.about === 'string' &&
        (ASK_ABOUT as readonly string[]).includes(raw.about) &&
        Array.isArray(raw.choices) &&
        raw.choices.length > 0 &&
        raw.choices.every(isValidAskChoice)
        ? { ok: true, kind: 'ask', about: raw.about as AskAbout, choices: raw.choices }
        : { ok: false, code: 'malformed' };
    case 'cannot':
      return {
        ok: true,
        kind: 'cannot',
        reason: typeof raw.reason === 'string' && CANNOT_SET.has(raw.reason) ? (raw.reason as AssistClientCannotReason) : 'unavailable',
      };
    default:
      return isNonEmptyString(raw.kind) && allNumbersFinite(raw)
        ? { ok: false, code: 'unsupported' }
        : { ok: false, code: 'malformed' };
  }
}

export async function requestAssistPlan(
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<AssistClientResponse> {
  const res = await fetch('/api/brand-studio/compose', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'assist.plan', input }),
    signal,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return parseAssistClientBody(body, res.status, res.headers?.get?.('Retry-After') ?? null);
}
