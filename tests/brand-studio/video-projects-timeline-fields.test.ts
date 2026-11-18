/**
 * Server-side timeline normalizer keeps every edit the editors write (`ComposerProject` in
 * `lib/brand-studio/compose/timeline.ts`): per-clip speed, J/L audio offset and incoming transition,
 * plus the overlay (V2) and sound-effect (A2) tracks. Values are clamped the way the timeline module
 * clamps them; garbage is dropped without throwing; browser-local `blob:` URLs follow the clip/BGM rule.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_COMPOSE_OVERLAYS,
  MAX_COMPOSE_SFX,
  type ComposeOverlayClip,
  type ComposeSfxClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import {
  collectMediaRefs,
  loadVideoProjects,
  normalizeStoredTimeline,
  runVideoProjectOperation,
  type VideoProjectsDeps,
} from '@/lib/brand-studio/video-projects';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';

async function seedAudioAsset(
  sql: SqlRunner,
  media: ReturnType<typeof createMemoryMediaStore>,
  orgId: string,
  byUserId: string,
): Promise<{ assetId: string; storageKey: string }> {
  const { key: storageKey } = await media.put(new Uint8Array([82, 73, 70, 70, 87, 65, 86, 69]), 'audio/wav');
  const assetId = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_assets
         (organization_id, kind, name, mime, size_bytes, duration_ms, storage_key, source, status, created_by)
       values ($1, 'audio', 'whoosh.wav', 'audio/wav', 8, 1500, $2, 'upload', 'ready', $3)
       returning id`,
      [orgId, storageKey, byUserId],
    )
  ).rows[0]!.id;
  return { assetId, storageKey };
}

async function seedVideoOutput(
  sql: SqlRunner,
  media: ReturnType<typeof createMemoryMediaStore>,
  orgId: string,
  byUserId: string,
): Promise<{ outputId: string; storageKey: string; thumbKey: string }> {
  const { key: storageKey } = await media.put(
    new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
    'video/mp4',
  );
  const { key: thumbKey } = await media.put(new Uint8Array([82, 73, 70, 70]), 'image/webp');
  const jobId = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_jobs
         (organization_id, created_by, request_id, kind, status, model, prompt, finished_at)
       values ($1, $2, $3, 'video', 'succeeded', 'seedance-2.5', 'Overlay loop', now())
       returning id`,
      [orgId, byUserId, `job_${randomUUID().slice(0, 12)}`],
    )
  ).rows[0]!.id;
  const outputId = randomUUID();
  await sql.query(
    `insert into brand_studio_outputs
       (id, job_id, organization_id, idx, kind, status, mime, width, height, duration_ms, storage_key, thumb_key)
     values ($1, $2, $3, 0, 'video', 'ready', 'video/mp4', 1080, 1920, 4000, $4, $5)`,
    [outputId, jobId, orgId, storageKey, thumbKey],
  );
  return { outputId, storageKey, thumbKey };
}

function baseClip(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    label: id,
    sourceKind: 'asset',
    srcUrl: `https://media.example/${id}.mp4`,
    thumbUrl: null,
    durationSec: 6,
    trimStartSec: 0,
    trimEndSec: 6,
    volume: 1,
    muted: false,
    ...extra,
  };
}

function baseOverlay(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    label: 'Bottle cutout',
    sourceKind: 'asset',
    srcUrl: `https://media.example/${id}.png`,
    thumbUrl: null,
    mediaKind: 'image',
    startSec: 1,
    endSec: 4,
    x: 0.5,
    y: 0.5,
    scale: 0.45,
    opacity: 1,
    ...extra,
  };
}

function baseSfx(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    label: 'Whoosh',
    sourceKind: 'asset',
    srcUrl: `https://media.example/${id}.wav`,
    startSec: 2,
    durationSec: 1.5,
    volume: 0.85,
    ...extra,
  };
}

function rawTimeline(extra: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, aspect: '9:16', clips: [], captions: [], bgm: null, colorGrade: null, ...extra };
}

describe('video project timeline normalizer keeps editor fields across save and reload', () => {
  let f: StudioFixture;
  let deps: VideoProjectsDeps;
  let media: ReturnType<typeof createMemoryMediaStore>;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture();
    media = createMemoryMediaStore();
    deps = { sql: f.sql, media };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  it('round-trips clip speed, audio offset, transitions, overlays and SFX through create, save and load', async () => {
    const studioD = studioDeps(f.sql, { media });
    const imageAssetId = await seedImageAsset(studioD, f.orgId, f.ids.owner);
    const imageKey = (
      await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [imageAssetId])
    ).rows[0]!.storage_key;
    const { outputId, storageKey: outKey, thumbKey: outThumbKey } = await seedVideoOutput(f.sql, media, f.orgId, f.ids.owner);
    const { assetId: sfxAssetId, storageKey: sfxKey } = await seedAudioAsset(f.sql, media, f.orgId, f.ids.owner);

    const timeline = rawTimeline({
      clips: [
        baseClip('clip_a', { playbackRate: 1.5, audioOffsetSec: -0.8 }),
        baseClip('clip_b', { transitionIn: 'cross_dissolve', transitionDurationSec: 0.6 }),
        baseClip('clip_c', { transitionIn: 'dip_to_black' }),
      ],
    }) as unknown as ComposerProject;

    const created = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', {
      organizationId: f.orgId,
      requestId: `vp_${randomUUID().replace(/-/g, '')}`,
      title: 'Round trip',
      timeline,
    });
    if (!created.ok || !created.project) throw new Error('expected project created');
    const [a, b, c] = created.project.timeline.clips;
    expect(a).toMatchObject({ playbackRate: 1.5, audioOffsetSec: -0.8 });
    expect(a?.transitionIn).toBeUndefined();
    expect(b).toMatchObject({ transitionIn: 'cross_dissolve', transitionDurationSec: 0.6 });
    expect(b?.playbackRate).toBeUndefined();
    expect(c).toMatchObject({ transitionIn: 'dip_to_black', transitionDurationSec: 0.4 });

    const withTracks: ComposerProject = {
      ...created.project.timeline,
      overlays: [
        baseOverlay('ovl_asset', {
          assetId: imageAssetId,
          srcUrl: 'https://stale.example/expired-cutout.png',
          x: 0.25,
          y: 0.75,
          scale: 0.3,
          opacity: 0.8,
        }),
        baseOverlay('ovl_output', {
          sourceKind: 'output',
          outputId,
          srcUrl: 'https://stale.example/expired-loop.mp4',
          mediaKind: 'video',
          startSec: 0.5,
          endSec: 2.5,
        }),
        baseOverlay('ovl_url'),
      ] as unknown as ComposeOverlayClip[],
      sfxClips: [
        baseSfx('sfx_asset', { assetId: sfxAssetId, srcUrl: 'https://stale.example/expired-whoosh.wav', volume: 0.6 }),
        baseSfx('sfx_url', { startSec: 4, durationSec: 0.8 }),
      ] as unknown as ComposeSfxClip[],
    };

    const saved = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'save', {
      organizationId: f.orgId,
      projectId: created.project.id,
      timeline: withTracks,
      expectedRevision: created.project.revision,
    });
    expect(saved.ok).toBe(true);

    // The stored JSON itself carries the fields (not only the hydrated response).
    const storedRaw = (
      await f.sql.query<{ timeline: unknown }>('select timeline from brand_studio_video_projects where id = $1', [
        created.project.id,
      ])
    ).rows[0]!.timeline;
    const stored = (typeof storedRaw === 'string' ? JSON.parse(storedRaw) : storedRaw) as ComposerProject;
    expect(stored.clips[0]).toMatchObject({ playbackRate: 1.5, audioOffsetSec: -0.8 });
    expect(stored.clips[1]).toMatchObject({ transitionIn: 'cross_dissolve', transitionDurationSec: 0.6 });
    expect(stored.overlays?.map((o) => o.id)).toEqual(['ovl_asset', 'ovl_output', 'ovl_url']);
    expect(stored.sfxClips?.map((s) => s.id)).toEqual(['sfx_asset', 'sfx_url']);

    const loaded = await loadVideoProjects(deps, viewerOf(f.ids.owner), f.orgId, created.project.id);
    if (!loaded.ok || !loaded.project) throw new Error('expected loaded project');
    const tl = loaded.project.timeline;

    expect(tl.clips[0]).toMatchObject({ playbackRate: 1.5, audioOffsetSec: -0.8 });
    expect(tl.clips[1]).toMatchObject({ transitionIn: 'cross_dissolve', transitionDurationSec: 0.6 });
    expect(tl.clips[2]).toMatchObject({ transitionIn: 'dip_to_black', transitionDurationSec: 0.4 });

    expect(tl.overlays).toHaveLength(3);
    expect(tl.overlays?.[0]).toMatchObject({
      id: 'ovl_asset',
      label: 'Bottle cutout',
      sourceKind: 'asset',
      assetId: imageAssetId,
      srcUrl: media.url(imageKey),
      mediaKind: 'image',
      startSec: 1,
      endSec: 4,
      x: 0.25,
      y: 0.75,
      scale: 0.3,
      opacity: 0.8,
    });
    expect(tl.overlays?.[1]).toMatchObject({
      id: 'ovl_output',
      sourceKind: 'output',
      outputId,
      srcUrl: media.url(outKey),
      thumbUrl: media.url(outThumbKey),
      mediaKind: 'video',
      startSec: 0.5,
      endSec: 2.5,
    });
    expect(tl.overlays?.[2]).toMatchObject({ id: 'ovl_url', srcUrl: 'https://media.example/ovl_url.png' });

    expect(tl.sfxClips).toHaveLength(2);
    expect(tl.sfxClips?.[0]).toMatchObject({
      id: 'sfx_asset',
      label: 'Whoosh',
      sourceKind: 'asset',
      assetId: sfxAssetId,
      srcUrl: media.url(sfxKey),
      startSec: 2,
      durationSec: 1.5,
      volume: 0.6,
    });
    expect(tl.sfxClips?.[1]).toMatchObject({ id: 'sfx_url', srcUrl: 'https://media.example/sfx_url.wav', startSec: 4, durationSec: 0.8 });

    // A second save of the loaded timeline is stable (nothing drifts on reload loops).
    const resaved = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'save', {
      organizationId: f.orgId,
      projectId: created.project.id,
      timeline: tl,
    });
    if (!resaved.ok || !resaved.project) throw new Error('expected resave ok');
    expect(resaved.project.timeline.clips).toEqual(tl.clips);
    expect(resaved.project.timeline.overlays).toEqual(tl.overlays);
    expect(resaved.project.timeline.sfxClips).toEqual(tl.sfxClips);
  });

  it('collects overlay and SFX media references for URL hydration', () => {
    const imageAssetId = randomUUID();
    const overlayOutputId = randomUUID();
    const sfxAssetId = randomUUID();
    const timeline = normalizeStoredTimeline(
      rawTimeline({
        overlays: [
          baseOverlay('ovl_a', { assetId: imageAssetId }),
          baseOverlay('ovl_b', { sourceKind: 'output', outputId: overlayOutputId, mediaKind: 'video' }),
        ],
        sfxClips: [baseSfx('sfx_a', { assetId: sfxAssetId })],
      }),
    );
    const refs = collectMediaRefs([timeline]);
    expect(refs.assetIds.sort()).toEqual([imageAssetId, sfxAssetId].sort());
    expect(refs.outputIds).toEqual([overlayOutputId]);
  });

  it('clamps out-of-range speed, audio offset, transition duration and overlay/SFX values like the timeline module', () => {
    const tl = normalizeStoredTimeline(
      rawTimeline({
        clips: [
          baseClip('fast', { playbackRate: 10, audioOffsetSec: 9, transitionIn: 'cross_dissolve', transitionDurationSec: 5 }),
          baseClip('slow', { playbackRate: 0.1, audioOffsetSec: -12, transitionIn: 'dip_to_black', transitionDurationSec: 0.01 }),
          baseClip('neutral', { playbackRate: 1.004, audioOffsetSec: 0.01 }),
        ],
        overlays: [
          baseOverlay('ovl_wild', { x: 2, y: -1, scale: 9, opacity: 3, startSec: -5, endSec: -1 }),
          baseOverlay('ovl_tiny', { scale: 0.01, opacity: -1, startSec: 9999, endSec: 10 }),
          ...Array.from({ length: MAX_COMPOSE_OVERLAYS + 3 }, (_, i) => baseOverlay(`ovl_fill_${i}`)),
        ],
        sfxClips: [
          baseSfx('sfx_loud', { volume: 4, durationSec: 999, startSec: -3 }),
          baseSfx('sfx_short', { volume: -1, durationSec: 0.01, startSec: 99999 }),
          ...Array.from({ length: MAX_COMPOSE_SFX + 5 }, (_, i) => baseSfx(`sfx_fill_${i}`)),
        ],
      }),
    );

    expect(tl.clips[0]).toMatchObject({ playbackRate: 4, audioOffsetSec: 5, transitionIn: 'cross_dissolve', transitionDurationSec: 2 });
    expect(tl.clips[1]).toMatchObject({ playbackRate: 0.25, audioOffsetSec: -5, transitionIn: 'dip_to_black', transitionDurationSec: 0.1 });
    expect(tl.clips[2]?.playbackRate).toBeUndefined();
    expect(tl.clips[2]?.audioOffsetSec).toBeUndefined();
    expect(tl.clips[2]?.transitionIn).toBeUndefined();
    expect(tl.clips[2]?.transitionDurationSec).toBeUndefined();

    expect(tl.overlays).toHaveLength(MAX_COMPOSE_OVERLAYS);
    expect(tl.overlays?.[0]).toMatchObject({ x: 1, y: 0, scale: 1.5, opacity: 1, startSec: 0, endSec: 0.3 });
    expect(tl.overlays?.[1]).toMatchObject({ scale: 0.1, opacity: 0, startSec: 3600, endSec: 3600.3 });

    expect(tl.sfxClips).toHaveLength(MAX_COMPOSE_SFX);
    expect(tl.sfxClips?.[0]).toMatchObject({ volume: 1, durationSec: 60, startSec: 0 });
    expect(tl.sfxClips?.[1]).toMatchObject({ volume: 0, durationSec: 0.2, startSec: 3600 });
  });

  it('drops garbage fields and entries without throwing', () => {
    const tl = normalizeStoredTimeline(
      rawTimeline({
        clips: [
          baseClip('junk_fields', {
            playbackRate: 'fast',
            audioOffsetSec: null,
            transitionIn: 'wipe',
            transitionDurationSec: 1,
          }),
          baseClip('nan_fields', { playbackRate: Number.NaN, audioOffsetSec: Number.POSITIVE_INFINITY }),
          baseClip('bad_duration', { transitionIn: 'cross_dissolve', transitionDurationSec: 'long' }),
        ],
        overlays: [
          null,
          42,
          'overlay',
          baseOverlay('', {}),
          baseOverlay('ovl_bad_kind', { mediaKind: 'gif' }),
          baseOverlay('ovl_bad_start', { startSec: '1' }),
          baseOverlay('ovl_nan_end', { endSec: Number.NaN }),
          baseOverlay('ovl_no_source', { srcUrl: 42 }),
          baseOverlay('ovl_bad_ids', { srcUrl: '', assetId: 'not-a-uuid', outputId: 7 }),
          baseOverlay('ovl_ok', {
            label: { evil: true },
            x: 'left',
            y: null,
            scale: Number.NaN,
            opacity: '0.5',
            sourceKind: 'mystery',
            thumbUrl: 12,
            injected: '<script>',
          }),
        ],
        sfxClips: [
          undefined,
          baseSfx('sfx_bad_start', { startSec: null }),
          baseSfx('sfx_bad_duration', { durationSec: '2' }),
          baseSfx('sfx_no_source', { srcUrl: undefined }),
          baseSfx('sfx_ok', { label: 5, volume: 'loud', sourceKind: 'mystery', injected: true }),
        ],
      }),
    );

    expect(tl.clips).toHaveLength(3);
    for (const clip of tl.clips) {
      expect(clip.playbackRate).toBeUndefined();
      expect(clip.audioOffsetSec).toBeUndefined();
    }
    expect(tl.clips[0]?.transitionIn).toBeUndefined();
    expect(tl.clips[0]?.transitionDurationSec).toBeUndefined();
    // A valid transition with an unreadable duration falls back to the editor default.
    expect(tl.clips[2]).toMatchObject({ transitionIn: 'cross_dissolve', transitionDurationSec: 0.4 });

    expect(tl.overlays).toEqual([
      {
        id: 'ovl_ok',
        label: 'Overlay',
        sourceKind: 'asset',
        srcUrl: 'https://media.example/ovl_ok.png',
        thumbUrl: null,
        mediaKind: 'image',
        startSec: 1,
        endSec: 4,
        x: 0.5,
        y: 0.5,
        scale: 0.45,
        opacity: 1,
      },
    ]);
    expect(tl.sfxClips).toEqual([
      {
        id: 'sfx_ok',
        label: 'SFX',
        sourceKind: 'asset',
        srcUrl: 'https://media.example/sfx_ok.wav',
        startSec: 2,
        durationSec: 1.5,
        volume: 0.85,
      },
    ]);

    // Non-array tracks are simply omitted.
    const notArrays = normalizeStoredTimeline(rawTimeline({ overlays: {}, sfxClips: 'x' }));
    expect(notArrays.overlays).toBeUndefined();
    expect(notArrays.sfxClips).toBeUndefined();
    expect('overlays' in notArrays).toBe(false);
    expect('sfxClips' in notArrays).toBe(false);
  });

  it('treats browser-local blob: URLs on overlays and SFX the same way it treats clips and BGM', () => {
    const assetId = randomUUID();
    const outputId = randomUUID();
    const sfxAssetId = randomUUID();
    const tl = normalizeStoredTimeline(
      rawTimeline({
        clips: [
          baseClip('clip_blob_only', { sourceKind: 'local', srcUrl: 'blob:https://twings.app/123' }),
          baseClip('clip_blob_asset', { srcUrl: 'blob:https://twings.app/456', assetId }),
        ],
        bgm: { label: 'Local beat', sourceKind: 'local', srcUrl: 'blob:https://twings.app/789', durationSec: 10, trimStartSec: 0, volume: 0.5 },
        overlays: [
          baseOverlay('ovl_blob_only', { sourceKind: 'local', srcUrl: 'blob:https://twings.app/a' }),
          baseOverlay('ovl_blob_asset', { sourceKind: 'local', srcUrl: 'blob:https://twings.app/b', assetId, thumbUrl: 'blob:https://twings.app/thumb' }),
          baseOverlay('ovl_blob_output', { sourceKind: 'output', srcUrl: 'blob:https://twings.app/c', outputId, mediaKind: 'video' }),
          baseOverlay('ovl_local_https', { sourceKind: 'local', srcUrl: 'https://media.example/kept.png' }),
        ],
        sfxClips: [
          baseSfx('sfx_blob_only', { sourceKind: 'local', srcUrl: 'blob:https://twings.app/d' }),
          baseSfx('sfx_blob_asset', { sourceKind: 'local', srcUrl: 'blob:https://twings.app/e', assetId: sfxAssetId }),
          baseSfx('sfx_local_https', { sourceKind: 'local', srcUrl: 'https://media.example/kept.wav' }),
        ],
      }),
    );

    // Reference: clips and BGM drop a bare blob: source and keep an id-backed one with an empty URL.
    expect(tl.clips.map((c) => [c.id, c.srcUrl, c.sourceKind])).toEqual([['clip_blob_asset', '', 'asset']]);
    expect(tl.bgm).toBeNull();

    expect(tl.overlays?.map((o) => [o.id, o.srcUrl, o.sourceKind, o.thumbUrl ?? null])).toEqual([
      ['ovl_blob_asset', '', 'asset', null],
      ['ovl_blob_output', '', 'output', null],
      ['ovl_local_https', 'https://media.example/kept.png', 'asset', null],
    ]);
    expect(tl.sfxClips?.map((s) => [s.id, s.srcUrl, s.sourceKind])).toEqual([
      ['sfx_blob_asset', '', 'asset'],
      ['sfx_local_https', 'https://media.example/kept.wav', 'asset'],
    ]);
    for (const item of [...(tl.overlays ?? []), ...(tl.sfxClips ?? [])]) {
      expect(JSON.stringify(item)).not.toContain('blob:');
      expect(item.sourceKind).not.toBe('local');
    }
  });
});
