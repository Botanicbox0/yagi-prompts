/**
 * `lyrics.draft` (docs/BRAND-SOUND-STUDIO.md §4.2, §7.5, §12.3): the two lyric flows a text model writes.
 *
 *  - `topic` ("가사 초안 만들기"): new lyrics from the description and the options.
 *  - `polish` ("부르기 좋게 손보기"): the customer's lyrics with the meaning kept, lines evened out and words made
 *    easier to sing. The screen shows it next to the original; nothing changes unless the customer accepts it.
 *
 * Both take the options of §12.3: length (15/30/60 s or a video's length, sized by syllables), structure, tone
 * (해요체 or 반말), the brand name and its Korean reading, words to include, language (Korean, English, or mixed:
 * Korean with English only in the hook and ad-libs). The answer is checked without a model (./lyrics.ts
 * `checkLyrics`): a broken hard rule or a soft one gets one rewrite with the problems listed; a hard rule still
 * broken is a failure, a soft one is accepted. A draft that names a singer or a song is never handed over.
 *
 * The model is one server setting (./lyrics-model.ts, `BRAND_SOUND_LYRICS_MODEL`, checked against the five models
 * of the blind comparison) and the answer names it, so the music run can record who wrote its lyrics.
 *
 * Time (real run of 2026-11-21: the default model's calls took 7.9 s at the median, 19 s at most, and one went past
 * the old 25 s limit, which left the customer with an error): each call gets `LYRICS_TIMEOUTS.firstCallMs`, and a
 * first model that times out or cannot be reached hands the request once to the fast model
 * (`LYRICS_FALLBACK_MODEL`). The answer names the model that actually wrote the lyrics.
 *
 * No credits; a per-organization limit per minute instead, and only while this month's allowance is open.
 * Local mode (`BRAND_STUDIO_PROVIDER=fake`) answers with fixed text: no network, no model.
 */
import type { Viewer } from '@/lib/auth/identity';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { requireCreate, StudioDenied, studioSeat } from '../access';
import { LyricsDraftSchema, type StudioFailure, type StudioLyricsDraft } from '../contracts';
import { callGeminiJson, type GeminiConfig } from '../enhancer/gemini';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import type { StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import {
  checkLyrics,
  defaultStructure,
  LYRICS_LIMITS,
  ownLyrics,
  structureMarks,
  tempoOf,
  type LyricCheckInput,
  type LyricStructure,
} from './lyrics';
import { bandOf, cleanBpm, draftStanzaLines, DRAFT_STANZAS, LINE_SYLLABLES, runTempo, TEMPO_BANDS, type TempoBand } from './length-plan';
import { isLyricsModel, lyricsGeminiConfig, type LyricsModel } from './lyrics-model';
import { namedArtist } from './names';
import { videoFitOf, videoTargetSeconds } from './video-fit';

export type LyricsFlow = 'topic' | 'polish';

export interface LyricsRequest {
  flow: LyricsFlow;
  topic: string;
  /** `polish`: the customer's lyrics. */
  lyrics?: string;
  language: 'ko' | 'en' | 'mixed';
  seconds: number | null;
  /**
   * A tempo the request fixes (a BPM written in the description). Null: the model picks the tempo band that fits
   * and answers its BPM; the lines asked follow that band's plan (./length-plan.ts, §12.11).
   */
  bpm?: number | null;
  structure: LyricStructure;
  tone: 'haeyo' | 'banmal' | null;
  brand: { name: string; readAs?: string | null } | null;
  mustInclude: string[];
}

/**
 * How many stanzas a draft has in each structure (marks from `structureMarks`, the last of two or more `[Outro]`).
 * The hook alone is one stanza: the length plan sings it again with an intro and a break around it (§12.11).
 */
export const STANZAS: Readonly<Record<LyricStructure, number>> = DRAFT_STANZAS;

const ROLE: Readonly<Record<string, string>> = {
  '[Chorus]': 'hook: one short sentence that survives repetition; the brand name goes here',
  '[Verse]': 'verse: who, where, doing what; concrete, no emotion labels',
  '[Verse 1]': 'first verse: who, where, doing what; concrete, no emotion labels',
  '[Verse 2]': 'second verse: moves the scene forward',
  '[Outro]': 'closing: one or two lines that land the ending (the hook line again, shortened, is fine)',
};

export const LYRICS_SYSTEM = [
  'You write lyrics for brand advertising music (15 to 60 second ads and social videos). They will be sung by an AI',
  'music model. Write new, original lyrics only: never quote or paraphrase an existing song, never name a real singer,',
  'band, song, album or a brand other than the one the request names. No superlatives or claims (최고, 최초, 유일,',
  '1위, "best", "No.1"), no health or efficacy claims, no promised results.',
  'Rules for sung Korean (and for English where they apply):',
  '1. Paired lines have the same number of syllables.',
  '2. Put the key word where the note is held; if a line is long, drop modifiers first.',
  '3. Held notes and line ends take open syllables (no final consonant) or finals that flow on (ㄴ ㄹ ㅁ ㅇ), not ㄱ ㄷ ㅂ.',
  '4. Do not stack final consonants on fast syllables.',
  '5. The hook is one short sentence that survives repetition.',
  '6. English belongs in the hook and ad-libs; Korean next to English uses open syllables.',
  '7. No line that only names an emotion: show who is where doing what.',
  '8. One register for the whole song. No translationese, no ad-copy noun lists.',
  'The brand name: exactly as given (its Korean reading when one is given), in the hook, three times or fewer in the',
  'whole song. Every word the request says to include appears as written.',
  'Length is counted in lines: write exactly the number of lines asked for each stanza, each line a short singable',
  'phrase of the syllables asked. The music is planned at the tempo you answer in "bpm".',
  'Answer the tempo and the stanzas only, in the order asked: no section labels, no title, no notes, no brackets.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: { bpm: { type: 'number' }, stanzas: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
  required: ['bpm', 'stanzas'],
} as const;

export const LYRICS_SCHEMA = SCHEMA;

const BAND_LABEL: Readonly<Record<TempoBand, string>> = { fast: '110 BPM and above', mid: '90 to 109 BPM', slow: 'below 90 BPM' };

/** The lines each stanza needs at a tempo (a topic draft with a length; null otherwise). */
export function askedLines(req: LyricsRequest, bpm: number): number[] | null {
  return req.flow === 'topic' && req.seconds ? draftStanzaLines(req.structure, req.seconds, bpm) : null;
}

/** The tempo a draft is planned at: the request's, else the one the model answered, else the mid band. */
export function draftBpm(req: LyricsRequest, answered: unknown): number {
  return cleanBpm(req.bpm) ?? cleanBpm(answered) ?? TEMPO_BANDS.mid.bpm;
}

/** What the model is asked, as one JSON block (no customer text outside it). */
export function lyricsTask(req: LyricsRequest, problems: readonly string[] = []): string {
  const marks = structureMarks(req.structure, STANZAS[req.structure]);
  const line = LINE_SYLLABLES[req.language === 'en' ? 'en' : 'ko'];
  const fixed = cleanBpm(req.bpm);
  const stanzasFor = (bpm: number) => {
    const lines = askedLines(req, bpm);
    // A long hook gets a 2-line outro as a second stanza (§12.11), so the marks follow the lines asked.
    const named = lines ? structureMarks(req.structure, lines.length) : marks;
    return named.map((m, i) => `${i + 1}. ${ROLE[m] ?? m}${lines ? `: ${lines[i]} lines` : ''}`);
  };
  // With a length: one plan per tempo band, or the fixed tempo's plan (§12.11: lines per stanza depend on the tempo).
  const plan =
    req.flow !== 'topic' || !req.seconds
      ? { stanzas: req.flow === 'topic' ? stanzasFor(fixed ?? TEMPO_BANDS.mid.bpm) : null }
      : fixed
        ? { tempo: `${fixed} BPM, as the request gives it: answer bpm ${fixed}`, stanzas: stanzasFor(fixed) }
        : {
            tempo: 'pick the tempo band that fits the description, answer its BPM, and write the stanzas of that band',
            stanzasByTempo: Object.fromEntries(
              (Object.keys(TEMPO_BANDS) as TempoBand[]).map((band) => [`${band} (${BAND_LABEL[band]}, e.g. ${TEMPO_BANDS[band].bpm} BPM)`, stanzasFor(TEMPO_BANDS[band].bpm)]),
            ),
          };
  const task = {
    flow:
      req.flow === 'topic'
        ? 'Write new lyrics for the description.'
        : 'Polish the customer lyrics so they are easier to sing: keep their meaning, images and key words; even out line lengths and fix words that are hard to sing. Do not add new ideas.',
    description: req.topic || null,
    ...(req.flow === 'polish' ? { customerLyrics: ownLyrics(req.lyrics) } : {}),
    language:
      req.language === 'ko' ? 'Korean' : req.language === 'en' ? 'English' : 'Korean, with English only in the hook and ad-libs',
    lengthSeconds: req.seconds,
    ...plan,
    syllablesPerLine: `${line.min}-${line.max}${req.language === 'en' ? '' : ' Korean syllables'}`,
    tone: req.tone === 'haeyo' ? '해요체 throughout' : req.tone === 'banmal' ? '반말 throughout' : 'pick one and keep it',
    brand: req.brand ? { name: req.brand.name, writeItAs: req.brand.readAs?.trim() || req.brand.name } : null,
    mustInclude: req.mustInclude,
  };
  const fix = problems.length ? `\n\nThe previous answer broke these rules; fix them:\n${problems.map((p) => `- ${p}`).join('\n')}` : '';
  return `${JSON.stringify(task, null, 2)}${fix}`;
}

/** The model's stanzas as the lyrics box shows them: trimmed lines, marks and brackets dropped, blank line between. */
export function stanzasText(answer: unknown): string {
  const stanzas = (answer as { stanzas?: unknown })?.stanzas;
  if (!Array.isArray(stanzas)) return '';
  return stanzas
    .map((stanza) =>
      (Array.isArray(stanza) ? stanza : [stanza])
        .filter((line): line is string => typeof line === 'string')
        .flatMap((line) => line.split(/\r?\n|\\n/))
        .map((line) => line.trim())
        .filter((line) => line && !/^\[[^\]]{1,40}\]$/.test(line))
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n')
    .slice(0, LYRICS_LIMITS.max);
}

/** The checks for a drafted or polished lyric: the lines asked at the planned tempo (`bpm`), and the line length. */
export function draftProblems(req: LyricsRequest, text: string, bpm: number = draftBpm(req, null)): { hard: string[]; soft: string[] } {
  const input: LyricCheckInput = {
    lyrics: text,
    language: req.language,
    stanzaLines: askedLines(req, bpm),
    lineLength: req.flow === 'topic',
    tone: req.tone,
    brand: req.brand,
    mustInclude: req.mustInclude,
  };
  const { hard, soft } = checkLyrics(input);
  if (req.flow === 'topic' && !input.stanzaLines) {
    const count = text ? text.split(/\n\s*\n/).length : 0;
    const want = STANZAS[req.structure];
    if (text && count !== want) soft.push(`${count} stanzas where ${want} were asked`);
  }
  if (namedArtist(text)) hard.push('names a singer, a band or a song');
  return { hard, soft };
}

/**
 * How long a draft may take. The route allows 300 s; the customer waits behind a live line in the dock. Each call
 * gets its own limit and never more than what is left of `totalMs`: a call with less than `minCallMs` left is not
 * started (no rewrite, no hand-over), so the whole draft ends within `totalMs`.
 */
export const LYRICS_TIMEOUTS = { firstCallMs: 40_000, fallbackCallMs: 20_000, totalMs: 120_000, minCallMs: 5_000 } as const;
/** The model a timed-out or unreachable first model hands the request to, once (fastest of the five compared). */
export const LYRICS_FALLBACK_MODEL: LyricsModel = 'gemini-3.8-flash';

/**
 * Writes or polishes lyrics: one call, one rewrite on any broken rule, then the hard rules decide.
 * Throws on a transport failure (the caller answers `provider_unavailable`); `null` when the rules still fail.
 * `onCall` hears each call's model and time (the eval keeps them).
 */
export async function writeLyrics(
  req: LyricsRequest,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  log?: (event: string, detail: Record<string, unknown>) => void,
  options: { callMs?: number; deadline?: number; onCall?: (call: { model: string; ms: number; ok: boolean }) => void } = {},
): Promise<{ text: string; bpm: number } | null> {
  const deadline = options.deadline ?? Date.now() + LYRICS_TIMEOUTS.totalMs;
  let problems: string[] = [];
  let kept: { text: string; bpm: number } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const left = deadline - Date.now();
    if (left < LYRICS_TIMEOUTS.minCallMs) {
      // No time for this call: before any answer it is a timeout; for the rewrite, the first answer stands if only a
      // soft rule was off (as a rewrite that still misses one would be accepted).
      if (attempt === 0) throw Object.assign(new Error('lyrics draft out of time'), { name: 'TimeoutError' });
      return kept;
    }
    const started = Date.now();
    let answer: unknown;
    try {
      answer = await callGeminiJson(config, fetchImpl, {
        system: LYRICS_SYSTEM,
        parts: [{ text: lyricsTask(req, problems) }],
        schema: SCHEMA as unknown as Record<string, unknown>,
        thinking: 'LOW',
        timeoutMs: Math.min(options.callMs ?? LYRICS_TIMEOUTS.firstCallMs, left),
      });
    } finally {
      options.onCall?.({ model: config.model, ms: Date.now() - started, ok: answer !== undefined });
    }
    const text = stanzasText(answer);
    // The tempo the model chose (or the request fixed) decides how many lines each stanza must have (§12.11).
    const bpm = draftBpm(req, (answer as { bpm?: unknown })?.bpm);
    const found = draftProblems(req, text, bpm);
    if (found.hard.length === 0 && (found.soft.length === 0 || attempt === 1)) return { text, bpm };
    kept = found.hard.length === 0 ? { text, bpm } : null;
    problems = [...found.hard, ...found.soft];
    log?.('studio_lyrics_rule_retry', { attempt, hard: found.hard.length, soft: found.soft.length });
  }
  return null;
}

/** A timeout or a failure to reach the model (not a refusal, not a bad answer): worth one try on the fast model. */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || /aborted|timed? ?out/i.test(error.message)) return true;
  if (error instanceof TypeError) return true; // fetch failed: DNS, reset, offline
  return /^gemini_http_(408|429|5\d\d)$/.test(error.message);
}

/**
 * The draft as the studio runs it: the configured model first; a timeout or a transport failure there hands the
 * request once to `LYRICS_FALLBACK_MODEL`. Returns the lyrics (or null when the rules still fail) and the model
 * that wrote them, so the run records the right one. A refusal or a second failure throws.
 */
/** A draft as the studio keeps it: the text (null when the rules still fail), the tempo it was planned at, and who wrote it. */
export interface WrittenLyrics {
  text: string | null;
  bpm: number;
  model: string;
}

export async function writeLyricsWithFallback(
  req: LyricsRequest,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  log?: (event: string, detail: Record<string, unknown>) => void,
  onCall?: (call: { model: string; ms: number; ok: boolean }) => void,
): Promise<WrittenLyrics> {
  const deadline = Date.now() + LYRICS_TIMEOUTS.totalMs;
  const as = (written: { text: string; bpm: number } | null, model: string): WrittenLyrics => ({
    text: written?.text ?? null,
    bpm: written?.bpm ?? draftBpm(req, null),
    model,
  });
  try {
    return as(await writeLyrics(req, config, fetchImpl, log, { callMs: LYRICS_TIMEOUTS.firstCallMs, deadline, onCall }), config.model);
  } catch (error) {
    if (config.model === LYRICS_FALLBACK_MODEL || !isTransportFailure(error)) throw error;
    // Not enough of the total left for the fast model to answer: the first failure stands.
    if (deadline - Date.now() < LYRICS_TIMEOUTS.minCallMs) throw error;
    log?.('studio_lyrics_fallback_model', { from: config.model, to: LYRICS_FALLBACK_MODEL, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    const fast = { ...config, model: LYRICS_FALLBACK_MODEL };
    return as(await writeLyrics(req, fast, fetchImpl, log, { callMs: LYRICS_TIMEOUTS.fallbackCallMs, deadline, onCall }), LYRICS_FALLBACK_MODEL);
  }
}

const LOCAL_DRAFT: Readonly<Record<'ko' | 'en', readonly string[]>> = {
  ko: ['창가에 스민 아침빛\n오늘은 조금 더 가볍게', '천천히 숨을 고르고\n나답게 하루를 시작해', '물 한 잔을 따르고\n커튼을 열어 두면', '맑은 하루가 와요\n오늘도 가볍게'],
  en: ['Morning light through the window\nToday feels a little lighter', 'Take a slow breath and smile\nStart the day your way', 'Pour a glass, open the blinds\nLet the quiet in', 'A clear day is here\nLighter all the way'],
};

/** Local mode: fixed stanzas for a draft; a polish trims line-end punctuation and spacing (visibly different, nothing new). */
export function localLyrics(req: LyricsRequest): string {
  if (req.flow === 'polish') {
    return ownLyrics(req.lyrics)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').replace(/[.,!?~…]+$/u, '').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }
  const pool = LOCAL_DRAFT[req.language === 'en' ? 'en' : 'ko'].flatMap((stanza) => stanza.split('\n'));
  const brand = req.brand ? req.brand.readAs?.trim() || req.brand.name : null;
  // The plan's lines at the local tempo, filled from the fixed pool (the brand closes the first stanza).
  const lines = askedLines(req, localBpm(req)) ?? Array.from({ length: STANZAS[req.structure] }, () => 2);
  let n = 0;
  const stanzas = lines.map((count) => Array.from({ length: count }, () => pool[n++ % pool.length]!));
  if (brand) stanzas[0]![stanzas[0]!.length - 1] = req.language === 'en' ? `${brand}, every morning` : `${brand}와 함께 맑게`;
  return stanzas.map((stanza) => stanza.join('\n')).join('\n\n');
}

/** The tempo local mode plans a draft at: the request's, else the description's words, else the mid band. */
export function localBpm(req: LyricsRequest): number {
  return runTempo({ description: req.topic, draftBpm: req.bpm ?? null, wordsBpm: tempoOf(req.topic) });
}

export async function draftLyrics(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioLyricsDraft | (StudioFailure & { blocked?: 'name' }) | StudioFailure> {
  if (!deps.env.soundStudio) return failure('invalid');
  const parsed = LyricsDraftSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const gate = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      try {
        await assertBrandFeature(sql, v.organizationId, 'sound');
      } catch (error) {
        if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
        throw error;
      }
      requireCreate(seat);
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      const video = v.videoAssetId ? await videoFitOf(sql, { organizationId: v.organizationId, assetId: v.videoAssetId, locale: viewer.locale === 'en' ? 'en' : 'ko', now }) : null;
      if (v.videoAssetId && !video) throw new StudioDenied('invalid');
      return { ok: true as const, video };
    }),
  );
  if (!('ok' in gate) || gate.ok !== true) return gate as StudioFailure;
  // A name in the description, the customer's lyrics, the brand field or the words to include stops it before a call.
  const asked = [v.topic, v.lyrics ?? '', v.brand?.name ?? '', ...(v.mustInclude ?? [])].join('\n');
  if (namedArtist(asked)) return { ok: false, code: 'invalid', blocked: 'name' };
  if (!takeFreeIntelSlot(`lyrics:${v.organizationId}`, FREE_INTEL_LIMITS.lyricsPerMinute, now.getTime())) return failure('too_many_running');

  // SA4: a video's length replaces the chosen length; the structure follows it unless one was picked.
  const seconds = gate.video ? videoTargetSeconds(gate.video) : (v.seconds ?? null);
  const req: LyricsRequest = {
    flow: v.flow,
    topic: v.topic,
    ...(v.lyrics ? { lyrics: v.lyrics } : {}),
    language: v.language,
    seconds,
    // A BPM written in the description fixes the tempo; otherwise the model picks the band (§12.11).
    bpm: cleanBpm(/(\d{2,3})\s*bpm/i.exec(v.topic)?.[1]),
    structure: v.structure ?? defaultStructure(seconds),
    tone: v.tone ?? null,
    brand: v.brand ?? null,
    mustInclude: v.mustInclude ?? [],
  };
  if (deps.env.provider === 'fake' && !lyricsGeminiConfig(deps.intelDeps.env)) return { ok: true, flow: v.flow, lyrics: localLyrics(req), model: 'local', bpm: localBpm(req) };
  const config = lyricsGeminiConfig(deps.intelDeps.env);
  if (!config) return failure('provider_unavailable');
  let written: WrittenLyrics;
  try {
    written = await writeLyricsWithFallback(req, config, deps.intelDeps.fetch, deps.log);
  } catch (error) {
    deps.log?.('studio_lyrics_draft_failed', { flow: v.flow, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return failure('provider_unavailable');
  }
  if (!written.text) return failure('failed');
  return { ok: true, flow: v.flow, lyrics: written.text, model: isLyricsModel(written.model) ? written.model : (config.model as LyricsModel), bpm: written.bpm };
}
