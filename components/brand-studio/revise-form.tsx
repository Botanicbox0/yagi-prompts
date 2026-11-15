"use client";
/**
 * The next version of a generated clip, inside the viewer (docs/BRAND-STUDIO-V6-PLAN.md §4): the version
 * strip (v1 … vN, the one being made shows as such) with the shown version's request under it, and the
 * form under that: what to change, reference images, the two ways with their credits, "vN 만들기".
 * The logic is `revise-flow.ts`; this file is only the screen.
 */
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import {
  STUDIO_LIMITS,
  STUDIO_REVISE_MODES,
  STUDIO_UPLOAD_MIMES,
  type StudioJobCreated,
  type StudioJobView,
  type StudioReviseMode,
  type StudioRevisePlan,
  type StudioReviseProblem,
} from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import type { ApiResult } from "./api";
import { credits, errorLine, fill, type StudioCopy, type StudioLocale } from "./copy";
import { StudioIcon } from "./icons";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, startRefDrag, type RefSource, type TrayItem } from "./refs";
import { REVISE_REFERENCES_MAX, createReviseFlow, initialReviseState, type ReviseCreateInput, type ReviseState } from "./revise-flow";
import type { ChainVersion } from "./revision-model";

/** What the screen hands the viewer so a generated clip can get its next version. */
export interface ReviseSupport {
  organizationId: string;
  /** Every run of the screen (versions hidden from the wall included). */
  jobs: readonly StudioJobView[];
  recent: readonly TrayItem[];
  resolve(source: RefSource): TrayItem | null;
  upload(files: File[]): Promise<TrayItem[]>;
  plan(input: { organizationId: string; outputId: string; prompt: string; references: ReviseCreateInput["references"] }): Promise<ApiResult<StudioRevisePlan>>;
  create(input: ReviseCreateInput): Promise<ApiResult<StudioJobCreated>>;
}

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
  onFiles(files: File[]): void;
  resolve(source: RefSource): TrayItem | null;
  onPick(mode: StudioReviseMode): void;
  onSubmit(): void;
  onAccept(change: boolean): void;
}

export function noteLine(note: string, state: ReviseState, copy: StudioCopy): string {
  if (note === "empty_prompt") return copy.dock.emptyPrompt;
  if (note === "unavailable") {
    const problem = state.plan?.methods[state.mode]?.problem;
    return problem ? copy.revise.problems[problem] : copy.revise.problems.unsupported;
  }
  return errorLine(copy, note);
}

/** The form as markup only (tests render it with a fixed state). */
export function ReviseFormView(props: ReviseFormViewProps) {
  const { state, copy, locale } = props;
  const r = copy.revise;
  const id = useId();
  const files = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const busy = state.phase === "checking" || state.phase === "sending";
  const full = state.references.length >= REVISE_REFERENCES_MAX;
  const add = (item: TrayItem | null) => {
    if (!item || item.kind !== "image" || full || state.references.some((ref) => ref.key === item.key)) return;
    props.onReferences([...state.references, item]);
  };
  const drop = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    setDropActive(false);
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) add(props.resolve(source));
    else if (event.dataTransfer.files.length) props.onFiles(Array.from(event.dataTransfer.files));
  };
  const cost = (mode: StudioReviseMode) => {
    const method = state.plan?.methods[mode];
    return method && method.estimateKrw > 0 ? credits(copy.credits.amount, creditsOf(method.estimateKrw), locale) : null;
  };
  const problem = (code: StudioReviseProblem | undefined) => (code ? r.problems[code] : r.problems.unsupported);

  return (
    <form
      className="bs-revise"
      data-revise-form
      data-phase={state.phase}
      data-drop-target={dropActive ? "" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      onDragOver={(event) => {
        if (!acceptsDrag(event.dataTransfer?.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={drop}
    >
      <label className="bs-sr" htmlFor={`${id}-prompt`}>
        {r.prompt}
      </label>
      <textarea
        id={`${id}-prompt`}
        className="bs-field"
        rows={2}
        maxLength={STUDIO_LIMITS.promptMax}
        value={state.prompt}
        placeholder={r.placeholder}
        data-revise-prompt
        onChange={(event) => props.onPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <ul className="bs-region-ref-list" data-revise-refs>
        {state.references.map((ref, i) => (
          <li key={ref.key} className="bs-region-ref" data-revise-ref={i + 1}>
            <span className="bs-thumb" data-static>
              <img src={ref.thumbUrl ?? ref.url} alt="" draggable={false} />
            </span>
            <span className="bs-thumb-n bs-num" aria-hidden="true">
              {i + 1}
            </span>
            <button type="button" className="bs-thumb-x" aria-label={fill(r.removeRef, { n: i + 1 })} onClick={() => props.onReferences(state.references.filter((x) => x.key !== ref.key))}>
              <StudioIcon name="close" />
            </button>
          </li>
        ))}
        <li className="bs-region-ref">
          <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" data-revise-add disabled={full || props.uploading} onClick={() => files.current?.click()}>
            <StudioIcon name={props.uploading ? "spark" : "plus"} />
            {r.addRefs}
          </button>
          <input
            ref={files}
            type="file"
            className="bs-sr"
            tabIndex={-1}
            accept={STUDIO_UPLOAD_MIMES.image.join(",")}
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) props.onFiles(picked);
            }}
          />
        </li>
      </ul>
      {props.recent.length > 0 && (
        <ul className="bs-strip" aria-label={r.addRefs}>
          {props.recent.map((item) => {
            const taken = state.references.some((ref) => ref.key === item.key);
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className="bs-thumb"
                  data-taken={taken ? "" : undefined}
                  disabled={taken || full}
                  draggable
                  onDragStart={(event) => startRefDrag(event, item.assetId ? { assetId: item.assetId } : { outputId: item.outputId! })}
                  aria-label={fill(r.addOne, { name: item.name })}
                  onClick={() => add(item)}
                >
                  <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" draggable={false} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <fieldset className="bs-revise-methods">
        <legend className="bs-sr">{r.method}</legend>
        {STUDIO_REVISE_MODES.map((mode) => {
          const method = state.plan?.methods[mode];
          const closed = Boolean(method && !method.available);
          const price = cost(mode);
          return (
            <div key={mode} className="bs-revise-method-row">
              <label className="bs-revise-method" data-revise-method={mode} data-disabled={closed ? "" : undefined}>
                <input type="radio" name={`${id}-method`} value={mode} checked={state.mode === mode} disabled={closed || busy} onChange={() => props.onPick(mode)} />
                <span>{r[mode]}</span>
                {price && <span className="bs-num bs-revise-cost">{price}</span>}
              </label>
              {closed && (
                <p className="bs-muted bs-revise-problem" data-revise-problem={method?.problem ?? "unsupported"}>
                  {problem(method?.problem)}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>
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
      <button type="submit" className="bs-btn bs-submit" data-variant="solid" data-size="md" data-revise-submit disabled={busy || state.phase === "suggest"} aria-busy={busy || undefined}>
        <span>{fill(r.submit, { n: props.version })}</span>
        {cost(state.mode) && <span className="bs-submit-cost bs-num">{cost(state.mode)}</span>}
      </button>
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
}: {
  outputId: string;
  support: ReviseSupport;
  copy: StudioCopy;
  locale: StudioLocale;
  /** The next number before the plan answers. */
  fallbackVersion: number;
  /** Keys not to offer in the recent strip (the clip itself). */
  exclude?: readonly string[];
}) {
  const [state, setState] = useState<ReviseState>(initialReviseState);
  const [uploading, setUploading] = useState(false);
  const live = useRef(support);
  live.current = support;
  const flow = useMemo(
    () =>
      createReviseFlow({
        organizationId: support.organizationId,
        outputId,
        plan: (input) => live.current.plan(input),
        create: (input) => live.current.create(input),
        onChange: setState,
      }),
    // A flow per shown result; `support` is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outputId, support.organizationId],
  );
  useEffect(() => {
    void flow.load();
  }, [flow]);
  const recent = useMemo(() => support.recent.filter((r) => r.kind === "image" && !exclude?.includes(r.key)), [support.recent, exclude]);
  return (
    <ReviseFormView
      state={state}
      version={state.plan?.version ?? fallbackVersion}
      copy={copy}
      locale={locale}
      recent={recent}
      uploading={uploading}
      resolve={(source) => {
        const item = support.resolve(source);
        return item && item.kind === "image" ? item : null;
      }}
      onPrompt={flow.setPrompt}
      onReferences={flow.setReferences}
      onFiles={(picked) => {
        setUploading(true);
        void support
          .upload(picked)
          .then((added) => {
            const current = flow.state.references;
            flow.setReferences([...current, ...added.filter((a) => a.kind === "image" && !current.some((c) => c.key === a.key))]);
          })
          .catch(() => flow.note("failed"))
          .finally(() => setUploading(false));
      }}
      onPick={flow.pick}
      onSubmit={() => void flow.submit()}
      onAccept={(change) => void flow.accept(change)}
    />
  );
}
