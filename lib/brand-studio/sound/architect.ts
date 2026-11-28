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
import { formSentence, opensOnIntro, type RunPlanRecord } from './length-plan';
import { markLyrics, musicStyle, ownLyrics, musicWay, SUPERLATIVE, type LyricStructure, type MusicWay } from './lyrics';
import { describeSentence, musicTitle } from './music-text';
import { namedArtist } from './names';
import { promptGuardMode } from '@/lib/flags';
import { MINIMAX_OPEN_WEIGHTS_TAGS, musicProfileForModel } from '../enhancer/profiles/music';
import type { MusicModelId } from './engine';
import { minimaxMusic3Sunra } from './engines/minimax-sunra';
import { parseRequestedSeconds } from './requested-seconds';
import { videoTargetSeconds } from './video-fit';

export const MUSIC_PROFILE_VERSION = `${SUNO_HEADER.id}@${SUNO_HEADER.version}`;
/** The engine's style field holds 1,000 characters; the paragraph aims for 900 (§12.2). */
export const DESIGN_LIMITS = { styleMax: 900, styleHardMax: 1000, titleMax: 40, notesMax: 200 } as const;
const DESIGN_TIMEOUT_MS = 25_000;

export interface MusicDesignReadings {
  audio?: string;
  voice?: string;
  inspo?: string[];
}

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
  /**
   * The length plan of sung lyrics (./length-plan.ts, §12.11): the tempo decided once and the form (sections, the
   * hook again). The sent lyrics follow the form and the design keeps the tempo and describes the form.
   */
  plan?: RunPlanRecord | null;
  /** Sound Studio v2: composer mode (`simple` | `advanced`). */
  composerMode?: 'simple' | 'advanced';
  /** Sound Studio v2: resolved target length in seconds for Suno ordering/planning. */
  targetSeconds?: number | null;
  /** Sound Studio v2 (`minimax-music-3`): explicit customer `duration` (`1..75`). */
  durationSeconds?: number | null;
  /** Sound Studio v2: optional reference readings (`audio`, `voice`, `inspo`). */
  readings?: MusicDesignReadings | null;
  /** Sound Studio v2: true when `lyrics` came from the customer (passed through untouched) vs studio-drafted. */
  customerLyrics?: boolean;
  /** Optional organization id for `guardRequest` (`PROMPT_GUARD_ORGS`). */
  organizationId?: string | null;
}

export interface MusicWords {
  brand?: { name: string; readAs?: string | null } | null;
  mustInclude?: readonly string[];
}

export interface MusicDesign {
  mode: MusicWay;
  /** Describe mode: the request paragraph. Custom mode: `style`. */
  style: string;
  /** Present on v2 `minimax-music-3` designs: the exact `TextToMusicInput.prompt` Structured Caption (<=2,000). */
  prompt?: string;
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
  /** Present on v2 `minimax-music-3` designs: resolved `duration` (`1..75` s). */
  durationSeconds?: number;
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
  /** MiniMax vocal runs with blank customer lyrics: the studio-drafted lyrics (with bare section tags) sent to the engine. */
  lyrics?: string;
  /** Which text model drafted `lyrics` (`'local'` in fake mode without a key). */
  lyricsModel?: string | null;
  /** Optional resolved MiniMax `duration` recorded on v2 enhancer metadata. */
  durationSeconds?: number | null;
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
      : [musicStyle(input.prompt, input.vocal, Boolean(lyrics), input.language), input.plan && lyrics ? formSentence(input.plan) : ''].filter(Boolean).join(' ');
  return {
    mode,
    style: style.slice(0, DESIGN_LIMITS.styleHardMax),
    title: musicTitle(input.prompt),
    lyrics: markLyrics(lyrics, input.structure ?? null, input.plan?.form ?? null),
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

/** The style against the plan: the planned tempo (within 3 BPM), and no "straight into the hook" over an intro. */
export function planProblems(style: string, input: Pick<MusicDesignInput, 'plan' | 'vocal' | 'lyrics'>): string[] {
  const plan = input.plan;
  if (!plan || !input.vocal || !input.lyrics.trim()) return [];
  const problems: string[] = [];
  const written = /(\d{2,3})\s*BPM/i.exec(style);
  if (!written) problems.push(`the style gives no tempo; write around ${plan.bpm} BPM`);
  else if (Math.abs(Number(written[1]) - plan.bpm) > 3) problems.push(`the style's tempo is ${written[1]} BPM; the lyrics are planned at ${plan.bpm} BPM`);
  if (opensOnIntro(plan.form) && /right away|straight (?:in)?to|immediately|no intro|without (?:an )?intro/i.test(style)) {
    problems.push('the form opens on an instrumental intro; do not say it goes straight into the hook');
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
    ...(input.plan && input.vocal && input.lyrics.trim()
      ? [
          `Tempo: ${input.plan.bpm} BPM exactly; the lyrics are planned at it. Write "around ${input.plan.bpm} BPM".`,
          `The form is fixed: ${formSentence(input.plan).replace(/^Around \d+ BPM\. /, '')} Describe this arrangement in the structure sentence${opensOnIntro(input.plan.form) ? '; it opens on the intro, so never say it goes straight into the hook' : ''}.`,
        ]
      : []),
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
    problems = [...planProblems(design.style, input), ...checkMusicDesign(design, mode, input.prompt, styleMax)];
    if (problems.length === 0) {
      return {
        mode,
        style: subject ? `${design.style} ${subject}` : design.style,
        title: design.title,
        lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null, input.plan?.form ?? null),
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
      lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null, input.plan?.form ?? null),
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
    lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null, input.plan?.form ?? null),
    notes: null,
    source: 'reviewed',
    profileVersion: MUSIC_PROFILE_VERSION,
    llmModel: null,
  };
}

/* =================================================== Sound Studio v2 per-model Prompt Architect */

export { DESIGN_TIMEOUT_MS };

/** MiniMax `TextToMusicInput.prompt` holds 2,000 characters (`oapi-minimax_minimax-music3.json:367`); minimum 200, aim <= 1,800. */
export const MINIMAX_DESIGN_LIMITS = {
  captionMin: 200,
  captionAimMax: 1800,
  captionHardMax: 2000,
  titleMax: 40,
  titleHardMax: 80,
  lyricsHardMax: 3500,
} as const;

const MINIMAX_INTERNAL_TERMS =
  /\b(suno|sunra|minimax|music-?3(?:\.0)?|max[_ ]mode|inspire-mode|custom-mode|text-to-music|num_inference_steps|guidance_scale|api|endpoint|prompt architect|json)\b/i;

/**
 * v2 notes sanitizer: `suno-v6` and `suno-v6-wild` use `safeNotes` (`INTERNAL_TERMS`);
 * `minimax-music-3` additionally blocks MiniMax engine / parameter identifiers (`MINIMAX_INTERNAL_TERMS`).
 */
export function safeNotesForModel(modelId: MusicModelId, notes: string | null | undefined): string | null {
  if (modelId !== 'minimax-music-3') return safeNotes(notes);
  const text = (notes ?? '').replace(/\s+/g, ' ').trim().slice(0, DESIGN_LIMITS.notesMax);
  if (!text || namedArtist(text) || MINIMAX_INTERNAL_TERMS.test(text) || SUPERLATIVE.test(text) || /\b(?:best|greatest|finest)\b/i.test(text)) {
    return null;
  }
  return text;
}

export function designMetaForModel(design: MusicDesign): MusicEnhanceMeta {
  const base = designMeta(design);
  return design.durationSeconds !== undefined ? { ...base, durationSeconds: design.durationSeconds } : base;
}

export interface MinimaxDurationInput {
  /** Explicit customer-chosen MiniMax duration (`1..75`). Highest precedence. */
  durationSeconds?: number | null;
  /** Attached video (`videoTargetSeconds(video)`). Second precedence. */
  video?: Pick<MusicVideoFit, 'seconds'> | null;
  /** Customer's prompt sentence (`parseRequestedSeconds(prompt)`). Third precedence; default is `60`. */
  prompt?: string | null;
}

/**
 * Single source of truth for MiniMax Music 3.0 `duration` precedence (`customer > video > sentence > 60`, clamped `1..75`).
 * Shared across `design-op.ts`, `prepare-music.ts`, `architect.ts`, `provider/requests.ts`, and `scripts/sound-architect-eval.ts`.
 */
export function resolveMinimaxDurationSeconds(input: MinimaxDurationInput): number {
  const range = minimaxMusic3Sunra.capabilities.lengthInput || { min: 1, max: 75 };
  const clamp = (n: number) => Math.min(range.max, Math.max(range.min, Math.round(n)));
  if (typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)) {
    return clamp(input.durationSeconds);
  }
  if (input.video) {
    return clamp(videoTargetSeconds(input.video));
  }
  const fromSentence = input.prompt ? parseRequestedSeconds(input.prompt) : null;
  return fromSentence !== null ? clamp(fromSentence) : 60;
}

/** Open-weights MiniMax Music 3.0 section tag allow-list (bare `[Tag]` on its own line; no inline directions). */
export const MINIMAX_BARE_TAGS = MINIMAX_OPEN_WEIGHTS_TAGS;

const MINIMAX_BARE_TAG_SET: ReadonlySet<string> = new Set<string>(
  musicProfileForModel('minimax-music-3').allowedTags ?? MINIMAX_BARE_TAGS,
);

const MINIMAX_SEQUENCES: Readonly<Record<LyricStructure, readonly string[]>> = {
  hook: ['[Chorus]'],
  'hook-verse': ['[Chorus]', '[Verse]', '[Chorus]'],
  full: ['[Verse]', '[Chorus]', '[Verse]', '[Chorus]', '[Bridge]', '[Chorus]'],
};

const OWN_SECTION_MARK = /^\s*\[[^\]\n]{1,40}\]\s*$/m;

/**
 * Marks lyrics for MiniMax Music 3.0 (`minimax/minimax-music3/text-to-music`):
 *  - Customer lyrics that already carry section tags go byte-for-byte untouched.
 *  - Untagged stanzas receive bare tags from the 9-tag open-weights set (`[Verse]`, `[Chorus]`, `[Outro]`, ...),
 *    never Suno's `[Verse 1]`, `[Instrumental Break]`, `[End]`, or bar-length `formLyrics` padding.
 *  - Every sung line stays byte-for-byte untouched (`withoutAddedLines` returns `ownLyrics(lyrics)`).
 */
export function markMinimaxLyrics(lyrics: string, structure: LyricStructure | null): string {
  const text = ownLyrics(lyrics);
  if (!text.trim()) return '';
  if (OWN_SECTION_MARK.test(text)) return text;
  const lines = text.split('\n');
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim() && (i === 0 || !lines[i - 1]!.trim())) starts.push(i);
  });
  const seq = MINIMAX_SEQUENCES[structure ?? 'full'];
  const marks = Array.from({ length: starts.length }, (_, i) => seq[Math.min(i, seq.length - 1)]!);
  if (starts.length >= 2) marks[starts.length - 1] = '[Outro]';
  const out: string[] = [];
  let next = 0;
  lines.forEach((line, i) => {
    if (starts[next] === i) out.push(marks[next++]!);
    out.push(line);
  });
  return out.join('\n');
}

export interface NormalizedReadings {
  audio?: string;
  voice?: string;
  inspo?: string[];
}

function cleanReadingText(raw: string | undefined, maxChars: number): string {
  if (!raw) return '';
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  if (!cleaned || namedArtist(cleaned) || MINIMAX_INTERNAL_TERMS.test(cleaned)) return '';
  return cleaned;
}

/** Normalizes optional `readings` (`voice` is dropped when `!vocal`). Returns `null` when nothing usable is present. */
export function normalizeReadings(readings: MusicDesignReadings | null | undefined, vocal: boolean): NormalizedReadings | null {
  if (!readings) return null;
  const audio = cleanReadingText(readings.audio, 300);
  const voice = vocal ? cleanReadingText(readings.voice, 300) : '';
  const inspo = (readings.inspo ?? [])
    .slice(0, 3)
    .map((item) => cleanReadingText(item, 400))
    .filter(Boolean);
  if (!audio && !voice && inspo.length === 0) return null;
  return {
    ...(audio ? { audio } : {}),
    ...(voice ? { voice } : {}),
    ...(inspo.length > 0 ? { inspo } : {}),
  };
}

function sunoReadingsFallbackClause(readings: NormalizedReadings | null): string {
  if (!readings) return '';
  const parts: string[] = [];
  if (readings.audio) parts.push(`Reference sound: ${readings.audio.replace(/[.]+$/, '')}.`);
  if (readings.voice) parts.push(`Vocal character: ${readings.voice.replace(/[.]+$/, '')}.`);
  if (readings.inspo?.length) parts.push(`Inspired by: ${readings.inspo.map((s) => s.replace(/[.]+$/, '')).join('; ')}.`);
  return parts.join(' ');
}

const MINIMAX_SUNG_IN: Readonly<Record<'ko' | 'en', string>> = {
  ko: 'Vocals sung in Korean.',
  en: 'Vocals sung in English.',
};

/**
 * Raw Architect-off pass-through for MiniMax (`planMusicV2` when `architect: false` and no readings are attached):
 * preserves customer prompt up to 2,000 chars without inventing headings when the customer explicitly switched the Architect off.
 */
export function minimaxFallbackDesign(input: MusicDesignInput, reason?: string): MusicDesign {
  const styleMax = minimaxMusic3Sunra.capabilities.limits.style;
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const mode = musicWay({ vocal: input.vocal, lyrics, careful: false });
  const base = input.prompt.replace(/\r\n?/g, '\n').trim();
  const suffix = [
    input.vocal && !lyrics ? MINIMAX_SUNG_IN[input.language] : '',
    sungWithoutLyrics(input) ? wordsLine(wordsOf(input)) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = suffix
    ? `${base.slice(0, Math.max(1, styleMax - suffix.length - 1)).trim()} ${suffix}`
    : base.slice(0, styleMax);
  const finalStyle = style.slice(0, styleMax);
  return {
    mode,
    style: finalStyle,
    prompt: finalStyle,
    title: musicTitle(input.prompt),
    lyrics: lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '',
    notes: null,
    source: 'fallback',
    ...(reason ? { fallbackReason: reason } : {}),
    profileVersion: musicProfileForModel('minimax-music-3').version,
    llmModel: null,
  };
}

/**
 * Deterministic per-model fallback (`fallbackDesignForModel`, Deliverable 4):
 *  - `suno-v6` / `suno-v6-wild`: today's `fallbackDesign` (plus deterministic reading traits when `readings` are attached),
 *    tagged with the model's `profileVersion`.
 *  - `minimax-music-3`: a deterministic 3-heading Structured Caption (`Global Metadata:`, `Vocal Details:`, `Arrangement:`)
 *    with a safe generic English frame and the customer's own sentence quoted verbatim (zero invented translations,
 *    BPM, key, or vocal gender), plus any attached `readings` folded in deterministically.
 *  - Always marked `source: 'fallback'` with `fallbackReason` so `work.enhancer` and "보낸 문장 보기" tell the truth.
 */
export function fallbackDesignForModel(modelId: MusicModelId, input: MusicDesignInput, reason?: string): MusicDesign {
  const profile = musicProfileForModel(modelId);
  const readings = normalizeReadings(input.readings, input.vocal);

  if (modelId === 'suno-v6' || modelId === 'suno-v6-wild') {
    const base = fallbackDesign(input, reason);
    const readingClause = sunoReadingsFallbackClause(readings);
    const hardMax = profile.limits.styleHardMax;
    const style = readingClause
      ? `${base.style.slice(0, Math.max(1, hardMax - readingClause.length - 1)).trim()} ${readingClause}`.slice(0, hardMax)
      : base.style;
    return {
      ...base,
      style,
      profileVersion: profile.version,
    };
  }

  const styleMax = profile.limits.styleHardMax;
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const markedLyrics = lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '';
  const mode = musicWay({ vocal: input.vocal, lyrics, careful: false });
  const durationSeconds = resolveMinimaxDurationSeconds({
    durationSeconds: input.durationSeconds,
    video: input.video,
    prompt: input.prompt,
  });
  const sungKorean = lyrics ? /[가-힣]/.test(lyrics) : input.language === 'ko';

  const audioTrait = readings?.audio ? ` Reference audio character: ${readings.audio.replace(/[.]+$/, '')}.` : '';
  const inspoTrait = readings?.inspo?.length
    ? ` Reference style direction: ${readings.inspo.map((s) => s.replace(/[.]+$/, '')).join('; ')}.`
    : '';
  const voiceTrait = readings?.voice ? ` Reference vocal character: ${readings.voice.replace(/[.]+$/, '')}.` : '';
  const words = sungWithoutLyrics(input) ? ` ${wordsLine(wordsOf(input))}` : '';

  const vocalDetails = input.vocal
    ? `Vocal Details: Lead vocal${sungKorean ? ' singing in Korean' : ''} with clear, natural studio placement and balanced diction.${voiceTrait}${words}`
    : 'Vocal Details: Instrumental; a soft felt piano carries the central melodic theme with no vocals.';

  const usedTags = markedLyrics ? extractStandardMinimaxTags(markedLyrics) : [];
  const arrangement =
    usedTags.length > 0
      ? `Arrangement: ${usedTags.map((t) => `${t}: steady musical accompaniment shapes this section cleanly.`).join(' ')}`
      : input.vocal
        ? 'Arrangement: Intro: clean accompaniment sets the pulse. Verse: core groove supports the vocal line. Chorus: fuller harmonic layers lift the main hook. Outro: instruments resolve neatly.'
        : 'Arrangement: Opening establishes the core groove cleanly, the main section develops the primary musical theme with steady momentum, and the ending resolves neatly.';

  const quoteBudget = Math.max(
    40,
    styleMax - vocalDetails.length - arrangement.length - audioTrait.length - inspoTrait.length - 180,
  );
  const flatPrompt = input.prompt.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  const quoted = flatPrompt.length > quoteBudget ? `${flatPrompt.slice(0, quoteBudget - 1).trim()}…` : flatPrompt;

  const globalMetadata = `Global Metadata: Commercial music piece guided by the request "${quoted}". Balanced modern studio production with steady rhythmic phrasing and clean dynamic contour.${audioTrait}${inspoTrait}`;
  const caption = `${globalMetadata}\n${vocalDetails}\n${arrangement}`.slice(0, styleMax);

  return {
    mode,
    style: caption,
    prompt: caption,
    title: musicTitle(input.prompt),
    lyrics: markedLyrics,
    notes: null,
    source: 'fallback',
    ...(reason ? { fallbackReason: reason } : {}),
    profileVersion: profile.version,
    llmModel: null,
    durationSeconds,
  };
}

/* --------------------------------------------------- v2 duration, BPM, key, gender, and lyric checks */

/**
 * Detects written durations in seconds or minutes across all v2 models while treating era descriptors
 * (`'70s-inspired'`, `'90s hip-hop'`, `'80s synth'`, `'late-80s'`, `'1980s'`, `"'70s"`) as style words, never durations.
 */
export function hasDurationWording(text: string): boolean {
  const withoutEras = text
    // Four-digit decades: 1960s, 1980s-inspired, 2000s, 2010s
    .replace(/\b(?:19|20)\d0s(?:-[A-Za-z]+)?\b/gi, ' ')
    // Apostrophe or qualified decades: '70s, ’80s, early-70s, mid 90s, late-80s
    .replace(/(?:['’]|\b(?:early|mid|late)[-\s]+)\d0s(?:-[A-Za-z]+)?\b/gi, ' ')
    // Hyphenated decade modifiers: 70s-inspired, 80s-style, 90s-tinged, 60s-era
    .replace(/\b[2-9]0s-[A-Za-z]+\b/gi, ' ')
    // Bare decade style words (50s, 60s, 70s, 80s, 90s) unless explicitly framed as a time cap ("under 60s", "60s long")
    .replace(
      /(?<!\b(?:under|over|within|exactly|around|about|for|to)\s+)\b[5-9]0s\b(?!\s+(?:long|duration|length|max|maximum|exact|clip|cut|spot|ad|commercial|version)\b)/gi,
      ' ',
    );
  return /\b\d+(?:\.\d+)?(?:\s*|-)(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b|\d+\s*(?:초(?!반)|분(?!기|할|위기))/i.test(
    withoutEras,
  );
}

const LOW_CONFIDENCE_CLAUSE =
  /\blow[-\s]*confidence\b|\b(?:bpm_?)?confidence\s*[:=]\s*['"]?low\b|\(\s*low\b[^)]*\)|\buncertain\b|\bnot\s+confident\b|불확실/i;

function stripLowConfidenceClauses(corpus: string): string {
  return corpus
    .split(/[;\n]+/)
    .filter((clause) => !LOW_CONFIDENCE_CLAUSE.test(clause))
    .join('\n');
}

interface ParsedBpmSpan {
  kind: 'single' | 'range';
  low: number;
  high: number;
  start: number;
  end: number;
}

function parseBpmSpans(text: string): ParsedBpmSpan[] {
  const spans: ParsedBpmSpan[] = [];
  const overlaps = (start: number, end: number) => spans.some((s) => start < s.end && end > s.start);

  const rangePatterns = [
    /\b(\d{2,3})\s*(?:[-–—~]|\s+to\s+)\s*(\d{2,3})\s*(?:bpm|beats\s+per\s+minute)\b/gi,
    /\bbetween\s+(\d{2,3})\s+and\s+(\d{2,3})\s*(?:bpm|beats\s+per\s+minute)\b/gi,
    /\b(?:bpm|템포)\s*[:=]?\s*(\d{2,3})\s*(?:[-–—~]|\s+to\s+)\s*(\d{2,3})\b/gi,
  ];
  for (const re of rangePatterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (overlaps(start, end) || a < 30 || b > 260) continue;
      if (a < b) {
        spans.push({ kind: 'range', low: a, high: b, start, end });
      } else if (a === b) {
        spans.push({ kind: 'single', low: a, high: a, start, end });
      }
    }
  }

  const singlePatterns = [
    /\b(\d{2,3})\s*(?:bpm|beats\s+per\s+minute)\b/gi,
    /\b(?:bpm|템포)\s*[:=]\s*(\d{2,3})\b/gi,
    /\bbpm\s+(\d{2,3})\b/gi,
  ];
  for (const re of singlePatterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const val = Number(m[1]);
      if (overlaps(start, end) || val < 30 || val > 260) continue;
      spans.push({ kind: 'single', low: val, high: val, start, end });
    }
  }

  return spans.sort((x, y) => x.start - y.start);
}

/**
 * Checks MiniMax BPM usage against `PROMPTING-RESEARCH.md:26,90`:
 *  - Unstated BPM (or low-confidence reading): exact single BPM (`120 BPM`) is rejected; a BPM range (`90–100 BPM`)
 *    or tempo feel word is allowed per `PROMPTING-RESEARCH.md:26` ("otherwise a range or a tempo word").
 *  - Stated BPM `S` in customer text or confident reading: single BPM in caption must be within `±3` of `S`;
 *    a BPM range `[low, high]` in caption must contain `S` (`low <= S <= high`).
 */
export function checkMinimaxCaptionBpm(caption: string, supportCorpus: string): string | null {
  const captionBpms = parseBpmSpans(caption);
  if (captionBpms.length === 0) return null;

  const supportedBpms = parseBpmSpans(stripLowConfidenceClauses(supportCorpus));

  if (supportedBpms.length === 0) {
    const exactSingle = captionBpms.find((s) => s.kind === 'single');
    if (exactSingle) {
      return `do not invent an exact BPM (${exactSingle.low} BPM) unless the request or reading states one; use a tempo feel word or a BPM range`;
    }
    return null;
  }

  for (const cap of captionBpms) {
    const agrees = supportedBpms.some((sup) => {
      if (sup.kind === 'single') {
        const stated = sup.low;
        return cap.kind === 'single' ? Math.abs(cap.low - stated) <= 3 : cap.low <= stated && stated <= cap.high;
      }
      return cap.kind === 'single'
        ? sup.low - 3 <= cap.low && cap.low <= sup.high + 3
        : cap.low <= sup.high && cap.high >= sup.low;
    });
    if (!agrees) {
      const statedLabel = supportedBpms
        .map((s) => (s.kind === 'single' ? `${s.low} BPM` : `${s.low}-${s.high} BPM`))
        .join(' / ');
      const gotLabel = cap.kind === 'single' ? `${cap.low} BPM` : `${cap.low}-${cap.high} BPM`;
      return `caption tempo (${gotLabel}) does not match the stated tempo (${statedLabel})`;
    }
  }

  return null;
}

/**
 * Detects a musical key in an English caption without matching plain English phrases (`"in a warm register"`,
 * `"in a small room"`, `"Global Metadata: A major-label pop sound"`, `"A minor adjustment"`):
 *  1. `'in the key of <note>'` / `'key of <note>'` / `'key: <note>'`.
 *  2. Note `A–G` with an explicit accidental (`#`, `♯`, `b`, `♭`, `sharp`, `flat`) adjacent to `major|minor|maj|min`.
 *  3. Natural note `B–G` adjacent to `major|minor|maj|min` (not hyphenated like `major-label`).
 *  4. Natural note `A`: `A maj` / `A min` / `A Major` / `A Minor`, `A major|minor` followed by `key|scale|tonality` or punctuation,
 *     or capital `A` mid-sentence (not at start of string/line or after `. ! ? : ; ( " — –`) followed by `major|minor`.
 */
export function hasCaptionMusicalKey(text: string): boolean {
  // 1. Explicit "key of <note>" / "in the key of <note>" / "key: <note>"
  if (/\b(?:in\s+the\s+key\s+of|key\s+of|key\s*:)\s*[A-G](?:\s*(?:#|♯|b|♭)|(?:\s+|-)(?:sharp|flat))?(?:\s+(?:major|minor|maj|min)\b(?!\s*-))?/i.test(text)) {
    return true;
  }
  // 2. Any note A–G with an explicit accidental symbol (#, ♯, b, ♭) + major/minor/maj/min
  if (/\b[A-G](?:#|♯|b|♭)\s+(?:major|minor|maj|min)\b(?!\s*-)/i.test(text)) {
    return true;
  }
  // 2b. Note B–G (any case) or capital A with word sharp/flat + major/minor/maj/min (avoids lowercase "a sharp minor shift")
  if (/\b(?:[B-Gb-g]|A)(?:\s+|-)(?:sharp|flat)\s+(?:major|minor|maj|min)\b(?!\s*-)/.test(text)) {
    return true;
  }
  // 3. Natural B–G + major/minor/maj/min (not hyphenated like "major-label")
  if (/\b[B-Gb-g]\s+(?:major|minor|maj|min)\b(?!\s*-)/.test(text)) {
    return true;
  }
  // 4a. Capital "A" with abbreviated mode ("A maj", "A min") or capitalized mode ("A Major", "A Minor")
  if (/\bA\s+(?:maj|min|Major|Minor)\b(?!\s*-)/.test(text)) {
    return true;
  }
  // 4b. Capital "A major" / "A minor" followed directly by musical key/chord nouns or clause-ending punctuation
  if (/\bA\s+(?:major|minor)(?=\s+(?:key|tonality|scale|chord|chords|triad|progression|harmony)\b|[.,;!?)]|$)/.test(text)) {
    return true;
  }
  // 4c. Harmonic-context capital "A major" / "A minor" ("in A minor", "of A major", "to A minor", "around A major"),
  //     never matching indefinite-article adjective phrases ("A minor adjustment", "A major lift")
  const NON_KEY_FOLLOW_NOUN =
    /\s+(?:adjustment|adjustments|shift|shifts|change|changes|lift|lifts|variation|variations|touch|detail|details|tweak|tweaks|role|part|step|drop|swell|build|moment|addition|difference|way)\b/i;
  for (const m of text.matchAll(/\b(?:in|of|to|from|into|around|on)\s+A\s+(?:major|minor)\b(?!\s*-)/g)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (!NON_KEY_FOLLOW_NOUN.test(after)) return true;
  }
  return false;
}

export function hasSupportedMusicalKey(supportCorpus: string): boolean {
  const confident = stripLowConfidenceClauses(supportCorpus);
  if (hasCaptionMusicalKey(confident)) return true;
  return /(?:(?<![A-Za-z])[A-G](?:#|♯|b|♭)?\s*(?:메이저|마이너|장조|단조)|(?:다|라|마|바|사|가|나)(?:올림|내림)?\s*(?:장조|단조)|(?<![A-Za-z])[A-G](?:#|♯|b|♭)\s*키|\b키\s*:\s*[A-G])/i.test(
    confident,
  );
}

const NON_VOCAL_PRODUCT_GENDER =
  /\b(?:women|woman|men|man|girls|girl|boys|boy|ladies|lady|guys|guy)(?:['’]s)?\s+(?:skincare|skin\s*care|wear|fashion|clothing|apparel|fragrance|perfume|cologne|grooming|cosmetics|beauty|shoes|footwear|activewear|sportswear|line|brand|collection|care|product|products|ad|commercial|spot|campaign)\b|(?:여성|남성|여자|남자)(?:용|복|의류|화장품|스킨케어|향수)|(?:여자\s*친구|남자\s*친구)/gi;

export function hasCaptionFemaleGender(caption: string): boolean {
  const cleaned = caption.replace(NON_VOCAL_PRODUCT_GENDER, ' ');
  return (
    /\b(?:female|feminine|woman|women|girl|girls|lady|ladies|songstress|diva|soprano|mezzo(?:-?soprano)?)\b/i.test(cleaned) ||
    /\balto\b(?!\s+(?:sax|saxophone|flute|horn|clarinet|recorder|trombone))/i.test(cleaned) ||
    /\bshe\s+(?:sings|delivers|carries|leads|opens|whispers|croons|belts|hums|harmonizes|enters)\b/i.test(cleaned) ||
    /\bher\s+(?:voice|vocal|vocals|delivery|register|timbre|tone|phrasing|falsetto|head\s+voice|chest\s+voice|singing|lead|harmonies)\b/i.test(cleaned) ||
    /여가수|여성|여자|여\s*보컬|걸\s*그룹|소녀/.test(cleaned)
  );
}

export function hasCaptionMaleGender(caption: string): boolean {
  const cleaned = caption.replace(NON_VOCAL_PRODUCT_GENDER, ' ');
  return (
    /\b(?:male|masculine|man|men|boy|boys|guy|guys|gentleman|frontman)\b/i.test(cleaned) ||
    /\b(?:baritone|tenor|countertenor)\b(?!\s+(?:sax|saxophone|guitar|ukulele|horn|trombone|recorder))/i.test(cleaned) ||
    /\bbass\s+(?:vocal|vocalist|singer|voice)\b/i.test(cleaned) ||
    /\bhe\s+(?:sings|delivers|carries|leads|opens|whispers|croons|belts|hums|harmonizes|enters|raps)\b/i.test(cleaned) ||
    /\bhis\s+(?:voice|vocal|vocals|delivery|register|timbre|tone|phrasing|falsetto|head\s+voice|chest\s+voice|singing|lead|harmonies)\b/i.test(cleaned) ||
    /남가수|남성|남자|남\s*보컬|보이\s*그룹|소년/.test(cleaned)
  );
}

const KO_NON_SINGER_SUFFIX =
  /(?!\s*(?:친구|복|용|의류|화장품|스킨케어|향수|신발|가방|시계|고객|타겟|전용|브랜드|라인|제품|패션|선물|모델))/;

/**
 * Singer-gender support in customer text or readings: counts ONLY expressions that describe a singer or voice
 * (`'여성 보컬'`, `'여자 목소리'`, `'여가수'`, `'female vocal'`, `'male singer'`, etc.); non-singer product/person words
 * (`'여자친구'`, `'남자친구'`, `'여성복'`, `'남성용'`, `"women's skincare"`) never count as vocal gender support.
 */
export function hasSupportedFemaleGender(context: Pick<MusicDesignCheckContext, 'prompt' | 'readings'>, vocal: boolean): boolean {
  if (!vocal) return false;
  const general = [context.prompt ?? '', context.readings?.audio ?? '', ...(context.readings?.inspo ?? [])]
    .join('\n')
    .replace(NON_VOCAL_PRODUCT_GENDER, ' ');
  const voiceReading = (context.readings?.voice ?? '').replace(NON_VOCAL_PRODUCT_GENDER, ' ');

  if (voiceReading && (/\b(?:female|feminine|woman|girl|lady|soprano|mezzo|alto)\b/i.test(voiceReading) || /여가수|여성|여자|여\s*보컬|걸\s*그룹|소녀|알토|소프라노/.test(voiceReading))) {
    return true;
  }

  return (
    /\b(?:soprano|mezzo(?:-?soprano)?|songstress|girl\s+group)\b/i.test(general) ||
    /\balto\b(?!\s+(?:sax|saxophone|flute|horn|clarinet|recorder|trombone))/i.test(general) ||
    /\b(?:female|feminine|woman|girl|lady)(?:\s+[a-z-]+){0,2}\s+(?:vocal|vocals|vocalist|voice|singer|singing|lead|rapper|harmonies|duet|solo|alto|soprano|mezzo|delivery|tone|timbre|register)\b/i.test(general) ||
    /\b(?:vocal|vocals|vocalist|voice|singer|lead)\s+(?:is\s+|by\s+a\s+)?(?:female|feminine|woman|girl|lady)\b/i.test(general) ||
    /\b(?:sung|performed|fronted)\s+by\s+a\s+(?:female|woman|girl|lady)\b/i.test(general) ||
    /\bshe\s+sings\b|\bher\s+(?:voice|vocal|vocals)\b/i.test(general) ||
    /여가수|여\s*보컬|걸\s*그룹|소프라노|메조\s*소프라노|알토(?!\s*색소폰)/.test(general) ||
    new RegExp(
      `(?:여성|여자|소녀)${KO_NON_SINGER_SUFFIX.source}\\s*(?:[가-힣]+\\s+){0,2}(?:보컬|목소리|음색|가수|싱어|보이스|창법|래퍼|솔로|듀엣|코러스|알토|소프라노)`,
    ).test(general) ||
    /(?:여성|여자|소녀)(?:이|가)\s*(?:부르|불러|노래|랩)/.test(general) ||
    /(?:보컬|목소리|음색|가수|싱어|보이스)(?:은|는|이|가|:|\s)\s*(?:여성|여자|소녀)(?!(?:친구|복|용|의류|화장품|향수|선물))/.test(general)
  );
}

export function hasSupportedMaleGender(context: Pick<MusicDesignCheckContext, 'prompt' | 'readings'>, vocal: boolean): boolean {
  if (!vocal) return false;
  const general = [context.prompt ?? '', context.readings?.audio ?? '', ...(context.readings?.inspo ?? [])]
    .join('\n')
    .replace(NON_VOCAL_PRODUCT_GENDER, ' ');
  const voiceReading = (context.readings?.voice ?? '').replace(NON_VOCAL_PRODUCT_GENDER, ' ');

  if (voiceReading && (/\b(?:male|masculine|man|boy|guy|baritone|tenor)\b|\bbass\s+(?:vocal|voice)\b/i.test(voiceReading) || /남가수|남성|남자|남\s*보컬|보이\s*그룹|소년|바리톤|테너/.test(voiceReading))) {
    return true;
  }

  return (
    /\b(?:baritone|tenor|countertenor|boy\s+band)\b(?!\s+(?:sax|saxophone|guitar|ukulele|horn|trombone|recorder))/i.test(general) ||
    /\bbass\s+(?:vocal|vocalist|singer|voice)\b/i.test(general) ||
    /\b(?:male|masculine|man|boy|guy)(?:\s+[a-z-]+){0,2}\s+(?:vocal|vocals|vocalist|voice|singer|singing|lead|rapper|harmonies|duet|solo|baritone|tenor|bass|delivery|tone|timbre|register)\b/i.test(general) ||
    /\b(?:vocal|vocals|vocalist|voice|singer|lead)\s+(?:is\s+|by\s+a\s+)?(?:male|masculine|man|boy|guy)\b/i.test(general) ||
    /\b(?:sung|performed|fronted)\s+by\s+a\s+(?:male|man|boy|guy)\b/i.test(general) ||
    /\bhe\s+sings\b|\bhis\s+(?:voice|vocal|vocals)\b/i.test(general) ||
    /남가수|남\s*보컬|보이\s*그룹|바리톤(?!\s*색소폰)|테너(?!\s*색소폰)/.test(general) ||
    new RegExp(
      `(?:남성|남자|소년)${KO_NON_SINGER_SUFFIX.source}\\s*(?:[가-힣]+\\s+){0,2}(?:보컬|목소리|음색|가수|싱어|보이스|창법|래퍼|솔로|듀엣|코러스|바리톤|테너)`,
    ).test(general) ||
    /(?:남성|남자|소년)(?:이|가)\s*(?:부르|불러|노래|랩)/.test(general) ||
    /(?:보컬|목소리|음색|가수|싱어|보이스)(?:은|는|이|가|:|\s)\s*(?:남성|남자|소년)(?!(?:친구|복|용|의류|화장품|향수|선물))/.test(general)
  );
}

const INSTRUMENTAL_SINGER_WORDS =
  /\b(?:singer|vocalist|sings|singing|sung|lead\s+vocal|backing\s+vocals?|(?:vocal|sung|voice|choir|choral|backing)\s+harmonies|wordless\s+vocals?|falsetto|rapper|rapping|crooner|choir)\b/i;

const MELODIC_INSTRUMENT_WORDS =
  /\b(?:piano|rhodes|wurlitzer|keys|keyboard|organ|clavinet|guitar|synth|synthesizer|pad|pluck|arp|arpeggio|strings|violin|viola|cello|contrabass|bass|upright|flute|piccolo|clarinet|oboe|bassoon|sax|saxophone|trumpet|flugelhorn|trombone|horn|tuba|brass|woodwind|harp|marimba|vibraphone|xylophone|glockenspiel|kalimba|celesta|mallet|bell|bells|chime|chimes|accordion|harmonica|mandolin|banjo|ukulele|sitar|lute|koto|gayageum|haegeum|daegeum|pipa|erhu|whistle|ocarina)\b/i;

const ARRANGEMENT_TAG_PATTERNS: Readonly<Record<(typeof MINIMAX_OPEN_WEIGHTS_TAGS)[number], RegExp>> = {
  Intro: /\b(?:intro|introduction|opening)\b/i,
  Verse: /\bverses?\b/i,
  'Pre-Chorus': /\bpre[-\s]?chorus(?:es)?\b/i,
  Chorus: /\b(?:chorus(?:es)?|hook)\b/i,
  'Post-Chorus': /\bpost[-\s]?chorus(?:es)?\b/i,
  Bridge: /\bbridges?\b/i,
  Instrumental: /\binstrumental\b/i,
  Solo: /\bsolos?\b/i,
  Outro: /\b(?:outro|outros|ending)\b/i,
};

function extractStandardMinimaxTags(lyrics: string): Array<(typeof MINIMAX_OPEN_WEIGHTS_TAGS)[number]> {
  const seen = new Set<(typeof MINIMAX_OPEN_WEIGHTS_TAGS)[number]>();
  const ordered: Array<(typeof MINIMAX_OPEN_WEIGHTS_TAGS)[number]> = [];
  for (const line of lyrics.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*\[([^\[\]\n]{1,40})\]\s*$/.exec(line);
    if (!m) continue;
    const rawName = m[1]!.trim();
    const matched = MINIMAX_OPEN_WEIGHTS_TAGS.find((t) => t.toLowerCase() === rawName.toLowerCase());
    if (matched && !seen.has(matched)) {
      seen.add(matched);
      ordered.push(matched);
    }
  }
  return ordered;
}

/**
 * Checks `PROMPTING-RESEARCH.md:28` (`[official]`, `SKILL.md`): each standard lyric section tag present in `lyrics`
 * has a matching section mention in `Arrangement:` (skipped when `lyrics` is empty or on customer-edited `reviewed` captions).
 */
export function checkMinimaxArrangementTags(arrangement: string, lyrics: string): string[] {
  if (!lyrics.trim()) return [];
  const tags = extractStandardMinimaxTags(lyrics);
  const missing = tags.filter((tag) => !ARRANGEMENT_TAG_PATTERNS[tag].test(arrangement));
  if (missing.length === 0) return [];
  return [`Arrangement: must mention every lyric section tag used (${missing.map((t) => `[${t}]`).join(', ')} missing)`];
}

/**
 * Validates MiniMax Music 3.0 lyrics (`PROMPTING-RESEARCH.md:29-34,165`, Deliverable 1 & Deliverable 3):
 *  - `1..3500` characters, non-blank, no artist names;
 *  - every bracket tag line stands alone on its own line (`[Tag]`) with nothing else on that line;
 *  - tag names come strictly from the 9-tag open-weights allow-list (`MINIMAX_BARE_TAGS`).
 */
export function checkMinimaxLyrics(lyrics: string): string[] {
  const problems: string[] = [];
  const maxLyrics = musicProfileForModel('minimax-music-3').limits.lyricsMax;
  const normalized = lyrics.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) {
    problems.push('lyrics are empty for a vocal MiniMax track');
    return problems;
  }
  if (normalized.length > maxLyrics) {
    problems.push(`lyrics are over ${maxLyrics} characters`);
  }
  if (namedArtist(normalized)) {
    problems.push('lyrics name a real artist or song');
  }
  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.includes('[') || trimmed.includes(']')) {
      const bare = /^\[([^\[\]\n]+)\]$/.exec(trimmed);
      if (!bare) {
        problems.push(`lyric tag line "${trimmed.slice(0, 40)}" must contain only a bare [Tag] on its own line`);
        continue;
      }
      const tagName = bare[1]!;
      if (!MINIMAX_BARE_TAG_SET.has(tagName)) {
        if (
          /[\s–—:-]/.test(tagName) &&
          !/^[A-Za-z-]+\s+\d+$/.test(tagName) &&
          MINIMAX_BARE_TAGS.some((allowed) => tagName.toLowerCase().startsWith(allowed.toLowerCase()))
        ) {
          problems.push(
            `lyric tag line "${trimmed.slice(0, 40)}" must contain only a bare [Tag] on its own line (put section directions in Arrangement:)`,
          );
        } else {
          problems.push(`lyric tag [${tagName}] is not in the allowed MiniMax set (${MINIMAX_BARE_TAGS.map((t) => `[${t}]`).join(' ')})`);
        }
      }
    }
  }
  return problems;
}

export type ProfileRuleSupport = 'official' | 'practitioner-consistent' | 'single-source' | 'our-measurement' | 'house';

export interface MusicDesignCheckItem {
  id: string;
  category: 'caption' | 'title' | 'lyrics';
  rule: string;
  support: ProfileRuleSupport;
  passed: boolean;
  problem?: string;
}

export interface MusicDesignCheckContext {
  prompt?: string;
  vocal?: boolean;
  lyrics?: string;
  language?: 'ko' | 'en';
  plan?: RunPlanRecord | null;
  brand?: MusicDesignInput['brand'];
  words?: MusicWords | null;
  readings?: MusicDesignReadings | null;
  styleMax?: number;
  /** When true, `design.lyrics` is the customer's own text (passed through byte-for-byte; never re-checked for bare tags). */
  customerLyrics?: boolean;
  /** Skips `minimax_arrangement_tags` on customer-edited `reviewed` captions (`CONTRACT-v2-REVIEW.md` S6). */
  source?: MusicDesign['source'];
}

export interface MinimaxCaptionSections {
  globalMetadata: string;
  vocalDetails: string;
  arrangement: string;
}

/**
 * Parses the three headings of a MiniMax Music 3.0 Structured Caption (`Global Metadata:`, `Vocal Details:`,
 * `Arrangement:`). Returns `null` if any heading is missing, repeated, out of order, or empty (`PROMPTING-RESEARCH.md:24`).
 */
export function parseMinimaxCaptionSections(caption: string): MinimaxCaptionSections | null {
  const normalized = caption.replace(/\r\n?/g, '\n');
  const gmMatches = [...normalized.matchAll(/(?:^|\n)[ \t]*Global Metadata[ \t]*:/g)];
  const vdMatches = [...normalized.matchAll(/(?:^|\n)[ \t]*Vocal Details[ \t]*:/g)];
  const arMatches = [...normalized.matchAll(/(?:^|\n)[ \t]*Arrangement[ \t]*:/g)];
  if (gmMatches.length !== 1 || vdMatches.length !== 1 || arMatches.length !== 1) return null;
  const gm = gmMatches[0]!;
  const vd = vdMatches[0]!;
  const ar = arMatches[0]!;
  const gmStart = gm.index ?? -1;
  const vdStart = vd.index ?? -1;
  const arStart = ar.index ?? -1;
  if (gmStart < 0 || !(gmStart < vdStart && vdStart < arStart)) return null;
  const beforeGm = normalized.slice(0, gmStart).trim();
  if (beforeGm.length > 0) return null;
  const globalMetadata = normalized.slice(gmStart + gm[0].length, vdStart).trim();
  const vocalDetails = normalized.slice(vdStart + vd[0].length, arStart).trim();
  const arrangement = normalized.slice(arStart + ar[0].length).trim();
  if (!globalMetadata || !vocalDetails || !arrangement) return null;
  return { globalMetadata, vocalDetails, arrangement };
}

/**
 * Pinned Hangul-in-caption rule for MiniMax Music 3.0 (`PROMPTING-RESEARCH.md:24,162`, Deliverable 3):
 *  1. Any Hangul (`[가-힣ㄱ-ㅎㅏ-ㅣ]`) outside quotes (`"..."`, `'...'`, `“...”`, `‘...’`) is rejected.
 *  2. Quoted spans containing Hangul must be `<= 40` characters (a brand or product name, never a sentence),
 *     must not contain Jamo-only fragments (`[ㄱ-ㅎㅏ-ㅣ]`), and — whenever customer context (`prompt`, `brand`,
 *     `words`) is supplied — every Hangul token `[가-힣]+` inside the quotes must appear in that customer context.
 */
function checkMinimaxEnglishOnly(caption: string, context: MusicDesignCheckContext): string | null {
  const allowedSources = [
    context.prompt ?? '',
    context.brand?.name ?? '',
    context.words?.brand?.name ?? '',
    context.words?.brand?.readAs ?? '',
    ...(context.words?.mustInclude ?? []),
  ]
    .join(' ')
    .trim();

  const quotePattern = /"([^"\n]*)"|'([^'\n]*)'|“([^”\n]*)”|‘([^’\n]*)’/g;
  for (const match of caption.matchAll(quotePattern)) {
    const inner = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(inner)) continue;
    if (/[ㄱ-ㅎㅏ-ㅣ]/.test(inner) || inner.length > 40) {
      return 'the caption must be in English (quoted Hangul may only be a short brand or product name)';
    }
    if (allowedSources) {
      const tokens = inner.match(/[가-힣]+/g) ?? [];
      if (tokens.some((tok) => !allowedSources.includes(tok))) {
        return 'quoted Hangul in the caption is not a brand or product name from the request';
      }
    }
  }

  const unquoted = caption.replace(quotePattern, '""');
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(unquoted)) {
    return 'the caption must be written in English (Hangul is only allowed inside quotes for a brand or product name)';
  }
  return null;
}

interface MinimaxSupportSummary {
  supportCorpus: string;
  hasSupportedBpm: boolean;
  keyAllowed: boolean;
  femaleAllowed: boolean;
  maleAllowed: boolean;
}

function summarizeMinimaxSupport(
  context: Pick<MusicDesignCheckContext, 'prompt' | 'readings'>,
  vocal: boolean,
): MinimaxSupportSummary {
  const r = context.readings;
  const supportCorpus = [
    context.prompt ?? '',
    r?.audio ?? '',
    ...(vocal && r?.voice ? [r.voice] : []),
    ...(r?.inspo ?? []),
  ].join('\n');
  return {
    supportCorpus,
    hasSupportedBpm: parseBpmSpans(stripLowConfidenceClauses(supportCorpus)).length > 0,
    keyAllowed: hasSupportedMusicalKey(supportCorpus),
    femaleAllowed: hasSupportedFemaleGender(context, vocal),
    maleAllowed: hasSupportedMaleGender(context, vocal),
  };
}

/**
 * Detailed per-rule inspection of a music design for `modelId` (`suno-v6`, `suno-v6-wild`, `minimax-music-3`).
 * Every check item is labelled with its `category` (`'caption' | 'title' | 'lyrics'`) and research `support` level.
 */
export function inspectMusicDesignForModel(
  modelId: MusicModelId,
  design: { style?: string; prompt?: string; title?: string; lyrics?: string },
  context: MusicDesignCheckContext = {},
): MusicDesignCheckItem[] {
  const vocal = context.vocal ?? false;
  const profile = musicProfileForModel(modelId);

  if (modelId === 'suno-v6' || modelId === 'suno-v6-wild') {
    const style = (design.style ?? design.prompt ?? '').trim();
    const styleMin = profile.limits.styleMin;
    const styleMax = context.styleMax ?? profile.limits.styleHardMax;
    const planIssues = planProblems(style, {
      plan: context.plan ?? null,
      vocal,
      lyrics: context.lyrics ?? design.lyrics ?? '',
    });
    const titleIssues = checkMusicTitle(design.title ?? '', context.prompt);
    const secondsHit = hasDurationWording(style);

    return [
      // [our-measurement] length-plan.ts tempo & intro consistency (`PROMPTING-RESEARCH.md:68`)
      {
        id: 'suno_length_plan',
        category: 'caption',
        rule: 'Planned BPM (within 3 BPM) and intro form match `length-plan.ts`',
        support: 'our-measurement',
        passed: planIssues.length === 0,
        ...(planIssues.length ? { problem: planIssues.join('; ') } : {}),
      },
      // [practitioner-consistent] + [official] single paragraph 40..styleMax (`PROMPTING-RESEARCH.md:57,81`)
      {
        id: 'suno_length_min',
        category: 'caption',
        rule: `Style paragraph is at least ${styleMin} characters`,
        support: 'practitioner-consistent',
        passed: style.length >= styleMin,
        ...(style.length < styleMin ? { problem: 'the style paragraph is too short' } : {}),
      },
      {
        id: 'suno_length_max',
        category: 'caption',
        rule: `Style paragraph fits within ${styleMax} characters`,
        support: 'official',
        passed: style.length <= styleMax,
        ...(style.length > styleMax ? { problem: `the style is over ${styleMax} characters` } : {}),
      },
      {
        id: 'suno_single_paragraph',
        category: 'caption',
        rule: 'Style is a single paragraph without line breaks',
        support: 'practitioner-consistent',
        passed: !/\n/.test(style),
        ...(/\n/.test(style) ? { problem: 'the style must be one paragraph without line breaks' } : {}),
      },
      // [house] no internal service, engine, or API terms (`suno.ts`)
      {
        id: 'suno_no_internal_terms',
        category: 'caption',
        rule: 'No service, engine, or API terms in style',
        support: 'house',
        passed: !INTERNAL_TERMS.test(style),
        ...(INTERNAL_TERMS.test(style) ? { problem: 'the style names the service or a technical term' } : {}),
      },
      // [official] no artist or song names (`PROMPTING-RESEARCH.md:47,84`, Suno blog)
      {
        id: 'suno_no_artist_names',
        category: 'caption',
        rule: 'No real artist, band, or song names in style',
        support: 'official',
        passed: !namedArtist(style),
        ...(namedArtist(style) ? { problem: 'the style names a real artist or song' } : {}),
      },
      // [official] no written length in seconds or minutes; era words ('70s-inspired', '90s hip-hop') allowed (`PROMPTING-RESEARCH.md:53,88`)
      {
        id: 'suno_no_seconds',
        category: 'caption',
        rule: 'No duration in seconds or minutes inside style (era words like 80s/90s allowed)',
        support: 'official',
        passed: !secondsHit,
        ...(secondsHit ? { problem: 'the style gives a length in seconds or minutes' } : {}),
      },
      // [our-measurement] instrumental requests send empty lyrics (`PROMPTING-RESEARCH.md:67`)
      {
        id: 'suno_instrumental_lyrics',
        category: 'lyrics',
        rule: 'Instrumental tracks carry empty lyrics',
        support: 'our-measurement',
        passed: vocal || !(design.lyrics ?? '').trim(),
        ...(!vocal && (design.lyrics ?? '').trim() ? { problem: 'lyrics must be empty when instrumental is true' } : {}),
      },
      // [house] track list / custom title rules (`suno.ts:76`)
      {
        id: 'suno_title',
        category: 'title',
        rule: 'Title is 1..40 characters with no artist name, superlative, or copied request prefix',
        support: 'house',
        passed: titleIssues.length === 0,
        ...(titleIssues.length ? { problem: titleIssues.join('; ') } : {}),
      },
    ];
  }

  // MiniMax Music 3.0 (`PROMPTING-RESEARCH.md` §1, Deliverable 3):
  const caption = (design.prompt ?? design.style ?? '').replace(/\r\n?/g, '\n').trim();
  const captionMin = profile.limits.styleMin;
  const styleMax = context.styleMax ?? profile.limits.styleHardMax;
  const sections = parseMinimaxCaptionSections(caption);
  const support = summarizeMinimaxSupport(context, vocal);
  const englishIssue = checkMinimaxEnglishOnly(caption, context);
  const titleIssues = checkMusicTitle(design.title ?? '', context.prompt);

  // Rule M1 [official]: Three headings `Global Metadata:`, `Vocal Details:`, `Arrangement:` present and in order (`PROMPTING-RESEARCH.md:24`).
  const headingsOk = sections !== null;

  // Rule M2 [official]: Caption length 200..2000 (`PROMPTING-RESEARCH.md:36`, Sunra OpenAPI `maxLength: 2000`).
  const lengthProblem =
    caption.length < captionMin
      ? `the caption is under ${captionMin} characters`
      : caption.length > styleMax
        ? `the caption is over ${styleMax} characters`
        : null;

  // Rule M4 [official]: No artist or song names (`PROMPTING-RESEARCH.md:47,84`, Sunra `copyright` moderation).
  const artistHit = namedArtist(caption);

  // Rule M5 [house]: No internal engine / API terms.
  const internalHit = MINIMAX_INTERNAL_TERMS.test(caption);

  // Rule M6 [official]: No 'N seconds / minutes' wording inside caption; era words allowed (`PROMPTING-RESEARCH.md:41,88`).
  const durationHit = hasDurationWording(caption);

  // Rule M7a [official]: Exact BPM only when supported (within ±3); BPM range allowed or contains stated BPM (`PROMPTING-RESEARCH.md:26,90`).
  const bpmProblem = checkMinimaxCaptionBpm(caption, support.supportCorpus);

  // Rule M7b [official]: Musical key present ONLY if supported by customer's text or a reading (`PROMPTING-RESEARCH.md:26,90`).
  const keyInvented = hasCaptionMusicalKey(caption) && !support.keyAllowed;

  // Rule M7c [official]: Vocal gender present ONLY if a singer's gender is stated (`PROMPTING-RESEARCH.md:26`).
  const captionHasFemale = hasCaptionFemaleGender(caption);
  const captionHasMale = hasCaptionMaleGender(caption);
  const genderInvented = (captionHasFemale && !support.femaleAllowed) || (captionHasMale && !support.maleAllowed);

  // Rule M8a [official]: Instrumental vs Vocal (`PROMPTING-RESEARCH.md:27,35`).
  const vocalProblems: string[] = [];
  // Rule M8b [single-source]: Korean vocals state `"in Korean"` (`PROMPTING-RESEARCH.md:39`).
  let koreanLanguageProblem: string | null = null;
  const lyricsText = (design.lyrics ?? context.lyrics ?? '').replace(/\r\n?/g, '\n');

  if (!vocal) {
    if (sections) {
      const strippedNegations = sections.vocalDetails.replace(
        /\b(?:no|without|zero|free\s+of)\s+(?:vocals?|singers?|singing|voice|lyrics)\b/gi,
        ' ',
      );
      if (!/\binstrumental\b/i.test(sections.vocalDetails)) {
        vocalProblems.push('Vocal Details must state "Instrumental" when there are no vocals');
      }
      if (INSTRUMENTAL_SINGER_WORDS.test(strippedNegations)) {
        vocalProblems.push('Vocal Details must not describe a singer, singing, or vocal harmonies on an instrumental track');
      }
      if (!MELODIC_INSTRUMENT_WORDS.test(sections.vocalDetails)) {
        vocalProblems.push('Vocal Details must name a concrete lead melodic instrument on an instrumental track');
      }
    }
    if ((design.lyrics ?? '').trim()) {
      vocalProblems.push('instrumental MiniMax tracks must not include lyrics');
    }
  } else {
    const isKoreanVocal = lyricsText.trim() ? /[가-힣]/.test(lyricsText) : (context.language ?? 'ko') === 'ko';
    if (isKoreanVocal && !/\bin\s+Korean\b/i.test(caption)) {
      koreanLanguageProblem = 'Vocal Details must state "in Korean" when the vocals are sung in Korean';
    }
    if (lyricsText.trim()) {
      const captionLower = caption.toLowerCase();
      const quotedLine = lyricsText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('[') && l.replace(/\s+/g, '').length >= 10)
        .find((l) => captionLower.includes(l.toLowerCase()));
      if (quotedLine) {
        vocalProblems.push('never quote or repeat sung lyric lines inside the caption');
      }
    }
  }

  // Rule M8c [official]: Every standard lyric section tag has a matching `Arrangement:` mention (`PROMPTING-RESEARCH.md:28`).
  const arrangementTagProblems =
    vocal && sections && context.source !== 'reviewed' && lyricsText.trim()
      ? checkMinimaxArrangementTags(sections.arrangement, lyricsText)
      : [];

  // Rule M9 [official]: Bare lyric tags from the 9-tag open-weights allow-list, <= 3,500 chars (`PROMPTING-RESEARCH.md:29-32,165`).
  // Validated ONLY when non-empty studio-drafted lyrics are supplied (blank preview lyrics are valid; customer lyrics pass through).
  const checkLyricsNow = vocal && !context.customerLyrics && Boolean((design.lyrics ?? '').trim());
  const lyricsProblems = checkLyricsNow ? checkMinimaxLyrics(design.lyrics!) : [];

  return [
    {
      id: 'minimax_headings_in_order',
      category: 'caption',
      rule: 'Three headings Global Metadata:, Vocal Details:, Arrangement: present in exact order',
      support: 'official',
      passed: headingsOk,
      ...(!headingsOk
        ? {
            problem:
              'the caption must contain the exact three headings Global Metadata:, Vocal Details:, and Arrangement: in order, each with content',
          }
        : {}),
    },
    {
      id: 'minimax_caption_length',
      category: 'caption',
      rule: `Caption length is between ${captionMin} and ${styleMax} characters`,
      support: 'official',
      passed: lengthProblem === null,
      ...(lengthProblem ? { problem: lengthProblem } : {}),
    },
    {
      id: 'minimax_english_only',
      category: 'caption',
      rule: 'Caption is written in English (Hangul allowed only inside quotes for a customer-given brand or product name)',
      support: 'official',
      passed: englishIssue === null,
      ...(englishIssue ? { problem: englishIssue } : {}),
    },
    {
      id: 'minimax_no_artist_names',
      category: 'caption',
      rule: 'No real artist, band, or song names in caption',
      support: 'official',
      passed: !artistHit,
      ...(artistHit ? { problem: 'the caption names a real artist or song' } : {}),
    },
    {
      id: 'minimax_no_internal_terms',
      category: 'caption',
      rule: 'No internal service, engine, or API terms in caption',
      support: 'house',
      passed: !internalHit,
      ...(internalHit ? { problem: 'the caption names the service or a technical term' } : {}),
    },
    {
      id: 'minimax_no_duration_wording',
      category: 'caption',
      rule: 'No duration in seconds or minutes inside caption (length goes in duration; era words allowed)',
      support: 'official',
      passed: !durationHit,
      ...(durationHit ? { problem: 'the caption gives a length in seconds or minutes (length goes in duration, not the caption)' } : {}),
    },
    {
      id: 'minimax_no_invented_bpm',
      category: 'caption',
      rule: 'Exact BPM only when stated (within +-3); BPM range allowed or contains stated BPM',
      support: 'official',
      passed: bpmProblem === null,
      ...(bpmProblem ? { problem: bpmProblem } : {}),
    },
    {
      id: 'minimax_no_invented_key',
      category: 'caption',
      rule: 'Musical key appears only when supported by customer text or reading',
      support: 'official',
      passed: !keyInvented,
      ...(keyInvented ? { problem: 'do not invent a musical key unless the request or reading states it' } : {}),
    },
    {
      id: 'minimax_no_invented_gender',
      category: 'caption',
      rule: 'Vocal gender appears only when a singer gender is stated in customer text or reading',
      support: 'official',
      passed: !genderInvented,
      ...(genderInvented
        ? { problem: 'do not invent vocal gender or gendered singer pronouns unless the customer request or reading states a singer gender' }
        : {}),
    },
    {
      id: 'minimax_vocal_or_instrumental_details',
      category: 'caption',
      rule: 'Instrumental states Instrumental + lead instrument with no singer/lyrics; vocals never quote lyrics',
      support: 'official',
      passed: vocalProblems.length === 0,
      ...(vocalProblems.length ? { problem: vocalProblems.join('; ') } : {}),
    },
    {
      id: 'minimax_korean_language_named',
      category: 'caption',
      rule: 'Korean vocal captions explicitly include "in Korean"',
      support: 'single-source',
      passed: koreanLanguageProblem === null,
      ...(koreanLanguageProblem ? { problem: koreanLanguageProblem } : {}),
    },
    {
      id: 'minimax_arrangement_tags',
      category: 'caption',
      rule: 'Each standard lyric section tag has a matching Arrangement: mention (`PROMPTING-RESEARCH.md:28`)',
      support: 'official',
      passed: arrangementTagProblems.length === 0,
      ...(arrangementTagProblems.length ? { problem: arrangementTagProblems.join('; ') } : {}),
    },
    {
      id: 'minimax_lyrics_bare_tags',
      category: 'lyrics',
      rule: 'Non-empty studio lyrics <= 3,500 chars with bare tag lines strictly from the 9-tag open-weights set',
      support: 'official',
      passed: lyricsProblems.length === 0,
      ...(lyricsProblems.length ? { problem: lyricsProblems.join('; ') } : {}),
    },
    {
      id: 'minimax_title',
      category: 'title',
      rule: 'Title is 1..40 characters with no artist name, superlative, or copied request prefix',
      support: 'house',
      passed: titleIssues.length === 0,
      ...(titleIssues.length ? { problem: titleIssues.join('; ') } : {}),
    },
  ];
}

/**
 * Splits a model's caption/style problems, title problems, and lyric problems into separate lists (`MUST-FIX 3 & 4`).
 *  - `captionProblems` and `titleProblems` drive the caption model retry loop;
 *  - `lyricsProblems` are validated separately and never trigger a caption rewrite;
 *  - the `'title_check_failed'` shortcut applies ONLY when `captionProblems.length === 0 && titleProblems.length > 0`.
 */
export function partitionMusicDesignProblemsForModel(
  modelId: MusicModelId,
  design: { style?: string; prompt?: string; title?: string; lyrics?: string },
  context: MusicDesignCheckContext = {},
): {
  captionProblems: string[];
  titleProblems: string[];
  lyricsProblems: string[];
  items: MusicDesignCheckItem[];
} {
  const items = inspectMusicDesignForModel(modelId, design, context);
  const captionProblems: string[] = [];
  const titleProblems: string[] = [];
  const lyricsProblems: string[] = [];

  for (const item of items) {
    if (item.passed || !item.problem) continue;
    if (item.category === 'caption') captionProblems.push(item.problem);
    else if (item.category === 'title') titleProblems.push(item.problem);
    else lyricsProblems.push(item.problem);
  }
  return { captionProblems, titleProblems, lyricsProblems, items };
}

/**
 * Per-model code checks (`checkMusicDesignForModel`, Deliverable 3).
 * Returns human-readable problem strings (empty when the design passes every rule for `modelId`).
 */
export function checkMusicDesignForModel(
  modelId: MusicModelId,
  design: { style?: string; prompt?: string; title?: string; lyrics?: string },
  context: MusicDesignCheckContext = {},
): string[] {
  const { captionProblems, titleProblems, lyricsProblems } = partitionMusicDesignProblemsForModel(modelId, design, context);
  return [...captionProblems, ...lyricsProblems, ...titleProblems];
}

function v2SunoTaskBlock(input: MusicDesignInput, mode: MusicWay, styleMax: number, readings: NormalizedReadings | null): string {
  if (!readings) return taskBlock(input, mode, styleMax);
  const lines = [
    mode === 'describe'
      ? 'This run sends the style paragraph alone as the description of the track (no title, no lyrics).'
      : 'This run sends the style paragraph, the title and the lyrics separately.',
    input.vocal
      ? input.lyrics.trim()
        ? 'There are vocals and the customer wrote the lyrics: the voice sings them as written. Name the language of the lyrics in the voice sentence. Never quote or change the lyrics.'
        : `There are vocals and no lyrics: name the language to sing in, ${input.language === 'ko' ? 'Korean' : 'English'}, in the voice sentence.`
      : 'Instrumental: name what carries the melody; never mention a voice except to say the piece is instrumental.',
    ...(input.plan && input.vocal && input.lyrics.trim()
      ? [
          `Tempo: ${input.plan.bpm} BPM exactly; the lyrics are planned at it. Write "around ${input.plan.bpm} BPM".`,
          `The form is fixed: ${formSentence(input.plan).replace(/^Around \d+ BPM\. /, '')} Describe this arrangement in the structure sentence${opensOnIntro(input.plan.form) ? '; it opens on the intro, so never say it goes straight into the hook' : ''}.`,
        ]
      : []),
    ...(styleMax < DESIGN_LIMITS.styleHardMax
      ? [`Keep the style under ${styleMax} characters: a sentence saying what the song is about is added after it. Do not write the lyrics or the message yourself.`]
      : []),
    'Reference readings are given in `readings` (priority: customer request > audio/voice reading > inspo). Fold their musical traits into the paragraph without naming any artist or technical source.',
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

function minimaxTaskBlock(input: MusicDesignInput, readings: NormalizedReadings | null): string {
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const markedLyrics = lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '';
  const tags = markedLyrics ? extractStandardMinimaxTags(markedLyrics) : [];
  const sungKorean = lyrics ? /[가-힣]/.test(lyrics) : input.language === 'ko';
  const support = summarizeMinimaxSupport({ prompt: input.prompt, readings: input.readings }, input.vocal);
  const words = wordsOf(input);

  const lines = [
    'Output `style` with the exact three headings `Global Metadata:`, `Vocal Details:`, and `Arrangement:` on separate lines in that order (200 to 2,000 characters, aim for 450 to 1,800, English only, never write duration in seconds or minutes).',
    input.vocal
      ? sungKorean
        ? 'Vocals are ON (sung in Korean — include the exact phrase "in Korean" in Vocal Details). Never quote or paraphrase lyrics in the caption.'
        : 'Vocals are ON (sung in English). Never quote or paraphrase lyrics in the caption.'
      : 'Instrumental run (vocals are OFF): start Vocal Details with "Instrumental;" and name the concrete lead melodic instrument; never mention a singer, vocalist, singing, or vocal harmonies.',
    tags.length > 0
      ? `The sung lyrics use these section tags in order: ${tags.map((t) => `[${t}]`).join(' -> ')}. Name every one of these sections in Arrangement: in order with concrete musical changes.`
      : input.vocal
        ? 'Walk through Intro, Verse, Chorus, and Outro in Arrangement: with concrete instrument entries, changes, and ending.'
        : 'Walk through Opening, Middle, and Ending in Arrangement: with concrete instrument entries, texture shifts, and ending.',
    support.hasSupportedBpm
      ? 'A BPM is stated in the request or reading: keep your BPM within +-3 of that stated value (or use a range containing it).'
      : 'NO BPM was given in the request or readings: do NOT write an exact single BPM number; use tempo feel words (or a broad BPM range) only.',
    support.keyAllowed
      ? 'A musical key is supported by the request or reading: you may include it.'
      : 'NO musical key was given: do NOT write any musical key (such as C major or A minor) anywhere in `style`.',
    !input.vocal
      ? 'NO vocal gender words or gendered pronouns anywhere in `style`.'
      : support.femaleAllowed && !support.maleAllowed
        ? 'Female singer gender is supported by the request or reading ("female" allowed; never write "male").'
        : support.maleAllowed && !support.femaleAllowed
          ? 'Male singer gender is supported by the request or reading ("male" allowed; never write "female").'
          : support.femaleAllowed && support.maleAllowed
            ? 'Mixed or male/female singer gender is supported by the request or reading.'
            : 'NO singer gender was given in the request or readings: do NOT write "male", "female", "man", "woman", "boy", "girl", "lady", "guy", "feminine", "masculine", "she", "he", "her", or "his" anywhere in `style`; describe vocal timbre, register, and delivery without gender.',
    ...(words.length > 0 && sungWithoutLyrics(input)
      ? [`Brand / key words context (do not write raw Hangul outside double quotes): ${words.map((w) => `"${w}"`).join(', ')}.`]
      : []),
    ...(readings
      ? [
          'Reference readings are attached in `readings` (priority: customer request > audio/voice reading > inspo). Translate their musical traits into English without naming any artist.',
        ]
      : []),
    `Notes language: ${input.locale === 'ko' ? 'Korean (해요체, one sentence)' : 'English (one sentence)'}.`,
    ...(input.video ? [videoDesignLine(input.video)] : []),
    ...(input.avoid
      ? [
          "The music engine refused an earlier request from these words. Avoid anything that could read as a real artist, song, album, third-party brand, or explicit content; describe genre, groove, instruments, vocal timbre, and mix only.",
        ]
      : []),
  ];
  return `This run:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function v2PayloadOf(input: MusicDesignInput, readings: NormalizedReadings | null) {
  if (!readings) return payloadOf(input);
  return {
    ...payloadOf(input),
    readings,
  };
}

/**
 * Builds the exact system instruction sent to the text model for `modelId` and `input`.
 * Exported so unit tests can prove `buildMusicSystemText('suno-v6', input)` (without readings) is byte-identical
 * to today's closed-path `${SUNO_PROFILE}\n\n${taskBlock(input, mode, styleMax)}`, and equal to `suno-v6-wild`.
 */
export function buildMusicSystemText(modelId: MusicModelId, input: MusicDesignInput): string {
  const profile = musicProfileForModel(modelId);
  const readings = normalizeReadings(input.readings, input.vocal);
  if (modelId === 'minimax-music-3') {
    return `${profile.system}\n\n${minimaxTaskBlock(input, readings)}`;
  }
  const mode = wayOf(input);
  const subject = subjectSentence(input);
  const styleMax = subject ? DESIGN_LIMITS.styleHardMax - subject.length - 1 : DESIGN_LIMITS.styleHardMax;
  return `${profile.system}\n\n${v2SunoTaskBlock(input, mode, styleMax, readings)}`;
}

/** Exact system instruction string built on today's closed v1 `designMusic` path. */
export function buildClosedSunoSystemText(input: MusicDesignInput): string {
  const mode = wayOf(input);
  const subject = subjectSentence(input);
  const styleMax = subject ? DESIGN_LIMITS.styleHardMax - subject.length - 1 : DESIGN_LIMITS.styleHardMax;
  return `${SUNO_PROFILE}\n\n${taskBlock(input, mode, styleMax)}`;
}

/**
 * Sound Studio v2 per-model design operation (`designMusicForModel`, Deliverables 2–4):
 *  - Selects `musicProfileForModel(modelId)` (`suno-v6`, `suno-v6-wild`, `minimax-music-3`);
 *  - Uses the exact same Gemini configuration as `designMusic` (`studioGeminiConfig`, `thinking: 'LOW'`, `DESIGN_TIMEOUT_MS = 25_000`);
 *  - Never rewrites or sends customer lyrics to the text model;
 *  - Folds `input.readings` when present and omits it completely when absent;
 *  - Validates caption problems and title problems in separate lists (`partitionMusicDesignProblemsForModel`), never
 *    mixing lyric validation into the caption retry loop, retries at most once, applies `'title_check_failed'` ONLY
 *    when `captionProblems` is empty and within `styleMax`, and otherwise falls back to `fallbackDesignForModel`.
 */
export async function designMusicForModel(
  modelId: MusicModelId,
  input: MusicDesignInput,
  deps: DesignDeps,
): Promise<MusicDesign> {
  const profile = musicProfileForModel(modelId);
  const isMinimax = modelId === 'minimax-music-3';
  const rawLyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const mode = isMinimax
    ? musicWay({ vocal: input.vocal, lyrics: rawLyrics, careful: false })
    : wayOf(input);

  const config = studioGeminiConfig(deps.env);
  if (!config) return fallbackDesignForModel(modelId, input, 'no_key');

  const readings = normalizeReadings(input.readings, input.vocal);
  const subject = isMinimax ? '' : subjectSentence(input);
  const styleMax = isMinimax
    ? profile.limits.styleHardMax
    : subject
      ? profile.limits.styleHardMax - subject.length - 1
      : profile.limits.styleHardMax;

  const internalSystem = buildMusicSystemText(modelId, input);
  const payload = v2PayloadOf(input, readings);
  const guardMode = promptGuardMode(deps.env, 'brand-studio.sound-architect', input.organizationId);
  const aiGuard =
    guardMode !== 'off'
      ? (await import('@/lib/ai-guard')).guardRequest({
          site: 'brand-studio.sound-architect',
          env: deps.env,
          organizationId: input.organizationId,
          internal: internalSystem,
        })
      : null;

  const system = aiGuard ? aiGuard.system : internalSystem;
  const markedLyrics = isMinimax
    ? rawLyrics
      ? markMinimaxLyrics(rawLyrics, input.structure ?? null)
      : ''
    : markLyrics(rawLyrics, input.structure ?? null, input.plan?.form ?? null);
  const durationSeconds = isMinimax
    ? resolveMinimaxDurationSeconds({
        durationSeconds: input.durationSeconds,
        video: input.video,
        prompt: input.prompt,
      })
    : undefined;
  const customerLyrics = input.customerLyrics ?? Boolean(rawLyrics);

  let problems: string[] = [];
  let lastStyleOk: { style: string; notes: string } | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const baseUserJson = aiGuard ? aiGuard.json('request', payload) : JSON.stringify(payload);
    const text =
      attempt === 0
        ? baseUserJson
        : `${baseUserJson}\n\nYour last answer broke these rules; write it again without them:\n- ${problems.join('\n- ')}`;
    const parts = aiGuard ? aiGuard.parts([{ text }]) : [{ text }];

    let answer: z.infer<typeof DesignAnswer>;
    try {
      answer = DesignAnswer.parse(
        await callGeminiJson(config, deps.fetch, {
          system,
          parts,
          schema: DESIGN_SCHEMA as unknown as Record<string, unknown>,
          thinking: 'LOW',
          timeoutMs: DESIGN_TIMEOUT_MS,
        }),
      );
    } catch (error) {
      deps.log?.('studio_music_design_failed', {
        model: modelId,
        message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
      return fallbackDesignForModel(modelId, input, 'model_error');
    }

    const normalizedStyle = isMinimax
      ? answer.style.replace(/\r\n?/g, '\n').trim()
      : answer.style.replace(/\s+/g, ' ').trim();
    const trimmedTitle = answer.title.trim();

    if (aiGuard) {
      const verdict = aiGuard.check(
        { style: normalizedStyle, title: trimmedTitle, notes: answer.notes },
        { exempt: [input.prompt, input.brand?.tone ?? '', ...(input.brand?.rules ?? [])] },
      );
      if (verdict.fallback) {
        return fallbackDesignForModel(modelId, input, `prompt_guard_${verdict.reason}`);
      }
    }

    // MUST-FIX 3 & 4: check caption problems and title problems separately; never run lyric checks inside the caption retry loop.
    const { captionProblems, titleProblems } = partitionMusicDesignProblemsForModel(
      modelId,
      {
        style: normalizedStyle,
        ...(isMinimax ? { prompt: normalizedStyle } : {}),
        title: trimmedTitle,
      },
      {
        prompt: input.prompt,
        vocal: input.vocal,
        lyrics: markedLyrics,
        language: input.language,
        plan: isMinimax ? null : (input.plan ?? null),
        brand: input.brand,
        words: input.words ?? null,
        readings: input.readings ?? null,
        styleMax,
        customerLyrics,
        source: 'model',
      },
    );

    problems = [...captionProblems, ...titleProblems];

    if (captionProblems.length === 0 && titleProblems.length === 0 && normalizedStyle.length <= styleMax) {
      const finalStyle = subject ? `${normalizedStyle} ${subject}` : normalizedStyle;
      return {
        mode,
        style: finalStyle,
        ...(isMinimax ? { prompt: finalStyle } : {}),
        title: trimmedTitle,
        lyrics: markedLyrics,
        notes: safeNotesForModel(modelId, answer.notes),
        source: 'model',
        profileVersion: profile.version,
        llmModel: config.model,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    }

    const titleOnly = captionProblems.length === 0 && titleProblems.length > 0 && normalizedStyle.length <= styleMax;
    lastStyleOk = titleOnly ? { style: normalizedStyle, notes: answer.notes } : null;
    deps.log?.('studio_music_design_rejected', {
      model: modelId,
      attempt,
      problems: problems.join('; ').slice(0, 300),
    });
  }

  if (lastStyleOk && lastStyleOk.style.length <= styleMax) {
    const finalStyle = subject ? `${lastStyleOk.style} ${subject}` : lastStyleOk.style;
    return {
      mode,
      style: finalStyle,
      ...(isMinimax ? { prompt: finalStyle } : {}),
      title: safeTitle(input, mode),
      lyrics: markedLyrics,
      notes: safeNotesForModel(modelId, lastStyleOk.notes),
      source: 'model',
      fallbackReason: 'title_check_failed',
      profileVersion: profile.version,
      llmModel: config.model,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    };
  }

  return fallbackDesignForModel(modelId, input, 'check_failed');
}

/** A reviewed MiniMax Music 3.0 caption: up to `minimaxMusic3Sunra.capabilities.limits.style` (2,000), preserves line breaks, bare lyric tags. */
export function reviewedMinimaxDesign(
  input: MusicDesignInput,
  edited: { style: string; title?: string | null },
): MusicDesign | { problems: string[]; named: boolean } {
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const mode = musicWay({ vocal: input.vocal, lyrics, careful: false });
  const styleMax = minimaxMusic3Sunra.capabilities.limits.style;
  const titleMax = minimaxMusic3Sunra.capabilities.limits.title;
  const style = edited.style.replace(/\r\n?/g, '\n').trim();
  const title = (edited.title ?? '').trim() || musicTitle(input.prompt);
  const problems: string[] = [];
  if (!style) problems.push('the style is empty');
  if (style.length > styleMax) problems.push(`the style is over ${styleMax} characters`);
  if (mode === 'custom' && title.length > titleMax) problems.push(`the title is over ${titleMax} characters`);
  const named = Boolean(namedArtist(style) || namedArtist(title));
  if (named) problems.push('a real artist or song is named');
  if (problems.length) return { problems, named };
  return {
    mode,
    style,
    prompt: style,
    title,
    lyrics: lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '',
    notes: null,
    source: 'reviewed',
    profileVersion: musicProfileForModel('minimax-music-3').version,
    llmModel: null,
  };
}
