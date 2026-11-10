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
import { buildJob, draftFromJob, initialDraft, type DockDraft, type DockProblem } from "./dock-model";
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
  }
}

export function useDock({ studio, copy, organizationId, initialMedium }: { studio: StudioController; copy: StudioCopy; organizationId: string; initialMedium: StudioMedium }) {
  const [draft, setDraft] = useState<DockDraft>(() => initialDraft(initialMedium));
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const press = useRef<{ fingerprint: string; id: string } | null>(null);
  // Several files can finish uploading in one tick; each attach must see the ones before it.
  const latest = useRef(tray);
  latest.current = tray;

  const attach = useCallback(
    (item: TrayItem, first = false) => {
      const next = addToTray(latest.current, item, first);
      latest.current = next.items;
      setTray(next.items);
      setMessage(next.full ? fill(copy.tray.tooMany, { n: STUDIO_LIMITS.referencesMax }) : null);
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
    const result = await studio.createJob({ ...probe.input, requestId: press.current.id });
    setBusy(false);
    if (isFailure(result)) {
      setMessage(errorLine(copy, result.code));
      return false;
    }
    press.current = null;
    return true;
  }, [busy, copy, draft, organizationId, studio, tray]);

  /** "이 설정 다시 쓰기": the job's settings and references back in the dock. */
  const reuse = useCallback(
    (job: StudioJobView, lookup: { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null }) => {
      setDraft((current) => draftFromJob(job, current));
      setTray(trayFromReferences(job.references, lookup, copy.viewer.label));
      setMessage(null);
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
    busy,
    submit,
    reuse,
  };
}
