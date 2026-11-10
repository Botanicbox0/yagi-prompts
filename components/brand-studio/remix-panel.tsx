/**
 * The reference video panel (docs/BRAND-STUDIO-V2.md §5.2): what the studio found in the video (or
 * nothing when it could not read it — never an error), how to use it, what to keep, what to change,
 * the sound, and the note that a 480p draft comes first. One labelled row per decision.
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
  /** One calm sentence when the video is outside what the maker accepts (length, size, edit minimum). */
  limit?: string | null;
  /** False when the clip is too short to edit: only a new take is offered. */
  editable?: boolean;
  onChange(patch: Partial<Pick<DockDraft, "method" | "keep" | "change" | "audio">>): void;
}

export function RemixPanel({ draft, film, copy, disabled, limit = null, editable = true, onChange }: RemixPanelProps) {
  const r = copy.remix;
  const id = useId();
  const toggleKeep = (key: StudioKeepKey) =>
    onChange({ keep: draft.keep.includes(key) ? draft.keep.filter((k) => k !== key) : [...draft.keep, key] });
  return (
    <section className="bs-remix" data-studio-remix aria-labelledby={`${id}-title`}>
      <div className="bs-remix-head">
        <h3 id={`${id}-title`}>{r.title}</h3>
        {film?.status === "loading" && (
          <p className="bs-film-state" aria-live="polite" data-film-state="loading">
            {r.reading}
          </p>
        )}
      </div>
      {limit && (
        <p className="bs-film-limit" role="status" data-studio-film-limit>
          {limit}
        </p>
      )}
      {film?.status === "done" && film.sheet && (
        <div className="bs-film" data-film-state="read">
          <p className="bs-label">{r.read}</p>
          <p>{film.sheet.summary}</p>
        </div>
      )}
      <div className="bs-remix-row">
        <span className="bs-label" id={`${id}-method`}>
          {r.method}
        </span>
        <div className="bs-remix-field">
          <div className="bs-seg" role="radiogroup" aria-labelledby={`${id}-method`}>
            {STUDIO_REMIX_METHODS.map((method) => (
              <label key={method} className="bs-seg-option">
                <input
                  type="radio"
                  name={`${id}-method`}
                  value={method}
                  checked={draft.method === method}
                  disabled={disabled || (method === "edit" && !editable)}
                  onChange={() => onChange({ method })}
                />
                <span>{r.methods[method]}</span>
              </label>
            ))}
          </div>
          <p className="bs-muted">{r.methodHints[draft.method]}</p>
        </div>
      </div>
      <div className="bs-remix-row">
        <span className="bs-label" id={`${id}-keep`}>
          {r.keep}
        </span>
        <div className="bs-keep" role="group" aria-labelledby={`${id}-keep`}>
          {STUDIO_KEEP_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="bs-chip"
              data-size="sm"
              data-selected={draft.keep.includes(key) ? "" : undefined}
              aria-pressed={draft.keep.includes(key)}
              disabled={disabled}
              onClick={() => toggleKeep(key)}
            >
              {r.keepKeys[key]}
            </button>
          ))}
        </div>
      </div>
      <div className="bs-remix-row">
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
      </div>
      <div className="bs-remix-row">
        <span className="bs-label" id={`${id}-sound`}>
          {copy.dock.sound}
        </span>
        <div className="bs-seg" role="radiogroup" aria-labelledby={`${id}-sound`} data-studio-remix-sound>
          {STUDIO_AUDIO_MODES.map((mode) => (
            <label key={mode} className="bs-seg-option">
              <input type="radio" name={`${id}-sound`} value={mode} checked={draft.audio === mode} disabled={disabled} onChange={() => onChange({ audio: mode })} />
              <span>{copy.sound[mode]}</span>
            </label>
          ))}
        </div>
      </div>
      <p className="bs-muted bs-remix-note" data-studio-draft-note>
        {copy.dock.draftNote}
      </p>
    </section>
  );
}
