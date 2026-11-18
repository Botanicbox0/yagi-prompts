import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * The desk's 확인함 button end to end through `POST /admin/do` (docs/BRAND-ROOMS-FEEDBACK.md §3): the form's
 * fields reach `brand_rooms.channel.ack` for an admin and clear what waits; a brand member (not an admin) is
 * answered 404 before any operation runs, and nothing is written.
 */
const h = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => {
    if (!h.viewer?.isAdmin) throw new Error('NEXT_NOT_FOUND');
    return h.viewer;
  },
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => h.sql }));
vi.mock('@/lib/cache', () => ({ revalidateCampaigns: vi.fn(), revalidateCatalog: vi.fn(), revalidateContests: vi.fn(), revalidateLandingMedia: vi.fn(), revalidatePrompts: vi.fn() }));
vi.mock('@/lib/storage', async (original) => ({ ...(await original<typeof import('@/lib/storage')>()), getStorage: async () => ({}) }));
vi.mock('@/lib/notify/service', async (original) => ({ ...(await original<typeof import('@/lib/notify/service')>()), getMailer: () => ({}) }));

import { POST } from '@/app/(admin)/admin/do/route';
import { runRoomOperation, staffProjectDesk } from '@/lib/brand-rooms/messages';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

let f: StudioFixture;
beforeAll(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  h.sql = f.sql;
  await runRoomOperation({ sql: f.sql, media: createMemoryMediaStore() }, viewerOf(f.ids.owner), 'message.send', {
    organizationId: f.orgId,
    projectId: f.projectId,
    requestId: randomUUID(),
    body: 'When is the first cut?',
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

/** What the button's form sends, as the browser posts it with script (JSON answer). */
const press = () => {
  const body = new FormData();
  body.set('_op', 'brand_rooms.channel.ack');
  body.set('_back', `/admin/brand-rooms/${f.orgId}/${f.projectId}`);
  body.set('organizationId', f.orgId);
  body.set('projectId', f.projectId);
  return POST(new NextRequest('http://localhost:3000/admin/do', { method: 'POST', body, headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin', accept: 'application/json' } }));
};
const waiting = async () => {
  const desk = await staffProjectDesk({ sql: f.sql }, { ...viewerOf(f.ids.admin), isAdmin: true }, f.orgId, f.projectId);
  if (!desk.ok) throw new Error(desk.code);
  return desk.teamUnread;
};

describe('POST /admin/do brand_rooms.channel.ack', () => {
  it('is a 404 for a brand member, and writes nothing', async () => {
    h.viewer = viewerOf(f.ids.owner);
    expect((await press()).status).toBe(404);
    expect(await waiting()).toBe(1);
    expect((await f.sql.query('select count(*)::int as n from brand_room_reads r join profiles p on p.id = r.user_id and p.is_admin')).rows[0]).toEqual({ n: 0 });
  });

  it('clears what waits for an admin', async () => {
    h.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
    const response = await press();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(await waiting()).toBe(0);
  });
});
