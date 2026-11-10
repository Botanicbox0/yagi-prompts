"use client";
/**
 * The viewer's state and what its actions do (docs/BRAND-STUDIO-V3.md §4): which result or asset is
 * open, the action running, the line under the actions, and a partial edit set up again from an
 * earlier one. Kept apart from the page so the page stays a layout.
 *
 * A partial edit never blocks: the form closes at once, the screen holds a place for it in the wall
 * (`onRegionSending`) and the request goes out in the background, so several can be sent in a row.
 */
import { useCallback, useMemo, useState } from "react";
import type { StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure } from "./api";
import { errorLine, newRequestId, type StudioCopy } from "./copy";
import { finalInput, regionEditInput, rerunInput, withMedium } from "./dock-model";
import { trayFromReferences, trayItemFromAsset, trayItemFromOutput, withStartFrame, type RefSource } from "./refs";
import { STUDIO_OPEN_REVERSE, announce } from "./seams";
import { boardOutputs } from "./store";
import type { DockController } from "./use-dock";
import type { StudioController } from "./use-studio";
import { itemKey, type RegionPreset, type RegionRequest, type ViewerActions, type ViewerItem } from "./viewer";

type Lookup = { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null };

export const sourceOf = (item: ViewerItem): RefSource => (item.type === "output" ? { outputId: item.output.id } : { assetId: item.asset.id });

export function useViewer(input: {
  studio: StudioController;
  dock: DockController;
  copy: StudioCopy;
  locale: "ko" | "en";
  mode: StudioMedium;
  organizationId: string;
  /** The runs the screen lists (its medium only). */
  jobs: readonly StudioJobView[];
  assets: readonly StudioAssetView[];
  lookup: Lookup;
  onCampaign(source: RefSource): void;
  onDecorate(item: ViewerItem): void;
  onReview(item: ViewerItem): void;
  /** "영상으로 만들기" on the image screen: the video screen with this picture as the opening frame. */
  onToVideoScreen(source: RefSource): void;
  /** A partial edit is on its way (`key`) or has come back (`done`); `line` explains a refusal. */
  onRegionSending(event: { key: string; ratio: string } | { done: string; line: string | null }): void;
  focusPrompt(): void;
}) {
  const { studio, dock, copy, locale, mode, organizationId, jobs, assets, lookup, onCampaign, focusPrompt } = input;
  const [open, setOpen] = useState<{ list: "outputs" | "assets"; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preset, setPreset] = useState<RegionPreset | null>(null);

  const items: ViewerItem[] = useMemo(
    () =>
      open?.list === "assets"
        ? assets.map((asset) => ({ type: "asset" as const, asset }))
        : boardOutputs(jobs).map(({ output, job }) => ({ type: "output" as const, output, job })),
    [open?.list, assets, jobs],
  );
  const index = open ? items.findIndex((item) => itemKey(item) === open.key) : -1;

  const show = useCallback((next: { list: "outputs" | "assets"; key: string } | null) => {
    setOpen(next);
    setNotice(null);
    // A set-up edit belongs to the picture it was opened on; moving away drops it.
    setPreset((current) => (next && current?.key === next.key ? current : null));
  }, []);

  const run = useCallback(
    async (key: string, work: () => Promise<string | null>) => {
      setBusy(key);
      setNotice(null);
      const line = await work();
      setBusy(null);
      setNotice(line);
      return line === copy.state.started || line === null;
    },
    [copy],
  );

  /** A partial edit set up again: its picture open, the same box, words and references. */
  const reopenRegion = (job: StudioJobView) => {
    const target = job.parentOutputId && lookup.output(job.parentOutputId)
      ? { list: "outputs" as const, key: `o:${job.parentOutputId}` }
      : job.parentAssetId && lookup.asset(job.parentAssetId)
        ? { list: "assets" as const, key: `a:${job.parentAssetId}` }
        : null;
    if (!target) return setNotice(errorLine(copy, "not_found"));
    setPreset({ key: target.key, box: job.box, instruction: job.prompt, model: job.model, quality: job.quality ?? null, references: trayFromReferences(job.references, lookup, copy.viewer.label) });
    setOpen(target);
    setNotice(null);
  };

  /** Opens a picture straight on its partial-edit form (the wall's "부분 수정"). */
  const openRegion = (key: string, list: "outputs" | "assets" = "outputs") => {
    setPreset({ key, box: null, instruction: "" });
    setOpen({ list, key });
    setNotice(null);
  };

  const reuse = (job: StudioJobView) => {
    // A blueprint is set up again in the reverse panel (slice C), not in the bar.
    if (job.kind === "video_remix" && job.method === "blueprint") {
      show(null);
      announce(STUDIO_OPEN_REVERSE, { jobId: job.id });
      return;
    }
    dock.reuse(job, lookup);
    show(null);
    focusPrompt();
  };

  const regionEdit = async (item: ViewerItem, request: RegionRequest): Promise<boolean> => {
    const key = newRequestId();
    const file = item.type === "output" ? item.output : item.asset;
    const ratio = file.width && file.height ? `${file.width} / ${file.height}` : "1 / 1";
    input.onRegionSending({ key, ratio });
    setPreset(null);
    const body = regionEditInput({
      ids: { organizationId, requestId: key },
      source: sourceOf(item),
      box: request.box,
      instruction: request.instruction,
      draft: dock.draft,
      model: request.model,
      quality: request.quality || null,
      references: request.references,
      locale,
    });
    const result = await studio.createJob(body);
    const line = isFailure(result) ? errorLine(copy, result.code) : null;
    input.onRegionSending({ done: key, line });
    return !line;
  };

  const actions: ViewerActions = {
    regionEdit,
    rerun: (job) => {
      if (job.kind === "region_edit") return reopenRegion(job);
      if (job.kind === "video_remix") return reuse(job);
      void run("rerun", async () => {
        const again = rerunInput(job, { organizationId, requestId: newRequestId() });
        if (!again) return null;
        const result = await studio.createJob(again);
        return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
      });
    },
    toVideo: (item) => {
      if (mode === "image") {
        input.onToVideoScreen(sourceOf(item));
        return;
      }
      const tile = item.type === "output" ? trayItemFromOutput(item.output, copy.viewer.label) : trayItemFromAsset(item.asset);
      dock.setDraft((current) => withMedium(current, "video"));
      dock.setTray((current) => withStartFrame(current, tile));
      show(null);
      focusPrompt();
    },
    reference: (item) => {
      dock.attach(item.type === "output" ? trayItemFromOutput(item.output, copy.viewer.label) : trayItemFromAsset(item.asset));
      show(null);
      focusPrompt();
    },
    save: (output) =>
      void run("save", async () => {
        const result = await studio.saveOutput(output.id);
        return isFailure(result) ? errorLine(copy, result.code) : null;
      }),
    campaign: (item) => onCampaign(sourceOf(item)),
    finalize: (output) =>
      void run("finalize", async () => {
        const result = await studio.createJob(finalInput({ organizationId, requestId: newRequestId() }, output.id));
        return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
      }),
    reuse,
    remove: async (output) => {
      const neighbour = items[index + 1] ?? items[index - 1] ?? null;
      let gone = false;
      await run("delete", async () => {
        const result = await studio.deleteOutput(output.id);
        if (isFailure(result)) return result.code === "conflict" ? copy.viewer.deleteBusy : errorLine(copy, result.code);
        gone = true;
        return null;
      });
      if (gone) show(neighbour && open ? { list: open.list, key: itemKey(neighbour) } : null);
      return gone;
    },
    decorate: (item) => {
      show(null);
      input.onDecorate(item);
    },
    review: (item) => input.onReview(item),
  };

  return { open, show, items, index, busy, notice, setNotice, preset, actions, rerun: actions.rerun, reuse, openRegion };
}
