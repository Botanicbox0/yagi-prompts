/**
 * The music Prompt Architect (docs/BRAND-SOUND-STUDIO.md §12.2, slice SA1): reads what the customer wrote and
 * the choices in the dock, and designs what goes to the music engine, the way the image studio's Prompt Architect
 * (lib/brand-studio/enhancer) designs for an image model.
 *
 *  - Out: one English style paragraph (describe mode: the request; custom mode: `style`), a title in the lyrics'
 *    language for custom mode, and one sentence of notes in the customer's language.
 *  - The customer's own lyrics are never rewritten here: only section marks are added (./lyrics.ts). Changing
 *    lyrics is the lyrics engine's, and only when asked (§12.3, SA2).
 *  - After writing, a rule check without a model (`checkMusicDesign`, the image Architect's `checkEnhancedPrompt`
 *    place): limits, no names, no length in seconds (the "no X" rule is held out until the founder has listened, CHANGELOG 2026-11-21.1). A failure gets one rewrite with the problems
 *    listed; a second failure, no key, a timeout or any error falls back to the deterministic design (what the
 *    studio did before the Architect: the description cut to 900 characters plus the language line).
 *  - Free: no credits. The preview (`music.design`) is limited per organization like `prompt.enhance`.
 *
 * Server-only for the model call; the check and the fallback are pure.
 */
import { z } from 'zod';
import { callGeminiJson, studioGeminiConfig } from '../enhancer/gemini';
import { SUNO_HEADER, SUNO_PROFILE } from '../enhancer/profiles/suno';
import { videoDesignLine, type MusicVideoFit } from './video-fit';
import { markLyrics, musicStyle, ownLyrics, musicWay, SUPERLATIVE, type LyricStructure, type MusicWay } from './lyrics';
import { describeSentence, musicTitle } from './music-text';
import { namedArtist } from './names';

export const MUSIC_PROFILE_VERSION = `${SUNO_HEADER.id}@${SUNO_HEADER.version}`;
/** The engine's style field holds 1,000 characters; the paragraph aims for 900 (§12.2). */
export const DESIGN_LIMITS = { styleMax: 900, styleHardMax: 1000, titleMax: 40, notesMax: 200 } as const;
const DESIGN_TIMEOUT_MS = 25_000;

export interface MusicDesignInput {
  /** The customer's words, as typed. */
  prompt: string;
  vocal: boolean;
  /** The customer's lyrics ('' when none). Never rewritten here. */
  lyrics: string;
  careful: boolean;
  /** How the lyrics are marked (SA2, §12.3); absent: the old order (verse, chorus, verse, ...). */
  structure?: LyricStructure | null;
  /** The language to sing in when there are vocals and no lyrics. */
  language: 'ko' | 'en';
  /** The screen's language: the notes are written in it. */
  locale: 'ko' | 'en';
  brand?: { name?: string | null; tone?: string | null; rules?: readonly string[] } | null;
  /** "다르게 설계하기" (SA3, §12.5): the engine refused a request made from these words; design around it. */
  avoid?: boolean;
  /** SA4: the video the music goes under (length and cuts). */
  video?: MusicVideoFit | null;
  /**
   * The brand name and the words to include from the lyrics options. With vocals and no lyrics they go to the
   * engine in the sentence that says what the song is about (`subjectSentence`), written the way the customer asked.
   */
  words?: MusicWords | null;
}

export interface MusicWords {
  brand?: { name: string; readAs?: string | null } | null;
  mustInclude?: readonly string[];
}

export interface MusicDesign {
  mode: MusicWay;
  /** Describe mode: the request paragraph. Custom mode: `style`. */
  style: string;
  /** Custom mode only (the engine needs one); the list keeps the customer's own first phrase. */
  title: string;
  /** What is sung, as sent: the customer's lyrics with section marks, or ''. */
  lyrics: string;
  /** The model's one sentence for the customer; null for the fallback (the screen says it in its own words). */
  notes: string | null;
  source: 'model' | 'fallback' | 'reviewed';
  fallbackReason?: string;
  profileVersion: string;
  /** The text model that wrote it; null for the fallback and for a design the customer edited and sent. */
  llmModel: string | null;
}

/** What a music job keeps as `work.enhancer` (the image Architect's place). */
export interface MusicEnhanceMeta {
  profile: 'suno';
  profileVersion: string;
  llmModel: string | null;
  source: MusicDesign['source'];
  fallbackReason?: string;
  /** The track's name: sent to the engine in custom mode, and the list name in both modes. */
  title?: string;
  notes?: string | null;
}

export function designMeta(design: MusicDesign): MusicEnhanceMeta {
  return {
    profile: 'suno',
    profileVersion: design.profileVersion,
    llmModel: design.llmModel,
    source: design.source,
    ...(design.fallbackReason ? { fallbackReason: design.fallbackReason } : {}),
    // The track's name: sent in custom mode, and the list name in both (../repo.ts `jobView`).
    title: design.title,
    notes: design.notes,
  };
}

function wayOf(input: MusicDesignInput): MusicWay {
  return musicWay({ vocal: input.vocal, lyrics: input.lyrics, careful: input.careful });
}

/** True when the engine writes the lyrics itself: vocals, and nothing written to sing. */
function sungWithoutLyrics(input: MusicDesignInput): boolean {
  return input.vocal && !input.lyrics.trim();
}

/** The brand (as the customer asked it written) and the words to include, without repeats. */
function wordsOf(input: MusicDesignInput): string[] {
  const brand = input.words?.brand ? input.words.brand.readAs?.trim() || input.words.brand.name.trim() : '';
  const list = [brand, ...(input.words?.mustInclude ?? []).map((w) => w.trim())].filter(Boolean);
  return [...new Set(list)].slice(0, 6);
}

function wordsLine(words: readonly string[]): string {
  return words.length ? `Sing these words as written: ${words.map((w) => `"${w}"`).join(', ')}.` : '';
}

/** How much of the request the sentence quotes. */
const SUBJECT_QUOTE_MAX = 300;

/**
 * Sung with no lyrics, the engine writes them from the description alone (describe mode). The designed paragraph
 * describes only the sound, so this sentence carries what the song is about: the customer's request, quoted, and
 * the brand and words to include (real run of 2026-11-21: the brand and the message never reached the engine).
 * Ours, added after the model's paragraph and its check; '' for an instrumental or written lyrics.
 */
export function subjectSentence(input: MusicDesignInput): string {
  if (!sungWithoutLyrics(input)) return '';
  const flat = input.prompt.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  const about = flat.length > SUBJECT_QUOTE_MAX ? `${flat.slice(0, SUBJECT_QUOTE_MAX - 1).trim()}…` : flat;
  // Shown in the dock too: no full stop after a quote that already ends a sentence (review of #296).
  const stop = /[.!?。…]$/u.test(about) ? '' : '.';
  return [`The lyrics are about: "${about}"${stop}`, wordsLine(wordsOf(input))].filter(Boolean).join(' ');
}

/** The deterministic design: exactly what the studio sent before the Architect (§12.2 "대체 결과"). */
export function fallbackDesign(input: MusicDesignInput, reason?: string): MusicDesign {
  const mode = wayOf(input);
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  // The fallback already sends the request itself; with no lyrics it adds only the words the options asked for.
  const words = sungWithoutLyrics(input) ? wordsLine(wordsOf(input)) : '';
  const style =
    mode === 'describe'
      ? [describeSentence(input.prompt, input.vocal, input.language), words].filter(Boolean).join(' ')
      : musicStyle(input.prompt, input.vocal, Boolean(lyrics), input.language);
  return {
    mode,
    style: style.slice(0, DESIGN_LIMITS.styleHardMax),
    title: musicTitle(input.prompt),
    lyrics: markLyrics(lyrics, input.structure ?? null),
    notes: null,
    source: 'fallback',
    ...(reason ? { fallbackReason: reason } : {}),
    profileVersion: MUSIC_PROFILE_VERSION,
    llmModel: null,
  };
}

const INTERNAL_TERMS = /\b(suno|sunra|max[_ ]mode|inspire-mode|custom-mode|api|endpoint|prompt architect|json)\b/i;
const SECONDS = /\b\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b|\d+\s*(?:초|분)/i;

/**
 * The model's one sentence for the screen, held to the same name and technical-word check as the style and title.
 * A hit (or nothing) gives null: the screen shows its own fixed sentence instead (review 1, item 6).
 */
export function safeNotes(notes: string | null | undefined): string | null {
  const text = (notes ?? '').replace(/\s+/g, ' ').trim().slice(0, DESIGN_LIMITS.notesMax);
  // The customer's claim ("국내 최고 브랜드의 위상") is not repeated back to them (real run, 2026-11-21).
  if (!text || namedArtist(text) || INTERNAL_TERMS.test(text) || SUPERLATIVE.test(text) || /\b(?:best|greatest|finest)\b/i.test(text)) return null;
  return text;
}

const squash = (text: string) => text.replace(/[\s.,!?()\[\]'"·…-]+/g, '').toLowerCase();

/**
 * Problems in a design, for the one rewrite (empty when it may be sent). Pure. `request` (the customer's words) lets
 * it catch a title that only copies their first words; `styleMax` is lower when a subject sentence follows the style.
 */
export function checkMusicDesign(design: { style: string; title?: string }, _mode: MusicWay, request?: string, styleMax: number = DESIGN_LIMITS.styleHardMax): string[] {
  const problems: string[] = [];
  const style = design.style.trim();
  if (style.length < 40) problems.push('the style paragraph is too short');
  if (style.length > styleMax) problems.push(`the style is over ${styleMax} characters`);
  if (/\n/.test(style)) problems.push('the style must be one paragraph without line breaks');
  if (INTERNAL_TERMS.test(style)) problems.push('the style names the service or a technical term');
  if (namedArtist(style)) problems.push('the style names a real artist or song');
  if (SECONDS.test(style)) problems.push('the style gives a length in seconds or minutes');
  return [...problems, ...checkMusicTitle(design.title ?? '', request)];
}

/**
 * The title's own problems. The title is the track's name in the list in both modes (custom mode also sends it).
 * Without `request` it skips the "copies the request" rule (the safe-name check below).
 */
export function checkMusicTitle(raw: string, request?: string): string[] {
  const problems: string[] = [];
  const title = raw.trim();
  if (!title) problems.push('a title is required');
  if (title.length > DESIGN_LIMITS.titleMax) problems.push(`the title is over ${DESIGN_LIMITS.titleMax} characters`);
  if (namedArtist(title)) problems.push('the title names a real artist or song');
  if (SUPERLATIVE.test(title)) problems.push('the title carries a superlative or a claim');
  if (request && title && squash(title).length >= 4 && squash(request).startsWith(squash(title))) {
    problems.push('the title copies the start of the request; give the track a short name of its own');
  }
  return problems;
}

/** A fixed name when no other is safe, in the language the title would be in (Gemma 2 passes: "곡" over "음악" for one track). */
export const PLAIN_TITLE: Readonly<Record<'ko' | 'en', string>> = { ko: '새 곡', en: 'New track' };

/**
 * The name used when the model's title failed twice but its style is good (review of #296): the request's first
 * words if they hold the hard title rules (as the fallback design names a track), otherwise `PLAIN_TITLE`.
 */
export function safeTitle(input: MusicDesignInput, mode: MusicWay): string {
  const fromRequest = musicTitle(input.prompt);
  if (checkMusicTitle(fromRequest).length === 0) return fromRequest;
  const korean = mode === 'custom' && input.lyrics.trim() ? /[가-힣]/.test(input.lyrics) : input.locale === 'ko';
  return PLAIN_TITLE[korean ? 'ko' : 'en'];
}

const DesignAnswer = z.object({
  style: z.string().min(1).max(4000),
  title: z.string().max(200).default(''),
  notes: z.string().max(600).default(''),
});

const DESIGN_SCHEMA = {
  type: 'object',
  properties: { style: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' } },
  required: ['style', 'title', 'notes'],
} as const;

function taskBlock(input: MusicDesignInput, mode: MusicWay, styleMax: number): string {
  const lines = [
    mode === 'describe'
      ? 'This run sends the style paragraph alone as the description of the track (no title, no lyrics).'
      : 'This run sends the style paragraph, the title and the lyrics separately.',
    input.vocal
      ? input.lyrics.trim()
        ? 'There are vocals and the customer wrote the lyrics: the voice sings them as written. Name the language of the lyrics in the voice sentence. Never quote or change the lyrics.'
        : `There are vocals and no lyrics: name the language to sing in, ${input.language === 'ko' ? 'Korean' : 'English'}, in the voice sentence.`
      : 'Instrumental: name what carries the melody; never mention a voice except to say the piece is instrumental.',
    ...(styleMax < DESIGN_LIMITS.styleHardMax
      ? [`Keep the style under ${styleMax} characters: a sentence saying what the song is about is added after it. Do not write the lyrics or the message yourself.`]
      : []),
    `Notes language: ${input.locale === 'ko' ? 'Korean (해요체, one sentence)' : 'English (one sentence)'}.`,
    ...(input.video ? [videoDesignLine(input.video)] : []),
    ...(input.avoid
      ? [
          'The music engine refused a request made from these words. Leave out anything that could read as a real artist, a song, an album, a brand other than the customer\'s, or explicit content; describe genre, tempo, instruments, voice and mood only.',
        ]
      : []),
  ];
  return `This run:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function payloadOf(input: MusicDesignInput) {
  return {
    request: input.prompt.trim(),
    customerLanguage: input.locale,
    vocals: input.vocal,
    lyricsGiven: Boolean(input.lyrics.trim()),
    ...(input.lyrics.trim() ? { lyricsLanguageHint: /[가-힣]/.test(input.lyrics) ? 'Korean' : 'English' } : {}),
    brand: input.brand
      ? { nameForContextOnly: input.brand.name ?? null, tone: input.brand.tone ?? null, rules: [...(input.brand.rules ?? [])].slice(0, 12) }
      : null,
  };
}

export interface DesignDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

/** Designs the request. Never throws: any failure is the fallback, with the reason recorded. */
export async function designMusic(input: MusicDesignInput, deps: DesignDeps): Promise<MusicDesign> {
  const mode = wayOf(input);
  const config = studioGeminiConfig(deps.env);
  if (!config) return fallbackDesign(input, 'no_key');
  const subject = subjectSentence(input);
  // The whole request stays within what the dock can show and send back (1,000 characters).
  const styleMax = subject ? DESIGN_LIMITS.styleHardMax - subject.length - 1 : DESIGN_LIMITS.styleHardMax;
  const system = `${SUNO_PROFILE}\n\n${taskBlock(input, mode, styleMax)}`;
  let problems: string[] = [];
  let lastStyleOk: { style: string; notes: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = attempt === 0
      ? JSON.stringify(payloadOf(input))
      : `${JSON.stringify(payloadOf(input))}\n\nYour last answer broke these rules; write it again without them:\n- ${problems.join('\n- ')}`;
    let answer: z.infer<typeof DesignAnswer>;
    try {
      answer = DesignAnswer.parse(
        await callGeminiJson(config, deps.fetch, {
          system,
          parts: [{ text }],
          schema: DESIGN_SCHEMA as unknown as Record<string, unknown>,
          thinking: 'LOW',
          timeoutMs: DESIGN_TIMEOUT_MS,
        }),
      );
    } catch (error) {
      deps.log?.('studio_music_design_failed', { message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
      return fallbackDesign(input, 'model_error');
    }
    const design = { style: answer.style.replace(/\s+/g, ' ').trim(), title: answer.title.trim() };
    problems = checkMusicDesign(design, mode, input.prompt, styleMax);
    if (problems.length === 0) {
      return {
        mode,
        style: subject ? `${design.style} ${subject}` : design.style,
        title: design.title,
        lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null),
        notes: safeNotes(answer.notes),
        source: 'model',
        profileVersion: MUSIC_PROFILE_VERSION,
        llmModel: config.model,
      };
    }
    // `problems` is the style's problems followed by the title's: equal counts mean only the title failed.
    const titleOnly = problems.length === checkMusicTitle(design.title, input.prompt).length;
    lastStyleOk = titleOnly ? { style: design.style, notes: answer.notes } : null;
    deps.log?.('studio_music_design_rejected', { attempt, problems: problems.join('; ').slice(0, 300) });
  }
  // Only the title failed, twice: the designed style is good and stays; the name is a safe one (review of #296).
  if (lastStyleOk) {
    return {
      mode,
      style: subject ? `${lastStyleOk.style} ${subject}` : lastStyleOk.style,
      title: safeTitle(input, mode),
      lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null),
      notes: safeNotes(lastStyleOk.notes),
      source: 'model',
      fallbackReason: 'title_check_failed',
      profileVersion: MUSIC_PROFILE_VERSION,
      llmModel: config.model,
    };
  }
  return fallbackDesign(input, 'check_failed');
}

/** A design the customer read (and may have edited) in the dock, sent as it is after the same check. */
export function reviewedDesign(input: MusicDesignInput, edited: { style: string; title?: string | null }): MusicDesign | { problems: string[]; named: boolean } {
  const mode = wayOf(input);
  const style = edited.style.replace(/\s+/g, ' ').trim();
  const title = (edited.title ?? '').trim() || musicTitle(input.prompt);
  // The customer's own wording may be short, in Korean, or say "no X": only the hard limits and names stop it.
  const problems: string[] = [];
  if (!style) problems.push('the style is empty');
  if (style.length > DESIGN_LIMITS.styleHardMax) problems.push(`the style is over ${DESIGN_LIMITS.styleHardMax} characters`);
  if (mode === 'custom' && title.length > 80) problems.push('the title is over 80 characters');
  const named = Boolean(namedArtist(style) || namedArtist(title));
  if (named) problems.push('a real artist or song is named');
  if (problems.length) return { problems, named };
  return {
    mode,
    style,
    title,
    lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null),
    notes: null,
    source: 'reviewed',
    profileVersion: MUSIC_PROFILE_VERSION,
    llmModel: null,
  };
}
