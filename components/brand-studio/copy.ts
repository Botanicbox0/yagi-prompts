/**
 * Copy helpers for the brand studio (docs/BRAND-STUDIO-V3.md §2, V2 §5.4). Every visible string comes
 * from `messages/*.ts` under `brandStudio`; these helpers only fill placeholders and format the numbers
 * the server returns. Amounts are always credits (lib/brand-studio/credits.ts), never money.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isCycleWindow, refillWording, type AllowanceRefillView, type AllowanceWindowView } from "@/lib/brand-studio/allowance-window";
import type { StudioErrorCode } from "@/lib/brand-studio/contracts";
import { isUnapprovedUploadReason, type UploadLimitReason } from "@/lib/brands/upload-limits-format";
import { formatCredits } from "@/lib/brand-studio/credits";

export type StudioCopy = Dictionary["brandStudio"];
export type StudioLocale = "ko" | "en";

/** `{name}` placeholders, left as written when a value is missing. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/**
 * The customer sentence for an error code; anything unknown reads as the generic failure. `window` (R1): the allowance
 * window of the screen's organization, when it holds one — a billing cycle says "this usage period" instead of "this
 * month"; without it the words are the calendar month's, as before. `refill` (R4): a trial-only organization is told
 * its trial credits are used up.
 */
export function errorLine(
  copy: StudioCopy,
  code: string | null | undefined,
  window?: Pick<AllowanceWindowView, "kind"> | null,
  refill?: AllowanceRefillView | null,
): string {
  if (code === "allowance_exhausted" && refillWording(refill).kind === "trial") return copy.errorsTrial.allowance_exhausted;
  if (code === "allowance_exhausted" && isCycleWindow(window)) return copy.errorsCycle.allowance_exhausted;
  const errors = copy.errors as Record<StudioErrorCode, string>;
  return (code && Object.hasOwn(errors, code) ? errors[code as StudioErrorCode] : undefined) ?? errors.failed;
}

const VIDEO_RUN_KINDS: ReadonlySet<string> = new Set(["video", "video_remix", "video_final", "video_revise"]);

/**
 * A failed run's line on its card: its own code's sentence, or, for a plain failure (or a code without one),
 * "이미지를 …" / "영상을 생성하지 못했어요" by the run's kind. `errors.failed` names no medium (it is every
 * operation's fallback).
 */
export function runFailedLine(copy: StudioCopy, kind: string, code: string | null | undefined): string {
  if (code && code !== "failed" && Object.hasOwn(copy.errors, code)) return errorLine(copy, code);
  return VIDEO_RUN_KINDS.has(kind) ? copy.board.failedVideo : copy.board.failedImage;
}

/** "스튜디오를 불러오지 못했어요." plus the code's own sentence, or alone when the code says nothing more (`failed`, unknown). */
export function loadFailedLine(copy: StudioCopy, code: string | null | undefined): string {
  if (!code || code === "failed" || !Object.hasOwn(copy.errors, code)) return copy.state.loadFailed;
  return `${copy.state.loadFailed} ${errorLine(copy, code)}`;
}

/** Upload error copy that surfaces the pre-approval 500 MB / 50-file reason when present. */
export function studioUploadErrorLine(copy: StudioCopy, code: string | null | undefined, reason?: UploadLimitReason | null): string {
  if (code === "storage_quota_exceeded" && isUnapprovedUploadReason(reason)) {
    return reason === "unapproved_file_limit" ? copy.unapprovedUpload.fileLimitExceeded : copy.unapprovedUpload.quotaExceeded;
  }
  return errorLine(copy, code);
}

/** "15 크레딧" / "15 credits": a credit count in a sentence of the dictionary (`{n}` is the number). */
export function credits(template: string, count: number, locale: StudioLocale): string {
  return fill(template, { n: formatCredits(count, locale) });
}

/** The allowance refill day in Seoul time ("12월 1일" / "Dec 1"). */
export function formatDay(iso: string, locale: StudioLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: locale === "ko" ? "long" : "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(date);
}

/** A fresh idempotency key for one press (contracts.ts `RequestId`). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
