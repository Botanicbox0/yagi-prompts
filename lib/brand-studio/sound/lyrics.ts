/**
 * Lyrics and style for the "직접 지정" way of making music (docs/BRAND-SOUND-STUDIO.md §4.2, §7.5).
 *
 *  - The way is decided here, never picked by the customer: lyrics (with vocals) or "더 고르게 만들기" make it a
 *    custom request, anything else stays a description request.
 *  - Section marks ([Verse], [Chorus]) are added when the request is sent, never typed by the customer:
 *    stanzas are the blocks between blank lines. Lyrics that already carry marks go as they are.
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

/** The lyrics as sent: trimmed lines, blank-line stanzas, a section mark before each when none was written. */
export function withSections(lyrics: string): string {
  const text = lyrics.replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  if (MARKED.test(text)) return text;
  const stanzas = text
    .split(/\n\s*\n+/)
    .map((stanza) => stanza.split('\n').map((line) => line.trim()).filter(Boolean).join('\n'))
    .filter(Boolean);
  return stanzas.map((stanza, i) => `${SECTIONS[Math.min(i, SECTIONS.length - 1)]}\n${stanza}`).join('\n\n');
}

/** The style line the engine receives in custom mode (within its 1,000 characters). */
export function musicStyle(prompt: string, vocal: boolean, hasLyrics: boolean, language: 'ko' | 'en'): string {
  const words = prompt.replace(/\s+/g, ' ').trim().slice(0, 900);
  return vocal && !hasLyrics ? `${words} ${SUNG_IN[language]}` : words;
}

export { MUSIC_LIMITS };
