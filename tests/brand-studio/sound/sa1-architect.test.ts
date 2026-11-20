import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { SUNO_HEADER } from '@/lib/brand-studio/enhancer/profiles/suno';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { checkMusicDesign, designMusic, fallbackDesign, MUSIC_PROFILE_VERSION, reviewedDesign, type MusicDesignInput } from '@/lib/brand-studio/sound/architect';
import { withSections } from '@/lib/brand-studio/sound/lyrics';
import { describeSentence, musicTitle } from '@/lib/brand-studio/sound/music-text';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SA1 (docs/BRAND-SOUND-STUDIO.md §12.2, §12.6): the music Prompt Architect. The profile's
 * header, the rule check, the model path with one rewrite, the deterministic fallback, a design the customer
 * edited, the prepare step, "보낸 문장", and the free preview with its gates.
 */
const ROOT = process.cwd();

const GOOD_STYLE =
  'Warm acoustic pop with a light, hopeful feel, around 96 BPM, relaxed. A warm female vocal sings softly in Korean. ' +
  'Fingerpicked acoustic guitar keeps a steady pulse, a round upright bass walks underneath, and brushed drums keep time. ' +
  'A short intro, the hook arrives early and returns once. Warm and close, a little room. Ends cleanly on a held chord.';

const input = (over: Partial<MusicDesignInput> = {}): MusicDesignInput => ({
  prompt: '아침 스킨케어 광고, 잔잔하고 따뜻하게',
  vocal: false,
  lyrics: '',
  careful: false,
  language: 'ko',
  locale: 'ko',
  ...over,
});

function geminiAnswers(...answers: Array<Record<string, string> | Error>) {
  const calls: Array<{ url: string; body: { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ parts: Array<{ text: string }> }> } }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const next = answers.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no answer');
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchStub, calls };
}

describe('the Suno profile', () => {
  it('has a header like every profile: version, model, dated sources with evidence tags, last verified', () => {
    expect(SUNO_HEADER.id).toBe('suno');
    expect(SUNO_HEADER.models).toEqual(['suno-v6']);
    expect(SUNO_HEADER.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(SUNO_HEADER.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SUNO_HEADER.sources.length).toBeGreaterThanOrEqual(5);
    for (const source of SUNO_HEADER.sources) {
      expect(source.seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.claim).toMatch(/\[(official|practitioner|aggregator|house)/);
    }
    expect(MUSIC_PROFILE_VERSION).toBe(`suno@${SUNO_HEADER.version}`);
    expect(readFileSync(join(ROOT, 'lib/brand-studio/enhancer/profiles/CHANGELOG.md'), 'utf8')).toContain(`## suno ${SUNO_HEADER.version}`);
    expect(readFileSync(join(ROOT, 'lib/brand-studio/enhancer/profiles/meta.ts'), 'utf8')).toContain('[practitioner]');
  });
});

describe('the rule check after writing', () => {
  it('passes a good paragraph and catches every rule', () => {
    expect(checkMusicDesign({ style: GOOD_STYLE }, 'describe')).toEqual([]);
    const cases: Array<[string, RegExp]> = [
      ['Calm piano.', /too short/],
      [`${GOOD_STYLE} `.repeat(6), /over 1000/],
      [`${GOOD_STYLE}\nSecond paragraph here, warm.`, /one paragraph/],
      [`${GOOD_STYLE} Made for Suno v6.`, /service or a technical term/],
      [`${GOOD_STYLE} In the style of Taylor Swift.`, /real artist/],
      [`${GOOD_STYLE} No vocals at all.`, /no X/],
      [`${GOOD_STYLE} Played without drums.`, /no X/],
      [`${GOOD_STYLE} Keep it to 30 seconds.`, /seconds or minutes/],
      [`${GOOD_STYLE} 15초 광고용.`, /seconds or minutes/],
    ];
    for (const [style, problem] of cases) expect(checkMusicDesign({ style }, 'describe').join(' | '), style.slice(-40)).toMatch(problem);
    expect(checkMusicDesign({ style: GOOD_STYLE, title: '' }, 'custom').join()).toMatch(/title is required/);
    expect(checkMusicDesign({ style: GOOD_STYLE, title: 'x'.repeat(41) }, 'custom').join()).toMatch(/title is over 40/);
    expect(checkMusicDesign({ style: GOOD_STYLE, title: '맑은 아침' }, 'custom')).toEqual([]);
  });
});

describe('designing', () => {
  const env = { GEMINI_API_KEY: 'test-key' };

  it('falls back to exactly what the studio sent before, without a key', async () => {
    const design = await designMusic(input({ vocal: true }), { fetch: (() => Promise.reject(new Error('never'))) as typeof fetch, env: {} });
    expect(design).toMatchObject({ source: 'fallback', fallbackReason: 'no_key', llmModel: null, notes: null });
    expect(design.style).toBe(describeSentence(input().prompt, true, 'ko'));
    expect(design.title).toBe(musicTitle(input().prompt));
  });

  it('takes a model answer that passes the check, and records the model', async () => {
    const { fetchStub, calls } = geminiAnswers({ style: GOOD_STYLE, title: '', notes: '잔잔한 어쿠스틱에 따뜻한 여성 보컬로 설계했어요.' });
    const design = await designMusic(input({ vocal: true }), { fetch: fetchStub, env });
    expect(design).toMatchObject({ source: 'model', style: GOOD_STYLE, notes: '잔잔한 어쿠스틱에 따뜻한 여성 보컬로 설계했어요.', profileVersion: MUSIC_PROFILE_VERSION });
    expect(design.llmModel).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.systemInstruction.parts[0]!.text).toContain('Never name a real singer');
  });

  it('gives one rewrite with the problems listed, then falls back', async () => {
    const bad = { style: `${GOOD_STYLE} No vocals.`, title: '', notes: 'x' };
    const fixed = geminiAnswers(bad, { style: GOOD_STYLE, title: '', notes: 'ok' });
    expect((await designMusic(input(), { fetch: fixed.fetchStub, env })).source).toBe('model');
    expect(fixed.calls).toHaveLength(2);
    expect(fixed.calls[1]!.body.contents[0]!.parts[0]!.text).toContain('"no X"');
    const twice = geminiAnswers(bad, bad);
    expect(await designMusic(input(), { fetch: twice.fetchStub, env })).toMatchObject({ source: 'fallback', fallbackReason: 'check_failed' });
    const broken = geminiAnswers(new Error('timeout'));
    expect(await designMusic(input(), { fetch: broken.fetchStub, env })).toMatchObject({ source: 'fallback', fallbackReason: 'model_error' });
  });

  it('never rewrites the customer’s lyrics and never even sends them to the text model', async () => {
    const lyrics = '아침 햇살이 창을 두드리면\n물 한 잔으로 하루를 열어요\n\n오늘도 맑게';
    const { fetchStub, calls } = geminiAnswers({ style: GOOD_STYLE, title: '맑은 아침', notes: 'ok' });
    const design = await designMusic(input({ vocal: true, lyrics }), { fetch: fetchStub, env });
    expect(design.mode).toBe('custom');
    expect(design.lyrics).toBe(withSections(lyrics));
    expect(design.lyrics.replace(/\[[^\]]+\]\n/g, '')).toBe(lyrics.replace(/\n\n/g, '\n\n'));
    expect(JSON.stringify(calls[0]!.body)).not.toContain('아침 햇살');
  });

  it('accepts an edited design as written (Korean, short), and stops names and over-long text', () => {
    expect(reviewedDesign(input(), { style: '잔잔한 피아노와 첼로, 느리게' })).toMatchObject({ source: 'reviewed', style: '잔잔한 피아노와 첼로, 느리게' });
    expect(reviewedDesign(input(), { style: 'like Taylor Swift' })).toMatchObject({ named: true });
    expect(reviewedDesign(input(), { style: 'x'.repeat(1001) })).toMatchObject({ named: false });
  });
});

describe('a music run with the Architect', () => {
  let f: StudioFixture;
  const sent: StudioProviderRequest[] = [];
  const recording: StudioProvider = {
    name: 'sunra_api',
    submit: async (request) => {
      sent.push(request);
      return { taskId: `pd_${sent.length}` };
    },
    status: async () => ({ state: 'pending' }),
    download: async () => {
      throw new Error('unused');
    },
  };
  const liveEnv = studioEnv({ BRAND_STUDIO_PROVIDER: 'live', SUNRA_API_KEY: 'k', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' });
  const music = (over: Record<string, unknown> = {}) => ({ kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: '아침 스킨케어 광고, 잔잔하게', vocal: false, ...over });
  const row = async (id: string) =>
    (await f.sql.query<{ final_prompt: string; enhance: boolean; estimate_krw: number; work: { prepared?: boolean; enhancer?: Record<string, unknown> } }>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;

  beforeEach(async () => {
    resetFreeIntelRateLimits();
    sent.length = 0;
    f = await studioFixture();
  });
  afterEach(async () => {
    resetFreeIntelRateLimits();
    await f.db.close();
  });

  it('designs in the prepare step, sends the design, records it, and charges the same 16', async () => {
    const { fetchStub } = geminiAnswers({ style: GOOD_STYLE, title: '', notes: 'ok' });
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never, intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    expect((await row(created.job.id)).work.prepared).toBeUndefined();
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    const after = await row(created.job.id);
    expect(after.final_prompt).toBe(GOOD_STYLE);
    expect(after.enhance).toBe(true);
    expect(after.estimate_krw).toBe(16 * STUDIO_CREDIT_KRW);
    expect(after.work.enhancer).toMatchObject({ profile: 'suno', profileVersion: MUSIC_PROFILE_VERSION, source: 'model' });
    expect(sent[0]).toEqual({ endpoint: 'suno/suno-v6/inspire-mode', body: { prompt: GOOD_STYLE, instrumental: true } });
  });

  it('sends the designed title in custom mode and the customer’s lyrics untouched', async () => {
    const lyrics = '햇살 같은 하루\n\n같이 걸어요';
    const { fetchStub } = geminiAnswers({ style: GOOD_STYLE, title: '맑은 하루', notes: 'ok' });
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never, intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ vocal: true, lyrics }));
    if (!('job' in created)) throw new Error('created');
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect(sent[0]).toEqual({
      endpoint: 'suno/suno-v6/custom-mode',
      body: { title: '맑은 하루', style: GOOD_STYLE, lyrics: withSections(lyrics), instrumental: false, max_mode: false },
    });
  });

  it('falls back when the model cannot answer, and the run still goes', async () => {
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never, intelDeps: { fetch: (() => Promise.reject(new Error('down'))) as typeof fetch, env: { GEMINI_API_KEY: 'k' } } });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in created)) throw new Error('created');
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    const after = await row(created.job.id);
    expect(after.work.enhancer).toMatchObject({ source: 'fallback', fallbackReason: 'model_error' });
    expect(sent[0]!.body.prompt).toBe(fallbackDesign({ prompt: '아침 스킨케어 광고, 잔잔하게', vocal: false, lyrics: '', careful: false, language: 'ko', locale: 'ko' }).style);
  });

  it('sends a reviewed design as written, and stops a name in it before reserving', async () => {
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ designed: { style: '잔잔한 피아노와 첼로, 느리게' } }));
    if (!('job' in created)) throw new Error('created');
    expect((await row(created.job.id)).work).toMatchObject({ prepared: true, enhancer: { source: 'reviewed' } });
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect(sent[0]!.body.prompt).toBe('잔잔한 피아노와 첼로, 느리게');
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ designed: { style: 'calm, like Taylor Swift' } }))).toEqual({ ok: false, code: 'invalid', blocked: 'name' });
    expect((await f.sql.query('select 1 from brand_studio_jobs')).rows).toHaveLength(1);
  });

  it('sends the words as typed with the Architect off, and keeps "보낸 문장" hidden then', async () => {
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ architect: false }));
    if (!('job' in created)) throw new Error('created');
    expect(created.job.finalPrompt).toBeNull();
    expect((await row(created.job.id)).work).toMatchObject({ prepared: true, enhancer: { source: 'fallback', fallbackReason: 'off' } });
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect(sent[0]!.body.prompt).toBe('아침 스킨케어 광고, 잔잔하게');
  });

  it('uses the local design in local mode without a key', async () => {
    const deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_SOUND_STUDIO: 'on' }) });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in created)) throw new Error('created');
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect((await row(created.job.id)).final_prompt).toMatch(/^Local design for/);
  });
});

describe('music.design (지금 설계하기)', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;
  const design = (over: Record<string, unknown> = {}, who?: string) =>
    runStudioOperation(deps, viewerOf(who ?? f.ids.owner), 'music.design', { organizationId: f.orgId, prompt: '아침 스킨케어 광고', vocal: false, ...over });

  beforeEach(async () => {
    resetFreeIntelRateLimits();
    f = await studioFixture();
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_SOUND_STUDIO: 'on' }) });
  });
  afterEach(async () => {
    resetFreeIntelRateLimits();
    await f.db.close();
  });

  it('returns a design for free, without making anything', async () => {
    const answer = await design();
    expect(answer).toMatchObject({ ok: true, design: { mode: 'describe', source: 'model' } });
    expect((await f.sql.query('select 1 from brand_studio_jobs')).rows).toHaveLength(0);
  });

  it('answers the model’s design when a key is set', async () => {
    const { fetchStub } = geminiAnswers({ style: GOOD_STYLE, title: '', notes: '따뜻하게 설계했어요.' });
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', SUNRA_API_KEY: 'k', BRAND_SOUND_STUDIO: 'on' }), intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    expect(await design()).toEqual({ ok: true, design: { mode: 'describe', style: GOOD_STYLE, title: musicTitle('아침 스킨케어 광고'), notes: '따뜻하게 설계했어요.', source: 'model' } });
  });

  it('keeps the gates, names, the hidden switch and the per-organization limit', async () => {
    expect(await design({}, f.ids.viewer)).toEqual({ ok: false, code: 'forbidden' });
    expect(await design({}, f.ids.guest)).toEqual({ ok: false, code: 'not_found' });
    expect(await design({ prompt: 'BTS 느낌으로' })).toEqual({ ok: false, code: 'invalid', blocked: 'name' });
    expect(await design({ vocal: true, lyrics: '블랙핑크처럼' })).toEqual({ ok: false, code: 'invalid', blocked: 'lyrics' });
    expect(await design({ careful: true })).toEqual({ ok: false, code: 'invalid' });
    for (let i = 0; i < 20; i += 1) expect(await design()).toMatchObject({ ok: true });
    expect(await design()).toEqual({ ok: false, code: 'too_many_running' });
    await f.sql.query("insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['sound']::text[], $2)", [f.orgId, f.ids.admin]);
    expect(await design()).toEqual({ ok: false, code: 'feature_unavailable' });
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake' }) });
    expect(await design()).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('scripts/sound-architect-eval.ts (text only)', () => {
  it('reads the 16 briefs of the blind sheet and scores without a model', async () => {
    const evalScript = await import('../../../scripts/sound-architect-eval');
    const sheet = readFileSync(join(ROOT, 'docs/research/brand-sound-studio-2026-11-20/lyrics-blind-sheet.md'), 'utf8');
    const briefs = evalScript.briefCases(sheet);
    expect(briefs).toHaveLength(16);
    expect(briefs.filter((c) => c.input.language === 'ko')).toHaveLength(8);
    const keep = evalScript.EXTRA_CASES.find((c) => c.trap === 'keep-lyrics')!;
    expect(evalScript.scoreDesign(keep, fallbackDesign(keep.input), 0).verdict).toBe('allow');
    const changed = { ...fallbackDesign(keep.input), source: 'model' as const, style: GOOD_STYLE, title: '맑은 아침', lyrics: '[Verse 1]\n다른 가사' };
    expect(evalScript.scoreDesign(keep, changed, 0)).toMatchObject({ verdict: 'fail' });
    const name = evalScript.EXTRA_CASES.find((c) => c.trap === 'name')!;
    expect(evalScript.scoreDesign(name, fallbackDesign(name.input), 0).verdict).toBe('pass');
  });

  it('lets only the expected model through and stops at the cap', async () => {
    const { guardedFetch } = await import('../../../scripts/sound-architect-eval');
    const inner = (async () => new Response('{}')) as unknown as typeof fetch;
    const guarded = guardedFetch('gemini-x', 2, inner);
    await guarded('https://api/models/gemini-x:generateContent');
    await expect(guarded('https://api/models/other:generateContent')).rejects.toThrow(/other than gemini-x/);
    await guarded('https://api/models/gemini-x:generateContent');
    await expect(guarded('https://api/models/gemini-x:generateContent')).rejects.toThrow(/more than 2 calls/);
    expect(guarded.calls()).toBe(3);
  });
});
