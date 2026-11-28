import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { soundMusicCreateInput } from '@/components/brand-studio/sound/sound-studio';
import type { ComposerInput } from '@/components/brand-studio/sound/composer';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { sniffMime } from '@/lib/brand-studio/files';
import { studioStatus } from '@/lib/brand-studio/http';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import { buildStudioRequest, MINIMAX_BARE_TAGS } from '@/lib/brand-studio/provider/requests';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { jobView } from '@/lib/brand-studio/repo';
import { pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { audioSeconds } from '@/lib/brand-studio/sound/audio-info';
import type { MusicModelId } from '@/lib/brand-studio/sound/engine';
import { sunoV6Sunra } from '@/lib/brand-studio/sound/engines/suno-sunra';
import { defaultStructure, markLyrics, musicWay, ownLyrics, withoutAddedLines } from '@/lib/brand-studio/sound/lyrics';
import { createMusicJob, MusicJobCreateSchema, planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { musicQuoteCredits, musicQuoteForModel } from '@/lib/brand-studio/sound/music-limits';
import { resetMusicBlocks } from '@/lib/brand-studio/sound/warnings';
import type { JobRow, OutputRow } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { requestId, studioDeps, studioFixture, viewerOf } from '../server/helpers';

const OTHER_ORG = '00000000-0000-4000-8000-0000000000b1';
const MORPHIC_HARDCODED_ID = 'd425c3b1-4066-4970-8a3b-93c52b3eef70';
const BARE_TAG_LINE = new RegExp(`^\\[(${MINIMAX_BARE_TAGS.join('|')})\\]$`);

const GOOD_SUNO_STYLE =
  'Warm acoustic pop with a light, hopeful feel, around 96 BPM, relaxed. A warm female vocal sings softly in Korean. ' +
  'Fingerpicked acoustic guitar keeps a steady pulse, a round upright bass walks underneath, and brushed drums keep time. ' +
  'A short intro, the hook arrives early and returns once. Warm and close, a little room. Ends cleanly on a held chord.';

/**
 * Text-model stub following the existing sound test helper pattern in
 * `tests/brand-studio/sound/sa1-architect.test.ts:38-47` and `sa2-lyrics.test.ts:211-219`,
 * injected via `studioDeps(..., { intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } })`
 * (`tests/brand-studio/server/helpers.ts:124-142`).
 */
function geminiAnswers(...answers: Array<Record<string, unknown> | Error>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const next = answers.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no queued gemini answer');
    return new Response(
      JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchStub, calls };
}

function wrapRecordingProvider(inner: ReturnType<typeof createFakeStudioProvider>): StudioProvider & {
  sent: StudioProviderRequest[];
  tasks: typeof inner.tasks;
} {
  const sent: StudioProviderRequest[] = [];
  return {
    name: inner.name,
    tasks: inner.tasks,
    sent,
    async submit(req, opts) {
      sent.push(req);
      return inner.submit(req, opts);
    },
    status: (taskId) => inner.status(taskId),
    cancel: (taskId) => inner.cancel?.(taskId) ?? Promise.resolve(),
    download: (url) => inner.download(url),
  };
}

function composerInputOf(spec: { prompt: string; vocal: boolean; lyrics?: string; careful?: boolean }): ComposerInput {
  const sentLyrics = spec.vocal && spec.lyrics?.trim() ? ownLyrics(spec.lyrics) : '';
  const careful = spec.careful === true;
  const mode = musicWay({ vocal: spec.vocal, lyrics: sentLyrics, careful });
  return {
    prompt: spec.prompt.trim(),
    vocal: spec.vocal,
    lyrics: sentLyrics,
    careful,
    architect: true,
    structure: defaultStructure(30),
    targetSeconds: 30,
    quotedCredits: musicQuoteCredits({ mode, careful }),
  };
}

beforeEach(() => {
  resetFreeIntelRateLimits();
  resetMusicBlocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetFreeIntelRateLimits();
  resetMusicBlocks();
});

describe('1. Gate: unlisted vs listed vs without-v2-fields vs sandboxed/blocked', () => {
  it('refuses v2 fields for an unlisted organization with exact status 400 and code "invalid" (same as unknown fields today)', async () => {
    const f = await studioFixture();
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', OTHER_ORG);
      const deps = studioDeps(f.sql, {
        env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
      });
      const owner = viewerOf(f.ids.owner, 'ko');

      const unknownField = await runStudioOperation(deps, owner, 'job.create', {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        prompt: '차분한 피아노',
        vocal: false,
        unknownV99Field: true,
      });
      expect(unknownField).toEqual({ ok: false, code: 'invalid' });
      expect(studioStatus(unknownField.ok ? 'failed' : unknownField.code)).toBe(400);

      for (const v2Extra of [
        { model: 'suno-v6' },
        { model: 'suno-v6-wild' },
        { model: 'minimax-music-3' },
        { composerMode: 'simple' },
        { model: 'minimax-music-3', durationSeconds: 30 },
        { title: '모닝 루틴' },
      ]) {
        const refused = await runStudioOperation(deps, owner, 'job.create', {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          prompt: '차분한 피아노',
          vocal: false,
          ...v2Extra,
        });
        expect(refused, JSON.stringify(v2Extra)).toEqual(unknownField);
        if (!refused.ok) expect(studioStatus(refused.code)).toBe(400);
      }

      expect((await f.sql.query('select 1 from brand_studio_jobs where organization_id = $1', [f.orgId])).rows).toHaveLength(0);
      expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(0);
    } finally {
      await f.db.close();
    }
  });

  it('accepts v2 fields when listed, and prevents outsider/guest/viewer allowlist probing', async () => {
    const f = await studioFixture();
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const deps = studioDeps(f.sql, {
        env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
      });

      const payload = {
        kind: 'music' as const,
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'suno-v6-wild' as const,
        composerMode: 'simple' as const,
        prompt: '실험적인 신스 팝 배경음',
        vocal: false,
      };

      // Outsider on POST /api/brand-studio gets 404 not_found whether listed or unlisted;
      // guest and viewer sending v2 fields get 400 invalid (same as unlisted org).
      const outsiderRes = await runStudioOperation(deps, viewerOf(f.ids.outsider), 'job.create', payload);
      expect(outsiderRes).toEqual({ ok: false, code: 'not_found' });
      if (!outsiderRes.ok) expect(studioStatus(outsiderRes.code)).toBe(404);

      const guestRes = await runStudioOperation(deps, viewerOf(f.ids.guest), 'job.create', payload);
      expect(guestRes).toEqual({ ok: false, code: 'invalid' });
      if (!guestRes.ok) expect(studioStatus(guestRes.code)).toBe(400);

      const viewerRes = await runStudioOperation(deps, viewerOf(f.ids.viewer), 'job.create', payload);
      expect(viewerRes).toEqual({ ok: false, code: 'invalid' });
      if (!viewerRes.ok) expect(studioStatus(viewerRes.code)).toBe(400);

      const directOutsider = await createMusicJob(deps, viewerOf(f.ids.outsider), payload);
      expect(directOutsider).toEqual({ ok: false, code: 'invalid' });

      // Seated owner of listed org succeeds.
      const accepted = await runStudioOperation(deps, viewerOf(f.ids.owner), 'job.create', payload);
      expect(accepted).toMatchObject({ ok: true, job: { kind: 'music', model: 'suno-v6-wild', status: 'queued' } });
    } finally {
      await f.db.close();
    }
  });

  it('keeps requests WITHOUT v2 fields on a listed org identical in parse, row, and engine body to B0 baseline', async () => {
    const f = await studioFixture();
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const deps = studioDeps(f.sql, {
        env: studioEnv({
          BRAND_STUDIO_PROVIDER: 'fake',
          BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
          BRAND_SOUND_STUDIO: 'on',
          BRAND_SOUND_MAX_MODE: 'on',
        }),
        provider,
      });

      const canonicalCases = {
        describeInstrumental: composerInputOf({ prompt: '잔잔한 어쿠스틱 기타, 느린 템포', vocal: false }),
        describeVocal: composerInputOf({ prompt: '밝은 어쿠스틱 팝, 상쾌한 분위기', vocal: true }),
        customLyrics: composerInputOf({ prompt: '밝은 어쿠스틱 팝, 빠른 템포', vocal: true, lyrics: '햇살 같은 하루\n\n같이 걸어요' }),
        customLyricsCareful: composerInputOf({
          prompt: '밝은 어쿠스틱 팝, 빠른 템포',
          vocal: true,
          lyrics: '햇살 같은 하루\n\n같이 걸어요',
          careful: true,
        }),
      };

      const opts = { organizationId: f.orgId, locale: 'ko' as const, requestId: 'req_listed_v1_0001', brandProjectId: null };
      for (const c of Object.values(canonicalCases)) {
        const raw = soundMusicCreateInput(c, opts);
        const parsed = MusicJobCreateSchema.parse(raw);
        const plan = planMusic(parsed, 'ko');
        expect(plan).toEqual(planMusic(parsed, 'ko', sunoV6Sunra));
        expect(
          buildStudioRequest({
            kind: 'music',
            model: plan.engine.model.id,
            prompt: plan.request.prompt,
            params: plan.params,
            images: [],
            videos: [],
          }),
        ).toEqual(sunoV6Sunra.request(plan.request));
      }

      // Create describe + instrumental without v2 fields (and even with "30초" in prompt: v1 path must NOT parse sentence targetSeconds).
      const rawInst = soundMusicCreateInput(
        composerInputOf({ prompt: '30초 잔잔한 어쿠스틱 기타, 느린 템포', vocal: false }),
        { organizationId: f.orgId, locale: 'ko', requestId: 'req_listed_v1_row1', brandProjectId: null },
      );
      const created = await createMusicJob(deps, viewerOf(f.ids.owner, 'ko'), { ...rawInst, architect: false });
      if (!('job' in created)) throw new Error(JSON.stringify(created));

      const row = (
        await f.sql.query<{
          kind: string;
          model: string;
          status: string;
          estimate_krw: number;
          params: Record<string, unknown> & { music: Record<string, unknown> & { made: Record<string, unknown> } };
        }>('select kind, model, status, estimate_krw, params from brand_studio_jobs where id = $1', [created.job.id])
      ).rows[0]!;

      expect(row.kind).toBe('music');
      expect(row.model).toBe('suno-v6');
      expect(row.status).toBe('queued');
      expect(row.estimate_krw).toBe(16 * STUDIO_CREDIT_KRW);
      expect(Object.keys(row.params).sort()).toEqual([
        'aspect',
        'audio',
        'count',
        'locale',
        'music',
        'resolution',
        'seconds',
      ]);
      expect(Object.keys(row.params.music).sort()).toEqual([
        'careful',
        'language',
        'made',
        'mode',
        'title',
        'vocal',
      ]);
      expect(Object.keys(row.params.music.made).sort()).toEqual(['endpoint', 'engine', 'terms']);

      await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
      expect(provider.sent[0]).toEqual({
        endpoint: 'suno/suno-v6/inspire-mode',
        body: {
          prompt: '30초 잔잔한 어쿠스틱 기타, 느린 템포',
          instrumental: true,
        },
      });
    } finally {
      await f.db.close();
    }
  });

  it('keeps sandboxed and generation-blocked organizations at 404 even when listed in BRAND_SOUND_COMPOSER_V2_ORGS', async () => {
    const morphicById = await studioFixture({ orgId: MORPHIC_HARDCODED_ID, orgName: 'Neutral Client Name' });
    const morphicByName = await studioFixture({ orgName: 'Morphic Korea' });
    const blockedMedia = await studioFixture();
    const blockedSound = await studioFixture();
    try {
      await blockedMedia.sql.query(
        "insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['generative_media']::text[], $2)",
        [blockedMedia.orgId, blockedMedia.ids.admin],
      );
      await blockedSound.sql.query(
        "insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['sound']::text[], $2)",
        [blockedSound.orgId, blockedSound.ids.admin],
      );

      vi.stubEnv(
        'BRAND_SOUND_COMPOSER_V2_ORGS',
        [morphicById.orgId, morphicByName.orgId, blockedMedia.orgId, blockedSound.orgId].join(','),
      );

      for (const fx of [morphicById, morphicByName, blockedMedia, blockedSound]) {
        const deps = studioDeps(fx.sql, {
          env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
        });
        const v2Req = {
          kind: 'music' as const,
          organizationId: fx.orgId,
          requestId: requestId(),
          model: 'minimax-music-3' as const,
          prompt: '차분한 피아노 배경음',
          vocal: false,
        };
        const viaService = await runStudioOperation(deps, viewerOf(fx.ids.owner), 'job.create', v2Req);
        expect(viaService).toEqual({ ok: false, code: 'feature_unavailable' });
        if (!viaService.ok) expect(studioStatus(viaService.code)).toBe(404);

        const viaDirect = await createMusicJob(deps, viewerOf(fx.ids.owner), v2Req);
        expect(viaDirect).toEqual({ ok: false, code: 'feature_unavailable' });
        if (!viaDirect.ok) expect(studioStatus(viaDirect.code)).toBe(404);
      }
    } finally {
      await morphicById.db.close();
      await morphicByName.db.close();
      await blockedMedia.db.close();
      await blockedSound.db.close();
    }
  });
});

describe('2. Money parity per model and mode (quote == estimate_krw == settled usage_krw; failure == 0)', () => {
  it('holds quote == estimate_krw == usage_krw across all 9 model x mode cases, and settles 0 on [[fake:fail]] / [[fake:none]]', async () => {
    const f = await studioFixture({ capKrw: 5_000_000 });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const deps = studioDeps(f.sql, {
        env: studioEnv({
          BRAND_STUDIO_PROVIDER: 'fake',
          BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
          BRAND_SOUND_STUDIO: 'on',
          BRAND_SOUND_MAX_MODE: 'on',
        }),
        provider: createFakeStudioProvider({ pollsBeforeDone: 1 }),
      });
      const owner = viewerOf(f.ids.owner, 'ko');

      const cases: Array<{
        name: string;
        model: MusicModelId;
        quoteMode: 'describe' | 'custom';
        careful?: boolean;
        vocal: boolean;
        lyrics?: string;
        expectedKrw: number;
      }> = [
        { name: 'suno-v6 describe', model: 'suno-v6', quoteMode: 'describe', vocal: false, expectedKrw: 160 },
        { name: 'suno-v6 custom', model: 'suno-v6', quoteMode: 'custom', vocal: true, lyrics: '햇살 같은 하루\n\n같이 걸어요', expectedKrw: 160 },
        {
          name: 'suno-v6 custom+careful',
          model: 'suno-v6',
          quoteMode: 'custom',
          careful: true,
          vocal: true,
          lyrics: '햇살 같은 하루\n\n같이 걸어요',
          expectedKrw: 320,
        },
        { name: 'suno-v6-wild describe', model: 'suno-v6-wild', quoteMode: 'describe', vocal: true, expectedKrw: 160 },
        {
          name: 'suno-v6-wild custom',
          model: 'suno-v6-wild',
          quoteMode: 'custom',
          vocal: true,
          lyrics: '밤하늘을 건너\n\n별빛 아래',
          expectedKrw: 160,
        },
        {
          name: 'suno-v6-wild custom+careful',
          model: 'suno-v6-wild',
          quoteMode: 'custom',
          careful: true,
          vocal: true,
          lyrics: '밤하늘을 건너\n\n별빛 아래',
          expectedKrw: 320,
        },
        { name: 'minimax instrumental', model: 'minimax-music-3', quoteMode: 'describe', vocal: false, expectedKrw: 260 },
        {
          name: 'minimax vocal with lyrics',
          model: 'minimax-music-3',
          quoteMode: 'custom',
          vocal: true,
          lyrics: '아침을 여는 소리\n\n함께 걸어가요',
          expectedKrw: 260,
        },
        { name: 'minimax vocal blank lyrics', model: 'minimax-music-3', quoteMode: 'describe', vocal: true, expectedKrw: 260 },
      ];

      let cumulativeKrw = 0;
      for (const c of cases) {
        const quoted = musicQuoteForModel(c.model, { mode: c.quoteMode, careful: c.careful });
        expect(quoted, c.name).toBe(c.expectedKrw);

        const created = await createStudioJob(deps, owner, {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          model: c.model,
          prompt: '따뜻한 어쿠스틱 브랜드 음악',
          vocal: c.vocal,
          ...(c.lyrics !== undefined ? { lyrics: c.lyrics } : {}),
          ...(c.careful ? { careful: true } : {}),
        });
        if (!('job' in created)) throw new Error(`${c.name}: ${JSON.stringify(created)}`);

        const atCreate = (
          await f.sql.query<{ estimate_krw: number; usage_krw: number | null; model: string }>(
            'select estimate_krw, usage_krw, model from brand_studio_jobs where id = $1',
            [created.job.id],
          )
        ).rows[0]!;
        expect(atCreate.model, c.name).toBe(c.model);
        expect(atCreate.estimate_krw, c.name).toBe(quoted);
        expect(atCreate.usage_krw, c.name).toBeNull();

        await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });

        const afterFinish = (
          await f.sql.query<{ status: string; estimate_krw: number; usage_krw: number }>(
            'select status, estimate_krw, usage_krw from brand_studio_jobs where id = $1',
            [created.job.id],
          )
        ).rows[0]!;
        expect(afterFinish.status, c.name).toBe('succeeded');
        expect(afterFinish.usage_krw, c.name).toBe(quoted);

        cumulativeKrw += quoted;
        expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw, c.name).toBe(cumulativeKrw);
      }

      // Failed runs ([[fake:fail]] and [[fake:none]]) settle at 0 across all 3 models.
      for (const [model, marker] of [
        ['suno-v6', '[[fake:fail]]'],
        ['suno-v6-wild', '[[fake:none]]'],
        ['minimax-music-3', '[[fake:fail]]'],
        ['minimax-music-3', '[[fake:none]]'],
      ] as const) {
        const failedCreate = await createStudioJob(deps, owner, {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          model,
          prompt: `실패 테스트 ${marker}`,
          vocal: false,
          architect: false,
        });
        if (!('job' in failedCreate)) throw new Error(JSON.stringify(failedCreate));
        await advanceStudioJobsWith(deps, { jobIds: [failedCreate.job.id] });
        const failedRow = (
          await f.sql.query<{ status: string; usage_krw: number }>('select status, usage_krw from brand_studio_jobs where id = $1', [
            failedCreate.job.id,
          ])
        ).rows[0]!;
        expect(failedRow).toEqual({ status: 'failed', usage_krw: 0 });
        expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(cumulativeKrw);
      }
    } finally {
      await f.db.close();
    }
  });
});

describe('3. Exact provider endpoint + body and MiniMax / Suno duration precedence', () => {
  it('sends exact deep-equal endpoints and bodies for Suno v6, Wild, and MiniMax across all duration precedence rules', async () => {
    const f = await studioFixture({ capKrw: 5_000_000 });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const deps = studioDeps(f.sql, {
        env: studioEnv({
          BRAND_STUDIO_PROVIDER: 'fake',
          BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
          BRAND_SOUND_STUDIO: 'on',
          BRAND_SOUND_MAX_MODE: 'on',
        }),
        provider,
      });
      const owner = viewerOf(f.ids.owner, 'ko');

      const submitAndCapture = async (payload: Record<string, unknown>) => {
        const before = provider.sent.length;
        const created = await createStudioJob(deps, owner, {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          architect: false,
          ...payload,
        });
        if (!('job' in created)) throw new Error(JSON.stringify(created));
        await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
        expect(provider.sent.length).toBe(before + 1);
        return { job: created.job, req: provider.sent[before]! };
      };

      // Suno v6 Wild inspire & custom+careful
      expect((await submitAndCapture({ model: 'suno-v6-wild', prompt: '몽환적인 신스 패드', vocal: false })).req).toEqual({
        endpoint: 'suno/suno-v6-wild/inspire-mode',
        body: { prompt: '몽환적인 신스 패드', instrumental: true },
      });

      expect(
        (
          await submitAndCapture({
            model: 'suno-v6-wild',
            prompt: '질주하는 인디 록',
            vocal: true,
            lyrics: '달려가는 밤\n\n끝없는 길',
            structure: 'hook',
            careful: true,
          })
        ).req,
      ).toEqual({
        endpoint: 'suno/suno-v6-wild/custom-mode',
        body: {
          title: '질주하는 인디 록',
          style: '질주하는 인디 록',
          lyrics: '[Chorus]\n달려가는 밤\n\n[Outro]\n끝없는 길',
          instrumental: false,
          max_mode: true,
        },
      });

      // MiniMax precedence (1): customer 20 -> 20 (even when sentence states '15초'!)
      const customer20 = await submitAndCapture({
        model: 'minimax-music-3',
        prompt: '15초 상쾌한 티저 배경음',
        vocal: false,
        durationSeconds: 20,
      });
      expect(customer20.req).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: {
          prompt: '15초 상쾌한 티저 배경음',
          duration: 20,
          is_instrumental: true,
        },
      });
      expect('lyrics' in customer20.req.body).toBe(false);

      // Architect's designedDuration NEVER overrides customer's explicit durationSeconds (even when customer explicitly chose 60)
      const explicit60Job = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '15초 광고 배경음',
        vocal: false,
        durationSeconds: 60,
        architect: false,
      });
      if (!('job' in explicit60Job)) throw new Error('expected explicit60Job');
      const explicit60Row = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [explicit60Job.job.id])).rows[0]!;
      expect(explicit60Row.params.music?.durationSource).toBe('customer');
      expect(
        buildStudioRequest({
          kind: 'music',
          model: 'minimax-music-3',
          prompt: explicit60Row.final_prompt!,
          params: explicit60Row.params,
          images: [],
          videos: [],
          designedDuration: 25,
        }),
      ).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: { prompt: '15초 광고 배경음', duration: 60, is_instrumental: true },
      });
      await advanceStudioJobsWith(deps, { jobIds: [explicit60Job.job.id] });

      // MiniMax precedence (2): sentence '15초' -> 15
      expect(
        (
          await submitAndCapture({
            model: 'minimax-music-3',
            prompt: '15초 립틴트 숏폼 신스 팝',
            vocal: false,
          })
        ).req,
      ).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: { prompt: '15초 립틴트 숏폼 신스 팝', duration: 15, is_instrumental: true },
      });

      // MiniMax precedence (2) clamped: sentence '2분' (120s) -> 75
      expect(
        (
          await submitAndCapture({
            model: 'minimax-music-3',
            prompt: '2분 브랜드 필름 앰비언트 배경음',
            vocal: false,
          })
        ).req,
      ).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: { prompt: '2분 브랜드 필름 앰비언트 배경음', duration: 75, is_instrumental: true },
      });

      // MiniMax precedence (3): none -> 60
      expect(
        (
          await submitAndCapture({
            model: 'minimax-music-3',
            prompt: 'BPM 120 따뜻한 로즈 피아노와 브러시 드럼',
            vocal: false,
          })
        ).req,
      ).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: { prompt: 'BPM 120 따뜻한 로즈 피아노와 브러시 드럼', duration: 60, is_instrumental: true },
      });

      // MiniMax vocal with customer lyrics: bare open-weights tags, byte-preserved sung lines, no [Instrumental Break] or length-plan padding
      const ownVocal = await submitAndCapture({
        model: 'minimax-music-3',
        prompt: '30초 밝은 어쿠스틱 브랜드 송, 빠른 템포',
        vocal: true,
        lyrics: '  햇살 같은 하루  \n\n같이 걸어요!',
      });
      expect(ownVocal.req).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: {
          prompt: '30초 밝은 어쿠스틱 브랜드 송, 빠른 템포',
          lyrics: '[Verse]\n  햇살 같은 하루  \n\n[Outro]\n같이 걸어요!',
          duration: 30,
          is_instrumental: false,
        },
      });
      expect(withoutAddedLines(String(ownVocal.req.body.lyrics), '  햇살 같은 하루  \n\n같이 걸어요!')).toBe(
        '  햇살 같은 하루  \n\n같이 걸어요!',
      );
      expect(String(ownVocal.req.body.lyrics)).not.toContain('[Instrumental Break]');

      // Customer 300 (and 0, -5, 12.5, or durationSeconds on Suno) -> refused at create (`invalid`, 400) per CONTRACT-v2.md §B.1
      const usedBeforeRefusals = (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;
      for (const bad of [
        { model: 'minimax-music-3', durationSeconds: 300 },
        { model: 'minimax-music-3', durationSeconds: 0 },
        { model: 'minimax-music-3', durationSeconds: -5 },
        { model: 'minimax-music-3', durationSeconds: 12.5 },
        { model: 'suno-v6', durationSeconds: 20 },
        { model: 'suno-v6-wild', durationSeconds: 20 },
      ]) {
        const res = await runStudioOperation(deps, owner, 'job.create', {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          prompt: '차분한 배경음',
          vocal: false,
          ...bad,
        });
        expect(res, JSON.stringify(bad)).toEqual({ ok: false, code: 'invalid' });
        if (!res.ok) expect(studioStatus(res.code)).toBe(400);
      }
      expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(usedBeforeRefusals);

      // Suno v2 with sentence-stated length: feeds `sungPlan` (same as explicit targetSeconds) and records `targetSeconds`
      const sunoSentenceLyrics = await submitAndCapture({
        model: 'suno-v6',
        prompt: '30초 밝은 어쿠스틱 팝, 빠른 템포',
        vocal: true,
        lyrics: '햇살 같은 하루\n\n같이 걸어요',
        structure: 'hook',
      });
      const sunoRow = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [sunoSentenceLyrics.job.id])).rows[0]!;
      expect(sunoRow.params.music?.targetSeconds).toBe(30);
      expect(sunoRow.params.music?.plan?.seconds).toBe(30);
      expect(sunoSentenceLyrics.req.body.lyrics).toBe(
        markLyrics('햇살 같은 하루\n\n같이 걸어요', 'hook', sunoRow.params.music?.plan?.form ?? null),
      );
      expect(String(sunoSentenceLyrics.req.body.lyrics)).toContain('[Instrumental Break]');
    } finally {
      await f.db.close();
    }
  });
});

describe('4. MiniMax blank-lyrics vocal draft path (N1 & N2) vs Suno v6 behaviour', () => {
  it('drafts lyrics for MiniMax blank-lyrics vocal (both architect on and off) with bare tags <= 3500, and fails live without key', async () => {
    const f = await studioFixture({ capKrw: 5_000_000 });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const owner = viewerOf(f.ids.owner, 'ko');

      const draftedStanzas = {
        bpm: 118,
        stanzas: [
          ['창가에 스민 아침빛이', '오늘은 조금 더 가볍게', '물 한 잔을 따르고서', '나답게 하루를 열어요'],
        ],
      };

      // (a) Architect ON: writeLyricsWithFallback + designMusic
      const providerOn = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const stubOn = geminiAnswers(draftedStanzas, {
        style: GOOD_SUNO_STYLE,
        title: '상쾌한 아침',
        notes: '밝고 가볍게 설계했어요.',
      });
      const depsOn = studioDeps(f.sql, {
        env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
        provider: providerOn,
        intelDeps: { fetch: stubOn.fetchStub, env: { GEMINI_API_KEY: 'test-key' } },
      });

      const createdOn = await createStudioJob(depsOn, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '30초 상쾌한 스킨케어 광고 노래',
        vocal: true,
        architect: true,
      });
      if (!('job' in createdOn)) throw new Error(JSON.stringify(createdOn));
      await advanceStudioJobsWith(depsOn, { jobIds: [createdOn.job.id] });

      expect(providerOn.sent).toHaveLength(1);
      const sentLyricsOn = String(providerOn.sent[0]!.body.lyrics);
      expect(sentLyricsOn.length).toBeGreaterThan(0);
      expect(sentLyricsOn.length).toBeLessThanOrEqual(3500);
      expect(sentLyricsOn).toContain('창가에 스민 아침빛이');
      expect(sentLyricsOn).not.toContain('LOCAL_DRAFT');
      for (const line of sentLyricsOn.split('\n').filter((l) => l.trim().startsWith('['))) {
        expect(line).toMatch(BARE_TAG_LINE);
      }

      // (b) Architect OFF (N1): STILL runs the real lyric draft, never canned localLyrics!
      const providerOff = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const stubOff = geminiAnswers({
        bpm: 112,
        stanzas: [['탄산처럼 톡 터지는 순간', '시원하게 하루를 깨워요', '가볍게 손끝에 닿으면', '오늘의 리듬이 시작돼요']],
      });
      const depsOff = studioDeps(f.sql, {
        env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
        provider: providerOff,
        intelDeps: { fetch: stubOff.fetchStub, env: { GEMINI_API_KEY: 'test-key' } },
      });

      const createdOff = await createStudioJob(depsOff, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '25초 제로 탄산수 광고',
        vocal: true,
        architect: false,
      });
      if (!('job' in createdOff)) throw new Error(JSON.stringify(createdOff));
      await advanceStudioJobsWith(depsOff, { jobIds: [createdOff.job.id] });

      expect(stubOff.calls).toHaveLength(1); // Only lyric draft ran; style Architect did NOT run.
      expect(providerOff.sent).toHaveLength(1);
      expect(providerOff.sent[0]!.body.duration).toBe(25);
      expect(String(providerOff.sent[0]!.body.lyrics)).toBe(
        '[Chorus]\n탄산처럼 톡 터지는 순간\n시원하게 하루를 깨워요\n가볍게 손끝에 닿으면\n오늘의 리듬이 시작돼요',
      );

      // (c) Live paid mode without GEMINI_API_KEY: NEVER falls back to localLyrics; aborts at 0 credits!
      const liveNoKeyProvider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const depsLiveNoKey = studioDeps(f.sql, {
        env: studioEnv({
          BRAND_STUDIO_PROVIDER: 'live',
          SUNRA_API_KEY: 'sk-test',
          BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
          BRAND_SOUND_STUDIO: 'on',
        }),
        provider: liveNoKeyProvider,
        intelDeps: { fetch: (() => Promise.reject(new Error('never'))) as typeof fetch, env: {} },
      });
      const createdLiveNoKey = await createStudioJob(depsLiveNoKey, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '상쾌한 광고 음악',
        vocal: true,
        architect: false,
      });
      if (!('job' in createdLiveNoKey)) throw new Error(JSON.stringify(createdLiveNoKey));
      await advanceStudioJobsWith(depsLiveNoKey, { jobIds: [createdLiveNoKey.job.id] });
      expect(liveNoKeyProvider.sent).toHaveLength(0);
      const liveFailedRow = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [createdLiveNoKey.job.id])).rows[0]!;
      expect(liveFailedRow.status).toBe('failed');
      expect(liveFailedRow.usage_krw).toBe(0);
      expect(jobView(liveFailedRow, [], depsLiveNoKey.media).lyricsDraftFailed).toBe(true);
    } finally {
      await f.db.close();
    }
  });

  it('turns every MiniMax draft failure into a 0-credit failed job with zero provider submits, zero retries on polls 2 & 3, and lyricsDraftFailed in jobView', async () => {
    const f = await studioFixture({ capKrw: 5_000_000 });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const owner = viewerOf(f.ids.owner, 'ko');

      const failureScenarios: Array<{ name: string; answers: Array<Record<string, unknown> | Error> }> = [
        { name: 'transport / model throw', answers: [new Error('gemini_http_503'), new Error('gemini_http_503')] },
        { name: 'empty stanzas', answers: [{ bpm: 100, stanzas: [['   ']] }, { bpm: 100, stanzas: [] }] },
        {
          name: 'over 3500 limit after trimming',
          answers: [
            { bpm: 100, stanzas: [['가'.repeat(3600)]] },
            { bpm: 100, stanzas: [['나'.repeat(3550)]] },
          ],
        },
        {
          name: 'judged unusable (artist / superlative)',
          answers: [
            { bpm: 100, stanzas: [['아이유처럼 노래해요', '우리가 최고예요']] },
            { bpm: 100, stanzas: [['블랙핑크 같은 리듬', '세상 최고 브랜드']] },
          ],
        },
      ];

      for (const scenario of failureScenarios) {
        const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
        const stub = geminiAnswers(...scenario.answers);
        const deps = studioDeps(f.sql, {
          env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
          provider,
          intelDeps: { fetch: stub.fetchStub, env: { GEMINI_API_KEY: 'test-key', BRAND_SOUND_LYRICS_MODEL: 'gemini-3.8-flash' } },
        });

        const created = await createStudioJob(deps, owner, {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          model: 'minimax-music-3',
          prompt: '상쾌한 봄 캠페인 노래',
          vocal: true,
        });
        if (!('job' in created)) throw new Error(`${scenario.name}: ${JSON.stringify(created)}`);

        // Poll 1: advances and fails in prepare
        await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
        const callsAfterPoll1 = stub.calls.length;
        expect(callsAfterPoll1, scenario.name).toBeGreaterThan(0);
        expect(provider.sent, scenario.name).toHaveLength(0);

        // Poll 2 & Poll 3: must NOT call the draft again and must NOT submit to provider
        for (const pollNo of [2, 3]) {
          const polled = await pollStudioJobs(deps, owner, f.orgId, [created.job.id]);
          expect(polled.ok, `${scenario.name} poll ${pollNo}`).toBe(true);
          if (polled.ok) {
            expect(polled.jobs[0]).toMatchObject({
              id: created.job.id,
              status: 'failed',
              errorCode: 'failed',
              estimateKrw: 0,
              lyricsDraftFailed: true,
            });
            expect(polled.allowance.usedKrw, `${scenario.name} poll ${pollNo}`).toBe(0);
          }
          const adv = await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
          expect(adv.advanced, `${scenario.name} poll ${pollNo}`).toBe(0);
          expect(stub.calls.length, `${scenario.name} poll ${pollNo}`).toBe(callsAfterPoll1);
          expect(provider.sent, `${scenario.name} poll ${pollNo}`).toHaveLength(0);
        }

        const row = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
        expect(row.status, scenario.name).toBe('failed');
        expect(row.usage_krw, scenario.name).toBe(0);
        expect(row.work.lyricsDraftFailed, scenario.name).toBe(true);
      }
    } finally {
      await f.db.close();
    }
  });

  it('preserves Suno v6 behaviour on failed text model / failed free lyrics.draft: continues into paid inspire-mode run', async () => {
    const f = await studioFixture();
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const owner = viewerOf(f.ids.owner, 'ko');
      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const stub = geminiAnswers(new Error('gemini_http_503'), new Error('gemini_http_503'), new Error('gemini_http_503'));
      const deps = studioDeps(f.sql, {
        env: studioEnv({
          BRAND_STUDIO_PROVIDER: 'live',
          SUNRA_API_KEY: 'sk-test',
          BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
          BRAND_SOUND_STUDIO: 'on',
        }),
        provider,
        intelDeps: { fetch: stub.fetchStub, env: { GEMINI_API_KEY: 'test-key', BRAND_SOUND_LYRICS_MODEL: 'gemini-3.8-flash' } },
      });

      // Free `lyrics.draft` fails when the text model is down...
      const freeDraft = await runStudioOperation(deps, owner, 'lyrics.draft', {
        organizationId: f.orgId,
        topic: '상쾌한 봄 스킨케어 광고',
        language: 'ko',
      });
      expect(freeDraft).toEqual({ ok: false, code: 'provider_unavailable' });

      // ...yet sending a Suno v6 vocal run with blank lyrics continues into the paid inspire-mode run and succeeds!
      const created = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'suno-v6',
        prompt: '상쾌한 봄 스킨케어 광고',
        vocal: true,
      });
      if (!('job' in created)) throw new Error(JSON.stringify(created));
      await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });

      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]).toEqual({
        endpoint: 'suno/suno-v6/inspire-mode',
        body: {
          prompt: '상쾌한 봄 스킨케어 광고 Vocals sung in Korean.',
          instrumental: false,
        },
      });

      const row = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
      const outputs = (await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [created.job.id])).rows;
      expect(row.status).toBe('succeeded');
      expect(row.usage_krw).toBe(160);
      expect(outputs).toHaveLength(2);
      const view = jobView(row, outputs, deps.media);
      expect(view.lyricsDraftFailed).toBeUndefined();
    } finally {
      await f.db.close();
    }
  });
});

describe('5. MiniMax + careful refusal and Instrumental + lyrics rules across models', () => {
  it('refuses MiniMax + careful at create (even with BRAND_SOUND_MAX_MODE=on) and omits/clears lyrics on instrumentals', async () => {
    const f = await studioFixture();
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const deps = studioDeps(f.sql, {
        env: studioEnv({
          BRAND_STUDIO_PROVIDER: 'fake',
          BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
          BRAND_SOUND_STUDIO: 'on',
          BRAND_SOUND_MAX_MODE: 'on',
        }),
        provider,
      });
      const owner = viewerOf(f.ids.owner, 'ko');

      // MiniMax + careful -> refused at create (both instrumental and vocal)
      for (const vocal of [false, true]) {
        const res = await runStudioOperation(deps, owner, 'job.create', {
          kind: 'music',
          organizationId: f.orgId,
          requestId: requestId(),
          model: 'minimax-music-3',
          prompt: '차분한 로즈 피아노',
          vocal,
          ...(vocal ? { lyrics: '햇살 같은 하루' } : {}),
          careful: true,
        });
        expect(res).toEqual({ ok: false, code: 'invalid' });
      }
      expect((await f.sql.query('select 1 from brand_studio_jobs where organization_id = $1', [f.orgId])).rows).toHaveLength(0);

      // MiniMax instrumental + lyrics -> lyrics NOT sent in body ('lyrics' key absent)
      const mmInst = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '미니멀 피아노 솔로',
        vocal: false,
        lyrics: '절대 전송되면 안 되는 가사',
        architect: false,
      });
      if (!('job' in mmInst)) throw new Error(JSON.stringify(mmInst));
      await advanceStudioJobsWith(deps, { jobIds: [mmInst.job.id] });
      expect(provider.sent[0]).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: { prompt: '미니멀 피아노 솔로', duration: 60, is_instrumental: true },
      });
      expect('lyrics' in provider.sent[0]!.body).toBe(false);

      // Suno v6 instrumental + lyrics -> today's rules (inspire-mode without careful; custom-mode with empty '' lyrics when careful)
      const sunoInstDescribe = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'suno-v6',
        prompt: '미니멀 피아노 솔로',
        vocal: false,
        lyrics: '무시될 가사',
        architect: false,
      });
      if (!('job' in sunoInstDescribe)) throw new Error(JSON.stringify(sunoInstDescribe));
      await advanceStudioJobsWith(deps, { jobIds: [sunoInstDescribe.job.id] });
      expect(provider.sent[1]).toEqual({
        endpoint: 'suno/suno-v6/inspire-mode',
        body: { prompt: '미니멀 피아노 솔로', instrumental: true },
      });

      const sunoInstCareful = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'suno-v6',
        prompt: '미니멀 피아노 솔로',
        vocal: false,
        lyrics: '무시될 가사',
        careful: true,
        architect: false,
      });
      if (!('job' in sunoInstCareful)) throw new Error(JSON.stringify(sunoInstCareful));
      await advanceStudioJobsWith(deps, { jobIds: [sunoInstCareful.job.id] });
      expect(provider.sent[2]).toEqual({
        endpoint: 'suno/suno-v6/custom-mode',
        body: {
          title: '미니멀 피아노 솔로',
          style: '미니멀 피아노 솔로',
          lyrics: '',
          instrumental: true,
          max_mode: true,
        },
      });
    } finally {
      await f.db.close();
    }
  });
});

describe('6. Stored versions through fake provider: 1 WAV for MiniMax, 2 MP3s for Suno v6 and Wild', () => {
  it('stores 1 audio/wav output for MiniMax and 2 audio/mpeg outputs for Suno v6 and Suno v6 Wild', async () => {
    const f = await studioFixture();
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', f.orgId);
      const deps = studioDeps(f.sql, {
        env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
        provider: createFakeStudioProvider({ pollsBeforeDone: 1 }),
      });
      const owner = viewerOf(f.ids.owner, 'ko');

      const mm = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '차분한 네오소울',
        vocal: false,
        durationSeconds: 18,
        architect: false,
      });
      const s6 = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'suno-v6',
        prompt: '차분한 어쿠스틱',
        vocal: false,
        architect: false,
      });
      const wild = await createStudioJob(deps, owner, {
        kind: 'music',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'suno-v6-wild',
        prompt: '실험적인 일렉트로닉',
        vocal: false,
        architect: false,
      });
      if (!('job' in mm) || !('job' in s6) || !('job' in wild)) throw new Error('create failed');

      await advanceStudioJobsWith(deps, { jobIds: [mm.job.id, s6.job.id, wild.job.id] });

      const mmOutputs = (await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [mm.job.id])).rows;
      expect(mmOutputs).toHaveLength(1);
      expect(mmOutputs[0]!.mime).toBe('audio/wav');
      expect(mmOutputs[0]!.storage_key).toMatch(/^st\/[0-9a-f]{64}\.wav$/);
      expect(mmOutputs[0]!.duration_ms).toBe(18_000);
      const mmBytes = await deps.media.read(mmOutputs[0]!.storage_key!);
      expect(sniffMime(mmBytes)).toBe('audio/wav');
      expect(audioSeconds(mmBytes, 'audio/wav')).toBe(18);

      for (const sunoJobId of [s6.job.id, wild.job.id]) {
        const sunoOutputs = (await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [sunoJobId])).rows;
        expect(sunoOutputs).toHaveLength(2);
        expect(sunoOutputs.map((o) => o.idx)).toEqual([0, 1]);
        for (const out of sunoOutputs) {
          expect(out.status).toBe('ready');
          expect(out.mime).toBe('audio/mpeg');
          expect(out.storage_key).toMatch(/^st\/[0-9a-f]{64}\.mp3$/);
          const mp3Bytes = await deps.media.read(out.storage_key!);
          expect(sniffMime(mp3Bytes)).toBe('audio/mpeg');
        }
      }
    } finally {
      await f.db.close();
    }
  });
});
