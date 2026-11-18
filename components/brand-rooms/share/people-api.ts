/**
 * Browser calls for `/api/brand-rooms/people` (docs/BRAND-ROOMS-FEEDBACK.md §12). Every failure comes back
 * as `{ ok: false, code }`; nothing throws.
 */
import {
  ROOM_INVITE_ERROR_CODES,
  type RoomInviteErrorCode,
  type RoomInviteFailure,
  type RoomInviteSent,
  type RoomInviteTarget,
  type RoomPeople,
  type RoomPeopleDone,
} from "@/lib/brand-rooms/invite-contracts";

export const PEOPLE_ENDPOINT = "/api/brand-rooms/people";

const STATUS: Record<number, RoomInviteErrorCode> = { 400: "invalid", 401: "sign_in_required", 403: "forbidden", 404: "not_found", 409: "project_limit", 429: "rate_limited" };
const known = (code: unknown): code is RoomInviteErrorCode => typeof code === "string" && (ROOM_INVITE_ERROR_CODES as readonly string[]).includes(code);

async function call<T>(input: string, init?: RequestInit): Promise<T | RoomInviteFailure> {
  try {
    const response = await fetch(input, { credentials: "same-origin", cache: "no-store", ...init });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    if (response.ok && record?.ok === true) return record as T;
    if (known(record?.code)) return { ok: false, code: record.code, ...(typeof record.email === "string" ? { email: record.email } : {}) };
    return { ok: false, code: STATUS[response.status] ?? "failed" };
  } catch {
    return { ok: false, code: "failed" };
  }
}

const post = (operation: string, input: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ operation, input }),
});

export function fetchPeople(organizationId: string, projectId: string) {
  return call<RoomPeople>(`${PEOPLE_ENDPOINT}?${new URLSearchParams({ organizationId, projectId })}`);
}

export function sendInvites(input: {
  organizationId: string;
  projectId: string;
  emails: string[];
  canComment: boolean;
  target: RoomInviteTarget | null;
  locale: "ko" | "en";
  requestId: string;
}) {
  return call<RoomInviteSent>(PEOPLE_ENDPOINT, post("invite.send", input));
}

export function resendInvite(organizationId: string, projectId: string, inviteId: string, locale: "ko" | "en") {
  return call<RoomInviteSent>(PEOPLE_ENDPOINT, post("invite.resend", { organizationId, projectId, inviteId, locale }));
}

export function cancelInvite(organizationId: string, projectId: string, inviteId: string) {
  return call<RoomPeopleDone>(PEOPLE_ENDPOINT, post("invite.cancel", { organizationId, projectId, inviteId }));
}

export function setGuestPermission(organizationId: string, projectId: string, userId: string, canComment: boolean) {
  return call<RoomPeopleDone>(PEOPLE_ENDPOINT, post("guest.permission", { organizationId, projectId, userId, canComment }));
}

export function removeGuest(organizationId: string, projectId: string, userId: string) {
  return call<RoomPeopleDone>(PEOPLE_ENDPOINT, post("guest.remove", { organizationId, projectId, userId }));
}
