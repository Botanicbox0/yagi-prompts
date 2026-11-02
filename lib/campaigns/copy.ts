import type { PayoutRule } from './schemas';
import { formatWon } from './state';

/**
 * The payout rule as ONE sentence a creator can quote back (docs/CAMPAIGNS.md §4). The words come
 * from the dictionary (so both locales read naturally); the numbers come from the rule. Pure, and
 * used identically on the public detail, the creator's own page and the admin editor — so the fee
 * a creator applied for is spelled the same way when it is paid.
 */
export interface PayoutLabels {
  /** "고정 {amount}" */
  flat: string;
  /** "1,000회당 {rate}" */
  perView: string;
  /** "기본 {amount} + 1,000회당 {rate}" */
  hybrid: string;
  /** "최소 {amount}" */
  floor: string;
  /** "최대 {amount}" */
  cap: string;
  /** "검수 후 {days}일 뒤 지급" */
  hold: string;
  /** "검수 후 바로 지급" — holdDays 0 */
  holdNone: string;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

export function payoutParts(rule: PayoutRule, locale: string, labels: PayoutLabels): string[] {
  const parts: string[] = [];
  if (rule.model === 'flat') {
    parts.push(fill(labels.flat, { amount: formatWon(rule.flatCents, locale) }));
  } else if (rule.model === 'per_view') {
    parts.push(fill(labels.perView, { rate: formatWon(rule.perThousandViewsCents, locale) }));
  } else {
    parts.push(
      fill(labels.hybrid, {
        amount: formatWon(rule.flatCents, locale),
        rate: formatWon(rule.perThousandViewsCents, locale),
      }),
    );
  }
  if (rule.model !== 'flat' && rule.minCents > 0) parts.push(fill(labels.floor, { amount: formatWon(rule.minCents, locale) }));
  if (rule.model !== 'flat' && rule.maxCents !== null) parts.push(fill(labels.cap, { amount: formatWon(rule.maxCents, locale) }));
  parts.push(rule.holdDays > 0 ? fill(labels.hold, { days: String(rule.holdDays) }) : labels.holdNone);
  return parts;
}

export function payoutSentence(rule: PayoutRule, locale: string, labels: PayoutLabels): string {
  return payoutParts(rule, locale, labels).join(' · ');
}

/** The headline figure for a card: the flat fee, or the per-1k rate for a pure view-based rule. */
export function payoutHeadline(rule: PayoutRule, locale: string, labels: PayoutLabels): string {
  if (rule.model === 'per_view') return fill(labels.perView, { rate: formatWon(rule.perThousandViewsCents, locale) });
  return formatWon(rule.flatCents, locale);
}
