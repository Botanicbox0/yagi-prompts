import { describe, expect, it, vi } from "vitest";
import { useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §4, from the second browser check (2026-11-18):
 *  1. A shut conversation drawer marked the channel read within seconds, so the waiting count fell to 0 while
 *     nobody had looked. The read mark now needs the conversation on screen: always on the brand's screens
 *     and in the desk's list mode, in review mode only while the drawer is open (and the tab in front).
 *  2. Esc shuts the drawer only from inside it or from its button; Esc in the stage is the stage's own.
 *  5. Turning a link off clears the "link made" box beside the list.
 *  6. The drawer names the conversation once (its own head), the bar holds only the way out.
 * (This repo's tests have no DOM: the rules are tested as functions, the wiring through server rendering.)
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ChatPresenceContext, deskConversationVisible, readMarkAllowed } from "@/components/brand-rooms/chat/presence";
import { escapeClosesDrawer, RoomDeskFrame } from "@/components/brand-rooms/desk/desk-frame";
import { announceShareRevoked, onShareRevoked } from "@/components/brand-rooms/share/revoked";

function Probe() {
  const presence = useContext(ChatPresenceContext);
  return <span data-probe-visible={String(presence.visible)} data-probe-hears={String(typeof presence.onNewest === "function")} />;
}

const frame = (review: boolean) =>
  renderToStaticMarkup(
    <RoomDeskFrame review={review} header={<h1>Desk</h1>} conversation={<Probe />} labels={{ conversation: "대화", close: "닫기" }}>
      <p>work</p>
    </RoomDeskFrame>,
  );

describe("the read mark", () => {
  it("needs the stream's end in view, the stream loaded, the conversation on screen and the tab in front", () => {
    const all = { seen: true, ready: true, visible: true, pageVisible: true };
    expect(readMarkAllowed(all)).toBe(true);
    for (const off of ["seen", "ready", "visible", "pageVisible"] as const) expect(readMarkAllowed({ ...all, [off]: false }), off).toBe(false);
  });

  it("on the desk: the column in list mode always, the drawer in review mode only while open", () => {
    expect(deskConversationVisible(false, false)).toBe(true);
    expect(deskConversationVisible(false, true)).toBe(true);
    expect(deskConversationVisible(true, false)).toBe(false);
    expect(deskConversationVisible(true, true)).toBe(true);
  });

  it("is what the desk frame tells its conversation: on screen in list mode, not in review mode while shut", () => {
    expect(frame(false)).toContain('data-probe-visible="true"');
    const review = frame(true);
    expect(review).toContain('data-probe-visible="false"');
    // It still hears about new lines (to refresh the "대화" button's count), and the drawer is shut.
    expect(review).toContain('data-probe-hears="true"');
    expect(review).toMatch(/<aside id="brc-desk-chat"[^>]*data-open="false"/);
  });

  it("is on by default everywhere else (the brand's screens, the team's conversation pages)", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('data-probe-visible="true"');
  });
});

describe("the drawer", () => {
  it("shuts on Esc only from inside it or from its button, never from the stage", () => {
    expect(escapeClosesDrawer({ inDrawer: true, onToggle: false })).toBe(true);
    expect(escapeClosesDrawer({ inDrawer: false, onToggle: true })).toBe(true);
    expect(escapeClosesDrawer({ inDrawer: false, onToggle: false })).toBe(false);
  });

  it("names the conversation once: the bar holds only the close button, and no scrim while shut", () => {
    const review = frame(true);
    const bar = review.slice(review.indexOf('class="brc-desk-drawer-bar"'), review.indexOf('class="brc-desk-chat-body"'));
    expect(bar).toContain("data-admin-desk-chat-close");
    expect(bar).not.toContain("대화");
    expect(review).not.toContain("data-admin-desk-scrim");
    expect(frame(false)).not.toContain("brc-desk-drawer-bar");
  });
});

describe("the link-made box", () => {
  it("hears every turn-off on the page, and stops hearing once unsubscribed", () => {
    const heard: string[] = [];
    const stop = onShareRevoked((id) => heard.push(id));
    announceShareRevoked("a0000000-0000-4000-8000-00000000000a");
    expect(heard).toEqual(["a0000000-0000-4000-8000-00000000000a"]);
    stop();
    announceShareRevoked("b0000000-0000-4000-8000-00000000000b");
    expect(heard).toHaveLength(1);
  });
});
