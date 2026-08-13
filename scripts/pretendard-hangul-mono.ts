import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Founder pass (2026-08-13, fonts) — generate the Hangul-scoped mono fallback.
 *
 * Geist Mono has no Hangul, so mono-styled Korean sentences fell through to the browser's
 * last-resort face. The naive fixes both fail:
 *   · Pretendard AFTER `var(--font-geist-mono)` is unreachable — the next/font variable expands
 *     to Geist plus its whole fallback list, which ends in the generic `monospace`, and a generic
 *     matches every glyph;
 *   · Pretendard BEFORE it swallows latin and digits too — the §5 mono identity (prompt text,
 *     D-day chips, numbers) would stop being mono on every KO page.
 *
 * The correct shape is a PER-GLYPH split: an alias family whose `unicode-range` never covers
 * latin. This script copies the vendor dynamic-subset CSS, keeps only the @font-face slices whose
 * ranges do not intersect U+0000–U+024F (basic latin, latin-1, latin extended), renames them to
 * 'Pretendard Hangul', and writes them next to the vendor file (relative woff2 URLs stay valid).
 * First in the KO mono stack, it catches Hangul and lets everything latin fall through to Geist.
 *
 * Re-run after bumping the pretendard package: `npx tsx scripts/pretendard-hangul-mono.ts`
 */

const DIR = join(process.cwd(), 'public', 'fonts', 'pretendard');
const SOURCE = join(DIR, 'pretendard-dynamic-subset.css');
const TARGET = join(DIR, 'pretendard-hangul-mono.css');

const LATIN_END = 0x024f;

function parseToken(token: string): [number, number] {
  const t = token.trim().replace(/^U\+/i, '');
  if (t.includes('-')) {
    const [a, b] = t.split('-');
    return [parseInt(a!, 16), parseInt(b!, 16)];
  }
  if (t.includes('?')) {
    return [parseInt(t.replaceAll('?', '0'), 16), parseInt(t.replaceAll('?', 'F'), 16)];
  }
  const v = parseInt(t, 16);
  return [v, v];
}

function formatToken([start, end]: [number, number]): string {
  const hex = (v: number) => v.toString(16);
  return start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`;
}

/**
 * TOKEN-level clipping, not slice-level dropping. The vendor subset is FREQUENCY-sliced, so a
 * slice can carry Hangul syllables AND latin in one range list — dropping such a slice whole
 * punches holes in Hangul coverage (the first cut of this script lost '릴' and friends to the
 * system fallback). The woff2 still contains every glyph; `unicode-range` only gates matching,
 * so clipping the latin span out of each token keeps full Hangul coverage while latin falls
 * through to Geist.
 */
function clipLatin(unicodeRange: string): string | null {
  const kept = unicodeRange
    .split(',')
    .map(parseToken)
    .flatMap(([start, end]): Array<[number, number]> => {
      if (end <= LATIN_END) return [];
      if (start <= LATIN_END) return [[LATIN_END + 1, end]];
      return [[start, end]];
    })
    .map(formatToken);
  return kept.length === 0 ? null : kept.join(', ');
}

const css = readFileSync(SOURCE, 'utf8');
const blocks = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);

const kept = blocks
  .map((block) => {
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    if (range === undefined) return null;
    const clipped = clipLatin(range);
    if (clipped === null) return null;
    return block.replace(/unicode-range:\s*[^;]+;/, `unicode-range: ${clipped};`);
  })
  .filter((block): block is string => block !== null);

if (kept.length === 0 || blocks.length === 0) {
  throw new Error(
    `suspicious slice split: kept ${kept.length} of ${blocks.length} — the vendor css format moved`,
  );
}

const out = [
  '/* GENERATED — scripts/pretendard-hangul-mono.ts. Do not edit by hand.',
  ' *',
  " * 'Pretendard Hangul' is the vendor dynamic subset minus every slice that covers latin",
  ' * (U+0000–U+024F). It exists for ONE stack position: first in the KO `--stack-mono`, where it',
  ' * catches Hangul and lets latin, digits and punctuation fall through to Geist Mono.',
  ' * Licence: SIL OFL 1.1 (see pretendard-dynamic-subset.css / LICENSES/OFL-Pretendard.txt).',
  ' */',
  '',
  ...kept.map((block) => block.replace(/font-family:\s*'Pretendard Variable';/, "font-family: 'Pretendard Hangul';")),
].join('\n');

writeFileSync(TARGET, `${out}\n`);
console.log(`pretendard-hangul-mono.css: kept ${kept.length} of ${blocks.length} slices`);
