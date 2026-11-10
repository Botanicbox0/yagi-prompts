import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { roomAdminPath, staffDeleteMessage, staffMarkRead, staffPinMessage, staffSendMessage, type RoomMessageDeps } from '@/lib/brand-rooms/messages';
import { parseRefKey } from '@/lib/brand-rooms/message-contracts';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext } from './context';
import * as f from './form';

/**
 * Project room conversations, the team side (docs/BRAND-ROOMS.md §4, §9-2). The conversation on
 * `/admin/brand-rooms/[organizationId]` posts these through `/admin/do`. Each service call re-reads the
 * admin flag on the profile row inside its transaction and refuses a sandboxed or generation-closed
 * organization as missing; a team line is stored with `author_role = 'studio'` and the writer's id, a
 * pin with `pinned_by`, a take-down with `deleted_by`, a read mark under the reader's id — the rows are
 * the audit.
 */

const roomDeps = (ctx: AdminContext): RoomMessageDeps => ({ sql: ctx.sql, media: createStudioMediaStore() });

function roomFailure(code: string) {
  const admin =
    code === 'not_found' ? 'notFound' : code === 'forbidden' || code === 'sign_in_required' ? 'forbidden' : code === 'conflict' ? 'brandConflict' : 'invalid';
  return fail(admin, code);
}

const back = (input: { organizationId: string; projectId: string }) => roomAdminPath(input.organizationId, input.projectId);

interface ChannelInput {
  organizationId: string;
  projectId: string;
}

const channelOf = (form: FormData): ChannelInput => ({ organizationId: f.str(form, 'organizationId'), projectId: f.str(form, 'projectId').toLowerCase() });

interface SendInput extends ChannelInput {
  requestId: string;
  body: string;
  parentId: string | null;
  ref: ReturnType<typeof parseRefKey>;
  mentions: string[];
}

const send: AdminOperation<SendInput> = {
  parse(form) {
    const body = f.text(form, 'body');
    if (!body) return { ok: false, detail: 'body is required' };
    const rawRef = f.str(form, 'ref');
    const ref = rawRef ? parseRefKey(rawRef) : null;
    if (rawRef && !ref) return { ok: false, detail: 'ref must be storyboard:<id>[:<frame>] or review:<id>[:<comment>]' };
    return {
      ok: true,
      value: {
        ...channelOf(form),
        requestId: f.str(form, 'requestId'),
        body,
        parentId: f.str(form, 'parentId') || null,
        ref,
        mentions: f.tags(form, 'mentions'),
      },
    };
  },
  async run(ctx, input) {
    const result = await staffSendMessage(roomDeps(ctx), ctx.viewer, { ...input });
    if (!result.ok) return roomFailure(result.code);
    return ok('created', { to: back(input), detail: result.message.id });
  },
};

const pin: AdminOperation<ChannelInput & { messageId: string; pinned: boolean }> = {
  parse(form) {
    const pinned = f.str(form, 'pinned');
    if (pinned !== 'true' && pinned !== 'false') return { ok: false, detail: 'pinned must be true or false' };
    return { ok: true, value: { ...channelOf(form), messageId: f.str(form, 'messageId'), pinned: pinned === 'true' } };
  },
  async run(ctx, input) {
    const result = await staffPinMessage(roomDeps(ctx), ctx.viewer, input);
    if (!result.ok) return roomFailure(result.code);
    return ok('saved', { to: back(input) });
  },
};

const remove: AdminOperation<ChannelInput & { messageId: string }> = {
  parse: (form) => ({ ok: true, value: { ...channelOf(form), messageId: f.str(form, 'messageId') } }),
  async run(ctx, input) {
    const result = await staffDeleteMessage(roomDeps(ctx), ctx.viewer, input);
    if (!result.ok) return roomFailure(result.code);
    return ok('deleted', { to: back(input) });
  },
};

const read: AdminOperation<ChannelInput & { at: string | null }> = {
  parse: (form) => ({ ok: true, value: { ...channelOf(form), at: f.str(form, 'at') || null } }),
  async run(ctx, input) {
    const result = await staffMarkRead(roomDeps(ctx), ctx.viewer, input);
    if (!result.ok) return roomFailure(result.code);
    return ok('saved', { to: back(input) });
  },
};

export const BRAND_ROOM_MESSAGE_OPERATIONS = {
  'brand_rooms.message.send': send,
  'brand_rooms.message.pin': pin,
  'brand_rooms.message.delete': remove,
  'brand_rooms.channel.read': read,
};
