/**
 * Pure layout model for Editing Studio v2 (slice E-L).
 *
 * Holds default per-workspace lane heights, customer override merging, clamping rules for the
 * preview/timeline border and lane heights, keyboard step helpers, filmstrip tile sizing, and strict
 * storage payload parsing. Presentation only: nothing here touches the DOM, timers, storage, or
 * the film document.
 */
import type { EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';

export const LAYOUT_STORAGE_KEY = 'twings_editor_layout_v1';
export const LAYOUT_VERSION = 1;

export const LANE_KINDS = ['titles', 'video', 'captions', 'voice', 'music'] as const;
export type LaneKind = (typeof LANE_KINDS)[number];
export type AssistDock = 'bar' | 'side';

export interface EditorLayout {
  v: 1;
  timelineHeight: number | null;
  lanes: Partial<Record<LaneKind, number>>;
  assistDock: AssistDock;
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = {
  v: LAYOUT_VERSION,
  timelineHeight: null,
  lanes: {},
  assistDock: 'bar',
};

export const LANE_MIN_HEIGHT = 22;
export const LANE_MAX_HEIGHT = 160;
export const LANE_KEY_STEP = 4;

export const MIN_PREVIEW_HEIGHT = 180;
export const MAX_TIMELINE_RATIO = 0.65;
export const TIMELINE_KEY_STEP = 16;

export const RULER_HEIGHT = 24;
export const LANE_GAP = 4;
/** `.timeline` vertical padding (6px top + 10px bottom) + `.timelineBar` height (30px). */
export const TIMELINE_CHROME_HEIGHT = 46;
export const TOP_BAR_HEIGHT = 44;
export const ASSIST_BAR_HEIGHT = 44;
/** `.stage` vertical padding (10px + 6px) + gap (6px) + `.transport` min-height (36px). */
export const PREVIEW_CHROME_HEIGHT = 58;
export const ROOT_GAP = 8;
export const ROOT_MIN_HEIGHT = 620;
export const ROOT_SHELL_MARGIN = 24;
export const DEFAULT_EDITOR_HEIGHT = 876;
export const DRAG_THRESHOLD_PX = 3;
export const MIN_TILE_PX = 96;
export const MIN_CUSTOM_TILE_PX = 32;
export const TILE_WIDTH_STEP = 16;
export const DECODE_HEIGHT_STEPS = [72, 108, 144, 160] as const;

export const MAX_STORED_TIMELINE_HEIGHT = 4096;

export const SAMPLE_BASE_LANES: Readonly<Record<LaneKind, number>> = {
  titles: 22,
  video: 54,
  captions: 22,
  voice: 28,
  music: 28,
};

export const SAMPLE_WORKSPACE_OVERRIDES: Readonly<Record<EditorWorkspace, Partial<Record<LaneKind, number>>>> = {
  cut: {},
  color: { video: 66, voice: 22, music: 22 },
  sound: { video: 34, voice: 40, music: 40 },
  captions: { video: 40, captions: 38, music: 22 },
};

export const REAL_BASE_LANES: Readonly<Record<LaneKind, number>> = {
  titles: 22,
  video: 64,
  captions: 24,
  voice: 28,
  music: 28,
};

const SAMPLE_LANES: readonly LaneKind[] = ['titles', 'video', 'captions', 'voice', 'music'];
const REAL_LANES: readonly LaneKind[] = ['video', 'captions'];

export function visibleLanes(isReal: boolean): readonly LaneKind[] {
  return isReal ? REAL_LANES : SAMPLE_LANES;
}

export function defaultLaneHeight(kind: LaneKind, workspace: EditorWorkspace, isReal: boolean): number {
  if (isReal) return REAL_BASE_LANES[kind];
  return SAMPLE_WORKSPACE_OVERRIDES[workspace][kind] ?? SAMPLE_BASE_LANES[kind];
}

export function clampLaneHeight(height: number): number {
  if (!Number.isFinite(height)) return LANE_MIN_HEIGHT;
  return Math.min(LANE_MAX_HEIGHT, Math.max(LANE_MIN_HEIGHT, Math.round(height)));
}

export function effectiveLaneHeight(
  layout: EditorLayout,
  kind: LaneKind,
  workspace: EditorWorkspace,
  isReal: boolean,
): number {
  const custom = layout.lanes[kind];
  return custom !== undefined ? clampLaneHeight(custom) : defaultLaneHeight(kind, workspace, isReal);
}

export function withLaneHeight(layout: EditorLayout, kind: LaneKind, height: number | null): EditorLayout {
  if (height === null) {
    if (!(kind in layout.lanes)) return layout;
    const lanes = { ...layout.lanes };
    delete lanes[kind];
    return { ...layout, lanes };
  }
  const clamped = clampLaneHeight(height);
  if (layout.lanes[kind] === clamped) return layout;
  return { ...layout, lanes: { ...layout.lanes, [kind]: clamped } };
}

export function withTimelineHeight(layout: EditorLayout, height: number | null): EditorLayout {
  const next = height === null ? null : Math.max(1, Math.round(height));
  if (layout.timelineHeight === next) return layout;
  return { ...layout, timelineHeight: next };
}

export function withAssistDock(layout: EditorLayout, dock: AssistDock): EditorLayout {
  if (layout.assistDock === dock) return layout;
  return { ...layout, assistDock: dock };
}

export interface KeyModifiers {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export function hasKeyModifier(modifiers?: KeyModifiers): boolean {
  return Boolean(modifiers?.shiftKey || modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.altKey);
}

export function isLayoutSized(layout: EditorLayout): boolean {
  if (layout.timelineHeight !== null) return true;
  for (const kind of LANE_KINDS) {
    if (layout.lanes[kind] !== undefined) return true;
  }
  return false;
}

export function aboveVideoLaneHeights(
  layout: EditorLayout,
  workspace: EditorWorkspace,
  isReal: boolean,
): number[] {
  const lanes = visibleLanes(isReal);
  const videoIndex = lanes.indexOf('video');
  if (videoIndex <= 0) return [];
  return lanes.slice(0, videoIndex).map((kind) => effectiveLaneHeight(layout, kind, workspace, isReal));
}

export interface TimelineBoundsInput {
  editorHeight: number;
  assistDock: AssistDock;
  videoLaneHeight: number;
  aboveVideoHeights?: readonly number[];
  topBarHeight?: number;
  assistBarHeight?: number;
  previewChromeHeight?: number;
  timelineChromeHeight?: number;
}

export interface TimelineBounds {
  min: number;
  max: number;
}

export function timelineBounds(input: TimelineBoundsInput): TimelineBounds {
  const editorHeight = Number.isFinite(input.editorHeight) && input.editorHeight > 0 ? input.editorHeight : DEFAULT_EDITOR_HEIGHT;
  const topBarHeight = Number.isFinite(input.topBarHeight) && (input.topBarHeight ?? 0) > 0 ? input.topBarHeight! : TOP_BAR_HEIGHT;
  const assistBarHeight = Number.isFinite(input.assistBarHeight) && (input.assistBarHeight ?? 0) > 0 ? input.assistBarHeight! : ASSIST_BAR_HEIGHT;
  const previewChromeHeight = Number.isFinite(input.previewChromeHeight) && (input.previewChromeHeight ?? 0) > 0 ? input.previewChromeHeight! : PREVIEW_CHROME_HEIGHT;
  const chromeHeight = Number.isFinite(input.timelineChromeHeight) && (input.timelineChromeHeight ?? 0) > 0 ? input.timelineChromeHeight! : TIMELINE_CHROME_HEIGHT;
  const videoHeight = clampLaneHeight(input.videoLaneHeight);
  const aboveHeights = (input.aboveVideoHeights ?? []).map((h) => clampLaneHeight(h));
  const aboveSum = aboveHeights.reduce((sum, h) => sum + h, 0);

  const rawMin = Math.round(chromeHeight + RULER_HEIGHT + aboveSum + (aboveHeights.length + 1) * LANE_GAP + videoHeight);
  const bottomOverhead = input.assistDock === 'bar' ? assistBarHeight + ROOT_GAP : 0;
  const maxForPreview = Math.max(
    0,
    Math.floor(editorHeight - topBarHeight - 2 * ROOT_GAP - (MIN_PREVIEW_HEIGHT + previewChromeHeight) - bottomOverhead),
  );
  const ratioCap = Math.max(0, Math.floor(editorHeight * MAX_TIMELINE_RATIO));
  const max = Math.min(ratioCap, maxForPreview);
  const min = Math.min(rawMin, max);
  return { min, max };
}

export function clampTimelineHeight(height: number, bounds: TimelineBounds): number {
  if (!Number.isFinite(height)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(height)));
}

export function defaultTimelineHeight(
  layout: EditorLayout,
  workspace: EditorWorkspace,
  isReal: boolean,
  timelineChromeHeight = TIMELINE_CHROME_HEIGHT,
): number {
  const lanes = visibleLanes(isReal);
  const laneSum = lanes.reduce((sum, kind) => sum + effectiveLaneHeight(layout, kind, workspace, isReal), 0);
  // Ruler row + each visible lane row, separated by `LANE_GAP` between adjacent grid rows.
  return Math.round(timelineChromeHeight + RULER_HEIGHT + laneSum + lanes.length * LANE_GAP);
}

export function clampLayoutForViewport(layout: EditorLayout, bounds: TimelineBounds): EditorLayout {
  if (layout.timelineHeight === null) return layout;
  const clamped = clampTimelineHeight(layout.timelineHeight, bounds);
  if (clamped === layout.timelineHeight) return layout;
  return { ...layout, timelineHeight: clamped };
}

export function sanitizeEditorLayout(layout: EditorLayout): EditorLayout {
  const lanes: Partial<Record<LaneKind, number>> = {};
  for (const kind of LANE_KINDS) {
    const val = layout.lanes[kind];
    if (typeof val === 'number' && Number.isFinite(val)) {
      lanes[kind] = clampLaneHeight(val);
    }
  }
  const timelineHeight =
    typeof layout.timelineHeight === 'number' && Number.isFinite(layout.timelineHeight) && layout.timelineHeight > 0
      ? Math.min(MAX_STORED_TIMELINE_HEIGHT, Math.round(layout.timelineHeight))
      : null;
  const assistDock: AssistDock = layout.assistDock === 'side' ? 'side' : 'bar';
  return { v: LAYOUT_VERSION, timelineHeight, lanes, assistDock };
}

export function parseEditorLayout(raw: unknown, bounds?: TimelineBounds): EditorLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_EDITOR_LAYOUT;
  const record = raw as Record<string, unknown>;
  if (record.v !== LAYOUT_VERSION) return DEFAULT_EDITOR_LAYOUT;

  let timelineHeight: number | null = null;
  if (typeof record.timelineHeight === 'number' && Number.isFinite(record.timelineHeight) && record.timelineHeight > 0) {
    const rounded = Math.min(MAX_STORED_TIMELINE_HEIGHT, Math.round(record.timelineHeight));
    timelineHeight = bounds ? clampTimelineHeight(rounded, bounds) : rounded;
  }

  const lanes: Partial<Record<LaneKind, number>> = {};
  if (record.lanes && typeof record.lanes === 'object' && !Array.isArray(record.lanes)) {
    const rawLanes = record.lanes as Record<string, unknown>;
    for (const kind of LANE_KINDS) {
      const value = rawLanes[kind];
      if (typeof value === 'number' && Number.isFinite(value)) {
        lanes[kind] = clampLaneHeight(value);
      }
    }
  }

  const assistDock: AssistDock = record.assistDock === 'side' ? 'side' : 'bar';
  return { v: LAYOUT_VERSION, timelineHeight, lanes, assistDock };
}

export function stepTimelineByKey(
  key: string,
  currentHeight: number,
  bounds: TimelineBounds,
  modifiers?: KeyModifiers,
): { handled: boolean; next: number | null } {
  if (hasKeyModifier(modifiers)) return { handled: false, next: currentHeight };
  switch (key) {
    case 'ArrowUp':
      return { handled: true, next: clampTimelineHeight(currentHeight + TIMELINE_KEY_STEP, bounds) };
    case 'ArrowDown':
      return { handled: true, next: clampTimelineHeight(currentHeight - TIMELINE_KEY_STEP, bounds) };
    case 'Home':
      return { handled: true, next: bounds.min };
    case 'End':
      return { handled: true, next: bounds.max };
    case 'Enter':
      return { handled: true, next: null };
    default:
      return { handled: false, next: currentHeight };
  }
}

export function stepLaneByKey(
  key: string,
  currentHeight: number,
  modifiers?: KeyModifiers,
): { handled: boolean; next: number | null } {
  if (hasKeyModifier(modifiers)) return { handled: false, next: currentHeight };
  switch (key) {
    case 'ArrowDown':
      return { handled: true, next: clampLaneHeight(currentHeight + LANE_KEY_STEP) };
    case 'ArrowUp':
      return { handled: true, next: clampLaneHeight(currentHeight - LANE_KEY_STEP) };
    case 'Home':
      return { handled: true, next: LANE_MIN_HEIGHT };
    case 'End':
      return { handled: true, next: LANE_MAX_HEIGHT };
    case 'Enter':
      return { handled: true, next: null };
    default:
      return { handled: false, next: currentHeight };
  }
}

/** Decode target height (rounded up to `[72, 108, 144, 160]` steps; untouched lanes decode at 72px). */
export function thumbDecodeHeight(customVideoHeight: number | undefined): number {
  if (customVideoHeight === undefined) return DECODE_HEIGHT_STEPS[0];
  const clamped = clampLaneHeight(customVideoHeight);
  for (const step of DECODE_HEIGHT_STEPS) {
    if (clamped <= step) return step;
  }
  return DECODE_HEIGHT_STEPS[3];
}

/**
 * Filmstrip tile width for the video lane. Untouched lanes stay at `96px` (exact `main` parity);
 * once sized, tiles track the clip's own aspect ratio quantized to 16px steps.
 */
export function filmstripTileWidth(customVideoHeight: number | undefined, clipRatio = 16 / 9): number {
  if (customVideoHeight === undefined) return MIN_TILE_PX;
  const h = clampLaneHeight(customVideoHeight);
  const ratio = Number.isFinite(clipRatio) && clipRatio > 0 ? clipRatio : 16 / 9;
  return Math.max(MIN_CUSTOM_TILE_PX, Math.round((h * ratio) / TILE_WIDTH_STEP) * TILE_WIDTH_STEP);
}

/** Minimum horizontal pixel step between decoded frames so density never exceeds `MIN_TILE_PX` (96px). */
export function filmstripSampleStep(tilePx: number): number {
  return Math.max(MIN_TILE_PX, Math.round(tilePx));
}
