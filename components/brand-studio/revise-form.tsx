"use client";
/**
 * The next version of a generated clip, inside the viewer (docs/BRAND-STUDIO-V6-PLAN.md §4): the version
 * strip (v1 … vN, the one being made shows as such) with the shown version's request under it, and the
 * form under that: a titled box for what to change (pictures and videos can be dropped anywhere on the
 * viewer), the two ways with their credits, and the button that makes the next version.
 * The logic is `revise-flow.ts`; this file is only the screen.
 */
import { useEffect, useId, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import {
  STUDIO_LIMITS,
  STUDIO_OLD_SLIDES_MIME,
  STUDIO_REVISE_MODES,
  STUDIO_UPLOAD_MIMES,
  type StudioJobCreated,
  type StudioJobView,
  type StudioReviseMarkRead,
  type StudioReviseMode,
  type StudioRevisePlan,
  type StudioReviseProblem,
} from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import type { ApiResult } from "./api";
import { credits, errorLine, fill, type StudioCopy, type StudioLocale } from "./copy";
import { StudioIcon } from "./icons";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, startRefDrag, type RefSource, type TrayItem } from "./refs";
import {
  REVISE_DOCUMENTS_MAX,
  REVISE_MATERIALS_MAX,
  REVISE_REFERENCES_MAX,
  createReviseFlow,
  initialReviseState,
  type ReviseCreateInput,
  type ReviseMarkReadInput,
  type RevisePlanInput,
  type ReviseState,
} from "./revise-flow";
import { createFrameGrabber, type FrameGrabber } from "./revise-mark-frame";
import { MarkLayer } from "./revise-mark-layer";
import { MARKS_MAX, chipText, circled, nudge, type MarkGeometry } from "./revise-marks";
import type { ChainVersion } from "./revision-model";

/** What the screen hands the viewer so a generated clip can get its next version. */
export interface ReviseSupport {
  organizationId: string;
  /** Every run of the screen (versions hidden from the wall included). */
  jobs: readonly StudioJobView[];
  recent: readonly TrayItem[];
  resolve(source: RefSource): TrayItem | null;
  upload(files: File[]): Promise<TrayItem[]>;
  plan(input: RevisePlanInput): Promise<ApiResult<StudioRevisePlan>>;
  create(input: ReviseCreateInput): Promise<ApiResult<StudioJobCreated>>;
  /** `revise.mark` (free): what a marked spot is on. Without it marks work by position only. */
  readMark?(input: ReviseMarkReadInput): Promise<ApiResult<StudioReviseMarkRead>>;
  /** True while the server takes documents (PDF, PPTX) as material. */
  documents?: boolean;
}

/** The clip on screen, for marks: the viewer's `<video>`, the figure the marks are drawn in, and its address. */
export interface ReviseStage {
  video: RefObject<HTMLVideoElement | null>;
  host: HTMLElement | null;
  url: string;
}

/** A moved mark is read again once the keys have been still this long (ms). */
const REREAD_MS = 600;

export function VersionStrip({
  versions,
  selected,
  copy,
  onSelect,
}: {
  versions: readonly ChainVersion[];
  selected: number;
  copy: StudioCopy;
  onSelect(version: number): void;
}) {
  const r = copy.revise;
  const current = versions.find((v) => v.version === selected);
  return (
    <div className="bs-revise-versions">
      <div className="bs-revise-strip" role="group" aria-label={r.versions} data-revision-strip>
        {versions.map((v) => {
          const making = v.state === "making";
          const on = v.version === selected;
          return (
            <button
              key={v.version}
              type="button"
              className="bs-chip bs-revise-chip"
              data-size="sm"
              data-state={v.state}
              data-selected={on ? "" : undefined}
              data-revision-version={v.version}
              aria-pressed={on}
              disabled={making}
              aria-busy={making || undefined}
              title={making ? r.making : undefined}
              onClick={() => onSelect(v.version)}
            >
              <span className="bs-num">{fill(r.version, { n: v.version })}</span>
              {making && (
                <>
                  <StudioIcon name="spark" />
                  <span>{r.making}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {current?.request && (
        <p className="bs-revise-request" data-revision-request>
          {current.request}
        </p>
      )}
      {current?.request && current.clarified && (
        <div className="bs-revise-clarified" data-revision-clarified>
          <span className="bs-sr">{r.clarifiedLabel}</span>
          <p className="bs-muted">{current.clarified.question}</p>
          <p>{current.clarified.answer}</p>
        </div>
      )}
      {current?.request && current.unread > 0 && (
        <p className="bs-muted bs-revise-unread" data-revision-unread>
          {fill(r.unread, { n: current.unread })}
        </p>
      )}
      {current?.request && current.marks.length > 0 && (
        <ul className="bs-mark-chips" data-revision-marks>
          {current.marks.map((mark, i) => (
            <li key={i} className="bs-mark-chip" data-static="" data-revision-mark={i + 1}>
              <span className="bs-mark-n" aria-hidden="true">
                {circled(i + 1)}
              </span>
              <span className="bs-mark-text">{chipText(mark)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ReviseFormViewProps {
  state: ReviseState;
  /** The number the next version gets. */
  version: number;
  copy: StudioCopy;
  locale: StudioLocale;
  recent: readonly TrayItem[];
  uploading: boolean;
  onPrompt(text: string): void;
  onReferences(next: TrayItem[]): void;
  /** Videos to read for the request. Absent: videos cannot be attached (pictures only). */
  onMaterials?(next: TrayItem[]): void;
  /** Documents (PDF, PPTX) to read for the request. Absent: documents cannot be attached. */
  onDocuments?(next: TrayItem[]): void;
  onFiles(files: File[]): void;
  resolve(source: RefSource): TrayItem | null;
  onPick(mode: StudioReviseMode): void;
  onSubmit(): void;
  onAccept(change: boolean): void;
  /** The question row: a choice, or null to make it as written. */
  onAnswer?(choice: string | null): void;
  /** Mark mode on or off; null or absent when the clip cannot be marked (no button then). */
  markMode?: boolean | null;
  onMarkMode?(on: boolean): void;
  /** A chip was clicked: show the clip at that mark's moment. */
  onMarkSeek?(key: string): void;
  onMarkRemove?(key: string): void;
  promptRef?: Ref<HTMLTextAreaElement>;
  /** Where the caret is in the request (marks write their digit there). */
  onCaret?(at: number): void;
}

export function noteLine(note: string, state: ReviseState, copy: StudioCopy): string {
  if (note === "empty_prompt") return copy.dock.emptyPrompt;
  if (note === "attach_full_documents")
    return fill(copy.revise.attachFullDocuments, { images: REVISE_REFERENCES_MAX, videos: REVISE_MATERIALS_MAX, documents: REVISE_DOCUMENTS_MAX });
  if (note === "attach_full") return fill(copy.revise.attachFull, { images: REVISE_REFERENCES_MAX, videos: REVISE_MATERIALS_MAX });
  if (note === "old_slides") return copy.revise.oldSlides;
  if (note === "unavailable") {
    const problem = state.plan?.methods[state.mode]?.problem;
    return problem ? copy.revise.problems[problem] : copy.revise.problems.unsupported;
  }
  return errorLine(copy, note);
}

/** A picture's own thumbnail, or a video's first frame when it has none. */
function AttachThumb({ item }: { item: TrayItem }) {
  if (item.kind === "video" && !item.thumbUrl) return <video src={item.url} muted playsInline preload="metadata" draggable={false} />;
  return <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" draggable={false} />;
}

/** How long a drag may go without a `dragover` before the form stops showing where to drop (ms). */
const DRAG_REST_MS = 500;

/** The form as markup only (tests render it with a fixed state). */
export function ReviseFormView(props: ReviseFormViewProps) {
  const { state, copy, locale } = props;
  const r = copy.revise;
  const id = useId();
  const files = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = state.phase === "checking" || state.phase === "sending";
  const videos = Boolean(props.onMaterials);
  const docs = Boolean(props.onDocuments);
  const refsFull = state.references.length >= REVISE_REFERENCES_MAX;
  const materialsFull = !videos || state.materials.length >= REVISE_MATERIALS_MAX;
  const documentsFull = !docs || state.documents.length >= REVISE_DOCUMENTS_MAX;
  const full = refsFull && materialsFull && documentsFull;
  const listOf = (item: TrayItem) => (item.kind === "video" ? state.materials : item.kind === "document" ? state.documents : state.references);
  const taken = (item: TrayItem) => listOf(item).some((x) => x.key === item.key);
  const closed = (item: TrayItem) =>
    item.kind === "video" ? materialsFull : item.kind === "image" ? refsFull : item.kind === "document" ? documentsFull : true;
  const add = (item: TrayItem | null) => {
    if (!item || taken(item) || closed(item)) return;
    if (item.kind === "image") props.onReferences([...state.references, item]);
    else if (item.kind === "video") props.onMaterials?.([...state.materials, item]);
    else if (item.kind === "document") props.onDocuments?.([...state.documents, item]);
  };
  const drop = (event: { dataTransfer: DataTransfer | null; preventDefault(): void }) => {
    if (!event.dataTransfer || !acceptsDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    setDragging(false);
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) add(props.resolve(source));
    else if (event.dataTransfer.files.length) props.onFiles(Array.from(event.dataTransfer.files));
  };
  // Something dragged anywhere over the window lights the form up; dropped anywhere on the viewer
  // (the clip included) it lands in the form.
  const live = useRef(drop);
  live.current = drop;
  useEffect(() => {
    let rest = 0;
    const stop = () => {
      window.clearTimeout(rest);
      setDragging(false);
    };
    const onViewer = (target: EventTarget | null) => {
      const body = form.current?.closest(".bs-viewer-body") ?? form.current;
      return target instanceof Node && Boolean(body?.contains(target));
    };
    const over = (event: globalThis.DragEvent) => {
      if (!acceptsDrag(event.dataTransfer?.types)) return;
      setDragging(true);
      window.clearTimeout(rest);
      rest = window.setTimeout(() => setDragging(false), DRAG_REST_MS);
      if (!onViewer(event.target)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const dropped = (event: globalThis.DragEvent) => {
      stop();
      // The form's own handler takes a drop that lands inside it.
      if (!onViewer(event.target) || (event.target instanceof Node && form.current?.contains(event.target))) return;
      live.current(event);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", dropped);
    window.addEventListener("dragend", stop);
    return () => {
      window.clearTimeout(rest);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", dropped);
      window.removeEventListener("dragend", stop);
    };
  }, []);
  const cost = (mode: StudioReviseMode) => {
    const method = state.plan?.methods[mode];
    return method && method.estimateKrw > 0 ? credits(copy.credits.amount, creditsOf(method.estimateKrw), locale) : null;
  };
  const problem = (code: StudioReviseProblem | undefined) => (code ? r.problems[code] : r.problems.unsupported);
  const marking = props.markMode === true;
  const markable = props.markMode === true || props.markMode === false;
  const marksFull = state.marks.length >= MARKS_MAX;
  const attached = state.references.length + state.materials.length + state.documents.length > 0;
  // The question takes the focus when it appears, so the keyboard and a screen reader land on it.
  const question = useRef<HTMLDivElement>(null);
  const asking = state.phase === "clarify" && Boolean(state.clarify);
  useEffect(() => {
    if (asking) question.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [asking]);

  return (
    <form
      ref={form}
      className="bs-revise"
      data-revise-form
      data-phase={state.phase}
      data-drop-target={dragging ? "" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      onKeyDown={(event) => {
        // Escape leaves mark mode first; the viewer closes only on the next one.
        if (marking && event.key === "Escape") {
          event.preventDefault();
          props.onMarkMode?.(false);
        }
      }}
      onDragOver={(event) => {
        if (!acceptsDrag(event.dataTransfer?.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={drop}
    >
      <div className="bs-revise-head">
        <h3 className="bs-revise-title" data-revise-title>
          {r.title}
        </h3>
        <span className="bs-revise-next bs-num" data-revise-next>
          {fill(r.version, { n: props.version })}
        </span>
      </div>
      <div className="bs-revise-box" data-revise-box>
        <label className="bs-sr" htmlFor={`${id}-prompt`}>
          {r.prompt}
        </label>
        <textarea
          id={`${id}-prompt`}
          className="bs-field bs-revise-prompt"
          rows={4}
          maxLength={STUDIO_LIMITS.promptMax}
          value={state.prompt}
          placeholder={r.placeholder}
          data-revise-prompt
          ref={props.promptRef}
          onSelect={(event) => props.onCaret?.(event.currentTarget.selectionStart)}
          onChange={(event) => props.onPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {state.marks.length > 0 && (
          <ul className="bs-mark-chips" data-revise-marks>
            {state.marks.map((mark, i) => (
              <li key={mark.key} className="bs-mark-chip" data-revise-mark={i + 1} data-reading={mark.reading ? "" : undefined}>
                <button type="button" className="bs-mark-chip-go" onClick={() => props.onMarkSeek?.(mark.key)}>
                  <span className="bs-mark-n" aria-hidden="true">
                    {circled(i + 1)}
                  </span>
                  <span className="bs-mark-text">{chipText(mark)}</span>
                  {mark.reading && (
                    <span className="bs-mark-spin" role="status">
                      <span className="bs-sr">{r.markReading}</span>
                    </span>
                  )}
                </button>
                <button type="button" className="bs-mark-chip-x" aria-label={fill(r.removeMark, { n: i + 1 })} disabled={busy} onClick={() => props.onMarkRemove?.(mark.key)}>
                  <StudioIcon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {attached && (
          <ul className="bs-region-ref-list" data-revise-refs>
            {state.references.map((ref, i) => (
              <li key={ref.key} className="bs-region-ref" data-revise-ref={i + 1}>
                <span className="bs-thumb" data-static>
                  <AttachThumb item={ref} />
                </span>
                <span className="bs-thumb-n bs-num" aria-hidden="true">
                  {i + 1}
                </span>
                <button type="button" className="bs-thumb-x" aria-label={fill(r.removeRef, { n: i + 1 })} onClick={() => props.onReferences(state.references.filter((x) => x.key !== ref.key))}>
                  <StudioIcon name="close" />
                </button>
              </li>
            ))}
            {state.materials.map((material, i) => (
              <li key={material.key} className="bs-region-ref" data-revise-material={i + 1}>
                <span className="bs-thumb" data-static data-kind="video">
                  <AttachThumb item={material} />
                  <span className="bs-thumb-play" aria-hidden="true">
                    <StudioIcon name="play" />
                  </span>
                </span>
                <span className="bs-thumb-n" aria-hidden="true">
                  {r.materialLabel}
                </span>
                <button type="button" className="bs-thumb-x" aria-label={fill(r.removeMaterial, { n: i + 1 })} onClick={() => props.onMaterials?.(state.materials.filter((x) => x.key !== material.key))}>
                  <StudioIcon name="close" />
                </button>
              </li>
            ))}
            {state.documents.map((document, i) => (
              <li key={document.key} className="bs-region-ref bs-revise-document" data-revise-document={i + 1}>
                <span className="bs-revise-document-tile" title={document.name}>
                  <StudioIcon name="doc" />
                  <span className="bs-revise-document-name">{document.name}</span>
                  {document.pages ? <span className="bs-num bs-revise-document-pages">{fill(r.slides, { n: document.pages })}</span> : null}
                </span>
                <button type="button" className="bs-thumb-x" aria-label={fill(r.removeDocument, { n: i + 1 })} onClick={() => props.onDocuments?.(state.documents.filter((x) => x.key !== document.key))}>
                  <StudioIcon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {state.materials.length > 0 && (
          <p className="bs-muted bs-revise-material-note" data-revise-material-note>
            {r.materialNote}
          </p>
        )}
        {state.documents.length > 0 && (
          <p className="bs-muted bs-revise-material-note" data-revise-document-note>
            {r.documentNote}
          </p>
        )}
        <div className="bs-revise-tools">
          <button type="button" className="bs-btn" data-variant="soft" data-size="sm" data-revise-add disabled={full || props.uploading} onClick={() => files.current?.click()}>
            <StudioIcon name={props.uploading ? "spark" : "plus"} />
            {videos ? r.addRefs : r.addImages}
          </button>
          <input
            ref={files}
            type="file"
            className="bs-sr"
            tabIndex={-1}
            accept={[
              ...STUDIO_UPLOAD_MIMES.image,
              ...(videos ? STUDIO_UPLOAD_MIMES.video : []),
              ...(docs ? [...STUDIO_UPLOAD_MIMES.document, ".pdf", ".pptx", STUDIO_OLD_SLIDES_MIME, ".ppt"] : []),
            ].join(",")}
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) props.onFiles(picked);
            }}
          />
          {markable && (
            <button
              type="button"
              className="bs-btn bs-mark-toggle"
              data-variant="soft"
              data-size="sm"
              data-revise-mark-toggle
              aria-pressed={marking}
              disabled={busy || (!marking && marksFull)}
              onClick={() => props.onMarkMode?.(!marking)}
            >
              <StudioIcon name="region" />
              {r.mark}
            </button>
          )}
        </div>
        <p className="bs-revise-drop" data-revise-drop-hint>
          <StudioIcon name="upload" />
          <span>{dragging ? r.dropHere : docs ? r.dropHintDocuments : videos ? r.dropHint : r.dropHintImages}</span>
        </p>
      </div>
      {marking && state.marks.length === 0 && (
        <p className="bs-muted bs-mark-hint" data-revise-mark-hint>
          {r.markHint}
        </p>
      )}
      {props.recent.length > 0 && (
        <div className="bs-revise-recent">
          <p className="bs-label">{r.recent}</p>
          <ul className="bs-strip" aria-label={r.recent}>
            {props.recent.map((item) => {
              const on = taken(item);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className="bs-thumb"
                    data-kind={item.kind}
                    data-taken={on ? "" : undefined}
                    disabled={on || closed(item)}
                    draggable
                    onDragStart={(event) => startRefDrag(event, item.assetId ? { assetId: item.assetId } : { outputId: item.outputId! })}
                    aria-label={fill(r.addOne, { name: item.name })}
                    onClick={() => add(item)}
                  >
                    {item.kind === "document" ? (
                      <span className="bs-revise-document-thumb" aria-hidden="true">
                        <StudioIcon name="doc" />
                      </span>
                    ) : (
                      <AttachThumb item={item} />
                    )}
                    {item.kind === "video" && (
                      <span className="bs-thumb-play" aria-hidden="true">
                        <StudioIcon name="play" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <fieldset className="bs-revise-methods">
        <legend className="bs-label">{r.method}</legend>
        {STUDIO_REVISE_MODES.map((mode) => {
          const method = state.plan?.methods[mode];
          const shut = Boolean(method && !method.available);
          const price = cost(mode);
          return (
            <div key={mode} className="bs-revise-method-row">
              <label className="bs-revise-method" data-revise-method={mode} data-disabled={shut ? "" : undefined}>
                <input type="radio" name={`${id}-method`} value={mode} checked={state.mode === mode} disabled={shut || busy} onChange={() => props.onPick(mode)} />
                <span className="bs-revise-method-text">
                  <span>{r[mode]}</span>
                  <small>{r.hints[mode]}</small>
                </span>
                {price && <span className="bs-num bs-revise-cost">{price}</span>}
              </label>
              {shut && (
                <p className="bs-muted bs-revise-problem" data-revise-problem={method?.problem ?? "unsupported"}>
                  {problem(method?.problem)}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>
      {asking && state.clarify && (
        <div ref={question} className="bs-revise-suggestion bs-revise-clarify" role="group" aria-labelledby={`${id}-question`} data-revise-clarify>
          <p id={`${id}-question`}>
            {state.clarify.question}
          </p>
          <div className="bs-revise-choices">
            {state.clarify.options.map((option, i) => (
              <button key={option} type="button" className="bs-btn" data-variant="soft" data-size="sm" data-revise-choice={i + 1} onClick={() => props.onAnswer?.(option)}>
                {option}
              </button>
            ))}
            <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" data-revise-choice="as-written" onClick={() => props.onAnswer?.(null)}>
              {r.asWritten}
            </button>
          </div>
        </div>
      )}
      {state.phase === "suggest" && state.suggestion && (
        <div className="bs-revise-suggestion" role="group" data-revise-suggestion={state.suggestion.mode}>
          {state.suggestion.reason && <p>{r.reasons[state.suggestion.reason]}</p>}
          <div className="bs-row">
            <button type="button" className="bs-btn" data-variant="soft" data-size="sm" data-revise-accept="switch" onClick={() => props.onAccept(true)}>
              {r.switchAndMake}
            </button>
            {state.plan?.methods[state.mode]?.available !== false && (
              <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" data-revise-accept="keep" onClick={() => props.onAccept(false)}>
                {r.makeAsSelected}
              </button>
            )}
          </div>
        </div>
      )}
      {state.note && (
        <p className="bs-dock-message" role="alert" data-revise-note>
          {noteLine(state.note, state, copy)}
        </p>
      )}
      <button type="submit" className="bs-btn bs-submit" data-variant="solid" data-size="md" data-revise-submit disabled={busy || state.phase === "suggest" || asking} aria-busy={busy || undefined}>
        <span>{r.submit}</span>
        {cost(state.mode) && <span className="bs-submit-cost bs-num">{cost(state.mode)}</span>}
      </button>
      <p className="bs-muted bs-revise-after" data-revise-after>
        {fill(r.after, { n: props.version })}
      </p>
    </form>
  );
}

/** The form wired to the server through `support`; keyed by the shown result so a new version re-plans. */
export function ReviseForm({
  outputId,
  support,
  copy,
  locale,
  fallbackVersion,
  exclude,
  stage = null,
}: {
  outputId: string;
  support: ReviseSupport;
  copy: StudioCopy;
  locale: StudioLocale;
  /** The next number before the plan answers. */
  fallbackVersion: number;
  /** Keys not to offer in the recent strip (the clip itself). */
  exclude?: readonly string[];
  /** The clip on screen; marks need it (no "mark" button without it). */
  stage?: ReviseStage | null;
}) {
  const [state, setState] = useState<ReviseState>(initialReviseState);
  const [uploading, setUploading] = useState(false);
  const [marking, setMarkingState] = useState(false);
  const live = useRef(support);
  live.current = support;
  const liveStage = useRef(stage);
  liveStage.current = stage;
  const grabber = useRef<FrameGrabber | null>(null);
  const flow = useMemo(
    () =>
      createReviseFlow({
        organizationId: support.organizationId,
        outputId,
        plan: (input) => live.current.plan(input),
        create: (input) => live.current.create(input),
        onChange: setState,
        ...(support.readMark ? { readMark: (input: ReviseMarkReadInput) => live.current.readMark!(input) } : {}),
        ...(support.documents ? { documents: true } : {}),
        frame: (mark) => grabber.current?.capture(mark, accentOf(liveStage.current?.host ?? null)) ?? Promise.resolve(null),
      }),
    // A flow per shown result; `support` and the stage are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outputId, support.organizationId, support.documents],
  );
  useEffect(() => {
    void flow.load();
  }, [flow]);
  const recent = useMemo(
    () =>
      support.recent.filter((r) => (r.kind === "image" || r.kind === "video" || (support.documents && r.kind === "document")) && !exclude?.includes(r.key)),
    [support.recent, support.documents, exclude],
  );

  // One offscreen copy of the clip per form, loaded only when the first mark is read.
  const url = stage?.url ?? null;
  useEffect(() => {
    if (!url) return;
    const instance = createFrameGrabber(url);
    grabber.current = instance;
    return () => {
      instance.dispose();
      if (grabber.current === instance) grabber.current = null;
    };
  }, [url]);

  // Where the next digit goes: the caret once the request had focus, else its end.
  const prompt = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  useEffect(() => {
    const at = pendingCaret.current;
    const element = prompt.current;
    if (at === null || !element) return;
    pendingCaret.current = null;
    try {
      element.setSelectionRange(at, at);
    } catch {
      /* a textarea that is not rendered yet keeps its own caret */
    }
  }, [state.prompt]);

  // A moved mark is read again after the keys rest.
  const rereads = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = rereads.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const cancelReread = (key: string) => {
    const timer = rereads.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    rereads.current.delete(key);
  };

  const video = () => stage?.video.current ?? null;
  const setMarking = (on: boolean) => {
    setMarkingState(on);
    if (on) video()?.pause();
  };
  const place = (geometry: MarkGeometry) => {
    const placed = flow.addMark(geometry, caret.current);
    if (!placed) return;
    caret.current = placed.caret;
    pendingCaret.current = placed.caret;
    void flow.readMark(placed.key);
  };
  const move = (dx: number, dy: number) => {
    const last = flow.state.marks[flow.state.marks.length - 1];
    if (!last) return;
    const moved = nudge(last, dx, dy);
    flow.moveMark(last.key, { x: moved.x, y: moved.y });
    cancelReread(last.key);
    rereads.current.set(
      last.key,
      window.setTimeout(() => {
        rereads.current.delete(last.key);
        void flow.readMark(last.key);
      }, REREAD_MS),
    );
  };
  const host = stage?.host ?? null;

  return (
    <>
      {host && stage && (marking || state.marks.length > 0) && (
        <MarkLayer
          video={stage.video}
          host={host}
          marks={state.marks}
          active={marking}
          copy={copy}
          onPlace={place}
          onNudge={move}
          onLeave={() => setMarking(false)}
        />
      )}
      <ReviseFormView
      state={state}
      version={state.plan?.version ?? fallbackVersion}
      copy={copy}
      locale={locale}
      recent={recent}
      uploading={uploading}
      resolve={(source) => {
        const item = support.resolve(source);
        return item && (item.kind === "image" || item.kind === "video" || (support.documents && item.kind === "document")) && !exclude?.includes(item.key) ? item : null;
      }}
      onPrompt={flow.setPrompt}
      onReferences={flow.setReferences}
      onMaterials={flow.setMaterials}
      {...(support.documents ? { onDocuments: flow.setDocuments } : {})}
      onFiles={(picked) => {
        // An old binary PowerPoint is refused before anything is sent: it asks for a PDF export.
        const oldSlides = support.documents ? picked.filter(isOldSlides) : [];
        const sending = picked.filter((file) => !oldSlides.includes(file));
        if (!sending.length) {
          if (oldSlides.length) flow.note("old_slides");
          return;
        }
        setUploading(true);
        void support
          .upload(sending)
          .then((added) => {
            // Fewer came back than were picked: a file was the wrong kind or too large.
            if (flow.attach(added) > 0) flow.note(support.documents ? "attach_full_documents" : "attach_full");
            else if (oldSlides.length) flow.note("old_slides");
            else if (added.length < sending.length) flow.note("unsupported_file");
          })
          .catch(() => flow.note("failed"))
          .finally(() => setUploading(false));
      }}
      onPick={flow.pick}
      onSubmit={() => {
        setMarking(false);
        void flow.submit();
      }}
      onAccept={(change) => void flow.accept(change)}
      onAnswer={(choice) => void flow.answer(choice)}
      markMode={stage?.host ? marking : null}
      onMarkMode={setMarking}
      onMarkSeek={(key) => {
        const mark = flow.state.marks.find((m) => m.key === key);
        const element = video();
        if (!mark || !element) return;
        element.pause();
        element.currentTime = mark.time;
      }}
      onMarkRemove={(key) => {
        cancelReread(key);
        flow.removeMark(key);
      }}
      promptRef={prompt}
      onCaret={(at) => {
        caret.current = at;
      }}
      />
    </>
  );
}

/** A `.ppt` (the old binary PowerPoint format): it cannot be read; the customer is asked for a PDF. */
export function isOldSlides(file: { name: string; type: string }): boolean {
  return file.type === STUDIO_OLD_SLIDES_MIME || /\.ppt$/i.test(file.name);
}

/** The studio accent as a canvas colour (the frame's mark is drawn in it). */
function accentOf(element: HTMLElement | null): string {
  if (typeof window === "undefined" || !element) return "#0033ff";
  return window.getComputedStyle(element).getPropertyValue("--ys-accent").trim() || "#0033ff";
}
