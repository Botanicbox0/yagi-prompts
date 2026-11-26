/**
 * The outgoing check (docs/PROMPT-GUARD.md "The outgoing check"): does a model's free-text answer carry the
 * internal text of the call that produced it? Pure and mode-free; `lib/ai-guard/request.ts` applies the
 * mode. It answers with reason codes and numbers, never with text.
 *
 * Inputs: the answer's free-text fields; the exact internal text of the call; the call's canary; the
 * customer's own input (`exempt`: text the customer gave us may come back); and our fixed lines that are
 * meant to appear in the answer (`allow`). A window that also occurs in `exempt` or `allow` never counts.
 *
 * What it reads, in order, for every field and then for all fields joined (both orders):
 *   1. the canary, whole, in 10-character pieces, or as a spread-out subsequence, in the text and in every
 *      decoded reading of it;
 *   2. the field's shape (length, lines, markup) and whether it reads as prose at all (letters of other
 *      scripts, base64-like runs, runs of byte-like tokens);
 *   3. overlap with the internal text: runs, shares and in-order chains (see the thresholds), in the text and
 *      in every decoded reading (base64, hex, decimal bytes, percent, escapes, every Caesar shift, atbash,
 *      reversals, leetspeak, spelled letters; decoded readings are read once more).
 */
import 'server-only';
import { charGrams, foldText, hangulStream, latinStream, STOPWORDS, wordGrams, wordUnits } from './text';

/* ------------------------------------------------------------------ thresholds
 * Chosen by measurement (docs/PROMPT-GUARD.md "How the thresholds were chosen"): zero refusals on every
 * stored answer the repository's tests give the two reference sites, and on 4,090 Korean product strings
 * against two Korean internal texts.
 */

/** Any run of this many words shared with the internal text refuses (the coordinator's decision). */
export const RUN_WORDS = 8;
/** Latin letters and digits in a row, spacing and punctuation ignored (≈ 9 English words). */
export const RUN_LATIN_CHARS = 48;
/** Hangul syllables in a row, spacing and punctuation ignored (≈ 4 Korean words). */
export const RUN_HANGUL = 12;
/** Share of the answer's 5-word windows found in the internal text. */
export const SHARE_WORDS_N = 5;
export const SHARE_WORDS_LIMIT = 0.35;
/** This many shared 5-word windows refuse whatever the answer's length (padding cannot dilute them). */
export const SHARE_WORDS_COUNT = 30;
/** Share of the answer's 4-syllable windows found in the internal text (Korean paraphrase with new particles). */
export const SHARE_HANGUL_N = 4;
export const SHARE_HANGUL_LIMIT = 0.4;
/** A share is only judged on an answer with at least this many windows. */
export const SHARE_MIN_WINDOWS = 12;
/**
 * Words in the order the internal text has them, with at most `GAPPED_MAX_GAP - 1` internal words skipped
 * between neighbours ("every other / third word") and at most `GAPPED_ANSWER_SKIP` inserted answer words ("a
 * filler or two every few words"), counted only with enough content words.
 */
export const GAPPED_MIN_WORDS = 12;
export const GAPPED_MAX_GAP = 3;
export const GAPPED_ANSWER_SKIP = 3;
export const GAPPED_MIN_CONTENT_WORDS = 6;
/** A piece of the canary this long anywhere in the answer refuses. */
export const CANARY_FRAGMENT = 10;
/** This many canary characters in order, at most `CANARY_SPREAD_GAP` other characters between neighbours, refuse. */
export const CANARY_SPREAD = 14;
export const CANARY_SPREAD_GAP = 4;
/** Pieces of the canary, each `CANARY_PIECE` characters or longer, in order at any distance, that add up to `CANARY_SPREAD` characters refuse. */
export const CANARY_PIECE = 4;
/** A base64-looking run this long (with upper case, lower case and digits; product codes are far shorter) is not prose. */
export const UNREADABLE_BASE64 = 64;
/** This many byte-like tokens in a row (hex pairs, 0x.., binary octets, Morse) are not prose. */
export const UNREADABLE_TOKENS = 8;
/** More letters than this of scripts other than Latin, Hangul, Han and Kana than the customer wrote are not prose. */
export const UNREADABLE_OTHER_SCRIPT = 80;
/** Output windows that also occur in `exempt` or `allow` are masked (character runs and chains stop there). */
const MASK_WORDS = 4;

export type GuardReason =
  | 'canary'
  | 'overlap_run'
  | 'overlap_share'
  | 'overlap_gapped'
  | 'encoded'
  | 'shape_length'
  | 'shape_lines'
  | 'shape_markup';

/** Per-field limits. `oneSentence`: no line breaks, lists, headings, code or tags. */
export interface FieldShape {
  maxChars?: number;
  maxLines?: number;
  oneSentence?: boolean;
  /** Code fences, headings and tag-like markup are refused (implied by `oneSentence`). */
  noMarkup?: boolean;
}

export interface OutgoingInput {
  /** The model's free-text fields, as they would leave (shown, stored or sent). */
  fields: Readonly<Record<string, string>>;
  /** The exact internal text of this call (the system part as sent, and our own labels in the user part). */
  internal: string | readonly string[];
  /** The call's canary, or null when the request carried none. */
  canary: string | null;
  /** The customer's own input for this call: windows that also occur here never count. */
  exempt?: readonly string[];
  /** Our fixed lines that are meant to appear in the answer: windows that also occur here never count. */
  allow?: readonly string[];
  shapes?: Readonly<Record<string, FieldShape>>;
}

/** Numbers only, for the log line and for measurement. */
export interface FieldSignals {
  chars: number;
  lines: number;
  /** Meta words ("instruction", "규칙" …) the customer did not write: a signal, never a refusal reason. */
  metaWords: number;
}

export interface FieldRefusal {
  field: string;
  reason: GuardReason;
  /** Which detector fired (word_run, latin_run, hangul_run, word_share, gapped, unreadable, base64, caesar7 …). */
  detector: string;
}

export interface OutgoingVerdict {
  ok: boolean;
  /** One entry per refused field (and `*` for a copy split across fields). */
  refusals: FieldRefusal[];
  signals: Record<string, FieldSignals>;
}

/* ------------------------------------------------------------------ corpora */

/** One or more texts read as unit streams; windows never cross from one text into the next. */
export class Corpus {
  private readonly words: string[][];
  private readonly latin: string[];
  private readonly hangul: string[];
  private readonly cache = new Map<string, Set<string>>();
  private positionsCache: Map<string, number[]> | null = null;

  constructor(texts: readonly string[]) {
    const folded = texts.filter((t) => t.length > 0).map(foldText);
    this.words = folded.map(wordUnits);
    this.latin = folded.map(latinStream);
    this.hangul = folded.map(hangulStream);
  }

  private set(key: string, build: () => string[]): Set<string> {
    let hit = this.cache.get(key);
    if (!hit) {
      hit = new Set(build());
      this.cache.set(key, hit);
    }
    return hit;
  }

  wordSet(n: number): Set<string> {
    return this.set(`w${n}`, () => this.words.flatMap((w) => wordGrams(w, n)));
  }

  latinSet(n: number): Set<string> {
    return this.set(`l${n}`, () => this.latin.flatMap((s) => charGrams(s, n)));
  }

  hangulSet(n: number): Set<string> {
    return this.set(`h${n}`, () => this.hangul.flatMap((s) => charGrams(s, n)));
  }

  /** Word → its positions, over all texts with a gap between texts (for the in-order search). */
  positions(): Map<string, number[]> {
    if (!this.positionsCache) {
      const map = new Map<string, number[]>();
      let at = 0;
      for (const words of this.words) {
        for (const w of words) {
          const list = map.get(w);
          if (list) list.push(at);
          else map.set(w, [at]);
          at += 1;
        }
        at += GAPPED_MAX_GAP + 1;
      }
      this.positionsCache = map;
    }
    return this.positionsCache;
  }
}

/* ------------------------------------------------------------------ detectors */

/**
 * An answer read for the detectors. `masked[i]` is true for a word inside a `MASK_WORDS`-word window that
 * also occurs in the exempt or allowed text. The character streams are cut at masked words, so a window
 * never runs from the answer's own words into the customer's words or an allowed line (where the last
 * letters of one word and the first of the next could match the internal text by chance).
 */
export interface Unit {
  words: string[];
  masked: boolean[];
  latin: string[];
  hangul: string[];
}

export function unitsOf(text: string, permitted: Corpus | null): Unit {
  const words = wordUnits(foldText(text));
  const masked = new Array<boolean>(words.length).fill(false);
  if (permitted) {
    const allowed = permitted.wordSet(MASK_WORDS);
    for (let i = 0; i + MASK_WORDS <= words.length; i += 1) {
      if (allowed.has(words.slice(i, i + MASK_WORDS).join(' '))) for (let k = i; k < i + MASK_WORDS; k += 1) masked[k] = true;
    }
  }
  const latin: string[] = [];
  const hangul: string[] = [];
  let l = '';
  let h = '';
  for (let i = 0; i <= words.length; i += 1) {
    if (i === words.length || masked[i]) {
      if (l) latin.push(l);
      if (h) hangul.push(h);
      l = '';
      h = '';
      continue;
    }
    l += latinStream(words[i]!);
    h += hangulStream(words[i]!);
  }
  return { words, masked, latin, hangul };
}

function sharedWindow(grams: readonly string[], internal: Set<string>, permitted: Set<string>): boolean {
  return grams.some((g) => internal.has(g) && !permitted.has(g));
}

function sharedCount(grams: readonly string[], internal: Set<string>, permitted: Set<string>): number {
  let shared = 0;
  for (const g of grams) if (internal.has(g) && !permitted.has(g)) shared += 1;
  return shared;
}

/** Thresholds a detector run uses; the defaults are the module constants (tests measure other values). */
export interface Thresholds {
  runWords: number;
  runLatin: number;
  runHangul: number;
  shareWords: number;
  shareHangul: number;
  gappedWords: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  runWords: RUN_WORDS,
  runLatin: RUN_LATIN_CHARS,
  runHangul: RUN_HANGUL,
  shareWords: SHARE_WORDS_LIMIT,
  shareHangul: SHARE_HANGUL_LIMIT,
  gappedWords: GAPPED_MIN_WORDS,
};

/** Contiguous copies: a word run, a Latin character run or a Hangul syllable run. */
export function runDetector(u: Unit, internal: Corpus, permitted: Corpus, t: Thresholds = DEFAULT_THRESHOLDS): string | null {
  if (sharedWindow(wordGrams(u.words, t.runWords), internal.wordSet(t.runWords), permitted.wordSet(t.runWords))) return 'word_run';
  if (sharedWindow(u.latin.flatMap((s) => charGrams(s, t.runLatin)), internal.latinSet(t.runLatin), permitted.latinSet(t.runLatin))) return 'latin_run';
  if (sharedWindow(u.hangul.flatMap((s) => charGrams(s, t.runHangul)), internal.hangulSet(t.runHangul), permitted.hangulSet(t.runHangul))) return 'hangul_run';
  return null;
}

/** The share of the answer's 5-word windows found in the internal text (0 below `SHARE_MIN_WINDOWS` windows). */
export function wordShare(u: Unit, internal: Corpus, permitted: Corpus): number {
  const grams = wordGrams(u.words, SHARE_WORDS_N);
  if (grams.length < SHARE_MIN_WINDOWS) return 0;
  return sharedCount(grams, internal.wordSet(SHARE_WORDS_N), permitted.wordSet(SHARE_WORDS_N)) / grams.length;
}

/** How many of the answer's 5-word windows the internal text has (not exempt, not allowed). */
export function wordShareCount(u: Unit, internal: Corpus, permitted: Corpus): number {
  return sharedCount(wordGrams(u.words, SHARE_WORDS_N), internal.wordSet(SHARE_WORDS_N), permitted.wordSet(SHARE_WORDS_N));
}

export function hangulShare(u: Unit, internal: Corpus, permitted: Corpus): number {
  const grams = u.hangul.flatMap((s) => charGrams(s, SHARE_HANGUL_N));
  if (grams.length < SHARE_MIN_WINDOWS) return 0;
  return sharedCount(grams, internal.hangulSet(SHARE_HANGUL_N), permitted.hangulSet(SHARE_HANGUL_N)) / grams.length;
}

/**
 * The longest stretch of answer words that the internal text has in the same order: between neighbours the
 * internal text may skip up to `GAPPED_MAX_GAP - 1` words and the answer may insert `GAPPED_ANSWER_SKIP` of its own.
 * Counted only with `GAPPED_MIN_CONTENT_WORDS` content words; masked (exempt or allowed) words break it.
 */
export function gappedLength(u: Unit, internal: Corpus): number {
  const { words, masked } = u;
  const positions = internal.positions();
  let best = 0;
  type Chain = { length: number; content: number };
  // Chains ending at each of the last `GAPPED_ANSWER_SKIP + 1` answer words, by internal position.
  const recent: Array<Map<number, Chain>> = [];
  for (let j = 0; j < words.length; j += 1) {
    const current = new Map<number, Chain>();
    const word = words[j]!;
    const content = STOPWORDS.has(word) ? 0 : 1;
    if (!masked[j]) {
      for (const p of positions.get(word) ?? []) {
        let chain: Chain = { length: 1, content };
        for (let gap = 1; gap <= GAPPED_MAX_GAP; gap += 1) {
          for (const map of recent) {
            const before = map.get(p - gap);
            if (before && before.length + 1 > chain.length) chain = { length: before.length + 1, content: before.content + content };
          }
        }
        current.set(p, chain);
        if (chain.content >= GAPPED_MIN_CONTENT_WORDS && chain.length > best) best = chain.length;
      }
    }
    recent.unshift(current);
    if (recent.length > GAPPED_ANSWER_SKIP + 1) recent.pop();
  }
  return best;
}

/* ------------------------------------------------------------------ prose or not */

/**
 * Scripts whose letters exist in our answers mostly as look-alikes of Latin ones (Lisu "ꓮꓐꓚ", Cherokee,
 * Canadian syllabics, Coptic, Tifinagh, Vai, Bamum, Old Italic, Glagolitic, Runic): a letter from them refuses,
 * even when the request carries it too (the attacker can type the alphabet into the request).
 */
const LOOK_ALIKE_SCRIPT =
  /[\p{Script=Lisu}\p{Script=Cherokee}\p{Script=Canadian_Aboriginal}\p{Script=Coptic}\p{Script=Tifinagh}\p{Script=Vai}\p{Script=Bamum}\p{Script=Old_Italic}\p{Script=Glagolitic}\p{Script=Runic}]/u;
/** A word with Latin letters and letters of another alphabet (Cyrillic, Greek, Armenian …): a look-alike swap. */
const OTHER_ALPHABET = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Hebrew}\p{Script=Arabic}]/u;
/** No `/` or `+`: a URL path is not base64 (real base64 of text is caught by the base64 reading anyway). */
const BASE64_RUN = new RegExp(`[A-Za-z0-9]{${UNREADABLE_BASE64},}={0,2}`, 'g');
/**
 * Byte-like: `0x..`, `\x..`, 8-bit binary, or a hex pair that starts with a digit (`4f`, `6c`: ASCII text in hex).
 * A streak counts only with three tokens that carry a hex letter or a prefix, so `10 20 30 …` (a countdown) and
 * grid labels (`A1 B2 C3`) are prose.
 */
const BYTE_TOKEN = /^(?:0x[0-9a-f]{1,2}|\\x[0-9a-f]{2}|[0-9][0-9a-f]|[01]{8})$/i;
const BYTE_MARKED = /^(?:0x|\\x)|[a-f]/i;
const MORSE_TOKEN = /^[.·•\-—–_]{1,7}$/;
const ALLOWED_SCRIPT = /[\p{Script=Latin}\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function otherScriptLetters(text: string): number {
  let n = 0;
  for (const ch of text) if (/\p{L}/u.test(ch) && !ALLOWED_SCRIPT.test(ch)) n += 1;
  return n;
}

/** "ΛURORA": a word in capitals whose only non-Latin letters are one or two Greek capitals is a styled name. */
function styledCapitals(word: string): boolean {
  const others = [...word].filter((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch));
  return others.length <= 2 && others.every((ch) => /\p{Script=Greek}/u.test(ch) && ch !== ch.toLowerCase()) && word === word.toUpperCase();
}

/**
 * Not prose: a letter of a look-alike script; a word mixing Latin letters with another alphabet; a
 * base64-looking run of `UNREADABLE_BASE64`+ characters with upper case, lower case and digits; or
 * `UNREADABLE_TOKENS` byte-like or Morse tokens in a row. A text the customer wrote is never judged here:
 * a mixed word the request has is prose. Numbers, `#rrggbb` colours, `@Image1` tokens, timecodes, product codes
 * and whole words in Cyrillic, Greek, Arabic, Thai … (signage the customer may ask for) are prose.
 */
export function unreadable(text: string, exemptText: string): boolean {
  if (LOOK_ALIKE_SCRIPT.test(text)) return true;
  // Whole text swapped into another alphabet: real signage is short; the customer's own long foreign text is fine.
  const other = otherScriptLetters(text);
  if (other > UNREADABLE_OTHER_SCRIPT && other > otherScriptLetters(exemptText)) return true;
  // Greek letters used as unit signs ("50 μm", "10 kΩ") are not a swap.
  for (const word of text.replace(/[µμΩΔ]/g, ' ').match(/[\p{L}\p{M}]+/gu) ?? []) {
    if (/\p{Script=Latin}/u.test(word) && OTHER_ALPHABET.test(word) && !styledCapitals(word) && !exemptText.includes(word)) return true;
  }
  for (const m of text.matchAll(BASE64_RUN)) {
    const run = m[0];
    if (/[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run) && !exemptText.includes(run)) return true;
  }
  let bytes = 0;
  let marked = 0;
  let morse = 0;
  let dotted = 0;
  for (const token of text.split(/[\s,;/|]+/)) {
    if (!token) continue;
    if (BYTE_TOKEN.test(token)) {
      bytes += 1;
      if (BYTE_MARKED.test(token)) marked += 1;
    } else {
      bytes = 0;
      marked = 0;
    }
    if (MORSE_TOKEN.test(token)) {
      morse += 1;
      if (/[.·•]/.test(token)) dotted += 1;
    } else {
      morse = 0;
      dotted = 0;
    }
    if ((bytes >= UNREADABLE_TOKENS && marked >= 3) || (morse >= UNREADABLE_TOKENS && dotted >= 3)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ encodings */

function printableShare(text: string): number {
  if (!text) return 0;
  let ok = 0;
  let all = 0;
  for (const ch of text) {
    all += 1;
    if (/[\p{L}\p{N}\p{P}\p{Zs}\n]/u.test(ch)) ok += 1;
  }
  return ok / all;
}

/** The bytes as text: UTF-8, or UTF-16 (little or big endian) when every other byte is mostly zero. */
function utf8IfText(bytes: Buffer): string | null {
  const readable = (t: string) => (t.length >= 6 && printableShare(t) >= 0.85 ? t : null);
  const utf8 = readable(bytes.toString('utf8'));
  if (utf8) return utf8;
  if (bytes.length < 12) return null;
  let oddZero = 0;
  let evenZero = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i + 1] === 0) oddZero += 1;
    if (bytes[i] === 0) evenZero += 1;
  }
  const pairs = Math.floor(bytes.length / 2);
  const even = bytes.subarray(0, pairs * 2);
  if (oddZero / pairs >= 0.6) return readable(even.toString('utf16le'));
  if (evenZero / pairs >= 0.6) return readable(Buffer.from(even).swap16().toString('utf16le'));
  return null;
}

function decodeBase64(run: string): string[] {
  const out: string[] = [];
  const clean = run.replace(/\s+/g, '');
  for (let shift = 0; shift < 4; shift += 1) {
    const body = clean.slice(shift).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (body.length < 12) continue;
    const decoded = utf8IfText(Buffer.from(body.slice(0, body.length - (body.length % 4)), 'base64'));
    if (decoded) out.push(decoded);
  }
  return out;
}

function caesar(text: string, shift: number): string {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26) + base);
  });
}

function atbash(text: string): string {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + 25 - (c.charCodeAt(0) - base));
  });
}

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };

const SPELLED: Readonly<Record<string, string>> = {
  alfa: 'a', alpha: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i',
  juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r',
  sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', whisky: 'w', xray: 'x', yankee: 'y', zulu: 'z',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
};

const MORSE: Readonly<Record<string, string>> = {
  '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e', '..-.': 'f', '--.': 'g', '....': 'h', '..': 'i', '.---': 'j',
  '-.-': 'k', '.-..': 'l', '--': 'm', '-.': 'n', '---': 'o', '.--.': 'p', '--.-': 'q', '.-.': 'r', '...': 's', '-': 't',
  '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x', '-.--': 'y', '--..': 'z', '-----': '0', '.----': '1', '..---': '2',
  '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
};

/** Morse in dots and dashes (also `·`, `—`, `dit`/`dah`), letters split by spaces and words by `/`, `|` or two spaces. */
function decodeMorse(text: string): string | null {
  const plain = text
    .replace(/\b(?:dit|di|dah)(?:-(?:dit|di|dah))*\b/gi, (g) => g.split('-').map((x) => (/^dah$/i.test(x) ? '-' : '.')).join(''))
    .replace(/[·•]/g, '.')
    .replace(/[—–_]/g, '-');
  if ((plain.match(/(?:^|\s)[.-]{1,6}(?=\s|$|[/|])/g) ?? []).length < UNREADABLE_TOKENS) return null;
  const words = plain.split(/\s*[/|]\s*|\s{2,}|\n/).map((w) => w.trim().split(/\s+/).map((code) => MORSE[code] ?? '').join(''));
  const decoded = words.filter(Boolean).join(' ');
  return decoded.length >= 6 ? decoded : null;
}

function decodeBase32(run: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of run.toUpperCase().replace(/=+$/, '')) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return utf8IfText(Buffer.from(bytes));
}

function rot47(text: string): string {
  return text.replace(/[!-~]/g, (c) => String.fromCharCode(33 + ((c.charCodeAt(0) - 33 + 47) % 94)));
}

/**
 * Byte-level decodings of `text`: base64 (also wrapped or spaced), base32, hex, decimal bytes, percent,
 * quoted-printable, escapes, Morse.
 */
function byteReadings(text: string): Array<{ detector: string; text: string }> {
  const out: Array<{ detector: string; text: string }> = [];
  for (const m of text.matchAll(/[A-Z2-7]{16,}=*|[a-z2-7]{16,}=*/g)) {
    const decoded = decodeBase32(m[0]);
    if (decoded) out.push({ detector: 'base32', text: decoded });
  }
  // Grouped or wrapped base32: single-case base32 tokens joined across spaces and line breaks.
  for (const m of text.matchAll(/(?:[A-Z2-7]{2,}=*[ \t\r\n]+){3,}[A-Z2-7]{2,}=*|(?:[a-z2-7]{2,}=*[ \t\r\n]+){3,}[a-z2-7]{2,}=*/g)) {
    const decoded = decodeBase32(m[0].replace(/\s+/g, ''));
    if (decoded) out.push({ detector: 'base32', text: decoded });
  }
  if ((text.match(/=[0-9A-F]{2}/g) ?? []).length >= 3) {
    out.push({ detector: 'quoted_printable', text: text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))) });
  }
  const morse = decodeMorse(text);
  if (morse) out.push({ detector: 'morse', text: morse });
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)) for (const d of decodeBase64(m[0])) out.push({ detector: 'base64', text: d });
  // Wrapped or spaced base64: base64-alphabet tokens joined across spaces and line breaks.
  for (const m of text.matchAll(/(?:[A-Za-z0-9+/_-]{2,}={0,2}[ \t\r\n]+){3,}[A-Za-z0-9+/_-]{2,}={0,2}/g)) {
    if (/\d|[+/]/.test(m[0])) for (const d of decodeBase64(m[0])) out.push({ detector: 'base64', text: d });
  }
  for (const m of text.matchAll(/(?:(?:0x|\\x)?[0-9a-fA-F]{2}[\s:,;.\-]*){8,}/g)) {
    const hex = m[0].replace(/0x|\\x/gi, '').replace(/[\s:,;.\-]/g, '');
    const decoded = utf8IfText(Buffer.from(hex.slice(0, hex.length - (hex.length % 2)), 'hex'));
    if (decoded) out.push({ detector: 'hex', text: decoded });
  }
  for (const m of text.matchAll(/(?:\b\d{1,3}\b[\s,;.\-]+){7,}\b\d{1,3}\b/g)) {
    const bytes = m[0].split(/[\s,;.\-]+/).map(Number);
    if (bytes.every((b) => b <= 255)) {
      const decoded = utf8IfText(Buffer.from(bytes));
      if (decoded) out.push({ detector: 'decimal', text: decoded });
    }
  }
  for (const m of text.matchAll(/(?:%[0-9a-fA-F]{2}|[A-Za-z0-9._~+-]){12,}/g)) {
    if (!m[0].includes('%')) continue;
    try {
      out.push({ detector: 'percent', text: decodeURIComponent(m[0].replace(/\+/g, ' ')) });
    } catch {
      // not valid percent-encoding
    }
  }
  if (/\\u\{?[0-9a-fA-F]{2,6}|&#x?[0-9a-fA-F]+|\bU\+[0-9a-fA-F]{4,6}|\\x[0-9a-fA-F]{2}/.test(text)) {
    const code = (hex: string) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    };
    out.push({
      detector: 'escapes',
      text: text
        .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_m, h: string) => code(h))
        .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => code(h))
        .replace(/\bU\+([0-9a-fA-F]{4,6})\s?/g, (_m, h: string) => code(h))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => code(h))
        .replace(/&#x([0-9a-fA-F]+);?/g, (_m, h: string) => code(h))
        .replace(/&#(\d+);?/g, (_m, d: string) => code(Number(d).toString(16))),
    });
  }
  return out;
}

/** Letter-level readings of `text`: every Caesar shift, ROT47, atbash, reversals, leetspeak, spelled letters. */
function letterReadings(text: string): Array<{ detector: string; text: string }> {
  const out: Array<{ detector: string; text: string }> = [];
  for (let shift = 1; shift < 26; shift += 1) out.push({ detector: shift === 13 ? 'rot13' : `caesar${shift}`, text: caesar(text, shift) });
  out.push({ detector: 'rot47', text: rot47(text) });
  out.push({ detector: 'atbash', text: atbash(text) });
  out.push({ detector: 'reversed', text: [...text].reverse().join('') });
  out.push({ detector: 'reversed_words', text: text.split(/\s+/).reverse().join(' ') });
  out.push({ detector: 'reversed_each', text: text.replace(/[\p{L}\p{N}]+/gu, (w) => [...w].reverse().join('')) });
  if (/\p{L}\d+\p{L}/u.test(text)) out.push({ detector: 'digit_spaced', text: text.replace(/(?<=\p{L})\d+(?=\p{L})/gu, ' ') });
  if (/[a-z][013457@$8]|[013457@$8][a-z]/i.test(text)) {
    out.push({ detector: 'leet', text: text.replace(/[\p{L}\p{N}@$]+/gu, (w) => (/[a-z]/i.test(w) ? w.replace(/[013457@$8]/g, (c) => LEET[c] ?? c) : w)) });
  }
  const spelled = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (spelled.filter((w) => w in SPELLED).length >= 8) out.push({ detector: 'spelled', text: spelled.map((w) => SPELLED[w] ?? ' ').join('') });
  return out;
}

export interface Reading {
  detector: string;
  text: string;
  /** `bytes`: a decoding (read fully, canary spread included); `letters`: a letter transform (runs and canary pieces only). */
  kind: 'bytes' | 'letters';
}

/** Readings of `text` under the simple encodings a model may be asked for; byte decodings are read once more. */
export function decodedReadings(text: string): Reading[] {
  const bytes = byteReadings(text).map((r) => ({ ...r, kind: 'bytes' as const }));
  const nested = bytes.flatMap((b) => [
    ...byteReadings(b.text).map((r) => ({ detector: `${b.detector}+${r.detector}`, text: r.text, kind: 'bytes' as const })),
    ...letterReadings(b.text).map((r) => ({ detector: `${b.detector}+${r.detector}`, text: r.text, kind: 'letters' as const })),
  ]);
  return [...bytes, ...letterReadings(text).map((r) => ({ ...r, kind: 'letters' as const })), ...nested];
}

/* ------------------------------------------------------------------ canary */

/**
 * The canary, a `CANARY_FRAGMENT`-long piece of it, or (with `spread`) `CANARY_SPREAD` of its characters in
 * order with at most `CANARY_SPREAD_GAP` other characters between neighbours, in the folded letters and
 * digits of `text`. The spread search runs on the text and its byte decodings only: on 25 Caesar readings
 * of every answer its chance hits would add up.
 */
export function carriesCanary(text: string, canary: string | null, spread = true): boolean {
  if (!canary) return false;
  const stream = latinStream(foldText(text));
  if (!stream) return false;
  const c = latinStream(foldText(canary));
  if (stream.includes(c)) return true;
  for (let i = 0; i + CANARY_FRAGMENT <= c.length; i += 1) if (stream.includes(c.slice(i, i + CANARY_FRAGMENT))) return true;
  if (!spread) return false;
  // Pieces of `CANARY_PIECE`+ characters in the canary's order, at any distance, adding up to `CANARY_SPREAD`.
  let matched = 0;
  let from = 0;
  for (let i = 0; i + CANARY_PIECE <= c.length; ) {
    const at = stream.indexOf(c.slice(i, i + CANARY_PIECE), from);
    if (at === -1) {
      i += 1;
      continue;
    }
    let length = CANARY_PIECE;
    while (i + length < c.length && stream[at + length] === c[i + length]) length += 1;
    matched += length;
    if (matched >= CANARY_SPREAD) return true;
    from = at + length;
    i += length;
  }
  for (let start = 0; start + CANARY_SPREAD <= c.length; start += 1) {
    for (let at = stream.indexOf(c[start]!); at !== -1; at = stream.indexOf(c[start]!, at + 1)) {
      let k = start + 1;
      let pos = at;
      while (k < c.length) {
        const next = stream.slice(pos + 1, pos + 2 + CANARY_SPREAD_GAP).indexOf(c[k]!);
        if (next === -1) break;
        pos += next + 1;
        k += 1;
      }
      if (k - start >= CANARY_SPREAD) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ shape */

const FENCE = /```|~~~/;
const HEADING = /^\s{0,3}#{1,6}\s/m;
const TAG = /<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i;
const LIST = /^\s*(?:[-*•·]|\d{1,2}[.)])\s+\S/m;

function shapeRefusal(text: string, shape: FieldShape | undefined): string | null {
  if (!shape) return null;
  if (shape.maxChars !== undefined && text.length > shape.maxChars) return 'shape_length';
  const lines = text.split('\n').filter((l) => l.trim()).length;
  if (shape.oneSentence && lines > 1) return 'shape_lines';
  if (shape.maxLines !== undefined && lines > shape.maxLines) return 'shape_lines';
  if (shape.noMarkup || shape.oneSentence) {
    if (FENCE.test(text) || HEADING.test(text) || TAG.test(text)) return 'shape_markup';
    if (shape.oneSentence && (LIST.test(text) || /^\s*[{[]/.test(text))) return 'shape_markup';
  }
  return null;
}

/* ------------------------------------------------------------------ meta words (signal only) */

const META = [
  /\binstruct(?:ion|ions|ed)\b/g,
  /\bsystem\b/g,
  /\brules?\b/g,
  /\bguidelines?\b/g,
  /\bprompt(?:s)?\b/g,
  /\byou (?:were|are) (?:told|given|asked)\b/g,
  /\bconfidential\b/g,
  /지침/g,
  /규칙/g,
  /시스템/g,
  /지시/g,
];

function metaWords(folded: string, exemptFolded: string): number {
  let n = 0;
  for (const re of META) {
    re.lastIndex = 0;
    const inExempt = re.test(exemptFolded);
    re.lastIndex = 0;
    if (!inExempt) n += (folded.match(re) ?? []).length;
  }
  return n;
}

/* ------------------------------------------------------------------ the check */

export interface PreparedCheck {
  internal: Corpus;
  permitted: Corpus;
  exemptText: string;
  exemptFolded: string;
}

export function prepareCheck(internal: string | readonly string[], exempt: readonly string[] = [], allow: readonly string[] = []): PreparedCheck {
  const exemptText = exempt.join('\n');
  return {
    internal: new Corpus(typeof internal === 'string' ? [internal] : internal),
    permitted: new Corpus([...exempt, ...allow]),
    exemptText,
    exemptFolded: foldText(exemptText),
  };
}

/** Runs with the word run only: a letter transform of the answer is read for whole-word copies (cost). */
const WORDS_ONLY: Thresholds = { ...DEFAULT_THRESHOLDS, runLatin: Number.MAX_SAFE_INTEGER, runHangul: Number.MAX_SAFE_INTEGER };

function overlapRefusal(text: string, p: PreparedCheck, full = true): { reason: GuardReason; detector: string } | null {
  const u = unitsOf(text, p.permitted);
  const run = runDetector(u, p.internal, p.permitted, full ? DEFAULT_THRESHOLDS : WORDS_ONLY);
  if (run) return { reason: 'overlap_run', detector: run };
  if (!full) return null;
  if (wordShare(u, p.internal, p.permitted) > SHARE_WORDS_LIMIT) return { reason: 'overlap_share', detector: 'word_share' };
  if (wordShareCount(u, p.internal, p.permitted) >= SHARE_WORDS_COUNT) return { reason: 'overlap_share', detector: 'word_share_count' };
  if (hangulShare(u, p.internal, p.permitted) > SHARE_HANGUL_LIMIT) return { reason: 'overlap_share', detector: 'hangul_share' };
  if (gappedLength(u, p.internal) >= GAPPED_MIN_WORDS) return { reason: 'overlap_gapped', detector: 'gapped' };
  return null;
}

/** The letter transform whose words the internal text has most often (a Caesar shift that undoes a cipher). */
function bestLetterReading(readings: readonly Reading[], internal: Corpus): string | null {
  const vocabulary = internal.positions();
  let best: string | null = null;
  let bestHits = 0;
  for (const r of readings) {
    if (r.kind !== 'letters' || r.detector === 'reversed_words') continue;
    let hits = 0;
    for (const w of wordUnits(foldText(r.text))) if (!STOPWORDS.has(w) && vocabulary.has(w)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      best = r.detector;
    }
  }
  return best;
}

/** Canary, then shape and prose, then overlap, in the text and in every decoded reading of it. */
function textRefusal(text: string, canary: string | null, shape: FieldShape | undefined, p: PreparedCheck): { reason: GuardReason; detector: string } | null {
  if (carriesCanary(text, canary)) return { reason: 'canary', detector: 'canary' };
  const readings = decodedReadings(text);
  for (const r of readings) if (carriesCanary(r.text, canary, r.kind === 'bytes')) return { reason: 'canary', detector: r.detector };
  const shaped = shapeRefusal(text, shape);
  if (shaped) return { reason: shaped as GuardReason, detector: 'shape' };
  const overlap = overlapRefusal(text, p);
  if (overlap) return overlap;
  // Decodings, the reversed word order and the letter transform that reads most like the internal text are read
  // fully; the other ~30 letter transforms of every answer get the word run only (cost).
  const full = new Set(readings.filter((r) => r.kind === 'bytes' || r.detector === 'reversed_words').map((r) => r.detector));
  const best = bestLetterReading(readings, p.internal);
  if (best) full.add(best);
  for (const r of readings) if (overlapRefusal(r.text, p, full.has(r.detector))) return { reason: 'encoded', detector: r.detector };
  // Last: an encoding none of the readings above knows (base32, a bespoke cipher …) is still not prose.
  if (unreadable(text, p.exemptText)) return { reason: 'encoded', detector: 'unreadable' };
  return null;
}

/**
 * Checks every field, then all fields joined in both orders (a copy split across fields). A field passes or
 * is refused with a reason; the canary is checked first, so a canary refusal always says `canary`.
 */
export function checkOutgoing(input: OutgoingInput, prepared?: PreparedCheck): OutgoingVerdict {
  const p = prepared ?? prepareCheck(input.internal, input.exempt, input.allow);
  const refusals: FieldRefusal[] = [];
  const signals: Record<string, FieldSignals> = {};
  const names = Object.keys(input.fields);
  for (const field of names) {
    const text = input.fields[field] ?? '';
    signals[field] = { chars: text.length, lines: text.split('\n').filter((l) => l.trim()).length, metaWords: metaWords(foldText(text), p.exemptFolded) };
    if (!text.trim()) continue;
    const refused = textRefusal(text, input.canary, input.shapes?.[field], p);
    if (refused) refusals.push({ field, ...refused });
  }
  if (names.length > 1 && refusals.length === 0) {
    const texts = names.map((n) => input.fields[n] ?? '');
    for (const joined of [texts.join('\n'), [...texts].reverse().join('\n')]) {
      const refused = textRefusal(joined, input.canary, undefined, p);
      if (refused) {
        refusals.push({ field: '*', ...refused });
        break;
      }
    }
  }
  return { ok: refusals.length === 0, refusals, signals };
}

const PROHIBITION = /\b(?:never|not|no|avoid|avoids|ban|banned|without|don't|do not|nor|instead of)\b/i;

/**
 * What the internal text dictates for the model to write, for a site's allow-list: every quoted span
 * ("Visual style:", "In image 1, change only <the change>; …") and every parenthesised list of three or more
 * items (a keep-list such as "(exact object scale, outer silhouette, contours, light direction, …)"), except
 * those the same sentence forbids ('NEVER write "glass-skin", "poreless porcelain" …'). A well-behaved answer
 * repeats these; allowing them costs the guard only these phrases.
 */
export function dictatedSpans(internal: string): string[] {
  const spans: string[] = [];
  // Forbidden: a prohibition word in the same clause, before the span and outside other quotes
  // ('NEVER write "glass-skin", "…"'; but not 'ends "No background music …"' after a quote holding "no").
  const forbidden = (at: number) => {
    const before = internal.slice(Math.max(0, at - 300), at).replace(/"[^"\n]*"|“[^”\n]*”/g, ' ');
    return PROHIBITION.test(before.split(/[.;:!?\n(]/).pop() ?? before);
  };
  for (const m of internal.matchAll(/"([^"\n]{3,400})"|“([^”\n]{3,400})”/g)) {
    if (!forbidden(m.index ?? 0)) spans.push((m[1] ?? m[2] ?? '').trim());
  }
  for (const m of internal.matchAll(/\(([^()\n]{12,400})\)/g)) {
    if ((m[1]!.match(/,/g) ?? []).length >= 2 && !forbidden(m.index ?? 0)) spans.push(m[1]!.trim());
  }
  return spans.filter(Boolean);
}
