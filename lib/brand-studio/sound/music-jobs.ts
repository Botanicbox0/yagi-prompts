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
 *    while the server setting `BRAND_SOUND_MAX_MODE` is not `off` (founder decision §8-4 is open).
 *  - Nothing to prepare: no references, no rewriting. The row is stored prepared, with the sentence the
 *    engine receives in `final_prompt` (never shown to the customer).
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '../access';
import { STUDIO_LIMITS, type StudioFailure, type StudioJobCreated } from '../contracts';
import { routeJob } from '../lanes';
import { failure, guarded } from '../outcome';
import { jobView, openJobCount } from '../repo';
import type { JobRow, OutputRow, StudioDeps, StudioJobParams } from '../types';
import { usageKrw } from '../usage-rate';
import { reserveAllowance } from '../usage';
import { musicEngine, type MusicEngine, type MusicRequest } from './engine';
import { MUSIC_LIMITS, musicQuoteKrw } from './music-limits';
import { namedArtist } from './names';
import { LYRICS_LIMITS, musicStyle, musicWay, withSections } from './lyrics';

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
    /** "더 고르게 만들기" (Max Mode): twice the credits. */
    careful: z.boolean().optional(),
    /** Language to sing in when there are vocals and no lyrics; the screen's language when absent. */
    language: z.enum(['ko', 'en']).optional(),
  })
  .strict();
export type MusicJobCreate = z.infer<typeof MusicJobCreateSchema>;

/** A refusal the screen explains in its own words (and nothing was reserved): a name in the description or in the lyrics. */
export type MusicJobBlocked = StudioFailure & { blocked: 'name' | 'lyrics' };

const SUNG_IN: Readonly<Record<'ko' | 'en', string>> = { ko: 'Vocals sung in Korean.', en: 'Vocals sung in English.' };

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

export interface MusicPlan {
  engine: MusicEngine;
  request: MusicRequest;
  title: string;
  estimateUsd: number;
  estimateKrw: number;
  params: StudioJobParams;
}

/** Pure: the request, the name, the quote and what the row keeps. Throws `StudioDenied('invalid')` on a request the engine refuses. */
export function planMusic(input: MusicJobCreate, screenLocale: 'ko' | 'en', engine: MusicEngine = musicEngine(process.env)): MusicPlan {
  const language = input.language ?? screenLocale;
  const lyrics = input.vocal ? (input.lyrics ?? '').trim() : '';
  const careful = input.careful === true;
  const way = musicWay({ vocal: input.vocal, lyrics, careful });
  const title = musicTitle(input.prompt);
  const request: MusicRequest =
    way === 'describe'
      ? { mode: 'describe', prompt: describeSentence(input.prompt, input.vocal, language), vocal: input.vocal }
      : { mode: 'custom', prompt: musicStyle(input.prompt, input.vocal, Boolean(lyrics), language), vocal: input.vocal, title, lyrics: withSections(lyrics), careful };
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
        // The conditions the track was made under (§7.2): which engine and endpoint, which version of our terms.
        made: { engine: engine.id, endpoint, terms: SOUND_TERMS_VERSION },
      },
    },
  };
}


export async function createMusicJob(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioJobCreated | MusicJobBlocked | StudioFailure> {
  if (!deps.env.soundStudio) return failure('invalid');
  const parsed = MusicJobCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const outcome = await guarded(() =>
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
      await lockOrganization(sql, v.organizationId);
      const prior = (
        await sql.query<JobRow>('select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = $3', [
          v.organizationId,
          seat.userId,
          v.requestId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.kind !== 'music') throw new StudioDenied('conflict');
        const outputs = (await sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [prior.id])).rows;
        return { ok: true as const, job: jobView(prior, outputs, deps.media) };
      }
      if (namedArtist(v.prompt)) return { blocked: 'name' as const };
      if (v.vocal && v.lyrics && namedArtist(v.lyrics)) return { blocked: 'lyrics' as const };
      // "더 고르게 만들기" hidden by the server setting: a request still carrying it is refused, nothing reserved.
      if (v.careful === true && deps.env.soundMaxMode === false) throw new StudioDenied('invalid');
      const plan = planMusic(v, locale);
      if ((await openJobCount(sql, v.organizationId)) >= STUDIO_LIMITS.openJobsPerOrganization) throw new StudioDenied('too_many_running');
      const verdict = await reserveAllowance(sql, v.organizationId, plan.estimateKrw, deps.env, deps.now?.() ?? new Date());
      if (!verdict.ok) throw new StudioDenied(verdict.code);
      const lane = await routeJob(sql, {
        organizationId: v.organizationId,
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
            values ($1, $2, $3, 'music', $4, $5, $6, $7, $8, false, $9::jsonb, '[]'::jsonb, null, $10, $11, $12::jsonb) returning *`,
          [
            v.organizationId,
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
            JSON.stringify({ prepared: true }),
          ],
        )
      ).rows[0]!;
      // One slot: the engine answers one request with one or more versions; finishing adds a row per version.
      const outputs = (
        await sql.query<OutputRow>(
          `insert into brand_studio_outputs (job_id, organization_id, idx, kind) values ($1, $2, 0, 'audio') returning *`,
          [job.id, v.organizationId],
        )
      ).rows;
      return { ok: true as const, job: jobView(job, outputs, deps.media) };
    }),
  );
  if ('blocked' in outcome) return { ok: false, code: 'invalid', blocked: outcome.blocked };
  return outcome;
}
