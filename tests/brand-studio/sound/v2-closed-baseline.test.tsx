import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundStudio, soundMusicCreateInput, type SoundStudioProps } from '@/components/brand-studio/sound/sound-studio';
import type { ComposerInput } from '@/components/brand-studio/sound/composer';
import { STUDIO_LIMITS, type StudioJobView } from '@/lib/brand-studio/contracts';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { studioEnv } from '@/lib/brand-studio/env';
import { buildStudioRequest } from '@/lib/brand-studio/provider/requests';
import { sunoV6Sunra } from '@/lib/brand-studio/sound/engines/suno-sunra';
import type { SoundTrackView } from '@/lib/brand-studio/sound/library';
import { defaultStructure, musicWay, ownLyrics } from '@/lib/brand-studio/sound/lyrics';
import { createMusicJob, MusicJobCreateSchema, planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { musicQuoteCredits } from '@/lib/brand-studio/sound/music-limits';
import { billingPlanCatalogue } from '@/lib/brands/billing-page-data';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioSoundEn, studioSoundKo } from '@/messages/studio-sound';
import { studioDeps, studioFixture, viewerOf } from '../server/helpers';
import { allowance } from '../ui/fixtures';

/**
 * Batch B0 closed-path baseline: freezes today's Sound Studio behaviour for closed organizations
 * (`BRAND_SOUND_COMPOSER_V2_ORGS` unset or listing another organization) across SSR markup,
 * `studioSound` dictionary hashes/keys, `job.create` wire inputs + Zod parses, Suno v6 request
 * bodies, credit quotes, PGlite `brand_studio_jobs` row columns/params keys, and page props.
 */
const ROOT = process.cwd();
const FIXED_ORG = '00000000-0000-4000-8000-0000000000a0';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b1';
const FIXED_REQ_ID = 'req_b0_baseline_0001';
const FIXED_ASSET_ID = '00000000-0000-4000-8000-000000003001';
const FIXED_VIDEO_ID = '00000000-0000-4000-8000-000000003002';
const FIXED_JOB_RUNNING = '00000000-0000-4000-8000-000000002001';
const FIXED_JOB_DONE = '00000000-0000-4000-8000-000000002002';
const FIXED_JOB_FAILED = '00000000-0000-4000-8000-000000002003';
const FIXED_OUT_A = '00000000-0000-4000-8000-000000001001';
const FIXED_OUT_B = '00000000-0000-4000-8000-000000001002';
const FIXED_NOW = new Date('2026-11-28T00:00:00.000Z');

const pageMocks = vi.hoisted(() => ({
  studioRouteContext: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/components/brand-studio/route-context', () => ({
  studioRouteContext: pageMocks.studioRouteContext,
}));

const snap = (name: string) => `./__snapshots__/v2-closed-baseline/${name}.html`;
const sha256Json = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const FIXED_PEAKS = Array.from({ length: 16 }, (_, i) => Number((((i % 5) + 1) * 0.15).toFixed(2)));

const FIXED_UPLOAD_TRACK: SoundTrackView = {
  key: `a:${FIXED_ASSET_ID}`,
  assetId: FIXED_ASSET_ID,
  tab: 'music',
  name: 'Spring theme.mp3',
  displayName: 'Spring theme',
  seconds: 31.2,
  streamUrl: `/api/brand-studio/compose?organizationId=${FIXED_ORG}&source=asset&id=${FIXED_ASSET_ID}`,
  liked: false,
  source: 'upload',
  createdAt: '2026-11-20T01:00:00.000Z',
  waveform: FIXED_PEAKS,
};

const FIXED_RUNNING_JOB = {
  id: FIXED_JOB_RUNNING,
  kind: 'music',
  status: 'running',
  model: 'suno-v6',
  prompt: '차분한 피아노 곡',
  finalPrompt: null,
  music: { title: '차분한 피아노 곡', vocal: false, mode: 'describe', careful: false, lyrics: null },
  expected: 1,
  aspect: null,
  resolution: null,
  seconds: null,
  audio: null,
  references: [],
  parentOutputId: null,
  parentAssetId: null,
  box: null,
  method: null,
  keep: [],
  change: null,
  outputs: [],
  estimateKrw: 160,
  errorCode: null,
  createdAt: '2026-11-20T03:00:00.000Z',
  finishedAt: null,
} as unknown as StudioJobView;

const FIXED_DONE_JOB = {
  id: FIXED_JOB_DONE,
  kind: 'music',
  status: 'succeeded',
  model: 'suno-v6',
  prompt: '잔잔한 어쿠스틱 기타, 느린 템포',
  finalPrompt: 'Warm fingerpicked acoustic guitar at a gentle slow tempo.',
  music: { title: '잔잔한 어쿠스틱 기타', vocal: false, mode: 'describe', careful: false, lyrics: null },
  expected: 1,
  aspect: null,
  resolution: null,
  seconds: null,
  audio: null,
  references: [],
  parentOutputId: null,
  parentAssetId: null,
  box: null,
  method: null,
  keep: [],
  change: null,
  outputs: [
    {
      id: FIXED_OUT_A,
      jobId: FIXED_JOB_DONE,
      kind: 'audio',
      url: '/media/out-a.mp3',
      thumbUrl: null,
      width: null,
      height: null,
      seconds: 124,
      draft: false,
      savedAssetId: null,
      waveform: FIXED_PEAKS,
      createdAt: '2026-11-20T02:00:00.000Z',
    },
    {
      id: FIXED_OUT_B,
      jobId: FIXED_JOB_DONE,
      kind: 'audio',
      url: '/media/out-b.mp3',
      thumbUrl: null,
      width: null,
      height: null,
      seconds: 118,
      draft: false,
      savedAssetId: null,
      waveform: null,
      createdAt: '2026-11-20T02:00:00.000Z',
    },
  ],
  estimateKrw: 160,
  errorCode: null,
  createdAt: '2026-11-20T02:00:00.000Z',
  finishedAt: '2026-11-20T02:01:00.000Z',
} as unknown as StudioJobView;

const FIXED_FAILED_JOB = {
  ...FIXED_RUNNING_JOB,
  id: FIXED_JOB_FAILED,
  status: 'failed',
  prompt: '거절된 설명 예시',
  music: { title: '거절된 설명 예시', vocal: false, mode: 'describe', careful: false, lyrics: null },
  errorCode: 'provider_rejected',
  createdAt: '2026-11-20T01:30:00.000Z',
} as unknown as StudioJobView;

function studioProps(locale: 'ko' | 'en', overrides: Partial<SoundStudioProps> = {}): SoundStudioProps {
  const dict = getDictionary(locale);
  return {
    organizationId: FIXED_ORG,
    organizationName: 'Fixture brand',
    locale,
    copy: dict.studioSound,
    billingCopy: dict.brandBilling.customer,
    planCatalogue: billingPlanCatalogue(),
    initialTab: 'music',
    creditsCopy: dict.brandStudio.credits,
    initialTracks: [FIXED_UPLOAD_TRACK],
    initialJobs: [],
    initialVideos: [{ assetId: FIXED_VIDEO_ID, name: 'Spring launch film.mp4', seconds: 15 }],
    initialAllowance: allowance({ capKrw: 300_000, usedKrw: 12_400, resetsAt: '2026-11-30T15:00:00Z' }),
    maxMode: false,
    canCreate: true,
    audioMaxMb: Math.round(STUDIO_LIMITS.audioBytesMax / 1_000_000),
    hrefs: {
      page: `/brand/studio/sound?organizationId=${FIXED_ORG}`,
      compose: `/brand/studio/compose?organizationId=${FIXED_ORG}`,
      video: `/brand/studio/video?organizationId=${FIXED_ORG}`,
    },
    ...overrides,
  };
}

/**
 * Mirrors `MusicComposer.create` (`components/brand-studio/sound/composer.tsx`) feeding
 * `soundMusicCreateInput` (`components/brand-studio/sound/sound-studio.tsx`).
 */
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

const CANONICAL_CASES = {
  describeInstrumental: composerInputOf({
    prompt: '잔잔한 어쿠스틱 기타, 느린 템포',
    vocal: false,
  }),
  describeVocal: composerInputOf({
    prompt: '밝은 어쿠스틱 팝, 상쾌한 분위기',
    vocal: true,
  }),
  customLyrics: composerInputOf({
    prompt: '밝은 어쿠스틱 팝, 빠른 템포',
    vocal: true,
    lyrics: '햇살 같은 하루\n\n같이 걸어요',
  }),
  customLyricsCareful: composerInputOf({
    prompt: '밝은 어쿠스틱 팝, 빠른 템포',
    vocal: true,
    lyrics: '햇살 같은 하루\n\n같이 걸어요',
    careful: true,
  }),
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  pageMocks.studioRouteContext.mockReset();
});

describe('1. SSR markup baseline (closed organization, canCreate, music tab)', () => {
  it('matches stored HTML snapshot for ko and en (first-visit composer + uploaded TrackRow)', async () => {
    vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', OTHER_ORG);
    await expect(renderToStaticMarkup(<SoundStudio {...studioProps('ko')} />)).toMatchFileSnapshot(snap('sound-studio-ko'));
    await expect(renderToStaticMarkup(<SoundStudio {...studioProps('en')} />)).toMatchFileSnapshot(snap('sound-studio-en'));
  });

  it('matches stored HTML snapshot for ko and en with running/failed PendingRows, made TrackRows, and maxMode', async () => {
    await expect(
      renderToStaticMarkup(
        <SoundStudio
          {...studioProps('ko', {
            maxMode: true,
            initialJobs: [FIXED_RUNNING_JOB, FIXED_DONE_JOB, FIXED_FAILED_JOB],
          })}
        />,
      ),
    ).toMatchFileSnapshot(snap('sound-studio-runs-ko'));
    await expect(
      renderToStaticMarkup(
        <SoundStudio
          {...studioProps('en', {
            maxMode: true,
            initialJobs: [FIXED_RUNNING_JOB, FIXED_DONE_JOB, FIXED_FAILED_JOB],
          })}
        />,
      ),
    ).toMatchFileSnapshot(snap('sound-studio-runs-en'));
  });
});

describe('2. studioSound dictionary baseline (ko and en)', () => {
  const EXPECTED_TOP_LEVEL_GROUPS = [
    'title',
    'lead',
    'tabsLabel',
    'tabs',
    'empty',
    'sfxUse',
    'search',
    'likedOnly',
    'noMatch',
    'upload',
    'row',
    'actions',
    'composer',
    'architect',
    'lyricsKit',
    'terms',
    'examples',
    'version',
    'more',
    'errors',
    'send',
  ];

  it('pins the exact top-level groups and sha256(JSON.stringify) for ko and en', () => {
    const ko = getDictionary('ko').studioSound;
    const en = getDictionary('en').studioSound;
    expect(ko).toEqual(studioSoundKo);
    expect(en).toEqual(studioSoundEn);
    expect(Object.keys(ko)).toEqual(EXPECTED_TOP_LEVEL_GROUPS);
    expect(Object.keys(en)).toEqual(EXPECTED_TOP_LEVEL_GROUPS);
    expect(sha256Json(ko)).toBe('2a2c1dc137cab7b0b67e604f5f0395a3404f3fd8b657bced422191fddca69e39');
    expect(sha256Json(en)).toBe('db82530d0a5d589cf213034003ff3c04f5b0740e9ffd4c98d7b52e9a25b84a42');
  });
});

describe('3. Requests: soundMusicCreateInput + MusicJobCreateSchema.parse for the four canonical cases', () => {
  const opts = { organizationId: FIXED_ORG, locale: 'ko' as const, requestId: FIXED_REQ_ID, brandProjectId: null };

  it('pins describe + instrumental', () => {
    const raw = soundMusicCreateInput(CANONICAL_CASES.describeInstrumental, opts);
    expect(raw).toEqual({
      kind: 'music',
      organizationId: FIXED_ORG,
      requestId: FIXED_REQ_ID,
      prompt: '잔잔한 어쿠스틱 기타, 느린 템포',
      vocal: false,
      language: 'ko',
      architect: true,
    });
    expect(MusicJobCreateSchema.parse(raw)).toEqual(raw);
  });

  it('pins describe + vocal', () => {
    const raw = soundMusicCreateInput(CANONICAL_CASES.describeVocal, opts);
    expect(raw).toEqual({
      kind: 'music',
      organizationId: FIXED_ORG,
      requestId: FIXED_REQ_ID,
      prompt: '밝은 어쿠스틱 팝, 상쾌한 분위기',
      vocal: true,
      language: 'ko',
      architect: true,
    });
    expect(MusicJobCreateSchema.parse(raw)).toEqual(raw);
  });

  it('pins custom with customer lyrics', () => {
    const raw = soundMusicCreateInput(CANONICAL_CASES.customLyrics, opts);
    expect(raw).toEqual({
      kind: 'music',
      organizationId: FIXED_ORG,
      requestId: FIXED_REQ_ID,
      prompt: '밝은 어쿠스틱 팝, 빠른 템포',
      vocal: true,
      language: 'ko',
      lyrics: '햇살 같은 하루\n\n같이 걸어요',
      structure: 'hook',
      targetSeconds: 30,
      architect: true,
    });
    expect(MusicJobCreateSchema.parse(raw)).toEqual(raw);
  });

  it('pins custom with lyrics + careful', () => {
    const raw = soundMusicCreateInput(CANONICAL_CASES.customLyricsCareful, opts);
    expect(raw).toEqual({
      kind: 'music',
      organizationId: FIXED_ORG,
      requestId: FIXED_REQ_ID,
      prompt: '밝은 어쿠스틱 팝, 빠른 템포',
      vocal: true,
      language: 'ko',
      lyrics: '햇살 같은 하루\n\n같이 걸어요',
      structure: 'hook',
      targetSeconds: 30,
      careful: true,
      architect: true,
    });
    expect(MusicJobCreateSchema.parse(raw)).toEqual(raw);
  });
});

describe('4. Engine bodies: Suno adapter request(...) and buildStudioRequest (musicRequestOf) for the four cases', () => {
  const opts = { organizationId: FIXED_ORG, locale: 'ko' as const, requestId: FIXED_REQ_ID, brandProjectId: null };

  const providerRequestFor = (input: ComposerInput) => {
    const parsed = MusicJobCreateSchema.parse(soundMusicCreateInput(input, opts));
    const plan = planMusic(parsed, 'ko', sunoV6Sunra);
    const fromAdapter = sunoV6Sunra.request(plan.request);
    const fromBuilder = buildStudioRequest({
      kind: 'music',
      model: plan.engine.model.id,
      prompt: plan.request.prompt,
      params: plan.params,
      images: [],
      videos: [],
    });
    expect(fromBuilder).toEqual(fromAdapter);
    return fromAdapter;
  };

  it('pins exact endpoint and body for all four canonical cases', () => {
    expect(providerRequestFor(CANONICAL_CASES.describeInstrumental)).toEqual({
      endpoint: 'suno/suno-v6/inspire-mode',
      body: {
        prompt: '잔잔한 어쿠스틱 기타, 느린 템포',
        instrumental: true,
      },
    });

    expect(providerRequestFor(CANONICAL_CASES.describeVocal)).toEqual({
      endpoint: 'suno/suno-v6/inspire-mode',
      body: {
        prompt: '밝은 어쿠스틱 팝, 상쾌한 분위기 Vocals sung in Korean.',
        instrumental: false,
      },
    });

    const expectedStyle =
      '밝은 어쿠스틱 팝, 빠른 템포 Around 120 BPM. The form, in order: a four-bar instrumental intro, then the hook, then an instrumental break, then a short sung outro.';
    const expectedLyrics = '[Intro]\n\n[Chorus]\n햇살 같은 하루\n\n[Instrumental Break]\n\n[Outro]\n같이 걸어요';

    expect(providerRequestFor(CANONICAL_CASES.customLyrics)).toEqual({
      endpoint: 'suno/suno-v6/custom-mode',
      body: {
        title: '밝은 어쿠스틱 팝',
        style: expectedStyle,
        lyrics: expectedLyrics,
        instrumental: false,
        max_mode: false,
      },
    });

    expect(providerRequestFor(CANONICAL_CASES.customLyricsCareful)).toEqual({
      endpoint: 'suno/suno-v6/custom-mode',
      body: {
        title: '밝은 어쿠스틱 팝',
        style: expectedStyle,
        lyrics: expectedLyrics,
        instrumental: false,
        max_mode: true,
      },
    });
  });
});

describe('5. Money: musicQuoteCredits and planned estimateKrw for the four cases', () => {
  const opts = { organizationId: FIXED_ORG, locale: 'ko' as const, requestId: FIXED_REQ_ID, brandProjectId: null };

  it('quotes 16, 16, 16, 32 credits (and matching KRW estimates)', () => {
    const ordered = [
      CANONICAL_CASES.describeInstrumental,
      CANONICAL_CASES.describeVocal,
      CANONICAL_CASES.customLyrics,
      CANONICAL_CASES.customLyricsCareful,
    ];
    expect(ordered.map((c) => c.quotedCredits)).toEqual([16, 16, 16, 32]);
    expect(
      ordered.map((c) =>
        musicQuoteCredits({
          mode: musicWay({ vocal: c.vocal, lyrics: c.lyrics, careful: c.careful }),
          careful: c.careful,
        }),
      ),
    ).toEqual([16, 16, 16, 32]);
    expect(
      ordered.map((c) => planMusic(MusicJobCreateSchema.parse(soundMusicCreateInput(c, opts)), 'ko', sunoV6Sunra).estimateKrw),
    ).toEqual([16 * STUDIO_CREDIT_KRW, 16 * STUDIO_CREDIT_KRW, 16 * STUDIO_CREDIT_KRW, 32 * STUDIO_CREDIT_KRW]);
  });
});

describe('6. Job row (PGlite): createMusicJob for describe + instrumental on closed org', () => {
  it('pins kind, model, status, estimate_krw, and params json keys', async () => {
    vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', OTHER_ORG);
    const f = await studioFixture({ orgId: FIXED_ORG });
    try {
      const deps = studioDeps(f.sql, {
        env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' }),
        now: () => FIXED_NOW,
      });
      const raw = soundMusicCreateInput(CANONICAL_CASES.describeInstrumental, {
        organizationId: f.orgId,
        locale: 'ko',
        requestId: FIXED_REQ_ID,
        brandProjectId: null,
      });
      const created = await createMusicJob(deps, viewerOf(f.ids.owner, 'ko'), raw);
      if (!('job' in created)) throw new Error(`expected created job, got ${JSON.stringify(created)}`);

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
    } finally {
      await f.db.close();
    }
  });
});

describe('7. Page data: prop names app/(brand)/brand/studio/sound/page.tsx passes on the closed path', () => {
  const EXPECTED_CLOSED_PROPS = [
    'audioMaxMb',
    'billingCopy',
    'canCreate',
    'copy',
    'creditsCopy',
    'hrefs',
    'initialAllowance',
    'initialJobs',
    'initialTab',
    'initialTracks',
    'initialVideos',
    'locale',
    'maxMode',
    'organizationId',
    'organizationName',
    'planCatalogue',
  ];

  it('passes the exact 16 prop names to SoundStudio when closed (unset or listing another org)', async () => {
    const pageSource = readFileSync(join(ROOT, 'app/(brand)/brand/studio/sound/page.tsx'), 'utf8');
    expect(pageSource).toContain('<SoundStudio');

    const f = await studioFixture({ orgId: FIXED_ORG });
    try {
      const dict = getDictionary('ko');
      const choice = { id: f.orgId, name: 'Fixture brand', role: 'owner' as const, denied: [] as string[] };
      const StudioSoundPage = (await import('@/app/(brand)/brand/studio/sound/page')).default;

      for (const v2Orgs of [undefined, '', OTHER_ORG]) {
        vi.stubEnv('BRAND_STUDIO_V2', 'on');
        vi.stubEnv('BRAND_SOUND_STUDIO', 'on');
        if (v2Orgs === undefined) delete process.env.BRAND_SOUND_COMPOSER_V2_ORGS;
        else vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', v2Orgs);

        pageMocks.studioRouteContext.mockResolvedValueOnce({
          choice,
          access: { staff: false },
          locale: 'ko',
          dict,
          deps: { sql: f.sql },
          viewer: viewerOf(f.ids.owner, 'ko'),
        });

        const element = (await StudioSoundPage({
          searchParams: Promise.resolve({ organizationId: f.orgId }),
        })) as ReactElement<Record<string, unknown>>;

        expect(element.type).toBe(SoundStudio);
        expect(Object.keys(element.props).sort()).toEqual(EXPECTED_CLOSED_PROPS);
      }
    } finally {
      await f.db.close();
    }
  });
});
