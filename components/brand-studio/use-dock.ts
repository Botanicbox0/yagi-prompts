"use client";
/**
 * The prompt bar's own state: the draft, the references and one press of "만들기". A press keeps its
 * request id until it succeeds, so sending the same thing again after a lost answer cannot start a
 * second run. The ✨ button asks `prompt.enhance` for the improved sentence (free for the customer);
 * that sentence is then sent with `enhance: false` so it is not rewritten twice, and editing it drops
 * that state again.
 */
import { useCallback, useRef, useState } from "react";
import { STUDIO_LIMITS, type StudioAssetView, type StudioJobView, type StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure } from "./api";
import { errorLine, fill, newRequestId, type StudioCopy } from "./copy";
import type { ReferenceVideoProblem } from "@/lib/brand-studio/reference-video";
import {
  attachRefusal,
  buildMultiClipJobs,
  draftAfterAttach,
  draftFromJob,
  enhancePreviewInput,
  initialDraft,
  type DockDraft,
  type DockProblem,
  type FilmLimits,
} from "./dock-model";
import { addToTray, mentionLabel, moveInTray, removeFromTray, trayFromReferences, updateTrayItem, type TrayItem } from "./refs";
import type { StudioController } from "./use-studio";

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

/** The improved sentence and what was written before it. */
export interface Enhanced {
  original: string;
  improved: string;
}

/** True while the field still holds exactly the sentence the ✨ button wrote. */
export const isPreEnhanced = (enhanced: Enhanced | null, prompt: string) => Boolean(enhanced && enhanced.improved === prompt);

export function useDock({
  studio,
  copy,
  organizationId,
  initialMedium,
  mode,
}: {
  studio: StudioController;
  copy: StudioCopy;
  organizationId: string;
  initialMedium: StudioMedium;
  /** The screen's medium. When set, the bar never switches medium. */
  mode?: StudioMedium;
}) {
  const [draft, setDraft] = useState<DockDraft>(() => initialDraft(mode ?? initialMedium));
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  /** A quiet line about something the bar did on its own (switching to video). */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState<Enhanced | null>(null);
  const press = useRef<{ fingerprint: string; ids: string[] } | null>(null);
  // Several files can finish uploading in one tick; each attach must see the ones before it.
  const latest = useRef(tray);
  latest.current = tray;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

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

  const preEnhanced = isPreEnhanced(enhanced, draft.prompt);

  /** True when one or more runs started (multi-clip plans dispatch concurrently via Promise.all). */
  const submit = useCallback(async (): Promise<boolean> => {
    if (busy || enhancing) return false;
    const filmItem = tray.find((item) => item.kind === "video");
    const filmEntry = filmItem?.assetId ? studio.films[filmItem.assetId] : undefined;
    const sheet = filmEntry?.status === "done" ? filmEntry.sheet : null;
    const probe = buildMultiClipJobs(
      draft,
      tray,
      { organizationId, requestIds: ["probe-0", "probe-1", "probe-2", "probe-3"] },
      { preEnhanced, sheet },
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
        setMessage(errorLine(copy, result.code));
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
      setMessage(errorLine(copy, failed.code));
      if (results.every(isFailure)) return false;
    }
    press.current = null;
    return true;
  }, [busy, copy, draft, enhancing, organizationId, preEnhanced, studio, tray]);

  /** ✨: the sentence the model will read, in the field, with the original one kept for "원래 문장으로". */
  const enhanceNow = useCallback(async () => {
    if (enhancing || !draft.prompt.trim()) return;
    const preview = enhancePreviewInput(draft, tray, organizationId);
    if (!preview.ok) {
      setMessage(problemLine(preview.problem, copy));
      return;
    }
    const original = draft.prompt;
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
    setDraft((current) => (current.prompt === original ? { ...current, prompt: improved } : current));
    setEnhanced({ original, improved });
    setNotice(null);
  }, [copy, draft, enhancing, organizationId, studio, tray]);

  const undoEnhance = useCallback(() => {
    if (!enhanced) return;
    setDraft((current) => ({ ...current, prompt: enhanced.original }));
    setEnhanced(null);
  }, [enhanced]);

  /** "설정 다시 쓰기" and a reference-video run's "다시 만들기": its settings and references back in the bar. */
  const reuse = useCallback(
    (job: StudioJobView, lookup: { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null }) => {
      setDraft((current) => draftFromJob(job, current));
      setTray(trayFromReferences(job.references, lookup, copy.viewer.label));
      setEnhanced(null);
      setMessage(null);
      setNotice(null);
    },
    [copy, setDraft],
  );

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
    setMessage,
    notice,
    setNotice,
    busy,
    submit,
    reuse,
    enhancing,
    enhanced: preEnhanced,
    enhanceNow,
    undoEnhance,
  };
}

export type DockController = ReturnType<typeof useDock>;
