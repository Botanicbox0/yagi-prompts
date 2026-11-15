"use client";
/**
 * The viewer (docs/BRAND-STUDIO-V3.md §4, V2 §5.2): one result or asset, large, with the actions that
 * apply to it. A centred dialog (full screen on a phone); only the side column scrolls. Esc closes,
 * ←/→ move between results, focus stays inside and returns to where it was.
 *
 * Partial edit v2: drawing a box opens the form beside the picture (input preview = 1, references from
 * 2, model, credits, instruction). While the form is open the dialog stops being modal and docks over
 * the wall, so the library rail on the right stays usable for dragging references in. Sending closes
 * the form at once; nothing waits for the result, and several edits can go out in a row.
 * A result that came from a partial edit opens on a before/after slider.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { copyImageUrlToClipboard, isEditableTextTarget } from "@/lib/brand-studio/clipboard-image";
import type { RegionBox, StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioImageModel } from "@/lib/brand-studio/models";
import { errorLine, fill, type StudioCopy, type StudioLocale } from "./copy";
import { qualityOf, regionCredits, regionInstructionForForm, regionProblem, type RegionProblem } from "./dock-model";
import { CompareSlider } from "./gallery/compare";
import { RegionForm } from "./gallery/region-form";
import { StudioIcon, type StudioIconName } from "./icons";
import type { RefSource, TrayItem } from "./refs";
import { RegionEditor } from "./region-editor";
import { ReviseForm, VersionStrip, type ReviseSupport } from "./revise-form";
import { chainOf, versionOf, type ChainVersion } from "./revision-model";

export type ViewerItem = { type: "output"; output: StudioOutputView; job: StudioJobView } | { type: "asset"; asset: StudioAssetView };

/** One partial edit as the form hands it over. Numbers in `instruction` are the form's (cut-out = 1). */
export interface RegionRequest {
  box: RegionBox;
  instruction: string;
  model: string;
  /** "" when the model has no quality choice. */
  quality: string;
  references: TrayItem[];
}

export interface ViewerActions {
  /** Starts a partial edit without waiting for it; false when it could not even be sent. */
  regionEdit(item: ViewerItem, request: RegionRequest): boolean | Promise<boolean>;
  /** Plain runs start again as they were; a partial edit reopens its box; a reference-video run goes back to the bar. */
  rerun(job: StudioJobView): void;
  toVideo(item: ViewerItem): void;
  /** The press alternative to dragging this result or asset into the bar. */
  reference(item: ViewerItem): void;
  save(output: StudioOutputView): void;
  campaign(item: ViewerItem): void;
  finalize(output: StudioOutputView): void;
  reuse(job: StudioJobView): void;
  /** True when the result is gone. */
  remove(output: StudioOutputView): Promise<boolean>;
  /** "꾸미기": the layer editor on this picture. */
  decorate?(item: ViewerItem): void;
  /** Opens unified region edit inside the layer editor when wired by the screen. */
  openRegionInLayers?(item: ViewerItem): void;
  /** "리뷰에 올리기". */
  review?(item: ViewerItem): void;
}

/** Opens the partial-edit form on one item with a box and an instruction already in place. */
export interface RegionPreset {
  key: string;
  box: RegionBox | null;
  instruction: string;
  model?: string;
  quality?: string | null;
  references?: TrayItem[];
}

/** What the partial-edit form needs from the screen. */
export interface RegionSupport {
  models: readonly StudioImageModel[];
  defaultModel: string;
  /** The bar's quality, used when the edit model offers one. */
  defaultQuality?: string | null;
  recent: readonly TrayItem[];
  resolve(source: RefSource): TrayItem | null;
  /** Uploads picked files and answers them as references. */
  upload(files: File[]): Promise<TrayItem[]>;
}

export interface ViewerProps {
  items: readonly ViewerItem[];
  index: number;
  copy: StudioCopy;
  locale?: StudioLocale;
  /** Owner or editor: may save results, delete them and send them on. */
  canCreate: boolean;
  /** `canCreate` and an open allowance: may start new runs from here. */
  canGenerate: boolean;
  /** The action currently running, so its button shows it and cannot be pressed twice. */
  busy: string | null;
  notice: string | null;
  regionPreset?: RegionPreset | null;
  region?: RegionSupport | null;
  /** Versions of a generated clip: the strip and the "next version" form (video results only). */
  revise?: ReviseSupport | null;
  parentOf(outputId: string | null): StudioOutputView | null;
  parentAssetOf?(assetId: string | null): StudioAssetView | null;
  onIndex(index: number): void;
  onClose(): void;
  actions: ViewerActions;
}

export const itemKey = (item: ViewerItem) => (item.type === "output" ? `o:${item.output.id}` : `a:${item.asset.id}`);
const media = (item: ViewerItem) => (item.type === "output" ? item.output : item.asset);
/** Everything but a 1080p final can be made again with the settings it had. */
export const canRerun = (job: StudioJobView) => job.kind !== "video_final";

/** What the viewer shows: the opened result for its own version, else the result that represents the picked version. */
export function shownVersion(opened: ViewerItem, chain: readonly ChainVersion[], own: number, selected: number): ViewerItem {
  if (selected === own) return opened;
  const entry = chain.find((v) => v.version === selected);
  return entry?.output ? { type: "output", output: entry.output, job: entry.job } : opened;
}

/** A modal dialog that turns non-modal and docks over the wall while `docked` (the rail stays usable). */
function useViewerDialog(docked: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || typeof dialog.showModal !== "function") return;
    const modal = dialog.matches?.(":modal") ?? false;
    if (dialog.open && modal === !docked) return;
    if (dialog.open) dialog.close();
    if (docked) dialog.show();
    else dialog.showModal();
  }, [docked]);
  return ref;
}

export function problemText(problem: RegionProblem, copy: StudioCopy): string {
  switch (problem.kind) {
    case "need_box":
      return copy.region.needBox;
    case "empty_prompt":
      return copy.dock.emptyPrompt;
    case "image_only":
      return copy.tray.imageOnly;
    case "too_many_images":
      return fill(copy.tray.tooManyImages, { n: problem.max });
    case "missing":
      return fill(copy.region.missing, { n: problem.mentions.map((m) => m.number).join(", ") });
  }
}

export function Viewer(props: ViewerProps) {
  const { items, index, copy, onIndex, onClose } = props;
  const [docked, setDocked] = useState(Boolean(props.regionPreset && props.regionPreset.key === (items[index] ? itemKey(items[index]!) : "")));
  const ref = useViewerDialog(docked);
  const id = useId();
  const item = items[index];
  if (!item) return null;
  const keys = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.defaultPrevented || (event.target as HTMLElement).closest?.("input, textarea, select")) return;
    if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    else if (event.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
  };
  return (
    <dialog
      ref={ref}
      className="bs-viewer"
      aria-labelledby={`${id}-title`}
      data-studio-viewer
      data-docked={docked ? "" : undefined}
      onKeyDown={(event) => {
        // A non-modal dialog gets no `cancel` from Escape, so the docked form closes itself.
        if (docked && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
          return;
        }
        keys(event);
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="bs-viewer-bar">
        <h2 id={`${id}-title`} className="bs-sr">
          {item.type === "output" ? copy.viewer.label : copy.viewer.assetLabel}
        </h2>
        <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.prev} disabled={index === 0} onClick={() => onIndex(index - 1)}>
          <StudioIcon name="prev" />
        </button>
        <span className="bs-num bs-muted">
          {index + 1} / {items.length}
        </span>
        <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.next} disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)}>
          <StudioIcon name="next" />
        </button>
        <span className="bs-spacer" />
        <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.close} onClick={onClose}>
          <StudioIcon name="close" />
        </button>
      </div>
      <ViewerContent key={itemKey(item)} {...props} item={item} onRegion={setDocked} />
    </dialog>
  );
}

function ViewerContent({
  item: openedItem,
  copy,
  locale = "ko",
  canCreate,
  canGenerate,
  busy,
  notice,
  regionPreset = null,
  region: support = null,
  revise = null,
  parentOf,
  parentAssetOf,
  actions,
  onRegion,
}: ViewerProps & { item: ViewerItem; onRegion(open: boolean): void }) {
  const v = copy.viewer;
  // Versions of a generated clip: the strip swaps what is shown here without leaving the viewer.
  const clip = revise && openedItem.type === "output" && openedItem.output.kind === "video" ? openedItem.job : null;
  const chain = useMemo(() => (clip && revise ? chainOf(revise.jobs, clip) : []), [clip, revise]);
  const ownVersion = clip && revise ? (versionOf(revise.jobs, clip) ?? 1) : 1;
  const [selected, setSelected] = useState(ownVersion);
  const item = shownVersion(openedItem, chain, ownVersion, selected);
  const videoRef = useRef<HTMLVideoElement>(null);
  // The figure the revise form draws marks into (a state, so the form re-renders once it exists).
  const [mediaHost, setMediaHost] = useState<HTMLElement | null>(null);
  const playback = useRef<{ time: number; playing: boolean } | null>(null);
  const selectVersion = (version: number) => {
    const video = videoRef.current;
    playback.current = video ? { time: video.currentTime, playing: !video.paused } : null;
    setSelected(version);
  };
  const resume = () => {
    const video = videoRef.current;
    const at = playback.current;
    playback.current = null;
    if (!video || !at) return;
    video.currentTime = Number.isFinite(video.duration) ? Math.min(at.time, video.duration) : at.time;
    if (at.playing) void video.play().catch(() => undefined);
  };
  const preset = regionPreset?.key === itemKey(item) ? regionPreset : null;
  const [region, setRegionState] = useState(Boolean(preset));
  const [box, setBox] = useState<RegionBox | null>(preset?.box ?? null);
  const [instruction, setInstruction] = useState(preset ? regionInstructionForForm(preset.instruction, locale) : "");
  const [model, setModelState] = useState(preset?.model ?? support?.defaultModel ?? "");
  const [quality, setQuality] = useState(() => qualityOf(support?.models.find((m) => m.id === (preset?.model ?? support?.defaultModel)) ?? null, preset?.quality ?? support?.defaultQuality));
  const setModel = (id: string) => {
    setModelState(id);
    setQuality((current) => qualityOf(support?.models.find((m) => m.id === id) ?? null, current));
  };
  const [refs, setRefs] = useState<TrayItem[]>(preset?.references ?? []);
  const [uploading, setUploading] = useState(false);
  const [regionNote, setRegionNote] = useState<string | null>(null);
  const [sentLine, setSentLine] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const file = media(item);
  const job = item.type === "output" ? item.job : null;
  // Only a partial edit compares against what it was made from (a final or a clip version also has a parent).
  const parent = job?.kind === "region_edit" ? parentOf(job.parentOutputId) : null;
  const parentAsset = job?.kind === "region_edit" && !parent && parentAssetOf ? parentAssetOf(job.parentAssetId) : null;
  const before = parent ?? parentAsset;
  const image = file.kind === "image";

  const copyCurrentImage = async () => {
    if (!image) return;
    const res = await copyImageUrlToClipboard(file.url);
    setCopyToast(res.ok ? v.copiedImage : v.copyFailed);
  };

  useEffect(() => {
    if (!copyToast) return;
    const timer = window.setTimeout(() => setCopyToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [copyToast]);

  useEffect(() => {
    if (!image || typeof window === "undefined") return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTextTarget(event.target)) return;
      const selection = typeof window.getSelection === "function" ? window.getSelection()?.toString() ?? "" : "";
      if (selection.trim()) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyCurrentImage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, file.url]);
  const name = item.type === "asset" ? item.asset.name : "";
  const comparing = !region && image && job?.kind === "region_edit" && before?.kind === "image";

  const setRegion = (open: boolean) => {
    setRegionState(open);
    onRegion(open);
  };
  // A picture opens docked only when it opens on its partial-edit form.
  const opened = useRef(Boolean(preset));
  useEffect(() => onRegion(opened.current), [onRegion]);

  const picture =
    file.kind === "video" ? (
      <video ref={videoRef} src={file.url} poster={file.thumbUrl ?? undefined} controls playsInline preload="metadata" onLoadedMetadata={resume} />
    ) : file.kind === "audio" ? (
      <audio src={file.url} controls preload="metadata" />
    ) : (
      <img src={file.url} alt={name} draggable={false} />
    );

  async function sendRegion() {
    const problem = regionProblem({ box, instruction, model, references: refs });
    if (problem) return setRegionNote(problemText(problem, copy));
    setRegionNote(null);
    const request: RegionRequest = { box: box!, instruction: instruction.trim(), model, quality, references: refs };
    // The form closes at once; the run takes its place in the wall and nothing here waits for it.
    setRegion(false);
    setBox(null);
    setInstruction("");
    setRefs([]);
    setSentLine(copy.region.sent);
    const accepted = await actions.regionEdit(item, request);
    if (!accepted) setSentLine(null);
  }

  const output = item.type === "output" ? item.output : null;
  const tiles: Array<{ name: string; icon: StudioIconName; label: string; run(): void; show: boolean }> = [
    {
      name: "region",
      icon: "region",
      label: v.regionEdit,
      run: () => (actions.openRegionInLayers ? actions.openRegionInLayers(item) : setRegion(true)),
      show: canGenerate && image && Boolean(support || actions.openRegionInLayers),
    },
    { name: "rerun", icon: "rerun", label: v.rerun, run: () => job && actions.rerun(job), show: canGenerate && Boolean(job && canRerun(job)) },
    {
      name: "decorate",
      icon: "layers",
      label: v.decorate,
      run: () => actions.decorate?.(item),
      show: canCreate && image && Boolean(actions.decorate) && Boolean(actions.openRegionInLayers || (file.width && file.height)),
    },
    { name: "to-video", icon: "video", label: v.toVideo, run: () => actions.toVideo(item), show: canGenerate && image },
    { name: "reference", icon: "attach", label: v.reference, run: () => actions.reference(item), show: canGenerate },
    { name: "save", icon: "save", label: v.save, run: () => output && actions.save(output), show: canCreate && Boolean(output) && !output?.savedAssetId },
    { name: "finalize", icon: "spark", label: v.finalize, run: () => output && actions.finalize(output), show: canGenerate && Boolean(output?.draft) },
    { name: "review", icon: "review", label: locale === "en" ? "Review & Share" : "검수 · 공유", run: () => actions.review?.(item), show: canCreate && Boolean(actions.review) },
    { name: "campaign", icon: "send", label: v.campaign, run: () => actions.campaign(item), show: canCreate },
  ];
  const saved = canCreate && Boolean(output?.savedAssetId);

  return (
    <div className="bs-viewer-body" data-region={region ? "" : undefined}>
      <figure ref={setMediaHost} className="bs-viewer-media" data-kind={file.kind}>
        {region ? (
          <RegionEditor box={box} onChange={setBox} copy={copy}>
            {picture}
          </RegionEditor>
        ) : comparing && before ? (
          <CompareSlider
            before={before.url}
            after={file.url}
            width={file.width}
            height={file.height}
            labels={{ before: v.before, after: v.after, range: v.compareRange, hint: v.compareHint }}
          />
        ) : (
          picture
        )}
      </figure>
      <div className="bs-viewer-side">
        {clip && chain.length >= 2 && <VersionStrip versions={chain} selected={selected} copy={copy} onSelect={selectVersion} />}
        {clip && revise && canGenerate && output && (
          <ReviseForm
            key={output.id}
            outputId={output.id}
            support={revise}
            copy={copy}
            locale={locale}
            fallbackVersion={Math.max(1, ...chain.map((entry) => entry.version)) + 1}
            stage={file.kind === "video" && !region ? { video: videoRef, host: mediaHost, url: file.url } : null}
          />
        )}
        {region && support ? (
          <RegionForm
            picture={{ url: file.url, width: file.width, height: file.height }}
            box={box}
            copy={copy}
            locale={locale}
            models={support.models}
            model={model}
            quality={quality}
            onQuality={setQuality}
            references={refs}
            recent={support.recent.filter((r) => r.key !== itemKey(item))}
            instruction={instruction}
            note={regionNote}
            credits={regionCredits(model, refs.length, quality)}
            uploading={uploading}
            onBox={setBox}
            onModel={setModel}
            onReferences={setRefs}
            resolve={support.resolve}
            onFiles={(files) => {
              setUploading(true);
              void support
                .upload(files)
                .then((added) => setRefs((current) => [...current, ...added.filter((a) => !current.some((c) => c.key === a.key))]))
                .catch(() => setRegionNote(errorLine(copy, "failed")))
                .finally(() => setUploading(false));
            }}
            onInstruction={setInstruction}
            onCancel={() => {
              setRegion(false);
              setRegionNote(null);
            }}
            onSend={() => void sendRegion()}
          />
        ) : (
          <div className="bs-viewer-actions" data-studio-viewer-actions>
            {comparing && <p className="bs-muted">{v.compareHint}</p>}
            {sentLine && (
              <p className="bs-notice" role="status" data-studio-region-sent>
                {sentLine}
              </p>
            )}
            <div className="bs-action-grid">
              {tiles.filter((tile) => tile.show).map((tile) => (
                <button
                  key={tile.name}
                  type="button"
                  className="bs-btn bs-action"
                  data-variant="soft"
                  data-action={tile.name}
                  disabled={busy === tile.name}
                  aria-busy={busy === tile.name}
                  onClick={tile.run}
                >
                  <StudioIcon name={tile.icon} />
                  <span>{tile.label}</span>
                </button>
              ))}
              {saved && (
                <p className="bs-action bs-action-done" data-studio-saved>
                  <StudioIcon name="save" />
                  <span>{v.saved}</span>
                </p>
              )}
            </div>
            <div className="bs-row bs-quiet-actions">
              {image && (
                <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" data-copy-image onClick={() => void copyCurrentImage()}>
                  {v.copyImage}
                </button>
              )}
              <a className="bs-btn" data-variant="ghost" data-size="sm" href={file.url} download target="_blank" rel="noopener noreferrer" data-action="download">
                <StudioIcon name="download" />
                {v.download}
              </a>
              {canCreate && output && !confirming && (
                <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" data-action="delete" onClick={() => setConfirming(true)}>
                  <StudioIcon name="trash" />
                  {v.delete}
                </button>
              )}
            </div>
            {copyToast && (
              <p className="bs-notice" role="status" data-viewer-copy-toast>
                {copyToast}
              </p>
            )}
            {confirming && output && (
              <div className="bs-confirm-box" role="group" aria-label={v.delete} data-studio-delete-confirm>
                <p>{v.deleteConfirm}</p>
                <div className="bs-row">
                  <button type="button" className="bs-btn" data-variant="soft" data-size="sm" data-tone="danger" disabled={busy === "delete"} onClick={() => void actions.remove(output).then((gone) => !gone && setConfirming(false))}>
                    {v.delete}
                  </button>
                  <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => setConfirming(false)}>
                    {v.cancel}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {notice && <p className="bs-notice" role="status">{notice}</p>}
        {job && !region && (
          <details className="bs-prompt-details" data-studio-prompt-details>
            <summary>{v.promptToggle}</summary>
            <p className="bs-label">{v.yourPrompt}</p>
            <p>{job.prompt || copy.board.noPrompt}</p>
            <p className="bs-label">{v.sentPrompt}</p>
            <p>{job.finalPrompt ?? v.notEnhanced}</p>
            {canGenerate && job.kind !== "video_final" && (
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => actions.reuse(job)}>
                {v.reuse}
              </button>
            )}
          </details>
        )}
      </div>
    </div>
  );
}
