import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { runRoomOperation, staffSendMessage, type RoomMessageDeps } from '@/lib/brand-rooms/messages';
import type { RoomMessage } from '@/lib/brand-rooms/message-contracts';
import type { PushMessage, PushSender, StoredPushSubscription } from '@/lib/notify/push';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/** The switches and origins every notice test runs under: notices and rooms on, production-shaped URLs. */
export function noticeEnv(overrides: Record<string, string> = {}): void {
  vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://twings.app');
  vi.stubEnv('NOTIFY_TOKEN_SECRET', 'test-only-room-notice-secret-0000000000');
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

export interface NoticeFixture extends StudioFixture {
  deps: RoomMessageDeps;
  admin: Viewer;
}

export async function noticeFixture(options: { orgName?: string; orgId?: string } = {}): Promise<NoticeFixture> {
  const f = await studioFixture(options);
  return { ...f, deps: { sql: f.sql, media: createMemoryMediaStore() }, admin: { ...viewerOf(f.ids.admin), isAdmin: true } };
}

/** A team line in the fixture project (`staffSendMessage`). */
export async function teamLine(f: NoticeFixture, body: string, input: Record<string, unknown> = {}): Promise<RoomMessage> {
  const result = await staffSendMessage(f.deps, f.admin, { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body, ...input });
  if (!result.ok) throw new Error(`team line refused: ${result.code}`);
  return result.message;
}

/** A brand member's line in the fixture project (`message.send`). */
export async function memberLine(f: NoticeFixture, userId: string, body: string, input: Record<string, unknown> = {}): Promise<RoomMessage> {
  const { result } = await runRoomOperation(f.deps, viewerOf(userId), 'message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body, ...input });
  if (!result.ok) throw new Error(`member line refused: ${(result as { code: string }).code}`);
  return (result as { message: RoomMessage }).message;
}

export interface NoticeRowView {
  recipient_id: string;
  project_id: string | null;
  kind: string;
  message_id: string | null;
  timing: string;
  due_at: Date;
  state: string;
  skip_reason: string | null;
  batch_id: string | null;
  attempts: number;
  push_state: string;
  created_at: Date;
}

export async function noticeRows(sql: SqlRunner): Promise<NoticeRowView[]> {
  return (
    await sql.query<NoticeRowView>(
      `select recipient_id::text as recipient_id, project_id::text as project_id, kind, message_id::text as message_id, timing, due_at, state, skip_reason, batch_id::text as batch_id,
              attempts, push_state, created_at
         from brand_room_notices order by created_at, recipient_id`,
    )
  ).rows;
}

/** The room links a notice carries: a project room, or the inbox opened on the general conversation. */
export const projectRoomPath = (f: Pick<NoticeFixture, 'orgId' | 'projectId'>) => `/brand/rooms/${f.projectId}?organizationId=${f.orgId}`;
export const generalInboxPath = (f: Pick<NoticeFixture, 'orgId'>) => `/brand/rooms?organizationId=${f.orgId}&channel=general`;

export const minutesFromNow =(minutes: number): Date => new Date(Date.now() + minutes * 60_000);

/** A push sender that records instead of sending. */
export function fakePushSender(): PushSender & { calls: Array<{ target: StoredPushSubscription; message: PushMessage }> } {
  const calls: Array<{ target: StoredPushSubscription; message: PushMessage }> = [];
  return {
    kind: 'fake-push',
    calls,
    async send(target, message) {
      calls.push({ target, message });
      return { ok: true };
    },
  };
}
