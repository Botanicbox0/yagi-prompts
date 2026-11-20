/**
 * `job.create` with `kind: 'music'` (docs/BRAND-SOUND-STUDIO.md §7.2, §7.4). Same table, same order and
 * same money rules as an image or video run (../jobs.ts): one transaction takes the seat, the organization
 * lock, idempotency, the open-job cap and the allowance reservation, then inserts the job. The engine is
 * reached only after the commit, by the studio's own engine (../engine.ts).
 *
 * What is music-specific:
 *  - Gates: `BRAND_SOUND_STUDIO` (off: like an unknown kind), the self-serve studio, then the `sound` group.
 *  - The quote is per request (§3.4): however many versions come back, the press takes the quote once; a
 *    request that returns none takes nothing (../finish.ts).
 *  - A description naming a real singer, group or song is refused before anything is reserved (§5), and so are
 *    lyrics naming one (SS3).
 *  - The way is the server's (§4.2, §7.5): lyrics with vocals, or "더 고르게 만들기", make a custom request
 *    (title, style, lyrics, Max Mode); anything else is a description request. "더 고르게 만들기" exists only
 *    while the server setting `BRAND_SOUND_MAX_MODE` is exactly `on` (hidden until the founder decides, §8-4).
 *  - The music Prompt Architect (./architect.ts, §12.2) designs what is sent. On (the default): the row starts
 *    unprepared and the engine's prepare step designs it (../prepare.ts), as for an image. A design the customer
 *    read and maybe edited in the dock (`designed`) goes as it is after the hard checks. Off: the description as
 *    typed, plus the language line (the fallback). What was sent is `final_prompt`, shown under "보낸 문장 보기".
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '../access';
import { STUDIO_LIMITS, type StudioFailure, type StudioJobCreated } from '../contracts';
import { routeJob } from '../lanes';
import { failure, guarded } from '../outcome';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { jobView, openJobCount } from '../repo';
import type { JobRow, OutputRow, StudioDeps, StudioJobParams } from '../types';
import { usageKrw } from '../usage-rate';
import { loadAllowance, reserveAllowance } from '../usage';
import { musicEngine, type MusicEngine, type MusicRequest } from './engine';
import { MUSIC_LIMITS, musicQuoteKrw } from './music-limits';
import { describeSentence, musicTitle } from './music-text';

export { describeSentence, musicTitle };
import { namedArtist } from './names';
import { planRecord, sungPlan } from './length-plan';
import { LYRIC_STRUCTURES, LYRICS_LIMITS, markLyrics, musicWay, ownLyrics } from './lyrics';
import { LYRICS_MODELS, lyricsGeminiConfig } from './lyrics-model';
import { videoFitOf, videoStructure, videoTargetSeconds, type MusicVideoFit } from './video-fit';
import { FAKE_EXISTING, judgeExistingLyrics, logMusicBlock, musicPaused, noteMusicBlock, strictMusicChecks, type MusicBlockRecord } from './warnings';
import { DESIGN_LIMITS, designMeta, fallbackDesign, reviewedDesign, type MusicDesign, type MusicDesignInput, type MusicWords } from './architect';

export { MUSIC_LIMITS, musicQuoteKrw };


/** The version of our own terms a track was made under (§7.2: the conditions snapshot). */
export const SOUND_TERMS_VERSION = 'sound-2026-11-20';

const Id = z.uuid();
const RequestId = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);

export const MusicJobCreateSchema = z
  .object({
    kind: z.literal('music'),
    organizationId: Id,
    requestId: RequestId,
    /** Accepted for clarity, never trusted: the server decides the way from the lyrics and the switch. */
    mode: z.enum(['describe', 'custom']).optional(),
    prompt: z.string().trim().min(1).max(MUSIC_LIMITS.promptMax),
    vocal: z.boolean().default(false),
    /** Sung as written (with vocals only); section marks are added when sent. */
    lyrics: z.string().max(LYRICS_LIMITS.max).optional(),
    /** 구성 (SA2, §12.3): the order of the section marks. Absent: verse, chorus, verse, ... as before. */
    structure: z.enum(LYRIC_STRUCTURES).optional(),
    /** 가사 분량 맞추기: the length the lyrics were sized for. The version closest to it is shown first (§12.8). */
    targetSeconds: z.number().int().min(5).max(240).optional(),
    /** SA4 "영상 길이": a library video; its length sets the target and the structure, its cuts shape the design. */
    videoAssetId: z.uuid().optional(),
    /**
     * The lyrics came from "가사 초안 만들기" (`topic`) or "부르기 좋게 손보기" (`polish`) and that model, as the draft
     * answer named it. Absent with lyrics: the customer wrote them. Only the allowed models are accepted.
     */
    lyricsBy: z.object({ flow: z.enum(['topic', 'polish']), model: z.enum([...LYRICS_MODELS, 'local']) }).strict().optional(),
    /**
     * The brand name and words to include from the lyrics options. Sung with no lyrics, they go to the engine with
     * the request (./architect.ts `subjectSentence`); checked for names like the description.
     */
    words: z
      .object({
        brand: z.object({ name: z.string().trim().min(1).max(60), readAs: z.string().trim().max(60).optional() }).strict().optional(),
        mustInclude: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
      })
      .strict()
      .optional(),
    /**
     * The tempo the drafted lyrics were planned at (`lyrics.draft` answers it, §12.11). A BPM written in the
     * description wins over it; without either the words and then the mid band decide (./length-plan.ts).
     */
    bpm: z.number().int().min(60).max(160).optional(),
    /** "더 고르게 만들기" (Max Mode): twice the credits. */
    careful: z.boolean().optional(),
    /** Language to sing in when there are vocals and no lyrics; the screen's language when absent. */
    language: z.enum(['ko', 'en']).optional(),
    /** The music Prompt Architect (§12.2): on unless the customer switched it off. */
    architect: z.boolean().default(true),
    /** A design the customer read in the dock (and may have edited): sent as it is after the hard checks. */
    designed: z.object({ style: z.string().max(DESIGN_LIMITS.styleHardMax), title: z.string().max(80).optional() }).strict().optional(),
  })
  .strict();
export type MusicJobCreate = z.infer<typeof MusicJobCreateSchema>;

/** An edited design that breaks the hard checks (a name stops it like a name in the description). */
export class MusicDesignRefused extends Error {
  constructor(readonly named: boolean) {
    super('music design refused');
    this.name = 'MusicDesignRefused';
  }
}

/** A refusal the screen explains in its own words (and nothing was reserved): a name in the description or in the lyrics. */
export type MusicJobBlocked = StudioFailure & { blocked: 'name' | 'lyrics' | 'paused' };

export interface MusicPlan {
  engine: MusicEngine;
  request: MusicRequest;
  title: string;
  /** How the request was designed; `prepared: false` when the prepare step still designs it. */
  design: MusicDesign;
  prepared: boolean;
  estimateUsd: number;
  estimateKrw: number;
  params: StudioJobParams;
}

/** Pure: the request, the name, the quote and what the row keeps. Throws `StudioDenied('invalid')` on a request the engine refuses. */
export function designInputOf(
  input: Pick<MusicJobCreate, 'prompt' | 'vocal' | 'lyrics' | 'careful' | 'language' | 'structure' | 'words' | 'targetSeconds' | 'bpm'> & {
    video?: MusicVideoFit | null;
    lyricsBy?: { flow: 'topic' | 'polish' } | null;
  },
  screenLocale: 'ko' | 'en',
): MusicDesignInput {
  return {
    prompt: input.prompt,
    vocal: input.vocal,
    lyrics: input.vocal ? ownLyrics(input.lyrics) : '',
    careful: input.careful === true,
    structure: input.structure ?? null,
    video: input.video ?? null,
    language: input.language ?? screenLocale,
    locale: screenLocale,
    words: wordsFor(input),
    // The length plan (§12.11): one tempo, the form around the lines; the hook is sung again only when drafted.
    plan: sungPlan({
      prompt: input.prompt,
      vocal: input.vocal,
      lyrics: input.lyrics,
      structure: input.structure ?? null,
      seconds: input.targetSeconds ?? (input.video ? videoTargetSeconds(input.video) : null),
      draftBpm: input.bpm ?? null,
      drafted: input.lyricsBy?.flow === 'topic',
    }),
  };
}

/** The words go only where the engine writes the lyrics itself: vocals and nothing written. */
function wordsFor(input: Pick<MusicJobCreate, 'vocal' | 'lyrics' | 'words'>): MusicWords | null {
  if (!input.vocal || ownLyrics(input.lyrics) || !input.words) return null;
  const { brand, mustInclude } = input.words;
  if (!brand && !mustInclude?.length) return null;
  return { ...(brand ? { brand: { name: brand.name, ...(brand.readAs ? { readAs: brand.readAs } : {}) } } : {}), ...(mustInclude?.length ? { mustInclude: [...mustInclude] } : {}) };
}

/** The words as one text, for the name check. */
export function wordsText(words: MusicJobCreate['words']): string {
  return [words?.brand?.name ?? '', words?.brand?.readAs ?? '', ...(words?.mustInclude ?? [])].join('\n');
}

/**
 * Pure: the request, the name, the quote and what the row keeps. Throws `StudioDenied('invalid')` on a request the
 * engine refuses, and `MusicDesignRefused` on an edited design that breaks the hard checks.
 */
export function planMusic(
  input: Omit<MusicJobCreate, 'architect'> & { architect?: boolean; video?: MusicVideoFit | null },
  screenLocale: 'ko' | 'en',
  engine: MusicEngine = musicEngine(process.env),
): MusicPlan {
  const language = input.language ?? screenLocale;
  const lyrics = input.vocal ? ownLyrics(input.lyrics) : '';
  const careful = input.careful === true;
  const way = musicWay({ vocal: input.vocal, lyrics, careful });
  const designInput = designInputOf(input, screenLocale);
  let design: MusicDesign;
  if (input.designed) {
    const reviewed = reviewedDesign(designInput, input.designed);
    if ('problems' in reviewed) throw new MusicDesignRefused(reviewed.named);
    design = reviewed;
  } else {
    design = fallbackDesign(designInput, input.architect === false ? 'off' : undefined);
  }
  // With the Architect on and nothing reviewed, the prepare step designs it; the fallback stands in until then.
  const prepared = Boolean(input.designed) || input.architect === false;
  // The list name: the reviewed title, or the request's first words until the prepare step names it (../repo.ts).
  const title = design.title || musicTitle(input.prompt);
  const request: MusicRequest =
    way === 'describe'
      ? { mode: 'describe', prompt: design.style, vocal: input.vocal }
      : { mode: 'custom', prompt: design.style, vocal: input.vocal, title: design.title, lyrics: markLyrics(lyrics, input.structure ?? null, designInput.plan?.form ?? null), careful };
  let endpoint: string;
  try {
    endpoint = engine.request(request).endpoint;
  } catch {
    throw new StudioDenied('invalid');
  }
  const estimateUsd = engine.quoteUsd(request);
  return {
    engine,
    request,
    title,
    design,
    prepared,
    estimateUsd,
    estimateKrw: usageKrw(estimateUsd, 'audio'),
    params: {
      // The studio's common fields, empty for a sound run, so every reader of a job row stays as it is.
      aspect: null,
      resolution: null,
      seconds: null,
      audio: null,
      count: 1,
      locale: screenLocale,
      music: {
        mode: way,
        vocal: input.vocal,
        language,
        title,
        careful: way === 'custom' && careful,
        // What the customer typed (marks are added when sent), so "설정 다시 쓰기" gives it back as written.
        ...(lyrics ? { lyrics } : {}),
        ...(lyrics && input.structure ? { structure: input.structure } : {}),
        ...(lyrics && input.targetSeconds ? { targetSeconds: input.targetSeconds } : {}),
        ...(input.video ? { video: input.video } : {}),
        ...(designInput.words ? { words: designInput.words } : {}),
        // The plan, kept to send the same form and to fit the coefficients again against the measured lengths.
        ...(designInput.plan ? { plan: planRecord(designInput.plan) } : {}),
        ...(lyrics ? { lyricsBy: input.lyricsBy ? { flow: input.lyricsBy.flow, model: input.lyricsBy.model } : { flow: 'own' as const, model: null } } : {}),
        // The conditions the track was made under (§7.2): which engine and endpoint, which version of our terms.
        made: { engine: engine.id, endpoint, terms: SOUND_TERMS_VERSION },
      },
    },
  };
}


/**
 * Creating a music run (§7.4, §12.5). The steps before anything is spent, cheapest first:
 *  1. the studio seat, the feature policy and the role (the gate order every studio screen keeps: seat → hardline and
 *     feature policy → role). They come before the duplicate lookup so a closed organization never answers, not even
 *     with a run made earlier;
 *  2. a resend of the same request (`requestId`) returns that run, before any check or judgment runs again;
 *  3. the pause after repeated blocks (only for a member: nobody else can probe an organization or write its log);
 *  4. names in the description and the lyrics, the hidden "더 고르게 만들기", the video, the plan, the allowance and
 *     the open-run cap;
 *  5. the lyrics judgment, a paid text-model call, behind a per-minute limit like `lyrics.draft` and `music.design`.
 *     Every sung lyric is judged: `lyricsBy` is a record only and never changes what is checked;
 *  6. the reservation, in its own transaction with the organization locked (the duplicate is looked up again there).
 * With strict checks (more than five engine refusals today) the Architect cannot be switched off and a design sent
 * from the dock is ignored: the server designs again.
 */
export async function createMusicJob(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioJobCreated | MusicJobBlocked | StudioFailure> {
  if (!deps.env.soundStudio) return failure('invalid');
  const parsed = MusicJobCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const asked = parsed.data;
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const now = deps.now?.() ?? new Date();
  const org = asked.organizationId;
  const record = (field: MusicBlockRecord['field'], check: MusicBlockRecord['check']) =>
    logMusicBlock(deps.log, { organizationId: org, userId: viewer.userId, field, check, lyrics: field === 'lyrics' ? asked.lyrics : null }, now);

  const gate = async (sql: SqlRunner) => {
    const seat = await studioSeat(sql, viewer.userId, org, { requireSelfStudio: true });
    if (seat.role === 'guest') throw new StudioDenied('not_found');
    try {
      await assertBrandFeature(sql, org, 'sound');
    } catch (error) {
      if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
      throw error;
    }
    requireCreate(seat);
    return seat;
  };
  const priorRun = async (sql: SqlRunner, userId: string | null) => {
    const prior = (
      await sql.query<JobRow>('select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = $3', [org, userId, asked.requestId])
    ).rows[0];
    if (!prior) return null;
    if (prior.kind !== 'music') throw new StudioDenied('conflict');
    const outputs = (await sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [prior.id])).rows;
    return { ok: true as const, job: jobView(prior, outputs, deps.media) };
  };

  // Steps 1–4, without spending anything.
  const checked = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await gate(sql);
      const prior = await priorRun(sql, seat.userId);
      if (prior) return prior;
      if (musicPaused(org, now.getTime())) return { paused: true as const };
      if (namedArtist(asked.prompt)) return { blocked: 'name' as const };
      if (asked.vocal && asked.lyrics && namedArtist(asked.lyrics)) return { blocked: 'lyrics' as const };
      if (asked.words && namedArtist(wordsText(asked.words))) return { blocked: 'name' as const };
      // "더 고르게 만들기" hidden by the server setting: a request still carrying it is refused, nothing reserved.
      if (asked.careful === true && deps.env.soundMaxMode !== true) throw new StudioDenied('invalid');
      const strict = await strictMusicChecks(sql, org, now);
      // SA4: the video's length is the target and sets the structure; its cuts go to the design. Not found: refused.
      let video: MusicVideoFit | null = null;
      if (asked.videoAssetId) {
        video = await videoFitOf(sql, { organizationId: org, assetId: asked.videoAssetId, locale, now });
        if (!video) throw new StudioDenied('invalid');
      }
      const strictInput: MusicJobCreate = strict ? { ...asked, architect: true, designed: undefined } : asked;
      const v = video ? { ...strictInput, video, targetSeconds: videoTargetSeconds(video), structure: strictInput.structure ?? videoStructure(video) } : strictInput;
      let plan: MusicPlan;
      try {
        plan = planMusic(v, locale);
      } catch (error) {
        if (error instanceof MusicDesignRefused) {
          if (error.named) return { blocked: 'name' as const };
          throw new StudioDenied('invalid');
        }
        throw error;
      }
      const allowance = await loadAllowance(sql, org, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      if (allowance.usedKrw + Math.max(0, plan.estimateKrw) > allowance.capKrw) throw new StudioDenied('allowance_exhausted');
      if ((await openJobCount(sql, org)) >= STUDIO_LIMITS.openJobsPerOrganization) throw new StudioDenied('too_many_running');
      return { ready: true as const, v, plan };
    }),
  );
  if ('job' in checked) return checked;
  if ('paused' in checked) {
    record('request', 'paused');
    return { ok: false, code: 'too_many_running', blocked: 'paused' };
  }
  if ('blocked' in checked) {
    record(checked.blocked === 'lyrics' ? 'lyrics' : 'prompt', 'ours');
    noteMusicBlock(org, now.getTime());
    return { ok: false, code: 'invalid', blocked: checked.blocked };
  }
  if (!('ready' in checked)) return checked as StudioFailure;
  const { v, plan } = checked;

  // Step 5: every sung lyric is judged, whoever wrote it.
  const sung = v.vocal ? ownLyrics(v.lyrics) : '';
  if (sung.trim()) {
    const config = lyricsGeminiConfig(deps.intelDeps.env);
    const marked = deps.env.provider === 'fake' && sung.includes(FAKE_EXISTING);
    // The limit counts real judgment calls only (a run with no text-model key is not judged and costs nothing).
    if (!marked && config && !takeFreeIntelSlot(`lyrics-judge:${org}`, FREE_INTEL_LIMITS.lyricsJudgePerMinute, now.getTime())) return failure('too_many_running');
    const verdict = marked ? 'existing' : config ? await judgeExistingLyrics(sung, config, deps.intelDeps.fetch, deps.log) : 'unknown';
    if (verdict === 'existing') {
      record('lyrics', 'judge');
      noteMusicBlock(org, now.getTime());
      return { ok: false, code: 'invalid', blocked: 'lyrics' };
    }
  }

  // Step 6: the reservation.
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await gate(sql);
      await lockOrganization(sql, org);
      const prior = await priorRun(sql, seat.userId);
      if (prior) return prior;
      if ((await openJobCount(sql, org)) >= STUDIO_LIMITS.openJobsPerOrganization) throw new StudioDenied('too_many_running');
      const verdict = await reserveAllowance(sql, org, plan.estimateKrw, deps.env, deps.now?.() ?? new Date());
      if (!verdict.ok) throw new StudioDenied(verdict.code);
      const lane = await routeJob(sql, {
        organizationId: org,
        model: plan.engine.model,
        defaultLane: deps.env.defaultLane,
        caps: deps.env.caps,
        apiUp: deps.env.apiConfigured && deps.provider !== null,
        now: deps.now?.() ?? new Date(),
        stick: null,
        place: null,
      });
      const job = (
        await sql.query<JobRow>(
          `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, final_prompt, enhance, params, refs,
              parent_output_id, estimate_usd, estimate_krw, work)
            values ($1, $2, $3, 'music', $4, $5, $6, $7, $8, $13, $9::jsonb, '[]'::jsonb, null, $10, $11, $12::jsonb) returning *`,
          [
            org,
            seat.userId,
            v.requestId,
            lane ? 'queued' : 'held',
            lane,
            plan.engine.model.id,
            v.prompt,
            plan.request.prompt,
            JSON.stringify(plan.params),
            Math.round(plan.estimateUsd * 10_000) / 10_000,
            plan.estimateKrw,
            JSON.stringify(plan.prepared ? { prepared: true, enhancer: designMeta(plan.design) } : {}),
            // "보낸 문장 보기" shows what went whenever the Architect took part (designed here or in the dock).
            v.architect !== false,
          ],
        )
      ).rows[0]!;
      // One slot: the engine answers one request with one or more versions; finishing adds a row per version.
      const outputs = (
        await sql.query<OutputRow>(
          `insert into brand_studio_outputs (job_id, organization_id, idx, kind) values ($1, $2, 0, 'audio') returning *`,
          [job.id, org],
        )
      ).rows;
      return { ok: true as const, job: jobView(job, outputs, deps.media) };
    }),
  );
}
