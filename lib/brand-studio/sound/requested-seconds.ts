/**
 * Pure parser for explicit song/audio lengths written in a customer's brief (`parseRequestedSeconds`).
 *
 * Client- and server-safe (zero dependencies). Prefers `null` over a guess:
 *  - Only explicit duration units count:
 *    - Korean: `초`, `분` (excluding fractions like `3분의 1` and non-time compounds like `분기`, `분할`, `초반`),
 *      combined `1분 30초`, and decimal minutes `1.5분`.
 *    - English: `sec`, `secs`, `second`, `seconds`, `min`, `mins`, `minute`, `minutes`,
 *      combined `1 min 30 sec`, and decimal minutes `1.5 min`.
 *    - Bare `s` (`15s`, `45s`, `iPhone 6s`, `TOP 3s`, `80s`) is NEVER treated as a duration (`null`).
 *  - Ranges (`-`, `~`, `–`, `—`, `to`, `에서`, whether unit is on both sides like `15초-30초` / `1분~1분 30초` /
 *    `15 sec to 30 sec`, on the right like `10-15초`, or on the left like `15초에서 30`) count as ONE duration and
 *    return the UPPER bound.
 *  - More than one distinct duration in the same text (`15초 인트로가 있는 1분짜리 곡`) returns `null` (ambiguous).
 *  - Zero, negative (`0초`, `-15초`, `-15 sec`), or values above 600 s (`601초`, `1000초`) return `null`.
 */

const MAX_REQUESTED_SECONDS = 600;

interface SpanMatch {
  start: number;
  end: number;
  /** Parsed whole seconds, or `null` when a matched duration expression is invalid (e.g. inverted range or `1분 60초`). */
  seconds: number | null;
}

interface SpanRule {
  re: RegExp;
  parse: (match: RegExpExecArray) => number | null;
}

const KO_MIN_FOLLOW = String.raw`(?!\s*의\s*\d)(?![기할위율량류자모석야])`;
const KO_SEC_FOLLOW = String.raw`(?![과점기보등중고원콜반])`;
const NUM_START = String.raw`(?<![A-Za-z0-9_./:'’−~–—-])`;

const SINGLE_KO_COMPOUND = String.raw`\d{1,3}(?!\.\d)\s*분${KO_MIN_FOLLOW}\s*\d{1,2}(?!\.\d)\s*초${KO_SEC_FOLLOW}`;
const SINGLE_EN_COMPOUND = String.raw`\d{1,3}(?!\.\d)\s*-?\s*(?:min|mins|minute|minutes)\s*(?:and\s+)?\d{1,2}(?!\.\d)\s*-?\s*(?:sec|secs|second|seconds)\b`;
const SINGLE_KO_SEC = String.raw`\d{1,6}(?!\.\d)\s*초${KO_SEC_FOLLOW}`;
const SINGLE_KO_MIN = String.raw`\d{1,4}(?:\.\d+)?\s*분${KO_MIN_FOLLOW}`;
const SINGLE_EN_SEC = String.raw`\d{1,6}(?!\.\d)\s*-?\s*(?:sec|secs|second|seconds)\b`;
const SINGLE_EN_MIN = String.raw`\d{1,4}(?:\.\d+)?\s*-?\s*(?:min|mins|minute|minutes)\b`;

/** Non-capturing alternation of all valid single explicit durations (compounds first). */
const SINGLE_SRC = String.raw`(?:${SINGLE_KO_COMPOUND}|${SINGLE_EN_COMPOUND}|${SINGLE_KO_SEC}|${SINGLE_KO_MIN}|${SINGLE_EN_SEC}|${SINGLE_EN_MIN})`;

const RANGE_CONN = String.raw`(?:\s*(?:~|–|—|-|에서)\s*|\s+to\s+)`;
const LEFT_UNIT_BARE_RIGHT_CONN = String.raw`(?:\s*(?:~|–|—|에서)\s*|\s+to\s+|(?<!\s)-(?!\s))`;
const BARE_RIGHT_END = String.raw`(?=$|[\s,.)\]!?;:]|(?:사이|정도|내외|쯤|가량))` +
  String.raw`(?!\s*(?:bpm|절|마디|분기|분할|년|월|일|시간|시|대|개|번|위|차|회|%|khz|hz|bit)\b)`;

const EXACT_KO_COMPOUND = new RegExp(`^(${  String.raw`\d{1,3}`  })\\s*분\\s*(${  String.raw`\d{1,2}`  })\\s*초$`);
const EXACT_EN_COMPOUND = new RegExp(
  `^(\\d{1,3})\\s*-?\\s*(?:min|mins|minute|minutes)\\s*(?:and\\s+)?(\\d{1,2})\\s*-?\\s*(?:sec|secs|second|seconds)$`,
  'i',
);
const EXACT_KO_SEC = /^(\d{1,6})\s*초$/;
const EXACT_KO_MIN = /^(\d{1,4}(?:\.\d+)?)\s*분$/;
const EXACT_EN_SEC = /^(\d{1,6})\s*-?\s*(?:sec|secs|second|seconds)$/i;
const EXACT_EN_MIN = /^(\d{1,4}(?:\.\d+)?)\s*-?\s*(?:min|mins|minute|minutes)$/i;

function parseSingleExpr(raw: string): { seconds: number | null; unit: 'sec' | 'min' | 'compound' } | null {
  const s = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = EXACT_KO_COMPOUND.exec(s)) !== null || (m = EXACT_EN_COMPOUND.exec(s)) !== null) {
    const mins = Number(m[1]);
    const secs = Number(m[2]);
    return { seconds: secs < 60 ? mins * 60 + secs : null, unit: 'compound' };
  }
  if ((m = EXACT_KO_SEC.exec(s)) !== null || (m = EXACT_EN_SEC.exec(s)) !== null) {
    return { seconds: Number(m[1]), unit: 'sec' };
  }
  if ((m = EXACT_KO_MIN.exec(s)) !== null || (m = EXACT_EN_MIN.exec(s)) !== null) {
    return { seconds: Math.round(Number(m[1]) * 60), unit: 'min' };
  }
  return null;
}

const RULES: readonly SpanRule[] = [
  // 1. Range with explicit duration on BOTH sides: "15초-30초", "15초~30초", "15초에서 30초", "15 sec to 30 sec", "1분~1분 30초"
  {
    re: new RegExp(`${NUM_START}(${SINGLE_SRC})${RANGE_CONN}(${SINGLE_SRC})`, 'gi'),
    parse: (m) => {
      const left = parseSingleExpr(m[1]!);
      const right = parseSingleExpr(m[2]!);
      if (!left || !right || left.seconds === null || right.seconds === null) return null;
      return left.seconds >= 1 && right.seconds >= left.seconds ? right.seconds : null;
    },
  },
  // 2. Range with number on LEFT and explicit duration on RIGHT: "10-15초", "10~15초", "5 to 10 seconds", "1~1.5분"
  {
    re: new RegExp(`${NUM_START}(\\d{1,6}(?:\\.\\d+)?)${RANGE_CONN}(${SINGLE_SRC})`, 'gi'),
    parse: (m) => {
      const rawLow = Number(m[1]);
      const hasDecimal = m[1]!.includes('.');
      const right = parseSingleExpr(m[2]!);
      if (!right || right.seconds === null || !Number.isFinite(rawLow) || rawLow <= 0) return null;
      if (right.unit === 'sec' && hasDecimal) return null;
      const lowSeconds = right.unit === 'sec' ? rawLow : Math.round(rawLow * 60);
      return lowSeconds >= 1 && right.seconds >= lowSeconds ? right.seconds : null;
    },
  },
  // 3. Range with explicit duration on LEFT and bare number on RIGHT: "15초~30", "15초에서 30", "15 sec to 30"
  {
    re: new RegExp(`${NUM_START}(${SINGLE_SRC})${LEFT_UNIT_BARE_RIGHT_CONN}(\\d{1,6}(?:\\.\\d+)?)${BARE_RIGHT_END}`, 'gi'),
    parse: (m) => {
      const left = parseSingleExpr(m[1]!);
      const rawHigh = Number(m[2]);
      const hasDecimal = m[2]!.includes('.');
      if (!left || left.seconds === null || left.unit === 'compound' || !Number.isFinite(rawHigh) || rawHigh <= 0) return null;
      if (left.unit === 'sec' && hasDecimal) return null;
      const highSeconds = left.unit === 'sec' ? rawHigh : Math.round(rawHigh * 60);
      return left.seconds >= 1 && highSeconds >= left.seconds && Number.isInteger(highSeconds) ? highSeconds : null;
    },
  },
  // 4. Single explicit duration: "30초", "1분 30초", "1.5분", "15 sec", "30-second", "1 min 30 sec", "1.5 min"
  {
    re: new RegExp(`${NUM_START}(${SINGLE_SRC})`, 'gi'),
    parse: (m) => parseSingleExpr(m[1]!)?.seconds ?? null,
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
      spans.push({ start, end, seconds: rule.parse(match) });
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
