/**
 * Pure parser for explicit song/audio lengths written in a customer's brief (`parseRequestedSeconds`).
 *
 * Client- and server-safe (zero dependencies). Prefers `null` over a guess:
 *  - Explicit Korean units: `초`, `분` (excluding fractions like `3분의 1` and non-time compounds like `분기`, `분할`, `초반`),
 *    combined `1분 30초`, decimal minutes `1.5분`, and ranges `10~15초` (upper bound).
 *  - Explicit English units: `sec`, `secs`, `second`, `seconds`, `min`, `mins`, `minute`, `minutes`,
 *    combined `1 min 30 sec` / `1m 30s`, decimal minutes `1.5 min`, and ranges `10-15 sec` (upper bound).
 *  - Bare `s` suffix (`15s`, `45s`) is accepted ONLY when the integer is not a multiple of ten; `10s`, `20s`, `30s`,
 *    `70s`, `80s`, `90s` are ignored because they read as decades or ages in music/ad briefs.
 *  - More than one distinct duration in the same text (`15초 인트로가 있는 1분짜리 곡`) returns `null` (ambiguous).
 *  - Zero, negative (`0초`, `-15초`, `-15 sec`), or values above 600 s (`601초`, `1000초`) return `null`.
 */

const MAX_REQUESTED_SECONDS = 600;

interface SpanMatch {
  start: number;
  end: number;
  /** Parsed whole seconds, or `null` when a matched duration expression is invalid (e.g. inverted range or 0). */
  seconds: number | null;
}

interface SpanRule {
  re: RegExp;
  /** Return `undefined` to ignore the token completely (e.g. `80s` decade), `null` to mark an invalid duration, or seconds. */
  parse: (match: RegExpExecArray) => number | null | undefined;
}

const KO_MIN_FOLLOW = String.raw`(?!\s*의\s*\d)(?![기할위율량류자모석야])`;
const KO_SEC_FOLLOW = String.raw`(?![과점기보등중고원콜반])`;
const NUM_START = String.raw`(?<![A-Za-z0-9_./:'’−~–—-])`;

const RULES: readonly SpanRule[] = [
  // 1. Korean compound: "1분 30초", "1분30초", "2 분 15 초"
  {
    re: new RegExp(`${NUM_START}(\\d{1,3})(?!\\.\\d)\\s*분${KO_MIN_FOLLOW}\\s*(\\d{1,2})(?!\\.\\d)\\s*초${KO_SEC_FOLLOW}`, 'g'),
    parse: (m) => {
      const mins = Number(m[1]);
      const secs = Number(m[2]);
      if (secs >= 60) return null;
      return mins * 60 + secs;
    },
  },
  // 2. English compound: "1m 30s", "1 min 30 sec", "1 minute and 15 seconds"
  {
    re: new RegExp(
      `${NUM_START}(\\d{1,3})(?!\\.\\d)\\s*-?\\s*(?:m|min|mins|minute|minutes)\\s*(?:and\\s+)?(\\d{1,2})(?!\\.\\d)\\s*-?\\s*(?:s|sec|secs|second|seconds)\\b`,
      'gi',
    ),
    parse: (m) => {
      const mins = Number(m[1]);
      const secs = Number(m[2]);
      if (secs >= 60) return null;
      return mins * 60 + secs;
    },
  },
  // 3. Korean seconds range: "10~15초", "10-15초", "10 ~ 15 초" -> upper bound
  {
    re: new RegExp(`${NUM_START}(\\d{1,6})(?!\\.\\d)\\s*(?:~|–|—|-)\\s*(\\d{1,6})(?!\\.\\d)\\s*초${KO_SEC_FOLLOW}`, 'g'),
    parse: (m) => {
      const low = Number(m[1]);
      const high = Number(m[2]);
      return low >= 1 && high >= low ? high : null;
    },
  },
  // 4. Korean minutes range: "1~1.5분", "1-2분" -> upper bound
  {
    re: new RegExp(`${NUM_START}(\\d{1,4}(?:\\.\\d+)?)\\s*(?:~|–|—|-)\\s*(\\d{1,4}(?:\\.\\d+)?)\\s*분${KO_MIN_FOLLOW}`, 'g'),
    parse: (m) => {
      const low = Number(m[1]);
      const high = Number(m[2]);
      const secs = Math.round(high * 60);
      return low > 0 && high >= low && Number.isFinite(secs) ? secs : null;
    },
  },
  // 5. English explicit seconds range: "10-15 sec", "10~15 seconds", "10 to 15 secs" -> upper bound
  {
    re: new RegExp(
      `${NUM_START}(\\d{1,6})(?!\\.\\d)\\s*(?:~|–|—|-|to)\\s*(\\d{1,6})(?!\\.\\d)\\s*-?\\s*(?:sec|secs|second|seconds)\\b`,
      'gi',
    ),
    parse: (m) => {
      const low = Number(m[1]);
      const high = Number(m[2]);
      return low >= 1 && high >= low ? high : null;
    },
  },
  // 6. English bare-s range: "10~15s", "10-15s" (ignored when upper is a multiple of 10 like "20-30s" ages)
  {
    re: new RegExp(`${NUM_START}(\\d{1,6})(?!\\.\\d)\\s*(?:~|–|—|-)\\s*(\\d{1,6})(?!\\.\\d)\\s*s\\b`, 'gi'),
    parse: (m) => {
      const low = Number(m[1]);
      const high = Number(m[2]);
      if (high % 10 === 0) return undefined;
      return low >= 1 && high >= low ? high : null;
    },
  },
  // 7. English minutes range: "1-2 min", "1~1.5 minutes" -> upper bound
  {
    re: new RegExp(
      `${NUM_START}(\\d{1,4}(?:\\.\\d+)?)\\s*(?:~|–|—|-|to)\\s*(\\d{1,4}(?:\\.\\d+)?)\\s*-?\\s*(?:min|mins|minute|minutes)\\b`,
      'gi',
    ),
    parse: (m) => {
      const low = Number(m[1]);
      const high = Number(m[2]);
      const secs = Math.round(high * 60);
      return low > 0 && high >= low && Number.isFinite(secs) ? secs : null;
    },
  },
  // 8. Korean seconds: "30초", "30 초", "90초", "15초짜리"
  {
    re: new RegExp(`${NUM_START}(\\d{1,6})(?!\\.\\d)\\s*초${KO_SEC_FOLLOW}`, 'g'),
    parse: (m) => Number(m[1]),
  },
  // 9. Korean minutes (integer or decimal): "1분", "1.5분", "2분짜리"
  {
    re: new RegExp(`${NUM_START}(\\d{1,4}(?:\\.\\d+)?)\\s*분${KO_MIN_FOLLOW}`, 'g'),
    parse: (m) => Math.round(Number(m[1]) * 60),
  },
  // 10. English explicit seconds: "15 sec", "45 secs", "15 second", "30-second", "15 seconds"
  {
    re: new RegExp(`${NUM_START}(\\d{1,6})(?!\\.\\d)\\s*-?\\s*(?:sec|secs|second|seconds)\\b`, 'gi'),
    parse: (m) => Number(m[1]),
  },
  // 11. English bare `s` suffix: "15s", "45 s" — ONLY when not a multiple of 10 (ignores "10s", "20s", "30s", "70s", "80s", "90s")
  {
    re: new RegExp(`${NUM_START}(\\d{1,6})(?!\\.\\d)\\s*s\\b`, 'gi'),
    parse: (m) => {
      const n = Number(m[1]);
      if (n === 0) return null;
      if (n % 10 === 0) return undefined;
      return n;
    },
  },
  // 12. English minutes (integer or decimal): "1 min", "1.5 min", "2 mins", "1 minute", "2 minutes", "2-minute"
  {
    re: new RegExp(`${NUM_START}(\\d{1,4}(?:\\.\\d+)?)\\s*-?\\s*(?:min|mins|minute|minutes)\\b`, 'gi'),
    parse: (m) => Math.round(Number(m[1]) * 60),
  },
];

function overlaps(spans: readonly SpanMatch[], start: number, end: number): boolean {
  return spans.some((s) => s.start < end && start < s.end);
}

export function parseRequestedSeconds(text: string): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  const spans: SpanMatch[] = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(spans, start, end)) continue;
      const parsed = rule.parse(match);
      if (parsed === undefined) continue;
      spans.push({ start, end, seconds: parsed });
    }
  }

  if (spans.length === 0) return null;
  if (spans.some((s) => s.seconds === null)) return null;

  const distinct = new Set(spans.map((s) => s.seconds as number));
  if (distinct.size !== 1) return null;

  const [only] = distinct;
  if (only === undefined || !Number.isInteger(only) || only < 1 || only > MAX_REQUESTED_SECONDS) return null;
  return only;
}
