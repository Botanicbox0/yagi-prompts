/**
 * Copy helpers for the brand studio (docs/BRAND-STUDIO-V3.md §2, V2 §5.4). Every visible string comes
 * from `messages/*.ts` under `brandStudio`; these helpers only fill placeholders and format the numbers
 * the server returns. Amounts are always credits (lib/brand-studio/credits.ts), never money.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioErrorCode } from "@/lib/brand-studio/contracts";
import { isUnapprovedUploadReason, type UploadLimitReason } from "@/lib/brands/upload-limits-format";
import { formatCredits } from "@/lib/brand-studio/credits";

export type StudioCopy = Dictionary["brandStudio"];
export type StudioLocale = "ko" | "en";

/** `{name}` placeholders, left as written when a value is missing. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** The customer sentence for an error code; anything unknown reads as the generic failure. */
export function errorLine(copy: Pick<StudioCopy, "errors">, code: string | null | undefined): string {
  const errors = copy.errors as Record<StudioErrorCode, string>;
  return (code && Object.hasOwn(errors, code) ? errors[code as StudioErrorCode] : undefined) ?? errors.failed;
}

/**
 * Upload refusals whose library sentence is true for an upload: the reason is said as it is. Every other code an
 * upload can come back with (`failed` from a dropped connection or an unexpected answer, `invalid` when the
 * stored bytes could not be read, `conflict`, `too_many_running`, `not_found`, anything unknown) only means the
 * file did not go up this time, and gets `uploadFailed`: the generic `errors.failed` speaks of making an image,
 * and `conflict` asks for a reload, which in the editing studio is what removes a file that stayed in the tab.
 */
const UPLOAD_REASON_CODES: ReadonlySet<string> = new Set<StudioErrorCode>([
  "file_too_large",
  "unsupported_file",
  "storage_quota_exceeded",
  "asset_limit",
  "forbidden",
  "sign_in_required",
  "feature_unavailable",
  "studio_closed",
]);

/**
 * The sentence for an upload that did not go through: the pre-approval 500 MB / 50-file reason when present, the
 * library's line for a real reason, else `uploadFailed`. Takes only the parts it reads, so a screen outside the
 * studio (the editing studio's device uploads) can pass just those. Used by every studio upload: the library
 * hub, the image studio (dock, partial edit references, blank canvas), the video studio and the editing studio.
 */
export function studioUploadErrorLine(
  copy: Pick<StudioCopy, "errors" | "unapprovedUpload" | "uploadFailed">,
  code: string | null | undefined,
  reason?: UploadLimitReason | null,
): string {
  if (code === "storage_quota_exceeded" && isUnapprovedUploadReason(reason)) {
    return reason === "unapproved_file_limit" ? copy.unapprovedUpload.fileLimitExceeded : copy.unapprovedUpload.quotaExceeded;
  }
  return code && UPLOAD_REASON_CODES.has(code) ? errorLine(copy, code) : copy.uploadFailed;
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
