"use client";
/**
 * One live list of lines: a channel's stream, one thread, or the lines about one thing (a cut, a
 * deliverable). First page, older pages, polling with the `since` cursor (every 4 s while the tab is on
 * screen, every 20 s otherwise, at once when it comes back), optimistic sends with rollback, and the
 * small writes (edit, delete, pin, react). A 401/403/404 stops polling for good on this page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ROOM_ACTIVITY } from "../seams";
import {
  mergeMessages,
  ROOM_POLL_VISIBLE_MS,
  type RoomLegacyMessage,
  type RoomMessage,
  type RoomPerson,
  type RoomReaction,
  type RoomRef,
  type RoomRefPage,
  type RoomStreamPage,
  type RoomThreadPage,
} from "@/lib/brand-rooms/message-contracts";
import type { ChatTransport, Fail, SendDraft } from "./transport";
import { readMarkAllowed } from "./presence";

export type FeedMode = { kind: "stream" } | { kind: "thread"; parentId: string } | { kind: "ref"; refKey: string };

/** A line on screen; a pending one is ours and not confirmed yet. */
export type ShownMessage = RoomMessage & { pending?: boolean };

export interface FeedState {
  status: "loading" | "ready" | "error" | "gone";
  messages: ShownMessage[];
  parent: RoomMessage | null;
  hasMore: boolean;
  loadingOlder: boolean;
  legacy: RoomLegacyMessage[];
  people: RoomPerson[];
  pinned: RoomMessage[];
  /** Where the viewer had stopped reading when the page opened (the "new" divider). */
  lastReadAt: string | null;
  canTalk: boolean;
  canPin: boolean;
  title: string | null;
}

const EMPTY: FeedState = {
  status: "loading",
  messages: [],
  parent: null,
  hasMore: false,
  loadingOlder: false,
  legacy: [],
  people: [],
  pinned: [],
  lastReadAt: null,
  canTalk: false,
  canPin: false,
  title: null,
};

export function announceRoomActivity(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ROOM_ACTIVITY));
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Old browsers: a v4-shaped id from Math.random (only an idempotency key).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const STOPPING = new Set(["not_found", "forbidden", "sign_in_required", "rooms_closed"]);

function pinnedFrom(current: readonly RoomMessage[], changed: readonly RoomMessage[]): RoomMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of changed) {
    if (m.pinned && !m.deleted) byId.set(m.id, m);
    else byId.delete(m.id);
  }
  return [...byId.values()];
}

export function useFeed(transport: ChatTransport, channel: string, mode: FeedMode, viewer: { authorName: string | null; authorId: string | null }) {
  const [state, setState] = useState<FeedState>(EMPTY);
  const cursor = useRef<string | null>(null);
  const stopped = useRef(false);
  const inflight = useRef(false);
  const modeKey = mode.kind === "thread" ? `thread:${mode.parentId}` : mode.kind === "ref" ? `ref:${mode.refKey}` : "stream";
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const query = useCallback((extra: Record<string, string>): Record<string, string> => {
    const m = modeRef.current;
    return { ...(m.kind === "thread" ? { thread: m.parentId } : m.kind === "ref" ? { ref: m.refKey } : {}), ...extra };
  }, []);

  const apply = useCallback((page: RoomStreamPage | RoomThreadPage | RoomRefPage, first: boolean) => {
    if ("parent" in page) {
      setState((s) => ({
        ...s,
        status: "ready",
        parent: page.parent,
        messages: first ? (page.replies as ShownMessage[]) : (mergeMessages(s.messages, page.replies) as ShownMessage[]),
        people: first ? page.people : s.people,
        canTalk: s.canTalk || first,
      }));
      return;
    }
    if (!("channel" in page)) {
      setState((s) => ({
        ...s,
        status: "ready",
        messages: first ? page.messages : (mergeMessages(s.messages, page.messages) as ShownMessage[]),
        people: first ? page.people : s.people,
        canTalk: first ? page.canTalk : s.canTalk,
      }));
      return;
    }
    if (first) {
      setState((s) => ({
        ...s,
        status: "ready",
        messages: page.messages,
        hasMore: page.hasMore,
        legacy: page.legacy,
        people: page.people,
        pinned: page.pinned,
        lastReadAt: page.lastReadAt,
        canTalk: page.canTalk,
        canPin: page.canPin,
        title: page.title,
      }));
      return;
    }
    setState((s) => {
      // A change to a line older than what is loaded stays out until the person scrolls back to it.
      const oldest = s.messages.find((m) => !m.pending)?.createdAt ?? null;
      const relevant = s.hasMore && oldest ? page.messages.filter((m) => m.createdAt >= oldest) : page.messages;
      return { ...s, messages: mergeMessages(s.messages, relevant) as ShownMessage[], pinned: pinnedFrom(s.pinned, page.messages) };
    });
  }, []);

  const poll = useCallback(async () => {
    if (stopped.current || inflight.current || !cursor.current) return;
    inflight.current = true;
    try {
      const page = await transport.load(channel, query({ since: cursor.current }));
      if (!page.ok) {
        if (STOPPING.has(page.code)) {
          stopped.current = true;
          setState((s) => ({ ...s, status: "gone" }));
        }
        return;
      }
      cursor.current = page.cursor;
      apply(page, false);
    } finally {
      inflight.current = false;
    }
  }, [apply, channel, query, transport]);

  const loadFirst = useCallback(async () => {
    stopped.current = false;
    cursor.current = null;
    setState(EMPTY);
    const page = await transport.load(channel, query({}));
    if (!page.ok) {
      if (STOPPING.has(page.code)) stopped.current = true;
      setState((s) => ({ ...s, status: STOPPING.has(page.code) ? "gone" : "error" }));
      return;
    }
    cursor.current = page.cursor;
    apply(page, true);
  }, [apply, channel, query, transport]);

  // First load, and again whenever the channel or the mode changes.
  useEffect(() => {
    void loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, modeKey, transport]);

  // Polling: 4 s on screen; paused completely when hidden (R-05), catching up immediately when visible again.
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        await poll();
        schedule();
      }, ROOM_POLL_VISIBLE_MS);
    };
    const visible = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        void poll().then(schedule);
      }
    };
    schedule();
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [poll]);

  const loadOlder = useCallback(async () => {
    const oldest = state.messages.find((m) => !m.pending);
    if (!state.hasMore || state.loadingOlder || !oldest) return;
    setState((s) => ({ ...s, loadingOlder: true }));
    const page = await transport.load(channel, query({ before: oldest.createdAt }));
    if (!page.ok || !("channel" in page)) {
      setState((s) => ({ ...s, loadingOlder: false }));
      return;
    }
    setState((s) => ({
      ...s,
      loadingOlder: false,
      hasMore: page.hasMore,
      legacy: page.hasMore ? s.legacy : page.legacy,
      messages: mergeMessages(page.messages, s.messages) as ShownMessage[],
    }));
  }, [channel, query, state.hasMore, state.loadingOlder, state.messages, transport]);

  /** Send with the line shown at once; on refusal it disappears again and the code comes back. */
  const send = useCallback(
    async (draft: Omit<SendDraft, "requestId">): Promise<{ ok: true } | Fail> => {
      const requestId = newRequestId();
      const now = new Date().toISOString();
      const temp: ShownMessage = {
        id: `pending-${requestId}`,
        channel,
        projectId: channel === "general" ? null : channel,
        parentId: draft.parentId ?? null,
        kind: "text",
        event: null,
        detail: null,
        authorId: viewer.authorId ?? "me",
        authorRole: transport.side === "team" ? "studio" : "brand",
        authorName: viewer.authorName,
        mine: true,
        body: draft.body,
        attachments: draft.attachments,
        mentions: draft.mentions,
        mentionsTeam: draft.mentionsTeam,
        ref: null,
        reactions: [],
        replyCount: 0,
        lastReplyAt: null,
        lastReplyMine: false,
        pinned: false,
        edited: false,
        deleted: false,
        createdAt: now,
        updatedAt: now,
        pending: true,
      };
      setState((s) => ({ ...s, messages: [...s.messages, temp] }));
      const result = await transport.send(channel, { ...draft, requestId });
      if (!result.ok) {
        setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== temp.id) }));
        return result;
      }
      if (result.message) {
        const real = result.message;
        setState((s) => ({ ...s, messages: mergeMessages(s.messages.filter((m) => m.id !== temp.id), [real]) as ShownMessage[] }));
      } else {
        await poll();
        setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== temp.id) }));
      }
      announceRoomActivity();
      return { ok: true };
    },
    [channel, poll, transport, viewer.authorName, viewer.authorId],
  );

  const replace = useCallback((message: RoomMessage) => {
    setState((s) => ({
      ...s,
      parent: s.parent?.id === message.id ? message : s.parent,
      messages: mergeMessages(s.messages, [message]) as ShownMessage[],
      pinned: pinnedFrom(s.pinned, [message]),
    }));
  }, []);

  const edit = useCallback(
    async (messageId: string, body: string): Promise<{ ok: true } | Fail> => {
      if (!transport.edit) return { ok: false, code: "forbidden" };
      const result = await transport.edit(channel, messageId, body);
      if (result.ok) replace(result.message);
      return result.ok ? { ok: true } : result;
    },
    [channel, replace, transport],
  );

  const remove = useCallback(
    async (messageId: string): Promise<{ ok: true } | Fail> => {
      const result = await transport.remove(channel, messageId);
      if (result.ok) {
        setState((s) => ({ ...s, pinned: s.pinned.filter((m) => m.id !== messageId) }));
        await poll();
        setState((s) => ({
          ...s,
          messages: s.messages
            .map((m) => (m.id === messageId ? { ...m, deleted: true, body: "", attachments: [], reactions: [], pinned: false } : m))
            .filter((m) => !(m.deleted && m.replyCount === 0)),
        }));
      }
      return result;
    },
    [channel, poll, transport],
  );

  const pin = useCallback(
    async (messageId: string, pinned: boolean): Promise<{ ok: true } | Fail> => {
      if (!transport.pin) return { ok: false, code: "forbidden" };
      const result = await transport.pin(channel, messageId, pinned);
      if (!result.ok) return result;
      if (result.message) replace(result.message);
      else await poll();
      if (!result.message) {
        // The team side does not echo: reflect the pin from what is on screen.
        setState((s) => {
          const hit = s.messages.find((m) => m.id === messageId) ?? s.pinned.find((m) => m.id === messageId);
          return hit ? { ...s, pinned: pinnedFrom(s.pinned, [{ ...hit, pinned }]) } : s;
        });
      }
      return { ok: true };
    },
    [channel, poll, replace, transport],
  );

  const react = useCallback(
    async (messageId: string, emoji: RoomReaction): Promise<{ ok: true } | Fail> => {
      if (!transport.react) return { ok: false, code: "forbidden" };
      const result = await transport.react(channel, messageId, emoji);
      if (result.ok) {
        setState((s) => ({
          ...s,
          parent: s.parent?.id === messageId ? { ...s.parent, reactions: result.reactions } : s.parent,
          messages: s.messages.map((m) => (m.id === messageId ? { ...m, reactions: result.reactions } : m)),
        }));
      }
      return result.ok ? { ok: true } : result;
    },
    [channel, transport],
  );

  return { state, loadOlder, send, edit, remove, pin, react, poll, reload: loadFirst };
}

/**
 * Mark a channel read up to its newest line, once it has been seen. Debounced; announces to the rail.
 * `seen` already folds in whether the conversation is on screen (./presence.ts); the tab must be in front
 * when the timer fires, by the same rule (`readMarkAllowed`).
 */
export function useReadMark(transport: ChatTransport, channel: string, newestAt: string | null, seen: boolean) {
  const marked = useRef<string | null>(null);
  useEffect(() => {
    marked.current = null;
  }, [channel]);
  useEffect(() => {
    if (!seen || !newestAt || (marked.current && marked.current >= newestAt)) return;
    const timer = window.setTimeout(() => {
      if (!readMarkAllowed({ seen, ready: true, visible: true, pageVisible: document.visibilityState === "visible" })) return;
      marked.current = newestAt;
      void transport.read(channel, newestAt).then(announceRoomActivity);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [channel, newestAt, seen, transport]);
}

export type { RoomRef };
