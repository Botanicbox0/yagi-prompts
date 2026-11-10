/**
 * The prompt dock (docs/BRAND-STUDIO-V2.md §5.2): one dock for images and video, the reference tray,
 * controls that come from the model registry, the month's usage and this run's expected usage (both
 * numbers the server returned), and the screen's single solid button.
 */
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { STUDIO_AUDIO_MODES, STUDIO_LIMITS, type StudioAllowanceView } from "@/lib/brand-studio/contracts";
import { fill, formatDay, formatKrw, type StudioCopy, type StudioLocale } from "./copy";
import { DRAFT_RESOLUTION, dockControls, remixActive, withMedium, withModel, type DockDraft } from "./dock-model";
import { RemixPanel } from "./remix-panel";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource, type TrayItem } from "./refs";
import { Tray } from "./tray";
import type { FilmState } from "./use-studio";

export interface DockProps {
  draft: DockDraft;
  tray: readonly TrayItem[];
  labels: readonly string[];
  copy: StudioCopy;
  locale: StudioLocale;
  allowance: StudioAllowanceView;
  /** This run's expected usage in KRW as the server reported it, or null when not known. */
  quoteKrw: number | null;
  busy: boolean;
  message: string | null;
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

export function Dock(props: DockProps) {
  const { draft, tray, copy, locale, busy, message, onDraft } = props;
  const d = copy.dock;
  const id = useId();
  const controls = dockControls(draft);
  const remix = remixActive(draft, tray);
  const [dropActive, setDropActive] = useState(false);
  const depth = useRef(0);
  const set = (patch: Partial<DockDraft>) => onDraft({ ...draft, ...patch });

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
      {remix && <RemixPanel draft={draft} film={props.film} copy={copy} disabled={busy} onChange={set} />}
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
          const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
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
      <div className="bs-controls">
        <fieldset className="bs-seg" data-studio-mode>
          <legend className="bs-sr">{d.mode}</legend>
          {(["image", "video"] as const).map((medium) => (
            <label key={medium} className="bs-seg-option">
              <input type="radio" name={`${id}-mode`} value={medium} checked={draft.medium === medium} onChange={() => onDraft(withMedium(draft, medium))} />
              <span>{d[medium]}</span>
            </label>
          ))}
        </fieldset>
        <Select id={`${id}-model`} label={d.model} value={controls.model.id} onChange={(value) => onDraft(withModel(draft, value))} data="model">
          {controls.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </Select>
        <Select id={`${id}-aspect`} label={d.aspect} value={draft.aspect} onChange={(aspect) => set({ aspect })} data="aspect">
          {controls.aspects.map((aspect) => (
            <option key={aspect} value={aspect}>
              {aspect}
            </option>
          ))}
        </Select>
        <Select id={`${id}-resolution`} label={d.resolution} value={draft.resolution} onChange={(resolution) => set({ resolution })} data="resolution">
          {controls.resolutions.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution === DRAFT_RESOLUTION ? d.draft : resolution}
            </option>
          ))}
        </Select>
        {draft.medium === "image" ? (
          <Select id={`${id}-count`} label={d.count} value={String(draft.count)} onChange={(value) => set({ count: Number(value) })} data="count">
            {controls.counts.map((n) => (
              <option key={n} value={n}>
                {fill(d.countValue, { n })}
              </option>
            ))}
          </Select>
        ) : (
          !(remix && draft.method === "edit") && (
            <Select id={`${id}-seconds`} label={d.seconds} value={String(draft.seconds)} onChange={(value) => set({ seconds: Number(value) })} data="seconds">
              {controls.seconds.map((n) => (
                <option key={n} value={n}>
                  {fill(d.secondsValue, { n })}
                </option>
              ))}
            </Select>
          )
        )}
        {draft.medium === "video" && !remix && (
          <Select id={`${id}-sound`} label={d.sound} value={draft.audio} onChange={(audio) => set({ audio: audio as DockDraft["audio"] })} data="sound">
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
      <p className="bs-model-hint">{copy.models[controls.model.hintKey as keyof StudioCopy["models"]]}</p>
      <div className="bs-dock-foot">
        <Meter allowance={props.allowance} quoteKrw={props.quoteKrw} copy={copy} locale={locale} />
        <button type="submit" className="bs-btn" data-variant="solid" data-size="md" disabled={busy} data-studio-submit>
          {busy ? d.submitting : d.submit}
        </button>
      </div>
    </form>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  data,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  data: string;
  children: ReactNode;
}) {
  return (
    <span className="bs-select" data-control={data}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </span>
  );
}

export function Meter({ allowance, quoteKrw, copy, locale }: { allowance: StudioAllowanceView; quoteKrw: number | null; copy: StudioCopy; locale: StudioLocale }) {
  const d = copy.dock;
  const used = Math.max(0, allowance.usedKrw);
  const cap = Math.max(0, allowance.capKrw);
  const share = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const value = fill(d.usageValue, { used: formatKrw(used, locale), cap: formatKrw(cap, locale) });
  const day = formatDay(allowance.resetsAt, locale);
  return (
    <div className="bs-meter" data-studio-allowance>
      <p className="bs-meter-line">
        <span>{d.usage}</span>
        <span className="bs-num">{value}</span>
      </p>
      <div className="bs-meter-bar" role="meter" aria-label={d.usage} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-valuetext={value}>
        <span style={{ width: `${share}%` }} />
      </div>
      {quoteKrw !== null && (
        <p className="bs-num bs-quote" data-studio-quote>
          {fill(d.expected, { amount: formatKrw(quoteKrw, locale) })}
        </p>
      )}
      {day && <p className="bs-muted">{fill(d.resets, { date: day })}</p>}
    </div>
  );
}
