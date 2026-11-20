import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { buildStudioRequest } from '@/lib/brand-studio/provider/requests';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { musicStyle, musicWay, withSections } from '@/lib/brand-studio/sound/lyrics';
import { cleanDraft, LYRICS_DEFAULT_MODEL, lyricsGeminiConfig } from '@/lib/brand-studio/sound/lyrics-draft';
import { planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { musicQuoteCredits } from '@/lib/brand-studio/sound/music-limits';
import { brandSoundMaxModeShown } from '@/lib/flags';
import { studioSoundEn, studioSoundKo } from '@/messages/studio-sound';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SS3 (docs/BRAND-SOUND-STUDIO.md §7.5): music with lyrics, style and "더 고르게 만들기".
 * The way rule, the request shape, the quotes (16 and 32), lyric limits and names, the server setting that
 * hides the switch, and the free lyrics draft with its gates and limit.
 */
const ORG = '00000000-0000-4000-8000-0000000000ef';

describe('the way is decided on the server', () => {
  it('lyrics with vocals, or the switch, make a custom request; anything else is a description', () => {
    expect(musicWay({ vocal: false })).toBe('describe');
    expect(musicWay({ vocal: true })).toBe('describe');
    expect(musicWay({ vocal: true, lyrics: '   ' })).toBe('describe');
    expect(musicWay({ vocal: true, lyrics: '봄바람' })).toBe('custom');
    expect(musicWay({ vocal: false, lyrics: '봄바람' })).toBe('describe');
    expect(musicWay({ vocal: false, careful: true })).toBe('custom');
  });
});

describe('lyrics as sent', () => {
  it('get a section mark per stanza, unless the customer wrote marks', () => {
    expect(withSections('첫 줄\n둘째 줄\n\n후렴 하나\n후렴 둘\n\n\n셋째 절')).toBe('[Verse 1]\n첫 줄\n둘째 줄\n\n[Chorus]\n후렴 하나\n후렴 둘\n\n[Verse 2]\n셋째 절');
    expect(withSections('[Intro]\nla la\n\n[Chorus]\nhey')).toBe('[Intro]\nla la\n\n[Chorus]\nhey');
    expect(withSections('a\r\n\r\nb')).toBe('[Verse 1]\na\n\n[Chorus]\nb');
    expect(withSections('   ')).toBe('');
    const many = Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n\n');
    expect(withSections(many).split('\n\n').at(-1)).toBe('[Outro]\nline 8');
  });

  it('style is the description, plus the language only for vocals without lyrics', () => {
    expect(musicStyle('Bright pop, fast', true, true, 'ko')).toBe('Bright pop, fast');
    expect(musicStyle('밝은 팝', true, false, 'ko')).toBe('밝은 팝 Vocals sung in Korean.');
    expect(musicStyle('Calm piano', false, false, 'en')).toBe('Calm piano');
  });
});

describe('the custom request and its quote', () => {
  const base = { kind: 'music' as const, organizationId: ORG, requestId: 'req_12345678', prompt: '밝은 어쿠스틱 팝, 빠른 템포', vocal: true };

  it('sends title, style, sectioned lyrics and Max Mode to custom-mode', () => {
    const plan = planMusic({ ...base, lyrics: '햇살 같은 하루\n\n같이 걸어요' }, 'ko');
    expect(plan.engine.request(plan.request)).toEqual({
      endpoint: 'suno/suno-v6/custom-mode',
      body: {
        title: '밝은 어쿠스틱 팝',
        style: '밝은 어쿠스틱 팝, 빠른 템포',
        lyrics: '[Verse 1]\n햇살 같은 하루\n\n[Chorus]\n같이 걸어요',
        instrumental: false,
        max_mode: false,
      },
    });
    expect(plan.estimateKrw).toBe(16 * STUDIO_CREDIT_KRW);
    expect(plan.params.music).toMatchObject({ mode: 'custom', careful: false, lyrics: '햇살 같은 하루\n\n같이 걸어요' });
  });

  it('doubles for "더 고르게 만들기", and an instrumental sends no lyrics', () => {
    const careful = planMusic({ ...base, lyrics: '노래', careful: true }, 'ko');
    expect(careful.estimateKrw).toBe(32 * STUDIO_CREDIT_KRW);
    expect(careful.engine.request(careful.request).body).toMatchObject({ max_mode: true });
    const instrumental = planMusic({ ...base, vocal: false, lyrics: '버려질 가사', careful: true }, 'ko');
    expect(instrumental.engine.request(instrumental.request).body).toMatchObject({ lyrics: '', instrumental: true, max_mode: true });
    expect(instrumental.params.music?.lyrics).toBeUndefined();
    expect(musicQuoteCredits({ mode: 'custom', careful: true })).toBe(32);
    expect(musicQuoteCredits({ mode: 'custom' })).toBe(16);
  });

  it('goes out from the stored row exactly as planned', () => {
    const plan = planMusic({ ...base, lyrics: '하나\n\n둘', careful: true }, 'ko');
    const sent = buildStudioRequest({ kind: 'music', model: 'suno-v6', prompt: plan.request.prompt, params: plan.params, images: [], videos: [] });
    expect(sent).toEqual(plan.engine.request(plan.request));
  });
});

describe('BRAND_SOUND_MAX_MODE', () => {
  it('shows the switch unless exactly "off"', () => {
    expect(brandSoundMaxModeShown({})).toBe(true);
    expect(brandSoundMaxModeShown({ BRAND_SOUND_MAX_MODE: 'on' })).toBe(true);
    expect(brandSoundMaxModeShown({ BRAND_SOUND_MAX_MODE: 'OFF' })).toBe(true);
    expect(brandSoundMaxModeShown({ BRAND_SOUND_MAX_MODE: 'off' })).toBe(false);
    expect(studioEnv({ BRAND_SOUND_MAX_MODE: 'off' }).soundMaxMode).toBe(false);
  });
});

describe('job.create kind music, custom way, on the fake provider', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;
  const env = (extra: Record<string, string> = {}) => studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', ...extra });
  const music = (over: Record<string, unknown> = {}) => ({
    kind: 'music',
    organizationId: f.orgId,
    requestId: requestId(),
    prompt: '밝은 어쿠스틱 팝',
    vocal: true,
    lyrics: '햇살 같은 하루\n\n같이 걸어요',
    ...over,
  });
  const jobs = async () => (await f.sql.query<{ id: string; status: string; usage_krw: number | null; params: { music: { mode: string; careful: boolean } } }>('select * from brand_studio_jobs where organization_id = $1', [f.orgId])).rows;
  const run = async (id: string) => {
    for (let i = 0; i < 6; i += 1) await advanceStudioJobsWith(deps, { jobIds: [id] });
  };

  beforeEach(async () => {
    f = await studioFixture();
    deps = studioDeps(f.sql, { env: env() });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  it('makes the versions and takes 16, or 32 with the switch', async () => {
    const plain = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    const careful = await createStudioJob(deps, viewerOf(f.ids.owner), music({ careful: true }));
    if (!('job' in plain) || !('job' in careful)) throw new Error('created');
    expect(plain.job.music).toMatchObject({ mode: 'custom', careful: false, lyrics: '햇살 같은 하루\n\n같이 걸어요' });
    await run(plain.job.id);
    await run(careful.job.id);
    const rows = await jobs();
    expect(rows.find((j) => j.id === plain.job.id)).toMatchObject({ status: 'succeeded', usage_krw: 16 * STUDIO_CREDIT_KRW });
    expect(rows.find((j) => j.id === careful.job.id)).toMatchObject({ status: 'succeeded', usage_krw: 32 * STUDIO_CREDIT_KRW });
    const task = [...deps.provider.tasks.values()];
    expect(task.every((t) => t.medium === 'audio')).toBe(true);
  });

  it('refuses lyrics over the limit, lyrics naming a singer, and the hidden switch, reserving nothing', async () => {
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ lyrics: 'x'.repeat(3001) }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ lyrics: '뉴진스처럼 춤을 춰' }))).toEqual({ ok: false, code: 'invalid', blocked: 'lyrics' });
    deps = studioDeps(f.sql, { env: env({ BRAND_SOUND_MAX_MODE: 'off' }) });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ careful: true }))).toEqual({ ok: false, code: 'invalid' });
    expect(await jobs()).toHaveLength(0);
    // With the switch hidden, a request without it still goes through.
    const ok = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    expect('job' in ok).toBe(true);
  });

  it('fails and takes nothing when the engine fails a custom request', async () => {
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ lyrics: '한 줄 [[fake:fail]]' }));
    if (!('job' in created)) throw new Error('created');
    await run(created.job.id);
    expect((await jobs())[0]).toMatchObject({ status: 'failed', usage_krw: 0 });
  });
});

describe('lyrics.draft', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;
  const draft = (over: Record<string, unknown> = {}, who?: string) =>
    runStudioOperation(deps, viewerOf(who ?? f.ids.owner), 'lyrics.draft', { organizationId: f.orgId, topic: '아침 스킨케어 루틴', language: 'ko', ...over });

  beforeEach(async () => {
    resetFreeIntelRateLimits();
    f = await studioFixture();
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_SOUND_STUDIO: 'on' }) });
  });
  afterEach(async () => {
    resetFreeIntelRateLimits();
    await f.db.close();
  });

  it('answers a local draft in the language asked for, free', async () => {
    const ko = await draft();
    expect(ko).toMatchObject({ ok: true });
    expect((ko as unknown as { lyrics: string }).lyrics).toMatch(/[가-힣]/);
    const en = await draft({ language: 'en' });
    expect((en as unknown as { lyrics: string }).lyrics).toMatch(/^[A-Za-z]/);
    expect((await f.sql.query('select 1 from brand_studio_jobs')).rows).toHaveLength(0);
  });

  it('keeps the studio gates and a per-organization limit', async () => {
    expect(await draft({}, f.ids.viewer)).toEqual({ ok: false, code: 'forbidden' });
    expect(await draft({}, f.ids.guest)).toEqual({ ok: false, code: 'not_found' });
    expect(await draft({ topic: 'BTS 스타일 응원가' })).toEqual({ ok: false, code: 'invalid', blocked: 'name' });
    expect(await draft({ topic: '' })).toEqual({ ok: false, code: 'invalid' });
    for (let i = 0; i < 6; i += 1) expect(await draft()).toMatchObject({ ok: true });
    expect(await draft()).toEqual({ ok: false, code: 'too_many_running' });
    await f.sql.query("insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['sound']::text[], $2)", [f.orgId, f.ids.admin]);
    expect(await draft()).toEqual({ ok: false, code: 'feature_unavailable' });
  });

  it('is closed with the flag off and with no allowance this month', async () => {
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake' }) });
    expect(await draft()).toEqual({ ok: false, code: 'invalid' });
    const closed = await studioFixture({ capKrw: null });
    try {
      deps = studioDeps(closed.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_SOUND_STUDIO: 'on' }) });
      expect(await runStudioOperation(deps, viewerOf(closed.ids.owner), 'lyrics.draft', { organizationId: closed.orgId, topic: '아침', language: 'ko' })).toEqual({
        ok: false,
        code: 'allowance_closed',
      });
    } finally {
      await closed.db.close();
    }
  });

  it('asks the model live, cleans marks out, and refuses a draft naming a singer', async () => {
    const answers = ['[Verse]\n아침 햇살\n\n\n\n[Chorus]\n함께해요', '뉴진스와 함께 노래해'];
    const calls: string[] = [];
    const fetchStub = (async (url: string) => {
      calls.push(String(url));
      const lyrics = answers.shift()!;
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ lyrics }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    deps = studioDeps(f.sql, {
      env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', BRAND_SOUND_STUDIO: 'on' }),
      intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'test-key' } },
    });
    expect(await draft()).toEqual({ ok: true, lyrics: '아침 햇살\n\n함께해요' });
    expect(calls[0]).toContain(`/models/${LYRICS_DEFAULT_MODEL}:generateContent`);
    expect(await draft()).toEqual({ ok: false, code: 'failed' });
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', BRAND_SOUND_STUDIO: 'on' }), intelDeps: { fetch: fetchStub, env: {} } });
    expect(await draft()).toEqual({ ok: false, code: 'provider_unavailable' });
  });

  it('runs on the editing studio’s model unless the server names another', () => {
    expect(lyricsGeminiConfig({})).toBeNull();
    expect(lyricsGeminiConfig({ GEMINI_API_KEY: 'k' })?.model).toBe('gemini-4-hydrogen');
    expect(lyricsGeminiConfig({ GEMINI_API_KEY: 'k', BRAND_SOUND_LYRICS_MODEL: 'gemini-x' })?.model).toBe('gemini-x');
    expect(lyricsGeminiConfig({ GEMINI_API_KEY: 'k', BRAND_SOUND_LYRICS_MODEL: 'bad model!' })?.model).toBe('gemini-4-hydrogen');
    expect(cleanDraft('[Chorus]\n  a  \n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('copy', () => {
  it('promises nothing the screen cannot do yet', () => {
    for (const copy of [studioSoundKo, studioSoundEn]) {
      expect(copy.terms.points).toHaveLength(3);
      expect(JSON.stringify(copy.terms)).not.toMatch(/만든 기록|creation record/);
    }
  });
});
