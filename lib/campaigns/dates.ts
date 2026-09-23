/**
 * Campaign dates are Korea time (P1-1, 2026-09-23).
 *
 * The admin campaign form says "한국 시간" next to its two `datetime-local` inputs, and the brand
 * workspace already reads its own dates as `+09:00`. The retired contest helper
 * (`lib/contests/schemas.ts` `parseDateTimeLocal`) reads the same input as UTC and stays that way for
 * the contest rows it wrote; campaigns use these helpers instead.
 *
 * Korea has had no daylight saving time since 1988, so a fixed +09:00 offset is exact.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** `datetime-local` text typed as Korea wall-clock → ISO instant. Blank or impossible → null. */
export function parseKstDateTimeLocal(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const match = WALL_CLOCK.exec(value);
  if (match === null) {
    // Already an instant with its own offset (a fixture, or a round trip) — keep that instant.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, y, mo, d, h, mi, s = '00'] = match as unknown as string[];
  const wall = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  // `Date.UTC` normalises 2026-02-31 into March; a date that moved was not a real date.
  if (wall.getUTCMonth() !== Number(mo) - 1 || wall.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59) {
    return null;
  }
  return new Date(wall.getTime() - KST_OFFSET_MS).toISOString();
}

/** The inverse, for the editor's `defaultValue`: the stored instant as Korea wall-clock, minutes. */
export function toKstDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * A campaign deadline for people: date and time in Korea time, in either language.
 * "2026년 10월 1일 오후 6:00" / "Oct 1, 2026, 6:00 PM KST". Invalid or absent input → null.
 */
export function formatCampaignDateTime(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const ko = locale === 'ko';
  const text = new Intl.DateTimeFormat(ko ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: ko ? 'long' : 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(date);
  return ko ? text : `${text} KST`;
}
