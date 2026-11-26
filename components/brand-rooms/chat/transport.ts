/**
 * How a conversation screen talks to the server. The brand side uses `/api/brand-rooms/messages`; the
 * team side (admin) reads through `/admin/brand-rooms/<organization>/feed` and writes through the
 * registered `brand_rooms.*` operations on `/admin/do` (docs/BRAND-ROOMS.md §9-2). The screens do not
 * know which one they have.
 */
import {
  isRoomErrorCode,
  refKeyOf,
  roomRefHref,
  type RoomAttachment,
  type RoomErrorCode,
  type RoomMessage,
  type RoomReaction,
  type RoomReactionView,
  type RoomRef,
  type RoomRefPage,
  type RoomStreamPage,
  type RoomThreadPage,
} from "@/lib/brand-rooms/message-contracts";
import { isUnapprovedUploadReason, type UploadLimitReason } from "@/lib/brands/upload-limits-format";
import type { RoomSummaryWithBell, RoomSummaryWithSendBell } from "@/lib/brand-rooms/bell";
import type {
  SendFileRef,
  SendFileThreads,
  SendInboxPage,
  SendInboxView,
  SendPeople,
  SendPostInput,
  SendPosted,
  SendReadAllDone,
  SendReadDone,
  SendReplyInput,
  SendThreadPage,
} from "@/lib/brand-rooms/send-contracts";

export type Fail = { ok: false; code: RoomErrorCode | "offline"; reason?: UploadLimitReason };
export type LoadResult = RoomStreamPage | RoomThreadPage | RoomRefPage | Fail;

export interface SendDraft {
  requestId: string;
  body: string;
  parentId?: string | null;
  ref?: RoomRef | null;
  attachments: RoomAttachment[];
  mentions: string[];
  mentionsTeam: boolean;
}

export interface ChatTransport {
  side: "brand" | "team";
  organizationId: string;
  load(channel: string, query: Record<string, string>): Promise<LoadResult>;
  /** A sent line, or `{ ok: true }` alone when the server does not echo it (the caller then polls). */
  send(channel: string, draft: SendDraft): Promise<{ ok: true; message?: RoomMessage } | Fail>;
  edit?(channel: string, messageId: string, body: string): Promise<{ ok: true; message: RoomMessage } | Fail>;
  remove(channel: string, messageId: string): Promise<{ ok: true } | Fail>;
  pin?(channel: string, messageId: string, pinned: boolean): Promise<{ ok: true; message?: RoomMessage } | Fail>;
  react?(channel: string, messageId: string, emoji: RoomReaction): Promise<{ ok: true; reactions: RoomReactionView[] } | Fail>;
  /**
   * Mark the channel read up to `at`. The brand side only: the team has no read mark, its waiting count clears
   * when it answers or presses 확인함 (docs/BRAND-ROOMS-FEEDBACK.md §3).
   */
  read?(channel: string, at: string): Promise<void>;
  upload?(channel: string, file: File, mime: string, onProgress: (ratio: number) => void): Promise<{ ok: true; attachment: RoomAttachment } | Fail>;
  /** Where a ref card leads, or null. */
  refHref(projectId: string, ref: RoomRef, atMs?: number | null): string | null;
}

const failOf = (body: unknown): Fail => {
  const obj = body as { code?: unknown; reason?: unknown } | null;
  const code = obj?.code;
  const reason = isUnapprovedUploadReason(obj?.reason) ? obj.reason : undefined;
  return { ok: false, code: isRoomErrorCode(code) ? code : "failed", ...(reason ? { reason } : {}) };
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
  return response.json().catch(() => ({ ok: false, code: response.ok ? "failed" : response.status === 404 ? "not_found" : "failed" }));
}

/** XHR for the bytes, so the composer can show progress. */
function sendBytes(method: "PUT" | "POST", url: string, file: File, mime: string, onProgress: (ratio: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("content-type", mime);
    if (method === "POST") xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}

/**
 * The bell's one read (docs/BRAND-PROJECT-SPINE.md §8.4, slice 3a; lib/brand-rooms/bell.ts): the 알림함's summary
 * with `bell` added for a workspace member while 직접 만들기 is open. `bell` absent: this person has no bell here.
 * A failure carries the server's code (`rooms_closed`, `not_found` and `sign_in_required` mean: stop asking on this
 * page) or `offline`. Marking a conversation read stays `brandTransport(organizationId).read(channel, at)`.
 */
export async function loadRoomBell(organizationId: string, fetcher: typeof fetch = (...args) => fetch(...args)): Promise<RoomSummaryWithBell | Fail> {
  try {
    const response = await fetcher(`/api/brand-rooms/summary?organizationId=${encodeURIComponent(organizationId)}&bell=1`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && body && body.ok === true) return body as unknown as RoomSummaryWithBell;
    return failOf(body ?? { code: response.status === 401 ? "sign_in_required" : response.status === 404 ? "not_found" : "failed" });
  } catch {
    return { ok: false, code: "offline" };
  }
}

export function brandTransport(organizationId: string): ChatTransport {
  const base = "/api/brand-rooms/messages";
  const post = async (operation: string, input: Record<string, unknown>): Promise<Record<string, unknown> | Fail> => {
    try {
      const response = await fetch(base, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operation, input: { organizationId, ...input } }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return body && body.ok === true ? body : failOf(body);
    } catch {
      return { ok: false, code: "offline" };
    }
  };
  return {
    side: "brand",
    organizationId,
    async load(channel, query) {
      try {
        const params = new URLSearchParams({ organizationId, projectId: channel, ...query });
        const body = await getJson(`${base}?${params.toString()}`);
        return (body as { ok?: unknown }).ok === true ? (body as LoadResult) : failOf(body);
      } catch {
        return { ok: false, code: "offline" };
      }
    },
    async send(channel, draft) {
      const body = await post("message.send", {
        projectId: channel,
        requestId: draft.requestId,
        body: draft.body,
        parentId: draft.parentId ?? null,
        ref: draft.ref ?? null,
        attachments: draft.attachments.map((a) => ({ key: a.key, name: a.name, size: a.size, width: a.width, height: a.height })),
        mentions: draft.mentions,
        mentionsTeam: draft.mentionsTeam,
      });
      return body.ok === true ? { ok: true, message: (body as { message: RoomMessage }).message } : (body as Fail);
    },
    async edit(channel, messageId, text) {
      const body = await post("message.edit", { projectId: channel, messageId, body: text });
      return body.ok === true ? { ok: true, message: (body as { message: RoomMessage }).message } : (body as Fail);
    },
    async remove(channel, messageId) {
      const body = await post("message.delete", { projectId: channel, messageId });
      return body.ok === true ? { ok: true } : (body as Fail);
    },
    async pin(channel, messageId, pinned) {
      const body = await post("message.pin", { projectId: channel, messageId, pinned });
      return body.ok === true ? { ok: true, message: (body as { message: RoomMessage }).message } : (body as Fail);
    },
    async react(channel, messageId, emoji) {
      const body = await post("reaction.toggle", { projectId: channel, messageId, emoji });
      return body.ok === true ? { ok: true, reactions: (body as { reactions: RoomReactionView[] }).reactions } : (body as Fail);
    },
    async read(channel, at) {
      await post("channel.read", { projectId: channel, at });
    },
    async upload(channel, file, mime, onProgress) {
      const reserved = await post("attachment.reserve", { projectId: channel, name: file.name, mime, size: file.size });
      if (reserved.ok !== true) return reserved as Fail;
      const { stagingKey, url, direct } = reserved as { stagingKey: string; url: string; direct: boolean };
      const put = await sendBytes(direct ? "PUT" : "POST", url, file, mime, onProgress);
      if (!put) return { ok: false, code: "failed" };
      const done = await post("attachment.complete", { projectId: channel, stagingKey, name: file.name, mime, size: file.size });
      return done.ok === true ? { ok: true, attachment: (done as { attachment: RoomAttachment }).attachment } : (done as Fail);
    },
    refHref: (projectId, ref, atMs) => roomRefHref(projectId, ref, organizationId, atMs),
  };
}

const ADMIN_CODES: Record<string, RoomErrorCode> = { forbidden: "forbidden", notFound: "not_found", invalid: "invalid", brandConflict: "conflict" };

/** The team's admin pages for what a ref points at. Storyboards and deliverables have their own team pages. */
export function adminRefHref(_projectId: string, ref: RoomRef): string {
  return ref.kind === "storyboard"
    ? `/admin/brand-rooms/storyboards/${ref.storyboardId}${ref.frameId ? `?frame=${ref.frameId}` : ""}`
    : `/admin/brand-studio/reviews/${ref.reviewId}`;
}

export function adminTransport(organizationId: string): ChatTransport {
  const feed = `/admin/brand-rooms/${organizationId}/feed`;
  const op = async (name: string, channel: string, fields: Record<string, string | null | undefined>): Promise<{ ok: true } | Fail> => {
    const form = new FormData();
    form.set("_op", name);
    form.set("_back", `/admin/brand-rooms/${organizationId}?channel=${encodeURIComponent(channel)}`);
    form.set("organizationId", organizationId);
    form.set("projectId", channel);
    for (const [key, value] of Object.entries(fields)) if (value != null && value !== "") form.set(key, value);
    try {
      const response = await fetch("/admin/do", { method: "POST", body: form, credentials: "same-origin", headers: { accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      return body?.ok ? { ok: true } : { ok: false, code: ADMIN_CODES[body?.code ?? ""] ?? "failed" };
    } catch {
      return { ok: false, code: "offline" };
    }
  };
  return {
    side: "team",
    organizationId,
    async load(channel, query) {
      try {
        const params = new URLSearchParams({ projectId: channel, ...query });
        const body = await getJson(`${feed}?${params.toString()}`);
        return (body as { ok?: unknown }).ok === true ? (body as LoadResult) : failOf(body);
      } catch {
        return { ok: false, code: "offline" };
      }
    },
    send: (channel, draft) =>
      op("brand_rooms.message.send", channel, {
        requestId: draft.requestId,
        body: draft.body,
        parentId: draft.parentId ?? null,
        ref: draft.ref ? refKeyOf(draft.ref) : null,
        mentions: draft.mentions.join(","),
      }),
    remove: (channel, messageId) => op("brand_rooms.message.delete", channel, { messageId }),
    pin: (channel, messageId, pinned) => op("brand_rooms.message.pin", channel, { messageId, pinned: String(pinned) }),
    // No `read`: opening a conversation does not clear what waits for the team (확인함 or an answer does).
    refHref: adminRefHref,
  };
}

/* ------------------------------------------------------------------ 보내기 (slice 4a) */

/**
 * 보내기's client (docs/BRAND-PROJECT-SPINE.md §8; lib/brand-rooms/send-contracts.ts). Every method posts one `send.*`
 * operation to `/api/brand-rooms/messages` for this organization and answers the server's shape, or `Fail` with the
 * server's code (`invalid` also while 보내기 is closed for the organization) or `offline`.
 */
export interface SendTransport {
  organizationId: string;
  /** A new thread about one file; the server takes the project and the channel from the file. */
  post(input: Omit<SendPostInput, "organizationId">): Promise<SendPosted | Fail>;
  /** A reply in a thread. */
  reply(input: Omit<SendReplyInput, "organizationId">): Promise<SendPosted | Fail>;
  /** One thread (marks it read for the caller unless `markRead: false`). */
  thread(rootId: string, options?: { markRead?: boolean }): Promise<SendThreadPage | Fail>;
  /** The threads about one file, newest first, and its card. */
  file(file: SendFileRef): Promise<SendFileThreads | Fail>;
  /** One page of "나에게 온 것" (`view: 'mentions'` for the "멘션" view); pass the previous page's `next` as `cursor`. */
  inbox(options?: { view?: SendInboxView; cursor?: string | null }): Promise<SendInboxPage | Fail>;
  /** Mark one thread read up to `at` (default: now). */
  read(rootId: string, at?: string | null): Promise<SendReadDone | Fail>;
  /** "모두 읽음". */
  readAll(): Promise<SendReadAllDone | Fail>;
  /** Who may be named with `@`. */
  people(): Promise<SendPeople | Fail>;
}

export function sendTransport(organizationId: string, fetcher: typeof fetch = (...args) => fetch(...args)): SendTransport {
  const post = async <T,>(operation: string, input: Record<string, unknown>): Promise<T | Fail> => {
    try {
      const response = await fetcher("/api/brand-rooms/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operation, input: { organizationId, ...input } }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return body && body.ok === true ? (body as unknown as T) : failOf(body ?? { code: response.status === 401 ? "sign_in_required" : response.status === 404 ? "not_found" : "failed" });
    } catch {
      return { ok: false, code: "offline" };
    }
  };
  return {
    organizationId,
    post: (input) => post<SendPosted>("send.post", { ...input }),
    reply: (input) => post<SendPosted>("send.reply", { ...input }),
    thread: (rootId, options) => post<SendThreadPage>("send.thread", options?.markRead === false ? { rootId, markRead: false } : { rootId }),
    file: (file) => post<SendFileThreads>("send.file", { file }),
    inbox: (options) => post<SendInboxPage>("send.inbox", { ...(options?.view ? { view: options.view } : {}), ...(options?.cursor ? { cursor: options.cursor } : {}) }),
    read: (rootId, at) => post<SendReadDone>("send.read", at ? { rootId, at } : { rootId }),
    readAll: () => post<SendReadAllDone>("send.read_all", {}),
    people: () => post<SendPeople>("send.people", {}),
  };
}

/**
 * The bell's read for the 4b screen (`loadRoomBell` with the members threads): the same `&bell=1` answer, `bell` typed as
 * it is while 보내기 is open (`RoomSendBell`, thread lines among `items`) or closed (`RoomBell`). `view: 'mentions'` asks
 * for the "멘션" view; the number (`bell.unread`) is the same in both views.
 */
export async function loadSendBell(organizationId: string, view: SendInboxView = "all", fetcher: typeof fetch = (...args) => fetch(...args)): Promise<RoomSummaryWithSendBell | Fail> {
  try {
    const response = await fetcher(`/api/brand-rooms/summary?organizationId=${encodeURIComponent(organizationId)}&bell=1${view === "mentions" ? "&view=mentions" : ""}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && body && body.ok === true) return body as unknown as RoomSummaryWithSendBell;
    return failOf(body ?? { code: response.status === 401 ? "sign_in_required" : response.status === 404 ? "not_found" : "failed" });
  } catch {
    return { ok: false, code: "offline" };
  }
}
