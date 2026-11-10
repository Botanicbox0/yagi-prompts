/** Times and days as a conversation shows them. Local time zone of the reader. */
import { dayKey } from "@/lib/brand-rooms/message-contracts";

const tag = (locale: "ko" | "en") => (locale === "ko" ? "ko-KR" : "en-US");

export function timeLabel(iso: string, locale: "ko" | "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(tag(locale), { hour: "numeric", minute: "2-digit" }).format(date);
}

/** The gutter stamp beside a grouped line: 24-hour, no day period ("15:04"). */
export function shortTime(iso: string, locale: "ko" | "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(tag(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "오늘" / "어제" / "11월 9일 일요일" (and the year when it is not this year). */
export function dayLabel(iso: string, locale: "ko" | "en", words: { today: string; yesterday: string }, now = new Date()): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return words.today;
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return words.yesterday;
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(tag(locale), { ...(sameYear ? {} : { year: "numeric" }), month: "long", day: "numeric", weekday: "long" }).format(date);
}

/** Date and time for a tooltip. */
export function fullLabel(iso: string, locale: "ko" | "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(tag(locale), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** A short relative stamp for lists ("오후 3:04", "어제", "11월 9일"). */
export function listStamp(iso: string | null, locale: "ko" | "en", words: { yesterday: string }, now = new Date()): string {
  if (!iso) return "";
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return timeLabel(iso, locale);
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return words.yesterday;
  return new Intl.DateTimeFormat(tag(locale), { month: "short", day: "numeric" }).format(new Date(iso));
}

/** The first letter of a name for an avatar. */
export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : "·";
}
