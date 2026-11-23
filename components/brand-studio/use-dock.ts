"use client";
/**
 * The prompt bar's own state: the draft, the references and one press of "만들기". A press keeps its
 * request id until it succeeds, so sending the same thing again after a lost answer cannot start a
 * second run. "지금 설계하기" asks `prompt.enhance` for the rewritten sentence (free for the customer)
 * and puts it in the field, where it can be edited. The words typed before it are kept: "원래 문장으로"
 * brings them back, and a run sends them as `prompt` with the sentence in the field as `reviewedPrompt`
 * (`enhance: false`), so nothing is rewritten twice and the run records both.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { STUDIO_LIMITS, type StudioErrorCode } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure } from "./api";
import { errorLine, fill, newRequestId, type StudioCopy } from "./copy";
import type { ReferenceVideoProblem } from "@/lib/brand-studio/reference-video";
import {
  attachRefusal,
  buildMultiClipJobs,
  draftAfterAttach,
  enhancePreviewInput,
  initialDraft,
  type DockDraft,
  type DockProblem,
  type FilmLimits,
} from "./dock-model";
import { addToTray, mentionLabel, moveInTray, removeFromTray, updateTrayItem, type TrayItem } from "./refs";
import type { MissingReference, ReusePlan } from "./reuse-model";
import type { StudioController } from "./use-studio";
import { focusDockPromptEnd, takeStudioPrefill } from "./prefill";
import {
  buildGroupJob,
  groupEnhanceInputs,
  isGroupDraft,
  pickedModels,
  readStoredPick,
  reconcileTabs,
  withModels,
  writeStoredPick,
  type DesignTabs,
  type MovedOption,
} from "./group-model";

/** How long one model's design may take before its tab falls back to the typed words. */
export const DESIGN_TIMEOUT_MS = 60_000;

/** "고른 모델이 모두 지원하도록 바꿨어요. 비율 21:9 → 16:9": the quiet line after an added model lacked a value. */
export function movedLine(moved: readonly MovedOption[], copy: StudioCopy): string | null {
  if (!moved.length) return null;
  // Each change stays on one line (no-break spaces): "해상도 4K → 2K" never splits before its new value.
  const changes = moved.map((m) => `${m.key === "aspect" ? copy.dock.aspect : copy.dock.resolution} ${m.from} → ${m.to}`.replace(/ /g, " ")).join(", ");
  return fill(copy.dock.moved, { changes });
}

/** The browser's localStorage, or null where it is blocked (private windows, previews). */
function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function problemLine(problem: DockProblem, copy: StudioCopy): string {
  switch (problem.kind) {
    case "empty_prompt":
      return copy.dock.emptyPrompt;
    case "need_change":
      return copy.dock.needChange;
    case "image_only":
      return copy.tray.imageOnly;
    case "too_many_videos":
      return copy.tray.tooManyVideos;
    case "too_many_images":
      return fill(copy.tray.tooManyImages, { n: problem.max });
    case "missing":
      return fill(copy.tray.missing, { label: problem.mentions.map((m) => mentionLabel(m.kind, m.number, copy)).join(", ") });
    case "film_unusable":
    case "film_edit_short":
      return filmLimitLine(problem.kind === "film_edit_short" ? "edit" : problem.problem, problem.limits, copy);
  }
}

/** The one calm sentence about a reference video the provider would refuse (numbers from the registry). */
export function filmLimitLine(problem: ReferenceVideoProblem | "edit", limits: FilmLimits, copy: StudioCopy): string {
  const r = copy.remix;
  switch (problem) {
    case "length":
      return fill(r.limitLength, { min: limits.min, max: limits.max });
    case "edit":
      return fill(r.limitEdit, { n: limits.editMin, method: r.methods.reference });
    case "small":
      return r.limitSmall;
    case "large":
      return r.limitLarge;
  }
}

/** "찾을 수 없는 참조: 이미지 2. …" for references a reused run had that are gone, or null. */
export function missingReferencesLine(missing: readonly MissingReference[], copy: StudioCopy): string | null {
  if (!missing.length) return null;
  return fill(copy.viewer.reuseMissing, { label: missing.map((m) => mentionLabel(m.kind, m.number, copy)).join(", ") });
}

export type DockReusePlan = Extract<ReusePlan, { to: "dock" }>;

/** The improved sentence and what was written before it. */
export interface Enhanced {
  original: string;
  improved: string;
}

/**
 * The customer's own words to send beside the sentence in the field, or null when the field is not a
 * rewritten sentence (never rewritten, taken back, emptied, or typed back to the original).
 */
export function ownWordsOf(enhanced: Enhanced | null, prompt: string): string | null {
  if (!enhanced) return null;
  const shown = prompt.trim();
  const own = enhanced.original.trim();
  return shown && own && shown !== own ? own : null;
}

export function useDock({
  studio,
  copy,
  organizationId,
  initialMedium,
  mode,
  prefill,
}: {
  studio: StudioController;
  copy: StudioCopy;
  organizationId: string;
  initialMedium: StudioMedium;
  /** The screen's medium. When set, the bar never switches medium. */
  mode?: StudioMedium;
  /**
   * The workspace home's hand-off (prefill.ts): once the screen has loaded (`ready`), a sentence the home
   * left for this screen goes in the field, once, when this member can create and the field is empty.
   */
  prefill?: { ready: boolean; canCreate: boolean };
}) {
  const [draft, setDraft] = useState<DockDraft>(() => initialDraft(mode ?? initialMedium));
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [feedback, setFeedback] = useState<{
    message: string | null;
    errorCode: StudioErrorCode | null;
  }>({ message: null, errorCode: null });
  const setMessage = useCallback(
    (next: string | null, code: StudioErrorCode | null = null) => {
      setFeedback({ message: next, errorCode: code });
    },
    [],
  );
  const { message, errorCode } = feedback;
  /** A quiet line about something the bar did on its own (switching to video). */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState<Enhanced | null>(null);
  /**
   * Several image models picked and "설계하기" pressed: one tab per model with its own sentence (the typed
   * words stay in `draft.prompt`), and the tab the field shows. Null for the single bar.
   */
  const [tabs, setTabs] = useState<DesignTabs | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const latestTabs = useRef(tabs);
  latestTabs.current = tabs;
  const latestActive = useRef(activeTab);
  latestActive.current = activeTab;
  /** The design call each tab waits for: a late answer for an older call (or a removed tab) is dropped. */
  const designTokens = useRef(new Map<string, number>());
  const designSeq = useRef(0);
  const press = useRef<{ fingerprint: string; ids: string[] } | null>(null);
  // Several files can finish uploading in one tick; each attach must see the ones before it.
  const latest = useRef(tray);
  latest.current = tray;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const latestEnhanced = useRef(enhanced);
  latestEnhanced.current = enhanced;
  // The image screen only: a pick of several models is remembered in this browser (group-model.ts).
  const remembers = (mode ?? initialMedium) === "image";

  /**
   * The model pick changed (the menu's checks, or one model picked alone). Shared options every model does
   * not have move to the nearest common value and the bar says which, in one quiet line. Designed tabs are
   * kept for models still picked, dropped for the others, and a newly added model gets a tab "아직 설계 전".
   * Going from one designed model to several turns its sentence into its tab; back to one model, that
   * model's tab becomes the field again (with "원래 문장으로").
   */
  const setModels = useCallback(
    (ids: readonly string[], options: { quiet?: boolean; remember?: boolean } = {}) => {
      const before = latestDraft.current;
      const { draft: next, moved } = withModels(before, ids);
      const picked = pickedModels(next);
      const wasGroup = isGroupDraft(before);
      const nowGroup = isGroupDraft(next);
      const currentTabs = latestTabs.current;
      const ownBefore = wasGroup ? before.prompt : (ownWordsOf(latestEnhanced.current, before.prompt) ?? before.prompt);
      let prompt = next.prompt;
      let nextTabs: DesignTabs | null = null;
      let nextEnhanced: Enhanced | null = latestEnhanced.current;
      if (nowGroup) {
        if (currentTabs) nextTabs = reconcileTabs(currentTabs, ownBefore, picked);
        else if (!wasGroup && ownWordsOf(latestEnhanced.current, before.prompt) !== null) {
          // One designed model becomes several: its sentence is its tab, the others wait to be designed.
          nextTabs = reconcileTabs({ [before.model]: { status: "ready", text: before.prompt } }, ownBefore, picked);
        }
        prompt = ownBefore;
        nextEnhanced = null;
      } else if (wasGroup) {
        const tab = currentTabs?.[picked[0]!];
        const text = tab?.text ?? ownBefore;
        const reviewed = text.trim() && text.trim() !== ownBefore.trim();
        prompt = reviewed ? text : ownBefore;
        nextEnhanced = reviewed ? { original: ownBefore, improved: text } : null;
      }
      const draftNext = { ...next, prompt };
      latestDraft.current = draftNext;
      setDraft(draftNext);
      for (const id of [...designTokens.current.keys()]) if (!nextTabs?.[id]) designTokens.current.delete(id);
      latestTabs.current = nextTabs;
      setTabs(nextTabs);
      setActiveTab((current) => (nextTabs ? (current && nextTabs[current] ? current : picked[0]!) : null));
      setEnhanced(nextEnhanced);
      press.current = null;
      // One model for another is the bar it always was: its lines stay as they were.
      if (!options.quiet && (wasGroup || nowGroup)) {
        setMessage(null);
        setNotice(movedLine(moved, copy));
      }
      if (remembers && options.remember !== false) writeStoredPick(localStore(), organizationId, picked);
    },
    [copy, organizationId, remembers],
  );

  // A pick of several models made earlier in this browser comes back after a reload (image screen only).
  // A sentence handed over from the workspace home lands in a single-model bar, so that hand-off skips it.
  const restored = useRef(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (restored.current || !remembers) return;
    restored.current = true;
    const pick = readStoredPick(localStore(), organizationId);
    if (pick && !prefilled.current) setModels(pick, { quiet: true });
  }, [organizationId, remembers, setModels]);

  // The home's hand-off is read once, on the first load, and removed whatever happens (prefill.ts).
  const prefillReady = Boolean(prefill?.ready);
  const prefillCanCreate = Boolean(prefill?.canCreate);
  const prefillDone = useRef(false);
  useEffect(() => {
    if (!prefillReady || prefillDone.current) return;
    prefillDone.current = true;
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      return;
    }
    const prompt = takeStudioPrefill(storage, {
      organizationId,
      medium: mode ?? initialMedium,
      canCreate: prefillCanCreate,
      currentPrompt: latestDraft.current.prompt,
    });
    if (!prompt) return;
    prefilled.current = true;
    // The home's sentence lands in the bar exactly as before: one model, the default one. A pick of several
    // restored from this browser gives way, and stays remembered for the next visit without a hand-off.
    if (isGroupDraft(latestDraft.current)) setModels([initialDraft(mode ?? initialMedium).model], { quiet: true, remember: false });
    latestDraft.current = { ...latestDraft.current, prompt };
    setDraft((current) => (current.prompt.trim() ? current : { ...current, prompt }));
    window.requestAnimationFrame(() => window.requestAnimationFrame(focusDockPromptEnd));
  }, [initialMedium, mode, organizationId, prefillCanCreate, prefillReady, setModels]);

  const attach = useCallback(
    (item: TrayItem, first = false) => {
      if (mode && attachRefusal(mode, item)) {
        setMessage(copy.dock.videoNotHere);
        return;
      }
      const next = addToTray(latest.current, item, first);
      latest.current = next.items;
      setTray(next.items);
      setMessage(next.full ? fill(copy.tray.tooMany, { n: STUDIO_LIMITS.referencesMax }) : null);
      setNotice(null);
      const prevMedium = latestDraft.current.medium;
      const switched = draftAfterAttach(latestDraft.current, item, Boolean(mode), next.items);
      if (!next.full && switched !== latestDraft.current) {
        latestDraft.current = switched;
        setDraft((current) => draftAfterAttach(current, item, Boolean(mode), next.items));
        if (!mode && switched.medium !== prevMedium) {
          setNotice(copy.dock.switchedToVideo);
        }
      }
    },
    [copy, mode, setDraft],
  );

  const ownWords = ownWordsOf(enhanced, draft.prompt);

  const designing = Boolean(tabs && Object.values(tabs).some((tab) => tab.status === "designing"));

  /** Several models: one `job.create_group` request; every run starts, or none does. */
  const submitGroup = useCallback(async (): Promise<boolean> => {
    const probe = buildGroupJob(draft, tray, { organizationId, requestId: "probe-group" }, tabs);
    if (!probe.ok) {
      setMessage(problemLine(probe.problem, copy));
      return false;
    }
    const fingerprint = JSON.stringify({ ...probe.input, requestId: null });
    // The group key is shorter than a run's (contracts.ts `ImageJobGroupSchema`): a UUID without dashes.
    if (press.current?.fingerprint !== fingerprint) press.current = { fingerprint, ids: [newRequestId().replace(/-/g, "")] };
    setBusy(true);
    setMessage(null);
    setNotice(null);
    const result = await studio.createGroup({ ...probe.input, requestId: press.current.ids[0]! });
    setBusy(false);
    if (isFailure(result)) {
      setMessage(errorLine(copy, result.code), result.code);
      return false;
    }
    press.current = null;
    return true;
  }, [copy, draft, organizationId, studio, tabs, tray]);

  /** True when one or more runs started (multi-clip plans dispatch concurrently via Promise.all). */
  const submit = useCallback(async (): Promise<boolean> => {
    if (busy || enhancing || designing) return false;
    if (isGroupDraft(draft)) return submitGroup();
    const filmItem = tray.find((item) => item.kind === "video");
    const filmEntry = filmItem?.assetId ? studio.films[filmItem.assetId] : undefined;
    const sheet = filmEntry?.status === "done" ? filmEntry.sheet : null;
    const probe = buildMultiClipJobs(
      draft,
      tray,
      { organizationId, requestIds: ["probe-0", "probe-1", "probe-2", "probe-3"] },
      { ownWords, sheet },
    );
    if (!probe.ok) {
      setMessage(problemLine(probe.problem, copy));
      return false;
    }
    const fingerprint = JSON.stringify(probe.inputs.map((inp) => ({ ...inp, requestId: null })));
    if (press.current?.fingerprint !== fingerprint || press.current.ids.length !== probe.inputs.length) {
      press.current = { fingerprint, ids: probe.inputs.map(() => newRequestId()) };
    }
    const ids = press.current.ids;
    setBusy(true);
    setMessage(null);
    setNotice(null);

    if (probe.inputs.length === 1) {
      const result = await studio.createJob({ ...probe.inputs[0]!, requestId: ids[0]! });
      setBusy(false);
      if (isFailure(result)) {
        setMessage(errorLine(copy, result.code), result.code);
        return false;
      }
      press.current = null;
      return true;
    }

    const results = await Promise.all(
      probe.inputs.map((jobInput, idx) => studio.createJob({ ...jobInput, requestId: ids[idx]! })),
    );
    setBusy(false);
    const failed = results.find(isFailure);
    if (failed) {
      setMessage(errorLine(copy, failed.code), failed.code);
      if (results.every(isFailure)) return false;
    }
    press.current = null;
    return true;
  }, [busy, copy, designing, draft, enhancing, organizationId, ownWords, studio, submitGroup, tray]);

  /**
   * Several models: one design per model, in parallel, each with that model's own profile. Each tab fills
   * as its answer comes; one that fails or takes too long keeps the typed words (the single bar's fallback).
   * `only`: design just these models (a tab "아직 설계 전", or one that failed), from that tab's sentence.
   */
  const designGroup = useCallback(
    async (only?: readonly string[]) => {
      const current = latestDraft.current;
      if (!current.prompt.trim()) return;
      const own = current.prompt;
      const ids = only ?? pickedModels(current);
      const base = only ? latestTabs.current : null;
      // A single tab is designed from what it holds now; a fresh design starts from the typed words.
      const sources = Object.fromEntries(ids.map((id) => [id, base?.[id]?.text ?? own]));
      const inputs = ids.map((id) => groupEnhanceInputs({ ...current, prompt: sources[id]! }, tray, organizationId, [id]));
      const refused = inputs.find((entry) => !entry.ok);
      if (refused && !refused.ok) {
        setMessage(problemLine(refused.problem, copy));
        return;
      }
      setMessage(null);
      setNotice(null);
      const tokens = Object.fromEntries(ids.map((id) => [id, (designSeq.current += 1)]));
      for (const id of ids) designTokens.current.set(id, tokens[id]!);
      const start: DesignTabs = { ...(base ?? reconcileTabs({}, own, pickedModels(current))) };
      for (const id of ids) start[id] = { status: "designing", text: sources[id]! };
      latestTabs.current = start;
      setTabs(start);
      setActiveTab((active) => (active && start[active] ? active : ids[0]!));
      await Promise.all(
        inputs.map(async (entry, i) => {
          if (!entry.ok) return;
          const id = ids[i]!;
          const timer = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), DESIGN_TIMEOUT_MS));
          const answer = await Promise.race([studio.enhancePrompt(entry.inputs[0]!.input).catch(() => null), timer]);
          // Dropped when the tab is gone (taken back, model removed, settings reused) or designed again since.
          if (designTokens.current.get(id) !== tokens[id] || latestTabs.current?.[id]?.status !== "designing") return;
          const improved = answer && !isFailure(answer) ? answer.prompt.trim().slice(0, STUDIO_LIMITS.promptMax) : "";
          const tab = improved ? { status: "ready" as const, text: improved } : { status: "failed" as const, text: sources[id]! };
          const next = { ...latestTabs.current, [id]: tab };
          latestTabs.current = next;
          setTabs(next);
        }),
      );
    },
    [copy, organizationId, studio, tray],
  );

  /** "지금 설계하기": the sentence the model will read, in the field, with the customer's words kept for "원래 문장으로". */
  const enhanceNow = useCallback(async () => {
    if (isGroupDraft(draft)) {
      if (!enhancing && !designing) await designGroup();
      return;
    }
    if (enhancing || !draft.prompt.trim()) return;
    const preview = enhancePreviewInput(draft, tray, organizationId);
    if (!preview.ok) {
      setMessage(problemLine(preview.problem, copy));
      return;
    }
    const original = draft.prompt;
    // Rewriting a sentence that was already rewritten keeps the words the customer typed first.
    const own = ownWordsOf(enhanced, original) ?? original;
    setEnhancing(true);
    setMessage(null);
    const result = await studio.enhancePrompt(preview.input);
    setEnhancing(false);
    if (isFailure(result) || !result.prompt.trim()) {
      setNotice(copy.dock.enhanceFailed);
      return;
    }
    const improved = result.prompt.trim().slice(0, STUDIO_LIMITS.promptMax);
    // The customer may have kept typing elsewhere; only replace the sentence that was sent.
    if (latestDraft.current.prompt !== original) return;
    setDraft((current) => (current.prompt === original ? { ...current, prompt: improved } : current));
    setEnhanced({ original: own, improved });
    setNotice(null);
  }, [copy, designGroup, designing, draft, enhanced, enhancing, organizationId, studio, tray]);

  /** Drops every model's tab: the field shows the typed words again (they never left `draft.prompt`). */
  const dropTabs = useCallback(() => {
    designTokens.current.clear();
    latestTabs.current = null;
    setTabs(null);
    setActiveTab(null);
  }, []);

  const undoEnhance = useCallback(() => {
    if (latestTabs.current) {
      dropTabs();
      return;
    }
    if (!enhanced) return;
    setDraft((current) => ({ ...current, prompt: enhanced.original }));
    setEnhanced(null);
  }, [dropTabs, enhanced]);

  /** The field's words while tabs are shown: the active model's own sentence. */
  const setTabText = useCallback((text: string) => {
    const active = latestActive.current;
    const current = latestTabs.current;
    if (!active || !current?.[active] || current[active]!.status === "designing") return;
    const next = { ...current, [active]: { ...current[active]!, text } };
    latestTabs.current = next;
    setTabs(next);
  }, []);

  /**
   * "설정 다시 쓰기" and a reference-video run's "다시 만들기": a run's whole setting back in the bar
   * (reuse-model.ts `planReuse`). A reference that is gone is named in the bar's notice line.
   */
  const reuse = useCallback(
    (plan: DockReusePlan) => {
      latestDraft.current = plan.draft;
      latest.current = plan.tray;
      setDraft(plan.draft);
      setTray(plan.tray);
      setEnhanced(plan.reviewed);
      setMessage(null);
      setNotice(missingReferencesLine(plan.missing, copy));
      press.current = null;
      // Designed sentences are never brought back: the typed words are (2026-11-19, #266).
      if (latestTabs.current) dropTabs();
      if (remembers && plan.draft.medium === "image") writeStoredPick(localStore(), organizationId, pickedModels(plan.draft));
    },
    [copy, dropTabs, organizationId, remembers, setDraft],
  );

  const groupTabs = tabs && activeTab && tabs[activeTab] ? { tabs, active: activeTab } : null;

  return {
    mode,
    draft,
    setDraft,
    tray,
    setTray,
    attach,
    update: (key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>) => setTray((t) => updateTrayItem(t, key, patch)),
    remove: (key: string) => setTray((t) => removeFromTray(t, key)),
    move: (from: number, to: number) => setTray((t) => moveInTray(t, from, to)),
    message,
    errorCode,
    setMessage,
    notice,
    setNotice,
    busy,
    submit,
    reuse,
    enhancing: enhancing || designing,
    enhanced: ownWords !== null || groupTabs !== null,
    enhanceNow,
    undoEnhance,
    /** Several image models (group-model.ts): the pick, its tabs after "설계하기", and what they do. */
    setModels,
    tabs: groupTabs,
    selectTab: setActiveTab,
    setTabText,
    designOne: (id: string) => void designGroup([id]),
  };
}

export type DockController = ReturnType<typeof useDock>;
