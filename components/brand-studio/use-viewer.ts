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
import type { StudioAssetView, StudioJobCreate, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure, uploadProblem } from "./api";
import { errorLine, newRequestId, type StudioCopy } from "./copy";
import { finalInput, regionEditInput, rerunInput, withMedium } from "./dock-model";
import { trayFromReferences, trayItemFromAsset, trayItemFromOutput, withStartFrame, type RefSource, type TrayItem } from "./refs";
import type { ReviseSupport } from "./revise-form";
import { STUDIO_OPEN_REVERSE, announce, type LayerEditorRegionPreset } from "./seams";
import { collapseRevisions, reviseRerunInput } from "./revision-model";
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
  onOpenRegionEditor?(source: RefSource, preset?: LayerEditorRegionPreset | null): void;
  onReview(item: ViewerItem): void;
  /** "영상으로 만들기" on the image screen: the video screen with this picture as the opening frame. */
  onToVideoScreen(source: RefSource): void;
  /** A partial edit is on its way (`key`) or has come back (`done`); `line` explains a refusal. */
  onRegionSending(event: { key: string; ratio: string } | { done: string; line: string | null }): void;
  focusPrompt(): void;
  /** Region edit v2 (`StudioState.regionV2`): every partial edit runs on one engine. */
  regionV2?: boolean;
  /** `StudioState.reviseV2`: the clip edit panel is a conversation; drafts and finals are named on version cards. */
  reviseV2?: boolean;
}) {
  const { studio, dock, copy, locale, mode, organizationId, jobs, assets, lookup, onCampaign, focusPrompt } = input;
  const [open, setOpen] = useState<{ list: "outputs" | "assets"; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preset, setPreset] = useState<RegionPreset | null>(null);

  // Prev/next walks the wall's tiles: older versions of a clip are reached through the viewer's strip,
  // and the version on screen stays in the list while a newer one comes in.
  const items: ViewerItem[] = useMemo(() => {
    if (open?.list === "assets") return assets.map((asset) => ({ type: "asset" as const, asset }));
    const showing = open ? boardOutputs(jobs).find(({ output }) => `o:${output.id}` === open.key)?.job.id : null;
    return boardOutputs(collapseRevisions(jobs, showing)).map(({ output, job }) => ({ type: "output" as const, output, job }));
  }, [open, assets, jobs]);
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
    const resolved = job.parentOutputId && lookup.output(job.parentOutputId)
      ? { list: "outputs" as const, key: `o:${job.parentOutputId}`, source: { outputId: job.parentOutputId } as RefSource }
      : job.parentAssetId && lookup.asset(job.parentAssetId)
        ? { list: "assets" as const, key: `a:${job.parentAssetId}`, source: { assetId: job.parentAssetId } as RefSource }
        : null;
    if (!resolved) return setNotice(errorLine(copy, "not_found"));
    const references = trayFromReferences(job.references, lookup, copy.viewer.label);
    if (input.onOpenRegionEditor) {
      show(null);
      input.onOpenRegionEditor(resolved.source, {
        box: job.box,
        instruction: job.prompt,
        serverNumbered: job.finalPrompt !== null,
        model: job.model,
        quality: job.quality ?? null,
        references,
      });
      return;
    }
    setPreset({ key: resolved.key, box: job.box, instruction: job.prompt, model: job.model, quality: job.quality ?? null, references });
    setOpen({ list: resolved.list, key: resolved.key });
    setNotice(null);
  };

  /** Opens a picture straight on its partial-edit form (the wall's "부분 수정"). */
  const openRegion = (key: string, list: "outputs" | "assets" = "outputs") => {
    if (input.onOpenRegionEditor) {
      const source: RefSource = key.startsWith("a:") ? { assetId: key.slice(2) } : { outputId: key.slice(2) };
      show(null);
      input.onOpenRegionEditor(source, null);
      return;
    }
    setPreset({ key, box: null, instruction: "" });
    setOpen({ list, key });
    setNotice(null);
  };

  const reuse = (target: StudioJobView) => {
    // A version's own words are only the change; its settings are the clip's first run.
    const job = (target.revision && jobs.find((j) => j.id === target.revision!.rootJobId)) || target;
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
      ...(input.regionV2 ? { v2: true } : {}),
    });
    const result = await studio.createJob(body);
    const line = isFailure(result) ? errorLine(copy, result.code) : null;
    input.onRegionSending({ done: key, line });
    return !line;
  };

  const actions: ViewerActions = {
    regionEdit,
    rerun: (job) => {
      // A clip version (also a failed one on the wall) is asked for again from the same base.
      if (job.revision)
        return void run("rerun", async () => {
          const again = reviseRerunInput(job, { organizationId, requestId: newRequestId() });
          if (!again) return errorLine(copy, "not_found");
          const result = await studio.createJob(again);
          return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
        });
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
    ...(input.onOpenRegionEditor
      ? {
          openRegionInLayers: (item: ViewerItem) => {
            show(null);
            input.onOpenRegionEditor?.(sourceOf(item), null);
          },
        }
      : {}),
    review: (item) => input.onReview(item),
  };

  /** The viewer's version strip and form; the screen adds the picture sources (recent, resolve, upload). */
  const revise: ReviseSupport = useMemo(
    () => ({
      organizationId,
      jobs,
      recent: [
        ...jobs.flatMap((job) => job.outputs.filter((o) => o.kind === "image").map((o) => trayItemFromOutput(o, copy.viewer.label))).slice(0, 12),
        ...assets.filter((a) => a.kind === "image").slice(0, 6).map(trayItemFromAsset),
        // Videos the team uploaded: material a revision can read (a texture, a movement, a look).
        ...assets.filter((a) => a.kind === "video").slice(0, 4).map(trayItemFromAsset),
      ],
      resolve: (source: RefSource) => {
        const asset = "assetId" in source ? lookup.asset(source.assetId) : null;
        const output = "outputId" in source ? lookup.output(source.outputId) : null;
        const item = asset ? trayItemFromAsset(asset) : output ? trayItemFromOutput(output, copy.viewer.label) : null;
        return item?.kind === "image" || item?.kind === "video" ? item : null;
      },
      upload: async (files: File[]) => {
        const added: TrayItem[] = [];
        for (const file of files) {
          if (!(file.type.startsWith("image/") || file.type.startsWith("video/")) || uploadProblem(file)) continue;
          const result = await studio.upload(file);
          if (!isFailure(result)) added.push(trayItemFromAsset(result.asset));
        }
        return added;
      },
      plan: (body) => studio.planRevision(body),
      create: (body: StudioJobCreate) => studio.createJob(body),
      readMark: (body) => studio.readMark(body),
      ...(input.reviseV2 ? { dialogue: true } : {}),
    }),
    [organizationId, jobs, assets, lookup, studio, copy.viewer.label, input.reviseV2],
  );

  return { open, show, items, revise, index, busy, notice, setNotice, preset, actions, rerun: actions.rerun, reuse, openRegion };
}
