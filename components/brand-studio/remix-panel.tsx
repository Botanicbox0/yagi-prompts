/**
 * The unified reference-video card inside the floating prompt dock (Studio Pro Suite v4):
 *  - AI Director Duration & Multi-Clip Planner banner at the top whenever `@video1` is attached
 *  - Compact 1-row method pill toggle: `레퍼런스 연출 재현 (추천)` · `모션 직접 참조` · `원본 클립 부분 편집`
 *  - Automatic `blueprint` routing for `> 30s` reference videos (up to 600s) with 1-click access to
 *    `ClipTrimModal` (`구간 자르기 (30초 이내)`) when the customer wants to unlock direct reference/edit.
 */
import { useId } from "react";
import { STUDIO_AUDIO_MODES, STUDIO_KEEP_KEYS, STUDIO_LIMITS, type StudioKeepKey, type StudioRemixMethod } from "@/lib/brand-studio/contracts";
import { planMultiClipGeneration } from "@/lib/brand-studio/reference-video";
import { studioVideoEn, studioVideoKo, type StudioVideoCopy } from "@/messages/studio-video";
import { fill, type StudioCopy } from "./copy";
import { activeMultiClipPlan, type DockDraft } from "./dock-model";
import { STUDIO_OPEN_REVERSE, announce } from "./seams";
import type { FilmState } from "./use-studio";
import w from "./video/video-workspace.module.css";

/** The order the bar offers them: blueprint remake first. */
const METHODS: readonly StudioRemixMethod[] = ["blueprint", "reference", "edit"];
const CUSTOM_SINGLE_SECONDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const CUSTOM_MULTI_SECONDS = [
  { total: 20, perClip: 10, clips: 2 },
  { total: 30, perClip: 15, clips: 2 },
  { total: 45, perClip: 15, clips: 3 },
  { total: 60, perClip: 15, clips: 4 },
] as const;

export interface RemixPanelProps {
  draft: DockDraft;
  film: FilmState | null;
  copy: StudioCopy;
  disabled: boolean;
  /** One calm sentence when the video is outside what the model accepts (length, size, edit minimum). */
  limit?: string | null;
  /** False when the clip is too short to edit: only a new take is offered. */
  editable?: boolean;
  /** Measured seconds of `@video1` in the tray (or null when unmeasured). */
  videoSeconds?: number | null;
  /** Raw video input cap of the active video model (`30`s on Seedance 2.5). */
  rawMaxSeconds?: number;
  /** `dict.studioVideo`; without it the panel picks the language of `copy`. */
  videoCopy?: StudioVideoCopy;
  /** The library video in the bar, so the full panel opens on it. */
  videoAssetId?: string | null;
  /** Opens `ClipTrimModal` on `@video1` so trimming to `<= 30s` unlocks direct reference/edit. */
  onTrimVideo?(): void;
  onChange(
    patch: Partial<
      Pick<DockDraft, "method" | "methodPinned" | "keep" | "change" | "audio" | "seconds" | "targetTotalSeconds" | "clipCount">
    >,
  ): void;
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

export function RemixPanel({
  draft,
  film,
  copy,
  disabled,
  limit = null,
  editable = true,
  videoSeconds,
  rawMaxSeconds = 30,
  videoCopy,
  videoAssetId = null,
  onTrimVideo,
  onChange,
}: RemixPanelProps) {
  const r = copy.remix;
  const v = (videoCopy ?? videoCopyFor(copy)).remix;
  const id = useId();

  const filmSheet = film?.status === "done" ? film.sheet : null;
  const measuredSeconds =
    typeof videoSeconds === "number" && Number.isFinite(videoSeconds)
      ? videoSeconds
      : typeof filmSheet?.seconds === "number" && Number.isFinite(filmSheet.seconds)
        ? filmSheet.seconds
        : null;
  const roundedRefSeconds = measuredSeconds !== null ? Math.round(measuredSeconds * 10) / 10 : null;
  const overRawLimit = measuredSeconds !== null && measuredSeconds > rawMaxSeconds;
  const multiActive = (draft.clipCount ?? 1) >= 2 || (typeof draft.targetTotalSeconds === "number" && draft.targetTotalSeconds > 15);

  // A blueprint is written from the reading: a clip that could not be read cannot be remade from one.
  const unreadable = film?.status === "done" && !film.sheet;
  const effectiveMethod: StudioRemixMethod = overRawLimit || multiActive ? "blueprint" : draft.method;

  const label = (method: StudioRemixMethod) => {
    if (method === "blueprint") return v.blueprint;
    if (method === "reference") return v.reference;
    return v.edit;
  };
  // An unread clip greys out both "(추천)" choices (the remake and the 30 s plan): the reason stays visible
  // whichever method is on, and the greyed controls point at it.
  const hint = effectiveMethod === "blueprint" ? (unreadable ? null : v.blueprintHint) : r.methodHints[effectiveMethod];
  const unreadableId = unreadable ? `${id}-unreadable` : undefined;

  const toggleKeep = (key: StudioKeepKey) =>
    onChange({ keep: draft.keep.includes(key) ? draft.keep.filter((k) => k !== key) : [...draft.keep, key] });

  const plan =
    effectiveMethod === "blueprint"
      ? activeMultiClipPlan(
          { ...draft, method: "blueprint" },
          [{ key: "v", kind: "video", name: "v", url: "", thumbUrl: null, seconds: measuredSeconds }],
        )
      : null;

  const plannedTotal =
    plan
      ? plan.clipDurations.reduce((sum, n) => sum + n, 0)
      : draft.targetTotalSeconds ?? draft.seconds;
  const plannedClips = plan?.clipCount ?? (draft.clipCount ?? 1);

  const refSplitTarget = measuredSeconds !== null && measuredSeconds > 30 ? Math.min(60, Math.round(measuredSeconds)) : null;
  const refSplitPlan =
    refSplitTarget !== null
      ? planMultiClipGeneration({ referenceSeconds: measuredSeconds, targetTotalSeconds: refSplitTarget })
      : null;

  const selectDurationPlan = (totalSeconds: number, explicitClips?: number) => {
    if (totalSeconds <= 15 && (explicitClips ?? 1) === 1) {
      onChange({
        seconds: totalSeconds,
        targetTotalSeconds: totalSeconds,
        clipCount: 1,
      });
      return;
    }
    const nextPlan = planMultiClipGeneration({
      referenceSeconds: measuredSeconds,
      targetTotalSeconds: totalSeconds,
      clipCount: explicitClips,
    });
    onChange({
      method: "blueprint",
      methodPinned: true,
      seconds: nextPlan.clipDurations[0] ?? 15,
      targetTotalSeconds: nextPlan.clipDurations.reduce((sum, n) => sum + n, 0),
      clipCount: nextPlan.clipCount,
    });
  };

  const customSelectValue = (() => {
    if (plannedClips === 1 && CUSTOM_SINGLE_SECONDS.includes(plannedTotal as (typeof CUSTOM_SINGLE_SECONDS)[number])) {
      return String(plannedTotal);
    }
    if (CUSTOM_MULTI_SECONDS.some((opt) => opt.total === plannedTotal)) {
      return String(plannedTotal);
    }
    return plannedClips >= 2 ? "30" : String(Math.min(15, Math.max(5, draft.seconds)));
  })();

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

      {/* AI Director Duration & Multi-Clip Planner Banner */}
      {effectiveMethod !== "edit" && (
        <div className={w.directorBanner} data-studio-director-banner>
          <div className={w.directorHead}>
            <span className={w.directorBadge}>{v.director.badge}</span>
          </div>
          <p className={w.directorTitle} data-director-title>
            {roundedRefSeconds !== null
              ? fill(v.director.titleMeasured, { seconds: roundedRefSeconds })
              : v.director.titleUnmeasured}
          </p>
          <p className={w.directorSub}>{v.director.subNote}</p>
          <div className={w.directorChips} role="group" aria-label={v.director.badge}>
            <button
              type="button"
              className={w.directorChip}
              data-director-chip="15"
              data-selected={plannedClips === 1 && plannedTotal === 15 ? "" : undefined}
              aria-pressed={plannedClips === 1 && plannedTotal === 15}
              disabled={disabled}
              onClick={() => selectDurationPlan(15, 1)}
            >
              {v.director.chip15}
            </button>
            <button
              type="button"
              className={w.directorChip}
              data-director-chip="30"
              data-selected={plannedClips === 2 && plannedTotal === 30 ? "" : undefined}
              aria-pressed={plannedClips === 2 && plannedTotal === 30}
              aria-describedby={unreadableId}
              disabled={disabled || unreadable}
              onClick={() => selectDurationPlan(30, 2)}
            >
              {v.director.chip30Recommended}
            </button>
            {refSplitTarget !== null && refSplitPlan && refSplitTarget !== 30 && (
              <button
                type="button"
                className={w.directorChip}
                data-director-chip="ref"
                data-selected={plannedClips === refSplitPlan.clipCount && plannedTotal === refSplitTarget ? "" : undefined}
                aria-pressed={plannedClips === refSplitPlan.clipCount && plannedTotal === refSplitTarget}
                aria-describedby={unreadableId}
                disabled={disabled || unreadable}
                onClick={() => selectDurationPlan(refSplitTarget, refSplitPlan.clipCount)}
              >
                {fill(v.director.chipRefSplit, { seconds: refSplitTarget, clips: refSplitPlan.clipCount })}
              </button>
            )}
            <select
              className={w.directorSelect}
              aria-label={v.director.customLabel}
              data-director-custom
              value={customSelectValue}
              disabled={disabled}
              onChange={(event) => {
                const chosen = Number(event.target.value);
                if (!Number.isFinite(chosen)) return;
                if (chosen <= 15) selectDurationPlan(chosen, 1);
                else selectDurationPlan(chosen);
              }}
            >
              {CUSTOM_SINGLE_SECONDS.map((sec) => (
                <option key={`s-${sec}`} value={sec}>
                  {fill(v.director.customSingle, { seconds: sec })}
                </option>
              ))}
              {CUSTOM_MULTI_SECONDS.map((opt) => (
                <option key={`m-${opt.total}`} value={opt.total} disabled={unreadable}>
                  {fill(v.director.customMulti, { seconds: opt.total, perClip: opt.perClip, clips: opt.clips })}
                </option>
              ))}
            </select>
          </div>
          {plan?.sweetSpotWarning && (
            <p className={w.directorWarn} data-director-sweet-spot>
              {v.director.sweetSpotWarn}
            </p>
          )}
        </div>
      )}

      {overRawLimit && (
        <div className={w.overLimitBar} data-studio-over-limit-note>
          <p>{fill(v.overLimitNote, { max: rawMaxSeconds })}</p>
          {onTrimVideo && (
            <button
              type="button"
              className="bs-btn"
              data-variant="soft"
              data-size="sm"
              disabled={disabled}
              onClick={onTrimVideo}
              data-studio-remix-trim
            >
              {fill(v.trimUnderLimit, { max: rawMaxSeconds })}
            </button>
          )}
        </div>
      )}

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
            {METHODS.map((method) => {
              const methodDisabled =
                disabled ||
                (method === "blueprint" && unreadable) ||
                (method !== "blueprint" && overRawLimit) ||
                (method === "edit" && !editable);
              return (
                <label key={method} className="bs-seg-option" data-studio-remix-method={method}>
                  <input
                    type="radio"
                    name={`${id}-method`}
                    value={method}
                    checked={effectiveMethod === method}
                    disabled={methodDisabled}
                    aria-describedby={method === "blueprint" ? unreadableId : undefined}
                    onChange={() =>
                      onChange({
                        method,
                        methodPinned: true,
                        ...(method !== "blueprint" ? { clipCount: 1, targetTotalSeconds: null } : {}),
                      })
                    }
                  />
                  <span>{label(method)}</span>
                </label>
              );
            })}
          </div>
          {hint && <p className="bs-muted">{hint}</p>}
          {unreadable && (
            <p className="bs-muted" id={unreadableId} data-studio-remix-unreadable>
              {v.unreadable}
            </p>
          )}
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
