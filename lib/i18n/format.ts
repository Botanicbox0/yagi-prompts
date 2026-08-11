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
