/**
 * The music Prompt Architect (docs/BRAND-SOUND-STUDIO.md §12.2, slice SA1; Sound Studio v2 Batch B3): reads what
 * the customer wrote and the choices in the dock, and designs what goes to the chosen music engine, the way the
 * image studio's Prompt Architect (lib/brand-studio/enhancer) designs for an image model.
 *
 *  - Closed v1 path (`designMusic`): unchanged — one English style paragraph (describe mode: the request; custom
 *    mode: `style`), a title in the lyrics' language for custom mode, and one sentence of notes in the customer's
 *    language, using `SUNO_PROFILE` (`suno@2026-11-21.2`).
 *  - v2 per-model path (`designMusicForModel`): looks up the profile in `../enhancer/profiles/music/` (`suno-v6`,
 *    `suno-v6-wild`, `minimax-music-3`), validates with `checkMusicDesignForModel`, retries at most once with the
 *    broken rules listed, and falls back deterministically via `fallbackDesignForModel`.
 *  - Same Gemini call configuration across both paths:
 *    - model env: `studioGeminiConfig(deps.env)` (`../enhancer/gemini.ts:24-31`, default `GEMINI_DIRECTOR_DEFAULT_MODEL`
 *      = `'gemini-4-hydrogen'` in `@/lib/template-director/schema:6`, overridden by `BRAND_STUDIO_ENHANCER_MODEL`);
 *    - timeout: `DESIGN_TIMEOUT_MS = 25_000` (`25,000` ms);
 *    - thinking level: `thinking: 'LOW'` (`../enhancer/gemini.ts:55,70`).
 *  - The customer's own lyrics are never rewritten here and never sent to the text model: only section marks are
 *    added (`./lyrics.ts` on Suno; `markMinimaxLyrics` on MiniMax).
 *
 * Server-only for the model call; the checks and fallbacks are pure and client/CLI-safe.
 */
import { z } from 'zod';
import { promptGuardMode } from '@/lib/flags';
import { callGeminiJson, studioGeminiConfig } from '../enhancer/gemini';
import { MINIMAX_OPEN_WEIGHTS_TAGS, musicProfileForModel } from '../enhancer/profiles/music';
import { SUNO_HEADER, SUNO_PROFILE } from '../enhancer/profiles/suno';
import type { MusicModelId } from './engine';
import { minimaxMusic3Sunra } from './engines/minimax-sunra';
import { formSentence, opensOnIntro, type RunPlanRecord } from './length-plan';
import { markLyrics, musicStyle, musicWay, ownLyrics, SUPERLATIVE, type LyricStructure, type MusicWay } from './lyrics';
import { describeSentence, musicTitle } from './music-text';
import { namedArtist } from './names';
import { parseRequestedSeconds } from './requested-seconds';
import { videoDesignLine, type MusicVideoFit } from './video-fit';

export const MUSIC_PROFILE_VERSION = `${SUNO_HEADER.id}@${SUNO_HEADER.version}`;
/** The Suno engine's style field holds 1,000 characters; the paragraph aims for 900 (§12.2). */
export const DESIGN_LIMITS = { styleMax: 900, styleHardMax: 1000, titleMax: 40, notesMax: 200 } as const;
/** MiniMax `TextToMusicInput.prompt` holds 2,000 characters (`oapi-minimax_minimax-music3.json:367`); minimum 200, aim < 1,800. */
export const MINIMAX_DESIGN_LIMITS = {
  captionMin: 200,
  captionAimMax: 1800,
  captionHardMax: 2000,
  titleMax: 40,
  titleHardMax: 80,
  lyricsHardMax: 3500,
} as const;
export const DESIGN_TIMEOUT_MS = 25_000;

/**
 * Typed slot for reference readings (`+ 오디오`, `+ 보이스`, `+ 인스포`) populated in B5 and accepted/folded in by B3.
 */
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
  /** Sound Studio v2: resolved target length in seconds (Suno ordering/plan; MiniMax `duration` 1..75). */
  targetSeconds?: number | null;
  /** Sound Studio v2 (`minimax-music-3`): resolved engine `duration` (`1..75`). */
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
  /** Suno: style / describe paragraph (<=1,000). MiniMax: identical to `prompt` (Structured Caption, <=2,000). */
  style: string;
  /** Present on v2 `minimax-music-3` designs: the exact `TextToMusicInput.prompt` Structured Caption (<=2,000). */
  prompt?: string;
  /** Suno custom mode sends `title` (<=80); MiniMax keeps `title` for the studio track list only. */
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

/** What a music job keeps as `work.enhancer` (the image Architect's place; `profile: 'suno'` discriminates music in `repo.ts`). */
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
  /** Optional resolved MiniMax `duration` recorded on enhancer metadata. */
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
    ...(design.durationSeconds !== undefined ? { durationSeconds: design.durationSeconds } : {}),
  };
}

/** Open-weights MiniMax Music 3.0 section tag allow-list (bare `[Tag]` on its own line; no inline directions). */
export const MINIMAX_BARE_TAGS = MINIMAX_OPEN_WEIGHTS_TAGS;

const MINIMAX_BARE_TAG_SET: ReadonlySet<string> = new Set<string>(MINIMAX_BARE_TAGS);

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
 * Sung with no lyrics, the Suno engine writes them from the description alone (describe mode). The designed paragraph
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

/* --------------------------------------------------- Reference readings normalization */

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

/* --------------------------------------------------- Deterministic fallbacks (no model call) */

/** The deterministic v1 Suno design: exactly what the studio sent before the Architect (§12.2 "대체 결과"). */
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

function resolveMinimaxDurationSeconds(input: MusicDesignInput): number {
  const range = minimaxMusic3Sunra.capabilities.lengthInput || { min: 1, max: 75 };
  const clamp = (n: number) => Math.min(range.max, Math.max(range.min, Math.round(n)));
  if (typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)) {
    return clamp(input.durationSeconds);
  }
  if (typeof input.targetSeconds === 'number' && Number.isFinite(input.targetSeconds)) {
    return clamp(input.targetSeconds);
  }
  if (input.video) {
    return clamp(input.video.seconds);
  }
  const fromSentence = parseRequestedSeconds(input.prompt);
  return fromSentence !== null ? clamp(fromSentence) : 60;
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
    const style = readingClause
      ? `${base.style.slice(0, Math.max(1, DESIGN_LIMITS.styleHardMax - readingClause.length - 1)).trim()} ${readingClause}`.slice(
          0,
          DESIGN_LIMITS.styleHardMax,
        )
      : base.style;
    return {
      ...base,
      style,
      profileVersion: profile.version,
    };
  }

  // MiniMax Music 3.0: safe generic English frame under the three headings + customer's own words quoted.
  const styleMax = MINIMAX_DESIGN_LIMITS.captionHardMax;
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const mode = musicWay({ vocal: input.vocal, lyrics, careful: false });
  const durationSeconds = resolveMinimaxDurationSeconds(input);
  const sungKorean = lyrics ? /[가-힣]/.test(lyrics) : input.language === 'ko';

  const audioTrait = readings?.audio ? ` Reference audio character: ${readings.audio.replace(/[.]+$/, '')}.` : '';
  const inspoTrait = readings?.inspo?.length
    ? ` Reference style direction: ${readings.inspo.map((s) => s.replace(/[.]+$/, '')).join('; ')}.`
    : '';
  const voiceTrait = readings?.voice ? ` Reference vocal character: ${readings.voice.replace(/[.]+$/, '')}.` : '';
  const words = sungWithoutLyrics(input) ? ` ${wordsLine(wordsOf(input))}` : '';

  const vocalDetails = input.vocal
    ? `Vocal Details: Lead vocal singing in ${sungKorean ? 'Korean' : 'English'} with clear, natural studio placement and balanced diction.${voiceTrait}${words}`
    : 'Vocal Details: Instrumental; a clear lead melodic instrument carries the central theme with no vocals.';
  const arrangement =
    'Arrangement: Opening establishes the core groove cleanly, the main section develops the primary musical theme with steady momentum, and the ending resolves neatly.';

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
    lyrics: input.customerLyrics && lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '',
    notes: null,
    source: 'fallback',
    ...(reason ? { fallbackReason: reason } : {}),
    profileVersion: profile.version,
    llmModel: null,
    durationSeconds,
  };
}

/* --------------------------------------------------- Code checks per model (Deliverable 3) */

const INTERNAL_TERMS = /\b(suno|sunra|max[_ ]mode|inspire-mode|custom-mode|api|endpoint|prompt architect|json)\b/i;
const MINIMAX_INTERNAL_TERMS =
  /\b(suno|sunra|minimax|music-?3(?:\.0)?|max[_ ]mode|inspire-mode|custom-mode|text-to-music|num_inference_steps|guidance_scale|api|endpoint|prompt architect|json)\b/i;
const SECONDS = /\b\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b|\d+\s*(?:초|분)/i;

function hasMinimaxDurationWording(caption: string): boolean {
  // Strip decade references such as "late-80s", "1980s", "'80s", or "70s funk" (`PROMPTING-RESEARCH.md:88`) before checking seconds/minutes.
  const withoutDecades = caption
    .replace(/\b(?:early|mid|late)[-\s]?[1-9]0s\b/gi, ' ')
    .replace(/\b(?:19|20)\d0s\b/g, ' ')
    .replace(/['’][2-9]0s\b/g, ' ')
    .replace(/\b[5-9]0s\s+(?:soul|funk|rock|pop|disco|synth|synthpop|synthwave|jazz|motown|ballad|r&b|rnb|groove|era|style|retro|analog|analogue|drum|snare|production)\b/gi, ' ');
  return /\b\d+(?:\.\d+)?(?:\s*|-)(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b|\d+\s*(?:초|분)/i.test(withoutDecades);
}

/**
 * The model's one sentence for the screen, held to the same name and technical-word check as the style and title.
 * A hit (or nothing) gives null: the screen shows its own fixed sentence instead (review 1, item 6).
 */
export function safeNotes(notes: string | null | undefined): string | null {
  const text = (notes ?? '').replace(/\s+/g, ' ').trim().slice(0, DESIGN_LIMITS.notesMax);
  // The customer's claim ("국내 최고 브랜드의 위상") is not repeated back to them (real run, 2026-11-21).
  if (!text || namedArtist(text) || MINIMAX_INTERNAL_TERMS.test(text) || SUPERLATIVE.test(text) || /\b(?:best|greatest|finest)\b/i.test(text)) return null;
  return text;
}

const squash = (text: string) => text.replace(/[\s.,!?()\[\]'"·…-]+/g, '').toLowerCase();

/**
 * Suno v1 / v6 / v6 Wild style + title check (unchanged from today). Pure.
 */
export function checkMusicDesign(
  design: { style: string; title?: string },
  _mode: MusicWay,
  request?: string,
  styleMax: number = DESIGN_LIMITS.styleHardMax,
): string[] {
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

export type ProfileRuleSupport = 'official' | 'practitioner-consistent' | 'single-source' | 'our-measurement';

export interface MusicDesignCheckItem {
  id: string;
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

function supportCorpusOf(context: MusicDesignCheckContext, vocal: boolean): string {
  const r = context.readings;
  return [
    context.prompt ?? '',
    r?.audio ?? '',
    ...(vocal && r?.voice ? [r.voice] : []),
    ...(r?.inspo ?? []),
  ].join('\n');
}

function hasCaptionBpm(text: string): boolean {
  return /\b\d{2,3}\s*(?:bpm|beats\s+per\s+minute)\b|\bbpm\s*[:=]?\s*\d{2,3}\b/i.test(text);
}

function hasSupportedBpm(supportCorpus: string): boolean {
  const withoutLowConfidence = supportCorpus.replace(/\b\d{2,3}\s*bpm\s*\([^)]*\blow\b[^)]*\)/gi, ' ');
  return /\b\d{2,3}\s*(?:bpm|beats\s+per\s+minute)\b|\b(?:bpm|템포)\s*[:=]?\s*\d{2,3}\b/i.test(withoutLowConfidence);
}

function hasCaptionMusicalKey(text: string): boolean {
  if (/\b(?:[B-G](?:\s*(?:#|♯|b|♭|-?sharp|-?flat))?|A\s*(?:#|♯|b|♭|-?sharp|-?flat))\s*(?:major|minor)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:in(?:\s+the\s+key\s+of)?|key(?:\s+of|\s*:))\s*[A-G](?:\s*(?:#|♯|b|♭|-?sharp|-?flat))?(?:\s*(?:major|minor|maj|min|m))?\b/i.test(text)) {
    return true;
  }
  if (/\bA\s+(?:Major|Minor)\b/.test(text)) return true;
  // Mid-sentence capital "A major" / "A minor" (indefinite article mid-sentence is lowercase "a").
  if (/(?<![.!?]\s*|^|\n\s*:\s*|\n\s*)\bA\s+(?:major|minor)\b/.test(text)) return true;
  return false;
}

function hasSupportedMusicalKey(supportCorpus: string): boolean {
  if (hasCaptionMusicalKey(supportCorpus)) return true;
  return /(?:[A-G](?:#|♯|b|♭)?\s*(?:메이저|마이너|장조|단조)|(?:다|라|마|바|사|가|나)(?:올림|내림)?\s*(?:장조|단조))/i.test(
    supportCorpus,
  );
}

const CAPTION_FEMALE_GENDER =
  /\b(?:female|woman|women|girl|soprano|mezzo(?:-?soprano)?)\b|\balto\b(?!\s+(?:sax|saxophone|flute|horn|clarinet|recorder))|여성|여자|여\s*보컬|소녀/i;
const CAPTION_MALE_GENDER =
  /\b(?:male|man|men|boy)\b|\b(?:baritone|tenor)\b(?!\s+(?:sax|saxophone|guitar|ukulele|horn|trombone))|남성|남자|남\s*보컬|소년/i;

const SUPPORT_FEMALE_GENDER =
  /\b(?:female|woman|women|girl|soprano|mezzo(?:-?soprano)?)\b|\balto\b(?!\s+(?:sax|saxophone|flute|horn|clarinet|recorder))|여성|여자|여\s*보컬|여자\s*목소리|여성\s*목소리|걸그룹|소녀/i;
const SUPPORT_MALE_GENDER =
  /\b(?:male|man|men|boy)\b|\b(?:baritone|tenor)\b(?!\s+(?:sax|saxophone|guitar|ukulele|horn|trombone))|\bbass\s+vocal\b|남성|남자|남\s*보컬|남자\s*목소리|남성\s*목소리|보이그룹|소년/i;

const INSTRUMENTAL_SINGER_WORDS =
  /\b(?:singer|vocalist|sings|singing|sung|lead\s+vocal|backing\s+vocals?|harmonies|falsetto|rapper|rapping|crooner|choir)\b/i;

const MELODIC_INSTRUMENT_WORDS =
  /\b(?:piano|rhodes|keys|keyboard|organ|guitar|synth|synthesizer|pad|lead|pluck|arp|arpeggio|strings|violin|viola|cello|bass|upright|flute|clarinet|oboe|sax|saxophone|trumpet|horn|brass|woodwind|harp|marimba|vibraphone|kalimba|celesta|mallet|bell|bells|chime|accordion|harmonica|mandolin|banjo|ukulele|koto|gayageum|instrument)\b/i;

/**
 * Validates MiniMax Music 3.0 lyrics (`PROMPTING-RESEARCH.md:29-34,165`, Deliverable 1 & Deliverable 3):
 *  - `1..3500` characters, non-blank, no artist names;
 *  - every bracket tag line stands alone on its own line (`[Tag]`) with nothing else on that line;
 *  - tag names come strictly from the 9-tag open-weights allow-list (`MINIMAX_BARE_TAGS`).
 */
export function checkMinimaxLyrics(lyrics: string): string[] {
  const problems: string[] = [];
  const normalized = lyrics.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) {
    problems.push('lyrics are empty for a vocal MiniMax track');
    return problems;
  }
  if (normalized.length > MINIMAX_DESIGN_LIMITS.lyricsHardMax) {
    problems.push(`lyrics are over ${MINIMAX_DESIGN_LIMITS.lyricsHardMax} characters`);
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

/**
 * Detailed per-rule inspection of a music design for `modelId` (`suno-v6`, `suno-v6-wild`, `minimax-music-3`).
 * Every check item is tied to its rule and support level in `PROMPTING-RESEARCH.md`.
 */
export function inspectMusicDesignForModel(
  modelId: MusicModelId,
  design: { style?: string; prompt?: string; title?: string; lyrics?: string },
  context: MusicDesignCheckContext = {},
): MusicDesignCheckItem[] {
  const vocal = context.vocal ?? false;

  if (modelId === 'suno-v6' || modelId === 'suno-v6-wild') {
    // Suno v6 / Wild: today's checks unchanged (`PROMPTING-RESEARCH.md` §2–§3, Deliverable 3).
    const style = (design.style ?? design.prompt ?? '').trim();
    const styleMax = context.styleMax ?? DESIGN_LIMITS.styleHardMax;
    const planIssues = planProblems(style, {
      plan: context.plan ?? null,
      vocal,
      lyrics: context.lyrics ?? design.lyrics ?? '',
    });
    const titleIssues = checkMusicTitle(design.title ?? '', context.prompt);

    const items: MusicDesignCheckItem[] = [
      // [our-measurement] length-plan.ts tempo & intro consistency (`PROMPTING-RESEARCH.md:68`)
      {
        id: 'suno_length_plan',
        rule: 'Planned BPM (within 3 BPM) and intro form match `length-plan.ts`',
        support: 'our-measurement',
        passed: planIssues.length === 0,
        ...(planIssues.length ? { problem: planIssues.join('; ') } : {}),
      },
      // [practitioner-consistent] + [official] single paragraph 40..styleMax (`PROMPTING-RESEARCH.md:57,81`)
      {
        id: 'suno_length_min',
        rule: 'Style paragraph is at least 40 characters',
        support: 'practitioner-consistent',
        passed: style.length >= 40,
        ...(style.length < 40 ? { problem: 'the style paragraph is too short' } : {}),
      },
      {
        id: 'suno_length_max',
        rule: `Style paragraph fits within ${styleMax} characters`,
        support: 'official',
        passed: style.length <= styleMax,
        ...(style.length > styleMax ? { problem: `the style is over ${styleMax} characters` } : {}),
      },
      {
        id: 'suno_single_paragraph',
        rule: 'Style is a single paragraph without line breaks',
        support: 'practitioner-consistent',
        passed: !/\n/.test(style),
        ...(/\n/.test(style) ? { problem: 'the style must be one paragraph without line breaks' } : {}),
      },
      // [official] no internal / engine / API terms (`suno.ts`)
      {
        id: 'suno_no_internal_terms',
        rule: 'No service, engine, or API terms in style',
        support: 'official',
        passed: !INTERNAL_TERMS.test(style),
        ...(INTERNAL_TERMS.test(style) ? { problem: 'the style names the service or a technical term' } : {}),
      },
      // [official] no artist or song names (`PROMPTING-RESEARCH.md:47,84`, Suno blog)
      {
        id: 'suno_no_artist_names',
        rule: 'No real artist, band, or song names in style',
        support: 'official',
        passed: !namedArtist(style),
        ...(namedArtist(style) ? { problem: 'the style names a real artist or song' } : {}),
      },
      // [official] no written length in seconds or minutes (`PROMPTING-RESEARCH.md:53`, Suno ad library)
      {
        id: 'suno_no_seconds',
        rule: 'No duration in seconds or minutes inside style',
        support: 'official',
        passed: !SECONDS.test(style),
        ...(SECONDS.test(style) ? { problem: 'the style gives a length in seconds or minutes' } : {}),
      },
      // [our-measurement] instrumental requests send empty lyrics (`PROMPTING-RESEARCH.md:67`)
      {
        id: 'suno_instrumental_lyrics',
        rule: 'Instrumental tracks carry empty lyrics',
        support: 'our-measurement',
        passed: vocal || !(design.lyrics ?? '').trim(),
        ...(!vocal && (design.lyrics ?? '').trim() ? { problem: 'lyrics must be empty when instrumental is true' } : {}),
      },
      // [official] track title rules (`suno.ts:76`)
      {
        id: 'suno_title',
        rule: 'Title is 1..40 characters with no artist name, superlative, or copied request prefix',
        support: 'official',
        passed: titleIssues.length === 0,
        ...(titleIssues.length ? { problem: titleIssues.join('; ') } : {}),
      },
    ];
    return items;
  }

  // MiniMax Music 3.0 (`PROMPTING-RESEARCH.md` §1, Deliverable 3):
  const caption = (design.prompt ?? design.style ?? '').replace(/\r\n?/g, '\n').trim();
  const styleMax = context.styleMax ?? MINIMAX_DESIGN_LIMITS.captionHardMax;
  const sections = parseMinimaxCaptionSections(caption);
  const supportCorpus = supportCorpusOf(context, vocal);
  const englishIssue = checkMinimaxEnglishOnly(caption, context);
  const titleIssues = checkMusicTitle(design.title ?? '', context.prompt);

  // Rule M1 [official]: Three headings `Global Metadata:`, `Vocal Details:`, `Arrangement:` present and in order (`PROMPTING-RESEARCH.md:24`).
  const headingsOk = sections !== null;

  // Rule M2 [official]: Caption length 200..2000 (`PROMPTING-RESEARCH.md:36`, Sunra OpenAPI `maxLength: 2000`).
  const lengthProblem =
    caption.length < MINIMAX_DESIGN_LIMITS.captionMin
      ? `the caption is under ${MINIMAX_DESIGN_LIMITS.captionMin} characters`
      : caption.length > styleMax
        ? `the caption is over ${styleMax} characters`
        : null;

  // Rule M4 [official]: No artist or song names (`PROMPTING-RESEARCH.md:47,84`, Sunra `copyright` moderation).
  const artistHit = namedArtist(caption);

  // Rule M5 [official]: No internal engine / API terms.
  const internalHit = MINIMAX_INTERNAL_TERMS.test(caption);

  // Rule M6 [official]: No 'N seconds / minutes' wording inside caption; length goes in `duration` (`PROMPTING-RESEARCH.md:41`).
  const durationHit = hasMinimaxDurationWording(caption);

  // Rule M7a [official]: BPM present ONLY if supported by customer's text or a reading (`PROMPTING-RESEARCH.md:26,90`).
  const bpmInvented = hasCaptionBpm(caption) && !hasSupportedBpm(supportCorpus);

  // Rule M7b [official]: Musical key present ONLY if supported by customer's text or a reading (`PROMPTING-RESEARCH.md:26,90`).
  const keyInvented = hasCaptionMusicalKey(caption) && !hasSupportedMusicalKey(supportCorpus);

  // Rule M7c [official]: Vocal gender (English + Korean 남성/여성/남자/여자/여보컬/남보컬/male/female) ONLY if supported (`PROMPTING-RESEARCH.md:26`, `CONTRACT-v2-REVIEW.md` §3.5).
  const captionHasFemale = CAPTION_FEMALE_GENDER.test(caption);
  const captionHasMale = CAPTION_MALE_GENDER.test(caption);
  const femaleSupported = vocal && SUPPORT_FEMALE_GENDER.test(supportCorpus);
  const maleSupported = vocal && SUPPORT_MALE_GENDER.test(supportCorpus);
  const genderInvented = (captionHasFemale && !femaleSupported) || (captionHasMale && !maleSupported);

  // Rule M8 [official] + [single-source]: Instrumental vs Vocal (`PROMPTING-RESEARCH.md:27,35,39`).
  const vocalProblems: string[] = [];
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
        vocalProblems.push('Vocal Details must not describe a singer or singing on an instrumental track');
      }
      if (!MELODIC_INSTRUMENT_WORDS.test(sections.vocalDetails)) {
        vocalProblems.push('Vocal Details must name the lead melodic instrument on an instrumental track');
      }
    }
    if ((design.lyrics ?? '').trim()) {
      vocalProblems.push('instrumental MiniMax tracks must not include lyrics');
    }
  } else {
    const isKoreanVocal = lyricsText.trim() ? /[가-힣]/.test(lyricsText) : (context.language ?? 'ko') === 'ko';
    if (isKoreanVocal && !/\bin\s+Korean\b/i.test(caption)) {
      vocalProblems.push('Vocal Details must state "in Korean" when the vocals are sung in Korean');
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

  // Rule M9 [official]: Bare lyric tags from the 9-tag open-weights allow-list, <= 3,500 chars (`PROMPTING-RESEARCH.md:29-32,165`).
  const checkLyricsNow = vocal && !context.customerLyrics && design.lyrics !== undefined;
  const lyricsProblems = checkLyricsNow ? checkMinimaxLyrics(design.lyrics ?? '') : [];

  return [
    {
      id: 'minimax_headings_in_order',
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
      rule: `Caption length is between ${MINIMAX_DESIGN_LIMITS.captionMin} and ${styleMax} characters`,
      support: 'official',
      passed: lengthProblem === null,
      ...(lengthProblem ? { problem: lengthProblem } : {}),
    },
    {
      id: 'minimax_english_only',
      rule: 'Caption is written in English (Hangul allowed only inside quotes for a customer-given brand or product name)',
      support: 'official',
      passed: englishIssue === null,
      ...(englishIssue ? { problem: englishIssue } : {}),
    },
    {
      id: 'minimax_no_artist_names',
      rule: 'No real artist, band, or song names in caption',
      support: 'official',
      passed: !artistHit,
      ...(artistHit ? { problem: 'the caption names a real artist or song' } : {}),
    },
    {
      id: 'minimax_no_internal_terms',
      rule: 'No internal service, engine, or API terms in caption',
      support: 'official',
      passed: !internalHit,
      ...(internalHit ? { problem: 'the caption names the service or a technical term' } : {}),
    },
    {
      id: 'minimax_no_duration_wording',
      rule: 'No duration in seconds or minutes inside caption (length goes in duration)',
      support: 'official',
      passed: !durationHit,
      ...(durationHit ? { problem: 'the caption gives a length in seconds or minutes (length goes in duration, not the caption)' } : {}),
    },
    {
      id: 'minimax_no_invented_bpm',
      rule: 'Numeric BPM appears only when supported by customer text or reading',
      support: 'official',
      passed: !bpmInvented,
      ...(bpmInvented ? { problem: 'do not invent a numeric BPM unless the request or reading states it' } : {}),
    },
    {
      id: 'minimax_no_invented_key',
      rule: 'Musical key appears only when supported by customer text or reading',
      support: 'official',
      passed: !keyInvented,
      ...(keyInvented ? { problem: 'do not invent a musical key unless the request or reading states it' } : {}),
    },
    {
      id: 'minimax_no_invented_gender',
      rule: 'Vocal gender (male/female, 남성/여성/남자/여자) appears only when supported by customer text or reading',
      support: 'official',
      passed: !genderInvented,
      ...(genderInvented
        ? { problem: 'do not invent vocal gender (male/female) unless the customer request or reading states it' }
        : {}),
    },
    {
      id: 'minimax_vocal_or_instrumental_details',
      rule: 'Instrumental states Instrumental + lead instrument with no singer/lyrics; Korean vocal states "in Korean" and never quotes lyrics',
      support: 'official',
      passed: vocalProblems.length === 0,
      ...(vocalProblems.length ? { problem: vocalProblems.join('; ') } : {}),
    },
    {
      id: 'minimax_lyrics_bare_tags',
      rule: 'Lyrics <= 3,500 chars with bare tag lines strictly from the 9-tag open-weights set',
      support: 'official',
      passed: lyricsProblems.length === 0,
      ...(lyricsProblems.length ? { problem: lyricsProblems.join('; ') } : {}),
    },
    {
      id: 'minimax_title',
      rule: 'Title is 1..40 characters with no artist name, superlative, or copied request prefix',
      support: 'official',
      passed: titleIssues.length === 0,
      ...(titleIssues.length ? { problem: titleIssues.join('; ') } : {}),
    },
  ];
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
  if (modelId === 'suno-v6' || modelId === 'suno-v6-wild') {
    const style = (design.style ?? design.prompt ?? '').trim();
    const vocal = context.vocal ?? false;
    const lyrics = context.lyrics ?? design.lyrics ?? '';
    const mode = musicWay({ vocal, lyrics, careful: false });
    const problems = [
      ...planProblems(style, { plan: context.plan ?? null, vocal, lyrics }),
      ...checkMusicDesign({ style, title: design.title }, mode, context.prompt, context.styleMax ?? DESIGN_LIMITS.styleHardMax),
    ];
    if (!vocal && (design.lyrics ?? '').trim()) {
      problems.push('lyrics must be empty when instrumental is true');
    }
    return problems;
  }

  return inspectMusicDesignForModel(modelId, design, context)
    .filter((item) => !item.passed && item.problem)
    .map((item) => item.problem!);
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

function taskBlock(input: MusicDesignInput, mode: MusicWay, styleMax: number, readings: NormalizedReadings | null = null): string {
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
    ...(readings
      ? [
          'Reference readings are given in `readings` (priority: customer request > audio/voice reading > inspo). Fold their musical traits into the paragraph without naming any artist or technical source.',
        ]
      : []),
    `Notes language: ${input.locale === 'ko' ? 'Korean (해요체, one sentence)' : 'English (one sentence)'}.`,
    ...(input.video ? [videoDesignLine(input.video)] : []),
    ...(input.avoid
      ? [
          "The music engine refused a request made from these words. Leave out anything that could read as a real artist, a song, an album, a brand other than the customer's, or explicit content; describe genre, tempo, instruments, voice and mood only.",
        ]
      : []),
  ];
  return `This run:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function extractLyricTagsInOrder(lyrics: string): string[] {
  const tags: string[] = [];
  for (const line of lyrics.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*\[([^\[\]\n]{1,40})\]\s*$/.exec(line);
    if (m) tags.push(`[${m[1]!.trim()}]`);
  }
  return tags;
}

function minimaxTaskBlock(input: MusicDesignInput, readings: NormalizedReadings | null): string {
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const markedLyrics = lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '';
  const tags = markedLyrics ? extractLyricTagsInOrder(markedLyrics) : [];
  const sungKorean = lyrics ? /[가-힣]/.test(lyrics) : input.language === 'ko';
  const supportCorpus = supportCorpusOf({ prompt: input.prompt, readings: input.readings }, input.vocal);
  const bpmAllowed = hasSupportedBpm(supportCorpus);
  const keyAllowed = hasSupportedMusicalKey(supportCorpus);
  const femaleAllowed = input.vocal && SUPPORT_FEMALE_GENDER.test(supportCorpus);
  const maleAllowed = input.vocal && SUPPORT_MALE_GENDER.test(supportCorpus);
  const words = wordsOf(input);

  const lines = [
    'Output `style` with the exact three headings `Global Metadata:`, `Vocal Details:`, and `Arrangement:` on separate lines in that order (450 to 1,750 characters, never under 200 or over 2,000, English only, never write duration in seconds or minutes).',
    input.vocal
      ? `Vocals are ON (${sungKorean ? 'sung in Korean — include the exact phrase "in Korean" in Vocal Details' : 'sung in English — include "in English" in Vocal Details'}). Never quote or paraphrase lyrics in the caption.`
      : 'Instrumental run (vocals are OFF): start Vocal Details with "Instrumental;" and name the lead melodic instrument; never mention a singer, vocalist, singing, or harmonies.',
    tags.length > 0
      ? `The sung lyrics use these section tags in order: ${tags.join(' -> ')}. Walk through matching sections in Arrangement: with concrete musical changes.`
      : input.vocal
        ? 'Walk through Intro, Verse, Chorus, and Outro in Arrangement: with concrete instrument entries, changes, and ending.'
        : 'Walk through Opening, Middle, and Ending in Arrangement: with concrete instrument entries, texture shifts, and ending.',
    bpmAllowed
      ? 'A BPM is supported by the request or reading: you may include that approximate BPM.'
      : 'NO BPM was given in the request or readings: do NOT write any BPM number anywhere in `style`; use tempo feel words only.',
    keyAllowed
      ? 'A musical key is supported by the request or reading: you may include it.'
      : 'NO musical key was given: do NOT write any musical key (such as C major or A minor) anywhere in `style`.',
    !input.vocal
      ? 'NO vocal gender words ("male", "female", "man", "woman") anywhere in `style`.'
      : femaleAllowed && !maleAllowed
        ? 'Female vocal gender is supported by the request or reading ("female" allowed; never write "male").'
        : maleAllowed && !femaleAllowed
          ? 'Male vocal gender is supported by the request or reading ("male" allowed; never write "female").'
          : femaleAllowed && maleAllowed
            ? 'Mixed or male/female vocal gender is supported by the request or reading.'
            : 'NO vocal gender was given in the request or readings: do NOT write "male", "female", "man", "woman", "boy", or "girl" anywhere in `style`; describe vocal timbre, register, and delivery without gender.',
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

function payloadOf(input: MusicDesignInput, readings: NormalizedReadings | null = null) {
  return {
    request: input.prompt.trim(),
    customerLanguage: input.locale,
    vocals: input.vocal,
    lyricsGiven: Boolean(input.lyrics.trim()),
    ...(input.lyrics.trim() ? { lyricsLanguageHint: /[가-힣]/.test(input.lyrics) ? 'Korean' : 'English' } : {}),
    ...(readings ? { readings } : {}),
    brand: input.brand
      ? { nameForContextOnly: input.brand.name ?? null, tone: input.brand.tone ?? null, rules: [...(input.brand.rules ?? [])].slice(0, 12) }
      : null,
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
  return `${profile.system}\n\n${taskBlock(input, mode, styleMax, readings)}`;
}

/** Exact system instruction string built on today's closed v1 `designMusic` path. */
export function buildClosedSunoSystemText(input: MusicDesignInput): string {
  const mode = wayOf(input);
  const subject = subjectSentence(input);
  const styleMax = subject ? DESIGN_LIMITS.styleHardMax - subject.length - 1 : DESIGN_LIMITS.styleHardMax;
  return `${SUNO_PROFILE}\n\n${taskBlock(input, mode, styleMax, null)}`;
}

export interface DesignDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

/** Closed v1 path: designs for Suno v6 (`suno@2026-11-21.2`). Untouched behaviour and byte-identical requests. */
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
    const text =
      attempt === 0
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

/**
 * Sound Studio v2 per-model design operation (`designMusicForModel`, Deliverables 2–4):
 *  - Selects `musicProfileForModel(modelId)` (`suno-v6`, `suno-v6-wild`, `minimax-music-3`);
 *  - Uses the exact same Gemini configuration as `designMusic` (`studioGeminiConfig`, `thinking: 'LOW'`, `DESIGN_TIMEOUT_MS = 25_000`);
 *  - Never rewrites or sends customer lyrics to the text model;
 *  - Folds `input.readings` when present and omits it completely when absent;
 *  - Runs `checkMusicDesignForModel`, retries at most once with the broken rules listed, and falls back to `fallbackDesignForModel`.
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
    ? MINIMAX_DESIGN_LIMITS.captionHardMax
    : subject
      ? DESIGN_LIMITS.styleHardMax - subject.length - 1
      : DESIGN_LIMITS.styleHardMax;

  const internalSystem = buildMusicSystemText(modelId, input);
  const payload = payloadOf(input, readings);
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
  const durationSeconds = isMinimax ? resolveMinimaxDurationSeconds(input) : undefined;
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

    problems = checkMusicDesignForModel(
      modelId,
      {
        style: normalizedStyle,
        ...(isMinimax ? { prompt: normalizedStyle } : {}),
        title: trimmedTitle,
        lyrics: markedLyrics,
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
      },
    );

    if (problems.length === 0) {
      const finalStyle = subject ? `${normalizedStyle} ${subject}` : normalizedStyle;
      return {
        mode,
        style: finalStyle,
        ...(isMinimax ? { prompt: finalStyle } : {}),
        title: trimmedTitle,
        lyrics: markedLyrics,
        notes: safeNotes(answer.notes),
        source: 'model',
        profileVersion: profile.version,
        llmModel: config.model,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    }

    const titleOnly = problems.length === checkMusicTitle(trimmedTitle, input.prompt).length;
    lastStyleOk = titleOnly ? { style: normalizedStyle, notes: answer.notes } : null;
    deps.log?.('studio_music_design_rejected', {
      model: modelId,
      attempt,
      problems: problems.join('; ').slice(0, 300),
    });
  }

  if (lastStyleOk) {
    const finalStyle = subject ? `${lastStyleOk.style} ${subject}` : lastStyleOk.style;
    return {
      mode,
      style: finalStyle,
      ...(isMinimax ? { prompt: finalStyle } : {}),
      title: safeTitle(input, mode),
      lyrics: markedLyrics,
      notes: safeNotes(lastStyleOk.notes),
      source: 'model',
      fallbackReason: 'title_check_failed',
      profileVersion: profile.version,
      llmModel: config.model,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    };
  }

  return fallbackDesignForModel(modelId, input, 'check_failed');
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
