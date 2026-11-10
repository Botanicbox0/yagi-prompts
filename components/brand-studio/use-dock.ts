"use client";
/**
 * The dock's own state: the draft, the tray and one press of "만들기". A press keeps its request id
 * until it succeeds, so sending the same thing again after a lost answer cannot start a second run.
 */
import { useCallback, useRef, useState } from "react";
import { STUDIO_LIMITS, type StudioAssetView, type StudioJobView, type StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure } from "./api";
import { errorLine, fill, newRequestId, type StudioCopy } from "./copy";
import type { ReferenceVideoProblem } from "@/lib/brand-studio/reference-video";
import { buildJob, draftAfterAttach, draftFromJob, initialDraft, type DockDraft, type DockProblem, type FilmLimits } from "./dock-model";
import { addToTray, mentionLabel, removeFromTray, trayFromReferences, updateTrayItem, type TrayItem } from "./refs";
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

export function useDock({ studio, copy, organizationId, initialMedium }: { studio: StudioController; copy: StudioCopy; organizationId: string; initialMedium: StudioMedium }) {
  const [draft, setDraft] = useState<DockDraft>(() => initialDraft(initialMedium));
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  /** A quiet line about something the dock did on its own (switching to video). */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const press = useRef<{ fingerprint: string; id: string } | null>(null);
  // Several files can finish uploading in one tick; each attach must see the ones before it.
  const latest = useRef(tray);
  latest.current = tray;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  const attach = useCallback(
    (item: TrayItem, first = false) => {
      const next = addToTray(latest.current, item, first);
      latest.current = next.items;
      setTray(next.items);
      setMessage(next.full ? fill(copy.tray.tooMany, { n: STUDIO_LIMITS.referencesMax }) : null);
      setNotice(null);
      // A picture run cannot carry a video: a video coming in means the customer wants a video.
      const switched = draftAfterAttach(latestDraft.current, item);
      if (!next.full && switched !== latestDraft.current) {
        latestDraft.current = switched;
        setDraft((current) => draftAfterAttach(current, item));
        setNotice(copy.dock.switchedToVideo);
      }
    },
    [copy],
  );

  /** True when a run started. */
  const submit = useCallback(async (): Promise<boolean> => {
    if (busy) return false;
    const probe = buildJob(draft, tray, { organizationId, requestId: "probe" });
    if (!probe.ok) {
      setMessage(problemLine(probe.problem, copy));
      return false;
    }
    const fingerprint = JSON.stringify({ ...probe.input, requestId: null });
    if (press.current?.fingerprint !== fingerprint) press.current = { fingerprint, id: newRequestId() };
    setBusy(true);
    setMessage(null);
    setNotice(null);
    const result = await studio.createJob({ ...probe.input, requestId: press.current.id });
    setBusy(false);
    if (isFailure(result)) {
      setMessage(errorLine(copy, result.code));
      return false;
    }
    press.current = null;
    return true;
  }, [busy, copy, draft, organizationId, studio, tray]);

  /** "이 설정 다시 쓰기" and a reference-video run's "같은 설정으로 다시 만들기": its settings and references back in the dock. */
  const reuse = useCallback(
    (job: StudioJobView, lookup: { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null }) => {
      setDraft((current) => draftFromJob(job, current));
      setTray(trayFromReferences(job.references, lookup, copy.viewer.label));
      setMessage(null);
      setNotice(null);
    },
    [copy],
  );

  return {
    draft,
    setDraft,
    tray,
    setTray,
    attach,
    update: (key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>) => setTray((t) => updateTrayItem(t, key, patch)),
    remove: (key: string) => setTray((t) => removeFromTray(t, key)),
    message,
    setMessage,
    notice,
    busy,
    submit,
    reuse,
  };
}
