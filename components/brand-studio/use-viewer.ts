"use client";
/**
 * The viewer's state and what its actions do (docs/BRAND-STUDIO-V2.md §5.2): which result or asset is
 * open, the action running, the line under the actions, and a partial edit set up again from an
 * earlier one. Kept apart from the page so the page stays a layout.
 */
import { useCallback, useMemo, useState } from "react";
import type { RegionBox, StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { isFailure } from "./api";
import { errorLine, newRequestId, type StudioCopy } from "./copy";
import { finalInput, regionEditInput, rerunInput, withMedium } from "./dock-model";
import { trayItemFromAsset, trayItemFromOutput, withStartFrame, type RefSource } from "./refs";
import { boardOutputs } from "./store";
import type { useDock } from "./use-dock";
import type { StudioController } from "./use-studio";
import { itemKey, type RegionPreset, type ViewerActions, type ViewerItem } from "./viewer";

type Lookup = { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null };

export function useViewer(input: {
  studio: StudioController;
  dock: ReturnType<typeof useDock>;
  copy: StudioCopy;
  organizationId: string;
  jobs: readonly StudioJobView[];
  assets: readonly StudioAssetView[];
  lookup: Lookup;
  onCampaign(source: RefSource): void;
  focusPrompt(): void;
}) {
  const { studio, dock, copy, organizationId, jobs, assets, lookup, onCampaign, focusPrompt } = input;
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

  /** A partial edit set up again: its picture open, the same box drawn and the same words written. */
  const reopenRegion = (job: StudioJobView) => {
    const target = job.parentOutputId && lookup.output(job.parentOutputId)
      ? { list: "outputs" as const, key: `o:${job.parentOutputId}` }
      : job.parentAssetId && lookup.asset(job.parentAssetId)
        ? { list: "assets" as const, key: `a:${job.parentAssetId}` }
        : null;
    if (!target) return setNotice(errorLine(copy, "not_found"));
    setPreset({ key: target.key, box: job.box, instruction: job.prompt });
    setOpen(target);
    setNotice(null);
  };

  const reuse = (job: StudioJobView) => {
    dock.reuse(job, lookup);
    show(null);
    focusPrompt();
  };

  const actions: ViewerActions = {
    regionEdit: (item, box: RegionBox, instruction) =>
      run("region", async () => {
        const source = item.type === "output" ? { outputId: item.output.id } : { assetId: item.asset.id };
        const ids = { organizationId, requestId: newRequestId() };
        const result = await studio.createJob(regionEditInput({ ids, source, box, instruction, draft: dock.draft }));
        if (!isFailure(result)) setPreset(null);
        return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
      }),
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
    campaign: (item) => onCampaign(item.type === "output" ? { outputId: item.output.id } : { assetId: item.asset.id }),
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
  };

  return { open, show, items, index, busy, notice, preset, actions, rerun: actions.rerun, reuse };
}
