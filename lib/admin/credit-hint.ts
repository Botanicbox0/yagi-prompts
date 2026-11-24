import { creditsOf, formatCredits, STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { interpolate } from '@/lib/i18n/format';
import { formatKrw } from './format';

/** With no value on the input, the helper shows this amount as the example (R2: 10,000원 = 1,000크레딧). */
const EXAMPLE_KRW = 10_000;

/**
 * R3 item 8: the helper text next to an admin amount input in KRW that stands for credits (plan default cap, extra
 * credits, override cap): "10원 = 1크레딧 · 270,000원 = 27,000크레딧". Static, from the server-rendered value (or the
 * example when the input starts empty); no client state.
 */
export function creditEquivalentHint(
  valueKrw: number | null | undefined,
  locale: string,
  copy: { creditRate: string; creditEquivalent: string },
): string {
  const lang = locale === 'en' ? 'en' : 'ko';
  const krw = valueKrw !== null && valueKrw !== undefined && Number.isFinite(valueKrw) && valueKrw > 0 ? valueKrw : EXAMPLE_KRW;
  return `${interpolate(copy.creditRate, { krw: formatKrw(STUDIO_CREDIT_KRW, locale) })} · ${interpolate(copy.creditEquivalent, {
    krw: formatKrw(krw, locale),
    credits: formatCredits(creditsOf(krw), lang),
  })}`;
}
