/**
 * How the console writes numbers, money, time and ids (docs/ADMIN.md §3). Times are Seoul time —
 * the studio works there — and every figure is drawn with tabular numerals by the CSS.
 */

const tag = (locale: string) => (locale === "ko" ? "ko-KR" : "en-US");

/** The first eight characters of an id; the full value goes in a `title` beside it. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export function formatAdminTime(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(tag(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

/** "3분 12초" / "3 min, 12 sec" between two instants; null when either end is missing. */
export function formatDuration(from: string | null | undefined, to: string | null | undefined, locale: string): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  const parts: Array<[number, "hour" | "minute" | "second"]> = [
    [Math.floor(seconds / 3600), "hour"],
    [Math.floor((seconds % 3600) / 60), "minute"],
    [seconds % 60, "second"],
  ];
  const shown = parts.filter(([n]) => n > 0).slice(0, 2);
  if (shown.length === 0) shown.push([0, "second"]);
  return shown
    .map(([n, unit]) => new Intl.NumberFormat(tag(locale), { style: "unit", unit, unitDisplay: "short" }).format(n))
    .join(" ");
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 0.1 ? 3 : 2)}`;
}

export function formatKrw(value: number, locale: string): string {
  const n = new Intl.NumberFormat(tag(locale)).format(value);
  return locale === "ko" ? `${n}원` : `₩${n}`;
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale)).format(value);
}
