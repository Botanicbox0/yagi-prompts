"use client";
/**
 * The prompt bar (docs/BRAND-STUDIO-V3.md §4): one rounded translucent panel floating over the bottom
 * centre of the wall. Top: the reference row (square thumbnails, a number under each). Middle: the
 * text. Bottom: one row of compact chips (model, ratio, quality, count — length and sound on the video
 * screen), prompt polishing (the "자동 개선" switch with its "!" explanation and the ✨ button), and on
 * the right the screen's one solid button with this run's cost in credits.
 *
 * The screen fixes the medium (`mode`): there is no image/video switch here.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { STUDIO_AUDIO_MODES, STUDIO_LIMITS, type StudioAllowanceView } from "@/lib/brand-studio/contracts";
import { creditsLeft } from "@/lib/brand-studio/credits";
import type { StudioMedium, StudioVideoModel } from "@/lib/brand-studio/models";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { uploadKind } from "./api";
import { credits, fill, formatDay, type StudioCopy, type StudioLocale } from "./copy";
import { DRAFT_RESOLUTION, dockControls, remixActive, remixBlocking, remixFit, withModel, type DockDraft } from "./dock-model";
import { ModelMenu } from "./gallery/model-menu";
import { StudioIcon } from "./icons";
import { RemixPanel } from "./remix-panel";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource, type TrayItem } from "./refs";
import { Tray } from "./tray";
import { filmLimitLine } from "./use-dock";
import type { FilmState } from "./use-studio";

export interface DockProps {
  /** The screen's medium; the bar never offers the other one. */
  mode?: StudioMedium;
  draft: DockDraft;
  tray: readonly TrayItem[];
  labels: readonly string[];
  copy: StudioCopy;
  locale: StudioLocale;
  allowance: StudioAllowanceView;
  /** This run's expected cost in credits (dock-model.ts `dockCredits`, the server's arithmetic). */
  credits: number;
  busy: boolean;
  message: string | null;
  /** A quiet line about something the bar did on its own. */
  notice?: string | null;
  /** The screen's latest status line, shown as a small pill above the bar (the screen announces it). */
  toast?: string | null;
  film: FilmState | null;
  uploading: readonly string[];
  initialOpenRef?: string | null;
  /** The ✨ button is waiting for the improved sentence. */
  enhancing?: boolean;
  /** The text in the field is the improved sentence (offer "원래 문장으로"). */
  enhanced?: boolean;
  /** Opens the model list first (tests). */
  initialModelMenu?: boolean;
  /** `dict.studioVideo`, for the reference-video panel's link to the full reverse panel (video screen). */
  videoCopy?: Dictionary["studioVideo"];
  onDraft(next: DockDraft): void;
  onTrayUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onTrayRemove(key: string): void;
  onTrayMove?(from: number, to: number): void;
  onSubmit(): void;
  onDropSource(source: RefSource): void;
  onFiles(files: File[]): void;
  onBrowse(): void;
  onEnhance?(): void;
  onUndoEnhance?(): void;
}

/** The bar's real height as `--bs-dock-h` on the page, so the wall, popovers and the help launcher clear it. */
function useDockHeight() {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--bs-dock-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(write);
    observer.observe(el);
    write();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bs-dock-h");
    };
  }, []);
  return ref;
}

/** Grows the text field with what is typed, up to six lines. */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 20)}px`;
  }, [value]);
  return ref;
}

export function Dock(props: DockProps) {
  const { draft, tray, copy, locale, busy, message, onDraft, mode = draft.medium, enhancing = false, enhanced = false } = props;
  const d = copy.dock;
  const id = useId();
  const form = useDockHeight();
  const field = useAutoGrow(draft.prompt);
  const controls = dockControls(draft);
  const remix = remixActive(draft, tray);
  const fit = remix ? remixFit(draft, tray) : null;
  const limits = controls.model.medium === "video" ? (controls.model as StudioVideoModel).referenceVideoSeconds : null;
  // A blueprint only reads the clip, so its pixel size is no reason to stop (dock-model.ts `remixBlocking`).
  const blocking = remixBlocking(draft, fit);
  const filmLimit = fit && limits ? (blocking ? filmLimitLine(blocking, limits, copy) : !fit.editable && draft.method !== "blueprint" ? filmLimitLine("edit", limits, copy) : null) : null;
  const filmAsset = remix ? (tray.find((item) => item.kind === "video")?.assetId ?? null) : null;
  const [dropActive, setDropActive] = useState(false);
  const depth = useRef(0);
  const set = (patch: Partial<DockDraft>) => onDraft({ ...draft, ...patch });
  const cost = credits(copy.credits.amount, props.credits, locale);
  const canEnhance = Boolean(props.onEnhance) && draft.prompt.trim().length > 0 && !enhancing && !busy;

  const dragIn = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    depth.current += 1;
    setDropActive(true);
  };
  const dragOver = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const dragOut = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDropActive(false);
  };
  const drop = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    depth.current = 0;
    setDropActive(false);
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) props.onDropSource(source);
    else if (event.dataTransfer.files.length) props.onFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <form
      ref={form}
      className="bs-dock"
      data-studio-dock
      data-mode={mode}
      data-drop-target={dropActive ? "" : undefined}
      aria-label={d.label}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      onDragEnter={dragIn}
      onDragOver={dragOver}
      onDragLeave={dragOut}
      onDrop={drop}
    >
      {props.toast && (
        <p className="bs-dock-toast" aria-hidden="true" data-studio-toast>
          {props.toast}
        </p>
      )}
      <Tray
        items={tray}
        labels={props.labels}
        medium={draft.medium}
        copy={copy}
        dropActive={dropActive}
        uploading={props.uploading}
        initialOpen={props.initialOpenRef ?? null}
        onUpdate={props.onTrayUpdate}
        onRemove={props.onTrayRemove}
        onMove={props.onTrayMove ?? (() => {})}
        onBrowse={props.onBrowse}
      />
      {remix && (
        <RemixPanel
          draft={draft}
          film={props.film}
          copy={copy}
          disabled={busy}
          limit={filmLimit}
          editable={fit?.editable ?? true}
          videoCopy={props.videoCopy}
          videoAssetId={filmAsset}
          onChange={set}
        />
      )}
      <div className="bs-prompt-wrap" data-enhancing={enhancing ? "" : undefined} data-enhanced={enhanced ? "" : undefined}>
        <label className="bs-sr" htmlFor={`${id}-prompt`}>
          {d.label}
        </label>
        <textarea
          ref={field}
          id={`${id}-prompt`}
          className="bs-prompt"
          rows={1}
          maxLength={STUDIO_LIMITS.promptMax}
          value={draft.prompt}
          placeholder={mode === "video" ? d.placeholderVideo : d.placeholder}
          aria-describedby={[message ? `${id}-message` : "", enhanced || enhancing ? `${id}-enhanced` : ""].filter(Boolean).join(" ") || undefined}
          aria-busy={enhancing}
          readOnly={enhancing}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onChange={(event) => set({ prompt: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) => uploadKind(file.type) !== null);
            if (!files.length) return;
            event.preventDefault();
            props.onFiles(files);
          }}
        />
      </div>
      {(enhancing || enhanced) && (
        <p id={`${id}-enhanced`} className="bs-dock-note bs-enhanced-note" role="status" data-studio-enhanced>
          <span>{enhancing ? d.enhancing : d.enhanced}</span>
          {enhanced && props.onUndoEnhance && (
            <button type="button" className="bs-link-btn" data-studio-undo-enhance onClick={props.onUndoEnhance}>
              <StudioIcon name="undo" />
              {d.undoEnhance}
            </button>
          )}
        </p>
      )}
      {message && (
        <p id={`${id}-message`} className="bs-dock-message" role="alert" data-studio-dock-message>
          {message}
        </p>
      )}
      {props.notice && (
        <p className="bs-dock-note" role="status" data-studio-dock-notice>
          {props.notice}
        </p>
      )}
      <div className="bs-controls">
        <div className="bs-controls-set" data-studio-controls>
          <ModelMenu
            models={controls.models}
            value={controls.model.id}
            draft={draft}
            references={tray.length}
            copy={copy}
            locale={locale}
            initialOpen={props.initialModelMenu}
            onChange={(value) => onDraft(withModel(draft, value))}
          />
          <Select id={`${id}-aspect`} label={d.aspect} value={draft.aspect} display={draft.aspect} onChange={(aspect) => set({ aspect })} data="aspect">
            {controls.aspects.map((aspect) => (
              <option key={aspect} value={aspect}>
                {aspect}
              </option>
            ))}
          </Select>
          <Select
            id={`${id}-resolution`}
            label={d.resolution}
            value={draft.resolution}
            display={draft.resolution === DRAFT_RESOLUTION ? d.draft : draft.resolution}
            onChange={(resolution) => set({ resolution })}
            data="resolution"
          >
            {controls.resolutions.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution === DRAFT_RESOLUTION ? d.draft : resolution}
              </option>
            ))}
          </Select>
          {controls.qualities.length > 0 && (
            <Select
              id={`${id}-quality`}
              label={d.quality}
              value={draft.quality}
              display={copy.qualities[draft.quality as keyof StudioCopy["qualities"]] ?? draft.quality}
              onChange={(quality) => set({ quality })}
              data="quality"
            >
              {controls.qualities.map((quality) => (
                <option key={quality} value={quality}>
                  {copy.qualities[quality as keyof StudioCopy["qualities"]] ?? quality}
                </option>
              ))}
            </Select>
          )}
          {draft.medium === "image" ? (
            <Select id={`${id}-count`} label={d.count} value={String(draft.count)} display={fill(d.countValue, { n: draft.count })} onChange={(value) => set({ count: Number(value) })} data="count">
              {controls.counts.map((n) => (
                <option key={n} value={n}>
                  {fill(d.countValue, { n })}
                </option>
              ))}
            </Select>
          ) : (
            !(remix && draft.method === "edit") && (
              <Select id={`${id}-seconds`} label={d.seconds} value={String(draft.seconds)} display={fill(d.secondsValue, { n: draft.seconds })} onChange={(value) => set({ seconds: Number(value) })} data="seconds">
                {controls.seconds.map((n) => (
                  <option key={n} value={n}>
                    {fill(d.secondsValue, { n })}
                  </option>
                ))}
              </Select>
            )
          )}
          {draft.medium === "video" && !remix && (
            <Select id={`${id}-sound`} label={d.sound} quietLabel value={draft.audio} display={copy.sound[draft.audio]} onChange={(audio) => set({ audio: audio as DockDraft["audio"] })} data="sound">
              {STUDIO_AUDIO_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {copy.sound[mode]}
                </option>
              ))}
            </Select>
          )}
          <span className="bs-enhance" data-studio-enhance-group>
            <button
              type="button"
              role="switch"
              className="bs-switch"
              aria-checked={draft.enhance}
              data-studio-enhance
              onClick={() => set({ enhance: !draft.enhance })}
            >
              <span className="bs-switch-knob" aria-hidden="true" />
              {d.enhance}
            </button>
            <Tip id={`${id}-enhance-tip`} label={d.enhanceInfo}>
              <span>{mode === "video" ? d.enhanceTipVideo : d.enhanceTip}</span>
              <span>{d.enhanceTipFree}</span>
            </Tip>
            {props.onEnhance && (
              <button
                type="button"
                className="bs-chip-btn bs-enhance-now"
                data-studio-enhance-now
                aria-label={d.enhanceNow}
                title={d.enhanceNow}
                disabled={!canEnhance}
                aria-busy={enhancing}
                onClick={props.onEnhance}
              >
                <StudioIcon name="sparkles" />
              </button>
            )}
          </span>
        </div>
        <div className="bs-controls-end">
          <button
            type="submit"
            className="bs-btn bs-submit"
            data-variant="solid"
            data-size="md"
            disabled={busy || enhancing || Boolean(blocking)}
            aria-label={busy ? d.submitting : fill(d.submitLabel, { cost })}
            data-studio-submit
          >
            <span>{busy ? d.submitting : d.submit}</span>
            {!busy && (
              <span className="bs-submit-cost bs-num" data-studio-quote>
                {cost}
              </span>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

/** A "!" button whose tooltip opens on hover and on keyboard focus (and stays readable by screen readers). */
export function Tip({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <span className="bs-tip" data-studio-tip>
      <button type="button" className="bs-tip-btn" aria-label={label} aria-describedby={id}>
        <span aria-hidden="true">!</span>
      </button>
      <span id={id} role="tooltip" className="bs-tip-body">
        {children}
      </span>
    </span>
  );
}

function Select({
  id,
  label,
  quietLabel = true,
  value,
  display,
  onChange,
  data,
  children,
}: {
  id: string;
  label: string;
  /** The value says what it is (a ratio, a quality): keep the label for screen readers only. */
  quietLabel?: boolean;
  value: string;
  display: string;
  onChange(value: string): void;
  data: string;
  children: ReactNode;
}) {
  return (
    <span className="bs-select" data-control={data}>
      <label htmlFor={id} className={quietLabel ? "bs-sr" : undefined}>
        {label}
      </label>
      <span className="bs-select-value" aria-hidden="true">
        {display}
      </span>
      <StudioIcon name="chevron" />
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </span>
  );
}

function allowanceText(allowance: StudioAllowanceView, copy: StudioCopy, locale: StudioLocale) {
  const cap = Math.max(0, allowance.capKrw);
  const used = Math.max(0, allowance.usedKrw);
  const left = creditsLeft(cap, used);
  const total = creditsLeft(cap, 0);
  return { left, total, value: credits(copy.credits.left, left, locale) };
}

/** "남은 크레딧 12,340" with the refill day in its tooltip (the page header shows it). */
export function AllowanceLine({ allowance, copy, locale }: { allowance: StudioAllowanceView; copy: StudioCopy; locale: StudioLocale }) {
  const { value } = allowanceText(allowance, copy, locale);
  const day = formatDay(allowance.resetsAt, locale);
  return (
    <p className="bs-allowance bs-num" title={day ? fill(copy.dock.resets, { date: day }) : undefined} data-studio-allowance>
      {value}
    </p>
  );
}
