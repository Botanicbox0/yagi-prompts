/**
 * Copy helpers for the brand studio (docs/BRAND-STUDIO-V3.md §2, V2 §5.4). Every visible string comes
 * from `messages/*.ts` under `brandStudio`; these helpers only fill placeholders and format the numbers
 * the server returns. Amounts are always credits (lib/brand-studio/credits.ts), never money.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isCycleWindow, type AllowanceWindowView } from "@/lib/brand-studio/allowance-window";
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
 * month"; without it the words are the calendar month's, as before.
 */
export function errorLine(copy: StudioCopy, code: string | null | undefined, window?: Pick<AllowanceWindowView, "kind"> | null): string {
  if (code === "allowance_exhausted" && isCycleWindow(window)) return copy.errorsCycle.allowance_exhausted;
  const errors = copy.errors as Record<StudioErrorCode, string>;
  return (code && Object.hasOwn(errors, code) ? errors[code as StudioErrorCode] : undefined) ?? errors.failed;
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
