/**
 * The viewer's "next version" form as a small state machine (docs/BRAND-STUDIO-V6-PLAN.md §4), kept out of
 * React so it can be tested without a DOM. On open it asks `revise.plan` with no request (which ways are
 * open, what each costs, the default way). On send it asks again with the request; when the customer has
 * not picked a way by hand and the server suggests the other one, it stops on a suggestion row, otherwise
 * it creates the run at once. Nothing waits for the run itself: it is polled like any other.
 *
 * Marks (§4.5): up to three spots pointed at on the clip. Placing one writes its circled digit into the
 * request at the caret and, separately, `readMark` asks `revise.mark` what it is on (free; never blocks the
 * form). Removing one takes its digit out and renumbers the rest. Marks travel with `revise.plan` and with
 * the created version, then clear.
 */
import {
  STUDIO_LIMITS,
  STUDIO_REVISE_MODES,
  type ReviseMark,
  type StudioJobCreated,
  type StudioReviseMarkRead,
  type StudioReviseMode,
  type StudioRevisePlan,
  type StudioReviseReason,
} from "@/lib/brand-studio/contracts";
import { isFailure, type ApiResult } from "./api";
import { newRequestId } from "./copy";
import { toReferences, type TrayItem } from "./refs";
import { MARKS_MAX, insertDigit, removeDigit, toWireMarks, wireGeometry, type MarkGeometry, type MarkState } from "./revise-marks";

export interface ReviseState {
  phase: "loading" | "ready" | "checking" | "suggest" | "sending";
  plan: StudioRevisePlan | null;
  mode: StudioReviseMode;
  /** True once the customer chose a way by hand: no suggestion is shown then. */
  picked: boolean;
  prompt: string;
  references: TrayItem[];
  suggestion: { mode: StudioReviseMode; reason: StudioReviseReason | null } | null;
  /** Spots pointed at on the clip, in order (mark n is the n-th circled digit in `prompt`). */
  marks: MarkState[];
  /** An error code or `empty_prompt` / `unavailable`; the form turns it into a line. */
  note: string | null;
}

export interface ReviseDeps {
  organizationId: string;
  outputId: string;
  plan(input: RevisePlanInput): Promise<ApiResult<StudioRevisePlan>>;
  create(input: ReviseCreateInput): Promise<ApiResult<StudioJobCreated>>;
  onChange(state: ReviseState): void;
  /** `revise.mark`: what a spot is on. Absent: marks work by position only. */
  readMark?(input: ReviseMarkReadInput): Promise<ApiResult<StudioReviseMarkRead>>;
  /** The frame at the mark's time with the mark drawn on it (JPEG data URL), or null when it cannot be taken. */
  frame?(mark: MarkGeometry): Promise<string | null>;
  /** A version is on its way (the strip shows it from the store; the screen may say so too). */
  onCreated?(created: StudioJobCreated): void;
}

export interface RevisePlanInput {
  organizationId: string;
  outputId: string;
  prompt: string;
  references: ReturnType<typeof toReferences>;
  marks: ReviseMark[];
}

export type ReviseMarkReadInput = { organizationId: string; outputId: string; frame: string } & ReturnType<typeof wireGeometry>;

/** Most references one version may add (the run keeps a place for the clip itself). */
export const REVISE_REFERENCES_MAX = STUDIO_LIMITS.referencesMax - 1;

export const initialReviseState = (): ReviseState => ({
  phase: "loading",
  plan: null,
  mode: "edit",
  picked: false,
  prompt: "",
  references: [],
  suggestion: null,
  marks: [],
  note: null,
});

/** The way to select: the one asked for when it is open, else the first open one, else the one asked for. */
export function openMode(plan: StudioRevisePlan | null, wanted: StudioReviseMode): StudioReviseMode {
  if (!plan || plan.methods[wanted]?.available) return wanted;
  return STUDIO_REVISE_MODES.find((mode) => plan.methods[mode]?.available) ?? wanted;
}

export type ReviseCreateInput = ReturnType<typeof toCreate>;

function toCreate(input: { organizationId: string; outputId: string; mode: StudioReviseMode; prompt: string; references: TrayItem[]; marks: readonly MarkState[] }) {
  return {
    kind: "video_revise" as const,
    organizationId: input.organizationId,
    requestId: newRequestId(),
    outputId: input.outputId,
    mode: input.mode,
    prompt: input.prompt.trim(),
    references: toReferences(input.references.filter((r) => r.kind === "image"), "image"),
    marks: toWireMarks(input.marks),
  };
}

export function createReviseFlow(deps: ReviseDeps) {
  let state = initialReviseState();
  const set = (patch: Partial<ReviseState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };
  const ask = (prompt: string) =>
    deps.plan({ organizationId: deps.organizationId, outputId: deps.outputId, prompt, references: toReferences(state.references, "image"), marks: toWireMarks(state.marks) });
  /** A typing or marking change: a pending suggestion no longer applies. */
  const edited = (): Partial<ReviseState> => ({ suggestion: null, phase: state.phase === "suggest" ? "ready" : state.phase });
  let nextKey = 0;
  /** Bumped on every read and move, so a late answer for an older position is dropped. */
  const reads = new Map<string, number>();
  const patchMark = (key: string, patch: Partial<MarkState>) => {
    if (!state.marks.some((m) => m.key === key)) return;
    set({ marks: state.marks.map((m) => (m.key === key ? { ...m, ...patch } : m)) });
  };

  /** Asks what the mark is on; the chip shows the answer. A failed or empty reading leaves the time on the chip. */
  async function readMark(key: string) {
    const mark = state.marks.find((m) => m.key === key);
    if (!mark || !deps.readMark) return;
    const token = (reads.get(key) ?? 0) + 1;
    reads.set(key, token);
    patchMark(key, { reading: true });
    const current = () => reads.get(key) === token && state.marks.some((m) => m.key === key);
    let frame: string | null = null;
    try {
      frame = deps.frame ? await deps.frame(mark) : null;
    } catch {
      frame = null;
    }
    if (!current()) return;
    if (!frame) return patchMark(key, { reading: false });
    let answer: ApiResult<StudioReviseMarkRead>;
    try {
      answer = await deps.readMark({ organizationId: deps.organizationId, outputId: deps.outputId, ...wireGeometry(mark), frame });
    } catch {
      answer = { ok: false, code: "failed" };
    }
    if (!current()) return;
    if (isFailure(answer)) return patchMark(key, { reading: false, label: null, what: null });
    patchMark(key, { reading: false, label: answer.label?.trim() || null, what: answer.what?.trim() || null });
  }

  async function load() {
    set({ phase: "loading", note: null });
    const plan = await ask("");
    if (isFailure(plan)) return set({ phase: "ready", note: plan.code });
    set({ phase: "ready", plan, mode: openMode(plan, state.picked ? state.mode : (plan.recommended ?? state.mode)) });
  }

  async function create(mode: StudioReviseMode) {
    set({ phase: "sending", mode, suggestion: null, note: null });
    const result = await deps.create(toCreate({ organizationId: deps.organizationId, outputId: deps.outputId, mode, prompt: state.prompt, references: state.references, marks: state.marks }));
    if (isFailure(result)) return set({ phase: "ready", note: result.code });
    // The form clears; the plan answers the next version's number on the next open.
    const plan = state.plan ? { ...state.plan, version: state.plan.version + 1 } : null;
    reads.clear();
    set({ phase: "ready", prompt: "", references: [], marks: [], picked: false, plan });
    deps.onCreated?.(result);
  }

  async function submit() {
    if (state.phase === "checking" || state.phase === "sending") return;
    if (!state.prompt.trim()) return set({ note: "empty_prompt" });
    set({ phase: "checking", note: null, suggestion: null });
    const plan = await ask(state.prompt.trim());
    if (isFailure(plan)) return set({ phase: "ready", note: plan.code });
    set({ plan });
    const { recommended } = plan;
    if (!plan.methods[state.mode]?.available) {
      const other = openMode(plan, state.mode);
      if (other === state.mode) return set({ phase: "ready", note: "unavailable" });
      return set({ phase: "suggest", suggestion: { mode: other, reason: recommended === other ? plan.reason : null } });
    }
    if (!state.picked && recommended && recommended !== state.mode && plan.methods[recommended]?.available)
      return set({ phase: "suggest", suggestion: { mode: recommended, reason: plan.reason } });
    await create(state.mode);
  }

  return {
    get state() {
      return state;
    },
    load,
    submit,
    /** The suggestion row: `true` switches to the suggested way, `false` keeps the selected one. */
    async accept(change: boolean) {
      const suggestion = state.suggestion;
      if (state.phase !== "suggest" || !suggestion) return;
      if (!change && !state.plan?.methods[state.mode]?.available) return;
      await create(change ? suggestion.mode : state.mode);
    },
    pick(mode: StudioReviseMode) {
      if (state.plan && !state.plan.methods[mode]?.available) return;
      set({ mode, picked: true, suggestion: null, phase: state.phase === "suggest" ? "ready" : state.phase });
    },
    setPrompt(prompt: string) {
      set({ prompt: prompt.slice(0, STUDIO_LIMITS.promptMax), note: null, ...edited() });
    },
    setReferences(references: TrayItem[]) {
      set({ references: references.filter((r) => r.kind === "image").slice(0, REVISE_REFERENCES_MAX), ...edited() });
    },
    note(code: string | null) {
      set({ note: code });
    },
    /**
     * Places a mark (pin or box) and writes its digit into the request at `caret` (the end when null).
     * Returns its key and the caret after the digit, or null when the marks are full. Reading it is a
     * separate call (`readMark`).
     */
    addMark(geometry: MarkGeometry, caret: number | null): { key: string; caret: number } | null {
      if (state.marks.length >= MARKS_MAX || state.phase === "sending" || state.phase === "checking") return null;
      const key = `m${(nextKey += 1)}`;
      const written = insertDigit(state.prompt, caret, state.marks.length + 1);
      const mark: MarkState = { key, ...geometry, label: null, what: null, reading: false };
      set({ marks: [...state.marks, mark], prompt: written.text.slice(0, STUDIO_LIMITS.promptMax), note: null, ...edited() });
      return { key, caret: Math.min(written.caret, STUDIO_LIMITS.promptMax) };
    },
    /** Takes a mark away with its digit; the later marks and their digits move up one. */
    removeMark(key: string) {
      const index = state.marks.findIndex((m) => m.key === key);
      if (index < 0 || state.phase === "sending" || state.phase === "checking") return;
      reads.delete(key);
      set({ marks: state.marks.filter((m) => m.key !== key), prompt: removeDigit(state.prompt, index + 1), ...edited() });
    },
    /** New geometry for a mark (keyboard nudge). Any reading in flight is dropped; the screen reads it again after a pause. */
    moveMark(key: string, geometry: Partial<MarkGeometry>) {
      if (!state.marks.some((m) => m.key === key)) return;
      reads.set(key, (reads.get(key) ?? 0) + 1);
      set({ marks: state.marks.map((m) => (m.key === key ? { ...m, ...geometry, reading: Boolean(deps.readMark) } : m)), ...edited() });
    },
    readMark,
  };
}

export type ReviseFlow = ReturnType<typeof createReviseFlow>;
