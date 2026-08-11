import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isNotifyToggle, type NotifyToggle } from './kinds';

/**
 * PLAN §3.5 — "Every email carries a one-click unsubscribe link (signed token flips the toggle)."
 *
 * The token discipline is `lib/media/token.ts`'s, deliberately: an HMAC over a compact payload,
 * constant-time comparison, a forged or truncated token is a refusal rather than a throw. Three
 * differences, each of them a consequence of what this token is FOR:
 *
 *   · **its own secret** (`NOTIFY_TOKEN_SECRET`). A media token is a 60-second read capability; this
 *     one is a write capability that must survive in someone's inbox for months. Sharing one secret
 *     between them would mean rotating either one revokes both, and would let a leak of the media
 *     signing key mutate profiles;
 *   · **no expiry.** An unsubscribe link that has quietly stopped working is worse than no link at
 *     all — it is the one control a recipient is entitled to reach on their own schedule;
 *   · **single-purpose payload** `{user_id, toggle}`. It authorises exactly "set this one column of
 *     this one profile to false" and carries nothing else, so possession of it is not a session:
 *     it cannot read, cannot enable, and cannot touch another user (the id is inside the signature).
 */

export interface UnsubscribeClaims {
  userId: string;
  toggle: NotifyToggle;
}

export type UnsubscribeFailure = 'malformed' | 'bad_signature';

export type UnsubscribeVerifyResult =
  | { ok: true; claims: UnsubscribeClaims }
  | { ok: false; reason: UnsubscribeFailure };

// ---------------------------------------------------------------------------
// secret
// ---------------------------------------------------------------------------

let ephemeral: string | null = null;

/**
 * Secret resolution, in order. No hard-coded fallback constant — a shipped default here would be a
 * forgeable capability to mutate any profile.
 *
 *   1. `NOTIFY_TOKEN_SECRET`        — the deployment's own secret (docs/SETUP.md go-live checklist)
 *   2. `SUPABASE_SERVICE_ROLE_KEY`  — already a server-only secret of at least equal sensitivity
 *   3. a per-process random         — dev/CI with no env at all. Links then die with the process,
 *                                     which is the safe direction (they refuse, they never grant).
 */
export function unsubscribeTokenSecret(): string {
  const explicit = process.env.NOTIFY_TOKEN_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRole && serviceRole.length >= 16 && !serviceRole.startsWith('YOUR-')) {
    return serviceRole;
  }

  if (ephemeral === null) {
    ephemeral = randomBytes(32).toString('hex');
    console.warn(
      '[notify] no NOTIFY_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY — signing unsubscribe links ' +
        'with a per-process random secret. Links will stop working on restart; set ' +
        'NOTIFY_TOKEN_SECRET before sending real mail.',
    );
  }
  return ephemeral;
}

// ---------------------------------------------------------------------------
// encoding
// ---------------------------------------------------------------------------

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signUnsubscribeToken(
  claims: UnsubscribeClaims,
  secret: string = unsubscribeTokenSecret(),
): string {
  const payload = b64url(JSON.stringify({ u: claims.userId, t: claims.toggle }));
  return `${payload}.${sign(payload, secret)}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyUnsubscribeToken(
  token: string,
  options: { secret?: string } = {},
): UnsubscribeVerifyResult {
  const secret = options.secret ?? unsubscribeTokenSecret();

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, signature] = parts as [string, string];

  if (!constantTimeEquals(signature, sign(payload, secret))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let decoded: { u?: unknown; t?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof decoded.u !== 'string' || decoded.u === '' || !isNotifyToggle(decoded.t)) {
    return { ok: false, reason: 'malformed' };
  }

  return { ok: true, claims: { userId: decoded.u, toggle: decoded.t } };
}

/** The path the emails link to, built in one place so the route and the templates cannot drift. */
export const UNSUBSCRIBE_PATH = '/api/notify/unsubscribe';

export function unsubscribePath(claims: UnsubscribeClaims, secret?: string): string {
  const token = signUnsubscribeToken(claims, secret ?? unsubscribeTokenSecret());
  return `${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;
}
