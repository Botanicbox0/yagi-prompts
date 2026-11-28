/**
 * The prepare step of a music run (docs/BRAND-SOUND-STUDIO.md §12.2): the engine's `queued` step calls this once,
 * after the job is committed and before anything is sent, exactly where an image run gets its prompt designed
 * (../prepare.ts). It never fails a run on style design: any problem is the deterministic design.
 *
 * Local mode without a text-model key (`BRAND_STUDIO_PROVIDER=fake`) uses a fixed local design instead of the
 * fallback, so a laptop can see the whole designed path without a paid call.
 */
import type { LyricsDraftFailureReason } from '../contracts';
import { callGeminiJson, studioGeminiConfig, type GeminiConfig } from '../enhancer/gemini';
import { musicProfileForModel } from '../enhancer/profiles/music';
import { saveJob, tokenOf } from '../job-store';
import { brandSummary, PrepareFailure } from '../prepare';
import type { JobRow, StudioDeps, StudioJobWork } from '../types';
import {
  checkMinimaxLyrics,
  designMeta,
  designMetaForModel,
  designMusic,
  designMusicForModel,
  fallbackDesignForModel,
  markMinimaxLyrics,
  minimaxFallbackDesign,
  MUSIC_PROFILE_VERSION,
  normalizeReadings,
  resolveMinimaxDurationSeconds,
  type MusicDesign,
  type MusicDesignInput,
  type MusicEnhanceMeta,
  type MusicV2EnhanceMeta,
} from './architect';
import type { MusicModelId } from './engine';
import { minimaxMusic3Sunra } from './engines/minimax-sunra';
import { cleanBpm } from './length-plan';
import { checkLyrics, defaultStructure, LYRICS_LIMITS, markLyrics, musicWay, ownLyrics, type LyricCheckInput } from './lyrics';
import {
  askedLines,
  draftBpm,
  isTransportFailure,
  localBpm,
  localLyrics,
  LYRICS_FALLBACK_MODEL,
  LYRICS_SCHEMA,
  LYRICS_SYSTEM,
  LYRICS_TIMEOUTS,
  lyricsTask,
  STANZAS,
  type LyricsRequest,
  type WrittenLyrics,
} from './lyrics-draft';
import { lyricsGeminiConfig } from './lyrics-model';
import { isV2MusicJob } from './music-jobs';
import { namedArtist } from './names';
import { FAKE_EXISTING, judgeExistingLyrics, logMusicBlock, type LyricsVerdict } from './warnings';

export const MINIMAX_LYRICS_DRAFT_FAILED_DETAIL = 'minimax_lyrics_draft_failed';
export const MINIMAX_LYRICS_EXISTING_DETAIL = 'minimax_lyrics_existing';
export const MINIMAX_LYRICS_JUDGE_FAILED_DETAIL = 'minimax_lyrics_judge_failed';

export function minimaxLyricsFailureReason(detail: string): LyricsDraftFailureReason | null {
  switch (detail) {
    case MINIMAX_LYRICS_DRAFT_FAILED_DETAIL:
      return 'draft';
    case MINIMAX_LYRICS_EXISTING_DETAIL:
      return 'existing';
    case MINIMAX_LYRICS_JUDGE_FAILED_DETAIL:
      return 'judge_error';
    default:
      return null;
  }
}

export function musicDesignInputOf(job: Pick<JobRow, 'prompt' | 'params' | 'organization_id'>, brand: MusicDesignInput['brand'] = null): MusicDesignInput {
  const m = job.params.music!;
  return {
    prompt: job.prompt,
    vocal: m.vocal,
    lyrics: m.lyrics ?? '',
    careful: m.careful,
    structure: m.structure ?? null,
    video: m.video ?? null,
    words: m.words ?? null,
    plan: m.plan ?? null,
    language: m.language,
    locale: job.params.locale === 'en' ? 'en' : 'ko',
    brand,
    ...(m.composerMode ? { composerMode: m.composerMode } : {}),
    ...(m.targetSeconds !== undefined ? { targetSeconds: m.targetSeconds } : {}),
    ...(m.durationSeconds !== undefined ? { durationSeconds: m.durationSeconds } : {}),
    ...(m.readings ? { readings: m.readings } : {}),
    ...(job.organization_id ? { organizationId: job.organization_id } : {}),
  };
}

/** The fixed v1 Suno design local mode shows (never used with a real provider). */
export function localDesign(input: MusicDesignInput): MusicDesign {
  const mode = musicWay({ vocal: input.vocal, lyrics: input.lyrics, careful: input.careful });
  const words = input.prompt.replace(/\s+/g, ' ').trim().slice(0, 200);
  const voice = input.vocal
    ? `A warm, close ${input.language === 'ko' ? 'Korean' : 'English'} vocal sings in a relaxed, conversational way.`
    : 'Instrumental: a soft felt piano carries the melody.';
  const style =
    `Local design for: "${words}". Warm acoustic pop with a light, hopeful feel, around ${input.plan && input.vocal && input.lyrics.trim() ? input.plan.bpm : 96} BPM with a gentle swing. ${voice} ` +
    'Fingerpicked acoustic guitar keeps a steady pulse, a round upright bass walks under it, and brushed drums keep time softly. ' +
    'A short intro, the hook arrives early and returns once. Warm and close, with a little room. Ends cleanly on a held chord.';
  return {
    mode,
    style,
    title: input.locale === 'ko' ? '맑은 하루' : 'Clear Day',
    lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null, input.plan?.form ?? null),
    notes: input.locale === 'ko' ? '로컬 설계 예시예요. 실제 설계는 운영 환경에서 만들어져요.' : 'A local design example; the real design is made in production.',
    source: 'model',
    profileVersion: MUSIC_PROFILE_VERSION,
    llmModel: 'local',
  };
}

/** Per-model local design for fake mode without a Gemini key (`BRAND_STUDIO_PROVIDER=fake`). */
export function localDesignForModel(modelId: MusicModelId, input: MusicDesignInput): MusicDesign {
  const profile = musicProfileForModel(modelId);
  if (modelId === 'suno-v6' || modelId === 'suno-v6-wild') {
    const base = localDesign(input);
    return { ...base, profileVersion: profile.version };
  }

  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const mode = musicWay({ vocal: input.vocal, lyrics, careful: false });
  const words = input.prompt.replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 160);
  const sungKorean = lyrics ? /[가-힣]/.test(lyrics) : input.language === 'ko';
  const readings = normalizeReadings(input.readings, input.vocal);
  const readingNote = readings?.audio ? ` Reference audio character: ${readings.audio.replace(/[.]+$/, '')}.` : '';
  const voiceNote = readings?.voice ? ` Reference vocal character: ${readings.voice.replace(/[.]+$/, '')}.` : '';
  const caption = [
    `Global Metadata: Warm acoustic indie pop commercial piece inspired by "${words}", relaxed mid-tempo groove with steady hopeful energy and clean close-miked studio production.${readingNote}`,
    input.vocal
      ? `Vocal Details: Clear, intimate lead vocal singing in ${sungKorean ? 'Korean' : 'English'} with gentle phrasing and subtle doubled backing on the main hook.${voiceNote}`
      : 'Vocal Details: Instrumental; a warm felt piano carries the lead melody.',
    'Arrangement: Opening: fingerpicked acoustic guitar sets a clean pulse. Middle: round upright bass and soft brushed drums join to lift the main theme. Ending: percussion drops out and the harmony resolves cleanly on a held chord.',
  ].join('\n');

  return {
    mode,
    style: caption,
    prompt: caption,
    title: input.locale === 'ko' ? '맑은 하루' : 'Clear Day',
    lyrics: lyrics ? markMinimaxLyrics(lyrics, input.structure ?? null) : '',
    notes: input.locale === 'ko' ? '로컬 설계 예시예요. 실제 설계는 운영 환경에서 만들어져요.' : 'A local design example; the real design is made in production.',
    source: 'model',
    profileVersion: profile.version,
    llmModel: 'local',
    ...(typeof input.durationSeconds === 'number' ? { durationSeconds: input.durationSeconds } : {}),
  };
}

/** Closed v1 path: designs a Suno v6 music run (`suno@2026-11-21.2`). */
export async function designForDeps(deps: Pick<StudioDeps, 'env' | 'intelDeps' | 'log'>, input: MusicDesignInput): Promise<MusicDesign> {
  if (deps.env.provider === 'fake' && !studioGeminiConfig(deps.intelDeps.env)) return localDesign(input);
  return designMusic(input, { fetch: deps.intelDeps.fetch, env: deps.intelDeps.env, log: deps.log });
}

/** Sound Studio v2 path: designs a music run using the chosen model's profile (`suno-v6`, `suno-v6-wild`, `minimax-music-3`). */
export async function designForDepsV2(
  deps: Pick<StudioDeps, 'env' | 'intelDeps' | 'log'>,
  modelId: MusicModelId,
  input: MusicDesignInput,
): Promise<MusicDesign> {
  if (deps.env.provider === 'fake' && !studioGeminiConfig(deps.intelDeps.env)) return localDesignForModel(modelId, input);
  return designMusicForModel(modelId, input, { fetch: deps.intelDeps.fetch, env: deps.intelDeps.env, log: deps.log });
}

interface DraftedMinimaxLyrics {
  lyrics: string;
  rawLyrics: string;
  model: string;
  bpm: number;
}

function minimaxStanzasText(answer: unknown): string {
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
    .join('\n\n');
}

function minimaxDraftProblems(req: LyricsRequest, text: string, bpm: number): { hard: string[]; soft: string[] } {
  const maxChars = minimaxMusic3Sunra.capabilities.limits.lyrics;
  const input: LyricCheckInput = {
    lyrics: text,
    language: req.language,
    stanzaLines: askedLines(req, bpm),
    lineLength: req.flow === 'topic',
    tone: req.tone,
    brand: req.brand,
    mustInclude: req.mustInclude,
  };
  const checked = checkLyrics(input);
  const hard = checked.hard.filter((msg) => msg !== `over ${LYRICS_LIMITS.max} characters`);
  const { soft } = checked;
  if (text.replace(/\r\n?/g, '\n').length > maxChars) {
    hard.push(`over ${maxChars} characters`);
  }
  if (req.flow === 'topic' && !input.stanzaLines) {
    const count = text ? text.split(/\n\s*\n/).length : 0;
    const want = STANZAS[req.structure];
    if (text && count !== want) soft.push(`${count} stanzas where ${want} were asked`);
  }
  if (namedArtist(text)) hard.push('names a singer, a band or a song');
  return { hard, soft };
}

async function writeMinimaxLyrics(
  req: LyricsRequest,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  log?: (event: string, detail: Record<string, unknown>) => void,
  options: { callMs?: number; deadline?: number } = {},
): Promise<{ text: string; bpm: number } | null> {
  const deadline = options.deadline ?? Date.now() + LYRICS_TIMEOUTS.totalMs;
  let problems: string[] = [];
  let kept: { text: string; bpm: number } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const left = deadline - Date.now();
    if (left < LYRICS_TIMEOUTS.minCallMs) {
      if (attempt === 0) throw Object.assign(new Error('lyrics draft out of time'), { name: 'TimeoutError' });
      return kept;
    }
    const answer = await callGeminiJson(config, fetchImpl, {
      system: LYRICS_SYSTEM,
      parts: [{ text: lyricsTask(req, problems) }],
      schema: LYRICS_SCHEMA as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: Math.min(options.callMs ?? LYRICS_TIMEOUTS.firstCallMs, left),
    });
    const text = minimaxStanzasText(answer);
    const bpm = draftBpm(req, (answer as { bpm?: unknown })?.bpm);
    const found = minimaxDraftProblems(req, text, bpm);
    if (found.hard.length === 0 && (found.soft.length === 0 || attempt === 1)) return { text, bpm };
    kept = found.hard.length === 0 ? { text, bpm } : null;
    problems = [...found.hard, ...found.soft];
    log?.('studio_lyrics_rule_retry', { attempt, hard: found.hard.length, soft: found.soft.length });
  }
  return null;
}

export async function writeMinimaxLyricsWithFallback(
  req: LyricsRequest,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  log?: (event: string, detail: Record<string, unknown>) => void,
): Promise<WrittenLyrics> {
  const deadline = Date.now() + LYRICS_TIMEOUTS.totalMs;
  const as = (written: { text: string; bpm: number } | null, model: string): WrittenLyrics => ({
    text: written?.text ?? null,
    bpm: written?.bpm ?? draftBpm(req, null),
    model,
  });
  try {
    return as(await writeMinimaxLyrics(req, config, fetchImpl, log, { callMs: LYRICS_TIMEOUTS.firstCallMs, deadline }), config.model);
  } catch (error) {
    if (config.model === LYRICS_FALLBACK_MODEL || !isTransportFailure(error)) throw error;
    if (deadline - Date.now() < LYRICS_TIMEOUTS.minCallMs) throw error;
    log?.('studio_lyrics_fallback_model', { from: config.model, to: LYRICS_FALLBACK_MODEL, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    const fast = { ...config, model: LYRICS_FALLBACK_MODEL };
    return as(await writeMinimaxLyrics(req, fast, fetchImpl, log, { callMs: LYRICS_TIMEOUTS.fallbackCallMs, deadline }), LYRICS_FALLBACK_MODEL);
  }
}

/**
 * Drafts and judges lyrics for a MiniMax Music 3.0 vocal run whose customer left `lyrics` blank (N1, N2).
 *  - Always runs when `model === 'minimax-music-3' && vocal && !ownLyrics(lyrics)`, even if `architect` is off.
 *  - `localLyrics` is used ONLY in local/fake mode without a Gemini key (`deps.env.provider === 'fake' && !config`).
 *  - Every failure (missing key on live run, transport/model error, empty text, > 3,500 chars after trimming and
 *    marking, `namedArtist`, `judgeExistingLyrics` === `'existing'`, or judgment error `'unknown'`) becomes a
 *    `PrepareFailure` with a distinct detail so the job ends `failed` at 0 credits with zero provider submits.
 */
async function draftMinimaxLyrics(deps: StudioDeps, job: JobRow): Promise<DraftedMinimaxLyrics> {
  const m = job.params.music!;
  const maxLyrics = minimaxMusic3Sunra.capabilities.limits.lyrics;
  const durationSeconds = resolveMinimaxDurationSeconds({
    durationSeconds: m.durationSeconds,
    video: m.video,
    prompt: job.prompt,
  });
  const structure = m.structure ?? defaultStructure(durationSeconds);
  const req: LyricsRequest = {
    flow: 'topic',
    topic: job.prompt,
    language: m.language,
    seconds: durationSeconds,
    bpm: cleanBpm(/(\d{2,3})\s*bpm/i.exec(job.prompt)?.[1]),
    structure,
    tone: null,
    brand: m.words?.brand ? { name: m.words.brand.name, ...(m.words.brand.readAs ? { readAs: m.words.brand.readAs } : {}) } : null,
    mustInclude: m.words?.mustInclude ? [...m.words.mustInclude] : [],
  };

  const now = deps.now?.() ?? new Date();
  const config = lyricsGeminiConfig(deps.intelDeps.env);
  if (deps.env.provider === 'fake' && !config) {
    const rawLyrics = ownLyrics(localLyrics(req));
    const lyrics = markMinimaxLyrics(rawLyrics, structure);
    if (!lyrics || !/\S/.test(lyrics) || lyrics.length > maxLyrics || namedArtist(lyrics) || checkMinimaxLyrics(lyrics).length > 0) {
      throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
    }
    if (rawLyrics.includes(FAKE_EXISTING)) {
      logMusicBlock(deps.log, { organizationId: job.organization_id, userId: job.created_by, field: 'lyrics', check: 'judge', lyrics: rawLyrics }, now);
      throw new PrepareFailure('failed', MINIMAX_LYRICS_EXISTING_DETAIL);
    }
    return { lyrics, rawLyrics, model: 'local', bpm: localBpm(req) };
  }

  if (!config) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'no_key' });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  let written: WrittenLyrics;
  try {
    written = await writeMinimaxLyricsWithFallback(req, config, deps.intelDeps.fetch, deps.log);
  } catch (error) {
    deps.log?.('studio_minimax_lyrics_draft_failed', {
      jobId: job.id,
      reason: 'model_error',
      message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  const rawLyrics = ownLyrics(written.text);
  if (!rawLyrics || !/\S/.test(rawLyrics)) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'empty' });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  const lyrics = markMinimaxLyrics(rawLyrics, structure);
  if (!lyrics || !/\S/.test(lyrics) || lyrics.length > maxLyrics) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'over_limit', length: lyrics.length });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  if (namedArtist(lyrics)) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'unusable' });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  // MUST-FIX 4: drafted lyrics are validated separately here at prepare time, never inside the caption retry loop.
  const lyricProblems = checkMinimaxLyrics(lyrics);
  if (lyricProblems.length > 0) {
    deps.log?.('studio_minimax_lyrics_draft_failed', {
      jobId: job.id,
      reason: 'lyric_check_failed',
      problems: lyricProblems.join('; ').slice(0, 240),
    });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  const markedExisting = deps.env.provider === 'fake' && rawLyrics.includes(FAKE_EXISTING);
  let verdict: LyricsVerdict;
  if (markedExisting) {
    verdict = 'existing';
  } else {
    try {
      verdict = await judgeExistingLyrics(rawLyrics, config, deps.intelDeps.fetch, deps.log);
    } catch {
      verdict = 'unknown';
    }
  }
  if (verdict === 'existing') {
    logMusicBlock(
      deps.log,
      { organizationId: job.organization_id, userId: job.created_by, field: 'lyrics', check: 'judge', lyrics: rawLyrics },
      now,
    );
    throw new PrepareFailure('failed', MINIMAX_LYRICS_EXISTING_DETAIL);
  }
  if (verdict !== 'original') {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'judge_error' });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_JUDGE_FAILED_DETAIL);
  }

  return { lyrics, rawLyrics, model: written.model, bpm: written.bpm };
}

async function prepareMusicV2(deps: StudioDeps, job: JobRow): Promise<{ finalPrompt: string; work: StudioJobWork }> {
  const m = job.params.music!;
  const modelId: MusicModelId =
    job.model === 'minimax-music-3' || job.model === 'suno-v6-wild' ? job.model : 'suno-v6';

  if (modelId === 'minimax-music-3') {
    let currentWork: StudioJobWork = job.work ?? {};
    let drafted: DraftedMinimaxLyrics | null = null;
    if (m.vocal && !ownLyrics(m.lyrics)) {
      if (currentWork.minimaxDraft) {
        drafted = currentWork.minimaxDraft;
      } else {
        drafted = await draftMinimaxLyrics(deps, job);
        const nextWork: StudioJobWork = { ...currentWork, minimaxDraft: drafted };
        if (job.claimed_at) {
          const saved = await saveJob(deps.sql, job, tokenOf(job), { work: nextWork });
          if (!saved) return { finalPrompt: job.final_prompt ?? '', work: currentWork };
          currentWork = saved.work;
        } else {
          await deps.sql.query("update brand_studio_jobs set work = $2::jsonb where id = $1 and status = 'queued'", [
            job.id,
            JSON.stringify(nextWork),
          ]);
          currentWork = nextWork;
        }
        job.work = currentWork;
      }
    }

    const existingEnhancer =
      currentWork.enhancer &&
      'profile' in currentWork.enhancer &&
      (currentWork.enhancer.profile === 'suno' ||
        currentWork.enhancer.profile === 'suno-v6' ||
        currentWork.enhancer.profile === 'suno-v6-wild' ||
        currentWork.enhancer.profile === 'minimax-music-3')
        ? (currentWork.enhancer as MusicEnhanceMeta | MusicV2EnhanceMeta)
        : null;

    const baseNoBrand = musicDesignInputOf(job);
    const hasAttachedReadings = Boolean(normalizeReadings(baseNoBrand.readings, m.vocal));

    if (!job.enhance || existingEnhancer?.source === 'reviewed') {
      // When Architect is off AND readings are attached, fold readings into the 3-heading deterministic fallback;
      // otherwise preserve customer's raw prompt (`minimaxFallbackDesign`, matching B2 `architect: false`).
      const offFallback =
        !job.enhance && hasAttachedReadings
          ? fallbackDesignForModel('minimax-music-3', baseNoBrand, 'off')
          : minimaxFallbackDesign(baseNoBrand, 'off');
      const baseMeta: MusicV2EnhanceMeta = existingEnhancer
        ? { ...existingEnhancer, profile: 'minimax-music-3' }
        : designMetaForModel('minimax-music-3', offFallback);
      const finalPrompt =
        !job.enhance && hasAttachedReadings ? offFallback.style : (job.final_prompt ?? offFallback.style);
      return {
        finalPrompt,
        work: {
          ...currentWork,
          prepared: true,
          enhancer: {
            ...baseMeta,
            ...(m.titleSource === 'customer' ? { title: m.title } : {}),
            ...(drafted ? { lyrics: drafted.lyrics, lyricsModel: drafted.model } : {}),
          },
        },
      };
    }

    const org = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
    const brand = await brandSummary(deps, job.organization_id, org?.name ?? '');
    const baseInput = musicDesignInputOf(job, brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null);
    const hasOwnLyrics = Boolean(m.vocal && ownLyrics(m.lyrics));
    const resolvedDuration = resolveMinimaxDurationSeconds({
      durationSeconds: m.durationSeconds,
      video: m.video,
      prompt: job.prompt,
    });
    const designed = await designForDepsV2(deps, 'minimax-music-3', {
      ...baseInput,
      plan: null,
      durationSeconds: resolvedDuration,
      customerLyrics: hasOwnLyrics,
      ...(drafted ? { lyrics: drafted.lyrics, customerLyrics: false } : {}),
    });
    return {
      finalPrompt: designed.style,
      work: {
        ...currentWork,
        prepared: true,
        enhancer: {
          ...designMetaForModel('minimax-music-3', designed),
          ...(m.titleSource === 'customer' ? { title: m.title } : {}),
          ...(drafted ? { lyrics: drafted.lyrics, lyricsModel: drafted.model } : {}),
        },
      },
    };
  }

  const org = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
  const brand = await brandSummary(deps, job.organization_id, org?.name ?? '');
  const input = musicDesignInputOf(job, brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null);
  const design = await designForDepsV2(deps, modelId, {
    ...input,
    customerLyrics: Boolean(m.vocal && ownLyrics(m.lyrics)),
  });
  const meta = designMetaForModel(modelId, design);
  return {
    finalPrompt: design.style,
    work: {
      ...job.work,
      prepared: true,
      enhancer: m.titleSource === 'customer' ? { ...meta, title: m.title } : meta,
    },
  };
}

export async function prepareMusic(deps: StudioDeps, job: JobRow): Promise<{ finalPrompt: string; work: StudioJobWork }> {
  if (isV2MusicJob(job)) return prepareMusicV2(deps, job);
  const org = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
  const brand = await brandSummary(deps, job.organization_id, org?.name ?? '');
  const design = await designForDeps(deps, musicDesignInputOf(job, brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null));
  return { finalPrompt: design.style, work: { ...job.work, prepared: true, enhancer: designMeta(design) } };
}
