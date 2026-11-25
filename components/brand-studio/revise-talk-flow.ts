/**
 * The revise conversation on screen (flag `BRAND_STUDIO_REVISE_V2`, docs/BRAND-STUDIO-VIDEO-REMIX.md §3.5) as a
 * small state machine, kept out of React so it can be tested without a DOM. Every turn asks `revise.talk`
 * with the whole conversation; the server answers with the studio's message, the one change sheet, the
 * questions, the way and its credits and whether "이대로 만들기" may show. Nothing is made until `make`.
 *
 * The conversation is kept per output in the browser (`TalkStore`, localStorage behind try/catch): closing
 * the viewer, reloading, switching versions or moving to another video and back finds it again. "처음부터
 * 다시" clears it; making the version clears it.
 *
 * Without the flag none of this runs: the viewer shows the older form (revise-form.tsx) exactly as before.
 */
import {
  STUDIO_LIMITS,
  STUDIO_REVISE_MATERIALS_MAX,
  type ReviseMark,
  type StudioJobCreated,
  type StudioReviseMode,
  type StudioReviseTalk,
  type StudioAssetSaved,
  type StudioTalkKind,
} from "@/lib/brand-studio/contracts";
import type { UploadLimitReason } from "@/lib/brands/upload-limits-format";
import { emptySheet, sheetRequest, type ReviseQuestion, type ReviseSheet } from "@/lib/brand-studio/revision/sheet";
import { isFailure, uploadProblem, type ApiResult } from "./api";
import { newRequestId } from "./copy";
import { toReferences, trayItemFromAsset, type TrayItem } from "./refs";
import { toWireMarks, type MarkState } from "./revise-marks";

/** One line of the thread. */
export type TalkItem =
  | { id: string; from: "customer"; text: string; references: TrayItem[]; materials: TrayItem[]; marks: string[]; answers?: number }
  | { id: string; from: "studio"; text: string; kind: StudioTalkKind; question?: number; editStudio?: boolean }
  | { id: string; from: "note"; note: "failed" | "removed"; text?: string };

export interface TalkState {
  phase: "loading" | "idle" | "reading" | "slow" | "failed" | "making";
  thread: TalkItem[];
  sheet: ReviseSheet;
  questions: ReviseQuestion[];
  open: number | null;
  way: StudioReviseMode | null;
  estimateKrw: number;
  seconds: number | null;
  canMake: boolean;
  editStudio: boolean;
  /** The number the version made from this conversation gets. */
  version: number;
  /** Change lines that are new since the last turn (the card lights them up once). */
  fresh: string[];
  /** What is being typed and attached now (sent with the next message). */
  draft: string;
  references: TrayItem[];
  materials: TrayItem[];
  /** Every mark placed in this conversation (mark n is the n-th); those not yet sent are the draft's. */
  marks: MarkState[];
  /** A message that could not be read, kept for "다시 보내기". */
  pending: { text: string; answering?: { option?: number; decide?: boolean } } | null;
  /** An error code from the server (not a reading failure), or null. */
  note: string | null;
  /** Why the last attachment did not land (not kept between visits); a later clean upload clears it. */
  uploadNote?: TalkUploadNote | null;
  clipKnown: boolean;
}

/** What is kept in the browser between visits. */
export type TalkSaved = Pick<TalkState, "thread" | "sheet" | "questions" | "open" | "way" | "estimateKrw" | "seconds" | "canMake" | "editStudio" | "draft" | "references" | "materials" | "marks" | "pending">;

export interface TalkStore {
  load(): TalkSaved | null;
  save(saved: TalkSaved): void;
  clear(): void;
}

export type TalkInput = Parameters<TalkDeps["talk"]>[0];

export interface TalkDeps {
  organizationId: string;
  outputId: string;
  talk(input: {
    organizationId: string;
    outputId: string;
    message?: string;
    turns?: Array<{ role: "customer" | "studio"; text: string }>;
    sheet?: ReviseSheet;
    questions?: ReviseQuestion[];
    answering?: { option?: number; decide?: boolean };
    references?: ReturnType<typeof toReferences>;
    marks?: ReviseMark[];
    materials?: number;
    shown?: { way: StudioReviseMode | null; estimateKrw: number } | null;
    remove?: number;
  }): Promise<ApiResult<StudioReviseTalk>>;
  create(input: ReturnType<typeof createInput>): Promise<ApiResult<StudioJobCreated>>;
  store: TalkStore;
  onChange(state: TalkState): void;
  /** A version is on its way: the viewer moves to it. */
  onCreated?(created: StudioJobCreated, version: number, sheet: ReviseSheet): void;
  /** The words of the "decide for me" choice, as the customer's message. */
  decideText: string;
  /** Timers (tests pass fakes). */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/** After this long without an answer the thread says it is taking a little longer. */
export const TALK_SLOW_MS = 8_000;

export const initialTalkState = (version = 2): TalkState => ({
  phase: "loading",
  thread: [],
  sheet: emptySheet(),
  questions: [],
  open: null,
  way: null,
  estimateKrw: 0,
  seconds: null,
  canMake: false,
  editStudio: false,
  version,
  fresh: [],
  draft: "",
  references: [],
  materials: [],
  marks: [],
  pending: null,
  note: null,
  uploadNote: null,
  clipKnown: false,
});

/** Why an attachment did not land: an upload failure code (with its limit reason) or "attach_full". */
export interface TalkUploadNote {
  code: string;
  reason?: UploadLimitReason;
}

/** What an upload for the conversation brought back: the attachments, and the first reason one did not come. */
export interface TalkUpload {
  added: TrayItem[];
  failure: TalkUploadNote | null;
}

/** Pictures and clips: what the conversation takes (the "+" picker's accept list is the same kinds). */
const takesKind = (type: string) => type.startsWith("image/") || type.startsWith("video/");

/**
 * Uploads files for the conversation, one after another, with the studio's own checks: a wrong kind is
 * `unsupported_file` and never sent, a file over its size limit `file_too_large` (uploadProblem), and a
 * refusal from the server keeps its code and reason (storage, quota, network). The first failure is reported.
 */
export async function uploadForTalk<F extends { type: string; size: number }>(
  files: readonly F[],
  send: (file: F) => Promise<ApiResult<StudioAssetSaved>>,
): Promise<TalkUpload> {
  const added: TrayItem[] = [];
  let failure: TalkUploadNote | null = null;
  for (const file of files) {
    if (!takesKind(file.type)) {
      failure ??= { code: "unsupported_file" };
      continue;
    }
    const problem = uploadProblem(file);
    if (problem) {
      failure ??= { code: problem };
      continue;
    }
    const result = await send(file);
    if (isFailure(result)) {
      failure ??= { code: result.code, ...(result.reason ? { reason: result.reason } : {}) };
      continue;
    }
    added.push(trayItemFromAsset(result.asset));
  }
  return { added, failure };
}

/** The "+" button's limit, and the count it compares (pictures sent in the thread and attached now). */
export const TALK_ATTACH_MAX = STUDIO_LIMITS.referencesMax - 1 + STUDIO_REVISE_MATERIALS_MAX;
export const talkAttachedCount = (state: Pick<TalkState, "thread" | "references">) =>
  state.thread.reduce((n, i) => n + (i.from === "customer" ? i.references.length : 0), 0) + state.references.length;
export const talkBusy = (state: Pick<TalkState, "phase">) =>
  state.phase === "reading" || state.phase === "slow" || state.phase === "making" || state.phase === "loading";

/**
 * Whether files may be attached now: the same guards as the "+" button (off while uploading or busy, and at
 * the limit), so a drop never uploads what the conversation would then cut off.
 */
export function talkFilesRefusal(state: Pick<TalkState, "phase" | "thread" | "references" | "materials">, uploading: boolean): "busy" | "attach_full" | null {
  if (uploading || talkBusy(state)) return "busy";
  // Full: the "+" button's count, or no room left for a picture nor a clip (nothing could land).
  const noRoom = state.references.length >= STUDIO_LIMITS.referencesMax - 1 && state.materials.length >= STUDIO_REVISE_MATERIALS_MAX;
  return talkAttachedCount(state) >= TALK_ATTACH_MAX || noRoom ? "attach_full" : null;
}

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq += 1).toString(36)}`;

/** The thread as the server reads it: what the customer said and what the studio answered, in order. */
export function turnsOf(thread: readonly TalkItem[]): Array<{ role: "customer" | "studio"; text: string }> {
  const out: Array<{ role: "customer" | "studio"; text: string }> = [];
  for (const item of thread) if (item.from === "customer" || item.from === "studio") out.push({ role: item.from, text: item.text });
  return out;
}

/** The keys of the marks already sent. */
const saidMarkKeys = (thread: readonly TalkItem[]) => new Set(thread.flatMap((i) => (i.from === "customer" ? i.marks : [])));

/** Everything attached in the messages sent so far. */
function said(thread: readonly TalkItem[]) {
  const customer = thread.filter((i): i is Extract<TalkItem, { from: "customer" }> => i.from === "customer");
  return { references: customer.flatMap((c) => c.references), materials: customer.flatMap((c) => c.materials) };
}

export function createInput(input: { organizationId: string; outputId: string; state: TalkState }) {
  const { state } = input;
  const sent = said(state.thread);
  const keys = saidMarkKeys(state.thread);
  return {
    kind: "video_revise" as const,
    organizationId: input.organizationId,
    requestId: newRequestId(),
    outputId: input.outputId,
    mode: state.way ?? ("edit" as const),
    prompt: sheetRequest(state.sheet) || "-",
    references: toReferences(sent.references.filter((r) => r.kind === "image"), "image"),
    marks: toWireMarks(state.marks.filter((m) => keys.has(m.key))),
    materials: sent.materials.filter((m) => m.kind === "video").map((m) => (m.assetId ? { assetId: m.assetId } : { outputId: m.outputId! })),
    dialogue: {
      sheet: state.sheet,
      questions: state.questions,
      transcript: turnsOf(state.thread).slice(-40).map((t) => ({ ...t, text: t.text.slice(0, STUDIO_LIMITS.promptMax) })),
    },
  };
}

export function createTalkFlow(deps: TalkDeps & { fallbackVersion?: number }) {
  let state = initialTalkState(deps.fallbackVersion);
  let timer: unknown = null;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const persist = () => {
    const { thread, sheet, questions, open, way, estimateKrw, seconds, canMake, editStudio, draft, references, materials, marks, pending } = state;
    if (!thread.length && !draft.trim() && !references.length && !materials.length && !marks.length) return deps.store.clear();
    deps.store.save({ thread, sheet, questions, open, way, estimateKrw, seconds, canMake, editStudio, draft, references, materials, marks, pending });
  };
  const set = (patch: Partial<TalkState>, save = true) => {
    state = { ...state, ...patch };
    deps.onChange(state);
    if (save && state.phase !== "making") persist();
  };
  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const busy = () => state.phase === "reading" || state.phase === "slow" || state.phase === "making" || state.phase === "loading";

  /** What every reading call carries about the conversation so far. */
  const context = () => {
    const sent = said(state.thread);
    const keys = saidMarkKeys(state.thread);
    return {
      organizationId: deps.organizationId,
      outputId: deps.outputId,
      turns: turnsOf(state.thread),
      sheet: state.sheet,
      questions: state.questions,
      references: toReferences(sent.references.filter((r) => r.kind === "image"), "image"),
      marks: toWireMarks(state.marks.filter((m) => keys.has(m.key))),
      materials: sent.materials.length,
      shown: state.way ? { way: state.way, estimateKrw: state.estimateKrw } : null,
    };
  };

  /** Takes a server answer into the state (the sheet, the questions, the way and the button). */
  const take = (answer: StudioReviseTalk, extra: Partial<TalkState> = {}) => {
    const before = new Set(state.sheet.change.map((c) => c.text));
    set({
      sheet: answer.sheet,
      questions: answer.questions,
      open: answer.open,
      way: answer.way,
      estimateKrw: answer.estimateKrw,
      seconds: answer.seconds,
      canMake: answer.canMake,
      editStudio: answer.editStudio,
      version: answer.version,
      clipKnown: answer.clipKnown,
      fresh: answer.sheet.change.map((c) => c.text).filter((t) => !before.has(t)),
      note: null,
      ...extra,
    });
  };

  /** Asks the server about the message at the end of the thread. */
  async function read(text: string, answering?: { option?: number; decide?: boolean }) {
    stopTimer();
    set({ phase: "reading", pending: { text, ...(answering ? { answering } : {}) }, note: null });
    timer = setTimer(() => {
      if (state.phase === "reading") set({ phase: "slow" }, false);
    }, TALK_SLOW_MS);
    const ctx = context();
    // The message being read is the last customer line; the turns before it are the conversation.
    const turns = ctx.turns.slice(0, -1);
    let answer: ApiResult<StudioReviseTalk>;
    try {
      answer = await deps.talk({ ...ctx, turns, message: text, ...(answering ? { answering } : {}) });
    } catch {
      answer = { ok: false, code: "failed" };
    }
    stopTimer();
    if (isFailure(answer) || answer.failed || !answer.reply) {
      // Said out loud: the message could not be read; the thread offers to send it again. No button.
      if (!isFailure(answer) && answer.failed) {
        set({ phase: "failed", canMake: false, thread: [...state.thread, { id: nextId(), from: "note", note: "failed" }] });
      } else {
        set({ phase: "failed", canMake: false, note: isFailure(answer) && answer.code !== "failed" ? answer.code : null, thread: [...state.thread, { id: nextId(), from: "note", note: "failed" }] });
      }
      return;
    }
    const studio: TalkItem = { id: nextId(), from: "studio", text: answer.reply, kind: answer.kind ?? "change", ...(answer.open !== null ? { question: answer.open } : {}), ...(answer.editStudio ? { editStudio: true } : {}) };
    take(answer, { phase: "idle", pending: null, thread: [...state.thread, studio] });
  }

  return {
    get state() {
      return state;
    },
    /** Restores the kept conversation (if any), then asks the opening call: the clip is read once, the ways and credits come back. */
    async load() {
      let saved: TalkSaved | null = null;
      try {
        saved = deps.store.load();
      } catch {
        saved = null;
      }
      if (saved) set({ ...saved, phase: "loading", fresh: [] }, false);
      else if (state.phase !== "loading") set({ phase: "loading" }, false);
      // Only a message kept from before (not one sent while this call is on its way) is offered again.
      const restoredPending = state.pending;
      const ctx = context();
      let answer: ApiResult<StudioReviseTalk>;
      try {
        answer = await deps.talk({ organizationId: ctx.organizationId, outputId: ctx.outputId, sheet: ctx.sheet, questions: ctx.questions, shown: ctx.shown });
      } catch {
        answer = { ok: false, code: "failed" };
      }
      // The customer moved on while this was on its way (a second opening call, a message already sent):
      // only the version and whether the clip is known are taken; the conversation is left alone.
      if (state.phase !== "loading") {
        if (!isFailure(answer)) set({ version: answer.version, clipKnown: answer.clipKnown }, false);
        return;
      }
      // A message that was being read when the page went away is offered again, not lost.
      const phase = restoredPending ? "failed" : "idle";
      const thread = restoredPending && state.thread[state.thread.length - 1]?.from === "customer" ? [...state.thread, { id: nextId(), from: "note" as const, note: "failed" as const }] : state.thread;
      if (isFailure(answer)) return set({ phase, thread, note: answer.code === "failed" ? null : answer.code });
      take(answer, { phase, thread, fresh: [] });
    },
    setDraft(text: string) {
      set({ draft: text.slice(0, STUDIO_LIMITS.promptMax) });
    },
    setReferences(references: TrayItem[]) {
      set({ references });
    },
    setMaterials(materials: TrayItem[]) {
      set({ materials });
    },
    /**
     * What came back from an upload (the "+" or a drop, `uploadForTalk`): pictures join the references, clips
     * the materials, each up to its limit. The first reason a file did not come back is said (never dropped in
     * silence); an upload that brought everything clears an earlier note.
     */
    attachUploads({ added, failure }: TalkUpload) {
      const images = added.filter((a) => a.kind === "image");
      const videos = added.filter((a) => a.kind === "video");
      const patch: Partial<TalkState> = { uploadNote: failure };
      const references = [...state.references, ...images.filter((a) => !state.references.some((r) => r.key === a.key))];
      const materials = [...state.materials, ...videos.filter((a) => !state.materials.some((m) => m.key === a.key))];
      if (images.length) patch.references = references.slice(0, STUDIO_LIMITS.referencesMax - 1);
      if (videos.length) patch.materials = materials.slice(0, STUDIO_REVISE_MATERIALS_MAX);
      // Something that came back but did not fit is said with the conversation's limit line, never dropped silently.
      const cut = references.length > STUDIO_LIMITS.referencesMax - 1 || materials.length > STUDIO_REVISE_MATERIALS_MAX;
      if (!failure && cut) patch.uploadNote = { code: "attach_full" };
      set(patch);
    },
    /** A note about attaching that did not come from an upload ("attach_full", or an upload that threw). */
    noteUpload(note: TalkUploadNote | null) {
      set({ uploadNote: note }, false);
    },
    setMarks(marks: MarkState[]) {
      set({ marks });
    },
    /** Sends what is typed (with what is attached). While a question is open, the typed words are its answer. */
    async send() {
      const text = state.draft.trim();
      if (busy() || !text) return;
      const keys = saidMarkKeys(state.thread);
      const item: TalkItem = {
        id: nextId(),
        from: "customer",
        text,
        references: state.references,
        materials: state.materials,
        marks: state.marks.filter((m) => !keys.has(m.key)).map((m) => m.key),
        ...(state.open !== null ? { answers: state.open } : {}),
      };
      set({ thread: [...state.thread, item], draft: "", references: [], materials: [] });
      await read(text);
    },
    /** A chip under the question: one of its options, or "decide for me". */
    async choose(choice: number | "decide") {
      if (busy() || state.open === null) return;
      const question = state.questions[state.open];
      if (!question) return;
      const text = choice === "decide" ? deps.decideText : question.options[choice];
      if (!text) return;
      const answering = choice === "decide" ? { decide: true } : { option: choice };
      set({ thread: [...state.thread, { id: nextId(), from: "customer", text, references: [], materials: [], marks: [], answers: state.open }] });
      await read(text, answering);
    },
    /** Sends the message that could not be read once more. */
    async resend() {
      if (busy() || !state.pending) return;
      const thread = state.thread[state.thread.length - 1]?.from === "note" ? state.thread.slice(0, -1) : state.thread;
      set({ thread });
      await read(state.pending.text, state.pending.answering);
    },
    /** A line's remove control: the server takes it out without reading anything; the way and credits follow. */
    async remove(index: number) {
      if (busy() || !state.sheet.change[index]) return;
      const text = state.sheet.change[index]!.text;
      const ctx = context();
      let answer: ApiResult<StudioReviseTalk>;
      try {
        answer = await deps.talk({ organizationId: ctx.organizationId, outputId: ctx.outputId, sheet: ctx.sheet, questions: ctx.questions, shown: ctx.shown, remove: index });
      } catch {
        answer = { ok: false, code: "failed" };
      }
      if (isFailure(answer)) return set({ note: answer.code });
      take(answer, { thread: [...state.thread, { id: nextId(), from: "note", note: "removed", text }], fresh: [] });
    },
    /** "처음부터 다시": the conversation and what is kept of it are gone; the clip and its version stay. */
    startOver() {
      if (busy()) return;
      stopTimer();
      deps.store.clear();
      const { version, clipKnown } = state;
      state = { ...initialTalkState(), phase: "idle", version, clipKnown };
      deps.onChange(state);
    },
    /** "이대로 만들기": the version is made from the sheet; the kept conversation is cleared. */
    async make() {
      if (busy() || !state.canMake || !state.way) return;
      const sheet = state.sheet;
      const version = state.version;
      set({ phase: "making", note: null }, false);
      let created: ApiResult<StudioJobCreated>;
      try {
        created = await deps.create(createInput({ organizationId: deps.organizationId, outputId: deps.outputId, state }));
      } catch {
        created = { ok: false, code: "failed" };
      }
      if (isFailure(created)) return set({ phase: "idle", note: created.code });
      deps.store.clear();
      deps.onChange(state);
      deps.onCreated?.(created, version, sheet);
    },
    dispose() {
      stopTimer();
    },
  };
}

export type TalkFlow = ReturnType<typeof createTalkFlow>;
