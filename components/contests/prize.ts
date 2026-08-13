/**
 * PLAN §14.2 — a prize, taken apart.
 *
 * A prize is authored as ONE localized string ("$3,000 · 1st $1,500 / 2nd $1,000 / 3rd $500")
 * because that is how a brand states it, and because a second column in the admin editor would be a
 * schema change to hold punctuation. What it is NOT is one typographic run: setting the whole
 * sentence in display type gives the payout table the same voice as the number that decides whether
 * a reader keeps reading (M9 design review, finding 3).
 *
 * So the split happens at the surface, not in the database, and it happens in ONE place: the hero
 * poster and the detail band both read the same two parts, so they can never disagree about which
 * half is the headline.
 *
 * The delimiters are the ones the copy already uses — `·` between the total and its breakdown,
 * `/` between the individual payouts. A prize with neither (the common case: "£1,000", "Fixture
 * prize — not real") is returned whole as the total, which is the honest answer rather than a
 * guess.
 */

export interface PrizeParts {
  /** The headline number. Set in display type; never the whole string. */
  total: string;
  /** "1st $1,500", "2nd $1,000" … — set small, in mono. Empty when the prize is one figure. */
  payouts: string[];
}

const MIDDLE_DOT = '·';

export function splitPrize(prize: string): PrizeParts {
  const raw = prize.trim();
  if (raw === '') return { total: '', payouts: [] };

  const dot = raw.indexOf(MIDDLE_DOT);
  if (dot === -1) return { total: raw, payouts: [] };

  const total = raw.slice(0, dot).trim();
  const payouts = raw
    .slice(dot + MIDDLE_DOT.length)
    .split(/[/·]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  // A prize that opens with the delimiter ("· 1st …") has no headline; keep the string whole rather
  // than printing an empty display line above a list.
  if (total === '') return { total: raw, payouts: [] };

  return { total, payouts };
}
