import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadRoomMessages, staffLoadRoomMessages } from "@/lib/brand-rooms/messages";
import type { RoomMessage, RoomStreamPage } from "@/lib/brand-rooms/message-contracts";
import { createShare, guestComment } from "@/lib/brand-rooms/shares";
import type { ShareCreated } from "@/lib/brand-rooms/share-contracts";
import { runRoomReviewOperation } from "@/lib/brand-studio/review";
import { MessageItem } from "@/components/brand-rooms/chat/message";
import { adminTransport, brandTransport } from "@/components/brand-rooms/chat/transport";
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from "../../brand-studio/server/helpers";
import { reviewDeps, roomDraft } from "../review/fixtures";

/**
 * A share link's guest leaves a note: its room line is a brand-side `review_commented` with no actor. Before,
 * the conversation read it as the YAGI team's ("야기 팀 작업물 위에 의견을 남겼어요"), to the brand too. Now
 * both conversations name the guest from their note with the review stage's own guest label, or the label
 * alone; a member's note and the team's reply read as before.
 */
let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv("BRAND_ROOMS", "on");
  f = await studioFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const events = (page: unknown) => (page as RoomStreamPage).messages.filter((m) => m.kind === "event" && m.event === "review_commented");

describe("a guest note line, from the service", () => {
  it("carries the guest's name and the guest mark to the brand and to the team, never the team's name", async () => {
    const deps = studioDeps(f.sql);
    const reviewId = await roomDraft(f, deps);
    const created = (await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: "review", targetId: reviewId })) as ShareCreated;
    expect(await guestComment({ sql: f.sql, media: deps.media }, { token: created.token, name: "  Jin   Park ", body: "Warmer please" }, { get: () => undefined })).toMatchObject({ ok: true });
    // A member's own note, for contrast.
    await runRoomReviewOperation(reviewDeps(deps), viewerOf(f.ids.editor), "comment.add", { organizationId: f.orgId, projectId: f.projectId, reviewId, body: "Agree" });

    const query = { organizationId: f.orgId, projectId: f.projectId };
    for (const page of [await loadRoomMessages({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), query), await staffLoadRoomMessages({ sql: f.sql, media: deps.media }, admin(), query)]) {
      const [guestLine, memberLine] = events(page);
      expect(guestLine).toMatchObject({ guest: true, authorName: "Jin Park", authorId: null, authorRole: "system" });
      expect(memberLine).toMatchObject({ authorName: "editor" });
      expect(memberLine).not.toHaveProperty("guest");
    }
  });

  it("falls back to the guest mark alone when the note gives no name", async () => {
    const deps = studioDeps(f.sql);
    const reviewId = await roomDraft(f, deps);
    // A guest line whose ref names no note (or a note that is gone): no name to show.
    await f.sql.query(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, event, detail, ref, ref_key)
         values ($1, $2::uuid, $3::text, null, 'system', 'event', 'review_commented', '{"actorRole":"brand"}'::jsonb, $4::jsonb, $5)`,
      [f.orgId, f.projectId, f.projectId, JSON.stringify({ kind: "review", reviewId }), `review:${reviewId}`],
    );
    const page = await staffLoadRoomMessages({ sql: f.sql, media: deps.media }, admin(), { organizationId: f.orgId, projectId: f.projectId });
    expect(events(page).at(-1)).toMatchObject({ guest: true, authorName: null });
  });
});

describe("a guest note line, on screen", () => {
  const ORG = "a0000000-0000-4000-8000-00000000000a";
  const PROJECT = "b0000000-0000-4000-8000-00000000000b";
  const REVIEW = "c0000000-0000-4000-8000-00000000000c";
  const dict = getDictionary("ko");
  const copy = dict.roomsChat;
  const line = (extra: Partial<RoomMessage>): RoomMessage => ({
    id: randomUUID(),
    channel: PROJECT,
    projectId: PROJECT,
    parentId: null,
    kind: "event",
    event: "review_commented",
    detail: { title: "Spring film", version: 1 },
    authorId: null,
    authorRole: "system",
    authorName: null,
    mine: false,
    body: "",
    attachments: [],
    mentions: [],
    mentionsTeam: false,
    ref: { ref: { kind: "review", reviewId: REVIEW }, available: true, title: "Spring film", version: 1, cut: null, scene: null, shot: null, thumbUrl: null },
    reactions: [],
    replyCount: 0,
    lastReplyAt: null,
    lastReplyMine: false,
    pinned: false,
    edited: false,
    deleted: false,
    createdAt: "2026-11-18T02:00:00.000Z",
    updatedAt: "2026-11-18T02:00:00.000Z",
    ...extra,
  });
  const draw = (message: RoomMessage, side: "brand" | "admin") =>
    renderToStaticMarkup(
      <MessageItem
        message={message}
        grouped={false}
        copy={copy}
        locale="ko"
        peopleNames={new Map()}
        canPin={side === "admin"}
        canDeleteAny={side === "admin"}
        refHref={(side === "brand" ? brandTransport(ORG) : adminTransport(ORG)).refHref}
        lastReadAt={null}
        onReply={() => undefined}
        onReact={() => undefined}
        onEdit={async () => true}
        onDelete={() => undefined}
        onPin={() => undefined}
      />,
    );

  it("reuses the review stage's guest label: no new wording", () => {
    expect(copy.author.guest).toBe(dict.studioReview.roles.guest);
    expect(getDictionary("en").roomsChat.author.guest).toBe(getDictionary("en").studioReview.roles.guest);
  });

  for (const side of ["brand", "admin"] as const) {
    it(`names the guest with the guest label in the ${side} conversation, and never the team`, () => {
      const named = draw(line({ guest: true, authorName: "Jin Park" }), side);
      expect(named).toContain("Jin Park");
      expect(named).toContain(`<span class="brc-guest-tag">${copy.author.guest}</span>`);
      expect(named).toContain(copy.events.review_commented);
      expect(named).not.toContain(copy.author.team);
      const unnamed = draw(line({ guest: true, authorName: null }), side);
      expect(unnamed).toContain(`<strong data-room-event-guest="true">${copy.author.guest}</strong>`);
      expect(unnamed).not.toContain(copy.author.team);
      // A team event without a name still reads as the team.
      expect(draw(line({ detail: { title: "Spring film" } }), side)).toContain(`<strong>${copy.author.team}</strong>`);
    });
  }
});
