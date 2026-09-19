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
