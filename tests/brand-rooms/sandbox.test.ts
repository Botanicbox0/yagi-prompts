import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { brandRouteAllowed, isBrandPath } from '@/lib/routing/surfaces';
import { studioFixture, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §9 — the sandbox hardline for every project-room address and API, pinned at the
 * boundary. For both sandboxed organization ids, organizations named "Morphic …" / "모픽 …" and any
 * organization whose policy closes generative media, with the flag ON: a 404 that names nothing. With the
 * flag OFF: the same 404 for everyone. Each slice adds its own block below and shares the mocks at the
 * top (the database and the viewer are the fixture's). Do not weaken this file to make something pass.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
// Pages read their viewer and database through the workspace context; here they are the fixture's.
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: mocks.viewer, sql: mocks.sql, verifiedEmail: undefined, brandHost: false, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});

const sandboxed = [...SANDBOXED_CLIENT_ORG_IDS];
const cases: Array<{ label: string; orgId?: string; orgName?: string; policy?: boolean }> = [
  { label: `sandboxed id ${sandboxed[0]}`, orgId: sandboxed[0]! },
  { label: `sandboxed id ${sandboxed[1]}`, orgId: sandboxed[1]! },
  { label: 'named "Morphic Korea"', orgName: 'Morphic Korea' },
  { label: 'named "모픽"', orgName: '모픽' },
  { label: 'generative media closed by policy', policy: true },
];

let f: StudioFixture | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});

/** `notFound()` throws Next's 404 signal before anything renders; a page (or any other error) fails here. */
async function expect404(render: () => Promise<unknown>) {
  const error = await render().then(
    () => null,
    (e: unknown) => e,
  );
  expect(String((error as { digest?: string } | null)?.digest ?? error)).toContain('404');
}

/* ------------------------------------------- the project room page (docs/BRAND-ROOMS.md §3, §7, slice H) */

const roomPage = (await import('@/app/(brand)/brand/rooms/[projectId]/page')).default;
const openRoom = (projectId: string, organizationId: string, query: Record<string, string> = {}) =>
  roomPage({ params: Promise.resolve({ projectId }), searchParams: Promise.resolve({ organizationId, ...query }) });

async function roomFixture(options: { orgId?: string; orgName?: string; policy?: boolean } = {}) {
  f = await studioFixture({ orgId: options.orgId, orgName: options.orgName ?? 'Room fixture brand', capKrw: 1_000_000 });
  mocks.sql = f.sql;
  if (options.policy) {
    await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media'])`, [f.orgId]);
  }
  return f;
}

describe.each(cases)('Morphic hardline, project room: organization $label', ({ orgId, orgName, policy }) => {
  it('is a 404 for every member and the invited guest, on every tab, with the flag on', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      for (const tab of ['overview', 'storyboard', 'review', 'chat']) await expect404(() => openRoom(fx.projectId, fx.orgId, { tab }));
    }
  });
});

describe('the project room: the flag, the seat, the project and the route', () => {
  beforeEach(() => {
    vi.stubEnv('BRAND_ROOMS', 'on');
  });

  it('is a 404 for everyone while the flag is off', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const fx = await roomFixture();
    for (const member of [fx.ids.owner, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      await expect404(() => openRoom(fx.projectId, fx.orgId));
    }
  });

  it('opens for members and the invited guest, so the 404s above come from the gate', async () => {
    const fx = await roomFixture();
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      await expect(openRoom(fx.projectId, fx.orgId)).resolves.toBeTruthy();
    }
  });

  it('is a 404 for an outsider, a signed-out visitor, another project, an unshared one, and a guest outside their campaign', async () => {
    const fx = await roomFixture();
    mocks.viewer = viewerOf(fx.ids.outsider);
    await expect404(() => openRoom(fx.projectId, fx.orgId));
    mocks.viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } as unknown as Viewer;
    await expect404(() => openRoom(fx.projectId, fx.orgId));
    mocks.viewer = viewerOf(fx.ids.owner);
    await expect404(() => openRoom('0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11', fx.orgId));
    await expect404(() => openRoom('not-a-project', fx.orgId));
    // A second project of the same brand that the guest was not invited to.
    const other = (
      await fx.sql.query<{ id: string }>(
        `insert into brand_projects (organization_id, title, objective, production_mode, created_by, request_id, client_visible)
          values ($1, 'Autumn launch', 'Launch the autumn line', 'studio', $2, gen_random_uuid(), true) returning id`,
        [fx.orgId, fx.ids.owner],
      )
    ).rows[0]!.id;
    await expect(openRoom(other, fx.orgId)).resolves.toBeTruthy();
    mocks.viewer = viewerOf(fx.ids.guest);
    await expect404(() => openRoom(other, fx.orgId));
    // The brand cannot see a project the team has not shared.
    await fx.sql.query('update brand_projects set client_visible = false where id = $1', [other]);
    mocks.viewer = viewerOf(fx.ids.owner);
    await expect404(() => openRoom(other, fx.orgId));
  });

  it('is a brand route, read-only like its siblings', () => {
    for (const path of ['/brand/rooms', '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11']) {
      expect(isBrandPath(path)).toBe(true);
      expect(brandRouteAllowed(path, 'GET')).toBe(true);
      expect(brandRouteAllowed(path, 'POST')).toBe(false);
    }
    expect(isBrandPath('/brand/roomsx')).toBe(false);
  });
});

/* ------------------------------------------- storyboards (docs/BRAND-ROOMS.md §5, slice S) */

const storyboardRoute = await import('@/app/api/brand-rooms/storyboards/route');
const storyboardUpload = await import('@/app/api/brand-rooms/storyboards/upload/[id]/route');
const ingestRoute = await import('@/app/api/brand-rooms/ingest/route');
const { STORYBOARD_OPERATIONS } = await import('@/lib/brand-rooms/storyboard-contracts');
const { NextRequest: StoryboardRequest } = await import('next/server');

const SB_BASE = 'http://localhost:3000/api/brand-rooms/storyboards';
const SB_SECRET = 'sandbox-ingest-secret-0123456789abcdef';
const sbGet = (fx: StudioFixture, extra = '') => storyboardRoute.GET(new StoryboardRequest(`${SB_BASE}?organizationId=${fx.orgId}&projectId=${fx.projectId}${extra}`));
const sbPost = (fx: StudioFixture, operation: string, input: Record<string, unknown>) =>
  storyboardRoute.POST(
    new StoryboardRequest(SB_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation, input: { organizationId: fx.orgId, projectId: fx.projectId, ...input } }),
    }),
  );
const sbIngest = (body: unknown, query = '', type = 'application/json') =>
  ingestRoute.POST(
    new StoryboardRequest(`http://localhost:3000/api/brand-rooms/ingest${query}`, {
      method: 'POST',
      headers: { 'content-type': type, authorization: `Bearer ${SB_SECRET}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** A well-formed input for every operation, so a refusal can only come from the gate. */
function storyboardInput(operation: string, boardId: string, frameId: string): Record<string, unknown> {
  const board = { storyboardId: boardId };
  switch (operation) {
    case 'board.create':
      return { title: 'Board' };
    case 'board.update':
      return { ...board, title: 'Board' };
    case 'board.status':
      return { ...board, status: 'approved' };
    case 'frame.reserve':
      return { ...board, name: '01.png', mime: 'image/png', sizeBytes: 100 };
    case 'frame.add':
      return { ...board, assetId: frameId };
    case 'frame.update':
      return { ...board, frames: [{ frameId, description: 'x' }] };
    case 'frame.reorder':
      return { ...board, frameIds: [frameId] };
    case 'frame.complete':
    case 'frame.delete':
      return { ...board, frameId };
    default:
      return board;
  }
}

/** A shared team board with one cut and one pending cut, put there by hand (as if made before the brand was closed). */
async function seedStoryboard(fx: StudioFixture): Promise<{ boardId: string; frameId: string; pendingId: string }> {
  const boardId = (
    await fx.sql.query<{ id: string }>(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, title, created_role, status, shared_at)
         values ($1, $2, gen_random_uuid(), 'Board', 'studio', 'draft', null) returning id`,
      [fx.orgId, fx.projectId],
    )
  ).rows[0]!.id;
  const frameId = (
    await fx.sql.query<{ id: string }>(`insert into brand_storyboard_frames (storyboard_id, organization_id, idx, storage_key) values ($1, $2, 0, $3) returning id`, [
      boardId,
      fx.orgId,
      `st/${'c'.repeat(64)}.png`,
    ])
  ).rows[0]!.id;
  const pendingId = (
    await fx.sql.query<{ id: string }>(
      `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, staging_key, mime, size_bytes) values ($1, $2, 1, 'pending', 'k', 'image/png', 4) returning id`,
      [boardId, fx.orgId],
    )
  ).rows[0]!.id;
  return { boardId, frameId, pendingId };
}

const storyboardCounts = async (fx: StudioFixture) =>
  (await fx.sql.query('select (select count(*)::int from brand_storyboards) as boards, (select count(*)::int from brand_storyboard_frames) as frames, (select count(*)::int from brand_storyboards where status <> $1) as moved', ['draft'])).rows[0];

describe.each(cases)('Morphic hardline, storyboards: organization $label', ({ orgId, orgName, policy }) => {
  it('answers both GETs, every operation and the upload gateway with a 404 for every member, and writes nothing', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    const { boardId, frameId, pendingId } = await seedStoryboard(fx);
    const before = await storyboardCounts(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      for (const response of [await sbGet(fx), await sbGet(fx, `&board=${boardId}`)]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ ok: false, code: 'not_found' });
      }
      for (const operation of STORYBOARD_OPERATIONS) {
        const response = await sbPost(fx, operation, storyboardInput(operation, boardId, frameId));
        expect(response.status, `${operation} as ${member}`).toBe(404);
      }
      const upload = await storyboardUpload.POST(
        new StoryboardRequest(`http://localhost:3000/api/brand-rooms/storyboards/upload/${pendingId}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from([1, 2, 3, 4]) }),
        { params: Promise.resolve({ id: pendingId }) },
      );
      expect(upload.status).toBe(404);
    }
    expect(await storyboardCounts(fx)).toEqual(before);
  });

  it('keeps the command-line door shut for its projects even with the right secret', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_ROOM_INGEST_SECRET', SB_SECRET);
    const fx = await roomFixture({ orgId, orgName, policy });
    const { boardId, pendingId } = await seedStoryboard(fx);
    const before = await storyboardCounts(fx);
    expect((await sbIngest({ operation: 'storyboard.push', input: { projectId: fx.projectId, title: 'x', cuts: [{ mime: 'image/png', sizeBytes: 4 }] } })).status).toBe(404);
    expect((await sbIngest({ operation: 'storyboard.finish', input: { storyboardId: boardId, share: true } })).status).toBe(404);
    expect((await sbIngest(Buffer.from([1, 2, 3, 4]).toString('latin1'), `?upload=${pendingId}`, 'image/png')).status).toBe(404);
    expect(await storyboardCounts(fx)).toEqual(before);
  });
});

describe('storyboards: the flag and the control', () => {
  it('is a 404 for everyone while the flag is off, the command-line door too', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    vi.stubEnv('BRAND_ROOM_INGEST_SECRET', SB_SECRET);
    const fx = await roomFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    expect((await sbGet(fx)).status).toBe(404);
    expect((await sbPost(fx, 'board.create', { title: 'x' })).status).toBe(404);
    expect((await sbIngest({ operation: 'storyboard.push', input: { projectId: fx.projectId, title: 'x', cuts: [{ mime: 'image/png', sizeBytes: 4 }] } })).status).toBe(404);
    expect((await fx.sql.query('select count(*)::int as n from brand_storyboards')).rows[0]).toEqual({ n: 0 });
  });

  it('opens for an ordinary organization with the flag on, so the 404s above come from the gate', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    expect((await sbPost(fx, 'board.create', { title: 'Board' })).status).toBe(201);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      expect((await sbGet(fx)).status).toBe(200);
    }
  });

  it('is reachable on the brand host, and the command-line door is not', () => {
    expect(brandRouteAllowed('/api/brand-rooms/storyboards', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/storyboards', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/ingest', 'POST')).toBe(false);
    expect(brandRouteAllowed('/api/brand-rooms/ingest', 'GET')).toBe(false);
  });
});

/* ------------------------------------------- conversations (docs/BRAND-ROOMS.md §4, slice M) */

const messagesRoute = await import('@/app/api/brand-rooms/messages/route');
const messagesUpload = await import('@/app/api/brand-rooms/messages/upload/route');
const summaryRoute = await import('@/app/api/brand-rooms/summary/route');
const inboxPage = (await import('@/app/(brand)/brand/rooms/page')).default;
const { ROOM_OPERATIONS } = await import('@/lib/brand-rooms/message-contracts');
const roomMessages = await import('@/lib/brand-rooms/messages');
const { NextRequest: MessageRequest } = await import('next/server');

const M_BASE = 'http://localhost:3000/api/brand-rooms/messages';
const mGet = (fx: StudioFixture, query: string) => messagesRoute.GET(new MessageRequest(`${M_BASE}?organizationId=${fx.orgId}&${query}`));
const mPost = (fx: StudioFixture, operation: string, input: Record<string, unknown>) =>
  messagesRoute.POST(
    new MessageRequest(M_BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input: { organizationId: fx.orgId, ...input } }) }),
  );
const mSummary = (fx: StudioFixture) => summaryRoute.GET(new MessageRequest(`http://localhost:3000/api/brand-rooms/summary?organizationId=${fx.orgId}`));
const mUpload = (fx: StudioFixture, userId: string) =>
  messagesUpload.POST(
    new MessageRequest(
      `${M_BASE}/upload?organizationId=${fx.orgId}&projectId=${fx.projectId}&key=brand-rooms/${fx.orgId}/${userId}/${'a'.repeat(32)}&size=4`,
      { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from([1, 2, 3, 4]) },
    ),
  );
const openInbox = (fx: StudioFixture, channel?: string) => inboxPage({ searchParams: Promise.resolve({ organizationId: fx.orgId, ...(channel ? { channel } : {}) }) });

/** A well-formed input for every operation, so a refusal can only come from the gate. */
function messageInput(operation: string, projectId: string, messageId: string): Record<string, unknown> {
  const at = { projectId };
  switch (operation) {
    case 'message.send':
      return { ...at, requestId: '6f1d3b7e-2a4c-4e8f-9b1a-3c5d7e9f0a1b', body: 'hello' };
    case 'message.edit':
      return { ...at, messageId, body: 'edited' };
    case 'message.pin':
      return { ...at, messageId, pinned: true };
    case 'reaction.toggle':
      return { ...at, messageId, emoji: 'heart' };
    case 'channel.read':
      return at;
    case 'attachment.reserve':
      return { ...at, name: 'a.png', mime: 'image/png', size: 4 };
    case 'attachment.complete':
      return { ...at, stagingKey: `brand-rooms/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/${'a'.repeat(32)}`, name: 'a.png', mime: 'image/png', size: 4 };
    default:
      return { ...at, messageId };
  }
}

/** A line in the project channel and one in the general channel, put there by hand (as if written before the brand was closed). */
async function seedLines(fx: StudioFixture): Promise<{ project: string; general: string }> {
  const insert = async (projectId: string | null) =>
    (
      await fx.sql.query<{ id: string }>(
        `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, body) values ($1, $2, $3, $4, 'brand', 'before') returning id`,
        [fx.orgId, projectId, projectId ?? 'general', fx.ids.owner],
      )
    ).rows[0]!.id;
  return { project: await insert(fx.projectId), general: await insert(null) };
}

const conversationCounts = async (fx: StudioFixture) =>
  (
    await fx.sql.query(
      `select (select count(*)::int from brand_room_messages) as lines, (select count(*)::int from brand_room_reactions) as reactions,
              (select count(*)::int from brand_room_reads) as reads, (select count(*)::int from brand_room_messages where pinned_at is not null or edited_at is not null or deleted_at is not null) as touched`,
    )
  ).rows[0];

describe.each(cases)('Morphic hardline, conversations: organization $label', ({ orgId, orgName, policy }) => {
  it('answers every read, every operation, the summary, the upload gateway and the inbox with a 404 for every member, and writes nothing', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    const lines = await seedLines(fx);
    const before = await conversationCounts(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      for (const query of [
        `projectId=${fx.projectId}`,
        'projectId=general',
        `projectId=${fx.projectId}&since=2026-01-01T00:00:00.000Z`,
        `projectId=${fx.projectId}&thread=${lines.project}`,
        `projectId=${fx.projectId}&ref=storyboard:${lines.project}`,
      ]) {
        const response = await mGet(fx, query);
        expect(response.status, `${query} as ${member}`).toBe(404);
        expect(await response.json()).toEqual({ ok: false, code: 'not_found' });
      }
      for (const operation of ROOM_OPERATIONS) {
        for (const channel of [fx.projectId, 'general']) {
          const response = await mPost(fx, operation, messageInput(operation, channel, channel === 'general' ? lines.general : lines.project));
          expect(response.status, `${operation} in ${channel} as ${member}`).toBe(404);
        }
      }
      expect((await mSummary(fx)).status).toBe(404);
      expect((await mUpload(fx, member)).status).toBe(404);
      await expect404(() => openInbox(fx));
      await expect404(() => openInbox(fx, fx.projectId));
    }
    expect(await conversationCounts(fx)).toEqual(before);
  });

  it('is not listed, opened or written to by the team either', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    await seedLines(fx);
    const admin = { ...viewerOf(fx.ids.admin), isAdmin: true };
    const deps = { sql: fx.sql, media: (await import('@/lib/brand-studio/media-store')).createMemoryMediaStore() };
    const overview = await roomMessages.staffRoomOverview(deps, admin);
    expect(overview.ok && overview.channels.some((c) => c.organizationId === fx.orgId)).toBe(false);
    expect(overview.ok && overview.organizations.some((o) => o.id === fx.orgId)).toBe(false);
    expect(await roomMessages.staffRoomChannels(deps, admin, fx.orgId)).toEqual({ ok: false, code: 'not_found' });
    expect(await roomMessages.staffLoadRoomMessages(deps, admin, { organizationId: fx.orgId, projectId: fx.projectId })).toEqual({ ok: false, code: 'not_found' });
    const before = await conversationCounts(fx);
    expect(
      await roomMessages.staffSendMessage(deps, admin, { organizationId: fx.orgId, projectId: fx.projectId, requestId: '6f1d3b7e-2a4c-4e8f-9b1a-3c5d7e9f0a1b', body: 'hello' }),
    ).toEqual({ ok: false, code: 'not_found' });
    expect(await conversationCounts(fx)).toEqual(before);
  });
});

describe('conversations: the flag and the control', () => {
  it('is a 404 for everyone while the flag is off', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const fx = await roomFixture();
    mocks.viewer = viewerOf(fx.ids.owner);
    expect((await mGet(fx, `projectId=${fx.projectId}`)).status).toBe(404);
    expect((await mPost(fx, 'channel.read', { projectId: fx.projectId })).status).toBe(404);
    expect((await mSummary(fx)).status).toBe(404);
    expect((await mUpload(fx, fx.ids.owner)).status).toBe(404);
    await expect404(() => openInbox(fx));
    expect(await conversationCounts(fx)).toMatchObject({ lines: 0, reads: 0 });
  });

  it('opens for an ordinary organization with the flag on, so the 404s above come from the gate', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture();
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      expect((await mGet(fx, `projectId=${fx.projectId}`)).status).toBe(200);
      expect((await mSummary(fx)).status).toBe(200);
      expect((await mPost(fx, 'channel.read', { projectId: fx.projectId })).status).toBe(200);
      await expect(openInbox(fx)).resolves.toBeTruthy();
    }
    // The general channel is the brand's own: a project guest does not get it.
    mocks.viewer = viewerOf(fx.ids.guest);
    expect((await mGet(fx, 'projectId=general')).status).toBe(404);
  });

  it('is reachable on the brand host where it should be, and nowhere else', () => {
    expect(brandRouteAllowed('/api/brand-rooms/messages', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/messages', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/messages/upload', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/messages/upload', 'GET')).toBe(false);
    expect(brandRouteAllowed('/api/brand-rooms/summary', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/summary', 'POST')).toBe(false);
  });
});

/* ------------------------------------------- deliverables and share links (docs/BRAND-ROOMS.md §6, slice R) */

const reviewsRoute = await import('@/app/api/brand-rooms/reviews/route');
const sharesRoute = await import('@/app/api/brand-rooms/shares/route');
const sharePublicRoute = await import('@/app/api/brand-rooms/shares/public/route');
const { ROOM_REVIEW_OPERATIONS } = await import('@/lib/brand-studio/review-contracts');
const roomShares = await import('@/lib/brand-rooms/shares');
const { adminRouteAllowed, bypassConsumerLocale, isSharePath } = await import('@/lib/routing/surfaces');
const { NextRequest: ReviewRequest } = await import('next/server');
const { createMemoryMediaStore } = await import('@/lib/brand-studio/media-store');

const R_BASE = 'http://localhost:3000/api/brand-rooms';
const R_TOKEN = 'R'.repeat(43);
const rGet = (fx: StudioFixture, extra = '') => reviewsRoute.GET(new ReviewRequest(`${R_BASE}/reviews?organizationId=${fx.orgId}&projectId=${fx.projectId}${extra}`));
const rPost = (fx: StudioFixture, operation: string, input: Record<string, unknown>) =>
  reviewsRoute.POST(
    new ReviewRequest(`${R_BASE}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input: { organizationId: fx.orgId, projectId: fx.projectId, ...input } }) }),
  );
const sGet = (fx: StudioFixture, targetId: string) => sharesRoute.GET(new ReviewRequest(`${R_BASE}/shares?organizationId=${fx.orgId}&kind=review&targetId=${targetId}`));
const sPost = (operation: string, input: Record<string, unknown>) =>
  sharesRoute.POST(new ReviewRequest(`${R_BASE}/shares`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));
const sPublic = (body: Record<string, unknown>) =>
  sharePublicRoute.POST(new ReviewRequest(`${R_BASE}/shares/public`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

/** A draft in the fixture project with one note and a live link, put there by hand (as if made before the brand was closed). */
async function seedDeliverable(fx: StudioFixture) {
  const key = `st/${'a'.repeat(64)}.png`;
  const assetId = (
    await fx.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, source, status, created_by)
         values ($1, 'image', 'Cut', 'image/png', 10, 64, 48, $2, 'delivery', 'ready', $3) returning id`,
      [fx.orgId, key, fx.ids.admin],
    )
  ).rows[0]!.id;
  const second = (
    await fx.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, source, status, created_by)
         values ($1, 'image', 'Cut 2', 'image/png', 10, 64, 48, $2, 'upload', 'ready', $3) returning id`,
      [fx.orgId, `st/${'b'.repeat(64)}.png`, fx.ids.owner],
    )
  ).rows[0]!.id;
  const reviewId = (
    await fx.sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, asset_id, title, created_by, created_role, project_id, source) values ($1, $2, 'Main film', $3, 'studio', $4, 'delivery') returning id`,
      [fx.orgId, assetId, fx.ids.admin, fx.projectId],
    )
  ).rows[0]!.id;
  const commentId = (
    await fx.sql.query<{ id: string }>(`insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body) values ($1, $2, $3, 'brand', 'Logo smaller') returning id`, [
      reviewId,
      fx.orgId,
      fx.ids.owner,
    ])
  ).rows[0]!.id;
  const shareId = (
    await fx.sql.query<{ id: string }>(
      `insert into brand_room_shares (token_hash, organization_id, project_id, kind, target_id, allow_comments, expires_at, created_role) values ($1, $2, $3, 'review', $4, true, now() + interval '7 days', 'brand') returning id`,
      [roomShares.hashShareToken(R_TOKEN), fx.orgId, fx.projectId, reviewId],
    )
  ).rows[0]!.id;
  return { reviewId, commentId, shareId, second };
}

function reviewInput(operation: string, t: { reviewId: string; commentId: string; second: string }): Record<string, unknown> {
  switch (operation) {
    case 'review.create':
      return { assetId: t.second, title: 'Mine' };
    case 'review.version':
      return { reviewId: t.reviewId, assetId: t.second };
    case 'review.status':
      return { reviewId: t.reviewId, status: 'approved' };
    case 'comment.add':
      return { reviewId: t.reviewId, body: 'Hi', atMs: null, strokes: [{ tool: 'pen', color: 'blue', points: [[0, 0], [1, 1]] }] };
    default:
      return { reviewId: t.reviewId, commentId: t.commentId };
  }
}

const deliverableCounts = async (fx: StudioFixture) =>
  (
    await fx.sql.query(
      `select (select count(*)::int from brand_studio_reviews where deleted_at is null) as reviews,
              (select count(*)::int from brand_studio_review_comments where deleted_at is null and resolved_at is null) as comments,
              (select count(*)::int from brand_studio_reviews where status <> 'open') as moved,
              (select count(*)::int from brand_room_shares where revoked_at is null) as shares,
              (select coalesce(sum(views), 0)::int from brand_room_shares) as views`,
    )
  ).rows[0];

describe.each(cases)('Morphic hardline, deliverables and share links: organization $label', ({ orgId, orgName, policy }) => {
  it('answers both GETs, every operation, the link list and both link writes with a 404 for every member, and writes nothing', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    const t = await seedDeliverable(fx);
    const before = await deliverableCounts(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      for (const response of [await rGet(fx), await rGet(fx, `&review=${t.reviewId}`), await sGet(fx, t.reviewId)]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ ok: false, code: 'not_found' });
      }
      for (const operation of ROOM_REVIEW_OPERATIONS) {
        const response = await rPost(fx, operation, reviewInput(operation, t));
        expect(response.status, `${operation} as ${member}`).toBe(404);
        expect(Object.keys(await response.json()).sort()).toEqual(['code', 'ok']);
      }
      expect((await sPost('share.create', { organizationId: fx.orgId, kind: 'review', targetId: t.reviewId })).status).toBe(404);
      expect((await sPost('share.revoke', { organizationId: fx.orgId, shareId: t.shareId })).status).toBe(404);
    }
    expect(await deliverableCounts(fx)).toEqual(before);
  });

  it('lets a link made before the brand was closed open nothing at all', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    const t = await seedDeliverable(fx);
    const before = await deliverableCounts(fx);
    mocks.viewer = null;
    for (const body of [{ op: 'view', token: R_TOKEN }, { op: 'unlock', token: R_TOKEN, passphrase: 'x' }, { op: 'comment', token: R_TOKEN, name: 'Jin', body: 'Hi' }]) {
      const response = await sPublic(body);
      expect(response.status, body.op).toBe(404);
      expect(await response.json()).toEqual({ ok: false, code: 'not_found' });
    }
    expect(await roomShares.loadSharePage({ sql: fx.sql, media: createMemoryMediaStore() }, R_TOKEN, { get: () => undefined })).toBeNull();
    expect(await deliverableCounts(fx)).toEqual(before);
    expect(t.shareId).toBeTruthy();
  });
});

describe('deliverables and share links: the flag and the control', () => {
  it('is a 404 for everyone while the flag is off, the share page too', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const fx = await roomFixture();
    const t = await seedDeliverable(fx);
    mocks.viewer = viewerOf(fx.ids.owner);
    expect((await rGet(fx)).status).toBe(404);
    expect((await rPost(fx, 'review.status', { reviewId: t.reviewId, status: 'approved' })).status).toBe(404);
    expect((await sGet(fx, t.reviewId)).status).toBe(404);
    expect((await sPost('share.create', { organizationId: fx.orgId, kind: 'review', targetId: t.reviewId })).status).toBe(404);
    expect((await sPublic({ op: 'view', token: R_TOKEN })).status).toBe(404);
    expect(await roomShares.loadSharePage({ sql: fx.sql, media: createMemoryMediaStore() }, R_TOKEN, { get: () => undefined })).toBeNull();
  });

  it('opens for an ordinary organization with the flag on, so the 404s above come from the gate', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture();
    const t = await seedDeliverable(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      expect((await rGet(fx)).status).toBe(200);
      expect((await rGet(fx, `&review=${t.reviewId}`)).status).toBe(200);
    }
    mocks.viewer = viewerOf(fx.ids.owner);
    const created = await sPost('share.create', { organizationId: fx.orgId, kind: 'review', targetId: t.reviewId });
    expect(created.status).toBe(201);
    expect((await created.json()).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    mocks.viewer = viewerOf(fx.ids.viewer);
    expect((await sPost('share.create', { organizationId: fx.orgId, kind: 'review', targetId: t.reviewId })).status).toBe(403);
    mocks.viewer = null;
    const view = await sPublic({ op: 'view', token: R_TOKEN });
    expect(view.status).toBe(200);
    expect(view.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await roomShares.loadSharePage({ sql: fx.sql, media: createMemoryMediaStore() }, R_TOKEN, { get: () => undefined })).toMatchObject({ state: 'open' });
  });

  it('is reachable on the brand host where it should be, and the team upload is not', () => {
    expect(brandRouteAllowed('/api/brand-rooms/reviews', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/reviews', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/shares', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/shares', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/shares/public', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/shares/public', 'GET')).toBe(false);
    expect(brandRouteAllowed(`/s/${R_TOKEN}`, 'GET')).toBe(true);
    expect(brandRouteAllowed(`/s/${R_TOKEN}`, 'POST')).toBe(false);
    expect(brandRouteAllowed('/s/short', 'GET')).toBe(false);
    expect(brandRouteAllowed('/api/brand-rooms/reviews/upload', 'POST')).toBe(false);
    expect(brandRouteAllowed('/api/brand-rooms/reviews/upload', 'PUT')).toBe(false);
    expect(adminRouteAllowed('/api/brand-rooms/reviews/upload', 'POST')).toBe(true);
    expect(isSharePath(`/s/${R_TOKEN}`)).toBe(true);
    expect(isBrandPath(`/s/${R_TOKEN}`)).toBe(false);
    expect(bypassConsumerLocale(`/s/${R_TOKEN}`)).toBe(true);
  });
});

/* ------------------------------------------- invitations to a project room (docs/BRAND-ROOMS-FEEDBACK.md §12) */

const peopleRoute = await import('@/app/api/brand-rooms/people/route');
const { ROOM_PEOPLE_OPERATIONS } = await import('@/lib/brand-rooms/invite-contracts');
const peopleGet = (fx: StudioFixture) => peopleRoute.GET(new ReviewRequest(`${R_BASE}/people?organizationId=${fx.orgId}&projectId=${fx.projectId}`));
const pPost = (fx: StudioFixture, operation: string, input: Record<string, unknown>) =>
  peopleRoute.POST(
    new ReviewRequest(`${R_BASE}/people`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input: { organizationId: fx.orgId, projectId: fx.projectId, ...input } }) }),
  );

/** A waiting invitation to the fixture project, put there by hand (as if sent before the brand was closed). */
async function seedInvite(fx: StudioFixture): Promise<string> {
  return (
    await fx.sql.query<{ id: string }>(
      `insert into brand_invites (organization_id, project_id, email, role, can_comment, token_hash, expires_at, created_by, request_id)
         values ($1, $2, 'waiting@partner.test', 'viewer', true, $3, now() + interval '7 days', $4, gen_random_uuid()) returning id`,
      [fx.orgId, fx.projectId, 'c'.repeat(64), fx.ids.owner],
    )
  ).rows[0]!.id;
}

function peopleInput(operation: string, fx: StudioFixture, inviteId: string): Record<string, unknown> {
  switch (operation) {
    case 'invite.send':
      return { emails: ['new@partner.test'], requestId: '00000000-0000-4000-8000-000000000001' };
    case 'invite.resend':
    case 'invite.cancel':
      return { inviteId };
    case 'guest.permission':
      return { userId: fx.ids.guest, canComment: true };
    default:
      return { userId: fx.ids.guest };
  }
}

const inviteCounts = async (fx: StudioFixture) =>
  (
    await fx.sql.query(
      `select (select count(*)::int from brand_invites) as invites,
              (select count(*)::int from brand_invites where revoked_at is not null) as revoked,
              (select count(*)::int from brand_project_members where status = 'active') as guests,
              (select count(*)::int from brand_project_members where can_comment) as commenting`,
    )
  ).rows[0];

describe.each(cases)('Morphic hardline, invitations: organization $label', ({ orgId, orgName, policy }) => {
  it('answers the access list and every operation with a 404 for every member, and writes nothing', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_ROOM_INVITES', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    const inviteId = await seedInvite(fx);
    const before = await inviteCounts(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      const list = await peopleGet(fx);
      expect(list.status).toBe(404);
      expect(await list.json()).toEqual({ ok: false, code: 'not_found' });
      for (const operation of ROOM_PEOPLE_OPERATIONS) {
        const response = await pPost(fx, operation, peopleInput(operation, fx, inviteId));
        expect(response.status, `${operation} as ${member}`).toBe(404);
        expect(Object.keys(await response.json()).sort()).toEqual(['code', 'ok']);
      }
    }
    expect(await inviteCounts(fx)).toEqual(before);
  });
});

describe('invitations: the switches and the control', () => {
  it('is a 404 for everyone while either switch is off', async () => {
    for (const [rooms, invites] of [['off', 'on'], ['on', 'off'], ['off', 'off']] as const) {
      vi.stubEnv('BRAND_ROOMS', rooms);
      vi.stubEnv('BRAND_ROOM_INVITES', invites);
      const fx = await roomFixture();
      const inviteId = await seedInvite(fx);
      const before = await inviteCounts(fx);
      mocks.viewer = viewerOf(fx.ids.owner);
      expect((await peopleGet(fx)).status).toBe(404);
      for (const operation of ROOM_PEOPLE_OPERATIONS) expect((await pPost(fx, operation, peopleInput(operation, fx, inviteId))).status, operation).toBe(404);
      expect(await inviteCounts(fx)).toEqual(before);
      await fx.db.close();
      f = null;
    }
  });

  it('opens for an ordinary organization with both on: owners and editors manage, viewers and guests may not', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_ROOM_INVITES', 'on');
    const fx = await roomFixture();
    for (const member of [fx.ids.owner, fx.ids.editor]) {
      mocks.viewer = viewerOf(member);
      expect((await peopleGet(fx)).status).toBe(200);
    }
    for (const member of [fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      expect((await peopleGet(fx)).status).toBe(403);
      expect((await pPost(fx, 'invite.send', { emails: ['x@partner.test'], requestId: '00000000-0000-4000-8000-000000000002' })).status).toBe(403);
    }
    mocks.viewer = viewerOf(fx.ids.owner);
    const sent = await pPost(fx, 'invite.send', { emails: ['x@partner.test'], requestId: '00000000-0000-4000-8000-000000000003' });
    expect(sent.status).toBe(200);
    expect((await sent.json()).results).toEqual([expect.objectContaining({ email: 'x@partner.test', state: 'skipped' })]);
    mocks.viewer = null;
    expect((await peopleGet(fx)).status).toBe(401);
  });

  it('is reachable on the brand host for reading and writing', () => {
    expect(brandRouteAllowed('/api/brand-rooms/people', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/people', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/people', 'DELETE')).toBe(false);
  });

  it('keeps the room page and its share entry closed for a sandboxed organization with invitations on', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_ROOM_INVITES', 'on');
    const fx = await roomFixture({ orgId: sandboxed[0]! });
    mocks.viewer = viewerOf(fx.ids.owner);
    await expect404(() => openRoom(fx.projectId, fx.orgId));
  });
});

/* ------------------------------------------- the room pulse (docs/BRAND-ROOMS-FEEDBACK.md §11, review stage 2) */

const pulseRoute = await import('@/app/api/brand-rooms/pulse/route');
const roomPulse = await import('@/lib/brand-rooms/pulse');
const { NextRequest: PulseRequest } = await import('next/server');
const pGet = (fx: StudioFixture, projectId = fx.projectId) =>
  pulseRoute.GET(new PulseRequest(`http://localhost:3000/api/brand-rooms/pulse?organizationId=${fx.orgId}&projectId=${projectId}`));

describe.each(cases)('Morphic hardline, the room pulse: organization $label', ({ orgId, orgName, policy }) => {
  it('answers every member, the share link and the team with a 404 that names nothing', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture({ orgId, orgName, policy });
    const t = await seedDeliverable(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      const response = await pGet(fx);
      expect(response.status, `pulse as ${member}`).toBe(404);
      expect(await response.json()).toEqual({ ok: false, code: 'not_found' });
    }
    mocks.viewer = null;
    const shared = await sPublic({ op: 'pulse', token: R_TOKEN });
    expect(shared.status).toBe(404);
    expect(await shared.json()).toEqual({ ok: false, code: 'not_found' });
    const admin = { ...viewerOf(fx.ids.admin), isAdmin: true };
    expect(await roomPulse.staffRoomPulse({ sql: fx.sql }, admin, { organizationId: fx.orgId, projectId: fx.projectId })).toEqual({ ok: false, code: 'not_found' });
    expect(await roomPulse.staffRoomPulse({ sql: fx.sql }, admin, { organizationId: fx.orgId, reviewId: t.reviewId })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('the room pulse: the flag and the control', () => {
  it('is a 404 for everyone while the flag is off', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const fx = await roomFixture();
    const t = await seedDeliverable(fx);
    mocks.viewer = viewerOf(fx.ids.owner);
    expect((await pGet(fx)).status).toBe(404);
    mocks.viewer = null;
    expect((await sPublic({ op: 'pulse', token: R_TOKEN })).status).toBe(404);
    const admin = { ...viewerOf(fx.ids.admin), isAdmin: true };
    expect(await roomPulse.staffRoomPulse({ sql: fx.sql }, admin, { organizationId: fx.orgId, reviewId: t.reviewId })).toEqual({ ok: false, code: 'rooms_closed' });
  });

  it('opens for an ordinary organization with the flag on, so the 404s above come from the gate', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture();
    const t = await seedDeliverable(fx);
    for (const member of [fx.ids.owner, fx.ids.editor, fx.ids.viewer, fx.ids.guest]) {
      mocks.viewer = viewerOf(member);
      const response = await pGet(fx);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Object.keys(body.stamp).sort()).toEqual(['chat', 'reviews', 'shares', 'storyboards']);
      // A stamp is a short hash: no id, no count, no text of the room.
      expect(JSON.stringify(body)).not.toMatch(/Logo smaller|Main film|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
    mocks.viewer = viewerOf(fx.ids.outsider);
    expect((await pGet(fx)).status).toBe(404);
    mocks.viewer = null;
    expect((await pGet(fx)).status).toBe(401);
    const shared = await sPublic({ op: 'pulse', token: R_TOKEN });
    expect(shared.status).toBe(200);
    expect(Object.keys((await shared.json()).stamp)).toEqual(['item']);
    const admin = { ...viewerOf(fx.ids.admin), isAdmin: true };
    expect(await roomPulse.staffRoomPulse({ sql: fx.sql }, admin, { organizationId: fx.orgId, reviewId: t.reviewId })).toMatchObject({ ok: true });
  });

  it('keeps its own bucket on the share door: a page asking every 5 seconds is never slowed down', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const fx = await roomFixture();
    await seedDeliverable(fx);
    mocks.viewer = null;
    for (let i = 0; i < 12; i += 1) expect((await sPublic({ op: 'pulse', token: R_TOKEN })).status).toBe(200);
    // The other buckets are untouched by it.
    expect((await sPublic({ op: 'view', token: R_TOKEN })).status).toBe(200);
  });

  it('is reachable on the brand host as a read, and the team door only on the admin host', () => {
    expect(brandRouteAllowed('/api/brand-rooms/pulse', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/pulse', 'POST')).toBe(false);
    const teamDoor = '/admin/brand-rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11/pulse';
    expect(adminRouteAllowed(teamDoor, 'GET')).toBe(true);
    expect(brandRouteAllowed(teamDoor, 'GET')).toBe(false);
  });
});
