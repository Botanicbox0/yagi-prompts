import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { railActive, railItems, RAIL_GROUP, RAIL_HREF } from '@/components/brand-workspace/rail-model';
import { pathRailMode } from '@/components/brand-workspace/rail-mode';
import { emptyComposerProject, MAX_COMPOSE_SFX, parseStoredProject, serializeProjectForStorage } from '@/lib/brand-studio/compose/timeline';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import {
  filterTracks,
  formatTrackLength,
  soundTabOf,
  soundTabParam,
  soundTracks,
  trackDisplayName,
} from '@/lib/brand-studio/sound/library';
import { composeBgmHandoff, composeSfxHandoff, placeBgm, placeSfx, SENT_BGM_VOLUME } from '@/lib/brand-studio/sound/send';
import { cleanPeaks, peaksFromChannels } from '@/lib/brand-studio/sound/waveform';
import { runVideoProjectOperation, type VideoProjectsDeps } from '@/lib/brand-studio/video-projects';
import { soundStudioVisible } from '@/lib/brand-studio/visibility';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { homeLayout } from '@/lib/brands/workspace/home';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandSoundStudioOpen } from '@/lib/flags';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { studioSoundEn, studioSoundKo } from '@/messages/studio-sound';
import { studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SS1 (docs/BRAND-SOUND-STUDIO.md §7.3): the flag, who sees the room, the rail and home
 * entries, the list rules, the two "send to a project" operations, and the page's 404 table.
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));

const ORG = '00000000-0000-4000-8000-0000000000ab';

describe('BRAND_SOUND_STUDIO flag', () => {
  it('is on only for exactly "on"', () => {
    for (const value of [undefined, '', 'off', 'ON', 'On', 'true', '1', ' on', 'on ']) {
      expect(brandSoundStudioOpen({ BRAND_SOUND_STUDIO: value })).toBe(false);
    }
    expect(brandSoundStudioOpen({ BRAND_SOUND_STUDIO: 'on' })).toBe(true);
  });
});

describe('who sees the sound studio', () => {
  const open = { id: randomUUID(), name: 'Brand', denied: [] as string[] };
  it('needs the studio flag, the sound flag, an open studio and an open sound group', () => {
    expect(soundStudioVisible(open, true, true)).toBe(true);
    expect(soundStudioVisible(open, false, true)).toBe(false);
    expect(soundStudioVisible(open, true, false)).toBe(false);
    expect(soundStudioVisible({ ...open, denied: ['sound'] }, true, true)).toBe(false);
    expect(soundStudioVisible({ ...open, denied: ['generative_media'] }, true, true)).toBe(false);
    expect(soundStudioVisible({ ...open, denied: ['self_studio'] }, true, true)).toBe(false);
    expect(soundStudioVisible(null, true, true)).toBe(false);
  });
  it('is closed for every sandboxed organization, by id or by name', () => {
    for (const id of SANDBOXED_CLIENT_ORG_IDS) expect(soundStudioVisible({ id, name: 'x', denied: [] }, true, true)).toBe(false);
    expect(soundStudioVisible({ id: randomUUID(), name: 'Morphic Studio', denied: [] }, true, true)).toBe(false);
    expect(soundStudioVisible({ id: randomUUID(), name: '모픽', denied: [] }, true, true)).toBe(false);
  });
});

describe('rail and home', () => {
  it('puts 사운드 스튜디오 right under 영상 스튜디오 in 직접 만들기, only when open', () => {
    expect(RAIL_GROUP.sound).toBe('make');
    expect(RAIL_HREF.sound).toBe('/brand/studio/sound');
    const grouped = railItems({ studio: true, creators: false, identity: false, rooms: true, sound: true });
    expect(grouped.slice(0, 3)).toEqual(['image', 'video', 'sound']);
    const flat = railItems({ studio: true, creators: true, identity: false, sound: true });
    expect(flat.indexOf('sound')).toBe(flat.indexOf('video') + 1);
  });
  it('leaves the rail exactly as before when the sound studio is closed', () => {
    for (const rooms of [true, false]) {
      const before = railItems({ studio: true, creators: true, identity: false, rooms });
      expect(railItems({ studio: true, creators: true, identity: false, rooms, sound: false })).toEqual(before);
      expect(before).not.toContain('sound');
    }
  });
  it('never shows it to a project-only brand (showroom without a studio)', () => {
    expect(railItems({ studio: false, studioShowroom: true, creators: false, identity: false, rooms: true, sound: true })).not.toContain('sound');
  });
  it('marks only its own item current and belongs to 직접 만들기', () => {
    expect(railActive('/brand/studio/sound', '/brand/studio/sound')).toBe(true);
    expect(railActive('/brand/studio', '/brand/studio/sound')).toBe(false);
    expect(railActive('/brand/studio/video', '/brand/studio/sound')).toBe(false);
    expect(pathRailMode('/brand/studio/sound?tab=sfx')).toBe('make');
  });
  it('adds one home card, first among the tools, only when open', () => {
    const choice = { id: randomUUID(), name: 'Brand', role: 'owner', denied: [] } as unknown as Parameters<typeof homeLayout>[0]['choice'];
    const closed = homeLayout({ choice, flagOn: true, canRequest: true, rooms: true });
    const open = homeLayout({ choice, flagOn: true, canRequest: true, rooms: true, sound: true });
    expect(closed?.tools.map((t) => t.key)).not.toContain('sound');
    expect(open?.tools[0]).toEqual({ key: 'sound', path: '/brand/studio/sound' });
    expect(open?.tools.slice(1)).toEqual(closed?.tools);
  });
  it('lets the brand host serve the page', () => {
    expect(brandRouteAllowed('/brand/studio/sound', 'GET')).toBe(true);
  });
});

describe('list rules', () => {
  const asset = (over: Partial<{ id: string; name: string; source: 'upload' | 'generation'; seconds: number | null; createdAt: string; kind: 'audio' | 'image' }>) => ({
    id: over.id ?? randomUUID(),
    kind: over.kind ?? ('audio' as const),
    role: null,
    name: over.name ?? 'Spring theme.mp3',
    tags: [],
    url: '/media/x.mp3',
    thumbUrl: null,
    width: null,
    height: null,
    seconds: over.seconds === undefined ? 12.4 : over.seconds,
    source: over.source ?? ('upload' as const),
    createdAt: over.createdAt ?? '2026-11-20T01:00:00.000Z',
  });

  it('sorts older generated effects into 효과음 and everything else into 음악', () => {
    expect(soundTabOf(asset({ name: '사운드 이펙트 (5s).mp3', source: 'generation' }))).toBe('sfx');
    expect(soundTabOf(asset({ name: '사운드 이펙트 (5s).mp3', source: 'upload' }))).toBe('music');
    expect(soundTabOf(asset({ name: 'Brand theme.wav' }))).toBe('music');
    expect(soundTabOf(asset({ kind: 'image' }))).toBeNull();
    expect(soundTabParam('sfx')).toBe('sfx');
    expect(soundTabParam(['sfx'])).toBe('sfx');
    expect(soundTabParam('anything')).toBe('music');
    expect(soundTabParam(undefined)).toBe('music');
  });

  it('never draws machine file names, and searches the stored name', () => {
    expect(trackDisplayName('Spring theme.mp3')).toBe('Spring theme');
    expect(trackDisplayName('봄 신제품 BGM.wav')).toBe('봄 신제품 BGM');
    for (const machine of ['IMG_4821.mp3', 'hf_20261120_abc.mp3', '3f2a8c1e-1111-4222-8333-444455556666.wav', 'audio_0001.wav', '20261120_101500.mp3', '  .mp3']) {
      expect(trackDisplayName(machine)).toBeNull();
    }
    const rows = soundTracks(ORG, [asset({ name: 'IMG_4821.mp3' }), asset({ name: 'Calm piano.mp3' }), asset({ name: '사운드 이펙트 (2s).mp3', source: 'generation' })], []);
    expect(filterTracks(rows, 'music', { query: 'img' }).length).toBe(1);
    expect(filterTracks(rows, 'music', { query: 'calm  PIANO' }).map((r) => r.displayName)).toEqual(['Calm piano']);
    expect(filterTracks(rows, 'sfx').length).toBe(1);
  });

  it('keeps likes per library key and filters by them', () => {
    const liked = asset({ name: 'A.mp3' });
    const rows = soundTracks(ORG, [liked, asset({ name: 'B.mp3' })], [`a:${liked.id}`]);
    expect(filterTracks(rows, 'music', { likedOnly: true }).map((r) => r.assetId)).toEqual([liked.id]);
  });

  it('streams through the same-origin gateway, newest first', () => {
    const older = asset({ createdAt: '2026-11-01T00:00:00.000Z' });
    const newer = asset({ createdAt: '2026-11-19T00:00:00.000Z' });
    const rows = soundTracks(ORG, [older, newer], []);
    expect(rows.map((r) => r.assetId)).toEqual([newer.id, older.id]);
    expect(rows[0]!.streamUrl).toBe(`/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=${newer.id}`);
  });

  it('formats lengths with tabular minutes', () => {
    expect(formatTrackLength(161)).toBe('2:41');
    expect(formatTrackLength(7.4)).toBe('0:07');
    expect(formatTrackLength(null)).toBe('–:––');
  });

  it('draws waveforms from the loudest slice and refuses bad stored values', () => {
    const channel = new Float32Array(1000);
    for (let i = 0; i < 1000; i += 1) channel[i] = i < 500 ? 0.1 : 0.5;
    const peaks = peaksFromChannels([channel], 10);
    expect(peaks).toHaveLength(10);
    expect(peaks[0]).toBe(0.2);
    expect(peaks[9]).toBe(1);
    expect(peaksFromChannels([new Float32Array(100)], 10).every((v) => v === 0)).toBe(true);
    expect(cleanPeaks([0, 0.5, 1])).toEqual([0, 0.5, 1]);
    expect(cleanPeaks([0, 2])).toBeNull();
    expect(cleanPeaks([])).toBeNull();
    expect(cleanPeaks('x')).toBeNull();
  });
});

describe('placing a sound on a timeline', () => {
  const track = { assetId: randomUUID(), label: 'Calm piano', seconds: 31.2, srcUrl: '/a.mp3' };

  it('fills an empty music slot and asks before replacing other music', () => {
    const empty = emptyComposerProject('9:16');
    const first = placeBgm(empty, track, false);
    expect(first.status).toBe('placed');
    if (first.status !== 'placed') return;
    expect(first.timeline.bgm).toMatchObject({ assetId: track.assetId, label: 'Calm piano', durationSec: 31.2, trimStartSec: 0, volume: SENT_BGM_VOLUME, sourceKind: 'asset' });
    const other = { ...track, assetId: randomUUID(), label: 'Other' };
    expect(placeBgm(first.timeline, other, false)).toEqual({ status: 'replace_needed', currentLabel: 'Calm piano' });
    const replaced = placeBgm(first.timeline, other, true);
    expect(replaced).toMatchObject({ status: 'placed', replaced: true });
  });

  it('keeps the volume someone set when the same music is sent again', () => {
    const empty = emptyComposerProject('9:16');
    const placed = placeBgm(empty, track, false);
    if (placed.status !== 'placed') throw new Error('placed');
    const louder = { ...placed.timeline, bgm: { ...placed.timeline.bgm!, volume: 0.8 } };
    const again = placeBgm(louder, track, false);
    expect(again.status === 'placed' && again.timeline.bgm?.volume).toBe(0.8);
  });

  it('adds effects up to the 24-effect limit', () => {
    let timeline = emptyComposerProject('9:16');
    for (let i = 0; i < MAX_COMPOSE_SFX; i += 1) {
      const placed = placeSfx(timeline, { ...track, seconds: 2 }, `s${i}`);
      if (placed.status !== 'placed') throw new Error('full too early');
      timeline = placed.timeline;
    }
    expect(timeline.sfxClips).toHaveLength(MAX_COMPOSE_SFX);
    expect(placeSfx(timeline, track, 'last')).toEqual({ status: 'full' });
  });

  it('writes the editing studio’s browser timeline the editor reads back', () => {
    const handoff = composeBgmHandoff(null, track, false);
    expect(handoff.status).toBe('placed');
    if (handoff.status !== 'placed') return;
    const read = parseStoredProject(handoff.stored);
    expect(read?.bgm?.assetId).toBe(track.assetId);
    const withOther = serializeProjectForStorage({ ...read!, bgm: { ...read!.bgm!, assetId: randomUUID(), label: 'Old theme' } });
    expect(composeBgmHandoff(withOther, track, false)).toEqual({ status: 'replace_needed', currentLabel: 'Old theme' });
    const sfx = composeSfxHandoff(handoff.stored, track, 'fx1');
    expect(sfx.status === 'placed' && parseStoredProject(sfx.stored)?.sfxClips?.[0]?.assetId).toBe(track.assetId);
  });
});

describe('bgm.set and sfx.add on saved video projects', () => {
  let f: StudioFixture;
  let deps: VideoProjectsDeps;
  let media: ReturnType<typeof createMemoryMediaStore>;

  async function seedAudio(orgId: string, kind: 'audio' | 'image' = 'audio', name = 'Brand theme.mp3') {
    const { key } = await media.put(new Uint8Array([73, 68, 51, 4]), kind === 'audio' ? 'audio/mpeg' : 'image/png');
    return (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, duration_ms, storage_key, source, status, created_by)
          values ($1, $2, $3, $4, 4, 31200, $5, 'upload', 'ready', $6) returning id`,
        [orgId, kind, name, kind === 'audio' ? 'audio/mpeg' : 'image/png', key, f.ids.owner],
      )
    ).rows[0]!.id;
  }
  async function newProject(orgId = f.orgId) {
    const created = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', { organizationId: orgId, requestId: `req_${randomUUID().slice(0, 12)}` });
    if (!created.ok || !created.project) throw new Error('create');
    return created.project.id;
  }
  async function brandOrg(name: string, id: string = randomUUID()) {
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
    return id;
  }

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_SOUND_STUDIO', 'on');
    f = await studioFixture();
    media = createMemoryMediaStore();
    deps = { sql: f.sql, media };
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
    mocks.sql = null;
    mocks.viewer = null;
  });

  it('answers like an unknown operation while the flag is off', async () => {
    vi.stubEnv('BRAND_SOUND_STUDIO', 'off');
    const projectId = await newProject();
    const assetId = await seedAudio(f.orgId);
    for (const op of ['bgm.set', 'sfx.add']) {
      expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), op, { organizationId: f.orgId, projectId, assetId })).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'nope', { organizationId: f.orgId })).toEqual({ ok: false, code: 'invalid' });
  });

  it('puts music in the slot, asks before replacing, and keeps what it saved', async () => {
    const projectId = await newProject();
    const first = await seedAudio(f.orgId, 'audio', 'Calm piano.mp3');
    const second = await seedAudio(f.orgId, 'audio', 'IMG_0042.mp3');
    const placed = await runVideoProjectOperation(deps, viewerOf(f.ids.editor), 'bgm.set', { organizationId: f.orgId, projectId, assetId: first });
    expect(placed.ok).toBe(true);
    expect(placed.ok && placed.project?.timeline.bgm).toMatchObject({ assetId: first, label: 'Calm piano', durationSec: 31.2 });
    const asked = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'bgm.set', { organizationId: f.orgId, projectId, assetId: second, label: 'Sound made Nov 20' });
    expect(asked).toEqual({ ok: false, code: 'conflict', currentBgmLabel: 'Calm piano' });
    const replaced = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'bgm.set', { organizationId: f.orgId, projectId, assetId: second, label: 'Sound made Nov 20', replace: true });
    expect(replaced.ok && replaced.project?.timeline.bgm).toMatchObject({ assetId: second, label: 'Sound made Nov 20' });
    const stored = (await f.sql.query<{ timeline: { bgm: { assetId: string } } }>('select timeline from brand_studio_video_projects where id = $1', [projectId])).rows[0]!;
    expect(stored.timeline.bgm.assetId).toBe(second);
  });

  it('refuses another organization’s audio and anything that is not audio', async () => {
    const projectId = await newProject();
    const otherOrg = await brandOrg('Other brand');
    const foreign = await seedAudio(otherOrg);
    const picture = await seedAudio(f.orgId, 'image', 'logo.png');
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'bgm.set', { organizationId: f.orgId, projectId, assetId: foreign })).toEqual({ ok: false, code: 'not_found' });
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'sfx.add', { organizationId: f.orgId, projectId, assetId: picture })).toEqual({ ok: false, code: 'invalid' });
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'bgm.set', { organizationId: f.orgId, projectId, assetId: 'not-a-uuid' })).toEqual({ ok: false, code: 'invalid' });
  });

  it('adds effects up to 24 and says when the track is full', async () => {
    const projectId = await newProject();
    const assetId = await seedAudio(f.orgId, 'audio', '사운드 이펙트 (2s).mp3');
    for (let i = 0; i < MAX_COMPOSE_SFX; i += 1) {
      const added = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'sfx.add', { organizationId: f.orgId, projectId, assetId, startSec: i });
      expect(added.ok).toBe(true);
    }
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'sfx.add', { organizationId: f.orgId, projectId, assetId })).toEqual({ ok: false, code: 'invalid', sfxFull: true });
  });

  it('keeps viewers, guests and outsiders out, in the studio’s order', async () => {
    const projectId = await newProject();
    const assetId = await seedAudio(f.orgId);
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.viewer), 'bgm.set', { organizationId: f.orgId, projectId, assetId })).toEqual({ ok: false, code: 'forbidden' });
    for (const who of [f.ids.guest, f.ids.outsider]) {
      expect(await runVideoProjectOperation(deps, viewerOf(who), 'bgm.set', { organizationId: f.orgId, projectId, assetId })).toEqual({ ok: false, code: 'not_found' });
    }
  });

  it('is closed (404 at the route) for a brand whose policy denies sound, and for sandboxed brands', async () => {
    const projectId = await newProject();
    const assetId = await seedAudio(f.orgId);
    await f.sql.query(
      "insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['sound']::text[], $2)",
      [f.orgId, f.ids.admin],
    );
    expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'bgm.set', { organizationId: f.orgId, projectId, assetId })).toEqual({ ok: false, code: 'feature_unavailable' });
    const route = await import('@/app/api/brand-studio/video-projects/route');
    const response = await route.POST(
      new NextRequest('http://localhost:3000/api/brand-studio/video-projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'bgm.set', organizationId: f.orgId, projectId, assetId }),
      }),
    );
    expect(response.status).toBe(404);
    // A sandboxed brand never reaches the sound check: the seat refuses it first.
    for (const org of [{ id: [...SANDBOXED_CLIENT_ORG_IDS][0]! as string, name: 'Client' }, { id: randomUUID() as string, name: 'Morphic Lab' }]) {
      await brandOrg(org.name, org.id);
      expect(await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'bgm.set', { organizationId: org.id, projectId: randomUUID(), assetId })).toEqual({ ok: false, code: 'feature_unavailable' });
    }
  });
});

describe('copy', () => {
  it('has the same keys in both languages and no engine, vendor or backend words', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(studioSoundKo).sort()).toEqual(keys(studioSoundEn).sort());
    const text = JSON.stringify([studioSoundKo, studioSoundEn]);
    for (const word of ['Suno', 'Sunra', 'ElevenLabs', 'Eleven', 'API', 'webhook', 'Max Mode', 'model', '저작권 없는', '보장']) {
      expect(text).not.toContain(word);
    }
    expect(getDictionary('ko').studioShell.rail.sound).toBe('사운드 스튜디오');
    expect(getDictionary('en').studioShell.rail.sound).toBe('Sound Studio');
    expect(getDictionary('ko').brandHome.lines.sound).toBe('글로 설명해서 배경 음악을 만들어요.');
  });
});
