/**
 * Lyrics and style for the "직접 지정" way of making music (docs/BRAND-SOUND-STUDIO.md §4.2, §7.5).
 *
 *  - The way is decided here, never picked by the customer: lyrics (with vocals) or "더 고르게 만들기" make it a
 *    custom request, anything else stays a description request.
 *  - Section marks ([Verse], [Chorus], the last one [Outro]) are added when the request is sent, never typed by the
 *    customer: stanzas are the blocks between blank lines, marked in the order of the chosen structure (SA2,
 *    §12.3). Every line the customer wrote goes byte for byte; lyrics that already carry marks keep them. A closing
 *    `[End]` line is held out until the founder has listened to the ending pair (§12.8 b): `END_MARK` is null.
 *  - An instrumental sends no lyrics at all, not even marks: the engine refuses them (§12.8).
 *  - The style line is the customer's own description, plus the language to sing in when there are vocals
 *    and no lyrics. (Rewriting it for the engine, the image studio's Prompt Architect step, waits for the paid
 *    smoke test that tells whether it helps; the doc's §7.5 "준비" is met without a model call.)
 *
 * Client-safe: the composer shows the same limits and the same way.
 */
import { MUSIC_LIMITS } from './music-limits';

export const LYRICS_LIMITS = { max: 3000 } as const;

const SUNG_IN: Readonly<Record<'ko' | 'en', string>> = { ko: 'Vocals sung in Korean.', en: 'Vocals sung in English.' };

export type MusicWay = 'describe' | 'custom';

/** Lyrics only count with vocals: an instrumental never sends any. */
export function musicWay(input: { vocal: boolean; lyrics?: string | null; careful?: boolean | null }): MusicWay {
  return input.careful === true || (input.vocal && Boolean(input.lyrics?.trim())) ? 'custom' : 'describe';
}

const MARKED = /^\s*\[[^\]\n]{1,40}\]\s*$/m;
const SECTIONS = ['[Verse 1]', '[Chorus]', '[Verse 2]', '[Chorus]', '[Bridge]', '[Chorus]', '[Outro]'] as const;

/** The style line the engine receives in custom mode (within its 1,000 characters). */
export function musicStyle(prompt: string, vocal: boolean, hasLyrics: boolean, language: 'ko' | 'en'): string {
  const words = prompt.replace(/\s+/g, ' ').trim().slice(0, 900);
  return vocal && !hasLyrics ? `${words} ${SUNG_IN[language]}` : words;
}

export { MUSIC_LIMITS };

/* ------------------------------------------------------------------ the lyrics engine (SA2, §12.3) */

/** 구성: 후크만 · 후크와 한 절 · 두 절과 후크. Marks follow it; the customer never types or sees them. */
export const LYRIC_STRUCTURES = ['hook', 'hook-verse', 'full'] as const;
export type LyricStructure = (typeof LYRIC_STRUCTURES)[number];

/** 길이: 15·30·60초, or the attached video's length (seconds). Lyrics are sized to it; the length tool finishes it. */
export const LYRIC_LENGTHS = [15, 30, 60] as const;

/** The default structure for a length (§12.3 "짧은 광고 음악": 30 s or less starts on the hook, no verse). */
export function defaultStructure(seconds: number | null | undefined): LyricStructure {
  if (seconds == null) return 'full';
  return seconds <= 30 ? 'hook' : seconds <= 60 ? 'hook-verse' : 'full';
}

/**
 * How fast Korean is sung, in syllables a second, by tempo (§12.8, measured on 34 sung tracks): about 1.6 at 110 BPM
 * and above, 1.2 at 90–110, 0.9 below 90. Without a tempo, the middle rate.
 */
export function singingRate(bpm: number | null | undefined): number {
  if (bpm == null || !Number.isFinite(bpm)) return 1.2;
  return bpm >= 110 ? 1.6 : bpm >= 90 ? 1.2 : 0.9;
}

const FAST_WORDS = /빠른|빠르게|신나|경쾌|댄스|업템포|발랄|통통|에너지|fast|upbeat|energetic|dance|uptempo|bouncy|punchy/i;
const SLOW_WORDS = /느린|느리게|잔잔|차분|발라드|서정|몽환|고요|slow|ballad|calm|gentle|dreamy|tender|ambient/i;

/** A tempo read from the words: a written BPM, else 120 for fast words, 80 for slow ones, else null. */
export function tempoOf(text: string | null | undefined): number | null {
  const words = text ?? '';
  const bpm = /(\d{2,3})\s*bpm/i.exec(words);
  if (bpm) return Number(bpm[1]);
  if (FAST_WORDS.test(words) && !SLOW_WORDS.test(words)) return 120;
  if (SLOW_WORDS.test(words) && !FAST_WORDS.test(words)) return 80;
  return null;
}

/**
 * The Korean syllables a length holds: target × singing rate, ±25 %. Only a rough range: two songs from one request
 * differed in length by up to 2.5×, so the length tool finishes it (§12.8). 15 s fast ≈ 24, 30 s ≈ 48, 60 s slow ≈ 54.
 */
export function syllableRange(seconds: number, bpm?: number | null): { min: number; max: number } {
  const center = seconds * singingRate(bpm);
  return { min: Math.round(center * 0.75), max: Math.round(center * 1.25) };
}

const SEQUENCES: Readonly<Record<LyricStructure, readonly string[]>> = {
  hook: ['[Chorus]'],
  'hook-verse': ['[Chorus]', '[Verse]', '[Chorus]'],
  full: ['[Verse 1]', '[Chorus]', '[Verse 2]', '[Chorus]', '[Bridge]', '[Chorus]'],
};

/** The marks for `count` stanzas: the structure's order, the last stanza `[Outro]` when there are two or more. */
export function structureMarks(structure: LyricStructure, count: number): string[] {
  const seq = SEQUENCES[structure];
  const marks = Array.from({ length: count }, (_, i) => seq[Math.min(i, seq.length - 1)]!);
  if (count >= 2) marks[count - 1] = '[Outro]';
  return marks;
}

/** The closing line, held out until the founder has listened (§12.8 b). Set it to '[End]' to add it again. */
export const END_MARK: string | null = null;

/** The customer's lyrics as kept: \n line endings, no leading blank lines, no trailing whitespace. Nothing else changes. */
export function ownLyrics(lyrics: string | null | undefined): string {
  return (lyrics ?? '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

/**
 * The lyrics exactly as they will be sent (§12.3 "내 가사 그대로"): every line the customer wrote stays byte for
 * byte (only line endings become \n); a mark line goes before each stanza (blank lines separate stanzas) unless the
 * customer wrote marks of their own; `[End]` closes the song. Removing the added lines gives the customer's text back.
 */
export function markLyrics(lyrics: string, structure: LyricStructure | null): string {
  const text = ownLyrics(lyrics);
  if (!text.trim()) return '';
  const lines = text.split('\n');
  const own = MARKED.test(text);
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim() && (i === 0 || !lines[i - 1]!.trim())) starts.push(i);
  });
  const marks = own ? [] : structure ? structureMarks(structure, starts.length) : starts.map((_, i) => SECTIONS[Math.min(i, SECTIONS.length - 1)]!);
  const out: string[] = [];
  let next = 0;
  lines.forEach((line, i) => {
    if (!own && starts[next] === i) out.push(marks[next++]!);
    out.push(line);
  });
  if (END_MARK && out[out.length - 1]?.trim() !== END_MARK) out.push(END_MARK);
  return out.join('\n');
}

/** `marked` without the lines `markLyrics` added: equals `ownLyrics(original)` when nothing of the customer's changed. */
export function withoutAddedLines(marked: string, original: string): string {
  const own = new Set(ownLyrics(original).split('\n'));
  return marked
    .split('\n')
    .filter((line) => own.has(line) || !/^\[[^\]\n]{1,40}\]$/.test(line))
    .join('\n');
}

/* ------------------------------------------------------------------ checks without a model (§12.2, §12.3) */

const ALLOWED_MARKS = /^\[(Intro|Verse(?: \d)?|Pre-Chorus|Chorus|Hook|Bridge|Outro|End)\]$/;
const SUPERLATIVE = /최고|최초|유일|1위|넘버\s*원|\bno\.?\s*1\b|\bnumber one\b|\bthe best\b/i;
const HANGUL = /[가-힣]/g;

function finalJong(ch: string): number {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? code % 28 : -1;
}
/** Finals that close the syllable hard when held (ㄱ ㄲ ㄳ ㄷ ㅂ ㅄ ㅅ ㅆ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ). */
const HARD_FINALS = new Set([1, 2, 3, 7, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27]);

export interface LyricCheckInput {
  /** Plain stanzas (no marks), as the customer sees them. */
  lyrics: string;
  language: 'ko' | 'en' | 'mixed';
  seconds: number | null;
  /** The tempo the song is written for (a BPM, or read from the description): sets the singing rate. */
  bpm?: number | null;
  tone: 'haeyo' | 'banmal' | null;
  brand: { name: string; readAs?: string | null } | null;
  mustInclude: readonly string[];
}

export interface LyricCheck {
  /** Must hold: the draft is rewritten once, then refused. */
  hard: string[];
  /** Should hold: rewritten once, then accepted with the warning kept. */
  soft: string[];
  syllables: number;
}

/** The rules for a drafted or polished lyric (never for the customer's own words, which are sent as written). */
export function checkLyrics(input: LyricCheckInput): LyricCheck {
  const hard: string[] = [];
  const soft: string[] = [];
  const text = input.lyrics.replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) hard.push('no lyrics');
  if (text.length > LYRICS_LIMITS.max) hard.push(`over ${LYRICS_LIMITS.max} characters`);
  for (const line of lines) {
    if (/^\[.*\]$/.test(line) && !ALLOWED_MARKS.test(line)) hard.push(`a bracket that is not a section mark: ${line.slice(0, 30)}`);
    for (const m of line.matchAll(/\(([^)]*)\)/g)) if (m[1]!.length > 12) hard.push('a parenthesis longer than a short ad-lib');
  }
  if (SUPERLATIVE.test(text)) hard.push('a superlative or a claim (최고·최초·유일·1위)');
  for (const word of input.mustInclude) if (word.trim() && !text.includes(word.trim())) hard.push(`missing a must-include word: ${word.trim()}`);
  const brandWord = input.brand ? (input.brand.readAs?.trim() || input.brand.name.trim()) : '';
  if (brandWord) {
    const count = text.split(brandWord).length - 1;
    if (count === 0) hard.push('the brand name is missing');
    if (count > 3) hard.push('the brand name appears more than three times');
    const firstStanza = text.split(/\n\s*\n/)[0] ?? '';
    if (count > 0 && !firstStanza.includes(brandWord)) soft.push('the brand name is not in the hook');
  }
  const syllables = (text.match(HANGUL) ?? []).length;
  if (input.language === 'ko' && input.seconds) {
    const range = syllableRange(input.seconds, input.bpm);
    if (syllables < range.min || syllables > range.max) soft.push(`${syllables} syllables for ${input.seconds} s (aim ${range.min}–${range.max})`);
  }
  if (input.language !== 'en') {
    const ends = lines.filter((l) => !/^\[.*\]$/.test(l)).map((l) => l.replace(/[^가-힣]+$/g, '')).filter((l) => /[가-힣]$/.test(l));
    const hardEnds = ends.filter((l) => HARD_FINALS.has(finalJong(l.slice(-1)))).length;
    if (ends.length >= 4 && hardEnds / ends.length > 0.34) soft.push('too many lines end on a hard final (ㄱ·ㄷ·ㅂ)');
    const polite = ends.filter((l) => /(요|니다|세요|까요)$/.test(l)).length;
    const casual = ends.filter((l) => /(어|아|야|지|자|해|래|네)$/.test(l)).length;
    if (input.tone === 'haeyo' && casual >= 2 && polite >= 1) soft.push('mixes 해요체 with 반말');
    if (input.tone === 'banmal' && polite >= 2) soft.push('uses 해요체 where 반말 was asked');
  }
  return { hard, soft, syllables };
}
