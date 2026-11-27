"use client";
/**
 * Dock UI controls for Video Studio modes (slice VM-1).
 * Mounted ONLY when `BRAND_STUDIO_VIDEO_MODES` is open so the closed state renders zero extra nodes or hooks.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { STUDIO_LIMITS, STUDIO_SHOT_LIMITS, STUDIO_UPLOAD_MIMES, type StudioRemixMethod } from "@/lib/brand-studio/contracts";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { fill } from "../copy";
import { openReversePanel } from "../remix-panel";
import {
  VIDEO_MODES_ORDER,
  formatVideoModeTipLines,
  formatVideoWellLimits,
  type PendingVideoMode,
  type VideoModeOptionState,
  type VideoStudioMode,
} from "./video-modes-model";

const VIDEO_FILE_ACCEPT = [...STUDIO_UPLOAD_MIMES.video, ".mp4", ".mov"].join(",");

function modeTitle(mode: VideoStudioMode, copy: StudioVideoModesCopy): string {
  if (mode === "basic") return copy.modes.basic;
  if (mode === "re_architect") return copy.modes.reArchitect;
  return copy.modes.motionTransfer;
}

function modeOneLiner(mode: VideoStudioMode, copy: StudioVideoModesCopy): string {
  if (mode === "basic") return copy.oneLiners.basic;
  if (mode === "re_architect") return copy.oneLiners.reArchitect;
  return copy.oneLiners.motionTransfer;
}

/**
 * Moves keyboard focus across the 3 mode radios (wrapping).
 * Fix items 7 & 9 + Round 2 item 3: arrow keys / Home / End move focus ONLY across all options (including
 * `aria-disabled="true"` options so their reason can be focused and announced via `aria-describedby`).
 * Selection is handled in `onClick` only so Space/Enter rely on native button click activation (no double-select on keyup).
 */
export function nextFocusedVideoMode(
  current: VideoStudioMode,
  step: 1 | -1 | "first" | "last",
): VideoStudioMode {
  if (step === "first") return VIDEO_MODES_ORDER[0]!;
  if (step === "last") return VIDEO_MODES_ORDER[VIDEO_MODES_ORDER.length - 1]!;
  const idx = VIDEO_MODES_ORDER.indexOf(current);
  if (idx < 0) return VIDEO_MODES_ORDER[0]!;
  return VIDEO_MODES_ORDER[(idx + step + VIDEO_MODES_ORDER.length) % VIDEO_MODES_ORDER.length]!;
}

export interface VideoModeBarProps {
  activeMode: VideoStudioMode;
  availability: Record<VideoStudioMode, VideoModeOptionState>;
  model: Pick<StudioVideoModel, "maxReferenceImages" | "minSeconds" | "maxSeconds" | "referenceVideoSeconds">;
  shotLimits?: { secondsMax: number };
  maxClips?: number;
  copy: StudioVideoModesCopy;
  disabled: boolean;
  onSelect(mode: VideoStudioMode): void;
}

export function VideoModeBar({
  activeMode,
  availability,
  model,
  shotLimits = STUDIO_SHOT_LIMITS,
  maxClips,
  copy,
  disabled,
  onSelect,
}: VideoModeBarProps) {
  const baseId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const [focusedMode, setFocusedMode] = useState<VideoStudioMode>(activeMode);
  useEffect(() => {
    setFocusedMode(activeMode);
  }, [activeMode]);

  const selectedLabel = modeTitle(activeMode, copy);
  const tipLines = formatVideoModeTipLines({
    mode: activeMode,
    model,
    shotLimits,
    maxClips,
    copy: copy.tip,
  });
  const disabledNotes = VIDEO_MODES_ORDER.map((m) => availability[m]).filter(
    (opt) => opt.disabled && opt.reason && opt.mode !== activeMode,
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const targetMode = ((event.target as HTMLElement | null)?.getAttribute?.("data-video-mode") ?? focusedMode) as VideoStudioMode;
    let step: 1 | -1 | "first" | "last" | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") step = 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step = -1;
    else if (event.key === "Home") step = "first";
    else if (event.key === "End") step = "last";
    if (step) {
      event.preventDefault();
      const next = nextFocusedVideoMode(targetMode, step);
      setFocusedMode(next);
      const focusNext = () => {
        groupRef.current?.querySelector<HTMLButtonElement>(`[data-video-mode="${next}"]`)?.focus();
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusNext);
      else focusNext();
    }
  };

  return (
    <div className="bs-vmode-bar" data-video-mode-bar>
      <div className="bs-vmode-head">
        <div
          ref={groupRef}
          className="bs-vmode-seg"
          role="radiogroup"
          aria-label={copy.modes.label}
          data-video-mode-switch
          onKeyDown={onKeyDown}
        >
          {VIDEO_MODES_ORDER.map((mode) => {
            const opt = availability[mode];
            const selected = activeMode === mode;
            const optionDisabled = disabled || opt.disabled;
            const reasonId = opt.disabled && opt.reason && !selected ? `${baseId}-reason-${mode}` : undefined;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                className="bs-vmode-option"
                aria-checked={selected}
                aria-disabled={optionDisabled ? "true" : undefined}
                tabIndex={focusedMode === mode ? 0 : -1}
                aria-describedby={reasonId}
                data-video-mode={mode}
                data-selected={selected ? "" : undefined}
                onFocus={() => setFocusedMode(mode)}
                onClick={() => {
                  if (!optionDisabled) onSelect(mode);
                }}
              >
                {modeTitle(mode, copy)}
              </button>
            );
          })}
        </div>
        <span className="bs-tip bs-vmode-tip" data-studio-tip data-video-mode-tip={activeMode}>
          <button
            type="button"
            className="bs-tip-btn"
            aria-label={fill(copy.tip.buttonLabel, { mode: selectedLabel })}
            aria-describedby={`${baseId}-tip`}
          >
            <span aria-hidden="true">!</span>
          </button>
          <span id={`${baseId}-tip`} role="tooltip" className="bs-tip-body bs-vmode-tip-body">
            <span className="bs-vmode-tip-row">
              <strong>{copy.tip.giveLabel}</strong>
              <span>{tipLines.give}</span>
            </span>
            <span className="bs-vmode-tip-row">
              <strong>{copy.tip.keepLabel}</strong>
              <span>{tipLines.keep}</span>
            </span>
            <span className="bs-vmode-tip-row">
              <strong>{copy.tip.getLabel}</strong>
              <span>{tipLines.get}</span>
            </span>
            {activeMode === "motion_transfer" && (
              <>
                <span className="bs-vmode-tip-note">{copy.tip.motionHonestNotes.faceColor}</span>
                <span className="bs-vmode-tip-note">{copy.tip.motionHonestNotes.extraCredits}</span>
              </>
            )}
          </span>
        </span>
        <p className="bs-vmode-oneliner" data-video-mode-oneliner>
          {modeOneLiner(activeMode, copy)}
        </p>
      </div>
      {disabledNotes.length > 0 && (
        <div className="bs-vmode-reasons">
          {disabledNotes.map((opt) => (
            <p
              key={opt.mode}
              id={`${baseId}-reason-${opt.mode}`}
              className="bs-muted bs-vmode-reason"
              data-video-mode-disabled-reason={opt.mode}
            >
              {opt.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export interface VideoModeWellProps {
  mode: PendingVideoMode;
  model: Pick<StudioVideoModel, "referenceVideoSeconds">;
  limits?: { videoBytesMax: number };
  shotLimits?: { secondsMax: number };
  videoMimes?: readonly string[];
  copy: StudioVideoModesCopy["well"];
  dropActive: boolean;
  dropReady: boolean;
  disabled: boolean;
  onFiles(files: File[]): void;
  onBrowse(): void;
}

export function VideoModeWell({
  mode,
  model,
  limits = STUDIO_LIMITS,
  shotLimits = STUDIO_SHOT_LIMITS,
  videoMimes = STUDIO_UPLOAD_MIMES.video,
  copy,
  dropActive,
  dropReady,
  disabled,
  onFiles,
  onBrowse,
}: VideoModeWellProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const limitLine = formatVideoWellLimits({ mode, model, limits, shotLimits, videoMimes, copy });

  return (
    <section
      className="bs-vmode-well"
      data-video-mode-well={mode}
      data-drop-target={dropActive ? "" : undefined}
      data-drop-ready={dropReady && !dropActive ? "" : undefined}
      aria-label={copy.title}
    >
      <input
        ref={fileRef}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        className="bs-sr"
        tabIndex={-1}
        aria-hidden="true"
        data-video-well-file-input
        onChange={(event) => {
          const picked = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = "";
          if (picked.length > 0) onFiles(picked);
        }}
      />
      <div className="bs-vmode-well-copy">
        <p className="bs-vmode-well-title">{dropActive ? copy.dropNow : copy.title}</p>
        <p className="bs-vmode-well-limits bs-num" data-video-well-limits>
          {limitLine}
        </p>
      </div>
      <div className="bs-vmode-well-actions">
        <button
          type="button"
          className="bs-btn"
          data-variant="soft"
          data-size="sm"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          data-video-well-pick-file
        >
          {copy.pickFile}
        </button>
        <button
          type="button"
          className="bs-btn"
          data-variant="soft"
          data-size="sm"
          disabled={disabled}
          onClick={onBrowse}
          data-video-well-pick-library
        >
          {copy.pickLibrary}
        </button>
        {mode === "re_architect" && (
          <button
            type="button"
            className="bs-btn"
            data-variant="ghost"
            data-size="sm"
            disabled={disabled}
            onClick={() => openReversePanel(null)}
            data-video-well-open-reverse
          >
            {copy.openReverse}
          </button>
        )}
      </div>
    </section>
  );
}

export function VideoModeEditToggle({
  effectiveMethod,
  copy,
  disabled,
  onToggle,
}: {
  effectiveMethod: StudioRemixMethod;
  copy: StudioVideoModesCopy["status"];
  disabled: boolean;
  onToggle(nextMethod: "edit" | "reference"): void;
}) {
  const isEdit = effectiveMethod === "edit";
  return (
    <div className="bs-vmode-edit-row" data-video-mode-edit-row>
      <button
        type="button"
        className="bs-btn bs-vmode-edit-btn"
        data-variant="ghost"
        data-size="sm"
        disabled={disabled}
        onClick={() => onToggle(isEdit ? "reference" : "edit")}
        data-video-mode-edit-toggle={isEdit ? "back" : "edit"}
      >
        {isEdit ? copy.backToReference : copy.switchToEdit}
      </button>
    </div>
  );
}

export function VideoModeUndoLine({
  copy,
  onUndo,
}: {
  copy: StudioVideoModesCopy["status"];
  onUndo(): void;
}) {
  return (
    <p className="bs-dock-note bs-vmode-undo" role="status" data-video-mode-undo>
      <span>{copy.videoRemoved}</span>
      <button type="button" className="bs-link-btn" onClick={onUndo} data-video-mode-undo-btn>
        {copy.undo}
      </button>
    </p>
  );
}
