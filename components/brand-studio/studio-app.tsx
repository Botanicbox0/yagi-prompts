"use client";
/**
 * Brand studio v2, the "만들기" tab (docs/BRAND-STUDIO-V2.md §5.2): result board, prompt dock and the
 * asset library, plus the viewer and the campaign handoff. The only client island on the page.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { RegionBox, StudioState } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure, uploadProblem, type StudioApi } from "./api";
import { AssetPanel } from "./asset-panel";
import { Board } from "./board";
import { errorLine, newRequestId, type StudioCopy, type StudioLocale } from "./copy";
import { Dock } from "./dock";
import { DRAFT_RESOLUTION, finalInput, knownEstimate, regionEditInput, remixActive, rerunInput, withMedium } from "./dock-model";
import { HandoffDialog, handoffInput } from "./handoff-dialog";
import { trayItemFromAsset, trayItemFromOutput, trayLabels, withStartFrame, type RefSource } from "./refs";
import { boardOutputs, findOutput } from "./store";
import { useDock } from "./use-dock";
import { useStudio } from "./use-studio";
import { Viewer, canRerun, itemKey, type ViewerActions, type ViewerItem } from "./viewer";

export interface StudioAppProps {
  organizationId: string;
  locale: StudioLocale;
  copy: StudioCopy;
  initialMedium?: StudioMedium;
  /** Server-loaded state; without it the screen loads its own on mount. */
  initialState?: StudioState | null;
  api?: StudioApi;
}

/** The workspace's live support drawer (components/brand-workspace/support.tsx). */
function openSupport() {
  document.querySelector<HTMLButtonElement>("[data-concierge-launcher]")?.click();
}

export function StudioApp({ organizationId, locale, copy, initialMedium = "image", initialState = null, api }: StudioAppProps) {
  const studio = useStudio({ organizationId, initialState, api });
  const dock = useDock({ studio, copy, organizationId, initialMedium });
  const state = studio.store.state;
  const jobs = state?.jobs ?? [];
  const assets = state?.assets ?? [];
  const canCreate = state?.canCreate ?? false;
  const dockOpen = canCreate && (state?.allowance.capKrw ?? 0) > 0;
  const [viewer, setViewer] = useState<{ list: "outputs" | "assets"; key: string } | null>(null);
  const [viewerBusy, setViewerBusy] = useState<string | null>(null);
  const [viewerNotice, setViewerNotice] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<RefSource | null>(null);
  const [sheet, setSheet] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const searchId = useId();
  const promptFocus = () => document.querySelector<HTMLTextAreaElement>("[data-studio-dock] textarea.bs-prompt")?.focus();

  // A reference video in a video run: read it once, and start from the 480p draft.
  const remixOn = remixActive(dock.draft, dock.tray);
  const remixVideo = remixOn ? dock.tray.find((item) => item.kind === "video") : undefined;
  const { analyzeFilm } = studio;
  const { setDraft } = dock;
  useEffect(() => {
    if (remixVideo?.assetId) analyzeFilm(remixVideo.assetId);
  }, [remixVideo?.assetId, analyzeFilm]);
  useEffect(() => {
    if (remixOn) setDraft((current) => ({ ...current, resolution: DRAFT_RESOLUTION }));
  }, [remixOn, setDraft]);

  const parentOf = useCallback((outputId: string | null) => findOutput(jobs, outputId), [jobs]);
  const lookup = useMemo(
    () => ({ asset: (id: string) => assets.find((a) => a.id === id) ?? null, output: (id: string) => findOutput(jobs, id) }),
    [assets, jobs],
  );
  const viewerItems: ViewerItem[] = useMemo(
    () =>
      viewer?.list === "assets"
        ? assets.map((asset) => ({ type: "asset" as const, asset }))
        : boardOutputs(jobs).map(({ output, job }) => ({ type: "output" as const, output, job })),
    [viewer?.list, assets, jobs],
  );
  const viewerIndex = viewer ? viewerItems.findIndex((item) => itemKey(item) === viewer.key) : -1;

  const attachSource = useCallback(
    (source: RefSource) => {
      const asset = "assetId" in source ? lookup.asset(source.assetId) : null;
      const output = "outputId" in source ? lookup.output(source.outputId) : null;
      if (asset) dock.attach(trayItemFromAsset(asset));
      else if (output) dock.attach(trayItemFromOutput(output, copy.viewer.label));
    },
    [copy, dock, lookup],
  );

  const uploadFiles = useCallback(
    async (files: File[], attach: boolean) => {
      const say = attach ? dock.setMessage : setPanelNotice;
      say(null);
      await Promise.all(
        files.map(async (file) => {
          const problem = uploadProblem(file);
          if (problem) return say(errorLine(copy, problem));
          const result = await studio.upload(file);
          if (isFailure(result)) return say(errorLine(copy, result.code));
          if (attach) dock.attach(trayItemFromAsset(result.asset));
        }),
      );
    },
    [copy, dock, studio],
  );

  const run = useCallback(async (key: string, work: () => Promise<string | null>) => {
    setViewerBusy(key);
    setViewerNotice(null);
    const notice = await work();
    setViewerBusy(null);
    setViewerNotice(notice);
    return notice === copy.state.started || notice === null;
  }, [copy]);

  const actions: ViewerActions = {
    regionEdit: (item, box: RegionBox, instruction) =>
      run("region", async () => {
        const source = item.type === "output" ? { outputId: item.output.id } : { assetId: item.asset.id };
        const ids = { organizationId, requestId: newRequestId() };
        const result = await studio.createJob(regionEditInput({ ids, source, box, instruction, draft: dock.draft }));
        return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
      }),
    rerun: (job) =>
      void run("rerun", async () => {
        const input = rerunInput(job, { organizationId, requestId: newRequestId() });
        if (!input) return null;
        const result = await studio.createJob(input);
        return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
      }),
    toVideo: (item) => {
      const tile = item.type === "output" ? trayItemFromOutput(item.output, copy.viewer.label) : trayItemFromAsset(item.asset);
      dock.setDraft((current) => withMedium(current, "video"));
      dock.setTray((current) => withStartFrame(current, tile));
      setViewer(null);
      promptFocus();
    },
    reference: (item) => {
      dock.attach(item.type === "output" ? trayItemFromOutput(item.output, copy.viewer.label) : trayItemFromAsset(item.asset));
      setViewer(null);
      promptFocus();
    },
    save: (output) =>
      void run("save", async () => {
        const result = await studio.saveOutput(output.id);
        return isFailure(result) ? errorLine(copy, result.code) : null;
      }),
    campaign: (item) => {
      setHandoff(item.type === "output" ? { outputId: item.output.id } : { assetId: item.asset.id });
    },
    finalize: (output) =>
      void run("finalize", async () => {
        const result = await studio.createJob(finalInput({ organizationId, requestId: newRequestId() }, output.id));
        return isFailure(result) ? errorLine(copy, result.code) : copy.state.started;
      }),
    reuse: (job) => {
      dock.reuse(job, lookup);
      setViewer(null);
      promptFocus();
    },
  };

  const loading = studio.store.phase === "loading" && !state;
  return (
    <div className="bs-studio" data-studio-phase={studio.store.phase} data-studio-can-create={canCreate ? "" : undefined}>
      <div className="bs-main">
        <div className="bs-toolbar">
          <button type="button" className="bs-btn bs-assets-toggle" data-variant="ghost" data-size="sm" aria-expanded={sheet} onClick={() => setSheet(true)}>
            {copy.assets.toggle}
          </button>
        </div>
        {loading && (
          <div className="bs-skeleton" aria-busy="true" data-studio-skeleton>
            <span className="bs-sr" role="status">{copy.state.loading}</span>
            <span /><span /><span />
          </div>
        )}
        {studio.store.phase === "failed" && (
          <div className="bs-banner" role="alert" data-studio-load-failed>
            <p>{copy.state.loadFailed} {errorLine(copy, studio.store.code)}</p>
            <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => void studio.load()}>
              {copy.state.retry}
            </button>
          </div>
        )}
        {state && (
          <Board
            jobs={jobs}
            copy={copy}
            locale={locale}
            canCreate={dockOpen}
            parentOf={parentOf}
            onOpen={(outputId) => setViewer({ list: "outputs", key: `o:${outputId}` })}
            onRetry={(job) => (canRerun(job) ? actions.rerun(job) : actions.reuse(job))}
            onExample={(text, medium) => {
              dock.setDraft((current) => ({ ...withMedium(current, medium), prompt: text }));
              promptFocus();
            }}
          />
        )}
        {status && <p className="bs-notice" role="status">{status}</p>}
        {state && dockOpen && (
          <Dock
            draft={dock.draft}
            tray={dock.tray}
            labels={trayLabels(dock.tray, copy)}
            copy={copy}
            locale={locale}
            allowance={state.allowance}
            quoteKrw={knownEstimate(jobs, dock.draft, dock.tray)}
            busy={dock.busy}
            message={dock.message}
            film={remixVideo?.assetId ? studio.films[remixVideo.assetId] ?? null : null}
            uploading={studio.uploads.map((u) => u.name)}
            onDraft={dock.setDraft}
            onTrayUpdate={dock.update}
            onTrayRemove={dock.remove}
            onSubmit={() => {
              setStatus(null);
              void dock.submit().then((started) => started && setStatus(copy.state.started));
            }}
            onDropSource={attachSource}
            onFiles={(files) => void uploadFiles(files, true)}
            onBrowse={() => {
              setSheet(true);
              document.getElementById(searchId)?.focus();
            }}
          />
        )}
        {state && canCreate && !dockOpen && (
          <section className="bs-closed" data-studio-allowance-closed>
            <h2>{copy.dock.closedTitle}</h2>
            <p>{copy.dock.closedBody}</p>
            <button type="button" className="bs-btn" data-variant="solid" data-size="md" onClick={openSupport}>
              {copy.dock.closedAction}
            </button>
          </section>
        )}
        {state && !canCreate && (
          <p className="bs-readonly" data-studio-read-only>
            {copy.dock.readOnly}
          </p>
        )}
      </div>
      {state && (
        <AssetPanel
          assets={assets}
          copy={copy}
          canCreate={canCreate}
          attachOnPress={dockOpen}
          open={sheet}
          notice={panelNotice}
          uploading={studio.uploads.map((u) => u.name)}
          searchId={searchId}
          onClose={() => setSheet(false)}
          onAttach={(asset) => {
            dock.attach(trayItemFromAsset(asset));
            setSheet(false);
          }}
          onView={(asset) => setViewer({ list: "assets", key: `a:${asset.id}` })}
          onFiles={(files) => void uploadFiles(files, false)}
          onUpdate={studio.updateAsset}
          onDelete={studio.deleteAsset}
        />
      )}
      {viewer && viewerIndex >= 0 && (
        <Viewer
          items={viewerItems}
          index={viewerIndex}
          copy={copy}
          canCreate={canCreate}
          canGenerate={dockOpen}
          busy={viewerBusy}
          notice={viewerNotice}
          parentOf={parentOf}
          onIndex={(index) => {
            const item = viewerItems[index];
            if (item) setViewer({ list: viewer.list, key: itemKey(item) });
            setViewerNotice(null);
          }}
          onClose={() => {
            setViewer(null);
            setViewerNotice(null);
          }}
          actions={actions}
        />
      )}
      {handoff && state && (
        <HandoffDialog
          campaigns={state.campaigns}
          copy={copy}
          onSend={(choice, requestId) => studio.handoff(handoffInput(handoff, choice, { organizationId, requestId }))}
          onDone={(href) => window.location.assign(href)}
          onClose={() => setHandoff(null)}
        />
      )}
    </div>
  );
}
