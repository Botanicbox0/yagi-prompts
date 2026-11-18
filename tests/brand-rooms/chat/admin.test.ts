import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { runRoomOperation, staffRoomOverview } from '@/lib/brand-rooms/messages';
import type { RoomMessage } from '@/lib/brand-rooms/message-contracts';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §9-2 — the team writes to a conversation through the admin registry (`/admin/do`)
 * only: registered, refused for a non-admin before the form is read, re-checked against the profile row,
 * stored as the YAGI team, and returning to that organization's conversation page.
 */
let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const ctx = (userId: string, isAdmin: boolean): AdminContext => ({ sql: f.sql, storage: {} as never, viewer: { ...viewerOf(userId), isAdmin } });
const form = (op: string, fields: Record<string, string>) => {
  const data = new FormData();
  data.set('_op', op);
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const deps = () => ({ sql: f.sql, media: createMemoryMediaStore() });

async function brandLine(): Promise<RoomMessage> {
  const { result } = await runRoomOperation(deps(), viewerOf(f.ids.owner), 'message.send', {
    organizationId: f.orgId,
    projectId: f.projectId,
    requestId: randomUUID(),
    body: 'When is the first cut?',
  });
  return (result as { message: RoomMessage }).message;
}

describe('brand_rooms.* admin operations', () => {
  it('registers the four team writes (확인함, and no read mark: opening clears nothing)', () => {
    for (const name of ['brand_rooms.message.send', 'brand_rooms.message.pin', 'brand_rooms.message.delete', 'brand_rooms.channel.ack']) {
      expect(ADMIN_OPERATION_NAMES).toContain(name);
    }
    expect(ADMIN_OPERATION_NAMES).not.toContain('brand_rooms.channel.read');
  });

  it('refuses a non-admin, and an admin flag the profile row does not carry', async () => {
    const fields = { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'hi' };
    expect(await dispatchAdmin('brand_rooms.message.send', form('brand_rooms.message.send', fields), ctx(f.ids.owner, false))).toEqual({ ok: false, code: 'forbidden' });
    // The session says admin, the profile row does not: the service refuses.
    expect(await dispatchAdmin('brand_rooms.message.send', form('brand_rooms.message.send', fields), ctx(f.ids.owner, true))).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await f.sql.query('select count(*)::int as n from brand_room_messages')).rows[0]).toEqual({ n: 0 });
  });

  it('replies as the YAGI team, pins, acknowledges and takes a line down, landing back on the conversation', async () => {
    const admin = ctx(f.ids.admin, true);
    const question = await brandLine();
    const sent = await dispatchAdmin(
      'brand_rooms.message.send',
      form('brand_rooms.message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'Friday morning', parentId: question.id, mentions: f.ids.owner }),
      admin,
    );
    expect(sent).toMatchObject({ ok: true, code: 'created', to: `/admin/brand-rooms/${f.orgId}?channel=${f.projectId}` });
    expect(outcomeUrl('/admin/brand-rooms', sent)).toContain(`/admin/brand-rooms/${f.orgId}`);
    const row = (await f.sql.query<{ author_role: string; author_id: string; mentions: string[] }>('select author_role, author_id, mentions from brand_room_messages where parent_id = $1', [question.id])).rows[0]!;
    expect(row).toEqual({ author_role: 'studio', author_id: f.ids.admin, mentions: [f.ids.owner] });

    expect(await dispatchAdmin('brand_rooms.message.pin', form('brand_rooms.message.pin', { organizationId: f.orgId, projectId: f.projectId, messageId: question.id, pinned: 'true' }), admin)).toMatchObject({ ok: true });
    expect((await f.sql.query('select pinned_by from brand_room_messages where id = $1', [question.id])).rows[0]).toEqual({ pinned_by: f.ids.admin });
    expect(await dispatchAdmin('brand_rooms.message.pin', form('brand_rooms.message.pin', { organizationId: f.orgId, projectId: f.projectId, messageId: question.id, pinned: 'maybe' }), admin)).toMatchObject({
      ok: false,
      code: 'invalid',
    });

    let overview = await staffRoomOverview({ sql: f.sql }, admin.viewer);
    expect(overview.ok && overview.channels[0]).toMatchObject({ channel: f.projectId, teamUnread: 0 });
    const later = await brandLine();
    overview = await staffRoomOverview({ sql: f.sql }, admin.viewer);
    expect(overview.ok && overview.channels[0]!.teamUnread).toBe(1);
    // 확인함 returns to the form's own `_back` (no `to`), and writes the presser's mark only.
    const acknowledged = await dispatchAdmin('brand_rooms.channel.ack', form('brand_rooms.channel.ack', { organizationId: f.orgId, projectId: f.projectId }), admin);
    expect(acknowledged).toMatchObject({ ok: true, code: 'saved' });
    expect(outcomeUrl(`/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=links`, acknowledged)).toContain(`/admin/brand-rooms/${f.orgId}/${f.projectId}?`);
    expect((await f.sql.query('select user_id from brand_room_reads')).rows).toEqual([{ user_id: f.ids.admin }]);
    overview = await staffRoomOverview({ sql: f.sql }, admin.viewer);
    expect(overview.ok && overview.channels[0]!.teamUnread).toBe(0);

    expect(await dispatchAdmin('brand_rooms.message.delete', form('brand_rooms.message.delete', { organizationId: f.orgId, projectId: f.projectId, messageId: later.id }), admin)).toMatchObject({
      ok: true,
      code: 'deleted',
    });
    expect((await f.sql.query('select deleted_by from brand_room_messages where id = $1', [later.id])).rows[0]).toEqual({ deleted_by: f.ids.admin });
  });

  it('refuses a channel of another organization and an empty line', async () => {
    const admin = ctx(f.ids.admin, true);
    expect(
      await dispatchAdmin('brand_rooms.message.send', form('brand_rooms.message.send', { organizationId: randomUUID(), projectId: f.projectId, requestId: randomUUID(), body: 'x' }), admin),
    ).toMatchObject({ ok: false, code: 'notFound' });
    expect(
      await dispatchAdmin('brand_rooms.message.send', form('brand_rooms.message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: '  ' }), admin),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(
      await dispatchAdmin('brand_rooms.message.send', form('brand_rooms.message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: 'x', ref: 'nonsense' }), admin),
    ).toMatchObject({ ok: false, code: 'invalid' });
  });
});
