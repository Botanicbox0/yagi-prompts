const formatters = (locale: string) => ({
  date: new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "short",
    day: "numeric",
  }),
  time: new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
});
const FORMATS = { ko: formatters("ko-KR"), en: formatters("en-US") };

/** Workspace event timestamps use Korean operational time, regardless of server/browser zone.
 * Authored date-only campaign/report periods are displayed separately and never enter here. */
export function formatBrandTimestamp(
  iso: string | null | undefined,
  locale: string,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(+date)) return null;
  const format = locale === "ko" ? FORMATS.ko : FORMATS.en;
  return `${format.date.format(date)} ${format.time.format(date)} KST`;
}

/**
 * An authored calendar date (`YYYY-MM-DD`: campaign start/end, report period) in the reader's language.
 * It is a date, not an instant, so it is formatted as that same calendar day with no zone shift.
 */
export function formatBrandDate(day: string | null | undefined, locale: string): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return day ?? null;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(+date)) return day;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(date);
}

/** A file size with the locale's own unit spelling: kB under one megabyte (rounded up), else MB. */
export function formatFileSize(bytes: number, locale: string): string {
  const tag = locale === "ko" ? "ko-KR" : "en-US";
  if (bytes < 1024 * 1024)
    return new Intl.NumberFormat(tag, { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 }).format(Math.max(1, Math.ceil(bytes / 1024)));
  return new Intl.NumberFormat(tag, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
}
