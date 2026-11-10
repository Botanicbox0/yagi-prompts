import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { INGEST_OPERATIONS, ingestSecretMatches } from '@/lib/brand-rooms/ingest';
import { loadStoryboardList } from '@/lib/brand-rooms/storyboards';
import type { StoryboardList } from '@/lib/brand-rooms/storyboard-contracts';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { memoryStaging, pngBytes, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';
// @ts-expect-error -- plain Node script without type declarations
import { parseBoardMarkdown, pictureFiles, readBoardText } from '@/scripts/twings-room.mjs';

/**
 * docs/BRAND-ROOMS.md §5, §9-2 — the command-line door: only the server secret opens it (constant-time,
 * every refusal a 404, the flag and the sandbox too), `storyboard.push` makes a team draft with one
 * reserved cut per picture, the pictures arrive, `storyboard.finish` completes them and shares when
 * asked. And the script's own reading of a folder (board.json / board.md, pictures in name order).
 */
const SECRET = 'test-ingest-secret-0123456789abcdef';
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  media: null as ReturnType<typeof createMemoryMediaStore> | null,
  staging: null as ReturnType<typeof memoryStaging> | null,
  events: [] as Array<{ event: string; actorRole: string }>,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/storage', async (original) => ({ ...(await original<typeof import('@/lib/storage')>()), getStorage: async () => mocks.staging }));
vi.mock('@/lib/brand-studio/media-store', async (original) => ({
  ...(await original<typeof import('@/lib/brand-studio/media-store')>()),
  createStudioMediaStore: () => mocks.media,
}));
vi.mock('@/lib/brand-rooms/events', async (original) => ({
  ...(await original<typeof import('@/lib/brand-rooms/events')>()),
  postRoomEvent: async (_sql: unknown, input: { event: string; actorRole: string }) => {
    mocks.events.push(input);
  },
}));

const route = await import('@/app/api/brand-rooms/ingest/route');
const DOOR = 'http://localhost:3000/api/brand-rooms/ingest';
const call = (operation: string, input: unknown, secret: string | null = SECRET) =>
  route.POST(
    new NextRequest(DOOR, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret !== null ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ operation, input }),
    }),
  );
const sendBytes = (url: string, bytes: Uint8Array, type = 'image/png', secret = SECRET) =>
  route.POST(new NextRequest(new URL(url, 'http://localhost:3000'), { method: 'POST', headers: { 'content-type': type, authorization: `Bearer ${secret}` }, body: Buffer.from(bytes) }));

let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_ROOM_INGEST_SECRET', SECRET);
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.media = createMemoryMediaStore();
  mocks.staging = memoryStaging();
  mocks.events.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  mocks.sql = null;
});

async function push(cuts: number, extra: Record<string, unknown> = {}) {
  const pictures = await Promise.all(Array.from({ length: cuts }, (_, i) => pngBytes(40 + i, 30)));
  const response = await call('storyboard.push', {
    projectId: f.projectId,
    title: 'Launch film',
    cuts: pictures.map((p, i) => ({ scene: 1, shot: i + 1, description: `Cut ${i + 1}`, seconds: 1.5, mime: 'image/png', sizeBytes: p.byteLength })),
    ...extra,
  });
  return { response, pictures };
}

describe('the secret', () => {
  it('opens the door only with the configured secret, compared whole', async () => {
    expect(ingestSecretMatches(SECRET, SECRET)).toBe(true);
    expect(ingestSecretMatches(SECRET, `${SECRET}x`)).toBe(false);
    expect(ingestSecretMatches(SECRET, SECRET.slice(0, -1))).toBe(false);
    expect(ingestSecretMatches(undefined, SECRET)).toBe(false);
    expect(ingestSecretMatches('short', 'short')).toBe(false);
    expect(ingestSecretMatches(SECRET, null)).toBe(false);
  });

  it('answers 404 without it, with a wrong one, with none configured, and with the flag off', async () => {
    expect((await call('storyboard.push', {}, null)).status).toBe(404);
    expect((await call('storyboard.push', {}, 'wrong-secret-wrong-secret-wrong')).status).toBe(404);
    vi.stubEnv('BRAND_ROOM_INGEST_SECRET', '');
    expect((await call('storyboard.push', {}, '')).status).toBe(404);
    vi.stubEnv('BRAND_ROOM_INGEST_SECRET', SECRET);
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect((await call('storyboard.push', {})).status).toBe(404);
  });

  it('keeps one-line slots for the other slices’ operations', () => {
    expect(Object.keys(INGEST_OPERATIONS)).toEqual(expect.arrayContaining(['storyboard.push', 'storyboard.finish']));
  });
});

describe('storyboard.push -> upload -> storyboard.finish', () => {
  it('makes a hidden team draft, takes the pictures, and shares it when asked', async () => {
    const { response, pictures } = await push(3);
    expect(response.status).toBe(200);
    const pushed = await response.json();
    expect(pushed).toMatchObject({ ok: true, version: 1, organizationId: f.orgId, projectId: f.projectId, adminPath: `/admin/brand-rooms/storyboards/${pushed.storyboardId}` });
    expect(pushed.brandPath).toBe(`/brand/rooms/${f.projectId}?organizationId=${f.orgId}&tab=storyboard&board=${pushed.storyboardId}`);
    expect(pushed.uploads).toHaveLength(3);
    expect(pushed.uploads[0]).toMatchObject({ idx: 0, direct: false, url: `/api/brand-rooms/ingest?upload=${pushed.uploads[0].frameId}` });
    expect(JSON.stringify(pushed)).not.toContain(SECRET);
    const board = (await f.sql.query('select created_role, source, status, created_by from brand_storyboards where id = $1', [pushed.storyboardId])).rows[0];
    expect(board).toEqual({ created_role: 'studio', source: 'cli', status: 'draft', created_by: null });

    // A wrong secret on the byte door is the same 404.
    expect((await sendBytes(pushed.uploads[0].url, pictures[0]!, 'image/png', 'nope-nope-nope-nope-nope')).status).toBe(404);
    for (const [i, target] of pushed.uploads.entries()) expect((await sendBytes(target.url, pictures[i]!)).status).toBe(200);
    const list = () => loadStoryboardList({ sql: f.sql, media: mocks.media!, staging: mocks.staging! }, viewerOf(f.ids.owner), f.orgId, f.projectId) as Promise<StoryboardList>;
    expect((await list()).boards).toEqual([]);

    const finished = await (await call('storyboard.finish', { storyboardId: pushed.storyboardId, share: true })).json();
    expect(finished).toMatchObject({ ok: true, status: 'shared', cuts: 3, remaining: 0, failed: [] });
    expect(mocks.events).toEqual([expect.objectContaining({ event: 'storyboard_shared', actorRole: 'studio' })]);
    expect((await list()).boards).toMatchObject([{ id: pushed.storyboardId, cuts: 3, seconds: 4.5, source: 'cli', createdRole: 'studio' }]);
  });

  it('drops a cut whose picture never arrived and leaves the board a draft without --share', async () => {
    const { response, pictures } = await push(2);
    const pushed = await response.json();
    await sendBytes(pushed.uploads[1].url, pictures[1]!);
    const finished = await (await call('storyboard.finish', { storyboardId: pushed.storyboardId })).json();
    expect(finished).toMatchObject({ ok: true, status: 'draft', cuts: 1, remaining: 0, failed: [{ frameId: pushed.uploads[0].frameId, code: 'invalid' }] });
  });

  it('pushes the next version of an existing storyboard', async () => {
    const first = await (await push(1)).response.json();
    const second = await (await push(2, { versionOf: first.storyboardId, title: 'Launch film v2' })).response.json();
    expect(second).toMatchObject({ ok: true, version: 2 });
    const rows = (await f.sql.query<{ lineage_id: string }>('select lineage_id from brand_storyboards order by version')).rows;
    expect(rows[0]!.lineage_id).toBe(rows[1]!.lineage_id);
  });

  it('refuses a bad shape, a foreign mime and an unknown operation', async () => {
    expect((await call('storyboard.push', { projectId: f.projectId, title: 'x', cuts: [] })).status).toBe(400);
    expect((await call('storyboard.push', { projectId: f.projectId, title: 'x', cuts: [{ mime: 'image/gif', sizeBytes: 3 }] })).status).toBe(400);
    expect((await call('storyboard.burn', { projectId: f.projectId })).status).toBe(400);
    expect((await call('storyboard.push', { projectId: '00000000-0000-4000-8000-000000000000', title: 'x', cuts: [{ mime: 'image/png', sizeBytes: 3 }] })).status).toBe(404);
  });

  it('is a 404 for a sandboxed organization’s project, by id and by name', async () => {
    for (const options of [{ orgId: [...SANDBOXED_CLIENT_ORG_IDS][1]! }, { orgName: 'Morphic' }]) {
      await f.db.close();
      f = await studioFixture(options);
      mocks.sql = f.sql;
      const { response } = await push(1);
      expect(response.status).toBe(404);
      expect((await f.sql.query('select count(*)::int as n from brand_storyboards')).rows[0]).toEqual({ n: 0 });
    }
  });
});

describe('scripts/twings-room.mjs reading a folder', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'twings-room-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('takes pictures in name order with numbers by value, and nothing else', () => {
    for (const name of ['10.png', '2.jpg', '01.webp', 'notes.txt', 'board.json']) writeFileSync(join(dir, name), 'x');
    expect(pictureFiles(dir)).toEqual(['01.webp', '2.jpg', '10.png']);
  });

  it('reads board.md: a title, one section per cut, key lines and the rest as the description', () => {
    const parsed = parseBoardMarkdown(
      ['# Spring launch', '', '## Opening', 'scene: 1', 'shot: 1', 'The bottle turns in the light.', '', 'Still turning.', 'camera: slow push in', 'seconds: 2.5s', '', '## 컷 2', '장면: 1', '컷: 2', '사운드: 잔잔한 피아노', '라벨을 가까이.'].join('\n'),
    );
    expect(parsed.title).toBe('Spring launch');
    expect(parsed.cuts).toEqual([
      { scene: '1', shot: '1', description: 'The bottle turns in the light.\n\nStill turning.', camera: 'slow push in', audio: null, seconds: 2.5 },
      { scene: '1', shot: '2', description: '라벨을 가까이.', camera: null, audio: '잔잔한 피아노', seconds: null },
    ]);
  });

  it('reads board.json as a list or as { title, cuts }, and refuses a bad length', () => {
    writeFileSync(join(dir, 'board.json'), JSON.stringify({ title: 'T', cuts: [{ scene: 1, description: 'A', seconds: 3 }] }));
    expect(readBoardText(dir)).toEqual({ title: 'T', cuts: [{ scene: '1', shot: null, description: 'A', camera: null, audio: null, seconds: 3 }] });
    writeFileSync(join(dir, 'board.json'), JSON.stringify([{ seconds: 'forever' }]));
    expect(() => readBoardText(dir)).toThrow(/seconds/);
  });
});
