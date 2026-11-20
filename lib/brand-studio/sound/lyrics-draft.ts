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
  singingRate,
  structureMarks,
  syllableRange,
  tempoOf,
  type LyricCheckInput,
  type LyricStructure,
} from './lyrics';
import { lyricsGeminiConfig, type LyricsModel } from './lyrics-model';
import { namedArtist } from './names';

export type LyricsFlow = 'topic' | 'polish';

export interface LyricsRequest {
  flow: LyricsFlow;
  topic: string;
  /** `polish`: the customer's lyrics. */
  lyrics?: string;
  language: 'ko' | 'en' | 'mixed';
  seconds: number | null;
  /** The tempo (read from the description): the singing rate the syllables are sized by (§12.8). */
  bpm?: number | null;
  structure: LyricStructure;
  tone: 'haeyo' | 'banmal' | null;
  brand: { name: string; readAs?: string | null } | null;
  mustInclude: string[];
}

/** How many stanzas each structure asks for; the marks come from `structureMarks` (the last one is `[Outro]`). */
export const STANZAS: Readonly<Record<LyricStructure, number>> = { hook: 2, 'hook-verse': 4, full: 5 };

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
  'Answer with the stanzas only, in the order asked: no section labels, no title, no notes, no brackets.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: { stanzas: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
  required: ['stanzas'],
} as const;

/** What the model is asked, as one JSON block (no customer text outside it). */
export function lyricsTask(req: LyricsRequest, problems: readonly string[] = []): string {
  const marks = structureMarks(req.structure, STANZAS[req.structure]);
  const syllables = req.seconds && req.language !== 'en' ? syllableRange(req.seconds, req.bpm) : null;
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
    ...(syllables
      ? { koreanSyllablesInTotal: `${syllables.min}-${syllables.max}`, singingRate: `about ${singingRate(req.bpm)} syllables a second at this tempo` }
      : {}),
    stanzas: marks.map((m, i) => `${i + 1}. ${ROLE[m] ?? m}`),
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

/** The checks for a drafted or polished lyric, plus the stanza count the structure asks for. */
export function draftProblems(req: LyricsRequest, text: string): { hard: string[]; soft: string[] } {
  const input: LyricCheckInput = {
    lyrics: text,
    language: req.language,
    seconds: req.seconds,
    bpm: req.bpm ?? null,
    tone: req.tone,
    brand: req.brand,
    mustInclude: req.mustInclude,
  };
  const { hard, soft } = checkLyrics(input);
  const count = text ? text.split(/\n\s*\n/).length : 0;
  const want = STANZAS[req.structure];
  if (text && count !== want) soft.push(`${count} stanzas where ${want} were asked`);
  if (namedArtist(text)) hard.push('names a singer, a band or a song');
  return { hard, soft };
}

/**
 * Writes or polishes lyrics: one call, one rewrite on any broken rule, then the hard rules decide.
 * Throws on a transport failure (the caller answers `provider_unavailable`); `null` when the rules still fail.
 */
export async function writeLyrics(
  req: LyricsRequest,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  log?: (event: string, detail: Record<string, unknown>) => void,
): Promise<string | null> {
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await callGeminiJson(config, fetchImpl, {
      system: LYRICS_SYSTEM,
      parts: [{ text: lyricsTask(req, problems) }],
      schema: SCHEMA as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: 25_000,
    });
    const text = stanzasText(answer);
    const found = draftProblems(req, text);
    if (found.hard.length === 0 && (found.soft.length === 0 || attempt === 1)) return text;
    problems = [...found.hard, ...found.soft];
    log?.('studio_lyrics_rule_retry', { attempt, hard: found.hard.length, soft: found.soft.length });
  }
  return null;
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
  const pool = LOCAL_DRAFT[req.language === 'en' ? 'en' : 'ko'];
  const brand = req.brand ? req.brand.readAs?.trim() || req.brand.name : null;
  const stanzas = Array.from({ length: STANZAS[req.structure] }, (_, i) => pool[i % pool.length]!);
  if (brand) stanzas[0] = `${stanzas[0]!.split('\n')[0]}\n${req.language === 'en' ? `${brand}, every morning` : `${brand}와 함께`}`;
  return stanzas.join('\n\n');
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
      return { ok: true as const };
    }),
  );
  if (!('ok' in gate) || gate.ok !== true) return gate as StudioFailure;
  // A name in the description, the customer's lyrics, the brand field or the words to include stops it before a call.
  const asked = [v.topic, v.lyrics ?? '', v.brand?.name ?? '', ...(v.mustInclude ?? [])].join('\n');
  if (namedArtist(asked)) return { ok: false, code: 'invalid', blocked: 'name' };
  if (!takeFreeIntelSlot(`lyrics:${v.organizationId}`, FREE_INTEL_LIMITS.lyricsPerMinute, now.getTime())) return failure('too_many_running');

  const req: LyricsRequest = {
    flow: v.flow,
    topic: v.topic,
    ...(v.lyrics ? { lyrics: v.lyrics } : {}),
    language: v.language,
    seconds: v.seconds ?? null,
    bpm: tempoOf(v.topic),
    structure: v.structure ?? defaultStructure(v.seconds),
    tone: v.tone ?? null,
    brand: v.brand ?? null,
    mustInclude: v.mustInclude ?? [],
  };
  if (deps.env.provider === 'fake' && !lyricsGeminiConfig(deps.intelDeps.env)) return { ok: true, flow: v.flow, lyrics: localLyrics(req), model: 'local' };
  const config = lyricsGeminiConfig(deps.intelDeps.env);
  if (!config) return failure('provider_unavailable');
  let text: string | null;
  try {
    text = await writeLyrics(req, config, deps.intelDeps.fetch, deps.log);
  } catch (error) {
    deps.log?.('studio_lyrics_draft_failed', { flow: v.flow, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return failure('provider_unavailable');
  }
  if (!text) return failure('failed');
  return { ok: true, flow: v.flow, lyrics: text, model: config.model as LyricsModel };
}
