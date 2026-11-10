/**
 * The reference video panel inside the prompt bar (docs/BRAND-STUDIO-V2.md §5.2, V3 §6): what the studio
 * found in the video (or nothing when it could not read it — never an error), how to use it, what to
 * keep, what to change, the sound, and the note that a 480p draft comes first. One labelled row per
 * decision. It is the quick path for a video dropped into the bar; the full path (an editable shot table,
 * what changes with pictures) is the reference-video drawer on the video screen, one link away.
 *
 * The three ways: remake from the blueprint (`blueprint`, the video is only read), attach and follow
 * (`reference`) and edit this video (`edit`, when the clip is long enough).
 */
import { useId } from "react";
import { STUDIO_AUDIO_MODES, STUDIO_KEEP_KEYS, STUDIO_LIMITS, type StudioKeepKey, type StudioRemixMethod } from "@/lib/brand-studio/contracts";
import { studioVideoEn, studioVideoKo, type StudioVideoCopy } from "@/messages/studio-video";
import type { StudioCopy } from "./copy";
import type { DockDraft } from "./dock-model";
import { STUDIO_OPEN_REVERSE, announce } from "./seams";
import type { FilmState } from "./use-studio";

/** The order the bar offers them: the remake first. */
const METHODS: readonly StudioRemixMethod[] = ["blueprint", "reference", "edit"];

export interface RemixPanelProps {
  draft: DockDraft;
  film: FilmState | null;
  copy: StudioCopy;
  disabled: boolean;
  /** One calm sentence when the video is outside what the maker accepts (length, size, edit minimum). */
  limit?: string | null;
  /** False when the clip is too short to edit: only a new take is offered. */
  editable?: boolean;
  /** `dict.studioVideo`; without it the panel picks the language of `copy`. */
  videoCopy?: StudioVideoCopy;
  /** The library video in the bar, so the full panel opens on it. */
  videoAssetId?: string | null;
  onChange(patch: Partial<Pick<DockDraft, "method" | "keep" | "change" | "audio">>): void;
}

/** The video screen's copy in the language `copy` is written in (the bar does not always pass it). */
export function videoCopyFor(copy: StudioCopy): StudioVideoCopy {
  return /[가-힣]/.test(copy.remix.title) ? studioVideoKo : studioVideoEn;
}

/**
 * Opens the full reference-video drawer: in place when this page has one (the video screen), otherwise
 * on the video screen of the same organization, with the clip picked.
 */
export function openReversePanel(assetId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  if (document.querySelector("[data-studio-reverse]")) {
    announce(STUDIO_OPEN_REVERSE, assetId ? { assetId } : undefined);
    return;
  }
  const here = new URL(window.location.href);
  const next = new URL("/brand/studio/video", here.origin);
  const organizationId = here.searchParams.get("organizationId");
  if (organizationId) next.searchParams.set("organizationId", organizationId);
  next.searchParams.set("start", "reverse");
  if (assetId) next.searchParams.set("asset", assetId);
  window.location.assign(`${next.pathname}${next.search}`);
}

export function RemixPanel({ draft, film, copy, disabled, limit = null, editable = true, videoCopy, videoAssetId = null, onChange }: RemixPanelProps) {
  const r = copy.remix;
  const v = (videoCopy ?? videoCopyFor(copy)).remix;
  const id = useId();
  // A blueprint is written from the reading: a clip that could not be read cannot be remade from one.
  const unreadable = film?.status === "done" && !film.sheet;
  const label = (method: StudioRemixMethod) => (method === "blueprint" ? v.blueprint : r.methods[method]);
  const hint = draft.method === "blueprint" ? (unreadable ? v.unreadable : v.blueprintHint) : r.methodHints[draft.method];
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
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => openReversePanel(videoAssetId)} data-studio-remix-open-panel>
          {v.openPanel}
        </button>
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
            {METHODS.map((method) => (
              <label key={method} className="bs-seg-option" data-studio-remix-method={method}>
                <input
                  type="radio"
                  name={`${id}-method`}
                  value={method}
                  checked={draft.method === method}
                  disabled={disabled || (method === "edit" && !editable) || (method === "blueprint" && unreadable)}
                  onChange={() => onChange({ method })}
                />
                <span>{label(method)}</span>
              </label>
            ))}
          </div>
          <p className="bs-muted">{hint}</p>
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
