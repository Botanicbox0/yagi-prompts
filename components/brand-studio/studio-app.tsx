"use client";
/**
 * Brand studio v2, the "만들기" tab (docs/BRAND-STUDIO-V2.md §5.2): result board, prompt dock and the
 * asset library, plus the viewer and the campaign handoff. The only client island on the page.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { StudioJobView, StudioState } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { isFailure, uploadProblem, type StudioApi } from "./api";
import { AssetPanel } from "./asset-panel";
import { Board } from "./board";
import { errorLine, fill, formatKrw, type StudioCopy, type StudioLocale } from "./copy";
import { Dock } from "./dock";
import { DRAFT_RESOLUTION, dockEstimateKrw, regionEstimateKrw, remixActive, remixFit, withMedium } from "./dock-model";
import { HandoffDialog, handoffInput } from "./handoff-dialog";
import { trayItemFromAsset, trayItemFromOutput, trayLabels, type RefSource } from "./refs";
import { findOutput } from "./store";
import { useDock } from "./use-dock";
import { useStudio } from "./use-studio";
import { useViewer } from "./use-viewer";
import { Viewer, canRerun, itemKey } from "./viewer";

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

const focusPrompt = () => document.querySelector<HTMLTextAreaElement>("[data-studio-dock] textarea.bs-prompt")?.focus();

/** The studio header's slot (v2-page.tsx), where the phone's "에셋 보기" button lives. */
function useHeadSlot() {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => setSlot(document.querySelector("[data-studio-head-slot]")), []);
  return slot;
}

export function StudioApp({ organizationId, locale, copy, initialMedium = "image", initialState = null, api }: StudioAppProps) {
  const studio = useStudio({ organizationId, initialState, api });
  const dock = useDock({ studio, copy, organizationId, initialMedium });
  const state = studio.store.state;
  const jobs = useMemo(() => state?.jobs ?? [], [state?.jobs]);
  const assets = useMemo(() => state?.assets ?? [], [state?.assets]);
  const canCreate = state?.canCreate ?? false;
  const dockOpen = canCreate && (state?.allowance.capKrw ?? 0) > 0;
  const [handoff, setHandoff] = useState<RefSource | null>(null);
  const [sheet, setSheet] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [jobNotes, setJobNotes] = useState<Record<string, string>>({});
  const searchId = useId();
  const panelId = useId();
  const headSlot = useHeadSlot();

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
  // A clip too short to edit can only be followed in a new take.
  const editable = remixFit(dock.draft, dock.tray)?.editable ?? true;
  useEffect(() => {
    if (!editable) setDraft((current) => (current.method === "edit" ? { ...current, method: "reference" } : current));
  }, [editable, setDraft]);

  const parentOf = useCallback((outputId: string | null) => findOutput(jobs, outputId), [jobs]);
  const lookup = useMemo(
    () => ({ asset: (id: string) => assets.find((a) => a.id === id) ?? null, output: (id: string) => findOutput(jobs, id) }),
    [assets, jobs],
  );
  const viewer = useViewer({ studio, dock, copy, organizationId, jobs, assets, lookup, onCampaign: setHandoff, focusPrompt });

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

  const cancel = useCallback(
    async (job: StudioJobView) => {
      setStopping(job.id);
      const result = await studio.cancelJob(job.id);
      setStopping(null);
      setJobNotes((notes) => {
        const { [job.id]: _dropped, ...rest } = notes;
        if (!isFailure(result)) return rest;
        return { ...rest, [job.id]: result.code === "conflict" ? copy.board.cancelLate : errorLine(copy, result.code) };
      });
    },
    [copy, studio],
  );

  const assetsToggle = (
    <button
      type="button"
      className="bs-btn bs-assets-toggle"
      data-variant="soft"
      data-size="sm"
      aria-expanded={sheet}
      aria-controls={panelId}
      onClick={() => setSheet(true)}
    >
      {copy.assets.toggle}
    </button>
  );

  const handoffKind = handoff
    ? (("assetId" in handoff ? lookup.asset(handoff.assetId)?.kind : lookup.output(handoff.outputId)?.kind) === "video" ? "video" : "image")
    : "image";
  const loading = studio.store.phase === "loading" && !state;
  return (
    <div className="bs-studio" data-studio-phase={studio.store.phase} data-studio-can-create={canCreate ? "" : undefined}>
      <div className="bs-main">
        {headSlot ? createPortal(assetsToggle, headSlot) : <div className="bs-toolbar">{assetsToggle}</div>}
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
        {status && <p className="bs-notice" role="status">{status}</p>}
        {state && (
          <Board
            jobs={jobs}
            copy={copy}
            locale={locale}
            canCreate={dockOpen}
            canStop={canCreate}
            stopping={stopping}
            notes={jobNotes}
            parentOf={parentOf}
            onOpen={(outputId) => viewer.show({ list: "outputs", key: `o:${outputId}` })}
            onRetry={(job) => (canRerun(job) ? viewer.rerun(job) : viewer.reuse(job))}
            onCancel={(job) => void cancel(job)}
            onExample={(text, medium) => {
              dock.setDraft((current) => ({ ...withMedium(current, medium), prompt: text }));
              focusPrompt();
            }}
          />
        )}
        {state && dockOpen && (
          <Dock
            draft={dock.draft}
            tray={dock.tray}
            labels={trayLabels(dock.tray, copy)}
            copy={copy}
            locale={locale}
            allowance={state.allowance}
            quoteKrw={dockEstimateKrw(dock.draft, dock.tray)}
            busy={dock.busy}
            message={dock.message}
            notice={dock.notice}
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
          id={panelId}
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
          onView={(asset) => viewer.show({ list: "assets", key: `a:${asset.id}` })}
          onFiles={(files) => void uploadFiles(files, false)}
          onUpdate={studio.updateAsset}
          onDelete={studio.deleteAsset}
        />
      )}
      {viewer.open && viewer.index >= 0 && (
        <Viewer
          items={viewer.items}
          index={viewer.index}
          copy={copy}
          canCreate={canCreate}
          canGenerate={dockOpen}
          busy={viewer.busy}
          notice={viewer.notice}
          regionQuote={fill(copy.board.usage, { amount: formatKrw(regionEstimateKrw(dock.draft), locale) })}
          regionPreset={viewer.preset}
          parentOf={parentOf}
          onIndex={(index) => {
            const item = viewer.items[index];
            if (item && viewer.open) viewer.show({ list: viewer.open.list, key: itemKey(item) });
          }}
          onClose={() => viewer.show(null)}
          actions={viewer.actions}
        />
      )}
      {handoff && state && (
        <HandoffDialog
          campaigns={state.campaigns}
          copy={copy}
          kind={handoffKind}
          onSend={(choice, requestId, asFormat) => studio.handoff(handoffInput(handoff, choice, { organizationId, requestId }, asFormat))}
          onDone={(href) => window.location.assign(href)}
          onClose={() => setHandoff(null)}
        />
      )}
    </div>
  );
}
