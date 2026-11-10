/**
 * The prompt dock (docs/BRAND-STUDIO-V2.md §5.2): one dock for images and video. Three rows: the
 * reference tray, the prompt, then the controls from the model registry with this run's expected usage
 * and the screen's single solid button. The month's usage is a hairline meter on the top edge and one
 * small line under the controls.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { STUDIO_AUDIO_MODES, STUDIO_LIMITS, type StudioAllowanceView } from "@/lib/brand-studio/contracts";
import { uploadKind } from "./api";
import { fill, formatDay, formatKrw, type StudioCopy, type StudioLocale } from "./copy";
import { DRAFT_RESOLUTION, dockControls, remixActive, remixFit, withMedium, withModel, type DockDraft } from "./dock-model";
import { StudioIcon } from "./icons";
import { RemixPanel } from "./remix-panel";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource, type TrayItem } from "./refs";
import { Tray } from "./tray";
import { filmLimitLine } from "./use-dock";
import type { FilmState } from "./use-studio";
import type { StudioVideoModel } from "@/lib/brand-studio/models";

export interface DockProps {
  draft: DockDraft;
  tray: readonly TrayItem[];
  labels: readonly string[];
  copy: StudioCopy;
  locale: StudioLocale;
  allowance: StudioAllowanceView;
  /** This run's expected usage in KRW (dock-model.ts `dockEstimateKrw`, the server's arithmetic). */
  quoteKrw: number;
  busy: boolean;
  message: string | null;
  /** A quiet line about something the dock did on its own. */
  notice?: string | null;
  film: FilmState | null;
  uploading: readonly string[];
  initialOpenRef?: string | null;
  onDraft(next: DockDraft): void;
  onTrayUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onTrayRemove(key: string): void;
  onSubmit(): void;
  onDropSource(source: RefSource): void;
  onFiles(files: File[]): void;
  onBrowse(): void;
}

/** The dock's real height as `--bs-dock-h` on the page, so the board, popovers and the help launcher clear it. */
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

export function Dock(props: DockProps) {
  const { draft, tray, copy, locale, busy, message, onDraft } = props;
  const d = copy.dock;
  const id = useId();
  const form = useDockHeight();
  const controls = dockControls(draft);
  const remix = remixActive(draft, tray);
  const fit = remix ? remixFit(draft, tray) : null;
  const limits = controls.model.medium === "video" ? (controls.model as StudioVideoModel).referenceVideoSeconds : null;
  const filmLimit = fit && limits ? (fit.problem ? filmLimitLine(fit.problem, limits, copy) : !fit.editable ? filmLimitLine("edit", limits, copy) : null) : null;
  const [dropActive, setDropActive] = useState(false);
  const depth = useRef(0);
  const set = (patch: Partial<DockDraft>) => onDraft({ ...draft, ...patch });
  const hint = (key: string) => copy.models[key as keyof StudioCopy["models"]];
  const quote = formatKrw(props.quoteKrw, locale);

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
      data-mode={draft.medium}
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
      <UsageMeter allowance={props.allowance} copy={copy} locale={locale} />
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
        onBrowse={props.onBrowse}
      />
      {remix && <RemixPanel draft={draft} film={props.film} copy={copy} disabled={busy} limit={filmLimit} editable={fit?.editable ?? true} onChange={set} />}
      <label className="bs-sr" htmlFor={`${id}-prompt`}>
        {d.label}
      </label>
      <textarea
        id={`${id}-prompt`}
        className="bs-prompt"
        rows={2}
        maxLength={STUDIO_LIMITS.promptMax}
        value={draft.prompt}
        placeholder={d.placeholder}
        aria-describedby={message ? `${id}-message` : undefined}
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
      {message && (
        <p id={`${id}-message`} className="bs-dock-message" role="alert" data-studio-dock-message>
          {message}
        </p>
      )}
      {props.notice && draft.medium === "video" && (
        <p className="bs-dock-note" role="status" data-studio-dock-notice>
          {props.notice}
        </p>
      )}
      <div className="bs-controls">
        <div className="bs-controls-set" data-studio-controls>
          <fieldset className="bs-seg" data-studio-mode>
            <legend className="bs-sr">{d.mode}</legend>
            {(["image", "video"] as const).map((medium) => (
              <label key={medium} className="bs-seg-option">
                <input type="radio" name={`${id}-mode`} value={medium} checked={draft.medium === medium} onChange={() => onDraft(withMedium(draft, medium))} />
                <span>{d[medium]}</span>
              </label>
            ))}
          </fieldset>
          <Select id={`${id}-model`} label={d.model} quietLabel value={controls.model.id} display={controls.model.label} onChange={(value) => onDraft(withModel(draft, value))} data="model">
            {controls.models.map((model) => (
              <option key={model.id} value={model.id}>
                {`${model.label} · ${hint(model.hintKey)}`}
              </option>
            ))}
          </Select>
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
          <button
            type="button"
            role="switch"
            className="bs-switch"
            aria-checked={draft.enhance}
            aria-describedby={`${id}-enhance`}
            title={d.enhanceHint}
            data-studio-enhance
            onClick={() => set({ enhance: !draft.enhance })}
          >
            <span className="bs-switch-knob" aria-hidden="true" />
            {d.enhance}
          </button>
          <span id={`${id}-enhance`} className="bs-sr">
            {d.enhanceHint}
          </span>
        </div>
        <div className="bs-controls-end">
          <span className="bs-num bs-quote" title={fill(d.expectedLabel, { amount: quote })} data-studio-quote>
            <span aria-hidden="true">{fill(d.expected, { amount: quote })}</span>
            <span className="bs-sr">{fill(d.expectedLabel, { amount: quote })}</span>
          </span>
          <button type="submit" className="bs-btn" data-variant="solid" data-size="md" disabled={busy || Boolean(fit?.problem)} data-studio-submit>
            {busy ? d.submitting : d.submit}
          </button>
        </div>
      </div>
      <UsageLine allowance={props.allowance} copy={copy} locale={locale} />
    </form>
  );
}

function Select({
  id,
  label,
  quietLabel = false,
  value,
  display,
  onChange,
  data,
  children,
}: {
  id: string;
  label: string;
  /** The value says what it is (a model name, a sound): keep the label for screen readers only. */
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

function usageText(allowance: StudioAllowanceView, copy: StudioCopy, locale: StudioLocale) {
  const used = Math.max(0, allowance.usedKrw);
  const cap = Math.max(0, allowance.capKrw);
  return { used, cap, value: fill(copy.dock.usageValue, { used: formatKrw(used, locale), cap: formatKrw(cap, locale) }) };
}

/** The month's usage as a hairline along the dock's top edge. */
export function UsageMeter({ allowance, copy, locale }: { allowance: StudioAllowanceView; copy: StudioCopy; locale: StudioLocale }) {
  const { used, cap, value } = usageText(allowance, copy, locale);
  const share = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <div className="bs-meter" role="meter" aria-label={copy.dock.usage} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-valuetext={value} data-studio-meter>
      <span style={{ width: `${share}%` }} />
    </div>
  );
}

/** One small line under the controls; the refill day is in its tooltip. */
function UsageLine({ allowance, copy, locale }: { allowance: StudioAllowanceView; copy: StudioCopy; locale: StudioLocale }) {
  const { value } = usageText(allowance, copy, locale);
  const day = formatDay(allowance.resetsAt, locale);
  return (
    <p className="bs-usage-line bs-num" title={day ? fill(copy.dock.resets, { date: day }) : undefined} data-studio-allowance>
      {value}
    </p>
  );
}
