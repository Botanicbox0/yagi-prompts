/**
 * Editing studio v2 — the pure model behind the structure prototype (docs/BRAND-EDITING-STUDIO-V2.md).
 *
 * The cut itself is the production timeline model (`ComposerProject` + `applyTimelinePatches`), so
 * trims, splits, moves and captions in the prototype are the real operations. Everything the current
 * model cannot hold yet (a look per cut, reframing, sound outcomes, caption settings, titles) lives
 * beside it in `EditorDoc`; the build plan (doc §9) says where each of those lands in the real model.
 *
 * Nothing here touches the DOM, the network or storage.
 */
import {
  applyTimelinePatches,
  frameStateAtTime,
  timelineSpans,
  type ComposerProject,
  type TimelinePatch,
} from '@/lib/brand-studio/compose/timeline';

export const EDITOR_WORKSPACES = ['cut', 'color', 'sound', 'captions'] as const;
export type EditorWorkspace = (typeof EDITOR_WORKSPACES)[number];

/** What an outcome action applies to. `current` is the cut under the playhead: no selection needed. */
export const SCOPE_MODES = ['all', 'current', 'selected'] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/** Each value is `-1..1`; `0` leaves the picture alone. */
export interface GradeDetail {
  exposure: number;
  contrast: number;
  temperature: number;
  saturation: number;
}

export const NEUTRAL_DETAIL: GradeDetail = { exposure: 0, contrast: 0, temperature: 0, saturation: 0 };

export const LOOK_IDS = ['brand', 'clear', 'warm', 'film', 'mono'] as const;
export type LookId = (typeof LOOK_IDS)[number];

export const LOOK_DETAILS: Readonly<Record<LookId, GradeDetail>> = {
  brand: { exposure: 0.08, contrast: 0.12, temperature: -0.45, saturation: -0.08 },
  clear: { exposure: 0.14, contrast: 0.1, temperature: -0.08, saturation: 0.08 },
  warm: { exposure: 0.04, contrast: 0.06, temperature: 0.5, saturation: 0.1 },
  film: { exposure: -0.06, contrast: 0.22, temperature: 0.18, saturation: -0.22 },
  mono: { exposure: 0, contrast: 0.2, temperature: 0, saturation: -1 },
};

export interface ClipLook {
  /** How the look got here: balanced automatically, matched to a reference, a named look, or by hand. */
  source: 'auto' | 'match' | 'look' | 'manual';
  lookId?: LookId;
  /** The reference a `match` look was taken from (a cut number or a material label). */
  reference?: string;
  detail: GradeDetail;
  /** `0..1` blend between the original picture and the look. */
  strength: number;
}

/** Averages of one frame. `luma` and `saturation` are `0..1`; `warmth` is `(R − B) / (R + G + B)`. */
export interface FrameStats {
  luma: number;
  warmth: number;
  saturation: number;
}

export const DUCK_LEVELS = ['light', 'medium', 'strong'] as const;
export type DuckLevel = (typeof DUCK_LEVELS)[number];
export const DUCK_DEPTH_DB: Readonly<Record<DuckLevel, number>> = { light: 6, medium: 10, strong: 14 };

export interface SoundState {
  speechClear: boolean;
  duck: DuckLevel | null;
  /** Bring the whole film to the platform loudness target at export. */
  loudness: boolean;
  fades: boolean;
  /** `0..1` music gain before ducking. */
  musicVolume: number;
}

export interface MusicTrack {
  id: string;
  label: string;
  mood: string;
  durationSec: number;
}

export interface SpeechRegion {
  startSec: number;
  endSec: number;
}

export const CAPTION_STYLE_IDS = ['clean', 'box', 'bold', 'brand'] as const;
export type CaptionStyleId = (typeof CAPTION_STYLE_IDS)[number];
export const SAFE_AREAS = ['none', 'reels', 'shorts', 'tiktok'] as const;
export type SafeArea = (typeof SAFE_AREAS)[number];
export const CAPTION_OUTPUTS = ['burn', 'file', 'both'] as const;
export type CaptionOutput = (typeof CAPTION_OUTPUTS)[number];

export interface CaptionSettings {
  styleId: CaptionStyleId;
  safeArea: SafeArea;
  /** Bottom captions move above the platform's own buttons and text. */
  lift: boolean;
  output: CaptionOutput;
}

export const TITLE_PRESETS = ['big', 'lower', 'end'] as const;
export type TitlePreset = (typeof TITLE_PRESETS)[number];

export interface TitleItem {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  preset: TitlePreset;
}

export interface Reframe {
  fit: 'fill' | 'fit';
  /** Horizontal focus `0..100` (percent), used when `fill` crops the sides. */
  x: number;
}

export const DEFAULT_REFRAME: Reframe = { fit: 'fill', x: 50 };

export interface EditorDoc {
  project: ComposerProject;
  looks: Record<string, ClipLook>;
  reframe: Record<string, Reframe>;
  sound: SoundState;
  music: MusicTrack | null;
  captionSettings: CaptionSettings;
  titles: TitleItem[];
}

// ── Cut ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Applies production timeline patches and keeps the per-cut extras in step: the right half of a split
 * inherits the look and framing of the cut it came from, and extras of removed cuts are dropped.
 */
export function applyDocPatches(
  doc: EditorDoc,
  patches: readonly TimelinePatch[],
): { doc: EditorDoc; appliedCount: number } {
  const { project, appliedCount } = applyTimelinePatches(doc.project, patches);
  if (appliedCount === 0) return { doc, appliedCount };
  const looks: Record<string, ClipLook> = {};
  const reframe: Record<string, Reframe> = {};
  const knownIds = new Set(doc.project.clips.map((clip) => clip.id));
  project.clips.forEach((clip, index) => {
    const previous = index > 0 ? project.clips[index - 1] : undefined;
    const inherits = !knownIds.has(clip.id) && previous && previous.srcUrl === clip.srcUrl;
    const look = inherits ? looks[previous.id] : doc.looks[clip.id];
    const frame = inherits ? reframe[previous.id] : doc.reframe[clip.id];
    if (look) looks[clip.id] = look;
    if (frame) reframe[clip.id] = frame;
  });
  const total = timelineSpans(project).at(-1)?.timelineEndSec ?? 0;
  const titles = doc.titles
    .filter((title) => title.startSec < total)
    .map((title) => (title.endSec > total ? { ...title, endSec: total } : title));
  return { doc: { ...doc, project, looks, reframe, titles }, appliedCount };
}

/** The cut ids an outcome action will touch, in timeline order. */
export function scopeClipIds(
  project: ComposerProject,
  mode: ScopeMode,
  selection: readonly string[],
  playheadSec: number,
): string[] {
  if (mode === 'selected') {
    const picked = project.clips.filter((clip) => selection.includes(clip.id)).map((clip) => clip.id);
    if (picked.length > 0) return picked;
  }
  if (mode === 'current') {
    const active = frameStateAtTime(project, playheadSec).activeClip;
    if (active) return [active.clip.id];
  }
  return project.clips.map((clip) => clip.id);
}

/** A selection never outlives its cuts, and `selected` falls back to the whole film when it empties. */
export function settleScope(
  project: ComposerProject,
  mode: ScopeMode,
  selection: readonly string[],
): { mode: ScopeMode; selection: string[] } {
  const alive = selection.filter((id) => project.clips.some((clip) => clip.id === id));
  return { mode: mode === 'selected' && alive.length === 0 ? 'all' : mode, selection: alive };
}

// ── Colour ─────────────────────────────────────────────────────────────────────────────────────

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Averages of an RGBA pixel buffer (what a canvas `getImageData` returns). */
export function statsFromPixels(data: ArrayLike<number>): FrameStats {
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const pr = (data[i] ?? 0) / 255;
    const pg = (data[i + 1] ?? 0) / 255;
    const pb = (data[i + 2] ?? 0) / 255;
    r += pr;
    g += pg;
    b += pb;
    const max = Math.max(pr, pg, pb);
    sat += max === 0 ? 0 : (max - Math.min(pr, pg, pb)) / max;
    count += 1;
  }
  if (count === 0) return { luma: 0.5, warmth: 0, saturation: 0 };
  r /= count;
  g /= count;
  b /= count;
  const sum = r + g + b;
  return {
    luma: round3(0.2126 * r + 0.7152 * g + 0.0722 * b),
    warmth: round3(sum === 0 ? 0 : (r - b) / sum),
    saturation: round3(sat / count),
  };
}

/** The film's own middle: what "balance automatically" pulls every cut towards. */
export function filmTarget(stats: readonly FrameStats[]): FrameStats {
  if (stats.length === 0) return { luma: 0.5, warmth: 0, saturation: 0.3 };
  const lumas = stats.map((s) => s.luma).sort((a, b) => a - b);
  const mid = Math.floor(lumas.length / 2);
  const median = lumas.length % 2 === 1 ? lumas[mid]! : (lumas[mid - 1]! + lumas[mid]!) / 2;
  const mean = (pick: (s: FrameStats) => number) => stats.reduce((acc, s) => acc + pick(s), 0) / stats.length;
  return { luma: round3(median), warmth: round3(mean((s) => s.warmth)), saturation: round3(mean((s) => s.saturation)) };
}

/** The adjustment that moves a frame with `stats` towards `target`. Inverse of `gradeMatrix`'s gains. */
export function balanceDetail(stats: FrameStats, target: FrameStats): GradeDetail {
  const exposure = stats.luma <= 0 ? 0 : Math.log2(target.luma / stats.luma) / 0.8;
  const temperature = (target.warmth - stats.warmth) / 0.08;
  const saturation = stats.saturation <= 0 ? 0 : target.saturation / stats.saturation - 1;
  return {
    exposure: round3(clamp(exposure, -1, 1)),
    contrast: 0,
    temperature: round3(clamp(temperature, -1, 1)),
    saturation: round3(clamp(saturation, -0.5, 0.5)),
  };
}

/**
 * One 4×5 colour matrix (feColorMatrix order) for a look at a strength. The same twenty numbers can
 * drive the preview filter and an export shader, which is how preview and file stay the same.
 */
export function gradeMatrix(detail: GradeDetail, strength = 1): number[] {
  const gain = 2 ** (detail.exposure * 0.8);
  const slope = 1 + detail.contrast * 0.5;
  const offset = 0.5 * (1 - slope);
  const channel = [gain * slope * (1 + 0.12 * detail.temperature), gain * slope, gain * slope * (1 - 0.12 * detail.temperature)];
  const sat = 1 + detail.saturation;
  const lum = [0.2126, 0.7152, 0.0722];
  const k = clamp(strength, 0, 1);
  const rows: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const full = (lum[col]! * (1 - sat) + (row === col ? sat : 0)) * channel[col]!;
      const identity = row === col ? 1 : 0;
      rows.push(round3(identity + k * (full - identity)));
    }
    rows.push(0, round3(k * offset));
  }
  rows.push(0, 0, 0, 1, 0);
  return rows;
}

export function isNeutral(detail: GradeDetail): boolean {
  return detail.exposure === 0 && detail.contrast === 0 && detail.temperature === 0 && detail.saturation === 0;
}

export type ColorFinding =
  | { kind: 'dark_cut'; clipId: string; clipNumber: number }
  | { kind: 'bright_cut'; clipId: string; clipNumber: number }
  | { kind: 'mixed_temperature'; clipIds: string[] };

/** What the colour workspace says before anyone touches a control. Cuts that already carry a look are left out. */
export function colorFindings(
  project: ComposerProject,
  stats: Readonly<Record<string, FrameStats>>,
  looks: Readonly<Record<string, ClipLook>>,
): ColorFinding[] {
  const measured = project.clips
    .map((clip, index) => ({ clip, number: index + 1, stats: stats[clip.srcUrl] }))
    .filter((entry): entry is { clip: ComposerProject['clips'][number]; number: number; stats: FrameStats } => !!entry.stats);
  if (measured.length < 2) return [];
  const target = filmTarget(measured.map((entry) => entry.stats));
  const open = measured.filter((entry) => !looks[entry.clip.id]);
  const findings: ColorFinding[] = [];
  const darkest = [...open].sort((a, b) => a.stats.luma - b.stats.luma)[0];
  if (darkest && target.luma - darkest.stats.luma > 0.07) {
    findings.push({ kind: 'dark_cut', clipId: darkest.clip.id, clipNumber: darkest.number });
  }
  const brightest = [...open].sort((a, b) => b.stats.luma - a.stats.luma)[0];
  if (brightest && brightest.stats.luma - target.luma > 0.12) {
    findings.push({ kind: 'bright_cut', clipId: brightest.clip.id, clipNumber: brightest.number });
  }
  const warmths = open.map((entry) => entry.stats.warmth);
  if (open.length >= 2 && Math.max(...warmths) - Math.min(...warmths) > 0.05) {
    findings.push({ kind: 'mixed_temperature', clipIds: open.map((entry) => entry.clip.id) });
  }
  return findings;
}

/** Looks for the given cuts: each balanced towards `target` (the film's middle, or a reference frame). */
export function balanceLooks(
  project: ComposerProject,
  clipIds: readonly string[],
  stats: Readonly<Record<string, FrameStats>>,
  target: FrameStats,
  source: 'auto' | 'match',
  reference?: string,
): Record<string, ClipLook> {
  const out: Record<string, ClipLook> = {};
  for (const clip of project.clips) {
    if (!clipIds.includes(clip.id)) continue;
    const own = stats[clip.srcUrl];
    if (!own) continue;
    out[clip.id] = { source, detail: balanceDetail(own, target), strength: 1, ...(reference ? { reference } : {}) };
  }
  return out;
}

// ── Sound ──────────────────────────────────────────────────────────────────────────────────────

/** Integrated loudness most short-video platforms play back at. */
export const PLATFORM_LUFS = -14;

/** What the meter says for the film. `measured` is what analysis found before any outcome is applied. */
export function loudnessReadout(measured: number, sound: SoundState): { lufs: number; onTarget: boolean } {
  const lufs = sound.loudness ? PLATFORM_LUFS : measured;
  return { lufs, onTarget: Math.abs(lufs - PLATFORM_LUFS) <= 1 };
}

export interface EnvelopePoint {
  sec: number;
  /** `0..1` of the music's own level. */
  gain: number;
}

const DUCK_DOWN_SEC = 0.25;
const DUCK_UP_SEC = 0.6;

/**
 * The music level over time when it sits under speech: down just before each spoken stretch, back up
 * just after. Stretches closer together than the two ramps are treated as one.
 */
export function duckEnvelope(regions: readonly SpeechRegion[], durationSec: number, level: DuckLevel | null): EnvelopePoint[] {
  if (durationSec <= 0) return [];
  if (!level || regions.length === 0) return [{ sec: 0, gain: 1 }, { sec: durationSec, gain: 1 }];
  const low = round3(10 ** (-DUCK_DEPTH_DB[level] / 20));
  const sorted = regions
    .map((r) => ({ startSec: clamp(r.startSec, 0, durationSec), endSec: clamp(r.endSec, 0, durationSec) }))
    .filter((r) => r.endSec > r.startSec)
    .sort((a, b) => a.startSec - b.startSec);
  const merged: SpeechRegion[] = [];
  for (const region of sorted) {
    const last = merged[merged.length - 1];
    if (last && region.startSec - last.endSec < DUCK_DOWN_SEC + DUCK_UP_SEC) last.endSec = Math.max(last.endSec, region.endSec);
    else merged.push({ ...region });
  }
  const points: EnvelopePoint[] = [{ sec: 0, gain: merged[0] && merged[0].startSec <= DUCK_DOWN_SEC ? low : 1 }];
  for (const region of merged) {
    const downFrom = region.startSec - DUCK_DOWN_SEC;
    if (downFrom > 0) points.push({ sec: round3(downFrom), gain: 1 });
    points.push({ sec: round3(Math.max(0, region.startSec)), gain: low });
    points.push({ sec: round3(region.endSec), gain: low });
    const upAt = region.endSec + DUCK_UP_SEC;
    if (upAt < durationSec) points.push({ sec: round3(upAt), gain: 1 });
  }
  const tail = points[points.length - 1]!;
  if (tail.sec < durationSec) points.push({ sec: durationSec, gain: tail.gain });
  return points;
}

export type SoundFinding =
  | { kind: 'loudness'; measured: number; target: number }
  | { kind: 'music_over_speech'; count: number }
  | { kind: 'no_music' };

export function soundFindings(
  doc: Pick<EditorDoc, 'sound' | 'music'>,
  measuredLufs: number,
  regions: readonly SpeechRegion[],
): SoundFinding[] {
  const findings: SoundFinding[] = [];
  if (doc.music && regions.length > 0 && !doc.sound.duck) findings.push({ kind: 'music_over_speech', count: regions.length });
  if (!loudnessReadout(measuredLufs, doc.sound).onTarget) {
    findings.push({ kind: 'loudness', measured: measuredLufs, target: PLATFORM_LUFS });
  }
  if (!doc.music) findings.push({ kind: 'no_music' });
  return findings;
}

/** Deterministic bar heights (`0.12..1`) for a drawn waveform; the prototype has no audio to measure. */
export function waveform(seed: number, bars: number): number[] {
  let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const out: number[] = [];
  let level = 0.5;
  for (let i = 0; i < bars; i += 1) {
    state = (state * 48271) % 2147483647;
    const noise = state / 2147483647;
    level = clamp(level * 0.6 + noise * 0.5, 0.12, 1);
    out.push(round3(level));
  }
  return out;
}

// ── Captions ───────────────────────────────────────────────────────────────────────────────────

export type CaptionFinding =
  | { kind: 'no_captions'; spoken: number }
  | { kind: 'covered'; count: number; platform: Exclude<SafeArea, 'none'> };

export function captionFindings(doc: Pick<EditorDoc, 'project' | 'captionSettings'>, regions: readonly SpeechRegion[]): CaptionFinding[] {
  const { project, captionSettings } = doc;
  if (project.captions.length === 0) return regions.length > 0 ? [{ kind: 'no_captions', spoken: regions.length }] : [];
  const bottom = project.captions.filter((caption) => caption.position === 'bottom').length;
  if (project.aspect === '9:16' && captionSettings.safeArea !== 'none' && !captionSettings.lift && bottom > 0) {
    return [{ kind: 'covered', count: bottom, platform: captionSettings.safeArea }];
  }
  return [];
}

/** SubRip text for the film's captions: what "as a file" hands over. */
export function captionsToSrt(captions: ComposerProject['captions']): string {
  const stamp = (sec: number) => {
    const ms = Math.round(sec * 1000);
    const pad = (value: number, width: number) => String(value).padStart(width, '0');
    return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
  };
  return [...captions]
    .sort((a, b) => a.startSec - b.startSec)
    .map((caption, index) => `${index + 1}\n${stamp(caption.startSec)} --> ${stamp(caption.endSec)}\n${caption.text}\n`)
    .join('\n');
}

// ── Words → the same actions ───────────────────────────────────────────────────────────────────

export type AssistIntent =
  | { kind: 'aspect'; aspect: ComposerProject['aspect'] }
  | { kind: 'trim'; clipNumber: number; seconds: number }
  | { kind: 'remove_last' }
  | { kind: 'auto_balance' }
  | { kind: 'match_first' }
  | { kind: 'duck' }
  | { kind: 'loudness' }
  | { kind: 'speech_clear' }
  | { kind: 'make_captions' }
  | { kind: 'lift_captions' };

const ORDINALS: ReadonlyArray<[RegExp, number]> = [
  [/첫\s*(번째)?|\bfirst\b/i, 1],
  [/두\s*번째|둘째|\bsecond\b/i, 2],
  [/세\s*번째|셋째|\bthird\b/i, 3],
  [/네\s*번째|넷째|\bfourth\b/i, 4],
];

/**
 * The prototype's stand-in for the plan service: a few sentences mapped onto the same actions the
 * buttons run. The product keeps `lib/brand-studio/edit-assist` (rules, then the model) for this.
 */
export function interpretUtterance(raw: string): AssistIntent | null {
  const text = raw.trim();
  if (!text) return null;
  if (/자막/.test(text) || /caption|subtitle/i.test(text)) {
    if (/올려|위로|가려|안전|move.*up|lift|safe/i.test(text)) return { kind: 'lift_captions' };
    if (/만들|넣어|달아|생성|add|make|create|generate/i.test(text)) return { kind: 'make_captions' };
  }
  if (/세로|9\s*[:：]\s*16|vertical|portrait/i.test(text)) return { kind: 'aspect', aspect: '9:16' };
  if (/정사각|1\s*[:：]\s*1|square/i.test(text)) return { kind: 'aspect', aspect: '1:1' };
  if (/가로|16\s*[:：]\s*9|wide|landscape/i.test(text)) return { kind: 'aspect', aspect: '16:9' };
  if (/(말|목소리|음성|내레이션).*(또렷|선명|깨끗)|clear(er)?\s+(voice|speech)|(voice|speech).*clear/i.test(text)) {
    return { kind: 'speech_clear' };
  }
  if (/음악/.test(text) && /(줄여|낮춰|아래|깔아)/.test(text)) return { kind: 'duck' };
  if (/music/i.test(text) && /(under|duck|lower|down|quiet)/i.test(text)) return { kind: 'duck' };
  if (/(음량|소리 크기|볼륨).*(맞춰|기준)|loudness|lufs|normali[sz]e/i.test(text)) return { kind: 'loudness' };
  if (/(첫|1번).*(컷|장면).*(느낌|색|톤|처럼|맞춰|통일)|match.*first|(like|as)\s+(the\s+)?first\s+(cut|clip|shot|scene)/i.test(text)) return { kind: 'match_first' };
  if (/(색|톤|밝기).*(맞춰|균형|고르게|통일)|balance|even out.*colou?r/i.test(text)) return { kind: 'auto_balance' };
  if (/마지막.*(지워|삭제|빼)|(remove|delete).*last/i.test(text)) return { kind: 'remove_last' };
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(초|s\b|sec)/i);
  if (seconds && /(줄여|맞춰|짧게|trim|shorten|cut)/i.test(text)) {
    const ordinal = ORDINALS.find(([pattern]) => pattern.test(text));
    const numbered = text.match(/(\d+)\s*번\s*(컷|클립)|(?:cut|clip)\s*(\d+)/i);
    const clipNumber = ordinal ? ordinal[1] : numbered ? Number(numbered[1] ?? numbered[3]) : 0;
    if (clipNumber > 0) return { kind: 'trim', clipNumber, seconds: Number(seconds[1]) };
  }
  return null;
}

// ── History and small helpers ──────────────────────────────────────────────────────────────────

export interface EditorHistory {
  past: EditorDoc[];
  future: EditorDoc[];
}

export const HISTORY_LIMIT = 50;

export function commit(history: EditorHistory, before: EditorDoc): EditorHistory {
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(history: EditorHistory, current: EditorDoc): { history: EditorHistory; doc: EditorDoc } | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, doc: previous };
}

export function redo(history: EditorHistory, current: EditorDoc): { history: EditorHistory; doc: EditorDoc } | null {
  const next = history.future[0];
  if (!next) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, doc: next };
}

/** `0:21` for whole seconds, `0:04.7` when tenths matter. */
export function formatClock(sec: number, tenths = false): string {
  const safe = Math.max(0, sec);
  const whole = tenths ? Math.floor(safe) : Math.round(safe);
  const minutes = Math.floor(whole / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  if (!tenths) return `${minutes}:${seconds}`;
  return `${minutes}:${seconds}.${Math.floor((safe - Math.floor(safe)) * 10 + 1e-6)}`;
}

/** The envelope's level at a moment (straight lines between points). */
export function envelopeGainAt(points: readonly EnvelopePoint[], sec: number): number {
  if (points.length === 0) return 1;
  const first = points[0]!;
  if (sec <= first.sec) return first.gain;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (sec <= b.sec) return b.sec === a.sec ? b.gain : a.gain + ((b.gain - a.gain) * (sec - a.sec)) / (b.sec - a.sec);
  }
  return points[points.length - 1]!.gain;
}
