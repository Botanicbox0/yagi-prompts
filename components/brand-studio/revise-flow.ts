/**
 * The viewer's "next version" form as a small state machine (docs/BRAND-STUDIO-V6-PLAN.md §4), kept out of
 * React so it can be tested without a DOM. On open it asks `revise.plan` with no request (which ways are
 * open, what each costs, the default way). On send it asks again with the request; when the customer has
 * not picked a way by hand and the server suggests the other one, it stops on a suggestion row, otherwise
 * it creates the run at once. Nothing waits for the run itself: it is polled like any other.
 */
import {
  STUDIO_LIMITS,
  STUDIO_REVISE_MODES,
  type StudioJobCreated,
  type StudioReviseMode,
  type StudioRevisePlan,
  type StudioReviseReason,
} from "@/lib/brand-studio/contracts";
import { isFailure, type ApiResult } from "./api";
import { newRequestId } from "./copy";
import { toReferences, type TrayItem } from "./refs";

export interface ReviseState {
  phase: "loading" | "ready" | "checking" | "suggest" | "sending";
  plan: StudioRevisePlan | null;
  mode: StudioReviseMode;
  /** True once the customer chose a way by hand: no suggestion is shown then. */
  picked: boolean;
  prompt: string;
  references: TrayItem[];
  suggestion: { mode: StudioReviseMode; reason: StudioReviseReason | null } | null;
  /** An error code or `empty_prompt` / `unavailable`; the form turns it into a line. */
  note: string | null;
}

export interface ReviseDeps {
  organizationId: string;
  outputId: string;
  plan(input: { organizationId: string; outputId: string; prompt: string; references: ReturnType<typeof toReferences> }): Promise<ApiResult<StudioRevisePlan>>;
  create(input: ReviseCreateInput): Promise<ApiResult<StudioJobCreated>>;
  onChange(state: ReviseState): void;
  /** A version is on its way (the strip shows it from the store; the screen may say so too). */
  onCreated?(created: StudioJobCreated): void;
}

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
  note: null,
});

/** The way to select: the one asked for when it is open, else the first open one, else the one asked for. */
export function openMode(plan: StudioRevisePlan | null, wanted: StudioReviseMode): StudioReviseMode {
  if (!plan || plan.methods[wanted]?.available) return wanted;
  return STUDIO_REVISE_MODES.find((mode) => plan.methods[mode]?.available) ?? wanted;
}

export type ReviseCreateInput = ReturnType<typeof toCreate>;

function toCreate(input: { organizationId: string; outputId: string; mode: StudioReviseMode; prompt: string; references: TrayItem[] }) {
  return {
    kind: "video_revise" as const,
    organizationId: input.organizationId,
    requestId: newRequestId(),
    outputId: input.outputId,
    mode: input.mode,
    prompt: input.prompt.trim(),
    references: toReferences(input.references.filter((r) => r.kind === "image"), "image"),
  };
}

export function createReviseFlow(deps: ReviseDeps) {
  let state = initialReviseState();
  const set = (patch: Partial<ReviseState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };
  const ask = (prompt: string) =>
    deps.plan({ organizationId: deps.organizationId, outputId: deps.outputId, prompt, references: toReferences(state.references, "image") });

  async function load() {
    set({ phase: "loading", note: null });
    const plan = await ask("");
    if (isFailure(plan)) return set({ phase: "ready", note: plan.code });
    set({ phase: "ready", plan, mode: openMode(plan, state.picked ? state.mode : (plan.recommended ?? state.mode)) });
  }

  async function create(mode: StudioReviseMode) {
    set({ phase: "sending", mode, suggestion: null, note: null });
    const result = await deps.create(toCreate({ organizationId: deps.organizationId, outputId: deps.outputId, mode, prompt: state.prompt, references: state.references }));
    if (isFailure(result)) return set({ phase: "ready", note: result.code });
    // The form clears; the plan answers the next version's number on the next open.
    const plan = state.plan ? { ...state.plan, version: state.plan.version + 1 } : null;
    set({ phase: "ready", prompt: "", references: [], picked: false, plan });
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
      set({ prompt: prompt.slice(0, STUDIO_LIMITS.promptMax), suggestion: null, phase: state.phase === "suggest" ? "ready" : state.phase, note: null });
    },
    setReferences(references: TrayItem[]) {
      set({ references: references.filter((r) => r.kind === "image").slice(0, REVISE_REFERENCES_MAX), suggestion: null, phase: state.phase === "suggest" ? "ready" : state.phase });
    },
    note(code: string | null) {
      set({ note: code });
    },
  };
}

export type ReviseFlow = ReturnType<typeof createReviseFlow>;
