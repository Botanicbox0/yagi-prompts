/**
 * Pure parser for explicit song/audio lengths written in a customer's brief (`parseRequestedSeconds`).
 *
 * Client- and server-safe (zero dependencies). Used on the server for:
 *  - MiniMax Music 3.0 duration precedence (2): explicit `durationSeconds` > sentence length > 60 (clamped 1..75)
 *  - Suno v6 / Suno v6 Wild v2 target length when no explicit `targetSeconds` or video is chosen
 * and in B4 on the client for the MiniMax "> 75 s" cap notice before the paid button.
 *
 * Supported forms (whole integers, 1..600 s):
 *  - Korean: "30초", "30 초", "90초", "15초짜리", "1분", "1분 30초", "1분30초", "2분"
 *  - English: "15s", "15 s", "15 sec", "15 secs", "15 second", "15 seconds", "30-second",
 *    "1 min", "2 mins", "1 minute", "2 minutes", "1m 30s", "1 min 30 sec"
 *
 * Ignored (`null`): bare years/numbers ("2026"), stanza/bar counts ("3 verses", "4마디"),
 * tempos ("BPM 120", "120bpm"), hours ("24시간"), quarters/splits/ratios ("4분기", "3분할", "16:9"),
 * decades ("'80s", "late-80s", "1980s"), sample rates ("44.1kHz"), and spelled-out words ("one minute").
 */

const MAX_REQUESTED_SECONDS = 600;

interface DurationRule {
  re: RegExp;
  toSeconds: (match: RegExpExecArray) => number;
}

/**
 * Korean suffixes starting with `분` or `초` that are NOT time units:
 *  - `분기` (quarter), `분할` (split), `분위` (percentile), `분율` (percentage), `분량` (amount),
 *    `분류` (category), `분자`/`분모` (fraction), `분석` (analysis), `분야` (field), `분위기` (mood)
 *  - `초과` (exceeding), `초점` (focus), `초기` (initial), `초보` (beginner), `초등`/`초중`/`초고` (school),
 *    `초원` (meadow), `초콜` (chocolate), `초반` (early part of decade/age)
 * Particles and duration suffixes (`초짜리`, `초간`, `초로`, `초의`, `초에`, `초만`, `초도`, `초쯤`, `분짜리`, `분간`) remain allowed.
 */
const RULES: readonly DurationRule[] = [
  // 1. Korean compound: "1분 30초", "1분30초", "2 분 15 초"
  {
    re: /(?<![A-Za-z0-9_./:'’-])(\d{1,2})(?!\.\d)\s*분(?![기할위율량류자모석야])\s*(\d{1,2})(?!\.\d)\s*초(?![과점기보등중고원콜반])/g,
    toSeconds: (m) => Number(m[1]) * 60 + Number(m[2]),
  },
  // 2. English compound: "1m 30s", "1 min 30 sec", "1 minute and 15 seconds"
  {
    re: /(?<![A-Za-z0-9_./:'’-])(\d{1,2})(?!\.\d)\s*-?\s*(?:m|min|mins|minute|minutes)\s*(?:and\s+)?(\d{1,2})(?!\.\d)\s*-?\s*(?:s|sec|secs|second|seconds)\b/gi,
    toSeconds: (m) => Number(m[1]) * 60 + Number(m[2]),
  },
  // 3. Korean seconds: "30초", "30 초", "90초", "15초짜리"
  {
    re: /(?<![A-Za-z0-9_./:'’-])(\d{1,3})(?!\.\d)\s*초(?![과점기보등중고원콜반])/g,
    toSeconds: (m) => Number(m[1]),
  },
  // 4. Korean minutes: "1분", "2분", "1분짜리"
  {
    re: /(?<![A-Za-z0-9_./:'’-])(\d{1,2})(?!\.\d)\s*분(?![기할위율량류자모석야])/g,
    toSeconds: (m) => Number(m[1]) * 60,
  },
  // 5. English seconds: "15s", "15 sec", "15 secs", "15 second", "15 seconds", "30-second"
  {
    re: /(?<![A-Za-z0-9_./:'’-])(\d{1,3})(?!\.\d)\s*-?\s*(?:s|sec|secs|second|seconds)\b/gi,
    toSeconds: (m) => Number(m[1]),
  },
  // 6. English minutes: "1 min", "2 mins", "1 minute", "2 minutes", "2-minute"
  {
    re: /(?<![A-Za-z0-9_./:'’-])(\d{1,2})(?!\.\d)\s*-?\s*(?:min|mins|minute|minutes)\b/gi,
    toSeconds: (m) => Number(m[1]) * 60,
  },
];

export function parseRequestedSeconds(text: string): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  let best: { index: number; priority: number; seconds: number } | null = null;

  for (let priority = 0; priority < RULES.length; priority += 1) {
    const rule = RULES[priority]!;
    const re = new RegExp(rule.re.source, rule.re.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      // Guard against matching a trailing units portion inside a preceding compound or ratio (e.g. "16:9s").
      const seconds = rule.toSeconds(match);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_REQUESTED_SECONDS) continue;
      if (
        best === null ||
        match.index < best.index ||
        (match.index === best.index && priority < best.priority)
      ) {
        best = { index: match.index, priority, seconds };
      }
      break;
    }
  }

  return best ? best.seconds : null;
}
