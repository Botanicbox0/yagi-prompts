"use client";
/**
 * One press copies a result's prompt (2026-11-19: "이미지 프롬프트는 편하게 복사할 수 있어야 함").
 *
 * What is copied, per job: the words the member typed; when a run has only the sentence that was sent,
 * that sentence. A partial edit's instruction is its prompt. The sentence written for a video run stays
 * protected as it was (docs/design/TASTE.md 2026-11-16): only its typed words are offered.
 *
 * The button flips to a check and "복사했어요" for 1.5 s and says so politely to screen readers; both
 * labels share one grid cell, so the button never changes size. Copying never throws to the screen.
 */
import { useEffect, useRef, useState } from "react";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import { StudioIcon } from "./icons";

export const COPIED_MS = 1500;

/** Image runs and partial edits: the sent sentence may be copied too. Video sentences stay protected. */
export function sentPromptCopyable(job: Pick<StudioJobView, "kind">): boolean {
  return job.kind === "image" || job.kind === "region_edit";
}

/** The text "프롬프트 복사" copies for a job, or null when there is nothing to copy. */
export function promptToCopy(job: Pick<StudioJobView, "kind" | "prompt" | "finalPrompt">): string | null {
  const typed = job.prompt.trim();
  if (typed) return job.prompt;
  if (sentPromptCopyable(job) && job.finalPrompt?.trim()) return job.finalPrompt;
  return null;
}

/** Copies the hidden-textarea way: for browsers without the async clipboard or when it is refused. */
export function copyWithSelection(text: string, host?: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;";
  // Inside a modal dialog everything outside it is inert, so the helper goes next to the button.
  const parent = host ?? document.body;
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  parent.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  } catch {
    return false;
  } finally {
    area.remove();
    before?.focus?.({ preventScroll: true });
  }
}

/** The async clipboard first, then the selection fallback. Resolves false instead of throwing. */
export async function copyText(text: string, host?: HTMLElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused (no permission, not focused): the fallback below
  }
  try {
    return copyWithSelection(text, host);
  } catch {
    return false;
  }
}

/** `done` for 1.5 s after a successful copy. */
export function useCopied(ms = COPIED_MS) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const flash = () => {
    setDone(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), ms);
  };
  return { done, flash };
}

export interface CopyButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
  /** Said when the clipboard refused (the screen shows it its own way). */
  onFailed?(): void;
  /** The id of what is being copied (its heading), for screen readers. */
  describedBy?: string;
  /** Icon only, with the label as its name (the small buttons beside each sentence). */
  compact?: boolean;
  /** A `data-*` marker for tests and the sweep. */
  marker?: string;
}

export function CopyButton({ text, label, copiedLabel, onFailed, describedBy, compact = false, marker }: CopyButtonProps) {
  const { done, flash } = useCopied();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="bs-btn bs-copy-btn"
        data-variant="ghost"
        data-size="sm"
        data-compact={compact ? "" : undefined}
        data-copied={done ? "" : undefined}
        aria-label={compact ? (done ? copiedLabel : label) : undefined}
        aria-describedby={describedBy}
        title={compact ? label : undefined}
        {...(marker ? { [`data-${marker}`]: "" } : {})}
        onClick={() => {
          void copyText(text, ref.current?.parentElement).then((ok) => (ok ? flash() : onFailed?.()));
        }}
      >
        <StudioIcon name={done ? "check" : "copy"} />
        {/* The small button says it too, beside itself (positioned, so nothing moves). */}
        {compact && done && (
          <span className="bs-copy-tip" aria-hidden="true">
            {copiedLabel}
          </span>
        )}
        {!compact && (
          <span className="bs-copy-label">
            <span aria-hidden={done ? true : undefined}>{label}</span>
            <span aria-hidden={done ? undefined : true}>{copiedLabel}</span>
          </span>
        )}
      </button>
      <span className="bs-sr" aria-live="polite">
        {done ? copiedLabel : ""}
      </span>
    </>
  );
}
