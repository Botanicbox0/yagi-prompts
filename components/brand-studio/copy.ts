/**
 * Copy helpers for the brand studio (docs/BRAND-STUDIO-V2.md §5.4). Every visible string comes from
 * `messages/*.ts` under `brandStudio`; these helpers only fill placeholders and format the numbers
 * the server returns (KRW amounts, the refill date). They never compute a price.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { StudioErrorCode } from "@/lib/brand-studio/contracts";

export type StudioCopy = Dictionary["brandStudio"];
export type StudioLocale = "ko" | "en";

/** `{name}` placeholders, left as written when a value is missing. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** The customer sentence for an error code; anything unknown reads as the generic failure. */
export function errorLine(copy: StudioCopy, code: string | null | undefined): string {
  const errors = copy.errors as Record<StudioErrorCode, string>;
  return (code && Object.hasOwn(errors, code) ? errors[code as StudioErrorCode] : undefined) ?? errors.failed;
}

export function formatKrw(amount: number, locale: StudioLocale): string {
  return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(amount)));
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
