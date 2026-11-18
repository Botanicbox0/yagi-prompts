/**
 * A finished partial edit ("부분 수정") inside the layer editor, and the small bar that follows it under the
 * picture: "수정 사항이 적용되었습니다" · 원본 비교 (hold) · 되돌리기 · 경계 다듬기.
 *
 * - A succeeded job with an image always lands as a patch layer over the picture: one undo step, the patch
 *   selected, the region box cleared, the tool left as it was.
 * - The bar belongs to the latest patch. It goes when the patch is gone (undone, deleted, reset), when
 *   another tool or layer is picked, when a new box is drawn or sent, on save and on close.
 * - "원본 비교" hides the patch on the stage only: no history step, no draft change.
 *
 * Pure so the rules are tested without a DOM (tests/brand-studio/layers/region-result.test.tsx).
 */
import type { RegionBox, StudioOutputView } from "@/lib/brand-studio/contracts";
import { pictureBoxToWorld } from "./canvas";
import type { FillSent } from "./fill";
import { commit, undo, type History } from "./history";
import { MAX_LAYERS, addLayer, createPatchLayer, findLayer, removeLayer, setBaseHidden, updateLayer, type LayerDoc, type LayerTool } from "./model";

/** A partial edit sent from the editor that it waits for. */
export interface TrackedRegionJob {
  jobId: string;
  box: RegionBox;
  /** "빈 곳 채우기": the box is in fractions of the canvas as it was sent, not of the picture. */
  fill?: FillSent;
}

/** What the editor keeps about a partial edit it has just sent. */
export function trackRegionJob(jobId: string, meta: { box: RegionBox }): TrackedRegionJob {
  return { jobId, box: meta.box };
}

/* ------------------------------------------------------------ landing a patch */

export interface PatchLanding {
  url: string;
  maskUrl: string | null;
  outputId: string;
  /** Fractions of the picture. */
  box: RegionBox;
}

/** The stored patch of a result (or the whole result over the sent box when there is none). */
export function patchLanding(entry: TrackedRegionJob, output: StudioOutputView): PatchLanding {
  const rp = output.regionPatch;
  return {
    url: rp?.url ?? output.url,
    maskUrl: rp?.maskUrl ?? null,
    outputId: output.id,
    box: rp ? { x: rp.x, y: rp.y, w: rp.w, h: rp.h } : entry.box,
  };
}

/** The document with the patch as a new top layer, placed wherever the picture sits on the canvas now. */
export function withRegionPatch(
  doc: LayerDoc,
  landing: PatchLanding,
  opts: { id: string; name: string; maskDataUrl: string | null },
): LayerDoc {
  if (doc.layers.length >= MAX_LAYERS) return doc;
  const layer = createPatchLayer(doc, {
    id: opts.id,
    url: landing.url,
    ref: { outputId: landing.outputId },
    box: pictureBoxToWorld(doc, landing.box),
    name: opts.name,
    maskDataUrl: opts.maskDataUrl,
  });
  return addLayer(doc, layer);
}

export interface EditorFocus {
  tool: LayerTool;
  selectedId: string | null;
  regionBox: RegionBox | null;
}

/** A landed patch is selected and the box is cleared; the tool stays what the customer had. */
export function focusAfterPatch(focus: EditorFocus, layerId: string): EditorFocus {
  return { tool: focus.tool, selectedId: layerId, regionBox: null };
}

/** "경계 다듬기": the patch selected and the eraser in hand. */
export function focusForRefine(focus: EditorFocus, layerId: string): EditorFocus {
  return { tool: "eraser", selectedId: layerId, regionBox: focus.regionBox };
}

/* ------------------------------------------------------------------ the bar */

/** Margin the fitted picture keeps inside the free part of the stage (index.tsx `fit`). */
export const FIT_MARGIN = { phone: 12, wide: 28 } as const;
/** Larger screens: the bar sits this far from the bottom at this height (layers.css `.bsl-result-wrap`). */
export const RESULT_BAR_BOX = { bottom: 16, height: 48 } as const;
/**
 * Larger screens, wherever partial edits are possible: the bottom inset the fit keeps free, so a result never
 * covers the fitted picture (8 px of air above the bar) and nothing moves when the bar appears. Phones keep
 * their layout (the bar sits on the bottom bar there).
 */
export const RESULT_STRIP = RESULT_BAR_BOX.bottom + RESULT_BAR_BOX.height + 8 - FIT_MARGIN.wide;

export interface ResultBar {
  layerId: string;
  jobId: string;
  /** The tool the bar goes with; picking another one dismisses it ("경계 다듬기" moves it to the eraser). */
  tool: LayerTool;
  /** "원본 비교" is held: the patch is hidden on the stage only. */
  comparing: boolean;
}

export interface ResultBarState {
  bar: ResultBar | null;
  /** Order of results reaching the editor; an older one landing late never takes the bar. */
  seq: number;
}

export const RESULT_BAR_IDLE: ResultBarState = { bar: null, seq: 0 };

export type ResultBarAction =
  | { type: "applied"; layerId: string; jobId: string; seq: number; tool: LayerTool }
  | { type: "compare"; on: boolean }
  | { type: "refine" }
  | { type: "dismiss" };

export function resultBarReducer(state: ResultBarState, action: ResultBarAction): ResultBarState {
  switch (action.type) {
    case "applied":
      if (action.seq < state.seq) return state;
      return { bar: { layerId: action.layerId, jobId: action.jobId, tool: action.tool, comparing: false }, seq: action.seq };
    case "compare":
      if (!state.bar || state.bar.comparing === action.on) return state;
      return { ...state, bar: { ...state.bar, comparing: action.on } };
    case "refine":
      if (!state.bar) return state;
      return { ...state, bar: { ...state.bar, tool: "eraser", comparing: false } };
    case "dismiss":
      return state.bar ? { ...state, bar: null } : state;
  }
}

/** Whether the bar still belongs on screen given what the editor shows now. */
export function barSurvives(bar: ResultBar, now: EditorFocus & { doc: LayerDoc }): boolean {
  // Undone past, deleted, or cleared with "처음으로".
  if (!findLayer(now.doc, bar.layerId)) return false;
  if (now.tool !== bar.tool) return false;
  // Another layer picked; clicking empty canvas (no selection) keeps it.
  if (now.selectedId !== null && now.selectedId !== bar.layerId) return false;
  // A new area is being selected.
  if (now.regionBox !== null) return false;
  return true;
}

/**
 * "원본 비교" is display-only. While it is held the editor takes no editing input at all: pointer down on the
 * canvas, drops, tool and edit shortcuts, undo/redo keys and paste are ignored (the stage's `inputLocked`),
 * and a drag already under way is dropped (stage.tsx `compareInterrupts`).
 */
export function editsBlocked(bar: ResultBar | null): boolean {
  return Boolean(bar?.comparing);
}

/** A stage edit (preview, settle, typed text) reaching the history while compare is held keeps it as it was. */
export function guardStageEdit<T>(h: History<T>, next: History<T>, blocked: boolean): History<T> {
  return blocked ? h : next;
}

/** The document the stage draws: while "원본 비교" is held, the picture without the patch. Never an input. */
export function stageDocFor(doc: LayerDoc, bar: ResultBar | null): LayerDoc {
  if (!bar?.comparing || !findLayer(doc, bar.layerId)) return doc;
  return setBaseHidden(updateLayer(doc, bar.layerId, { hidden: true }), false);
}

/** True when adding this patch is the newest step, so plain undo takes exactly it away. */
export function patchIsLatestStep(h: History<LayerDoc>, layerId: string): boolean {
  const previous = h.past[h.past.length - 1];
  return previous !== undefined && Boolean(findLayer(h.present, layerId)) && !findLayer(previous, layerId);
}

/** "되돌리기" on the bar: undo the patch's own step, or, after later edits, take the patch out as a new step. */
export function undoPatch(h: History<LayerDoc>, layerId: string): History<LayerDoc> {
  if (!findLayer(h.present, layerId)) return h;
  if (patchIsLatestStep(h, layerId)) return undo(h);
  return commit(h, removeLayer(h.present, layerId));
}

/* ----------------------------------------------------------- press and hold */

/** Keys that hold "원본 비교" while the button has focus. */
export const isHoldKey = (key: string) => key === " " || key === "Spacebar" || key === "Enter";

export interface Hold {
  press(): void;
  release(): void;
  readonly held: boolean;
}

/** Press-and-hold: one change on press, one on release; extra presses and releases do nothing. */
export function createHold(onChange: (held: boolean) => void): Hold {
  let held = false;
  return {
    press() {
      if (held) return;
      held = true;
      onChange(true);
    },
    release() {
      if (!held) return;
      held = false;
      onChange(false);
    },
    get held() {
      return held;
    },
  };
}

/**
 * On a phone the bar appears where the region sheet's send button was, so a second tap on that spot must not
 * undo the result: for this long after the bar appears (or shows again when a sheet closes) its buttons
 * ignore activation. They are not drawn disabled.
 */
export const BAR_ARM_MS = 500;

export interface ArmGuard {
  arm(): void;
  ready(): boolean;
}

export function createArmGuard(now: () => number = () => Date.now(), delayMs = BAR_ARM_MS): ArmGuard {
  let since = now();
  return {
    arm() {
      since = now();
    },
    ready() {
      return now() - since >= delayMs;
    },
  };
}

export interface BarControls {
  pressCompare(): void;
  releaseCompare(): void;
  undo(): void;
  refine(): void;
  /** The bar is visible again: start the quiet time over. */
  arm(): void;
}

/** Everything the bar's buttons do, pointer and keyboard alike: armed after BAR_ARM_MS, compare held. */
export function createBarControls(
  handlers: { onCompare(held: boolean): void; onUndo(): void; onRefine(): void },
  now: () => number = () => Date.now(),
): BarControls {
  const guard = createArmGuard(now);
  const hold = createHold((held) => handlers.onCompare(held));
  return {
    pressCompare() {
      if (guard.ready()) hold.press();
    },
    releaseCompare() {
      hold.release();
    },
    undo() {
      if (guard.ready()) handlers.onUndo();
    },
    refine() {
      if (guard.ready()) handlers.onRefine();
    },
    arm() {
      guard.arm();
    },
  };
}
