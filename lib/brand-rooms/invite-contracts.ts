/**
 * Project room invitations wire contract (docs/BRAND-ROOMS-FEEDBACK.md §12): a brand owner or editor
 * invites people by e-mail to one project room, as a guest who may view only or also leave comments, and
 * manages who has access. Behind `BRAND_ROOM_INVITES`.
 *
 * Client-safe: zod, types and pure helpers only (no env, no db, no crypto).
 */
import { z } from 'zod';

export const ROOM_INVITE_LIMITS = {
  /** Addresses in one send. */
  perSend: 10,
  /** Invitations one organization may issue in a day (the team's and its own; `BRAND_INVITES_PER_DAY`). */
  perOrganizationPerDay: 20,
  /** Invitations still waiting in one project. */
  pendingPerProject: 20,
  /** How long an invitation link works (the 0027 check allows at most 7). */
  expiryDays: 7,
  emailMax: 254,
} as const;

/** `POST /api/brand-rooms/people` */
export const ROOM_PEOPLE_OPERATIONS = ['invite.send', 'invite.resend', 'invite.cancel', 'guest.permission', 'guest.remove'] as const;
export type RoomPeopleOperation = (typeof ROOM_PEOPLE_OPERATIONS)[number];

export const ROOM_INVITE_ERROR_CODES = [
  'sign_in_required',
  'forbidden',
  'not_found',
  'invalid',
  'too_many',
  'rate_limited',
  'project_limit',
  'provider_unavailable',
  'failed',
] as const;
export type RoomInviteErrorCode = (typeof ROOM_INVITE_ERROR_CODES)[number];
export type RoomInviteFailure = { ok: false; code: RoomInviteErrorCode; email?: string };

export function roomInviteHttpStatus(code: RoomInviteErrorCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'invalid':
    case 'too_many':
      return 400;
    case 'project_limit':
      return 409;
    case 'rate_limited':
      return 429;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}

const EMAIL = z.email().max(ROOM_INVITE_LIMITS.emailMax);

/**
 * Split what was typed into addresses: commas, semicolons, spaces and line breaks separate them; case and
 * duplicates fold. Returns the valid ones in the order typed and the first invalid one, if any.
 */
export function parseInviteEmails(raw: string): { emails: string[]; invalid: string | null } {
  const seen = new Set<string>();
  const emails: string[] = [];
  let invalid: string | null = null;
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!email) continue;
    if (!EMAIL.safeParse(email).success) {
      invalid ??= part.trim();
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return { emails, invalid };
}

const Scope = { organizationId: z.uuid(), projectId: z.uuid() };

export const RoomInviteTargetSchema = z.object({ kind: z.enum(['review', 'storyboard']), id: z.uuid() });
export type RoomInviteTarget = z.infer<typeof RoomInviteTargetSchema>;

export const RoomInviteSendSchema = z.object({
  ...Scope,
  emails: z.array(z.string().trim().toLowerCase().pipe(EMAIL)).min(1).max(ROOM_INVITE_LIMITS.perSend),
  canComment: z.boolean().default(true),
  target: RoomInviteTargetSchema.nullable().default(null),
  locale: z.enum(['ko', 'en']).default('ko'),
  requestId: z.uuid(),
});
export const RoomInviteRefSchema = z.object({ ...Scope, inviteId: z.uuid(), locale: z.enum(['ko', 'en']).default('ko') });
export const RoomGuestPermissionSchema = z.object({ ...Scope, userId: z.uuid(), canComment: z.boolean() });
export const RoomGuestRemoveSchema = z.object({ ...Scope, userId: z.uuid() });

/** How an invitation's mail went: sent, refused or unreachable (failed), no mailer here (skipped), or none tried (null). */
export type RoomInviteMailState = 'sent' | 'failed' | 'skipped' | null;

export interface RoomPeopleMember {
  userId: string;
  name: string | null;
  /** Hidden for another owner, as on the members page. */
  email: string | null;
  role: 'owner' | 'editor' | 'viewer';
  self: boolean;
}
export interface RoomPeopleGuest {
  userId: string;
  name: string | null;
  /** The e-mail of the account that got in (it may differ from the invited address). */
  email: string | null;
  /** The address the invitation was sent to, when it differs from the account's. */
  invitedEmail: string | null;
  canComment: boolean;
  joinedAt: string;
}
export interface RoomPeoplePending {
  id: string;
  email: string;
  canComment: boolean;
  expiresAt: string;
  mailState: RoomInviteMailState;
}
export interface RoomPeople {
  ok: true;
  canManage: boolean;
  members: RoomPeopleMember[];
  guests: RoomPeopleGuest[];
  pending: RoomPeoplePending[];
}

/** One address of a send or a re-send. `link` (to copy and pass on) only when the mail did not go out. */
export interface RoomInviteResult {
  email: string;
  state: 'sent' | 'failed' | 'skipped' | 'already_member' | 'already_guest';
  inviteId: string | null;
  link: string | null;
}
export interface RoomInviteSent {
  ok: true;
  results: RoomInviteResult[];
}
export interface RoomPeopleDone {
  ok: true;
}

/** The acceptance page with the token in its fragment (never a query string). */
export function inviteAcceptPath(token: string): string {
  return `/brand/invite#token=${encodeURIComponent(token)}`;
}

/** Days left before `expiresAt`, rounded up (a fresh 7-day invitation says 7); 0 = under a day left ("오늘 만료"). */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  const ms = new Date(expiresAt).getTime() - now;
  return ms < 86_400_000 ? 0 : Math.ceil(ms / 86_400_000);
}
