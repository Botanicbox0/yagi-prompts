/**
 * The reference video panel (docs/BRAND-STUDIO-V2.md §5.2): what the studio read from the video (or
 * nothing when it could not read it — never an error), how to use it, what to keep, what to change,
 * the sound, and the note that a 480p draft comes first.
 */
import { useId } from "react";
import { STUDIO_AUDIO_MODES, STUDIO_KEEP_KEYS, STUDIO_LIMITS, STUDIO_REMIX_METHODS, type StudioKeepKey } from "@/lib/brand-studio/contracts";
import type { StudioCopy } from "./copy";
import type { DockDraft } from "./dock-model";
import type { FilmState } from "./use-studio";

export interface RemixPanelProps {
  draft: DockDraft;
  film: FilmState | null;
  copy: StudioCopy;
  disabled: boolean;
  onChange(patch: Partial<Pick<DockDraft, "method" | "keep" | "change" | "audio">>): void;
}

export function RemixPanel({ draft, film, copy, disabled, onChange }: RemixPanelProps) {
  const r = copy.remix;
  const id = useId();
  const toggleKeep = (key: StudioKeepKey) =>
    onChange({ keep: draft.keep.includes(key) ? draft.keep.filter((k) => k !== key) : [...draft.keep, key] });
  return (
    <section className="bs-remix" data-studio-remix aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{r.title}</h3>
      {film?.status === "loading" && (
        <p className="bs-muted" aria-live="polite" data-film-state="loading">
          {r.reading}
        </p>
      )}
      {film?.status === "done" && film.sheet && (
        <div className="bs-film" data-film-state="read">
          <p className="bs-label">{r.read}</p>
          <p>{film.sheet.summary}</p>
        </div>
      )}
      <fieldset className="bs-seg" disabled={disabled}>
        <legend>{r.method}</legend>
        {STUDIO_REMIX_METHODS.map((method) => (
          <label key={method} className="bs-seg-option" title={r.methodHints[method]}>
            <input type="radio" name={`${id}-method`} value={method} checked={draft.method === method} onChange={() => onChange({ method })} />
            <span>{r.methods[method]}</span>
          </label>
        ))}
      </fieldset>
      <p className="bs-muted">{r.methodHints[draft.method]}</p>
      <div className="bs-keep" role="group" aria-label={r.keep}>
        <span className="bs-label">{r.keep}</span>
        {STUDIO_KEEP_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="bs-chip"
            data-selected={draft.keep.includes(key) ? "" : undefined}
            aria-pressed={draft.keep.includes(key)}
            disabled={disabled}
            onClick={() => toggleKeep(key)}
          >
            {r.keepKeys[key]}
          </button>
        ))}
      </div>
      <label className="bs-label" htmlFor={`${id}-change`}>
        {r.change}
      </label>
      <textarea
        id={`${id}-change`}
        className="bs-field"
        rows={2}
        maxLength={STUDIO_LIMITS.promptMax}
        value={draft.change}
        placeholder={r.changePlaceholder}
        disabled={disabled}
        onChange={(event) => onChange({ change: event.target.value })}
      />
      <label className="bs-label" htmlFor={`${id}-sound`}>
        {copy.dock.sound}
      </label>
      <select
        id={`${id}-sound`}
        className="bs-field"
        value={draft.audio}
        disabled={disabled}
        onChange={(event) => onChange({ audio: event.target.value as DockDraft["audio"] })}
      >
        {STUDIO_AUDIO_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {copy.sound[mode]}
          </option>
        ))}
      </select>
      <p className="bs-muted" data-studio-draft-note>
        {copy.dock.draftNote}
      </p>
    </section>
  );
}
