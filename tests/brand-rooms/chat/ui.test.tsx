import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { RoomMessage } from "@/lib/brand-rooms/message-contracts";
import { MessageItem } from "@/components/brand-rooms/chat/message";
import { RoomInbox } from "@/components/brand-rooms/chat/inbox";
import { RoomChannel, RoomThread } from "@/components/brand-rooms/chat";
import { adminRefHref, brandTransport } from "@/components/brand-rooms/chat/transport";

/**
 * docs/BRAND-ROOMS.md §4 — what the conversation screens put on the page before any request: a team line
 * with its "야기 팀" badge, mentions marked, files, the card of what a line points at linking to the room
 * tab that shows it, an event line, a deleted line; the inbox's channel list and the chosen channel's
 * head with the way into the room; the public pieces other slices mount.
 */
const ORG = "a0000000-0000-4000-8000-00000000000a";
const PROJECT = "b0000000-0000-4000-8000-00000000000b";
const BOARD = "c0000000-0000-4000-8000-00000000000c";
const FRAME = "d0000000-0000-4000-8000-00000000000d";
const copy = getDictionary("ko").roomsChat;

function line(extra: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: "e0000000-0000-4000-8000-00000000000e",
    channel: PROJECT,
    projectId: PROJECT,
    parentId: null,
    kind: "text",
    event: null,
    detail: null,
    authorId: "f0000000-0000-4000-8000-00000000000f",
    authorRole: "brand",
    authorName: "민지",
    mine: true,
    body: "@준호 라벨 확인 부탁해요",
    attachments: [],
    mentions: ["10000000-0000-4000-8000-000000000001"],
    mentionsTeam: false,
    ref: null,
    reactions: [{ emoji: "heart", count: 2, mine: true }],
    replyCount: 2,
    lastReplyAt: "2026-11-11T03:00:00.000Z",
    lastReplyMine: false,
    pinned: false,
    edited: true,
    deleted: false,
    createdAt: "2026-11-11T02:00:00.000Z",
    updatedAt: "2026-11-11T02:00:00.000Z",
    ...extra,
  };
}

const render = (message: RoomMessage, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <MessageItem
      message={message}
      grouped={false}
      copy={copy}
      locale="ko"
      peopleNames={new Map([["10000000-0000-4000-8000-000000000001", "준호"]])}
      canPin
      canDeleteAny={false}
      refHref={brandTransport(ORG).refHref}
      lastReadAt="2026-11-11T02:30:00.000Z"
      onReply={() => undefined}
      onReact={() => undefined}
      onEdit={async () => true}
      onDelete={() => undefined}
      onPin={() => undefined}
      {...extra}
    />,
  );

describe("room conversation screens", () => {
  it("draws a brand line with its mention, reaction, edit mark, thread summary and actions", () => {
    const html = render(line());
    expect(html).toContain('data-room-message="e0000000-0000-4000-8000-00000000000e"');
    expect(html).toContain('<span class="brc-mention">@준호</span>');
    expect(html).toContain(copy.author.edited);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("답글 2개");
    expect(html).toContain(copy.thread.newReplies);
    for (const label of [copy.actions.react, copy.actions.reply, copy.actions.edit, copy.actions.pin, copy.actions.delete]) expect(html).toContain(`aria-label="${label}"`);
  });

  it("marks the YAGI team, offers no edit or delete on someone else's line, and blanks a deleted one", () => {
    const team = render(line({ authorRole: "studio", authorName: null, mine: false }));
    expect(team).toContain(`<span class="brc-team-badge">${copy.author.team}</span>`);
    expect(team).not.toContain(`aria-label="${copy.actions.edit}"`);
    expect(team).not.toContain(`aria-label="${copy.actions.delete}"`);
    const gone = render(line({ deleted: true, body: "", reactions: [] }));
    expect(gone).toContain(copy.author.deleted);
    expect(gone).not.toContain("라벨 확인");
  });

  it("shows files and the card of a storyboard cut that leads into the room", () => {
    const html = render(
      line({
        attachments: [
          { key: `st/${"a".repeat(64)}.png`, url: "/media/a.png", name: "label.png", mime: "image/png", kind: "image", size: 2048, width: 800, height: 600 },
          { key: `st/${"b".repeat(64)}.pdf`, url: "/media/b.pdf", name: "가이드.pdf", mime: "application/pdf", kind: "file", size: 1_500_000, width: null, height: null },
        ],
        ref: { ref: { kind: "storyboard", storyboardId: BOARD, frameId: FRAME }, available: true, title: "봄 캠페인", version: 2, cut: 3, scene: null, shot: null, thumbUrl: null },
      }),
    );
    expect(html).toContain('alt="label.png"');
    expect(html).toContain("가이드.pdf");
    expect(html).toContain("1.4 MB");
    expect(html).toContain("스토리보드 v2 · 컷 3");
    expect(html).toContain(`href="/brand/rooms/${PROJECT}?organizationId=${ORG}&amp;tab=storyboard&amp;board=${BOARD}&amp;frame=${FRAME}"`);
    expect(adminRefHref(PROJECT, { kind: "review", reviewId: BOARD })).toBe(`/admin/brand-studio/reviews/${BOARD}`);
  });

  it("draws an event line with who did it and a card without a link once the thing is gone", () => {
    const html = render(
      line({
        kind: "event",
        event: "storyboard_shared",
        authorRole: "system",
        authorName: null,
        body: "",
        detail: { title: "봄 캠페인", version: 2 },
        ref: { ref: { kind: "storyboard", storyboardId: BOARD }, available: false, title: null, version: null, cut: null, scene: null, shot: null, thumbUrl: null },
      }),
    );
    expect(html).toContain('data-room-event="storyboard_shared"');
    expect(html).toContain(copy.events.storyboard_shared);
    expect(html).toContain(copy.author.team);
    expect(html).toContain(copy.ref.unavailable);
    expect(html).not.toContain("href=");
  });

  it("lists the conversations with unread counts and opens the chosen one with a way into its room", () => {
    const html = renderToStaticMarkup(
      <RoomInbox
        organizationId={ORG}
        locale="ko"
        copy={copy}
        canTalk
        selected={PROJECT}
        initial={{
          ok: true,
          unread: 3,
          channels: [
            { projectId: null, title: "", unread: 0, lastAt: null, lastLine: null },
            { projectId: PROJECT, title: "봄 캠페인", unread: 3, lastAt: "2026-11-11T02:00:00.000Z", lastLine: "첫 시안 잘 받았어요" },
          ],
        }}
      />,
    );
    expect(html).toContain("data-room-inbox");
    expect(html).toContain(`data-room-channel-link="general"`);
    expect(html).toContain(copy.inbox.generalHint);
    expect(html).toContain(`aria-label="${copy.inbox.unread.replace("{count}", "3")}"`);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(`href="/brand/rooms/${PROJECT}?organizationId=${ORG}"`);
    expect(html).toContain(copy.inbox.openRoom);
    expect(html).toContain(`data-room-channel="${PROJECT}"`);
    expect(html).toContain(copy.channel.loading);
  });

  it("renders the two public pieces other slices mount", () => {
    const channel = renderToStaticMarkup(<RoomChannel organizationId={ORG} projectId={null} locale="en" copy={getDictionary("en").roomsChat} canTalk layout="flow" />);
    expect(channel).toContain('data-room-channel="general"');
    expect(channel).toContain('data-layout="flow"');
    const thread = renderToStaticMarkup(
      <RoomThread organizationId={ORG} projectId={PROJECT} roomRef={{ kind: "storyboard", storyboardId: BOARD, frameId: FRAME }} locale="ko" copy={copy} canTalk label="컷 3에 남기기" />,
    );
    expect(thread).toContain(`data-room-ref-thread="storyboard:${BOARD}:${FRAME}"`);
  });
});
