/** "{date} 저장" on the viewer's own clock (KST for ko), the UTC day for en (the convention of lib/i18n/format). */
export function selfieSavedOn(template: string, iso: string, locale: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const label = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: locale === 'ko' ? 'Asia/Seoul' : 'UTC' }).format(date);
    return template.replace('{date}', label);
  } catch { return null; }
}
