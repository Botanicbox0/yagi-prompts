"use client";
/**
 * Dock UI controls for Video Studio modes (slice VM-2 Batch A + Fix Round 1):
 *  - `VideoModeMenu`: `[모드 ▾]` listbox as the FIRST control in `.bs-controls-set` (before ModelMenu)
 *  - `VideoModeInfoPopover`: `(i)` click/keyboard popover directly after `[모드 ▾]`, holding the drawn visual + 3 lines
 *  - `VideoLengthChip` / `VideoSoundChip`: settings-row chips for video modes sharing the EXACT same popovers as `VideoConfirmCard` (W2)
 *  - `VideoTrayNeedVideo`: compact 1-line pending-video row inside `.bs-tray-list`
 *  - `VideoConfirmCard`: compact inline confirm card above `.bs-controls` with full-row pressable lines & focused popovers (W3/W4/W6)
 *  - `VideoModeUndoLine`: quiet Rule 6 undo line when 기본 removed a reference video
 *
 * Mounted ONLY when `BRAND_STUDIO_VIDEO_MODES` is open so closed organizations render zero extra nodes or hooks.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  STUDIO_AUDIO_MODES,
  STUDIO_LIMITS,
  STUDIO_SHOT_LIMITS,
  STUDIO_UPLOAD_MIMES,
  type StudioAudioMode,
  type StudioVideoUnderstandKind,
  type VideoUnderstandQuestion,
  type VideoUnderstandSwap,
} from "@/lib/brand-studio/contracts";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { virtualMentionTag } from "../at-mention-menu";
import { fill, type StudioCopy } from "../copy";
import { activeMultiClipPlan, type DockDraft } from "../dock-model";
import { focusOption, moveFocus, useDismiss } from "../gallery/menu";
import { StudioIcon } from "../icons";
import { trayNumbers, trayThumbSrc, type TrayItem } from "../refs";
import { RoleChips } from "../role-chips";
import { MotionTransferPicture, ReArchitectPicture } from "./mode-explainer";
import {
  VIDEO_MODES_ORDER,
  applyCardLengthPlan,
  formatVideoModeTipLines,
  formatVideoWellLimits,
  multiLengthChoices,
  sanitizeClientUnderstandSwaps,
  singleLengthChoices,
  stripClientCreditFigures,
  stripClientCreditOnly,
  type PendingVideoMode,
  type VideoModeOptionState,
  type VideoStudioMode,
} from "./video-modes-model";

const VIDEO_FILE_ACCEPT = [...STUDIO_UPLOAD_MIMES.video, ".mp4", ".mov"].join(",");

function scheduleFocus(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else fn();
}

export function modeTitle(mode: VideoStudioMode, copy: StudioVideoModesCopy): string {
  if (mode === "basic") return copy.modes.basic;
  if (mode === "re_architect") return copy.modes.reArchitect;
  return copy.modes.motionTransfer;
}

export function modeOneLiner(mode: VideoStudioMode, copy: StudioVideoModesCopy): string {
  if (mode === "basic") return copy.oneLiners.basic;
  if (mode === "re_architect") return copy.oneLiners.reArchitect;
  return copy.oneLiners.motionTransfer;
}

/** Formats the active length plan from the single draft source of truth (shared by settings chip & confirm card). */
export function formatLengthSummary(args: {
  mode: PendingVideoMode;
  draft: DockDraft;
  tray: readonly TrayItem[];
  copy: StudioVideoModesCopy["card"];
  compactChip?: boolean;
  secondsValueTemplate?: string;
}): { summary: string; plannedClips: number; plannedTotal: number } {
  const { mode, draft, tray, copy, compactChip = false, secondsValueTemplate } = args;
  const plan = mode === "re_architect" ? activeMultiClipPlan({ ...draft, method: "blueprint" }, tray) : null;
  const plannedClips = plan?.clipCount ?? (draft.clipCount ?? 1);
  const plannedTotal = plan
    ? plan.clipDurations.reduce((sum, n) => sum + n, 0)
    : (draft.targetTotalSeconds ?? draft.seconds);
  if (plannedClips >= 2) {
    return {
      summary: fill(copy.lengthMulti, { total: plannedTotal, clips: plannedClips }),
      plannedClips,
      plannedTotal,
    };
  }
  const summary =
    compactChip && secondsValueTemplate
      ? fill(secondsValueTemplate, { n: draft.seconds })
      : fill(copy.lengthSingle, { seconds: draft.seconds });
  return { summary, plannedClips: 1, plannedTotal: draft.seconds };
}

/* ---------------------------------------------------------- Shared Length & Sound Popover Bodies (W2) */

function VideoLengthOptions({
  mode,
  draft,
  model,
  plannedClips,
  plannedTotal,
  videoSeconds,
  copy,
  onDraft,
}: {
  mode: PendingVideoMode;
  draft: DockDraft;
  model: Pick<StudioVideoModel, "minSeconds" | "maxSeconds" | "defaultSeconds">;
  plannedClips: number;
  plannedTotal: number;
  videoSeconds: number | null;
  copy: StudioVideoModesCopy["card"];
  onDraft(next: DockDraft): void;
}) {
  const singles = singleLengthChoices(model, draft.seconds);
  const multis = mode === "re_architect" ? multiLengthChoices(model) : [];
  return (
    <div className="bs-keep" role="group" aria-label={copy.length} data-video-length-options>
      {singles.map((sec) => {
        const selected = plannedClips === 1 && draft.seconds === sec;
        return (
          <button
            key={`s-${sec}`}
            type="button"
            className="bs-chip bs-num"
            data-size="sm"
            data-length-option={`1x${sec}`}
            data-selected={selected ? "" : undefined}
            aria-pressed={selected}
            onClick={() => onDraft(applyCardLengthPlan(draft, sec, 1, videoSeconds, model))}
          >
            {fill(copy.lengthSingle, { seconds: sec })}
          </button>
        );
      })}
      {multis.map((opt) => {
        const selected = plannedClips === opt.clips && plannedTotal === opt.total;
        return (
          <button
            key={`m-${opt.total}`}
            type="button"
            className="bs-chip bs-num"
            data-size="sm"
            data-length-option={`${opt.clips}x${opt.total}`}
            data-selected={selected ? "" : undefined}
            aria-pressed={selected}
            onClick={() => onDraft(applyCardLengthPlan(draft, opt.total, opt.clips, videoSeconds, model))}
          >
            {fill(copy.lengthMulti, { total: opt.total, clips: opt.clips })}
          </button>
        );
      })}
    </div>
  );
}

function VideoSoundOptions({
  id,
  draft,
  copy,
  label,
  onDraft,
}: {
  id: string;
  draft: DockDraft;
  copy: StudioCopy;
  label: string;
  onDraft(next: DockDraft): void;
}) {
  return (
    <div className="bs-seg" role="radiogroup" aria-label={label} data-video-sound-options>
      {STUDIO_AUDIO_MODES.map((audioMode: StudioAudioMode) => (
        <label key={audioMode} className="bs-seg-option" data-confirm-sound-option={audioMode}>
          <input
            type="radio"
            name={`${id}-sound-mode`}
            value={audioMode}
            checked={draft.audio === audioMode}
            onChange={() => onDraft({ ...draft, audio: audioMode })}
          />
          <span>{copy.sound[audioMode]}</span>
        </label>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- Settings-row Length & Sound Chips (W2) */

export function VideoLengthChip({
  mode,
  draft,
  tray,
  model,
  copy,
  modesCopy,
  videoSeconds,
  disabled,
  onDraft,
}: {
  mode: PendingVideoMode;
  draft: DockDraft;
  tray: readonly TrayItem[];
  model: Pick<StudioVideoModel, "minSeconds" | "maxSeconds" | "defaultSeconds">;
  copy: StudioCopy;
  modesCopy: StudioVideoModesCopy;
  videoSeconds: number | null;
  disabled: boolean;
  onDraft(next: DockDraft): void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const c = modesCopy.card;
  const { summary, plannedClips, plannedTotal } = formatLengthSummary({
    mode,
    draft,
    tray,
    copy: c,
    compactChip: true,
    secondsValueTemplate: copy.dock.secondsValue,
  });

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) scheduleFocus(() => btnRef.current?.focus({ preventScroll: true }));
  };

  return (
    <span className="bs-model bs-pick" data-control="seconds" data-mono="">
      <button
        ref={btnRef}
        type="button"
        className="bs-chip-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${copy.dock.seconds}: ${summary}`}
        disabled={disabled}
        data-video-length-chip
        onClick={() => setOpen((cur) => !cur)}
      >
        <span className="bs-chip-value">{summary}</span>
        <StudioIcon name="chevron" />
      </button>
      {open && (
        <ConfirmLinePopover id={popId} label={c.length} doneLabel={c.done} onClose={close}>
          <VideoLengthOptions
            mode={mode}
            draft={draft}
            model={model}
            plannedClips={plannedClips}
            plannedTotal={plannedTotal}
            videoSeconds={videoSeconds}
            copy={c}
            onDraft={onDraft}
          />
        </ConfirmLinePopover>
      )}
    </span>
  );
}

export function VideoSoundChip({
  draft,
  copy,
  modesCopy,
  disabled,
  onDraft,
}: {
  draft: DockDraft;
  copy: StudioCopy;
  modesCopy: StudioVideoModesCopy;
  disabled: boolean;
  onDraft(next: DockDraft): void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const c = modesCopy.card;
  const summary = copy.sound[draft.audio];

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) scheduleFocus(() => btnRef.current?.focus({ preventScroll: true }));
  };

  return (
    <span className="bs-model bs-pick" data-control="sound">
      <button
        ref={btnRef}
        type="button"
        className="bs-chip-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${copy.dock.sound}: ${summary}`}
        disabled={disabled}
        data-video-sound-chip
        onClick={() => setOpen((cur) => !cur)}
      >
        <span className="bs-chip-value">{summary}</span>
        <StudioIcon name="chevron" />
      </button>
      {open && (
        <ConfirmLinePopover id={popId} label={c.sound} doneLabel={c.done} onClose={close}>
          <VideoSoundOptions id={popId} draft={draft} copy={copy} label={c.sound} onDraft={onDraft} />
        </ConfirmLinePopover>
      )}
    </span>
  );
}

/* ---------------------------------------------------------- [모드 ▾] listbox */

export interface VideoModeMenuProps {
  activeMode: VideoStudioMode;
  availability: Record<VideoStudioMode, VideoModeOptionState>;
  copy: StudioVideoModesCopy;
  disabled: boolean;
  initialOpen?: boolean;
  onSelect(mode: VideoStudioMode): void;
}

export function VideoModeMenu({
  activeMode,
  availability,
  copy,
  disabled,
  initialOpen = false,
  onSelect,
}: VideoModeMenuProps) {
  const [open, setOpen] = useState(initialOpen);
  const chip = useRef<HTMLButtonElement>(null);
  const id = useId();
  const currentLabel = modeTitle(activeMode, copy);

  const close = (refocus = true) => {
    setOpen(false);
    if (!refocus) return;
    scheduleFocus(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        chip.current?.focus({ preventScroll: true });
      }
    });
  };

  return (
    <span
      className="bs-model bs-pick bs-vmode-menu-wrap"
      data-control="mode"
      data-video-mode-switch
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
          close(false);
        }
      }}
    >
      <button
        ref={chip}
        type="button"
        className="bs-chip-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${copy.mode.label}: ${currentLabel}`}
        disabled={disabled}
        data-video-mode-trigger
        onClick={() => setOpen((cur) => !cur)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="bs-chip-value">{currentLabel}</span>
        <StudioIcon name="chevron" />
      </button>
      {open && (
        <VideoModeList
          id={`${id}-list`}
          activeMode={activeMode}
          availability={availability}
          copy={copy}
          onPick={(next) => {
            if (!availability[next].disabled) {
              onSelect(next);
              close();
            }
          }}
          onClose={close}
        />
      )}
    </span>
  );
}

function VideoModeList({
  id,
  activeMode,
  availability,
  copy,
  onPick,
  onClose,
}: {
  id: string;
  activeMode: VideoStudioMode;
  availability: Record<VideoStudioMode, VideoModeOptionState>;
  copy: StudioVideoModesCopy;
  onPick(mode: VideoStudioMode): void;
  onClose(): void;
}) {
  const box = useDismiss(onClose);
  useEffect(() => {
    focusOption(
      box.current,
      box.current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
        box.current?.querySelector<HTMLElement>('[role="option"]'),
    );
  }, [box]);

  return (
    <div ref={box} className="bs-menu bs-pick-list bs-vmode-list" data-studio-pick-list="mode">
      <div
        id={id}
        role="listbox"
        aria-label={copy.modes.label}
        onKeyDown={(event) => moveFocus(event, '[role="option"]')}
      >
        {VIDEO_MODES_ORDER.map((mode) => {
          const opt = availability[mode];
          const selected = mode === activeMode;
          const reasonId = opt.disabled && opt.reason ? `${id}-reason-${mode}` : undefined;
          return (
            <button
              key={mode}
              type="button"
              role="option"
              className="bs-vmode-list-item"
              aria-selected={selected}
              aria-disabled={opt.disabled ? "true" : undefined}
              aria-describedby={reasonId}
              data-video-mode={mode}
              data-selected={selected ? "" : undefined}
              onClick={() => {
                if (!opt.disabled) onPick(mode);
              }}
            >
              <span className="bs-vmode-list-copy">
                <span className="bs-vmode-list-title">{modeTitle(mode, copy)}</span>
                <span className="bs-vmode-list-desc">{modeOneLiner(mode, copy)}</span>
                {opt.disabled && opt.reason && (
                  <span id={reasonId} className="bs-vmode-list-reason" data-video-mode-disabled-reason={mode}>
                    {opt.reason}
                  </span>
                )}
              </span>
              {selected && <StudioIcon name="check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- (i) info popover */

export interface VideoModeInfoPopoverProps {
  activeMode: VideoStudioMode;
  model: Pick<StudioVideoModel, "maxReferenceImages" | "minSeconds" | "maxSeconds" | "referenceVideoSeconds">;
  shotLimits?: { secondsMax: number };
  maxClips?: number;
  copy: StudioVideoModesCopy;
  initialOpen?: boolean;
}

export function VideoModeInfoPopover({
  activeMode,
  model,
  shotLimits = STUDIO_SHOT_LIMITS,
  maxClips,
  copy,
  initialOpen = false,
}: VideoModeInfoPopoverProps) {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const label = modeTitle(activeMode, copy);
  const lines = formatVideoModeTipLines({
    mode: activeMode,
    model,
    shotLimits,
    maxClips,
    copy: copy.tip,
  });

  const close = (refocus = true) => {
    setOpen(false);
    if (!refocus) return;
    scheduleFocus(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  return (
    <span className="bs-vmode-info" data-video-mode-info={activeMode}>
      <button
        ref={triggerRef}
        type="button"
        className="bs-vmode-info-btn"
        aria-label={fill(copy.mode.infoLabel, { mode: label })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-video-mode-info-trigger
        onClick={() => setOpen((cur) => !cur)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <VideoModeInfoDialog
          id={popId}
          activeMode={activeMode}
          label={label}
          lines={lines}
          copy={copy}
          onClose={close}
        />
      )}
    </span>
  );
}

function VideoModeInfoDialog({
  id,
  activeMode,
  label,
  lines,
  copy,
  onClose,
}: {
  id: string;
  activeMode: VideoStudioMode;
  label: string;
  lines: { give: string; keep: string; get: string };
  copy: StudioVideoModesCopy;
  onClose(refocus?: boolean): void;
}) {
  const box = useDismiss(() => onClose(false));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={box}
      id={id}
      role="dialog"
      aria-label={fill(copy.explainer.label, { mode: label })}
      className="bs-vmode-info-pop"
      data-video-mode-info-popover={activeMode}
    >
      <div className="bs-vmode-info-head">
        <strong className="bs-vmode-info-title">{label}</strong>
        <span className="bs-vmode-info-one">{modeOneLiner(activeMode, copy)}</span>
      </div>
      {activeMode === "re_architect" && <ReArchitectPicture copy={copy.explainer.reArchitect} />}
      {activeMode === "motion_transfer" && <MotionTransferPicture copy={copy.explainer.motionTransfer} />}
      <ul className="bs-vmode-info-lines">
        <li>
          <strong>{copy.tip.giveLabel}</strong>
          <span>{lines.give}</span>
        </li>
        <li>
          <strong>{copy.tip.keepLabel}</strong>
          <span>{lines.keep}</span>
        </li>
        <li>
          <strong>{copy.tip.getLabel}</strong>
          <span>{lines.get}</span>
        </li>
      </ul>
      {activeMode === "motion_transfer" && (
        <ul className="bs-vmode-info-notes" data-video-mode-honest-notes>
          <li>{copy.tip.motionHonestNotes.faceColor}</li>
          <li>{copy.tip.motionHonestNotes.extraCredits}</li>
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- Compact 1-line tray prompt */

export interface VideoTrayNeedVideoProps {
  mode: PendingVideoMode;
  model: Pick<StudioVideoModel, "referenceVideoSeconds">;
  limits?: { videoBytesMax: number };
  shotLimits?: { secondsMax: number };
  videoMimes?: readonly string[];
  copy: StudioVideoModesCopy;
  dropActive: boolean;
  disabled: boolean;
  onFiles(files: File[]): void;
  onBrowse(): void;
}

export function VideoTrayNeedVideo({
  mode,
  model,
  limits = STUDIO_LIMITS,
  shotLimits = STUDIO_SHOT_LIMITS,
  videoMimes = STUDIO_UPLOAD_MIMES.video,
  copy,
  dropActive,
  disabled,
  onFiles,
  onBrowse,
}: VideoTrayNeedVideoProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const limitLine = formatVideoWellLimits({ mode, model, limits, shotLimits, videoMimes, copy: copy.well });

  return (
    <li className="bs-vmode-tray-need" data-video-mode-tray-need={mode}>
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
      <span className="bs-vmode-tray-need-text">
        <span className="bs-vmode-tray-need-title">{dropActive ? copy.well.dropNow : copy.tray.needVideo}</span>
        <span className="bs-vmode-tray-need-limits bs-num" data-video-well-limits>
          {limitLine}
        </span>
      </span>
      <span className="bs-vmode-tray-need-actions">
        <button
          type="button"
          className="bs-link-btn bs-vmode-tray-btn"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          data-video-well-pick-file
        >
          {copy.well.pickFile}
        </button>
        <button
          type="button"
          className="bs-link-btn bs-vmode-tray-btn"
          disabled={disabled}
          onClick={onBrowse}
          data-video-well-pick-library
        >
          {copy.well.pickLibrary}
        </button>
      </span>
    </li>
  );
}

/* ---------------------------------------------------------- Compact Inline Confirm Card (W3/W4/W6) */

type ConfirmPopoverKey = "change" | "length" | "sound";

export interface VideoConfirmUnderstandView {
  kind: StudioVideoUnderstandKind | null;
  reply: string | null;
  swaps?: readonly VideoUnderstandSwap[];
  question: VideoUnderstandQuestion | null;
  readyToMake: boolean;
  failed: boolean;
  timedOut: boolean;
  stale: boolean;
  checking: boolean;
}

export interface VideoConfirmCardProps {
  mode: PendingVideoMode;
  draft: DockDraft;
  tray: readonly TrayItem[];
  model: Pick<StudioVideoModel, "minSeconds" | "maxSeconds" | "defaultSeconds">;
  copy: StudioCopy;
  modesCopy: StudioVideoModesCopy;
  cost: string;
  busy: boolean;
  disabled: boolean;
  videoSeconds: number | null;
  initialOpenLine?: ConfirmPopoverKey | null;
  shotsNotCarried?: boolean;
  understand?: VideoConfirmUnderstandView | null;
  onDraft(next: DockDraft): void;
  onTrayUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onEditWords(): void;
  onMake(): void;
  onClose(): void;
  onPickOption?(index: number): void;
  onRetryUnderstand?(): void;
}

export function VideoConfirmCard({
  mode,
  draft,
  tray,
  model,
  copy,
  modesCopy,
  cost,
  busy,
  disabled,
  videoSeconds,
  initialOpenLine = null,
  shotsNotCarried = false,
  understand = null,
  onDraft,
  onTrayUpdate,
  onEditWords,
  onMake,
  onClose,
  onPickOption,
  onRetryUnderstand,
}: VideoConfirmCardProps) {
  const [openLine, setOpenLine] = useState<ConfirmPopoverKey | null>(initialOpenLine);
  const lineRefs = useRef<Partial<Record<ConfirmPopoverKey, HTMLButtonElement | null>>>({});
  const c = modesCopy.card;
  const id = useId();
  const numbers = trayNumbers(tray);

  const closeLine = (key: ConfirmPopoverKey, refocus = false) => {
    setOpenLine(null);
    if (refocus) {
      scheduleFocus(() => lineRefs.current[key]?.focus({ preventScroll: true }));
    }
  };

  // Roles and use/avoid notes apply to attached IMAGES only (never audio).
  const imageRefs = tray
    .map((item, idx) => ({ item, num: numbers[idx] ?? 1, tag: virtualMentionTag(item.kind, numbers[idx] ?? 1) }))
    .filter(({ item }) => item.kind === "image");
  const imageByIndex = new Map<number, TrayItem>(imageRefs.map(({ item, num }) => [num, item]));

  // `따라갈 것` is fixed and truthful per mode (not editable: compiler ignores `draft.keep`).
  const followSentence = mode === "re_architect" ? c.followReArchitect : c.followMotionTransfer;

  // W1 + W7: Sanitize card swaps against `STUDIO_ASSET_ROLES`, tray membership, and field limits BEFORE drawing,
  // then merge any attached picture with a hand-set role that the card did not mention so EVERY picture with a part
  // is shown in the summary line (ordered by per-kind image index).
  const safeUnderstandSwaps = sanitizeClientUnderstandSwaps(understand?.swaps ?? [], tray);
  const understandSwaps = safeUnderstandSwaps
    .map((swap) => {
      const img = imageByIndex.get(swap.refIndex);
      if (!img) return null;
      return { key: `${img.key}-${swap.refIndex}`, refIndex: swap.refIndex, noun: swap.label, img };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const seenSwapIndices = new Set(understandSwaps.map((s) => s.refIndex));
  const handRoleSwaps = imageRefs
    .filter(({ item, num }) => Boolean(item.role) && !seenSwapIndices.has(num))
    .map(({ item, num }) => ({
      key: item.key,
      refIndex: num,
      noun: copy.roles[item.role!],
      img: item,
    }));

  const visualSwaps = [...understandSwaps, ...handRoleSwaps].sort((a, b) => a.refIndex - b.refIndex);
  const changeNoteText = stripClientCreditOnly(draft.change).trim();
  const hasPromptText = draft.prompt.trim().length > 0;
  // W6: When nothing stands and the prompt box is empty (e.g. after full withdraw), show the input placeholder instead of `설명한 내용을 반영해요`.
  const emptyChangeLine = hasPromptText ? c.changeEmpty : c.changeNeedInput;

  // W3 + W4: Drop whole sentences containing credit figures; if reply becomes empty, fall back to the card's own summary line.
  const displayQuestionText = understand?.question ? stripClientCreditFigures(understand.question.text) : "";
  const rawStrippedReply = understand?.reply ? stripClientCreditFigures(understand.reply) : "";
  const replyFallbackSummary = changeNoteText || visualSwaps.map((s) => s.noun).join(", ").trim() || displayQuestionText;
  const displayReply = rawStrippedReply || (understand?.reply ? replyFallbackSummary : "");
  const showQuestionHeading = Boolean(displayQuestionText) && displayQuestionText !== displayReply;
  const displayQuestionOptions = (understand?.question?.options ?? [])
    .map((opt, idx) => ({
      idx,
      label: stripClientCreditFigures(opt.label),
      img: typeof opt.refIndex === "number" ? (imageByIndex.get(opt.refIndex) ?? null) : null,
    }))
    .filter((opt) => opt.label.length > 0);

  const { summary: lengthSummary, plannedClips, plannedTotal } = formatLengthSummary({
    mode,
    draft,
    tray,
    copy: c,
  });
  const soundSummary = copy.sound[draft.audio];
  const canShowMake = understand ? understand.readyToMake && !understand.failed && !understand.stale : true;

  return (
    <section className="bs-vmode-card" aria-label={c.title} data-video-confirm-card={mode}>
      {/* W6: Title at the TOP of the card, reply directly under it, then rows, then the two buttons. */}
      <div className="bs-vmode-card-head">
        <h3 className="bs-vmode-card-title">{understand?.checking ? modesCopy.cta.checking : c.title}</h3>
        <button
          type="button"
          className="bs-btn bs-icon-btn bs-vmode-card-close-btn"
          data-variant="ghost"
          data-size="sm"
          aria-label={c.close}
          onClick={onClose}
          data-confirm-close
        >
          <StudioIcon name="close" />
        </button>
      </div>
      {shotsNotCarried && (
        <p className="bs-vmode-card-note" role="status" data-confirm-shots-note>
          {c.shotsNotCarried}
        </p>
      )}
      {understand?.failed && (
        <div className="bs-vmode-card-reply bs-vmode-card-failed" role="status" data-confirm-failed>
          <span>{understand.timedOut ? c.timeoutNote : c.understandFailed}</span>
          {onRetryUnderstand && (
            <button
              type="button"
              className="bs-link-btn bs-vmode-retry-btn"
              disabled={busy || understand.checking}
              onClick={onRetryUnderstand}
              data-confirm-retry
            >
              {c.retryUnderstand}
            </button>
          )}
        </div>
      )}
      {understand && !understand.failed && displayReply && (
        <CardReply text={displayReply} moreLabel={c.replyMore} lessLabel={c.replyLess} />
      )}
      {understand && !understand.failed && (showQuestionHeading || displayQuestionOptions.length > 0) && (
        <div className="bs-vmode-card-question" data-confirm-question>
          {showQuestionHeading && <p className="bs-vmode-card-qtext">{displayQuestionText}</p>}
          {displayQuestionOptions.length > 0 && (
            <div className="bs-vmode-card-qopts" role="group" aria-label={displayQuestionText || c.questionLabel}>
              {displayQuestionOptions.map((opt) => (
                <button
                  key={`${opt.label}-${opt.idx}`}
                  type="button"
                  className="bs-chip bs-vmode-card-qopt"
                  data-size="sm"
                  data-has-thumb={opt.img ? "" : undefined}
                  disabled={busy || understand.checking}
                  data-confirm-option={opt.idx}
                  onClick={() => onPickOption?.(opt.idx)}
                >
                  {opt.img && (
                    <img
                      className="bs-vmode-card-thumb"
                      src={trayThumbSrc(opt.img)}
                      width={28}
                      height={28}
                      alt=""
                      decoding="sync"
                      draggable={false}
                      data-confirm-option-thumb={opt.idx}
                    />
                  )}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {understand?.stale && !understand.failed && (
        <div className="bs-vmode-card-note" role="status" data-confirm-stale>
          <span>{c.staleNote}</span>
          {onRetryUnderstand && (
            <button
              type="button"
              className="bs-link-btn bs-vmode-retry-btn"
              disabled={busy || understand.checking}
              onClick={onRetryUnderstand}
              data-confirm-recheck
            >
              {modesCopy.cta.reviewAgain}
            </button>
          )}
        </div>
      )}
      {!understand?.failed && (
        <div className="bs-vmode-card-rows" data-confirm-compact-rows>
        <div className="bs-vmode-card-row bs-vmode-card-row-static" data-confirm-row="keep">
          <span className="bs-vmode-card-label">{c.keep}</span>
          <span className="bs-vmode-card-val bs-vmode-card-static" data-confirm-follow-line>
            {followSentence}
          </span>
        </div>

        <div className="bs-vmode-card-row" data-confirm-row="change">
          <button
            ref={(el) => {
              lineRefs.current.change = el;
            }}
            type="button"
            className="bs-vmode-card-row-btn"
            aria-expanded={openLine === "change"}
            aria-label={fill(c.editLine, { field: c.change })}
            data-confirm-line-btn="change"
            onClick={() => setOpenLine((cur) => (cur === "change" ? null : "change"))}
          >
            <span className="bs-vmode-card-label">{c.change}</span>
            <span className="bs-vmode-card-val">
              {visualSwaps.length > 0 ? (
                <span className="bs-vmode-card-swaps" data-confirm-swaps>
                  {visualSwaps.map((s) => (
                    <span key={s.key} className="bs-vmode-card-swap" data-confirm-swap={s.refIndex}>
                      <span>{s.noun}</span>
                      <span aria-hidden="true">→</span>
                      <img
                        className="bs-vmode-card-thumb"
                        src={trayThumbSrc(s.img)}
                        width={28}
                        height={28}
                        alt=""
                        decoding="sync"
                        draggable={false}
                      />
                    </span>
                  ))}
                  {understandSwaps.length === 0 && changeNoteText ? <span>{changeNoteText}</span> : null}
                </span>
              ) : (
                changeNoteText || emptyChangeLine
              )}
            </span>
            <StudioIcon name="chevron" />
          </button>
          {openLine === "change" && (
            <ConfirmLinePopover
              label={c.change}
              doneLabel={c.done}
              onClose={(refocus) => closeLine("change", refocus)}
            >
              {imageRefs.length > 0 ? (
                <div className="bs-vmode-card-refs">
                  {imageRefs.map(({ item, tag }) => {
                    const useIdStr = `${id}-use-${item.key}`;
                    const avoidIdStr = `${id}-avoid-${item.key}`;
                    return (
                      <div key={item.key} className="bs-vmode-card-ref-item" data-confirm-ref-key={item.key}>
                        <span id={`${id}-ref-${item.key}`} className="bs-vmode-card-ref-tag bs-num">
                          {tag}
                        </span>
                        <RoleChips
                          value={item.role ?? ""}
                          onChange={(role) => onTrayUpdate(item.key, { role: role || undefined })}
                          noneLabel={copy.tray.roleNone}
                          roleLabels={copy.roles}
                          labelledBy={`${id}-ref-${item.key}`}
                        />
                        <div className="bs-vmode-card-ref-notes">
                          <div className="bs-vmode-card-ref-field">
                            <label htmlFor={useIdStr} className="bs-vmode-card-ref-label">
                              {c.refUseLabel}
                            </label>
                            <input
                              id={useIdStr}
                              type="text"
                              className="bs-field"
                              value={item.use ?? ""}
                              maxLength={STUDIO_LIMITS.noteMax}
                              placeholder={copy.tray.usePlaceholder}
                              data-confirm-ref-use={item.key}
                              onChange={(event) => onTrayUpdate(item.key, { use: event.target.value })}
                            />
                          </div>
                          <div className="bs-vmode-card-ref-field">
                            <label htmlFor={avoidIdStr} className="bs-vmode-card-ref-label">
                              {c.refAvoidLabel}
                            </label>
                            <input
                              id={avoidIdStr}
                              type="text"
                              className="bs-field"
                              value={item.avoid ?? ""}
                              maxLength={STUDIO_LIMITS.noteMax}
                              placeholder={copy.tray.avoidPlaceholder}
                              data-confirm-ref-avoid={item.key}
                              onChange={(event) => onTrayUpdate(item.key, { avoid: event.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="bs-muted">{c.noRefs}</p>
              )}
              <div className="bs-vmode-card-ref-field">
                <label htmlFor={`${id}-change-text`} className="bs-vmode-card-ref-label">
                  {c.changeFieldLabel}
                </label>
                <input
                  id={`${id}-change-text`}
                  type="text"
                  className="bs-field"
                  value={draft.change}
                  maxLength={STUDIO_LIMITS.promptMax}
                  placeholder={c.changePlaceholder}
                  data-confirm-change-input
                  onChange={(event) => onDraft({ ...draft, change: event.target.value })}
                />
              </div>
            </ConfirmLinePopover>
          )}
        </div>

        <div className="bs-vmode-card-row" data-confirm-row="length">
          <button
            ref={(el) => {
              lineRefs.current.length = el;
            }}
            type="button"
            className="bs-vmode-card-row-btn"
            aria-expanded={openLine === "length"}
            aria-label={fill(c.editLine, { field: c.length })}
            data-confirm-line-btn="length"
            onClick={() => setOpenLine((cur) => (cur === "length" ? null : "length"))}
          >
            <span className="bs-vmode-card-label">{c.length}</span>
            <span className="bs-vmode-card-val bs-num">{lengthSummary}</span>
            <StudioIcon name="chevron" />
          </button>
          {openLine === "length" && (
            <ConfirmLinePopover
              label={c.length}
              doneLabel={c.done}
              onClose={(refocus) => closeLine("length", refocus)}
            >
              <VideoLengthOptions
                mode={mode}
                draft={draft}
                model={model}
                plannedClips={plannedClips}
                plannedTotal={plannedTotal}
                videoSeconds={videoSeconds}
                copy={c}
                onDraft={onDraft}
              />
            </ConfirmLinePopover>
          )}
        </div>

        <div className="bs-vmode-card-row" data-confirm-row="sound">
          <button
            ref={(el) => {
              lineRefs.current.sound = el;
            }}
            type="button"
            className="bs-vmode-card-row-btn"
            aria-expanded={openLine === "sound"}
            aria-label={fill(c.editLine, { field: c.sound })}
            data-confirm-line-btn="sound"
            onClick={() => setOpenLine((cur) => (cur === "sound" ? null : "sound"))}
          >
            <span className="bs-vmode-card-label">{c.sound}</span>
            <span className="bs-vmode-card-val">{soundSummary}</span>
            <StudioIcon name="chevron" />
          </button>
          {openLine === "sound" && (
            <ConfirmLinePopover
              label={c.sound}
              doneLabel={c.done}
              onClose={(refocus) => closeLine("sound", refocus)}
            >
              <VideoSoundOptions id={id} draft={draft} copy={copy} label={c.sound} onDraft={onDraft} />
            </ConfirmLinePopover>
          )}
        </div>
      </div>
      )}

      <div className="bs-vmode-card-foot">
        <div className="bs-vmode-card-actions">
          <button
            type="button"
            className="bs-btn bs-vmode-card-edit-btn"
            data-variant="soft"
            data-size="sm"
            disabled={busy || Boolean(understand?.checking)}
            onClick={onEditWords}
            data-confirm-edit-words
          >
            {c.editWords}
          </button>
          {canShowMake && (
            <button
              type="button"
              className="bs-btn bs-submit bs-vmode-card-make-btn"
              data-variant="solid"
              data-size="sm"
              disabled={busy || disabled || Boolean(understand?.checking)}
              aria-label={busy ? copy.dock.submitting : `${c.make}, ${cost}`}
              onClick={onMake}
              data-confirm-make
              data-studio-submit
            >
              <span>{busy ? copy.dock.submitting : c.make}</span>
              {!busy && !disabled && (
                <span className="bs-submit-cost bs-num" data-studio-quote>
                  {cost}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function CardReply({
  text,
  moreLabel,
  lessLabel,
}: {
  text: string;
  moreLabel: string;
  lessLabel: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  return (
    <div className="bs-vmode-card-reply-wrap" data-confirm-reply-wrap data-expanded={expanded ? "" : undefined}>
      <p
        ref={ref}
        className="bs-vmode-card-reply"
        data-clamped={!expanded ? "" : undefined}
        role="status"
        data-confirm-reply
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className="bs-link-btn bs-vmode-card-reply-more"
          aria-expanded={expanded}
          data-confirm-reply-more
          onClick={() => setExpanded((cur) => !cur)}
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}

function ConfirmLinePopover({
  id,
  label,
  doneLabel,
  onClose,
  children,
}: {
  id?: string;
  label: string;
  doneLabel: string;
  onClose(refocus?: boolean): void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const box = useDismiss(() => closeRef.current(false));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={box}
      id={id}
      className="bs-vmode-line-pop"
      role="dialog"
      aria-label={label}
      data-confirm-line-popover
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeRef.current(true);
        }
      }}
    >
      {children}
      <div className="bs-vmode-line-pop-foot">
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => onClose(true)}>
          {doneLabel}
        </button>
      </div>
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
