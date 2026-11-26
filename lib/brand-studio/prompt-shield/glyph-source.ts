/**
 * Which characters of the bundled server font the prompt pages draw, as runs of equal advance. Shared by the
 * table generator (scripts/prompt-shield-glyph-table.ts) and the test that keeps the table equal to the font.
 */
import type { FontMetrics } from './font-metrics';

/** The one font the prompt pictures are drawn with (repository path; traced into the picture route's bundle). */
export const SERVER_FONT_FILE = 'assets/fonts/server/Pretendard-Regular.otf';

/** Marks, format and control characters, separators other than spaces, and conjoining jamo never stand alone. */
const NOT_DRAWN = /[\p{Mn}\p{Me}\p{Cf}\p{Cc}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
const CONJOINING_JAMO: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff],
  [0xa960, 0xa97f],
  [0xd7b0, 0xd7ff],
];

export function drawable(cp: number, advance: number): boolean {
  if (advance <= 0) return false;
  if (CONJOINING_JAMO.some(([a, b]) => cp >= a && cp <= b)) return false;
  return !NOT_DRAWN.test(String.fromCodePoint(cp));
}

/** [start, end, advance] runs over the drawable characters, in code point order. */
export function drawableRuns(metrics: FontMetrics): Array<[number, number, number]> {
  const points = [...metrics.advances.entries()].filter(([cp, adv]) => drawable(cp, adv)).sort((a, b) => a[0] - b[0]);
  const runs: Array<[number, number, number]> = [];
  for (const [cp, adv] of points) {
    const last = runs[runs.length - 1];
    if (last && last[1] === cp - 1 && last[2] === adv) last[1] = cp;
    else runs.push([cp, cp, adv]);
  }
  return runs;
}
