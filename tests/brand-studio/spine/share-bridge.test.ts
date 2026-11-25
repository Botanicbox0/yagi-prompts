import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §3.4 — "검수 · 공유" (`/api/brand-studio/share-bridge`) offers and accepts YAGI-team
 * projects only. A self project, even one that carries the review room's own title, is never listed, never
 * reused as the review room, never chosen, and never posted to (which would tell the YAGI team on Slack).
 */
const state = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  media: null as StudioMediaStore | null,
  slack: [] as unknown[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/brands/concierge-slack', () => ({
  notifySlackBrandConcierge: vi.fn(async (...args: unknown[]) => {
    state.slack.push(args);
    return { sent: true };
  }),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (callback: () => unknown) => void callback(),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => state.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => state.viewer }));
vi.mock('@/lib/brand-studio/media-store', async (original) => {
  const actual = await original<typeof import('@/lib/brand-studio/media-store')>();
  return { ...actual, createStudioMediaStore: () => state.media ?? actual.createMemoryMediaStore() };
});

import { DEFAULT_REVIEW_WORKSPACE_TITLE, POST } from '@/app/api/brand-studio/share-bridge/route';

let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
  const deps = studioDeps(f.sql);
  state.sql = f.sql;
  state.media = deps.media;
  state.viewer = viewerOf(f.ids.owner);
  state.slack.length = 0;
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const call = (body: unknown) =>
  POST(
    new NextRequest('https://twings.app/api/brand-studio/share-bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://twings.app' },
      body: JSON.stringify(body),
    }),
  );

async function selfProject(title: string): Promise<string> {
  const id = randomUUID();
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
      values ($1, $2, $3, '', 'studio', 'active', false, 'self', $4, $5)`,
    [id, f.orgId, title, f.ids.owner, randomUUID()],
  );
  return id;
}

const counts = async () =>
  (
    await f.sql.query(
      `select (select count(*)::int from brand_room_messages) as messages,
              (select count(*)::int from brand_studio_reviews) as reviews,
              (select count(*)::int from brand_room_shares) as shares,
              (select count(*)::int from team_notice_deliveries) as outbox,
              (select count(*)::int from brand_projects) as projects`,
    )
  ).rows[0];

describe('share-bridge and a self project', () => {
  it('the project list it offers is identical with and without self projects', async () => {
    const before = await (await call({ operation: 'bridge.context', input: { organizationId: f.orgId } })).json();
    expect(before.ok).toBe(true);
    await selfProject('Our own board');
    await selfProject(DEFAULT_REVIEW_WORKSPACE_TITLE);
    const after = await (await call({ operation: 'bridge.context', input: { organizationId: f.orgId } })).json();
    expect(after).toEqual(before);
  });

  it('a self project cannot be chosen to share into or post to, and nobody is told', async () => {
    const mine = await selfProject('Our own board');
    const assetId = await seedImageAsset(studioDeps(f.sql), f.orgId, f.ids.owner);
    const before = await counts();
    for (const operation of ['bridge.create_share', 'bridge.post_chat']) {
      const res = await call({ operation, input: { organizationId: f.orgId, assetId, projectId: mine, postToChat: true, chatNote: '@야기 팀 봐 주세요' } });
      expect(res.status, operation).toBe(404);
      expect(await res.json()).toMatchObject({ ok: false, code: 'not_found' });
    }
    expect(await counts()).toEqual(before);
    expect(state.slack).toEqual([]);
  });

  it('the review room it makes is never a self project with the same title', async () => {
    const lookalike = await selfProject(DEFAULT_REVIEW_WORKSPACE_TITLE);
    const assetId = await seedImageAsset(studioDeps(f.sql), f.orgId, f.ids.owner);
    const res = await call({ operation: 'bridge.ensure_review', input: { organizationId: f.orgId, assetId } });
    const body = await res.json();
    if (body.ok && body.review?.projectId) expect(body.review.projectId).not.toBe(lookalike);
    const linked = (await f.sql.query<{ project_id: string | null }>('select project_id from brand_studio_reviews')).rows;
    for (const row of linked) expect(row.project_id).not.toBe(lookalike);
  });
});
