import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { creditsOf, STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { sniffMime } from '@/lib/brand-studio/files';
import { STUDIO_MEDIA_KEY } from '@/lib/brand-studio/media-store';
import { synthesizePreviewMusicWav } from '@/lib/brand-studio/music/synth';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import { createSunraStudioProvider } from '@/lib/brand-studio/provider/sunra-api';
import { audioSeconds } from '@/lib/brand-studio/sound/audio-info';
import {
  DEFAULT_MUSIC_ENGINE,
  MUSIC_ENGINES,
  musicEngine,
  musicEngineOfModel,
  type MusicEngine,
  type MusicModelId,
} from '@/lib/brand-studio/sound/engine';
import { minimaxMusic3Sunra } from '@/lib/brand-studio/sound/engines/minimax-sunra';
import { makeSunoEngine, MusicRequestError, sunoV6Sunra, sunoV6WildSunra } from '@/lib/brand-studio/sound/engines/suno-sunra';
import { planMusic, type MusicJobCreate } from '@/lib/brand-studio/sound/music-jobs';
import { musicQuoteCredits, musicQuoteForModel, musicQuoteKrw } from '@/lib/brand-studio/sound/music-limits';
import type { JobRow, OutputRow, StudioDeps } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { parseSunraQueueResult, type SunraClient } from '@/lib/sunra/client';
import { requestId, studioDeps, studioFixture } from '../server/helpers';

/**
 * Mirrors the exact OpenAPI 3.0 request schemas:
 *  - oapi-suno_suno-v6.json / oapi-suno_suno-v6-wild.json: V6InspireModeInput, V6CustomModeInput
 *  - oapi-minimax_minimax-music3.json: TextToMusicInput
 */
const V6InspireModeInputSchema = z
  .object({
    prompt: z.string().min(1).max(3000),
    instrumental: z.boolean().optional(),
  })
  .strict();

const V6CustomModeInputSchema = z
  .object({
    title: z.string().min(1).max(80),
    lyrics: z.string().max(5000).optional(),
    style: z.string().min(1).max(1000),
    instrumental: z.boolean().optional(),
    max_mode: z.boolean().optional(),
  })
  .strict();

const MinimaxTextToMusicInputSchema = z
  .object({
    prompt: z.string().min(1).max(2000).regex(/\S/),
    lyrics: z.string().min(1).max(3500).regex(/\S/).optional(),
    duration: z.number().int().min(1).max(75),
    is_instrumental: z.boolean(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.is_instrumental && val.lyrics !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'instrumental must omit lyrics' });
    }
    if (!val.is_instrumental && val.lyrics === undefined) {
      ctx.addIssue({ code: 'custom', message: 'vocal requires non-empty lyrics' });
    }
  });

async function seedMusicJob(
  deps: StudioDeps,
  orgId: string,
  userId: string,
  spec: {
    engine: MusicEngine;
    prompt: string;
    vocal: boolean;
    lyrics?: string;
    careful?: boolean;
  },
): Promise<{ jobId: string; estimateKrw: number; estimateUsd: number }> {
  const input: Omit<MusicJobCreate, 'architect'> & { architect: boolean } = {
    kind: 'music',
    organizationId: orgId,
    requestId: requestId(),
    prompt: spec.prompt,
    vocal: spec.vocal,
    ...(spec.lyrics !== undefined ? { lyrics: spec.lyrics } : {}),
    ...(spec.careful !== undefined ? { careful: spec.careful } : {}),
    architect: false,
  };
  const plan = planMusic(input, 'ko', spec.engine);
  const job = (
    await deps.sql.query<JobRow>(
      `insert into brand_studio_jobs (
          organization_id, created_by, request_id, kind, status, lane, model,
          prompt, final_prompt, enhance, params, refs, parent_output_id,
          estimate_usd, estimate_krw, work
        )
        values ($1, $2, $3, 'music', 'queued', 'sunra_api', $4, $5, $6, false, $7::jsonb, '[]'::jsonb, null, $8, $9, $10::jsonb)
        returning *`,
      [
        orgId,
        userId,
        input.requestId,
        plan.engine.model.id,
        input.prompt,
        plan.request.prompt,
        JSON.stringify(plan.params),
        plan.estimateUsd,
        plan.estimateKrw,
        JSON.stringify({ prepared: true }),
      ],
    )
  ).rows[0]!;
  await deps.sql.query(
    `insert into brand_studio_outputs (job_id, organization_id, idx, kind) values ($1, $2, 0, 'audio')`,
    [job.id, orgId],
  );
  return { jobId: job.id, estimateKrw: plan.estimateKrw, estimateUsd: plan.estimateUsd };
}

describe('Batch B1: registry, DEFAULT_MUSIC_ENGINE, and closed-path env isolation (Trap N5)', () => {
  it('registers suno-v6-sunra, suno-v6-wild-sunra, and minimax-music3-sunra in order with suno-v6-sunra as default', () => {
    expect(Object.keys(MUSIC_ENGINES)).toEqual(['suno-v6-sunra', 'suno-v6-wild-sunra', 'minimax-music3-sunra']);
    expect(DEFAULT_MUSIC_ENGINE).toBe('suno-v6-sunra');
    expect(musicEngineOfModel('suno-v6')).toBe(sunoV6Sunra);
    expect(musicEngineOfModel('suno-v6-wild')).toBe(sunoV6WildSunra);
    expect(musicEngineOfModel('minimax-music-3')).toBe(minimaxMusic3Sunra);
    expect(musicEngineOfModel('unknown-model')).toBeNull();

    for (const engine of Object.values(MUSIC_ENGINES)) {
      expect(engine.model.mcp).toBeNull();
    }
    expect(sunoV6Sunra.capabilities).toEqual({
      lengthInput: false,
      vocals: true,
      lyrics: true,
      careful: true,
      extend: false,
      inpaint: false,
      stems: false,
      limits: { prompt: 3000, style: 1000, title: 80, lyrics: 5000 },
    });
    expect(sunoV6WildSunra.capabilities).toEqual(sunoV6Sunra.capabilities);
    expect(minimaxMusic3Sunra.capabilities).toEqual({
      lengthInput: { min: 1, max: 75 },
      vocals: true,
      lyrics: true,
      careful: false,
      extend: false,
      inpaint: false,
      stems: false,
      limits: { prompt: 2000, style: 2000, title: 80, lyrics: 3500 },
    });
  });

  it('keeps musicEngine(env) pinned to Suno v6 even when BRAND_SOUND_MUSIC_ENGINE names a v2 engine or model (Trap N5)', () => {
    for (const value of [
      undefined,
      '',
      '   ',
      'suno-v6-sunra',
      'suno-v6-wild-sunra',
      'minimax-music3-sunra',
      'suno-v6-wild',
      'minimax-music-3',
      '__proto__',
      'constructor',
      'unknown',
    ]) {
      expect(musicEngine({ BRAND_SOUND_MUSIC_ENGINE: value }), String(value)).toBe(sunoV6Sunra);
    }
  });
});

describe('Batch B1: exact OpenAPI request shapes for Suno v6, Suno v6 Wild, and MiniMax Music 3.0', () => {
  it('builds identical inspire-mode and custom-mode bodies for Suno v6 and Suno v6 Wild under their own endpoint aliases', () => {
    const customClone = makeSunoEngine('suno-v6-sunra', 'suno-v6', 'suno/suno-v6');
    expect(customClone.id).toBe(sunoV6Sunra.id);
    expect(customClone.model).toEqual(sunoV6Sunra.model);
    expect(customClone.capabilities).toEqual(sunoV6Sunra.capabilities);

    const inspireInst = { mode: 'describe' as const, prompt: '  Warm acoustic guitar, slow brush drums  ', vocal: false };
    const inspireVocal = { mode: 'describe' as const, prompt: 'Bright indie pop vocals in Korean', vocal: true };
    const customVocal = {
      mode: 'custom' as const,
      title: '  Morning Light  ',
      prompt: '  Warm city pop, Rhodes piano, 112 BPM  ',
      lyrics: ' [Verse]\n햇살 같은 하루\n[Chorus]\n같이 걸어요 ',
      vocal: true,
      careful: false,
    };
    const customCarefulInst = {
      mode: 'custom' as const,
      title: 'Steady Instrumental',
      prompt: 'Minimal ambient synth pads',
      lyrics: 'ignored when instrumental',
      vocal: false,
      careful: true,
    };

    const v6InspireInst = sunoV6Sunra.request(inspireInst);
    const wildInspireInst = sunoV6WildSunra.request(inspireInst);
    expect(v6InspireInst).toEqual({
      endpoint: 'suno/suno-v6/inspire-mode',
      body: { prompt: 'Warm acoustic guitar, slow brush drums', instrumental: true },
    });
    expect(wildInspireInst).toEqual({
      endpoint: 'suno/suno-v6-wild/inspire-mode',
      body: v6InspireInst.body,
    });
    expect(() => V6InspireModeInputSchema.parse(v6InspireInst.body)).not.toThrow();
    expect(() => V6InspireModeInputSchema.parse(wildInspireInst.body)).not.toThrow();

    const v6InspireVocal = sunoV6Sunra.request(inspireVocal);
    const wildInspireVocal = sunoV6WildSunra.request(inspireVocal);
    expect(v6InspireVocal).toEqual({
      endpoint: 'suno/suno-v6/inspire-mode',
      body: { prompt: 'Bright indie pop vocals in Korean', instrumental: false },
    });
    expect(wildInspireVocal).toEqual({
      endpoint: 'suno/suno-v6-wild/inspire-mode',
      body: v6InspireVocal.body,
    });

    const v6CustomVocal = sunoV6Sunra.request(customVocal);
    const wildCustomVocal = sunoV6WildSunra.request(customVocal);
    expect(v6CustomVocal).toEqual({
      endpoint: 'suno/suno-v6/custom-mode',
      body: {
        title: 'Morning Light',
        style: 'Warm city pop, Rhodes piano, 112 BPM',
        lyrics: ' [Verse]\n햇살 같은 하루\n[Chorus]\n같이 걸어요 ',
        instrumental: false,
        max_mode: false,
      },
    });
    expect(wildCustomVocal).toEqual({
      endpoint: 'suno/suno-v6-wild/custom-mode',
      body: v6CustomVocal.body,
    });
    expect(() => V6CustomModeInputSchema.parse(v6CustomVocal.body)).not.toThrow();
    expect(() => V6CustomModeInputSchema.parse(wildCustomVocal.body)).not.toThrow();

    const v6CustomCarefulInst = sunoV6Sunra.request(customCarefulInst);
    const wildCustomCarefulInst = sunoV6WildSunra.request(customCarefulInst);
    expect(v6CustomCarefulInst).toEqual({
      endpoint: 'suno/suno-v6/custom-mode',
      body: {
        title: 'Steady Instrumental',
        style: 'Minimal ambient synth pads',
        lyrics: '',
        instrumental: true,
        max_mode: true,
      },
    });
    expect(wildCustomCarefulInst).toEqual({
      endpoint: 'suno/suno-v6-wild/custom-mode',
      body: v6CustomCarefulInst.body,
    });
  });

  it('builds exact MiniMax text-to-music bodies (omits lyrics when instrumental, includes lyrics when vocal, clamps duration 1..75 default 60)', () => {
    const instDefault = minimaxMusic3Sunra.request({
      mode: 'describe',
      prompt: '  Global Metadata: warm neo-soul.\nVocal Details: Instrumental Rhodes lead.\nArrangement: Intro, main, outro.  ',
      vocal: false,
      lyrics: 'discarded when instrumental',
    });
    expect(instDefault).toEqual({
      endpoint: 'minimax/minimax-music3/text-to-music',
      body: {
        prompt: 'Global Metadata: warm neo-soul.\nVocal Details: Instrumental Rhodes lead.\nArrangement: Intro, main, outro.',
        duration: 60,
        is_instrumental: true,
      },
    });
    expect('lyrics' in instDefault.body).toBe(false);
    expect(Object.keys(instDefault.body).sort()).toEqual(['duration', 'is_instrumental', 'prompt']);
    expect(() => MinimaxTextToMusicInputSchema.parse(instDefault.body)).not.toThrow();

    const vocalCustom = minimaxMusic3Sunra.request({
      mode: 'custom',
      title: 'Ignored API Title',
      prompt: 'Global Metadata: bright indie pop.\nVocal Details: Clear vocals singing in Korean.\nArrangement: Verse, Chorus.',
      lyrics: ' [Verse]\n아침 햇살이 번지면\n[Chorus]\n우리 함께 걸어요 ',
      vocal: true,
      durationSeconds: 30,
    });
    expect(vocalCustom).toEqual({
      endpoint: 'minimax/minimax-music3/text-to-music',
      body: {
        prompt: 'Global Metadata: bright indie pop.\nVocal Details: Clear vocals singing in Korean.\nArrangement: Verse, Chorus.',
        lyrics: ' [Verse]\n아침 햇살이 번지면\n[Chorus]\n우리 함께 걸어요 ',
        duration: 30,
        is_instrumental: false,
      },
    });
    expect(Object.keys(vocalCustom.body).sort()).toEqual(['duration', 'is_instrumental', 'lyrics', 'prompt']);
    expect(() => MinimaxTextToMusicInputSchema.parse(vocalCustom.body)).not.toThrow();

    for (const [given, clamped] of [
      [undefined, 60],
      [-12, 1],
      [0, 1],
      [1, 1],
      [14.4, 14],
      [14.6, 15],
      [75, 75],
      [90, 75],
      [240, 75],
    ] as const) {
      const built = minimaxMusic3Sunra.request({
        mode: 'describe',
        prompt: 'Ambient synth pad',
        vocal: false,
        durationSeconds: given,
      });
      expect(built.body.duration, `given=${String(given)}`).toBe(clamped);
      expect(Number.isInteger(built.body.duration)).toBe(true);
      expect(() => MinimaxTextToMusicInputSchema.parse(built.body)).not.toThrow();
    }
  });

  it('throws MusicRequestError on MiniMax blank vocal lyrics, careful, lyrics > 3500, prompt > 2000, empty prompt, or non-finite duration', () => {
    for (const blank of [undefined, '', '   ', '\n\t  \r\n']) {
      expect(
        () => minimaxMusic3Sunra.request({ mode: 'custom', prompt: 'Indie pop', vocal: true, lyrics: blank }),
        `blank=${JSON.stringify(blank)}`,
      ).toThrow(MusicRequestError);
    }

    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'describe', prompt: 'Indie pop', vocal: false, careful: true }),
    ).toThrow(MusicRequestError);
    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'custom', prompt: 'Indie pop', vocal: true, lyrics: '[Verse]\nHello', careful: true }),
    ).toThrow(MusicRequestError);

    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'custom', prompt: 'Indie pop', vocal: true, lyrics: 'a'.repeat(3500) }),
    ).not.toThrow();
    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'custom', prompt: 'Indie pop', vocal: true, lyrics: 'a'.repeat(3501) }),
    ).toThrow(MusicRequestError);

    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'describe', prompt: 'p'.repeat(2000), vocal: false }),
    ).not.toThrow();
    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'describe', prompt: 'p'.repeat(2001), vocal: false }),
    ).toThrow(MusicRequestError);

    expect(() => minimaxMusic3Sunra.request({ mode: 'describe', prompt: '   ', vocal: false })).toThrow(MusicRequestError);
    expect(() =>
      minimaxMusic3Sunra.request({ mode: 'describe', prompt: 'Indie pop', vocal: false, durationSeconds: Number.NaN }),
    ).toThrow(MusicRequestError);
  });
});

describe('Batch B1: money quotes (16 / 32 / 16 / 32 / 26) and planMusic parity', () => {
  it('quotes 16/32/16/32/26 credits via musicQuoteForModel, ignores request fields on MiniMax quoteUsd, and throws on unknown model', () => {
    const cases: Array<{ model: MusicModelId; mode: 'describe' | 'custom'; careful?: boolean; krw: number; credits: number }> = [
      { model: 'suno-v6', mode: 'describe', krw: 160, credits: 16 },
      { model: 'suno-v6', mode: 'custom', careful: true, krw: 320, credits: 32 },
      { model: 'suno-v6-wild', mode: 'describe', krw: 160, credits: 16 },
      { model: 'suno-v6-wild', mode: 'custom', careful: true, krw: 320, credits: 32 },
      { model: 'minimax-music-3', mode: 'describe', krw: 260, credits: 26 },
    ];

    expect(cases.map((c) => creditsOf(musicQuoteForModel(c.model, { mode: c.mode, careful: c.careful })))).toEqual([
      16,
      32,
      16,
      32,
      26,
    ]);
    expect(cases.map((c) => musicQuoteForModel(c.model, { mode: c.mode, careful: c.careful }))).toEqual([
      16 * STUDIO_CREDIT_KRW,
      32 * STUDIO_CREDIT_KRW,
      16 * STUDIO_CREDIT_KRW,
      32 * STUDIO_CREDIT_KRW,
      26 * STUDIO_CREDIT_KRW,
    ]);

    // MiniMax quoteUsd ignores request fields (including empty prompt, careful, durationSeconds).
    for (const req of [
      { mode: 'describe' as const, prompt: '', vocal: false },
      { mode: 'custom' as const, prompt: 'x', vocal: true, lyrics: 'y', careful: true, durationSeconds: 5 },
      { mode: 'describe' as const, prompt: 'x', vocal: false, durationSeconds: 75 },
    ]) {
      expect(minimaxMusic3Sunra.quoteUsd(req)).toBe(0.16);
    }

    // Existing signatures and defaults stay untouched.
    expect(musicQuoteKrw({ mode: 'describe' })).toBe(160);
    expect(musicQuoteKrw({ mode: 'custom', careful: true })).toBe(320);
    expect(musicQuoteCredits({ mode: 'describe' })).toBe(16);
    expect(musicQuoteCredits({ mode: 'custom', careful: true })).toBe(32);

    expect(() => musicQuoteForModel('unknown-model' as MusicModelId, { mode: 'describe' })).toThrow(/unknown music model/);
  });

  it('matches planMusic(input, "ko", engine).estimateKrw to musicQuoteForModel across all three engines', () => {
    const orgId = '00000000-0000-4000-8000-0000000000a0';
    const base = { kind: 'music' as const, organizationId: orgId, requestId: 'req_plan_parity_001', architect: false };

    const sunoNormal = planMusic({ ...base, prompt: '차분한 어쿠스틱 기타', vocal: false }, 'ko', sunoV6Sunra);
    const sunoCareful = planMusic(
      { ...base, prompt: '밝은 팝', vocal: true, lyrics: '햇살 같은 하루', careful: true },
      'ko',
      sunoV6Sunra,
    );
    const wildNormal = planMusic({ ...base, prompt: '실험적인 신스 팝', vocal: false }, 'ko', sunoV6WildSunra);
    const wildCareful = planMusic(
      { ...base, prompt: '실험적인 록', vocal: true, lyrics: '밤하늘을 건너', careful: true },
      'ko',
      sunoV6WildSunra,
    );
    const minimaxInst = planMusic({ ...base, prompt: '따뜻한 로즈 피아노 배경음', vocal: false }, 'ko', minimaxMusic3Sunra);
    const minimaxVocal = planMusic(
      { ...base, prompt: '상쾌한 브랜드 송', vocal: true, lyrics: '맑은 아침을 열어요' },
      'ko',
      minimaxMusic3Sunra,
    );

    expect(sunoNormal.estimateKrw).toBe(musicQuoteForModel('suno-v6', { mode: 'describe' }));
    expect(sunoCareful.estimateKrw).toBe(musicQuoteForModel('suno-v6', { mode: 'custom', careful: true }));
    expect(wildNormal.estimateKrw).toBe(musicQuoteForModel('suno-v6-wild', { mode: 'describe' }));
    expect(wildCareful.estimateKrw).toBe(musicQuoteForModel('suno-v6-wild', { mode: 'custom', careful: true }));
    expect(minimaxInst.estimateKrw).toBe(musicQuoteForModel('minimax-music-3', { mode: 'describe' }));
    expect(minimaxVocal.estimateKrw).toBe(musicQuoteForModel('minimax-music-3', { mode: 'custom', careful: false }));
    expect([
      sunoNormal.estimateKrw,
      sunoCareful.estimateKrw,
      wildNormal.estimateKrw,
      wildCareful.estimateKrw,
      minimaxInst.estimateKrw,
      minimaxVocal.estimateKrw,
    ]).toEqual([160, 320, 160, 320, 260, 260]);
  });
});

describe('Batch B1: seeded job rows through fake provider + finishJob (settlement, WAV storage, failure = 0)', () => {
  it('settles usage_krw = quote across Suno v6, Suno v6 Wild, and MiniMax Music 3.0, and stores one st/<hex>.wav with seconds measured from bytes', async () => {
    const f = await studioFixture();
    try {
      const deps = studioDeps(f.sql, {
        provider: createFakeStudioProvider({ pollsBeforeDone: 1 }),
      });

      const sunoSeed = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: sunoV6Sunra,
        prompt: '차분한 어쿠스틱 기타',
        vocal: false,
      });
      const wildCarefulSeed = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: sunoV6WildSunra,
        prompt: '강렬한 인디 록',
        vocal: true,
        lyrics: '달려가는 밤',
        careful: true,
      });
      const minimaxSeed = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: minimaxMusic3Sunra,
        prompt: '따뜻한 네오소울 로즈 피아노',
        vocal: false,
      });

      await advanceStudioJobsWith(deps, {
        jobIds: [sunoSeed.jobId, wildCarefulSeed.jobId, minimaxSeed.jobId],
      });

      const jobs = (
        await f.sql.query<{ id: string; model: string; status: string; estimate_krw: number; usage_krw: number; cost_usd: string | number }>(
          'select id, model, status, estimate_krw, usage_krw, cost_usd from brand_studio_jobs where id = any($1::uuid[])',
          [[sunoSeed.jobId, wildCarefulSeed.jobId, minimaxSeed.jobId]],
        )
      ).rows;
      const byId = new Map(jobs.map((j) => [j.id, { ...j, cost_usd: Number(j.cost_usd) }]));

      expect(byId.get(sunoSeed.jobId)).toMatchObject({
        model: 'suno-v6',
        status: 'succeeded',
        estimate_krw: 160,
        usage_krw: 160,
        cost_usd: 0.1,
      });
      expect(byId.get(wildCarefulSeed.jobId)).toMatchObject({
        model: 'suno-v6-wild',
        status: 'succeeded',
        estimate_krw: 320,
        usage_krw: 320,
        cost_usd: 0.2,
      });
      expect(byId.get(minimaxSeed.jobId)).toMatchObject({
        model: 'minimax-music-3',
        status: 'succeeded',
        estimate_krw: 260,
        usage_krw: 260,
        cost_usd: 0.16,
      });

      const wildOutputs = (
        await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [wildCarefulSeed.jobId])
      ).rows;
      expect(wildOutputs).toHaveLength(2);
      expect(wildOutputs.every((o) => o.status === 'ready' && o.mime === 'audio/mpeg' && /\.mp3$/.test(o.storage_key ?? ''))).toBe(true);

      const minimaxOutputs = (
        await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [minimaxSeed.jobId])
      ).rows;
      expect(minimaxOutputs).toHaveLength(1);
      const wavOut = minimaxOutputs[0]!;
      expect(wavOut.status).toBe('ready');
      expect(wavOut.mime).toBe('audio/wav');
      expect(wavOut.storage_key).toMatch(STUDIO_MEDIA_KEY);
      expect(wavOut.storage_key).toMatch(/^st\/[0-9a-f]{64}\.wav$/);

      const storedBytes = await deps.media.read(wavOut.storage_key!);
      expect(sniffMime(storedBytes)).toBe('audio/wav');
      const measuredSeconds = audioSeconds(storedBytes, 'audio/wav');
      expect(measuredSeconds).toBe(60);
      expect(wavOut.duration_ms).toBe(Math.round(measuredSeconds! * 1000));

      const allowanceAfter = await loadAllowance(f.sql, f.orgId, deps.env);
      expect(allowanceAfter.usedKrw).toBe(160 + 320 + 260);
    } finally {
      await f.db.close();
    }
  });

  it('settles usage_krw = 0 and releases reserved allowance on [[fake:fail]], [[fake:reject]], and [[fake:none]] across prompt and lyrics', async () => {
    const f = await studioFixture();
    try {
      const deps = studioDeps(f.sql, {
        provider: createFakeStudioProvider({ pollsBeforeDone: 1 }),
      });

      const failPrompt = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: minimaxMusic3Sunra,
        prompt: '따뜻한 피아노 [[fake:fail]]',
        vocal: false,
      });
      const failLyrics = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: minimaxMusic3Sunra,
        prompt: '밝은 브랜드 송',
        vocal: true,
        lyrics: '햇살 같은 하루 [[fake:reject]]',
      });
      const noneMiniMax = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: minimaxMusic3Sunra,
        prompt: '신스 패드 [[fake:none]]',
        vocal: false,
      });
      const failWild = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: sunoV6WildSunra,
        prompt: '실험적 사운드 [[fake:fail]]',
        vocal: false,
      });

      // While queued, reservations count against usedKrw.
      expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(260 * 3 + 160);

      await advanceStudioJobsWith(deps, {
        jobIds: [failPrompt.jobId, failLyrics.jobId, noneMiniMax.jobId, failWild.jobId],
      });

      const rows = (
        await f.sql.query<{ id: string; status: string; error_code: string | null; usage_krw: number }>(
          'select id, status, error_code, usage_krw from brand_studio_jobs where id = any($1::uuid[])',
          [[failPrompt.jobId, failLyrics.jobId, noneMiniMax.jobId, failWild.jobId]],
        )
      ).rows;
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.status).toBe('failed');
        expect(row.usage_krw).toBe(0);
      }
      expect(rows.find((r) => r.id === failLyrics.jobId)?.error_code).toBe('provider_rejected');

      // Settled failures count for 0 against the monthly allowance.
      expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(0);
    } finally {
      await f.db.close();
    }
  });
});

describe('Batch B1: parseSunraQueueResult parity and WAV byte re-sniffing when content_type is absent', () => {
  it('keeps image, video, Suno clips[], and MiniMax MusicOutput parseSunraQueueResult outputs intact', () => {
    expect(
      parseSunraQueueResult({
        images: [{ url: 'https://cdn.example.test/a.png', content_type: 'image/png' }],
        units: 40,
      }),
    ).toEqual({
      files: [{ url: 'https://cdn.example.test/a.png', contentType: 'image/png' }],
      draftTaskId: null,
      units: 40,
      durationSeconds: null,
    });

    expect(
      parseSunraQueueResult({
        video: { url: 'https://cdn.example.test/v.mp4', content_type: 'video/mp4', draft_task_id: 'draft_1' },
        duration: 5,
        billing: { amount: 0.45, currency: 'USD' },
      }),
    ).toEqual({
      files: [{ url: 'https://cdn.example.test/v.mp4', contentType: 'video/mp4' }],
      draftTaskId: 'draft_1',
      units: null,
      durationSeconds: 5,
      billingUsd: 0.45,
    });

    expect(
      parseSunraQueueResult({
        clips: [
          { task_id: 't1', clip_id: 'c1', title: 'Song A', audio_url: 'https://cdn.example.test/1.mp3', duration: null },
          { task_id: 't1', clip_id: 'c2', title: 'Song B', audio_url: 'https://cdn.example.test/2.mp3', duration: null },
        ],
      }),
    ).toEqual({
      files: [
        { url: 'https://cdn.example.test/1.mp3', contentType: 'audio/mpeg' },
        { url: 'https://cdn.example.test/2.mp3', contentType: 'audio/mpeg' },
      ],
      clips: [
        { url: 'https://cdn.example.test/1.mp3', seconds: null, meta: { taskId: 't1', clipId: 'c1', title: 'Song A' } },
        { url: 'https://cdn.example.test/2.mp3', seconds: null, meta: { taskId: 't1', clipId: 'c2', title: 'Song B' } },
      ],
      draftTaskId: null,
      units: null,
      durationSeconds: null,
    });

    expect(
      parseSunraQueueResult({
        audio: {
          url: 'https://cdn.example.test/out.wav',
          content_type: 'audio/wav',
          file_name: 'out.wav',
          file_size: 480_044,
        },
        output_audio_duration: 10,
        billing: { amount: 0.16, currency: 'USD' },
      }),
    ).toEqual({
      files: [{ url: 'https://cdn.example.test/out.wav', contentType: 'audio/wav' }],
      draftTaskId: null,
      units: null,
      durationSeconds: null,
      billingUsd: 0.16,
    });
  });

  it('re-sniffs WAV bytes in finishJob even if result.audio omitted content_type and fell back to audio/mpeg', async () => {
    const f = await studioFixture();
    try {
      const wav = synthesizePreviewMusicWav({ bpm: 120, keySignature: 'Dm', durationSec: 6 }).bytes;
      const client: SunraClient = {
        async submit() {
          return { id: 'sunra_req_minimax_1' };
        },
        async getTask() {
          throw new Error('unused');
        },
        async queueStatus() {
          return { status: 'COMPLETED', success: true, error: null, billingUsd: 0.16 };
        },
        async queueResult() {
          // Simulate result.audio missing content_type -> parseSunraQueueResult falls back to 'audio/mpeg'.
          return parseSunraQueueResult({ audio: { url: 'https://cdn.sunra.ai/minimax-out.wav' } });
        },
      };
      const baseProvider = createSunraStudioProvider({ apiKey: 'test', baseUrl: 'https://api.sunra.ai' }, { client });
      const deps = studioDeps(f.sql, {
        provider: {
          ...baseProvider,
          async download() {
            return { bytes: wav, mime: 'audio/mpeg' };
          },
        },
      });

      const seeded = await seedMusicJob(deps, f.orgId, f.ids.owner, {
        engine: minimaxMusic3Sunra,
        prompt: '차분한 앰비언트 피아노',
        vocal: false,
      });
      await advanceStudioJobsWith(deps, { jobIds: [seeded.jobId] });

      const out = (await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1', [seeded.jobId])).rows[0]!;
      expect(out.status).toBe('ready');
      expect(out.mime).toBe('audio/wav');
      expect(out.storage_key).toMatch(/^st\/[0-9a-f]{64}\.wav$/);
      expect(out.duration_ms).toBe(6000);
    } finally {
      await f.db.close();
    }
  });
});
