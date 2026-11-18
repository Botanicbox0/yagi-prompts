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
 *                 from the stage. Shut, it stays mounted (hidden) and keeps polling.
 *
 * The waiting count is what the team has not answered yet (docs/BRAND-ROOMS-FEEDBACK.md §3): opening the
 * conversation or its drawer does not clear it; an answer or the header's 확인함 (`RoomDeskAck`) does.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChatPresenceContext, deskConversationVisible, type ChatPresence } from "../chat/presence";

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

  // The header's count is what the team has not answered (or pressed 확인함 on) yet, so any new line can move
  // it: a customer's line adds one, a team line (sent here, or a note or version posted from the stage) clears
  // it. Every later line refreshes the page so the count and 확인함 follow, in both modes; looking changes
  // nothing.
  const visible = deskConversationVisible(review, open);
  const lastNewest = useRef<string | null | undefined>(undefined);
  const onNewest = useCallback(
    (newestAt: string | null) => {
      const before = lastNewest.current;
      lastNewest.current = newestAt;
      // The first report is what the page was rendered with; only later lines are news.
      if (before === undefined || !newestAt || newestAt === before) return;
      router.refresh();
    },
    [router],
  );
  const presence = useMemo<ChatPresence>(() => ({ visible, onNewest }), [visible, onNewest]);

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

/**
 * 확인함 (docs/BRAND-ROOMS-FEEDBACK.md §3): the team has looked at what waits and owes no answer for now. Posts the
 * registered `brand_rooms.channel.ack` (`/admin/do`); with script it refreshes the page in place, without it the
 * form returns to its own `_back`. Enabled only while something waits. Team-only: nothing the brand sees.
 * `acknowledged` is the last press, already worded ("이름 · 시각에 확인").
 */
export function RoomDeskAck({
  organizationId,
  channel,
  count,
  back,
  acknowledged,
  copy,
}: {
  organizationId: string;
  /** The project id, or `general`. */
  channel: string;
  count: number;
  back: string;
  acknowledged: string | null;
  copy: { button: string; hint: string; failed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || count < 1) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/admin/do", { method: "POST", body: new FormData(event.currentTarget), credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (result?.ok) router.refresh();
      else setError(copy.failed);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="brc-desk-ack" method="post" action="/admin/do" encType="multipart/form-data" onSubmit={submit} aria-busy={busy} data-admin-desk-ack={channel}>
      <input type="hidden" name="_op" value="brand_rooms.channel.ack" />
      <input type="hidden" name="_back" value={back} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="projectId" value={channel} />
      <button type="submit" className="admin-btn" disabled={busy || count < 1} title={copy.hint} data-admin-desk-ack-button>
        {copy.button}
      </button>
      {acknowledged && (
        <span className="brc-desk-ack-by" data-admin-desk-ack-by>
          {acknowledged}
        </span>
      )}
      {error && (
        <span role="alert" className="bw-error">
          {error}
        </span>
      )}
    </form>
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
