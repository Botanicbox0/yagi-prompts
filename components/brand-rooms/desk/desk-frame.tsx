"use client";
/**
 * The team's project desk frame (docs/BRAND-ROOMS-FEEDBACK.md §4). It keeps the project's conversation
 * mounted in ONE place for the whole visit, so its draft, scroll and polling survive every tab and version
 * change (the tabs move with client-side navigation; the server page re-renders around this frame).
 *
 *   list mode     the conversation is the left column (about 40%), the work the right
 *   review mode   a version is open (`?review=`): the stage takes the full width in page flow, and the
 *                 conversation becomes a drawer from the left (the side away from the stage's notes column),
 *                 opened by the header's "대화" button. Open, a light scrim covers the rest of the page (a click
 *                 on it closes the drawer); Esc closes it while focus is in the drawer or on its button, never
 *                 from the stage. Shut, it stays mounted (hidden), keeps polling, and marks nothing read
 *                 (./chat/presence.ts), so the button's count keeps showing what waits.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatPresenceContext, deskConversationVisible, type ChatPresence } from "../chat/presence";
import { ROOM_ACTIVITY } from "../seams";

interface DeskDrawerState {
  review: boolean;
  open: boolean;
  setOpen(open: boolean): void;
}

const DeskDrawer = createContext<DeskDrawerState | null>(null);

export const DESK_CHAT_ID = "brc-desk-chat";

/** Esc shuts the drawer only from inside it or from its own button; the stage keeps its own Esc. */
export function escapeClosesDrawer(focus: { inDrawer: boolean; onToggle: boolean }): boolean {
  return focus.inDrawer || focus.onToggle;
}

export function RoomDeskFrame({
  review,
  header,
  conversation,
  children,
  labels,
}: {
  review: boolean;
  /** The page header; its "대화" button (`RoomDeskChatButton`) reads the drawer state from here. */
  header: ReactNode;
  conversation: ReactNode;
  children: ReactNode;
  labels: { conversation: string; close: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Back in list mode the conversation is a column again; a later review starts with the drawer shut.
  useEffect(() => {
    if (!review) setOpen(false);
  }, [review]);
  useEffect(() => {
    if (!review || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const drawer = document.getElementById(DESK_CHAT_ID);
      if (!escapeClosesDrawer({ inDrawer: Boolean(drawer && target && drawer.contains(target)), onToggle: Boolean(target?.closest(`[aria-controls="${DESK_CHAT_ID}"]`)) })) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Closing with focus inside the drawer would leave it on a hidden element: hand it back to the button.
      const drawer = document.getElementById(DESK_CHAT_ID);
      if (drawer && document.activeElement instanceof HTMLElement && drawer.contains(document.activeElement)) {
        document.querySelector<HTMLElement>(`[aria-controls="${DESK_CHAT_ID}"]`)?.focus();
      }
    };
  }, [review, open]);

  // The conversation reads itself only when on screen. Lines that arrive while the drawer is shut refresh the
  // page, so the header's count (the server's waiting count) shows them.
  const visible = deskConversationVisible(review, open);
  const visibleNow = useRef(visible);
  useEffect(() => {
    visibleNow.current = visible;
  }, [visible]);
  const lastNewest = useRef<string | null | undefined>(undefined);
  const onNewest = useCallback(
    (newestAt: string | null) => {
      const before = lastNewest.current;
      lastNewest.current = newestAt;
      // The first report is what the page was rendered with; only later lines are news.
      if (before === undefined || !newestAt || newestAt === before) return;
      if (!visibleNow.current) router.refresh();
    },
    [router],
  );
  const presence = useMemo<ChatPresence>(() => ({ visible, onNewest }), [visible, onNewest]);
  // Once the open drawer has marked the conversation read (or the team wrote), the button's count is re-read.
  useEffect(() => {
    if (!review) return;
    const onActivity = () => router.refresh();
    window.addEventListener(ROOM_ACTIVITY, onActivity);
    return () => window.removeEventListener(ROOM_ACTIVITY, onActivity);
  }, [review, router]);

  return (
    <DeskDrawer.Provider value={{ review, open, setOpen }}>
      {header}
      <div className="brc-admin-room brc-desk" data-desk-mode={review ? "review" : "list"}>
        <aside id={DESK_CHAT_ID} className="brc-desk-chat" aria-label={labels.conversation} data-open={review ? String(open) : undefined} data-admin-desk-conversation>
          {review && (
            // The conversation names itself in its own head: the bar holds only the way out.
            <div className="brc-desk-drawer-bar">
              <button type="button" className="brc-btn" onClick={() => setOpen(false)} data-admin-desk-chat-close>
                <span aria-hidden="true">×</span> {labels.close}
              </button>
            </div>
          )}
          <div className="brc-desk-chat-body">
            <ChatPresenceContext.Provider value={presence}>{conversation}</ChatPresenceContext.Provider>
          </div>
        </aside>
        <div className="brc-desk-main">{children}</div>
        {review && open && <div className="brc-desk-scrim" aria-hidden="true" onClick={() => setOpen(false)} data-admin-desk-scrim />}
      </div>
    </DeskDrawer.Provider>
  );
}

/** The header's "대화" button with the waiting count; only in review mode (in list mode the column is in view). */
export function RoomDeskChatButton({ label, count, countLabel }: { label: string; count: number; countLabel: string }) {
  const drawer = useContext(DeskDrawer);
  if (!drawer?.review) return null;
  return (
    <button
      type="button"
      className="admin-btn"
      aria-expanded={drawer.open}
      aria-controls={DESK_CHAT_ID}
      onClick={() => drawer.setOpen(!drawer.open)}
      data-admin-desk-chat-toggle
    >
      {label}
      {count > 0 && (
        <span className="admin-count-chip" aria-label={countLabel}>
          {count}
        </span>
      )}
    </button>
  );
}
