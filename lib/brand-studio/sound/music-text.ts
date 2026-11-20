/**
 * The words the studio derives from a music request without a model (docs/BRAND-SOUND-STUDIO.md §4.2): the list
 * name from the description's first phrase, and the description sentence with the language to sing in. Client-safe.
 */
import { MUSIC_LIMITS } from './music-limits';

export const SUNG_IN: Readonly<Record<'ko' | 'en', string>> = { ko: 'Vocals sung in Korean.', en: 'Vocals sung in English.' };

/**
 * The list name of a track (§4.2): the description's first phrase, at most 40 characters on a word boundary,
 * never more than the engine's title limit. The customer's own words, so it reads like they wrote it.
 */
export function musicTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  const first = flat.split(/[.,!?\n。，、]|\s[-–—]\s/)[0]!.trim() || flat;
  if (first.length <= 40) return first.slice(0, MUSIC_LIMITS.titleMax);
  const cut = first.slice(0, 40);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}

/** What the engine receives for a description-only request (§4.2): the words, plus the language to sing in. */
export function describeSentence(prompt: string, vocal: boolean, language: 'ko' | 'en'): string {
  const words = prompt.replace(/\s+/g, ' ').trim();
  return vocal ? `${words} ${SUNG_IN[language]}` : words;
}

