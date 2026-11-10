/**
 * The wall's thin date dividers: runs grouped by their day in Seoul time, newest day first, with
 * "오늘" / "어제" for the two most recent days and a short date otherwise.
 */
const KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-11-11" for an ISO time, in Seoul. Unreadable times fall into today's group. */
export function dayKey(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return KEY.format(Number.isNaN(date.getTime()) ? now : date);
}

export function dayLabel(key: string, now: Date, locale: "ko" | "en", words: { today: string; yesterday: string }): string {
  const today = dayKey(now.toISOString(), now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString(), now);
  if (key === today) return words.today;
  if (key === yesterday) return words.yesterday;
  const [y, m, d] = key.split("-").map(Number);
  const sameYear = y === Number(today.slice(0, 4));
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: locale === "ko" ? "long" : "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
}

/** Items grouped by day, keeping their order (the caller sorts newest first). */
export function groupByDay<T>(items: readonly T[], at: (item: T) => string, now: Date = new Date()): Array<{ key: string; items: T[] }> {
  const groups: Array<{ key: string; items: T[] }> = [];
  for (const item of items) {
    const key = dayKey(at(item), now);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}
