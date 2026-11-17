import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { noticeEnv, noticeFixture, noticeRows, type NoticeFixture } from './helpers';

/**
 * The intake receipt in the normal flow (docs/BRAND-ROOMS-FEEDBACK.md §2.1): `project.create` through the
 * real route and the real workspace service. The service inserts the project without `client_visible`
 * (lib/brands/workspace/service.ts `createProject`), so the column default `true` from
 * 0031_core_brand_managed_workspace.sql applies, the room audience includes the submitter, and the
 * receipt is planned for them. Only the session, the database handle and the team alert are stubbed.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, userId: '' }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: mocks.userId, isAdmin: false, tier: 'free', email: null, locale: 'ko' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/brands/concierge-slack', () => ({
  notifySlackBrandProjectRequest: vi.fn(async () => ({ sent: false })),
  notifySlackBrandConcierge: vi.fn(async () => ({ sent: false })),
  syncSlackConciergeReplies: vi.fn(),
}));
const { POST } = await import('@/app/api/brand-workspace/route');

let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv();
  f = await noticeFixture();
  mocks.sql = f.sql;
  mocks.userId = f.ids.editor;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const create = (requestId: string) =>
  POST(
    new NextRequest('https://brand.twings.app/api/brand-workspace', {
      method: 'POST',
      headers: { host: 'brand.twings.app', origin: 'https://brand.twings.app', 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'project.create',
        input: { organizationId: f.orgId, requestId, title: 'Summer teaser', objective: 'Announce the summer line', productionMode: 'studio', budgetKrw: null },
      }),
    }),
  );

describe('project.create → intake receipt', () => {
  it('queues one receipt for the submitter, visible project, mail only; a retried request queues nothing more', async () => {
    const requestId = randomUUID();
    const response = await create(requestId);
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect((await f.sql.query<{ client_visible: boolean }>('select client_visible from brand_projects where id = $1', [id])).rows[0]!.client_visible).toBe(true);
    const receipt = (await noticeRows(f.sql)).filter((r) => r.project_id === id);
    expect(receipt).toEqual([expect.objectContaining({ recipient_id: f.ids.editor, kind: 'intake_received', timing: 'now', push_state: 'none', state: 'pending' })]);
    expect((await create(requestId)).status).toBe(200);
    expect((await noticeRows(f.sql)).filter((r) => r.project_id === id)).toHaveLength(1);
  });

  it('queues nothing with the flag off', async () => {
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'off');
    expect((await create(randomUUID())).status).toBe(200);
    expect(await noticeRows(f.sql)).toEqual([]);
  });
});
