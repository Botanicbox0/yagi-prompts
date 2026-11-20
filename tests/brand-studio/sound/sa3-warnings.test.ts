import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { runStudioOperation } from '@/lib/brand-studio/service';
import {
  FAKE_EXISTING,
  judgeExistingLyrics,
  lyricsMark,
  MUSIC_BLOCK_LIMITS,
  musicPaused,
  noteMusicBlock,
  resetMusicBlocks,
} from '@/lib/brand-studio/sound/warnings';
import { studioSoundEn, studioSoundKo } from '@/messages/studio-sound';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SA3 (docs/BRAND-SOUND-STUDIO.md §12.5, §12.6): warnings. Blocks before a press reserve nothing
 * and count toward a short pause; lyrics that read like a known song are judged before credits are held; an engine
 * refusal costs nothing, is never retried quietly, and offers "다르게 설계하기"; many refusals in a day make the checks
 * stricter; the record never keeps the lyrics.
 */
const LYRICS = '햇살 같은 하루\n\n같이 걸어요';

describe('the pause after repeated blocks', () => {
  beforeEach(() => resetMusicBlocks());

  it('pauses an organization for a minute after three blocks in ten minutes', () => {
    const t0 = 1_000_000;
    expect(noteMusicBlock('org-a', t0)).toBe(false);
    expect(noteMusicBlock('org-a', t0 + 60_000)).toBe(false);
    expect(musicPaused('org-a', t0 + 61_000)).toBe(false);
    expect(noteMusicBlock('org-a', t0 + 120_000)).toBe(true);
    expect(musicPaused('org-a', t0 + 120_000 + MUSIC_BLOCK_LIMITS.pauseMs - 1)).toBe(true);
    expect(musicPaused('org-b', t0 + 120_001)).toBe(false);
    expect(musicPaused('org-a', t0 + 120_000 + MUSIC_BLOCK_LIMITS.pauseMs)).toBe(false);
    // Blocks spread wider than the window never add up.
    expect(noteMusicBlock('org-c', t0)).toBe(false);
    expect(noteMusicBlock('org-c', t0 + MUSIC_BLOCK_LIMITS.windowMs + 1)).toBe(false);
    expect(noteMusicBlock('org-c', t0 + 2 * MUSIC_BLOCK_LIMITS.windowMs + 2)).toBe(false);
  });

  it('records the length and a short fingerprint of lyrics, never the words', () => {
    const mark = lyricsMark(LYRICS);
    expect(mark).toEqual({ lyricsLength: LYRICS.length, lyricsFingerprint: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(JSON.stringify(mark)).not.toContain('햇살');
    expect(lyricsMark('  ')).toEqual({});
  });
});

describe('the lyrics judgment', () => {
  const config = { apiKey: 'k', baseUrl: 'https://example.invalid/v1beta', model: 'gemini-4-argon' };
  const answer = (body: unknown) =>
    (async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }] }), { status: 200 })) as unknown as typeof fetch;

  it('blocks only a confident "existing"; an error lets the press go on', async () => {
    expect(await judgeExistingLyrics(LYRICS, config, answer({ existing: true, confidence: 0.9 }))).toBe('existing');
    expect(await judgeExistingLyrics(LYRICS, config, answer({ existing: true, confidence: 0.4 }))).toBe('original');
    expect(await judgeExistingLyrics(LYRICS, config, answer({ existing: false, confidence: 0.99 }))).toBe('original');
    expect(await judgeExistingLyrics(LYRICS, config, (() => Promise.reject(new Error('timeout'))) as typeof fetch)).toBe('unknown');
  });
});

describe('music requests with warnings', () => {
  let f: StudioFixture;
  const logs: Array<{ event: string; detail: Record<string, unknown> }> = [];
  let clock = new Date('2026-11-21T03:00:00.000Z');
  const env = (extra: Record<string, string> = {}) => studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', ...extra });
  const depsWith = (over: Record<string, unknown> = {}) =>
    studioDeps(f.sql, { env: env(), now: () => clock, log: (event: string, detail?: Record<string, unknown>) => void logs.push({ event, detail: detail ?? {} }), ...over });
  const music = (over: Record<string, unknown> = {}) => ({ kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: '밝은 어쿠스틱 팝', vocal: true, lyrics: LYRICS, ...over });
  const rows = async () =>
    (await f.sql.query<{ id: string; status: string; error_code: string | null; usage_krw: number | null; enhance: boolean; work: Record<string, unknown> }>(
      'select * from brand_studio_jobs where organization_id = $1',
      [f.orgId],
    )).rows;
  const blockedLogs = () => logs.filter((l) => l.event === 'studio_music_blocked').map((l) => l.detail);

  beforeEach(async () => {
    resetMusicBlocks();
    resetFreeIntelRateLimits();
    logs.length = 0;
    clock = new Date('2026-11-21T03:00:00.000Z');
    f = await studioFixture();
  });
  afterEach(async () => {
    resetMusicBlocks();
    await f.db.close();
  });

  it('stops lyrics judged as a known song before anything is reserved, and logs no words', async () => {
    const deps = depsWith();
    const out = await createStudioJob(deps, viewerOf(f.ids.owner), music({ lyrics: `${LYRICS} ${FAKE_EXISTING}` }));
    expect(out).toEqual({ ok: false, code: 'invalid', blocked: 'lyrics' });
    expect(await rows()).toHaveLength(0);
    const [record] = blockedLogs();
    expect(record).toMatchObject({ organizationId: f.orgId, userId: f.ids.owner, field: 'lyrics', check: 'judge', lyricsLength: expect.any(Number) });
    expect(JSON.stringify(record)).not.toContain('햇살');
  });

  it('asks the text model about the customer’s own lyrics, not about a draft written to our rules', async () => {
    const calls: string[] = [];
    const judge = (existing: boolean) =>
      (async (url: string) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ existing, confidence: 0.95 }) }] } }] }), { status: 200 });
      }) as unknown as typeof fetch;
    const live = (existing: boolean) => depsWith({ intelDeps: { fetch: judge(existing), env: { GEMINI_API_KEY: 'k' } } });
    expect(await createStudioJob(live(true), viewerOf(f.ids.owner), music())).toEqual({ ok: false, code: 'invalid', blocked: 'lyrics' });
    expect(calls[0]).toContain('/models/gemini-4-argon:generateContent');
    expect(await createStudioJob(live(false), viewerOf(f.ids.owner), music())).toMatchObject({ ok: true });
    const before = calls.length;
    expect(await createStudioJob(live(true), viewerOf(f.ids.owner), music({ lyricsBy: { flow: 'topic', model: 'gemini-4-argon' } }))).toMatchObject({ ok: true });
    expect(calls).toHaveLength(before);
    // Polished lyrics are still the customer's: judged.
    expect(await createStudioJob(live(true), viewerOf(f.ids.owner), music({ lyricsBy: { flow: 'polish', model: 'gemini-4-argon' } }))).toMatchObject({ blocked: 'lyrics' });
  });

  it('pauses the organization after three blocks, then lets it go after a minute', async () => {
    const deps = depsWith();
    for (let i = 0; i < 3; i += 1) expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ prompt: 'BTS 스타일 응원가' }))).toMatchObject({ blocked: 'name' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music())).toEqual({ ok: false, code: 'too_many_running', blocked: 'paused' });
    expect(await rows()).toHaveLength(0);
    expect(blockedLogs().map((r) => r.check)).toEqual(['ours', 'ours', 'ours', 'paused']);
    clock = new Date(clock.getTime() + MUSIC_BLOCK_LIMITS.pauseMs + 1);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music())).toMatchObject({ ok: true });
  });

  it('an engine refusal costs nothing, is not retried, and is recorded', async () => {
    const deps = depsWith();
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ prompt: '밝은 팝 [[fake:reject]]', architect: false }));
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    for (let i = 0; i < 6; i += 1) await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'failed', error_code: 'provider_rejected', usage_krw: 0 });
    expect(row!.work).not.toHaveProperty('blockRetry');
    expect(blockedLogs()).toEqual([expect.objectContaining({ field: 'request', check: 'engine', organizationId: f.orgId, lyricsLength: LYRICS.length })]);
  });

  it('gets stricter after more than five refusals in a day: the Architect stays on and drafts are judged', async () => {
    for (let i = 0; i < MUSIC_BLOCK_LIMITS.engineRefusalsPerDay + 1; i += 1) {
      await f.sql.query(
        `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, params, refs, estimate_usd, estimate_krw, error_code, created_at, finished_at)
          values ($1, $2, $3, 'music', 'failed', 'suno-v6', 'x', '{}'::jsonb, '[]'::jsonb, 0, 0, 'provider_rejected', $4, $4)`,
        [f.orgId, f.ids.owner, requestId(), new Date(clock.getTime() - 3600_000).toISOString()],
      );
    }
    const deps = depsWith();
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ architect: false }));
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    const mine = (await rows()).find((r) => r.id === created.job.id)!;
    expect(mine.enhance).toBe(true);
    expect(mine.work).not.toHaveProperty('prepared');
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ lyrics: `${LYRICS} ${FAKE_EXISTING}`, lyricsBy: { flow: 'topic', model: 'gemini-4-argon' } }))).toMatchObject({
      blocked: 'lyrics',
    });
  });

  it('"다르게 설계하기" asks for a design that avoids what may have been refused', async () => {
    const seen: string[] = [];
    const fetchStub = (async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)).systemInstruction.parts[0].text);
      const style =
        'Warm acoustic pop with a light feel, around 96 BPM, relaxed. A warm vocal sings softly in Korean. Fingerpicked guitar keeps a steady pulse and brushed drums keep time. A short intro, the hook arrives early.';
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ style, title: '맑은 하루', notes: 'ok' }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = depsWith({ env: env({ BRAND_STUDIO_PROVIDER: 'live' }), intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    const out = await runStudioOperation(deps, viewerOf(f.ids.owner), 'music.design', { organizationId: f.orgId, prompt: '밝은 팝', vocal: true, lyrics: LYRICS, avoid: true });
    expect(out).toMatchObject({ ok: true, design: { source: 'model' } });
    expect(seen[0]).toContain('The music engine refused a request made from these words');
    // Lyrics are never in the design request and never rewritten.
    expect(seen.join(' ')).not.toContain('햇살');
  });
});

describe('copy (§12.7 reviewed lines)', () => {
  it('adds what to do instead, and promises nothing about why', () => {
    expect(studioSoundKo.errors.artist).toContain('이름 대신 장르, 빠르기, 악기, 목소리로 설명해 주세요.');
    expect(studioSoundKo.composer.lyricsBlocked).toContain('직접 쓴 가사를 넣거나 가사 초안을 만들어 보세요.');
    expect(studioSoundKo.errors.blocked).toBe('이번 설명으로는 음악을 만들 수 없어요. 크레딧은 빠지지 않았어요.');
    expect(studioSoundKo.errors.redesign).toBe('다르게 설계하기');
    expect(studioSoundKo.errors.paused).toBe('잠시 뒤에 다시 시도해 주세요.');
    for (const copy of [studioSoundKo, studioSoundEn]) expect(JSON.stringify(copy.errors)).not.toMatch(/위반|금지된|violat|forbidden/i);
  });
});
