/**
 * The prepare step of a music run (docs/BRAND-SOUND-STUDIO.md §12.2): the engine's `queued` step calls this once,
 * after the job is committed and before anything is sent, exactly where an image run gets its prompt designed
 * (../prepare.ts). It never fails a run: any problem is the deterministic design.
 *
 * Local mode without a text-model key (`BRAND_STUDIO_PROVIDER=fake`) uses a fixed local design instead of the
 * fallback, so a laptop can see the whole designed path without a paid call.
 */
import { studioGeminiConfig } from '../enhancer/gemini';
import { brandSummary, PrepareFailure } from '../prepare';
import type { JobRow, StudioDeps, StudioJobWork } from '../types';
import {
  designMeta,
  designMusic,
  markMinimaxLyrics,
  minimaxFallbackDesign,
  MUSIC_PROFILE_VERSION,
  type MusicDesign,
  type MusicDesignInput,
  type MusicEnhanceMeta,
} from './architect';
import { cleanBpm } from './length-plan';
import { defaultStructure, markLyrics, musicWay, ownLyrics } from './lyrics';
import { localBpm, localLyrics, writeLyricsWithFallback, type LyricsRequest } from './lyrics-draft';
import { lyricsGeminiConfig } from './lyrics-model';
import { namedArtist } from './names';
import { FAKE_EXISTING } from './warnings';

const MINIMAX_LYRICS_MAX = 3500;
export const MINIMAX_LYRICS_DRAFT_FAILED_DETAIL = 'minimax_lyrics_draft_failed';

export function musicDesignInputOf(job: Pick<JobRow, 'prompt' | 'params'>, brand: MusicDesignInput['brand'] = null): MusicDesignInput {
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
  };
}

/** The fixed design local mode shows (never used with a real provider). */
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

/** Designs a music run and returns what the job keeps: the sent paragraph and the design record. */
export async function designForDeps(deps: Pick<StudioDeps, 'env' | 'intelDeps' | 'log'>, input: MusicDesignInput): Promise<MusicDesign> {
  if (deps.env.provider === 'fake' && !studioGeminiConfig(deps.intelDeps.env)) return localDesign(input);
  return designMusic(input, { fetch: deps.intelDeps.fetch, env: deps.intelDeps.env, log: deps.log });
}

interface DraftedMinimaxLyrics {
  lyrics: string;
  rawLyrics: string;
  model: string;
  bpm: number;
}

/**
 * Drafts lyrics for a MiniMax Music 3.0 vocal run whose customer left `lyrics` blank (N1, N2).
 *  - Always runs when `model === 'minimax-music-3' && vocal && !ownLyrics(lyrics)`, even if `architect` is off.
 *  - `localLyrics` is used ONLY in local/fake mode without a Gemini key (`deps.env.provider === 'fake' && !config`).
 *  - Every failure (missing key on live run, transport/model error, empty text, > 3,500 chars after trimming and
 *    marking, or artist/unusable check) throws `PrepareFailure('failed', 'minimax_lyrics_draft_failed')` so the job
 *    settles `failed` at 0 credits with zero provider submits and zero retry loops.
 */
async function draftMinimaxLyrics(deps: StudioDeps, job: JobRow): Promise<DraftedMinimaxLyrics> {
  const m = job.params.music!;
  const durationSeconds = Math.min(75, Math.max(1, Math.round(m.durationSeconds ?? 60)));
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

  const config = lyricsGeminiConfig(deps.intelDeps.env);
  if (deps.env.provider === 'fake' && !config) {
    const rawLyrics = ownLyrics(localLyrics(req));
    const lyrics = markMinimaxLyrics(rawLyrics, structure);
    if (!lyrics || !/\S/.test(lyrics) || lyrics.length > MINIMAX_LYRICS_MAX || namedArtist(lyrics)) {
      throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
    }
    return { lyrics, rawLyrics, model: 'local', bpm: localBpm(req) };
  }

  if (!config) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'no_key' });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  let written: Awaited<ReturnType<typeof writeLyricsWithFallback>>;
  try {
    written = await writeLyricsWithFallback(req, config, deps.intelDeps.fetch, deps.log, undefined, { maxChars: MINIMAX_LYRICS_MAX });
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
  if (!lyrics || !/\S/.test(lyrics) || lyrics.length > MINIMAX_LYRICS_MAX) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'over_limit', length: lyrics.length });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  if (namedArtist(lyrics) || (deps.env.provider === 'fake' && lyrics.includes(FAKE_EXISTING))) {
    deps.log?.('studio_minimax_lyrics_draft_failed', { jobId: job.id, reason: 'unusable' });
    throw new PrepareFailure('failed', MINIMAX_LYRICS_DRAFT_FAILED_DETAIL);
  }

  return { lyrics, rawLyrics, model: written.model, bpm: written.bpm };
}

export async function prepareMusic(deps: StudioDeps, job: JobRow): Promise<{ finalPrompt: string; work: StudioJobWork }> {
  if (job.model === 'minimax-music-3') {
    const m = job.params.music!;
    const drafted = m.vocal && !ownLyrics(m.lyrics) ? await draftMinimaxLyrics(deps, job) : null;
    const existingEnhancer =
      job.work?.enhancer && 'profile' in job.work.enhancer && job.work.enhancer.profile === 'suno'
        ? (job.work.enhancer as MusicEnhanceMeta)
        : null;

    // Architect off (`!job.enhance`) or customer-reviewed caption (`source === 'reviewed'`): keep the style
    // already planned at creation and attach the drafted lyrics only.
    if (!job.enhance || existingEnhancer?.source === 'reviewed') {
      const baseMeta = existingEnhancer ?? designMeta(minimaxFallbackDesign(musicDesignInputOf(job), 'off'));
      const finalPrompt = job.final_prompt ?? minimaxFallbackDesign(musicDesignInputOf(job), 'off').style;
      return {
        finalPrompt,
        work: {
          ...job.work,
          prepared: true,
          enhancer: {
            ...baseMeta,
            ...(drafted ? { lyrics: drafted.lyrics, lyricsModel: drafted.model } : {}),
          },
        },
      };
    }

    const org = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
    const brand = await brandSummary(deps, job.organization_id, org?.name ?? '');
    const baseInput = musicDesignInputOf(job, brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null);
    const designed = await designForDeps(deps, {
      ...baseInput,
      plan: null,
      ...(drafted ? { lyrics: drafted.rawLyrics } : {}),
    });
    const effective = designed.source === 'fallback' ? minimaxFallbackDesign(baseInput, designed.fallbackReason) : designed;
    return {
      finalPrompt: effective.style,
      work: {
        ...job.work,
        prepared: true,
        enhancer: {
          ...designMeta(effective),
          ...(drafted ? { lyrics: drafted.lyrics, lyricsModel: drafted.model } : {}),
        },
      },
    };
  }

  const org = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
  const brand = await brandSummary(deps, job.organization_id, org?.name ?? '');
  const design = await designForDeps(deps, musicDesignInputOf(job, brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null));
  return { finalPrompt: design.style, work: { ...job.work, prepared: true, enhancer: designMeta(design) } };
}
