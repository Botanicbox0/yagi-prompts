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
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { copyImageUrlToClipboard, isEditableTextTarget } from "@/lib/brand-studio/clipboard-image";
import type { RegionBox, StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { studioModelOrLegacy, type StudioImageModel } from "@/lib/brand-studio/models";
import { errorLine, fill, type StudioCopy, type StudioLocale } from "./copy";
import { qualityOf, regionCredits, regionInstructionForForm, regionProblem, type RegionProblem } from "./dock-model";
import { CopyButton, promptToCopy, sentPromptCopyable } from "./copy-prompt";
import { CompareSlider } from "./gallery/compare";
import { ModelCompare, canCompareModels, compareEntries, siblingOutput } from "./gallery/model-compare";
import { RegionForm } from "./gallery/region-form";
import { StudioIcon, type StudioIconName } from "./icons";
import type { RefSource, TrayItem } from "./refs";
import { RegionEditor } from "./region-editor";
import { ReviseForm, VersionPanel, VersionStrip, type ReviseSupport } from "./revise-form";
import { ReviseTalk, SheetCard, type TalkSupport } from "./revise-talk";
import { savedTalkOutputs } from "./revise-talk-store";
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
  /**
   * "이 설정 다시 쓰기": a run's whole setting back in the bar. A partial edit instead opens on its original
   * with the same area ("같은 영역 다시 수정하기"); `from` is the result it was pressed on (the fallback when
   * the original is gone).
   */
  reuse(job: StudioJobView, from?: StudioOutputView | null): void;
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
  /** Region edit v2: every partial edit runs on `defaultModel`; no model or quality is offered or kept. */
  fixedModel?: boolean;
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
  /** With `talk` (flag `BRAND_STUDIO_REVISE_V2`) the clip edit panel is the conversation (revise-talk.tsx). */
  revise?: (ReviseSupport & { talk?: TalkSupport }) | null;
  parentOf(outputId: string | null): StudioOutputView | null;
  parentAssetOf?(assetId: string | null): StudioAssetView | null;
  /** The runs made with this one on other models in one request (itself included), in pick order. */
  siblingsOf?(job: StudioJobView): readonly StudioJobView[];
  /** Opens one result (a sibling's) in this viewer. */
  onOpenOutput?(outputId: string): void;
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
  // "모델 비교" stays on while moving between the results of one request.
  const [comparing, setComparing] = useState(false);
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
        // Escape leaves "모델 비교" first; the next Escape closes the viewer.
        if (comparing && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          compareToggleHadFocus = Date.now();
          setComparing(false);
          return;
        }
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
        if (comparing) {
          compareToggleHadFocus = Date.now();
          setComparing(false);
        } else onClose();
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
      <ViewerContent key={itemKey(item)} {...props} item={item} onRegion={setDocked} comparing={comparing} onCompare={setComparing} />
    </dialog>
  );
}

/** Set when the switcher moved with a key, so the next result's switcher takes focus back (the content remounts). */
let switcherHadFocus = false;
/** Set when "모델 비교" was pressed: the toggle moves between the side column and the row above the pictures. */
let compareToggleHadFocus = 0;

/**
 * "같이 만든 결과": the results of one request made on several models, one pill per model in the order they
 * were picked, so they can be compared quickly. The shown one is marked; ←/→ inside move between them. A
 * model whose run failed (or is still being made) stays in the row, quiet, with its reason under it.
 */
export function SiblingSwitcher({
  job,
  output,
  siblings,
  copy,
  onOpen,
  comparing = false,
  onCompare,
  compact = false,
}: {
  job: StudioJobView;
  output: StudioOutputView | null;
  siblings: readonly StudioJobView[];
  copy: StudioCopy;
  onOpen(outputId: string): void;
  /** "모델 비교" is on: every model's picture is on the stage. */
  comparing?: boolean;
  /** Offered when another model of the group has a picture to compare with. */
  onCompare?(on: boolean): void;
  /** One quiet row above the pictures while comparing: the pills, then the toggle (the label is for screen readers). */
  compact?: boolean;
}) {
  const v = copy.viewer;
  const row = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const shown = siblings.filter((run) => !(run.status === "succeeded" && run.outputs.length === 0));
  const target = (run: StudioJobView) => siblingOutput(job, output, run);
  const ready = shown.filter((run) => run.id === job.id || target(run));
  const canCompare = Boolean(onCompare && output?.kind === "image" && canCompareModels(compareEntries(job, output, siblings, copy)));
  useEffect(() => {
    // The toggle moved between the side column and the row above the pictures: focus follows it (only right
    // after the press, so an old press never pulls focus later).
    if (compareToggleHadFocus && Date.now() - compareToggleHadFocus < 1500) {
      compareToggleHadFocus = 0;
      // Without scrolling: the column is back where it was, and the toggle is where it was pressed.
      const to = toggleRef.current ?? row.current?.querySelector<HTMLElement>('[aria-current="true"]');
      to?.focus({ preventScroll: true });
      to?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (!switcherHadFocus) return;
    switcherHadFocus = false;
    row.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }, []);
  if (shown.length < 2) return null;
  const notes = shown.flatMap((run) => {
    if (run.id === job.id || target(run)) return [];
    // The short reason (the wall's tile keeps the longer one about references).
    const reason =
      run.status === "failed"
        ? errorLine(copy, run.errorCode)
        : run.status === "canceled"
          ? copy.board.canceled
          : (copy.board.stage[run.status as keyof typeof copy.board.stage] ?? copy.board.stage.queued);
    return [{ id: run.id, label: studioModelOrLegacy(run.model)?.label ?? run.model, reason, failed: run.status === "failed" || run.status === "canceled" }];
  });
  const step = (dir: number) => {
    const at = ready.findIndex((run) => run.id === job.id);
    const next = ready[(at + dir + ready.length) % ready.length];
    const out = next && next.id !== job.id ? target(next) : null;
    if (!out) return;
    switcherHadFocus = true;
    onOpen(out.id);
  };
  const toggle = canCompare && (
    <button
      ref={toggleRef}
      type="button"
      className="bs-link-btn"
      aria-pressed={comparing}
      data-studio-compare-models
      aria-label={v.compareModels}
      onClick={() => {
        compareToggleHadFocus = Date.now();
        onCompare?.(!comparing);
      }}
    >
      {/* Above the pictures the toggle is always on, so it keeps its own icon (alone on a phone) and shows on by its fill. */}
      <StudioIcon name={comparing && !compact ? "check" : "compare"} />
      <span className="bs-link-btn-label">{v.compareModels}</span>
    </button>
  );
  const pills = (
      <div
        ref={row}
        className="bs-siblings-row"
        role="group"
        aria-labelledby={`sib-${job.id}`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          step(event.key === "ArrowRight" ? 1 : -1);
        }}
      >
        {shown.map((run) => {
          const label = studioModelOrLegacy(run.model)?.label ?? run.model;
          const current = run.id === job.id;
          const out = current ? null : target(run);
          if (current || out)
            return (
              <button
                key={run.id}
                type="button"
                className="bs-sibling"
                data-sibling={run.model}
                aria-current={current ? "true" : undefined}
                aria-label={current ? label : fill(v.siblingShow, { model: label })}
                onClick={() => out && onOpen(out.id)}
              >
                {label}
              </button>
            );
          return (
            <span key={run.id} className="bs-sibling" data-sibling={run.model} data-state={run.status === "failed" || run.status === "canceled" ? "failed" : "open"} aria-describedby={`sib-${run.id}-why`}>
              <span aria-hidden="true" className="bs-sibling-mark" />
              {label}
            </span>
          );
        })}
      </div>
  );
  return (
    <div className="bs-siblings" data-studio-siblings data-compact={compact ? "" : undefined}>
      {compact ? (
        <>
          <p className="bs-sr" id={`sib-${job.id}`}>
            {v.siblings}
          </p>
          <div className="bs-siblings-bar">
            {pills}
            {toggle}
          </div>
        </>
      ) : (
        <>
          <div className="bs-siblings-head">
            <p className="bs-label" id={`sib-${job.id}`}>
              {v.siblings}
            </p>
            {toggle}
          </div>
          {pills}
        </>
      )}
      {notes.map((note) => (
        // While comparing, the stage's own tile says why; the line stays for screen readers only.
        <p key={note.id} id={`sib-${note.id}-why`} className={comparing ? "bs-sr" : "bs-sibling-note"} data-studio-sibling-note={note.failed ? "failed" : "open"}>
          <span className="bs-sibling-note-model">{note.label}:</span> {note.reason}
        </p>
      ))}
    </div>
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
  siblingsOf,
  onOpenOutput,
  actions,
  onRegion,
  comparing: comparingModels = false,
  onCompare,
}: ViewerProps & { item: ViewerItem; onRegion(open: boolean): void; comparing?: boolean; onCompare?(on: boolean): void }) {
  const v = copy.viewer;
  // Versions of a generated clip: the strip swaps what is shown here without leaving the viewer.
  const clip = revise && openedItem.type === "output" && openedItem.output.kind === "video" ? openedItem.job : null;
  // `BRAND_STUDIO_REVISE_V2`: the edit panel is a conversation and the step to the final sits on the
  // version card of a draft (not among the actions).
  const dialogue = Boolean(clip && revise?.dialogue);
  const chain = useMemo(() => (clip && revise ? chainOf(revise.jobs, clip) : []), [clip, revise]);
  const ownVersion = clip && revise ? (versionOf(revise.jobs, clip) ?? 1) : 1;
  // A version of this clip is never offered as material for its own next version.
  const reviseExclude = useMemo(() => chain.flatMap((entry) => (entry.output ? [`o:${entry.output.id}`] : [])), [chain]);
  const [selected, setSelected] = useState(ownVersion);
  const item = shownVersion(openedItem, chain, ownVersion, selected);
  // The conversation moves the viewer to the version it made: while that version is being made, the panel
  // shows what was asked and the picture says it is on its way.
  const selectedEntry = chain.find((entry) => entry.version === selected) ?? null;
  const makingSelected = dialogue && selectedEntry?.state === "making";
  // Conversations kept in this browser and not made yet, per result: the version row marks their versions,
  // and the card keeps to one line while the shown one is under way.
  const talkOrg = dialogue ? (revise?.talk?.organizationId ?? null) : null;
  const chainOutputs = useMemo(() => chain.flatMap((entry) => (entry.output ? [entry.output.id] : [])), [chain]);
  const [talkingOutputs, setTalkingOutputs] = useState<ReadonlySet<string>>(() => new Set());
  const chainKey = chainOutputs.join(",");
  useEffect(() => {
    if (!talkOrg) return;
    setTalkingOutputs(savedTalkOutputs(talkOrg, chainKey ? chainKey.split(",") : []));
  }, [talkOrg, chainKey]);
  const markTalking = (outputId: string, open: boolean) =>
    setTalkingOutputs((current) => {
      if (current.has(outputId) === open) return current;
      const next = new Set(current);
      if (open) next.add(outputId);
      else next.delete(outputId);
      return next;
    });
  const talkingVersions = useMemo(
    () => new Set(chain.flatMap((entry) => (entry.output && talkingOutputs.has(entry.output.id) ? [entry.version] : []))),
    [chain, talkingOutputs],
  );
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
  const fixedModel = Boolean(support?.fixedModel);
  // Region edit v2: a rerun of an edit made on another model runs on the one engine too.
  const [model, setModelState] = useState(fixedModel ? (support?.defaultModel ?? "") : (preset?.model ?? support?.defaultModel ?? ""));
  const [quality, setQuality] = useState(() =>
    fixedModel ? "" : qualityOf(support?.models.find((m) => m.id === (preset?.model ?? support?.defaultModel)) ?? null, preset?.quality ?? support?.defaultQuality),
  );
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
  const id = useId();
  // "프롬프트 복사": the typed words (a partial edit's instruction), else an image run's sent sentence.
  const promptText = job ? promptToCopy(job) : null;
  const sentCopy = Boolean(job && sentPromptCopyable(job));
  const protectedSent = Boolean(job?.finalPrompt) && !sentCopy;
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
  // Results of one request on several models: the switcher, and "모델 비교" with every model side by side.
  const siblings = job?.group && siblingsOf ? siblingsOf(job) : [];
  const entries = job && item.type === "output" && siblings.length > 1 ? compareEntries(job, item.output, siblings, copy) : [];
  const comparable = !region && image && canCompareModels(entries);
  const modelCompare = comparingModels && comparable;
  // Moving on to a result made alone ends the comparison, so Escape then closes the viewer as always.
  useEffect(() => {
    if (comparingModels && !comparable) onCompare?.(false);
  }, [comparable, comparingModels, onCompare]);
  // The action column is hidden while comparing, which loses its scroll; leaving puts it back where it was.
  const side = useRef<HTMLDivElement>(null);
  const sideTop = useRef(0);
  useLayoutEffect(() => {
    if (!modelCompare && side.current) side.current.scrollTop = sideTop.current;
  }, [modelCompare]);

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
    const problem = regionProblem({ box, instruction, model, references: refs, ...(fixedModel ? { v2: true } : {}) });
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
  const tiles: Array<{ name: string; icon: StudioIconName; label: string; hint?: string; run(): void; show: boolean }> = [
    {
      name: "region",
      icon: "region",
      label: v.regionEdit,
      run: () => (actions.openRegionInLayers ? actions.openRegionInLayers(item) : setRegion(true)),
      show: canGenerate && image && Boolean(support || actions.openRegionInLayers),
    },
    // A partial edit is made again from its original, on the same area ("같은 영역 다시 수정하기").
    job?.kind === "region_edit"
      ? { name: "rerun", icon: "rerun", label: v.reuseRegion, run: () => actions.reuse(job, item.type === "output" ? item.output : null), show: canGenerate }
      : { name: "rerun", icon: "rerun", label: v.rerun, run: () => job && actions.rerun(job), show: canGenerate && Boolean(job && canRerun(job)) },
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
    { name: "finalize", icon: "spark", label: v.finalize, run: () => output && actions.finalize(output), show: canGenerate && Boolean(output?.draft) && !dialogue },
    { name: "review", icon: "review", label: locale === "en" ? "Review & Share" : "검수 · 공유", run: () => actions.review?.(item), show: canCreate && Boolean(actions.review) },
    { name: "campaign", icon: "send", label: v.campaign, hint: v.campaignHint, run: () => actions.campaign(item), show: canCreate },
  ];
  const saved = canCreate && Boolean(output?.savedAssetId);

  return (
    // "모델 비교" gives the pictures the whole body: the action column is hidden (kept mounted, so it comes back
    // exactly as it was) and the model pills with the toggle sit in one quiet row above the pictures.
    <div className="bs-viewer-body" data-region={region ? "" : undefined} data-compare={modelCompare ? "" : undefined}>
      <figure ref={setMediaHost} className="bs-viewer-media" data-kind={file.kind} data-compare={modelCompare ? "" : undefined}>
        {modelCompare && job && siblingsOf && onOpenOutput && (
          <SiblingSwitcher
            job={job}
            output={item.type === "output" ? item.output : null}
            siblings={siblings}
            copy={copy}
            onOpen={onOpenOutput}
            comparing
            onCompare={onCompare}
            compact
          />
        )}
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
        ) : modelCompare ? (
          <ModelCompare
            entries={entries}
            copy={copy}
            locale={locale}
            onOpen={(entry) => {
              // A press on a picture leaves the comparison and opens that result on its own.
              compareToggleHadFocus = Date.now();
              onCompare?.(false);
              if (!entry.current && entry.output) onOpenOutput?.(entry.output.id);
            }}
          />
        ) : (
          picture
        )}
        {makingSelected && selectedEntry && (
          <div className="bs-talk-making-media" role="status" data-talk-making-media>
            <span className="bs-mark-spin" aria-hidden="true" />
            <span>{`${fill(copy.revise.version, { n: selectedEntry.version })} · ${copy.revise.talk.makingTitle}`}</span>
          </div>
        )}
      </figure>
      <div
        ref={side}
        className="bs-viewer-side"
        aria-hidden={modelCompare || undefined}
        onScroll={(event) => {
          if (!modelCompare) sideTop.current = event.currentTarget.scrollTop;
        }}
      >
        {clip && revise && canGenerate && output && dialogue && revise.talk ? (
          // `BRAND_STUDIO_REVISE_V2`: the conversation fills the panel. The version row and card sit on top
          // (the card on one line while a conversation is under way), the thread is the one part that
          // scrolls, and the sheet with its button and the box stay in view below it.
          <div className="bs-talk-stage" data-talk-stage>
            {job?.group && siblingsOf && onOpenOutput && !region && !modelCompare && (
              <SiblingSwitcher
                job={job}
                output={item.type === "output" ? item.output : null}
                siblings={siblings}
                copy={copy}
                onOpen={onOpenOutput}
                comparing={modelCompare}
                onCompare={onCompare}
              />
            )}
            <VersionPanel
              versions={chain}
              selected={selected}
              shown={item.type === "output" ? { job: item.job, output: item.output } : null}
              copy={copy}
              locale={locale}
              canFinish={canGenerate}
              finishing={busy === "finalize"}
              onSelect={selectVersion}
              onFinal={(draft) => actions.finalize(draft)}
              compact={!makingSelected && talkingOutputs.has(output.id)}
              talking={talkingVersions}
            />
            {makingSelected && selectedEntry ? (
              <section className="bs-talk" data-talk-making>
                <div className="bs-talk-head">
                  <h3 className="bs-revise-title">{copy.revise.talk.makingTitle}</h3>
                  <span className="bs-revise-next bs-num">{fill(copy.revise.version, { n: selectedEntry.version })}</span>
                </div>
                {selectedEntry.job.revision?.sheet ? <SheetCard sheet={selectedEntry.job.revision.sheet} copy={copy} /> : selectedEntry.request ? <p className="bs-revise-request">{selectedEntry.request}</p> : null}
                <p className="bs-muted bs-talk-making-note">{copy.revise.talk.makingNote}</p>
              </section>
            ) : (
              <ReviseTalk
                key={output.id}
                outputId={output.id}
                support={revise.talk}
                copy={copy}
                locale={locale}
                draftClip={Boolean(output.draft)}
                fallbackVersion={Math.max(1, ...chain.map((entry) => entry.version)) + 1}
                stage={file.kind === "video" && !region ? { video: videoRef, host: mediaHost, url: file.url } : null}
                onCreated={(created, version) => selectVersion(created.job.revision?.version ?? version)}
                onTalking={markTalking}
              />
            )}
          </div>
        ) : (
          job?.group && siblingsOf && onOpenOutput && !region && !modelCompare && (
            <SiblingSwitcher
              job={job}
              output={item.type === "output" ? item.output : null}
              siblings={siblings}
              copy={copy}
              onOpen={onOpenOutput}
              comparing={modelCompare}
              onCompare={onCompare}
            />
          )
        )}
        {/* Without the conversation, these three keep their places in the panel exactly as before. */}
        {clip && revise && canGenerate && output && dialogue && revise.talk ? null : clip && dialogue ? (
          <VersionPanel
            versions={chain}
            selected={selected}
            shown={item.type === "output" ? { job: item.job, output: item.output } : null}
            copy={copy}
            locale={locale}
            canFinish={canGenerate}
            finishing={busy === "finalize"}
            onSelect={selectVersion}
            onFinal={(draft) => actions.finalize(draft)}
          />
        ) : (
          clip && chain.length >= 2 && <VersionStrip versions={chain} selected={selected} copy={copy} onSelect={selectVersion} />
        )}
        {clip && revise && canGenerate && output && dialogue && revise.talk ? null : clip && revise && canGenerate && output && (
          <ReviseForm
            key={output.id}
            outputId={output.id}
            support={revise}
            copy={copy}
            locale={locale}
            fallbackVersion={Math.max(1, ...chain.map((entry) => entry.version)) + 1}
            exclude={reviseExclude}
            stage={file.kind === "video" && !region ? { video: videoRef, host: mediaHost, url: file.url } : null}
            {...(dialogue ? { sameQuality: !output.draft } : {})}
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
            credits={regionCredits(model, refs.length, quality, fixedModel)}
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
                  title={tile.hint}
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
          <div className="bs-prompt-block" data-studio-prompt-block>
          <details className="bs-prompt-details" data-studio-prompt-details>
            <summary>{v.promptToggle}</summary>
            <div className="bs-prompt-head">
              <p className="bs-label" id={`${id}-typed`}>{v.yourPrompt}</p>
              {job.prompt.trim() && (
                <CopyButton text={job.prompt} label={v.copy} copiedLabel={v.copied} describedBy={`${id}-typed`} onFailed={() => setCopyToast(v.copyFailed)} compact marker="copy-typed" />
              )}
            </div>
            <p>{job.prompt || copy.board.noPrompt}</p>
            <div className="bs-prompt-head">
              <p className="bs-label" id={`${id}-sent`}>{v.sentPrompt}</p>
              {sentCopy && job.finalPrompt && (
                <CopyButton text={job.finalPrompt} label={v.copy} copiedLabel={v.copied} describedBy={`${id}-sent`} onFailed={() => setCopyToast(v.copyFailed)} compact marker="copy-sent" />
              )}
            </div>
            {/* A video run's sentence is read here, not copied: no selection (CSS), no copy, cut, drag or context menu. */}
            <p
              data-no-copy={protectedSent ? "" : undefined}
              onCopy={protectedSent ? (event) => event.preventDefault() : undefined}
              onCut={protectedSent ? (event) => event.preventDefault() : undefined}
              onDragStart={protectedSent ? (event) => event.preventDefault() : undefined}
              onContextMenu={protectedSent ? (event) => event.preventDefault() : undefined}
            >
              {job.finalPrompt ?? v.notEnhanced}
            </p>
            {canGenerate && job.kind !== "video_final" && (
              <button
                type="button"
                className="bs-btn"
                data-variant="soft"
                data-size="sm"
                data-studio-reuse={job.kind === "region_edit" ? "region" : "dock"}
                onClick={() => actions.reuse(job, item.type === "output" ? item.output : null)}
              >
                {job.kind === "region_edit" ? v.reuseRegion : v.reuse}
              </button>
            )}
          </details>
          {/* One press, without opening: the typed words (a partial edit's instruction). Hidden while open. */}
          {promptText && (
            <CopyButton text={promptText} label={v.copyPrompt} copiedLabel={v.copied} onFailed={() => setCopyToast(v.copyFailed)} marker="copy-prompt" />
          )}
          </div>
        )}
      </div>
    </div>
  );
}
