import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeShotMatchMatrices,
  extractColorProfileFromRgba,
  generate33CubeLutFromSpec,
} from '@/lib/brand-studio/compose/color-grade';
import {
  buildFcp7Xml,
  layoutNleFrames,
  planNleMedia,
} from '@/lib/brand-studio/compose/nle-export';
import {
  applyTimelinePatches,
  extractProjectReferencedAssetIds,
  frameStateAtTime,
  parseStoredProject,
  projectDurationSec,
  serializeProjectForStorage,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import {
  COMMERCIAL_MUSIC_NOTICE_EN,
  COMMERCIAL_MUSIC_NOTICE_KO,
  generateReferenceMusic,
  generateSoundEffect,
  getSfxJobStatus,
  resolveMusicProviderId,
  selectMusicProvider,
  sfxCredits,
} from '@/lib/brand-studio/music';
import { studioEnv } from '@/lib/brand-studio/env';
import { usedKrwIn, studioMonthWindow } from '@/lib/brand-studio/usage';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';

function makeSolidRgb(r: number, g: number, b: number) {
  const buf = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return extractColorProfileFromRgba(buf);
}

describe('Pro Suite Pillar 3 — 5-Lane NLE, Shot-Match LUT, Commercial Sunra Music & SFX', () => {
  let f: StudioFixture | null = null;

  afterEach(async () => {
    if (f) {
      await f.db.close();
      f = null;
    }
  });

  it('applies all 9 NLE pro patches (V2 overlays, speed, slip, J/L offset, transitions, A2 SFX) and exports valid FCP7 XML v4', () => {
    const ovAssetId = randomUUID();
    const sfxAssetId = randomUUID();
    const initial: ComposerProject = {
      version: 1,
      aspect: '9:16',
      clips: [
        {
          id: 'clip-1',
          label: 'Opening Hero',
          sourceKind: 'asset',
          assetId: randomUUID(),
          srcUrl: 'https://media.example.com/clips/1.mp4',
          durationSec: 12,
          trimStartSec: 0,
          trimEndSec: 6,
          volume: 1,
          muted: false,
        },
        {
          id: 'clip-2',
          label: 'Texture Reveal',
          sourceKind: 'asset',
          assetId: randomUUID(),
          srcUrl: 'https://media.example.com/clips/2.mp4',
          durationSec: 12,
          trimStartSec: 0,
          trimEndSec: 8,
          volume: 0.9,
          muted: false,
        },
      ],
      captions: [{ id: 'cap-1', text: 'Hydra Mist', startSec: 0, endSec: 2, position: 'bottom', size: 'md' }],
      bgm: {
        label: 'Night Score',
        sourceKind: 'asset',
        assetId: randomUUID(),
        srcUrl: 'https://media.example.com/audio/night.mp3',
        durationSec: 30,
        trimStartSec: 0,
        volume: 0.45,
      },
      colorGrade: null,
    };

    const patched = applyTimelinePatches(initial, [
      { op: 'set_clip_speed', clipIndex: 0, playbackRate: 2 },
      { op: 'slip_clip', clipIndex: 1, deltaSec: 2 },
      { op: 'set_clip_audio_offset', clipIndex: 1, audioOffsetSec: -0.5 },
      { op: 'set_clip_transition', clipIndex: 1, transitionIn: 'cross_dissolve', transitionDurationSec: 0.6 },
      {
        op: 'add_overlay',
        label: 'Brand Logo Badge',
        sourceKind: 'asset',
        assetId: ovAssetId,
        srcUrl: 'https://media.example.com/overlays/badge.png',
        mediaKind: 'image',
        startSec: 0.5,
        endSec: 2.5,
        x: 0.8,
        y: 0.2,
        scale: 0.35,
        opacity: 0.9,
      },
      {
        op: 'add_sfx',
        label: 'Glass Whoosh',
        sourceKind: 'asset',
        assetId: sfxAssetId,
        srcUrl: 'https://media.example.com/sfx/whoosh.mp3',
        startSec: 1.0,
        durationSec: 1.5,
        volume: 0.8,
      },
      { op: 'set_sfx_volume', sfxIndex: 0, volume: 0.55 },
    ]);

    expect(patched.appliedCount).toBe(7);
    const p = patched.project;
    expect(p.clips[0]!.playbackRate).toBe(2);
    expect(projectDurationSec(p)).toBe(11); // 6 / 2 + 8 = 11s
    expect(p.clips[1]!.trimStartSec).toBe(2);
    expect(p.clips[1]!.trimEndSec).toBe(10);
    expect(p.clips[1]!.audioOffsetSec).toBe(-0.5);
    expect(p.clips[1]!.transitionIn).toBe('cross_dissolve');
    expect(p.overlays).toHaveLength(1);
    expect(p.sfxClips).toHaveLength(1);
    expect(p.sfxClips![0]!.volume).toBe(0.55);

    const at12 = frameStateAtTime(p, 1.2);
    expect(at12.activeOverlays).toHaveLength(1);
    expect(at12.activeSfx).toHaveLength(1);

    const refs = extractProjectReferencedAssetIds(p);
    expect(refs).toContain(ovAssetId.toLowerCase());
    expect(refs).toContain(sfxAssetId.toLowerCase());

    const stored = serializeProjectForStorage(p);
    const restored = parseStoredProject(stored);
    expect(restored).not.toBeNull();
    expect(restored!.clips[0]!.playbackRate).toBe(2);
    expect(restored!.clips[1]!.audioOffsetSec).toBe(-0.5);
    expect(restored!.clips[1]!.transitionIn).toBe('cross_dissolve');
    expect(restored!.overlays).toHaveLength(1);
    expect(restored!.sfxClips![0]!.volume).toBe(0.55);

    // Export XML v4 with V2 overlay, Time Remap, Cross Dissolve, J-cut audio offset, and stereo SFX
    const nleOpts = { projectTitle: 'Pro Cut', fps: 30 as const };
    const plan = planNleMedia(p, nleOpts);
    expect(plan.overlaySources).toHaveLength(1);
    expect(plan.sfxSources).toHaveLength(1);
    const layout = layoutNleFrames(p, nleOpts);
    expect(layout.clips[0]!.endFrame).toBe(90);
    const xml = buildFcp7Xml(p, nleOpts);
    expect(xml).toContain('<effectid>timeremap</effectid>');
    expect(xml).toContain('<transitionitem>');
    expect(xml).toContain('<name>Cross Dissolve</name>');
    expect(xml).toContain('<clipitem id="clipitem-v2-1">');
    expect(xml).toContain('<clipitem id="clipitem-sfx-1-a1">');
    expect(xml).toContain('<clipitem id="clipitem-sfx-1-a2">');
    // Second clip audio track shifts earlier by 0.5s (15 frames): video starts @ 90 -> audio @ 75
    expect(xml).toContain('<clipitem id="clipitem-2-a1">');
    expect(xml).toMatch(/<clipitem id="clipitem-2-a1">[\s\S]*?<start>75<\/start>/);

    // Clearing overlays & SFX strips empty arrays cleanly
    const cleared = applyTimelinePatches(p, [
      { op: 'remove_overlay', overlayIndex: 'all' },
      { op: 'remove_sfx', sfxIndex: 'all' },
    ]).project;
    expect(cleared.overlays).toBeUndefined();
    expect(cleared.sfxClips).toBeUndefined();
  });

  it('computes shot-matching Reinhard matrices with anchor identity and generates 33^3 .cube LUT (35,937 triplets)', () => {
    const warmAnchor = makeSolidRgb(215, 165, 118);
    const coolClip = makeSolidRgb(125, 145, 185);
    const flatClip = makeSolidRgb(150, 150, 150);

    const matched = computeShotMatchMatrices(
      [
        { clipId: 'clip-1', profile: coolClip },
        { clipId: 'clip-2', profile: warmAnchor },
        { clipId: 'clip-3', profile: flatClip },
      ],
      1,
      { intensity: 0.9, skinProtect: 0.8 },
    );

    expect(matched).toHaveLength(3);
    expect(matched[1]!.isAnchor).toBe(true);
    expect(matched[1]!.cssFilter).toBe('none');
    expect(matched[1]!.transferMatrix).toEqual([
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 1, 0,
    ]);
    expect(matched[0]!.isAnchor).toBe(false);
    expect(matched[0]!.skinProtectApplied).toBe(0.8);
    expect(matched[0]!.cssFilter).toContain('brightness(');
    expect(matched[0]!.cssFilter).toContain('saturate(');

    const lut = generate33CubeLutFromSpec(
      {
        enabled: true,
        scope: 'full_timeline',
        targetClipId: null,
        presetId: 'twings-french-blue',
        referenceProfile: warmAnchor,
        intensity: 0.85,
        skinProtect: 0.7,
        halation: 0.06,
        grain: 1.5,
      },
      'Brand Anchor Match',
    );
    const lines = lut.trimEnd().split('\n');
    expect(lines[0]).toBe('TITLE "Brand Anchor Match"');
    expect(lines[1]).toBe('LUT_3D_SIZE 33');
    expect(lines[2]).toBe('DOMAIN_MIN 0.0 0.0 0.0');
    expect(lines[3]).toBe('DOMAIN_MAX 1.0 1.0 1.0');
    const dataRows = lines.slice(5);
    expect(dataRows).toHaveLength(33 * 33 * 33);
    expect(dataRows[0]).toMatch(/^\d\.\d{6} \d\.\d{6} \d\.\d{6}$/);
  });

  it('routes commercial Sunra ElevenLabs music with strict prompt XOR composition_plan & 59.5s clamp, and eliminates non-fake synth fallback', async () => {
    expect(resolveMusicProviderId({ SUNRA_API_KEY: 'sk-sunra-test' })).toBe('sunra_elevenlabs');

    const submittedPayloads: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    let pollStep = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/queue/elevenlabs/music-v2.5/text-to-music') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        submittedPayloads.push({ endpoint: url, body });
        return new Response(JSON.stringify({ request_id: 'sunra-music-req-1', status: 'IN_QUEUE' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/queue/requests/sunra-music-req-1/status')) {
        pollStep += 1;
        return new Response(
          JSON.stringify({
            request_id: 'sunra-music-req-1',
            status: pollStep === 1 ? 'IN_PROGRESS' : 'COMPLETED',
            success: pollStep > 1 ? true : null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/v1/queue/requests/sunra-music-req-1')) {
        return new Response(
          JSON.stringify({
            request_id: 'sunra-music-req-1',
            status: 'COMPLETED',
            success: true,
            audio: { url: 'https://cdn.example/music-commercial.mp3' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const provider = selectMusicProvider({ SUNRA_API_KEY: 'sk-sunra-test' }, { fetchImpl });
    expect(provider.id).toBe('sunra_elevenlabs');
    expect(provider.commercialAllowed).toBe(true);

    const first = await provider.submit({
      stylePrompt: 'luxury silver synth pulse',
      userPrompt: 'Skincare bottle reveal score',
      bpm: 122,
      keySignature: 'Dm',
      durationSec: 75,
      revealSec: 2.5,
      preDropHushMs: 180,
      abcNotation: '',
      refAudioUrl: null,
    });
    expect(first).toMatchObject({
      ok: true,
      status: 'running',
      providerTaskId: 'sunra-music-req-1',
      commercialAllowed: true,
      licenseSource: 'commercial_licensed',
    });
    expect(submittedPayloads[0]!.endpoint).toContain('/v1/queue/elevenlabs/music-v2.5/text-to-music');
    expect(submittedPayloads[0]!.body).toMatchObject({
      music_length_ms: 59_500,
      force_instrumental: true,
      output_format: 'mp3_44100_128',
    });
    expect(submittedPayloads[0]!.body).toHaveProperty('prompt');
    expect(submittedPayloads[0]!.body).not.toHaveProperty('composition_plan');

    // Exclusive XOR contract check for compositionPlan
    const second = await provider.submit({
      stylePrompt: 'ignored when plan present',
      userPrompt: 'ignored when plan present',
      bpm: 120,
      keySignature: 'Am',
      durationSec: 20,
      revealSec: 3,
      preDropHushMs: 150,
      abcNotation: '',
      refAudioUrl: null,
      compositionPlan: {
        positiveGlobalStyles: ['minimal electronic'],
        negativeGlobalStyles: ['vocals'],
        sections: [
          {
            sectionName: 'Intro',
            positiveLocalStyles: ['soft shimmer pad'],
            negativeLocalStyles: [],
            durationMs: 8000,
            lines: [],
          },
        ],
      },
    });
    expect(second).toMatchObject({ ok: true, status: 'running', commercialAllowed: true });
    expect(submittedPayloads[1]!.body).toHaveProperty('composition_plan');
    expect(submittedPayloads[1]!.body).not.toHaveProperty('prompt');

    const poll1 = await provider.poll('sunra-music-req-1');
    expect(poll1).toEqual({ ok: true, status: 'running' });
    const poll2 = await provider.poll('sunra-music-req-1');
    expect(poll2).toEqual({
      ok: true,
      status: 'succeeded',
      audioUrl: 'https://cdn.example/music-commercial.mp3',
      mime: 'audio/mpeg',
    });

    // Offline local_yue2 must NOT silently synthesize fake preview WAV; refunds 100%
    f = await studioFixture({ capKrw: 1_000_000 });
    // Music generation open, so the provider (not the closed flag) is what this case exercises.
    const deps = studioDeps(f.sql, {
      env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_STUDIO_MUSIC_GENERATION: 'on' }),
    });
    const offline = await generateReferenceMusic(
      deps,
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, requestId: 'mus_no_synth_01', durationSec: 12 },
      { env: { BRAND_STUDIO_MUSIC_PROVIDER: 'local_yue2', NODE_ENV: 'production' } },
    );
    expect(offline).toMatchObject({ ok: false, code: 'provider_unavailable', refunded: true });
    expect(await usedKrwIn(f.sql, f.orgId, studioMonthWindow(new Date()))).toBe(0);
  });

  it('generates and polls commercial SFX via Sunra ElevenLabs and refunds 100% on upstream failure without vendor leaks', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    const deps = studioDeps(f.sql);

    const sfxBodies: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/queue/elevenlabs/sound-effects/text-to-sound-effects') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        sfxBodies.push({ endpoint: url, body });
        return new Response(JSON.stringify({ request_id: 'sunra-sfx-task-1', status: 'IN_QUEUE' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/queue/requests/sunra-sfx-task-1/status')) {
        return new Response(
          JSON.stringify({ request_id: 'sunra-sfx-task-1', status: 'COMPLETED', success: true }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/v1/queue/requests/sunra-sfx-task-1')) {
        return new Response(
          JSON.stringify({
            request_id: 'sunra-sfx-task-1',
            status: 'COMPLETED',
            success: true,
            audio: { url: 'https://cdn.example/whoosh.mp3' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === 'https://cdn.example/whoosh.mp3') {
        return new Response(new Uint8Array([73, 68, 51, 3, 0, 0, 0, 0, 0, 1]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      throw new Error(`Unexpected SFX fetch: ${url}`);
    };

    const submitted = await generateSoundEffect(
      deps,
      viewerOf(f.ids.owner),
      {
        organizationId: f.orgId,
        requestId: 'sfx_commercial_01',
        text: 'crisp glass bottle click',
        durationSec: 4,
        promptInfluence: 0.6,
      },
      { env: { SUNRA_API_KEY: 'sk-sunra-test' }, fetchImpl },
    );

    expect(submitted).toMatchObject({
      ok: true,
      status: 'running',
      commercialAllowed: true,
      creditsUsed: sfxCredits(4),
    });
    expect(sfxBodies[0]!.endpoint).toContain('/v1/queue/elevenlabs/sound-effects/text-to-sound-effects');
    expect(sfxBodies[0]!.body).toEqual({
      text: 'crisp glass bottle click',
      duration_seconds: 4,
      prompt_influence: 0.6,
    });
    if (!submitted.ok) throw new Error('expected sfx submit ok');

    const done = await getSfxJobStatus(
      deps,
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, jobId: submitted.jobId },
      { env: { SUNRA_API_KEY: 'sk-sunra-test' }, fetchImpl },
    );
    expect(done).toMatchObject({
      ok: true,
      status: 'succeeded',
      commercialAllowed: true,
      licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
      licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
    });
    expect(COMMERCIAL_MUSIC_NOTICE_KO).not.toMatch(/elevenlabs|sunra|yue2|sheetsage/i);
    expect(COMMERCIAL_MUSIC_NOTICE_EN).not.toMatch(/elevenlabs|sunra|yue2|sheetsage/i);
    if (!done.ok) throw new Error('expected sfx status ok');
    expect(done.assetId).toBeTruthy();

    // Upstream failure triggers automatic 100% credit refund
    const failFetch: typeof fetch = async () => new Response('upstream error', { status: 503 });
    const beforeFailUsed = await usedKrwIn(f.sql, f.orgId, studioMonthWindow(new Date()));
    const failed = await generateSoundEffect(
      deps,
      viewerOf(f.ids.owner),
      {
        organizationId: f.orgId,
        requestId: 'sfx_fail_refund_01',
        text: 'metallic riser',
        durationSec: 5,
      },
      { env: { SUNRA_API_KEY: 'sk-sunra-test' }, fetchImpl: failFetch },
    );
    expect(failed).toMatchObject({ ok: false, code: 'provider_unavailable', refunded: true });
    expect(await usedKrwIn(f.sql, f.orgId, studioMonthWindow(new Date()))).toBe(beforeFailUsed);
  });
});
