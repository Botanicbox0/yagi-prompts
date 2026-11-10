/**
 * Share links wire contract (docs/BRAND-ROOMS.md §6, §9-3): one review item or one storyboard shown to
 * someone outside the workspace, with an expiry, an optional passphrase, comments and download each on
 * or off, and a kill switch.
 *
 * Client-safe: zod, types and pure helpers only (no env, no db, no crypto).
 */
import { z } from 'zod';
import { CommentAddSchema } from '@/lib/brand-studio/review-contracts';

export const SHARE_KINDS = ['review', 'storyboard'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** `POST /api/brand-rooms/shares` (signed in, owners and editors). */
export const SHARE_OPERATIONS = ['share.create', 'share.revoke'] as const;
export type ShareOperation = (typeof SHARE_OPERATIONS)[number];

/** `POST /api/brand-rooms/shares/public` (no sign-in; the token is the key). */
export const SHARE_PUBLIC_OPERATIONS = ['view', 'unlock', 'comment'] as const;
export type SharePublicOperation = (typeof SHARE_PUBLIC_OPERATIONS)[number];

export const SHARE_LIMITS = {
  /** Founder decision pending (docs/BRAND-ROOMS.md §11): 14 days by default, 90 at most. */
  expiryDaysDefault: 14,
  expiryDaysMax: 90,
  passphraseMin: 4,
  passphraseMax: 64,
  guestNameMax: 40,
  guestBodyMax: 1000,
  /** Guest notes through one link. */
  guestCommentsPerMinute: 6,
  guestCommentsPerDay: 200,
  /** Wrong passphrases before the link pauses for the rest of the window. */
  unlockFailuresMax: 8,
  unlockWindowMinutes: 10,
  /** Live links one item may have at once. */
  livePerTarget: 20,
  listMax: 50,
} as const;

export const SHARE_EXPIRY_CHOICES = [1, 7, 14, 30, 90] as const;

export const SHARE_ERROR_CODES = [
  'sign_in_required',
  'forbidden',
  'not_found',
  'invalid',
  'rate_limited',
  'locked',
  'wrong_passphrase',
  'limit_reached',
  'comments_closed',
  'provider_unavailable',
  'failed',
] as const;
export type ShareErrorCode = (typeof SHARE_ERROR_CODES)[number];

export function isShareErrorCode(value: unknown): value is ShareErrorCode {
  return typeof value === 'string' && (SHARE_ERROR_CODES as readonly string[]).includes(value);
}

export function shareHttpStatus(code: ShareErrorCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
    case 'comments_closed':
      return 403;
    case 'not_found':
      return 404;
    case 'invalid':
    case 'wrong_passphrase':
      return 400;
    case 'limit_reached':
      return 409;
    case 'rate_limited':
    case 'locked':
      return 429;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}

/** 256 random bits, base64url: 43 characters. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isShareToken = (value: unknown): value is string => typeof value === 'string' && SHARE_TOKEN.test(value);

/** The public address of a link (relative; the screen adds its own origin). */
export const SHARE_PATH = '/s';
export const sharePath = (token: string) => `${SHARE_PATH}/${token}`;

/* -------------------------------------------------------------- inputs */

const Id = z.uuid();
const Token = z.string().regex(SHARE_TOKEN);
const OneLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(max));

export const ShareCreateSchema = z.object({
  organizationId: Id,
  kind: z.enum(SHARE_KINDS),
  targetId: Id,
  allowComments: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(SHARE_LIMITS.expiryDaysMax).default(SHARE_LIMITS.expiryDaysDefault),
  /** Empty or absent: no passphrase. */
  passphrase: z
    .string()
    .max(SHARE_LIMITS.passphraseMax)
    .nullish()
    .transform((s) => (s ? s.trim() : ''))
    .pipe(z.union([z.literal(''), z.string().min(SHARE_LIMITS.passphraseMin)])),
});
export type ShareCreateInput = z.input<typeof ShareCreateSchema>;

export const ShareRevokeSchema = z.object({ organizationId: Id, shareId: Id });
export const ShareListQuerySchema = z.object({ organizationId: Id, kind: z.enum(SHARE_KINDS), targetId: Id });

export const ShareViewSchema = z.object({ token: Token });
export const ShareUnlockSchema = z.object({ token: Token, passphrase: z.string().min(1).max(SHARE_LIMITS.passphraseMax) });

/** A guest's note: their name and the same note shape members write, with a shorter body. */
export const ShareCommentSchema = z.object({
  token: Token,
  name: OneLine(SHARE_LIMITS.guestNameMax),
  body: z
    .string()
    .transform((s) => s.replace(/\r\n/g, '\n').trim())
    .pipe(z.string().min(1).max(SHARE_LIMITS.guestBodyMax)),
  parentId: Id.nullish(),
  atMs: z.number().int().min(0).nullish(),
  endMs: z.number().int().min(0).nullish(),
  x: z.number().min(0).max(1).nullish(),
  y: z.number().min(0).max(1).nullish(),
  strokes: z.unknown().optional(),
});
export type ShareCommentInput = z.input<typeof ShareCommentSchema>;

/** The note part of a guest comment, checked again by the review contract. */
export const guestNoteOf = (v: z.output<typeof ShareCommentSchema>): Partial<z.input<typeof CommentAddSchema>> => ({
  body: v.body,
  parentId: v.parentId ?? null,
  atMs: v.atMs ?? null,
  endMs: v.endMs ?? null,
  x: v.x ?? null,
  y: v.y ?? null,
  strokes: (v.strokes ?? null) as never,
});

/* --------------------------------------------------------------- views */

export type ShareState = 'live' | 'expired' | 'revoked';

/** A link as its owners see it. Never the token, never its hash. */
export interface ShareLink {
  id: string;
  kind: ShareKind;
  targetId: string;
  allowComments: boolean;
  allowDownload: boolean;
  hasPassphrase: boolean;
  expiresAt: string;
  revokedAt: string | null;
  state: ShareState;
  views: number;
  lastViewedAt: string | null;
  createdAt: string;
  createdRole: 'brand' | 'studio';
}

export interface ShareFailure {
  ok: false;
  code: ShareErrorCode;
}

export interface ShareList {
  ok: true;
  shares: ShareLink[];
}

/** The only answer that carries the token: shown once, then gone. */
export interface ShareCreated {
  ok: true;
  share: ShareLink;
  token: string;
}

export interface ShareDone {
  ok: true;
}

/** What the share page tells the browser about its own link. */
export interface PublicShare {
  kind: ShareKind;
  allowComments: boolean;
  allowDownload: boolean;
  expiresAt: string;
}

export function shareStateOf(row: { revokedAt: string | null; expiresAt: string }, now = Date.now()): ShareState {
  if (row.revokedAt) return 'revoked';
  return Date.parse(row.expiresAt) <= now ? 'expired' : 'live';
}
