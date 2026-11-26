/**
 * How the prompt guard reads text (docs/PROMPT-GUARD.md "How text is compared"). Server-only.
 *
 * Both sides of every comparison go through `foldText` first, so these do not hide a copy:
 *   - case, full-width and other compatibility forms (NFKC), accents and stacked combining marks;
 *   - zero-width and other invisible format characters, variation selectors, Hangul filler characters;
 *   - common Cyrillic and Greek look-alikes of Latin letters ("о" for "o").
 * Then three unit streams are read from the folded text:
 *   - words: runs of letters and digits (Latin words, and Korean words with their particles);
 *   - Latin characters: every a-z and 0-9 with nothing between them, so spacing, punctuation and line
 *     breaks inserted into a copy do not hide it;
 *   - Hangul syllables: every 가-힣 with nothing between them. Korean spacing varies and particles attach
 *     to words, so word n-grams are too coarse for Korean; syllable n-grams are not.
 */
import 'server-only';

/** Invisible characters that can be slipped into a copy: format (Cf) characters, variation selectors, fillers. */
const INVISIBLE = /[\p{Cf}͏ᅟᅠㅤﾠ᠋-᠏︀-️\u{E0100}-\u{E01EF}]/gu;
const COMBINING = /\p{Mn}/gu;

/** Lower-case Cyrillic and Greek letters that read as Latin ones, and a few Latin variants. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l', ɡ: 'g', ı: 'i', ℓ: 'l',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w', ϲ: 'c', ҽ: 'e', μ: 'u',
  // Latin small capitals and Latin letter variants (Latin script, so the "not prose" check does not see them).
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n',
  ᴏ: 'o', ᴘ: 'p', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z', ɑ: 'a', ɗ: 'd', ɓ: 'b', ɦ: 'h',
  ɩ: 'i', ʋ: 'v', ɵ: 'o',
  // Latin letters with a stroke or bar (NFKD does not take these apart).
  ø: 'o', ł: 'l', đ: 'd', ħ: 'h', ŧ: 't', ɇ: 'e', ɨ: 'i', ʉ: 'u', ȼ: 'c', ƀ: 'b', ɍ: 'r', ⱥ: 'a', ƶ: 'z', ɉ: 'j',
  ǥ: 'g', ꝁ: 'k', ɏ: 'y', ƚ: 'l', ɟ: 'j', ƒ: 'f', ꞥ: 'n', ꝑ: 'p', ꝗ: 'q', ꞩ: 's', ꝟ: 'v', ꞃ: 'r',
  // Armenian letters that read as Latin ones.
  օ: 'o', ս: 'u', հ: 'h', ո: 'n', ց: 'g', ք: 'p',
};
const LOOK_ALIKE_RE = new RegExp(`[${Object.keys(LOOK_ALIKES).join('')}]`, 'gu');

/** Greek and Cyrillic capitals that read as Latin capitals, mapped before lower-casing (capital Η is H, not η). */
const CAPITAL_LOOK_ALIKES: Readonly<Record<string, string>> = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', Ѕ: 'S', І: 'I', Ј: 'J',
};
const CAPITAL_LOOK_ALIKE_RE = new RegExp(`[${Object.keys(CAPITAL_LOOK_ALIKES).join('')}]`, 'gu');

/** The comparison form of `text` (see the file comment). Idempotent. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(INVISIBLE, '')
    .replace(COMBINING, '')
    .normalize('NFKC')
    .replace(CAPITAL_LOOK_ALIKE_RE, (ch) => CAPITAL_LOOK_ALIKES[ch] ?? ch)
    .toLowerCase()
    .replace(LOOK_ALIKE_RE, (ch) => LOOK_ALIKES[ch] ?? ch);
}

/** Words of folded text: letters and digits, apostrophes dropped ("don't" → "dont"). */
export function wordUnits(folded: string): string[] {
  return folded.replace(/['’`]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Every Latin letter and digit of folded text, joined. */
export function latinStream(folded: string): string {
  return folded.replace(/[^a-z0-9]+/g, '');
}

/** Every Hangul syllable of folded text, joined. */
export function hangulStream(folded: string): string {
  return folded.replace(/[^가-힣]+/g, '');
}

/** The `n`-word windows of `words`, joined by one space. */
export function wordGrams(words: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i += 1) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/** The `n`-character windows of `stream`. */
export function charGrams(stream: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= stream.length; i += 1) out.push(stream.slice(i, i + n));
  return out;
}

/** Function words that say nothing on their own about where a sentence came from. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  'a an the and or but nor of to in on at by for with from as is are was were be been being it its this that these those there their they them then than so such not no do does did done has have had will would can could should may might must shall into onto over under up down out off about after before when while where which who whom whose what how why if each every any all some both either neither own same other only also just very more most less least too'.split(
    ' ',
  ),
);
