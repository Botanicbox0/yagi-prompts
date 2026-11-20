import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { audioSeconds } from '@/lib/brand-studio/sound/audio-info';
import { MUSIC_ENGINES, musicEngine } from '@/lib/brand-studio/sound/engine';
import { describeSentence, musicQuoteKrw, musicTitle, planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { musicQuoteCredits } from '@/lib/brand-studio/sound/music-limits';
import { mergeTracks, musicTracks, soundTracks } from '@/lib/brand-studio/sound/library';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { namedArtist } from '@/lib/brand-studio/sound/names';
import { FAKE_MUSIC_CLIPS } from '@/lib/brand-studio/provider/fake-music';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { musicUsageKrw, usageKrw } from '@/lib/brand-studio/usage-rate';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { parseSunraQueueResult } from '@/lib/sunra/client';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SS2 (docs/BRAND-SOUND-STUDIO.md §7.4): music by description. Everything the server
 * decides: gates, the request shape, the quote (16 credits), one charge per request whatever the number of
 * versions, nothing taken on failure or a blocked description, a retried press, the lane, the waveform.
 */
const ROOT = process.cwd();

describe('the engine adapter (Suno v6 on the API lane)', () => {
  const engine = MUSIC_ENGINES['suno-v6-sunra']!;

  it('is the default, API lane only, with no length input', () => {
    expect(musicEngine({}).id).toBe('suno-v6-sunra');
    expect(musicEngine({ BRAND_SOUND_MUSIC_ENGINE: 'nope' }).id).toBe('suno-v6-sunra');
    expect(engine.model).toEqual({ id: 'suno-v6', mcp: null });
    expect(engine.capabilities.lengthInput).toBe(false);
  });

  it('sends the description and the vocal switch to inspire-mode, as the catalogue schema has it', () => {
    expect(engine.request({ mode: 'describe', prompt: 'Calm piano, slow', vocal: false })).toEqual({
      endpoint: 'suno/suno-v6/inspire-mode',
      body: { prompt: 'Calm piano, slow', instrumental: true },
    });
    expect(engine.request({ mode: 'describe', prompt: 'Bright pop', vocal: true }).body).toEqual({ prompt: 'Bright pop', instrumental: false });
    expect(() => engine.request({ mode: 'describe', prompt: '   ', vocal: false })).toThrow();
    expect(() => engine.request({ mode: 'describe', prompt: 'x'.repeat(3001), vocal: false })).toThrow();
  });

  it('asks for the language to sing in only when there are vocals', () => {
    expect(describeSentence('밝은 어쿠스틱 팝', true, 'ko')).toBe('밝은 어쿠스틱 팝 Vocals sung in Korean.');
    expect(describeSentence('Bright pop', true, 'en')).toBe('Bright pop Vocals sung in English.');
    expect(describeSentence('잔잔한  피아노', false, 'ko')).toBe('잔잔한 피아노');
  });

  it('names a track from the first phrase of its description', () => {
    expect(musicTitle('잔잔한 어쿠스틱 기타, 느린 템포, 스킨케어 광고')).toBe('잔잔한 어쿠스틱 기타');
    expect(musicTitle('Calm piano.')).toBe('Calm piano');
    expect(musicTitle('a'.repeat(30) + ' ' + 'b'.repeat(30)).length).toBeLessThanOrEqual(41);
  });
});

describe('the quote (provisional, §3.4)', () => {
  it('is 16 credits for a description request, from the image factor', () => {
    expect(musicQuoteKrw({ mode: 'describe' })).toBe(16 * STUDIO_CREDIT_KRW);
    expect(usageKrw(0.1, 'audio')).toBe(16 * STUDIO_CREDIT_KRW);
    expect(usageKrw(0.2, 'audio')).toBe(32 * STUDIO_CREDIT_KRW);
    const plan = planMusic({ kind: 'music', organizationId: randomUUID(), requestId: 'req_12345678', mode: 'describe', prompt: 'Calm piano', vocal: false }, 'ko');
    expect(plan.estimateKrw).toBe(musicQuoteKrw({ mode: 'describe' }));
    expect(plan.params).toMatchObject({ music: { mode: 'describe', vocal: false, title: 'Calm piano', made: { engine: 'suno-v6-sunra', endpoint: 'suno/suno-v6/inspire-mode' } } });
  });

  it('charges a request once, whatever the number of versions, and nothing without one', () => {
    expect(musicUsageKrw(160, 1)).toBe(160);
    expect(musicUsageKrw(160, 2)).toBe(160);
    expect(musicUsageKrw(160, 5)).toBe(160);
    expect(musicUsageKrw(160, 0)).toBe(0);
  });
});

describe('the list of made versions', () => {
  const ORG = '00000000-0000-4000-8000-0000000000cd';
  const job = (over: Partial<StudioJobView>): StudioJobView =>
    ({
      id: randomUUID(),
      kind: 'music',
      status: 'succeeded',
      prompt: '잔잔한 피아노, 느린 템포',
      music: { title: '잔잔한 피아노', vocal: false, mode: 'describe', careful: false, lyrics: null },
      outputs: [
        { id: randomUUID(), jobId: 'j', kind: 'audio', url: '/a', thumbUrl: null, width: null, height: null, seconds: 12, draft: false, savedAssetId: null, createdAt: '2026-11-20T00:00:00.000Z' },
        { id: randomUUID(), jobId: 'j', kind: 'audio', url: '/b', thumbUrl: null, width: null, height: null, seconds: 8, draft: false, savedAssetId: 'saved-asset', createdAt: '2026-11-20T00:00:00.000Z' },
      ],
      createdAt: '2026-11-20T01:00:00.000Z',
      ...over,
    }) as StudioJobView;

  it('names each version "<title> · A/B" and streams results by output id', () => {
    const rows = musicTracks(ORG, [job({}), job({ status: 'running', outputs: [] }), job({ status: 'failed', outputs: [] })], []);
    expect(rows.map((r) => r.displayName)).toEqual(['잔잔한 피아노 · A', '잔잔한 피아노 · B']);
    expect(rows[0]!.streamUrl).toContain('source=output');
    expect(rows[1]!.assetId).toBe('saved-asset');
  });

  it('shows a saved version once (as the version), newest first', () => {
    const made = musicTracks(ORG, [job({})], []);
    const files = soundTracks(ORG, [{ id: 'saved-asset', kind: 'audio', role: null, name: '잔잔한 피아노 · B', tags: [], url: '/b', thumbUrl: null, width: null, height: null, seconds: 8, source: 'generation', createdAt: '2026-11-20T02:00:00.000Z' }, { id: 'upload', kind: 'audio', role: null, name: 'Brand theme.mp3', tags: [], url: '/u', thumbUrl: null, width: null, height: null, seconds: 30, source: 'upload', createdAt: '2026-11-19T00:00:00.000Z' }], []);
    expect(mergeTracks(made, files).map((r) => r.key)).toEqual([made[0]!.key, made[1]!.key, 'a:upload']);
  });

  it('puts the same number on the button as the server reserves', () => {
    expect(musicQuoteCredits({ mode: 'describe' })).toBe(16);
  });
});

describe('names of real singers and songs', () => {
  it('are caught in Korean and Latin, as whole words', () => {
    for (const text of ['BTS 느낌의 밝은 곡', '뉴진스 같은 노래', 'like Taylor Swift', 'taylorswift vibe', '아이유 스타일 발라드', 'a cover of a famous song']) {
      expect(namedArtist(text), text).not.toBeNull();
    }
  });
  it('leave ordinary descriptions alone', () => {
    for (const text of ['subtle beats with a warm bass', '잔잔한 피아노, 느린 템포', 'in the style of 80s disco', 'rose gold mood, crush on summer', '노래 같은 멜로디가 있는 곡', '10cm 단위로 쌓이는 리듬']) {
      expect(namedArtist(text), text).toBeNull();
    }
  });
});

describe('the files the fake provider returns', () => {
  it('are real MP3s whose measured length matches', () => {
    for (const clip of FAKE_MUSIC_CLIPS) {
      const seconds = audioSeconds(new Uint8Array(Buffer.from(clip.mp3Base64, 'base64')), 'audio/mpeg');
      expect(seconds).not.toBeNull();
      expect(Math.abs(seconds! - clip.seconds)).toBeLessThan(0.2);
    }
  });
});

describe('Sunra music results', () => {
  it('reads every version with its length and ids', () => {
    const parsed = parseSunraQueueResult({
      title: 'Spring',
      clips: [
        { task_id: 't1', clip_id: 'c1', title: 'Spring', audio_url: 'https://cdn.example/a.mp3', duration: 151.2, lyrics: '[Verse]' },
        { task_id: 't1', clip_id: 'c2', title: 'Spring', audio_url: 'https://cdn.example/b.mp3', duration: 140 },
        { task_id: 't1', clip_id: 'c3' },
      ],
    });
    expect(parsed.files.map((f) => f.url)).toEqual(['https://cdn.example/a.mp3', 'https://cdn.example/b.mp3']);
    expect(parsed.clips).toEqual([
      { url: 'https://cdn.example/a.mp3', seconds: 151.2, meta: { taskId: 't1', clipId: 'c1', title: 'Spring', lyrics: '[Verse]' } },
      { url: 'https://cdn.example/b.mp3', seconds: 140, meta: { taskId: 't1', clipId: 'c2', title: 'Spring' } },
    ]);
    expect(parseSunraQueueResult({ images: [{ url: 'https://x/y.png' }] }).clips).toBeUndefined();
  });
});

describe('job.create kind music, end to end on the fake provider', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;
  const env = (extra: Record<string, string> = {}) =>
    studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', ...extra });
  const music = (over: Record<string, unknown> = {}) => ({
    kind: 'music',
    organizationId: f.orgId,
    requestId: requestId(),
    mode: 'describe',
    prompt: '잔잔한 어쿠스틱 기타, 느린 템포',
    vocal: false,
    ...over,
  });
  const jobsOf = async () => (await f.sql.query<{ id: string; status: string; usage_krw: number | null; estimate_krw: number; lane: string | null; kind: string; error_code: string | null }>('select * from brand_studio_jobs where organization_id = $1', [f.orgId])).rows;
  const run = async (jobId: string) => {
    for (let i = 0; i < 6; i += 1) await advanceStudioJobsWith(deps, { jobIds: [jobId] });
  };

  beforeEach(async () => {
    f = await studioFixture();
    deps = studioDeps(f.sql, { env: env() });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  it('is closed while BRAND_SOUND_STUDIO is off, like an unknown kind', async () => {
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake' }) });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music())).toEqual({ ok: false, code: 'invalid' });
    expect(await jobsOf()).toHaveLength(0);
  });

  it('refuses malformed requests before anything is reserved', async () => {
    for (const bad of [music({ prompt: '' }), music({ prompt: 'x'.repeat(1001) }), music({ extra: 1 }), music({ vocal: 'yes' })]) {
      expect(await createStudioJob(deps, viewerOf(f.ids.owner), bad)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await jobsOf()).toHaveLength(0);
  });

  it('makes two versions on the fake engine, stores them as audio and takes the quote once', async () => {
    const created = await createStudioJob(deps, viewerOf(f.ids.editor), music());
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    expect(created.job.kind).toBe('music');
    expect(created.job.music).toEqual({ title: '잔잔한 어쿠스틱 기타', vocal: false, mode: 'describe', careful: false, lyrics: null });
    // With the Prompt Architect (on by default, §12.2) what is sent shows under "보낸 문장 보기".
    expect(created.job.finalPrompt).not.toBeNull();
    await run(created.job.id);
    const [job] = await jobsOf();
    expect(job).toMatchObject({ status: 'succeeded', usage_krw: 16 * STUDIO_CREDIT_KRW, estimate_krw: 16 * STUDIO_CREDIT_KRW, lane: 'sunra_api' });
    const outputs = (await f.sql.query<{ idx: number; kind: string; status: string; mime: string; duration_ms: number; storage_key: string }>('select * from brand_studio_outputs where job_id = $1 order by idx', [created.job.id])).rows;
    expect(outputs.map((o) => [o.idx, o.kind, o.status, o.mime])).toEqual([
      [0, 'audio', 'ready', 'audio/mpeg'],
      [1, 'audio', 'ready', 'audio/mpeg'],
    ]);
    expect(Math.abs(outputs[0]!.duration_ms - 12_000)).toBeLessThan(200);
    expect(Math.abs(outputs[1]!.duration_ms - 8_000)).toBeLessThan(200);
    const work = (await f.sql.query<{ work: { results: Record<string, { meta?: Record<string, string> }> } }>('select work from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!.work;
    expect(work.results['1']?.meta?.clipId).toMatch(/-1$/);
    // Running the engine again changes nothing (no third row, no second charge).
    await run(created.job.id);
    expect((await f.sql.query('select 1 from brand_studio_outputs where job_id = $1', [created.job.id])).rows).toHaveLength(2);
    expect((await jobsOf())[0]!.usage_krw).toBe(16 * STUDIO_CREDIT_KRW);
  });

  it('takes nothing when the engine returns no version, fails or blocks the description (no rewording retry)', async () => {
    for (const marker of ['[[fake:none]]', '[[fake:fail]]', '[[fake:reject]]']) {
      const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ prompt: `Calm piano ${marker}` }));
      if (!('job' in created)) throw new Error(JSON.stringify(created));
      await run(created.job.id);
      const job = (await jobsOf()).find((j) => j.id === created.job.id)!;
      expect(job.status, marker).toBe('failed');
      expect(job.usage_krw, marker).toBe(0);
      if (marker === '[[fake:reject]]') expect(job.error_code).toBe('provider_rejected');
    }
    expect(deps.intel.calls.enhance).toBe(0);
  });

  it('refuses a description naming a real singer before reserving anything', async () => {
    const answer = await createStudioJob(deps, viewerOf(f.ids.owner), music({ prompt: 'BTS 느낌의 신나는 곡' }));
    expect(answer).toEqual({ ok: false, code: 'invalid', blocked: 'name' });
    expect(await jobsOf()).toHaveLength(0);
  });

  it('answers a retried press with the same job, reserving once', async () => {
    const same = music();
    const first = await createStudioJob(deps, viewerOf(f.ids.owner), same);
    const again = await createStudioJob(deps, viewerOf(f.ids.owner), same);
    if (!('job' in first) || !('job' in again)) throw new Error('created');
    expect(again.job.id).toBe(first.job.id);
    expect(await jobsOf()).toHaveLength(1);
  });

  it('runs on the API lane even when the brand prefers the account lane', async () => {
    deps = studioDeps(f.sql, { env: env({ BRAND_STUDIO_DEFAULT_LANE: 'sunra_mcp' }) });
    await f.sql.query("insert into brand_studio_lanes (lane, heartbeat_at) values ('sunra_mcp', now()) on conflict (lane) do update set heartbeat_at = now()").catch(() => undefined);
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    expect((await jobsOf())[0]!.lane).toBe('sunra_api');
  });

  it('keeps viewers, guests, outsiders, sound-closed and sandboxed brands out', async () => {
    expect(await createStudioJob(deps, viewerOf(f.ids.viewer), music())).toEqual({ ok: false, code: 'forbidden' });
    for (const who of [f.ids.guest, f.ids.outsider]) expect(await createStudioJob(deps, viewerOf(who), music())).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query("insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['sound']::text[], $2)", [f.orgId, f.ids.admin]);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music())).toEqual({ ok: false, code: 'feature_unavailable' });
    for (const org of [{ id: [...SANDBOXED_CLIENT_ORG_IDS][1]! as string, name: 'Client' }, { id: randomUUID() as string, name: '모픽 스튜디오' }]) {
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org.id, org.name, f.ids.owner, randomUUID()]);
      await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [org.id, f.ids.owner]);
      expect(await runStudioOperation(deps, viewerOf(f.ids.owner), 'job.create', { ...music(), organizationId: org.id })).toEqual({ ok: false, code: 'feature_unavailable' });
    }
    expect(await jobsOf()).toHaveLength(0);
  });

  it('keeps the first browser’s waveform, for audio results only', async () => {
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in created)) throw new Error('created');
    await run(created.job.id);
    const [first] = (await f.sql.query<{ id: string }>('select id from brand_studio_outputs where job_id = $1 order by idx', [created.job.id])).rows;
    const save = (peaks: unknown, who = f.ids.viewer, outputId = first!.id) =>
      runStudioOperation(deps, viewerOf(who), 'output.waveform', { organizationId: f.orgId, outputId, peaks });
    expect(await save([0, 0.5, 1])).toEqual({ ok: true });
    expect(await save([1, 1, 1])).toEqual({ ok: true });
    const stored = (await f.sql.query<{ waveform: number[] }>('select waveform from brand_studio_outputs where id = $1', [first!.id])).rows[0]!.waveform;
    expect(stored).toEqual([0, 0.5, 1]);
    expect(await save([2])).toEqual({ ok: false, code: 'invalid' });
    expect(await save([0.5], f.ids.outsider)).toEqual({ ok: false, code: 'not_found' });
    expect(await save([0.5], f.ids.viewer, randomUUID())).toEqual({ ok: false, code: 'not_found' });
    deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake' }) });
    expect(await save([0.5])).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('migrations 0172 and 0173', () => {
  it('widens the kinds and adds the waveform column, with its glue pair', () => {
    const core = readFileSync(join(ROOT, 'supabase/migrations/0172_core_brand_studio_sound.sql'), 'utf8');
    expect(core).toContain("'music','sound_effect'");
    expect(core).toContain("check (kind in ('image','video','audio'))");
    expect(core).toContain('add column if not exists waveform jsonb');
    const glue = readFileSync(join(ROOT, 'supabase/migrations/0173_glue_brand_studio_sound.sql'), 'utf8');
    expect(glue).toContain('force row level security');
  });
});
