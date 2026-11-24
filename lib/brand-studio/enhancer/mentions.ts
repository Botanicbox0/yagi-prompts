/**
 * Reference mentions in a customer's prompt ("이미지 2", "image 1", "영상 1", "두 번째 사진", "@1").
 *
 * Client-safe on purpose (no imports): the prompt bar uses it to stop a run whose prompt names a
 * reference that is not in the tray (`reference_missing`), and the server runs the same check.
 *
 * Numbering, as the tray shows it:
 *  - a kind word plus a number ("이미지 2", "video 1") is the Nth reference OF THAT KIND in tray order;
 *  - a bare "@N" is the Nth chip in the tray, whatever its kind.
 * Counts are not mentions: "이미지 2장", "영상 15초", "image 16:9", "video 1080p" are skipped.
 */

export type MentionKind = 'image' | 'video' | 'audio';

export interface ReferenceMention {
  /** `any` for a bare "@N" (the Nth chip in the tray). */
  kind: MentionKind | 'any';
  /** 1-based. A list ("이미지 1, 2") yields one mention per number, sharing the span. */
  number: number;
  /** The span in the prompt that names it, for highlighting and rewriting. */
  start: number;
  end: number;
}

const KO_NOUNS: Record<MentionKind, readonly string[]> = {
  image: ['이미지', '사진', '그림'],
  video: ['동영상', '영상', '비디오', '클립'],
  audio: ['오디오', '사운드', '음원'],
};
const EN_NOUNS: Record<MentionKind, readonly string[]> = {
  image: ['images?', 'img', 'pictures?', 'pics?', 'photos?', 'figures?', 'fig\\.?'],
  video: ['videos?', 'vids?', 'clips?'],
  audio: ['audios?', 'sounds?', 'tracks?'],
};
const KINDS: readonly MentionKind[] = ['image', 'video', 'audio'];

const KO_ORDINALS: Record<string, number> = {
  첫: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};
const KO_ORDINAL_SHORT: Record<string, number> = { 첫째: 1, 둘째: 2, 셋째: 3, 넷째: 4, 다섯째: 5 };
const EN_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/**
 * What may follow a number for it to be a count, a size or a time rather than a reference.
 * Korean counters are checked against the common words they start ("배경", "분위기", "장면").
 */
const NOT_A_REFERENCE = new RegExp(
  [
    '^\\s?(?:장(?!면|소)|개(?!선|성|념|월)|컷|편(?!집)|매|가지|프레임|초(?!반|안|점|록)|분(?!위기|량|리|석|홍|위)',
    '|배(?!경|치|열|색|송|우)|종(?!류)|명(?!도|암|함)|살|퍼센트)',
    '|^\\s*(?:%|px\\b|p\\b|k\\b|s\\b|secs?\\b|seconds?\\b|mins?\\b|minutes?\\b|fps\\b|frames?\\b|times\\b|x\\b|×)',
    '|^(?:[:./]\\d|,\\d{3})',
  ].join(''),
  'i',
);

const LIST_JOINER = /^\s*(?:,|&|and|or|과|와|및|랑|이랑|·|\/)\s*(\d{1,2})(?!\d)/i;
const RANGE_JOINER = /^\s*(?:~|-|–|to|부터)\s*(\d{1,2})(?!\d)/i;

function nounGroup(kind: MentionKind): string {
  return `(?:${KO_NOUNS[kind].join('|')}|(?<![A-Za-z])(?:${EN_NOUNS[kind].join('|')})(?![A-Za-z]))`;
}

/** "이미지 2", "@image2", "video #1", "images 1 and 3" (the list tail is read separately). */
const NOUN_NUMBER = KINDS.map((kind) => ({
  kind,
  re: new RegExp(`@?${nounGroup(kind)}\\s*(?:#|no\\.\\s*)?\\s*(\\d{1,2})(?!\\d)`, 'gi'),
}));

/** "두 번째 이미지", "1번 사진", "2번째 영상", "첫째 그림", "the second image". */
const ORDINAL_NOUN = KINDS.map((kind) => ({
  kind,
  re: new RegExp(
    `(?:(첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열|\\d{1,2})\\s*번\\s*(?:째)?|(첫째|둘째|셋째|넷째|다섯째)|(?<![A-Za-z])(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))\\s*(?:의\\s*)?${nounGroup(kind)}`,
    'gi',
  ),
}));

/** A bare "@3": the third chip in the tray. */
const BARE_AT = /(?<![\w@])@\s?(\d{1,2})(?!\d)(?![A-Za-z])/g;

function readTail(prompt: string, from: number, first: number): { numbers: number[]; end: number } {
  const numbers = [first];
  let end = from;
  for (let guard = 0; guard < 12; guard += 1) {
    const rest = prompt.slice(end);
    const range = RANGE_JOINER.exec(rest);
    if (range) {
      const to = Number(range[1]);
      const tail = rest.slice(range[0].length);
      if (NOT_A_REFERENCE.test(tail)) break;
      const last = numbers[numbers.length - 1]!;
      if (to > last && to - last <= 10) {
        for (let n = last + 1; n <= to; n += 1) numbers.push(n);
        end += range[0].length;
        continue;
      }
      break;
    }
    const item = LIST_JOINER.exec(rest);
    if (!item) break;
    const tail = rest.slice(item[0].length);
    if (NOT_A_REFERENCE.test(tail)) break;
    numbers.push(Number(item[1]));
    end += item[0].length;
  }
  return { numbers, end };
}

/** Every reference mention in the prompt, in reading order. */
export function listReferenceMentions(prompt: string): ReferenceMention[] {
  const found: ReferenceMention[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const push = (kind: ReferenceMention['kind'], numbers: number[], start: number, end: number) => {
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    for (const number of numbers) if (number >= 1) found.push({ kind, number, start, end });
  };

  for (const { kind, re } of ORDINAL_NOUN) {
    re.lastIndex = 0;
    for (let m = re.exec(prompt); m; m = re.exec(prompt)) {
      const word = m[1] ?? m[2] ?? m[3] ?? '';
      const number = /^\d+$/.test(word)
        ? Number(word)
        : (KO_ORDINALS[word] ?? KO_ORDINAL_SHORT[word] ?? EN_ORDINALS[word.toLowerCase()] ?? 0);
      push(kind, [number], m.index, m.index + m[0].length);
    }
  }
  for (const { kind, re } of NOUN_NUMBER) {
    re.lastIndex = 0;
    for (let m = re.exec(prompt); m; m = re.exec(prompt)) {
      const afterNumber = m.index + m[0].length;
      if (NOT_A_REFERENCE.test(prompt.slice(afterNumber))) continue;
      const tail = readTail(prompt, afterNumber, Number(m[1]));
      push(kind, tail.numbers, m.index, tail.end);
    }
  }
  BARE_AT.lastIndex = 0;
  for (let m = BARE_AT.exec(prompt); m; m = BARE_AT.exec(prompt)) {
    const afterNumber = m.index + m[0].length;
    if (NOT_A_REFERENCE.test(prompt.slice(afterNumber))) continue;
    push('any', [Number(m[1])], m.index, afterNumber);
  }
  return found.sort((a, b) => a.start - b.start || a.number - b.number);
}

/**
 * The numbers of one kind the prompt names, sorted and unique. `any` returns bare "@N" numbers
 * (tray positions); a kind word returns per-kind numbers.
 */
export function findReferenceMentions(prompt: string, kind: MentionKind | 'any'): number[] {
  const numbers = listReferenceMentions(prompt)
    .filter((m) => m.kind === kind)
    .map((m) => m.number);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/**
 * Mentions that point at nothing in the tray. `tray` is the kinds of the attached references in
 * tray order. Empty means the prompt is safe to send (otherwise answer `reference_missing`).
 */
export function findMissingReferences(
  prompt: string,
  tray: readonly MentionKind[],
): Array<{ kind: MentionKind | 'any'; number: number }> {
  const count = (kind: MentionKind) => tray.filter((k) => k === kind).length;
  const missing = new Map<string, { kind: MentionKind | 'any'; number: number }>();
  for (const m of listReferenceMentions(prompt)) {
    const limit = m.kind === 'any' ? tray.length : count(m.kind);
    if (m.number > limit) missing.set(`${m.kind}:${m.number}`, { kind: m.kind, number: m.number });
  }
  return [...missing.values()];
}

/** The word for a new number in the same family as the one written ("두" → "세", "첫째" → "둘째", "second" → "first"). */
function ordinalWordFor(written: string, to: number): string | null {
  const pick = (table: Record<string, number>) => Object.keys(table).find((word) => table[word] === to) ?? null;
  if (Object.hasOwn(KO_ORDINAL_SHORT, written)) return pick(KO_ORDINAL_SHORT) ?? `${to}번째`;
  if (Object.hasOwn(KO_ORDINALS, written)) return pick(KO_ORDINALS) ?? String(to);
  return pick(EN_ORDINALS);
}

const ORDINAL_WORD_START = new RegExp(
  `^(${[...Object.keys(KO_ORDINAL_SHORT), ...Object.keys(KO_ORDINALS), ...Object.keys(EN_ORDINALS)].sort((a, b) => b.length - a.length).join('|')})`,
  'i',
);

/** One mention's text with its numbers renumbered, written the same way. */
function renumberSpan(text: string, numbers: readonly number[], map: (n: number) => number): string {
  const digits = [...text.matchAll(/\d{1,2}/g)];
  // A range ("이미지 1~3", "image 1-2") is never rewritten number by number: "2~1" or "1~3" would name other pictures.
  const ranged = digits.some((d) => RANGE_JOINER.test(text.slice(d.index! + d[0].length)));
  if (digits.length === numbers.length && digits.length && !ranged) {
    let out = text;
    for (const d of digits.reverse()) out = out.slice(0, d.index) + String(map(Number(d[0]))) + out.slice(d.index! + d[0].length);
    return out;
  }
  const mapped = numbers.map(map);
  if (mapped.every((n, i) => n === numbers[i])) return text;
  if (digits.length) {
    // The same pictures in another order: the range still names exactly them.
    const same = [...mapped].sort((a, b) => a - b).join() === [...numbers].sort((a, b) => a - b).join();
    if (same) return text;
    // Otherwise spelled out as a list ("이미지 1, 3"), which the matcher reads as those pictures.
    const first = digits[0]!;
    const last = digits[digits.length - 1]!;
    return text.slice(0, first.index) + mapped.join(', ') + text.slice(last.index! + last[0].length);
  }
  // An ordinal word ("두 번째 이미지", "첫째 그림", "the second image").
  const word = ORDINAL_WORD_START.exec(text)?.[1];
  const english = Boolean(word && Object.hasOwn(EN_ORDINALS, word.toLowerCase()));
  const next = word ? ordinalWordFor(english ? word.toLowerCase() : word, mapped[0]!) : null;
  if (!word || !next) return text;
  // "Second image" stays capitalised: "First image".
  const cased = english && word[0] !== word[0]!.toLowerCase() ? next[0]!.toUpperCase() + next.slice(1) : next;
  return cased + text.slice(word.length);
}

/**
 * Gives every mention a new number, written the way it was typed: "@image1" → "@image2", "두 번째 이미지" →
 * "세 번째 이미지", "images 1 and 3" → "images 2 and 1". `renumber` answers the new number, or null to leave
 * that number as written (a mention of nothing). Used when a reference moves in the tray.
 */
export function renumberReferenceMentions(prompt: string, renumber: (kind: MentionKind | 'any', number: number) => number | null): string {
  const spans = new Map<string, { kind: MentionKind | 'any'; start: number; end: number; numbers: number[] }>();
  for (const m of listReferenceMentions(prompt)) {
    const key = `${m.start}:${m.end}`;
    const span = spans.get(key) ?? { kind: m.kind, start: m.start, end: m.end, numbers: [] };
    span.numbers.push(m.number);
    spans.set(key, span);
  }
  let out = prompt;
  for (const span of [...spans.values()].sort((a, b) => b.start - a.start)) {
    const map = (n: number) => {
      const to = renumber(span.kind, n);
      return to !== null && to >= 1 ? to : n;
    };
    const text = prompt.slice(span.start, span.end);
    const next = renumberSpan(text, span.numbers, map);
    if (next !== text) out = out.slice(0, span.start) + next + out.slice(span.end);
  }
  return out;
}

/**
 * Rewrites every mention with `resolve` (kind, number) -> replacement. A mention the resolver
 * returns null for is left as written. Lists become "A, B and C".
 */
export function rewriteReferenceMentions(
  prompt: string,
  resolve: (kind: MentionKind | 'any', number: number) => string | null,
): string {
  const spans = new Map<string, { start: number; end: number; parts: Array<string | null> }>();
  for (const m of listReferenceMentions(prompt)) {
    const key = `${m.start}:${m.end}`;
    const span = spans.get(key) ?? { start: m.start, end: m.end, parts: [] };
    span.parts.push(resolve(m.kind, m.number));
    spans.set(key, span);
  }
  let out = prompt;
  const ordered = [...spans.values()].sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    if (span.parts.some((p) => p === null)) continue;
    const parts = span.parts as string[];
    const text = parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    out = out.slice(0, span.start) + text + out.slice(span.end);
  }
  return out;
}
