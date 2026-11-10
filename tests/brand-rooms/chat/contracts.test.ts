import { describe, expect, it } from 'vitest';
import {
  attachmentMimeOf,
  attachmentMimeOfKey,
  continuesGroup,
  mentionQueryAt,
  mentionRuns,
  mergeMessages,
  MessageSendSchema,
  parseRefKey,
  refKeyOf,
  roomErrorStatus,
  roomRefHref,
  type RoomMessage,
} from '@/lib/brand-rooms/message-contracts';
import { isStudioMediaKey } from '@/lib/brand-studio/media-store';
import { roomsChatEn, roomsChatKo } from '@/messages/rooms-chat';

/** docs/BRAND-ROOMS.md §4 — the pure rules the screens and the server share. */
const A = '6f1d3b7e-2a4c-4e8f-9b1a-3c5d7e9f0a1b';
const B = '0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11';

function line(id: string, createdAt: string, extra: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id,
    channel: 'general',
    projectId: null,
    parentId: null,
    kind: 'text',
    event: null,
    detail: null,
    authorId: A,
    authorRole: 'brand',
    authorName: 'Mina',
    mine: false,
    body: id,
    attachments: [],
    mentions: [],
    mentionsTeam: false,
    ref: null,
    reactions: [],
    replyCount: 0,
    lastReplyAt: null,
    lastReplyMine: false,
    pinned: false,
    edited: false,
    deleted: false,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

describe('room message contracts', () => {
  it('flattens a ref and reads it back, and links to the room tab that shows it', () => {
    const cut = { kind: 'storyboard' as const, storyboardId: A.toUpperCase(), frameId: B };
    expect(refKeyOf(cut)).toBe(`storyboard:${A}:${B}`);
    expect(parseRefKey(`storyboard:${A}:${B}`)).toEqual({ kind: 'storyboard', storyboardId: A, frameId: B });
    expect(parseRefKey(`review:${A}`)).toEqual({ kind: 'review', reviewId: A });
    for (const bad of ['', 'storyboard', `film:${A}`, `review:${A}:x`, `review:${A}:${B}:${A}`]) expect(parseRefKey(bad)).toBeNull();
    expect(roomRefHref(B, { kind: 'storyboard', storyboardId: A, frameId: B }, A)).toBe(`/brand/rooms/${B}?organizationId=${A}&tab=storyboard&board=${A}&frame=${B}`);
    expect(roomRefHref(B, { kind: 'review', reviewId: A })).toBe(`/brand/rooms/${B}?tab=review&review=${A}`);
  });

  it('accepts the file types a conversation carries, by name first, and stores them under studio keys', () => {
    expect(attachmentMimeOf('brief.HWP', '')).toBe('application/x-hwp');
    expect(attachmentMimeOf('plan.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(attachmentMimeOf('photo', 'image/jpeg')).toBe('image/jpeg');
    expect(attachmentMimeOf('page.html', 'text/html')).toBeNull();
    expect(attachmentMimeOf('vector.svg', 'image/svg+xml')).toBeNull();
    const key = `st/${'a'.repeat(64)}.docx`;
    expect(isStudioMediaKey(key)).toBe(true);
    expect(attachmentMimeOfKey(key)).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(attachmentMimeOfKey(`st/${'a'.repeat(64)}.html`)).toBeNull();
  });

  it('needs words or a file, keeps refs out of the general channel and trims the line', () => {
    const base = { organizationId: A, projectId: 'general', requestId: B };
    expect(MessageSendSchema.safeParse({ ...base, body: '   ' }).success).toBe(false);
    expect(MessageSendSchema.safeParse({ ...base, body: '', attachments: [{ key: `st/${'b'.repeat(64)}.png`, name: 'a.png', size: 10 }] }).success).toBe(true);
    expect(MessageSendSchema.safeParse({ ...base, body: 'x', ref: { kind: 'review', reviewId: A } }).success).toBe(false);
    expect(MessageSendSchema.safeParse({ ...base, projectId: B.toUpperCase(), body: 'x', ref: { kind: 'review', reviewId: A } }).success).toBe(true);
    const parsed = MessageSendSchema.parse({ ...base, body: '  hello  \r\n  there  ' });
    expect(parsed.body).toBe('hello\n  there');
    expect(MessageSendSchema.safeParse({ ...base, projectId: 'random', body: 'x' }).success).toBe(false);
  });

  it('marks only the mentions a line made, the longest name first', () => {
    expect(mentionRuns('@Mina Kim and @Mina please', ['Mina', 'Mina Kim'], null)).toEqual([
      { text: '@Mina Kim', mention: true },
      { text: ' and ', mention: false },
      { text: '@Mina', mention: true },
      { text: ' please', mention: false },
    ]);
    expect(mentionRuns('@야기 팀 확인 부탁해요', [], '야기 팀')).toEqual([
      { text: '@야기 팀', mention: true },
      { text: ' 확인 부탁해요', mention: false },
    ]);
    expect(mentionRuns('no names', [], null)).toEqual([{ text: 'no names', mention: false }]);
  });

  it('finds the @ word being typed', () => {
    expect(mentionQueryAt('hello @mi', 9)).toEqual({ start: 6, query: 'mi' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('mail@x', 6)).toBeNull();
    expect(mentionQueryAt('hello @mina ', 12)).toBeNull();
  });

  it('groups a quick run of lines by one person and merges polled changes by id', () => {
    const one = line('1', '2026-11-11T01:00:00.000Z');
    expect(continuesGroup(one, line('2', '2026-11-11T01:04:00.000Z'))).toBe(true);
    expect(continuesGroup(one, line('2', '2026-11-11T01:06:00.000Z'))).toBe(false);
    expect(continuesGroup(one, line('2', '2026-11-11T01:01:00.000Z', { authorRole: 'studio' }))).toBe(false);
    expect(continuesGroup(one, line('2', '2026-11-11T01:01:00.000Z', { kind: 'event' }))).toBe(false);
    const merged = mergeMessages([one, line('2', '2026-11-11T01:02:00.000Z')], [
      line('2', '2026-11-11T01:02:00.000Z', { body: 'edited', updatedAt: '2026-11-11T02:00:00.000Z' }),
      line('0', '2026-11-11T00:59:00.000Z'),
      line('1', '2026-11-11T01:00:00.000Z', { deleted: true, updatedAt: '2026-11-11T03:00:00.000Z' }),
    ]);
    expect(merged.map((m) => [m.id, m.body])).toEqual([
      ['0', '0'],
      ['2', 'edited'],
    ]);
    // An older copy never overwrites a newer one.
    expect(mergeMessages(merged, [line('2', '2026-11-11T01:02:00.000Z')])[1]!.body).toBe('edited');
  });

  it('maps every refusal to a status, closed things to 404', () => {
    expect(roomErrorStatus('rooms_closed')).toBe(404);
    expect(roomErrorStatus('not_found')).toBe(404);
    expect(roomErrorStatus('rate_limited')).toBe(429);
    expect(roomErrorStatus('file_too_large')).toBe(413);
  });

  it('never names an internal tool to the customer', () => {
    const text = JSON.stringify([roomsChatEn, roomsChatKo]);
    expect(text).not.toMatch(/slack|슬랙|webhook|웹훅|supabase|staging|R2/i);
  });
});
