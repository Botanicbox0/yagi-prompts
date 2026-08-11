/**
 * The one interpolation helper. Dictionary values carry `{name}` placeholders (PLAN §3.9 keeps
 * copy in the dictionary modules, so counts have to be substituted rather than concatenated —
 * Korean and English put the numbers in different places).
 */
export function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Locale-aware thousands separators, so "1,240 prompts" reads right in both languages. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US').format(value);
}

function tag(locale: string): 'ko-KR' | 'en-US' {
  return locale === 'ko' ? 'ko-KR' : 'en-US';
}

/**
 * §3.3 meta strip: "est. cost". USD is the billing currency (§10 "USD price in v1") and the studio
 * costs are quoted in it too, so the currency is fixed and only the FORMAT is localized.
 */
export function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency: 'USD',
    // Sub-dollar pipelines are common; two decimals or none, never a lonely "$1.2".
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** "Updated 12 Aug 2026" / "2026년 8월 12일". Invalid or absent input returns null, never "Invalid Date". */
export function formatDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(tag(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Pick one side of a `{en, ko}` content field (§6.1 `Localized`). */
export function localize(value: { en: string; ko: string }, locale: string): string {
  return locale === 'ko' ? value.ko : value.en;
}
