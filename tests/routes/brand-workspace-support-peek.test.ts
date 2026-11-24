import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

/**
 * `GET /api/brand-workspace?organizationId=…&peek=1`: the support launcher's one cheap read on mount.
 * It authorizes exactly like the full read, answers only the newest team reply's time, and never makes
 * the outside call the full read makes to pick up replies (that one runs only when the window opens).
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' } as Viewer,
  sync: vi.fn(async () => 0),
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => undefined }));
vi.mock('@/lib/brands/concierge-slack', () => ({
  syncSlackConciergeReplies: mocks.sync,
  notifySlackBrandConcierge: vi.fn(),
  notifySlackBrandProjectRequest: vi.fn(),
}));

const workspace = await import('@/app/api/brand-workspace/route');

const ANON: Viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' };
const host = { host: 'brand.twings.app' };

const fixtures: StudioFixture[] = [];
async function fixture(): Promise<StudioFixture> {
  const f = await studioFixture({ capKrw: null });
  fixtures.push(f);
  mocks.sql = f.sql;
  return f;
}

beforeEach(() => {
  mocks.sync.mockClear();
});

afterEach(async () => {
  mocks.sql = null;
  mocks.viewer = ANON;
  while (fixtures.length > 0) await fixtures.pop()!.db.close();
});

const peek = (organizationId: string) =>
  workspace.GET(
    new NextRequest(
      `https://brand.twings.app/api/brand-workspace?organizationId=${encodeURIComponent(organizationId)}&peek=1`,
      { headers: host },
    ),
  );
const full = (organizationId: string) =>
  workspace.GET(
    new NextRequest(`https://brand.twings.app/api/brand-workspace?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: host,
    }),
  );

async function answer(res: Response) {
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: res.headers.get('cache-control') };
}

async function say(f: StudioFixture, role: 'brand' | 'studio', at: string, body: string) {
  await f.sql.query(
    'insert into brand_support_messages (organization_id, body, author_role, created_by, request_id, created_at) values ($1, $2, $3, $4, $5, $6)',
    [f.orgId, body, role, role === 'studio' ? f.ids.admin : f.ids.owner, randomUUID(), at],
  );
}

describe('GET /api/brand-workspace?peek=1', () => {
  it('answers a member with only { ok, latestStudioReplyAt }: null until the team replies, then the newest team reply; never syncs', async () => {
    const f = await fixture();
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      const empty = await answer(await peek(f.orgId));
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ ok: true, latestStudioReplyAt: null });
      expect(empty.cacheControl).toBe('private, no-store');
    }

    // The brand's own message is not a team reply.
    await say(f, 'brand', '2026-11-20T01:00:00.000Z', 'brand question body');
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await answer(await peek(f.orgId))).body).toEqual({ ok: true, latestStudioReplyAt: null });

    await say(f, 'studio', '2026-11-20T02:00:00.000Z', 'first team answer body');
    await say(f, 'studio', '2026-11-21T03:30:00.000Z', 'second team answer body');
    await say(f, 'brand', '2026-11-22T04:00:00.000Z', 'later brand follow-up body');
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      mocks.viewer = viewerOf(member);
      const latest = await answer(await peek(f.orgId));
      expect(latest.status).toBe(200);
      expect(latest.body).toEqual({ ok: true, latestStudioReplyAt: '2026-11-21T03:30:00.000Z' });
      expect(Object.keys(latest.body).sort()).toEqual(['latestStudioReplyAt', 'ok']);
      // No message bodies, ids or authors leave the server in this mode.
      for (const word of ['body', 'brand question', 'team answer', 'follow-up', 'messages']) expect(latest.text).not.toContain(word);
    }

    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('refuses signed-out callers, outsiders, project guests, unknown organizations and bad ids exactly like the full read, without syncing', async () => {
    const f = await fixture();
    await say(f, 'studio', '2026-11-21T03:30:00.000Z', 'team answer body');

    const cases: Array<{ name: string; viewer: Viewer; organizationId: string }> = [
      { name: 'signed out', viewer: ANON, organizationId: f.orgId },
      { name: 'outsider', viewer: viewerOf(f.ids.outsider), organizationId: f.orgId },
      { name: 'project guest only', viewer: viewerOf(f.ids.guest), organizationId: f.orgId },
      { name: 'unknown organization', viewer: viewerOf(f.ids.owner), organizationId: randomUUID() },
      { name: 'bad id', viewer: viewerOf(f.ids.owner), organizationId: 'not-a-uuid' },
      { name: 'empty id', viewer: viewerOf(f.ids.owner), organizationId: '' },
    ];
    for (const c of cases) {
      mocks.viewer = c.viewer;
      mocks.sync.mockClear();
      const mine = await answer(await peek(c.organizationId));
      expect(mocks.sync, c.name).not.toHaveBeenCalled();
      const sibling = await answer(await full(c.organizationId));
      expect(mine.status, c.name).toBe(404);
      expect(mine.body, c.name).toEqual({ ok: false });
      expect({ status: mine.status, body: mine.body }, c.name).toEqual({ status: sibling.status, body: sibling.body });
      expect(mine.cacheControl, c.name).toBe('private, no-store');
    }
  });

  it('leaves the full read unchanged: it still picks up replies and returns the whole thread', async () => {
    const f = await fixture();
    await say(f, 'brand', '2026-11-20T01:00:00.000Z', 'brand question body');
    await say(f, 'studio', '2026-11-21T03:30:00.000Z', 'team answer body');
    mocks.viewer = viewerOf(f.ids.owner);

    const res = await answer(await full(f.orgId));
    expect(res.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledWith(f.sql, f.orgId);
    expect(res.body.ok).toBe(true);
    const messages = res.body.messages as Array<{ body: string; authorRole: string; createdAt: string }>;
    expect(messages.map((m) => [m.authorRole, m.body, m.createdAt])).toEqual([
      ['brand', 'brand question body', '2026-11-20T01:00:00.000Z'],
      ['studio', 'team answer body', '2026-11-21T03:30:00.000Z'],
    ]);
    expect(res.body).not.toHaveProperty('latestStudioReplyAt');

    // Any other value of the flag is the full read.
    mocks.sync.mockClear();
    const other = await answer(
      await workspace.GET(
        new NextRequest(`https://brand.twings.app/api/brand-workspace?organizationId=${f.orgId}&peek=yes`, { headers: host }),
      ),
    );
    expect(other.body).toHaveProperty('messages');
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
});
