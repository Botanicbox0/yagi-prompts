import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FilmSheet } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { writeCachedFilmSheet } from '@/lib/brand-studio/film-sheet';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { loadSoundVideos } from '@/lib/brand-studio/sound/load';
import { resetMusicBlocks } from '@/lib/brand-studio/sound/warnings';
import { cutsOf, CUTS_MAX, videoDesignLine, videoFitOf, videoStructure, videoTargetSeconds } from '@/lib/brand-studio/sound/video-fit';
import { requestId, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SA4 (docs/BRAND-SOUND-STUDIO.md §12.2, §12.6): fitting music to a library video. Its stored
 * length is the target and sets the structure, the cuts of a film sheet the library already keeps shape the design
 * in words, nothing is analyzed anew, and the amount of lyrics changes with the video's length.
 */
const sheet = (seconds: number, starts: number[]): FilmSheet =>
  ({
    seconds,
    aspect: '9:16',
    shots: starts.map((start, i) => ({ start, end: starts[i + 1] ?? seconds, framing: 'medium', camera: 'static', action: 'a person walks' })),
    look: 'warm',
    audio: 'none',
    summary: '요약',
  }) as unknown as FilmSheet;

describe('reading a video’s fit', () => {
  it('keeps the shot starts after zero, inside the video, in order, at most the cap', () => {
    expect(cutsOf([{ start: 0 }, { start: 4.04 }, { start: 2 }, { start: 2 }, { start: 11.9 }, { start: 30 }], 12)).toEqual([2, 4]);
    expect(cutsOf(Array.from({ length: 40 }, (_, i) => ({ start: i + 1 })), 60)).toHaveLength(CUTS_MAX);
  });

  it('sets the target from the length and the structure from the target', () => {
    expect(videoTargetSeconds({ seconds: 14.6 })).toBe(15);
    expect(videoTargetSeconds({ seconds: 2 })).toBe(5);
    expect(videoTargetSeconds({ seconds: 900 })).toBe(240);
    expect(videoStructure({ seconds: 14.6 })).toBe('hook');
    expect(videoStructure({ seconds: 45 })).toBe('hook-verse');
    expect(videoStructure({ seconds: 95 })).toBe('full');
  });

  it('tells the Architect where the cuts fall, as parts of the length', () => {
    const line = videoDesignLine({ assetId: 'x', seconds: 20, cuts: [5, 10, 15] });
    expect(line).toContain('about 20 seconds');
    expect(line).toContain('3 cuts, at 25%, 50%, 75%');
    expect(line).toContain('never in seconds');
    expect(videoDesignLine({ assetId: 'x', seconds: 10, cuts: [] })).not.toContain('cut');
  });
});

describe('music fitted to a library video', () => {
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
  const music = (over: Record<string, unknown> = {}) => ({
    kind: 'music',
    organizationId: f.orgId,
    requestId: requestId(),
    prompt: '밝은 어쿠스틱 팝',
    vocal: true,
    lyrics: '하나\n\n둘\n\n셋',
    architect: false,
    lyricsBy: { flow: 'topic', model: 'gemini-4-argon' },
    ...over,
  });
  const params = async (id: string) =>
    (await f.sql.query<{ params: { music: Record<string, unknown> } }>('select params from brand_studio_jobs where id = $1', [id])).rows[0]!.params.music;

  beforeEach(async () => {
    resetFreeIntelRateLimits();
    resetMusicBlocks();
    sent.length = 0;
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  it('reads the stored length and the kept film sheet, never a video of another organization', async () => {
    const deps = studioDeps(f.sql);
    const video = await seedVideoAsset(deps, f.orgId, f.ids.owner, 12);
    expect(await videoFitOf(f.sql, { organizationId: f.orgId, assetId: video, locale: 'ko' })).toEqual({ assetId: video, seconds: 12, cuts: [] });
    await writeCachedFilmSheet(f.sql, { organizationId: f.orgId, assetId: video, locale: 'en', sheet: sheet(12, [0, 3, 6.5, 9]) });
    expect((await videoFitOf(f.sql, { organizationId: f.orgId, assetId: video, locale: 'ko' }))?.cuts).toEqual([3, 6.5, 9]);
    const other = await studioFixture();
    try {
      expect(await videoFitOf(f.sql, { organizationId: other.orgId, assetId: video, locale: 'ko' })).toBeNull();
    } finally {
      await other.db.close();
    }
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [video]);
    expect(await videoFitOf(f.sql, { organizationId: f.orgId, assetId: video, locale: 'ko' })).toBeNull();
  });

  it('lists the organization’s videos with a length for the picker', async () => {
    const deps = studioDeps(f.sql);
    const video = await seedVideoAsset(deps, f.orgId, f.ids.owner, 30);
    expect(await loadSoundVideos(f.sql, deps.media, f.orgId)).toEqual([{ assetId: video, name: 'ref film', seconds: 30, thumbUrl: null }]);
  });

  it('keeps the fit with the run: target, structure, cuts, and the marks the structure gives', async () => {
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never });
    const video = await seedVideoAsset(deps, f.orgId, f.ids.owner, 14);
    await writeCachedFilmSheet(f.sql, { organizationId: f.orgId, assetId: video, locale: 'ko', sheet: sheet(14, [0, 7]) });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music({ videoAssetId: video }));
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    expect(await params(created.job.id)).toMatchObject({ targetSeconds: 14, structure: 'hook', video: { assetId: video, seconds: 14, cuts: [7] } });
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect(sent[0]!.body.lyrics).toBe('[Chorus]\n하나\n\n[Chorus]\n둘\n\n[Outro]\n셋');
    // A video that is not this organization's: refused before anything is reserved.
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ videoAssetId: '00000000-0000-4000-8000-00000000abcd' }))).toEqual({ ok: false, code: 'invalid' });
  });

  it('sizes drafted lyrics by the video: a longer video asks for more', async () => {
    const asked: string[] = [];
    const fetchStub = (async (_url: string, init: RequestInit) => {
      asked.push(JSON.parse(String(init.body)).contents[0].parts[0].text);
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ stanzas: [['하나'], ['둘']] }) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', BRAND_SOUND_STUDIO: 'on' }), intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    const short = await seedVideoAsset(deps, f.orgId, f.ids.owner, 12);
    const long = await seedVideoAsset(deps, f.orgId, f.ids.owner, 45);
    const draft = (videoAssetId: string) =>
      runStudioOperation(deps, viewerOf(f.ids.owner), 'lyrics.draft', { organizationId: f.orgId, topic: '아침 광고', language: 'ko', seconds: 60, videoAssetId });
    await draft(short);
    await draft(long);
    const range = (text: string) => {
      const byTempo = JSON.parse(text.split('\n\nThe previous answer')[0]!).stanzasByTempo as Record<string, string[]>;
      const fast = byTempo[Object.keys(byTempo).find((k) => k.startsWith('fast'))!]!;
      return fast.reduce((sum, stanza) => sum + Number(/: (\d+) lines$/.exec(stanza)![1]), 0);
    };
    const first = asked[0]!;
    const later = asked.find((text) => JSON.parse(text.split('\n\nThe previous answer')[0]!).lengthSeconds === 45)!;
    expect(JSON.parse(first.split('\n\nThe previous answer')[0]!).lengthSeconds).toBe(12);
    // Lines at the fast band (§12.11): 12 s at 118 BPM is 3 lines (one hook); 45 s is 11 over hook and verse.
    expect(range(first)).toBe(3);
    expect(range(later)).toBe(11);
  });

  it('gives the design preview the video’s length and cuts', async () => {
    const systems: string[] = [];
    const fetchStub = (async (_url: string, init: RequestInit) => {
      systems.push(JSON.parse(String(init.body)).systemInstruction.parts[0].text);
      throw new Error('stop after reading the request');
    }) as unknown as typeof fetch;
    const deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', BRAND_SOUND_STUDIO: 'on' }), intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    const video = await seedVideoAsset(deps, f.orgId, f.ids.owner, 20);
    await writeCachedFilmSheet(f.sql, { organizationId: f.orgId, assetId: video, locale: 'ko', sheet: sheet(20, [0, 5, 10, 15]) });
    const out = await runStudioOperation(deps, viewerOf(f.ids.owner), 'music.design', { organizationId: f.orgId, prompt: '밝은 팝', videoAssetId: video });
    expect(out).toMatchObject({ ok: true, design: { source: 'fallback' } });
    expect(systems[0]).toContain('The music goes under a video of about 20 seconds. It has 3 cuts, at 25%, 50%, 75% of its length.');
  });
});
