import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * PLAN §3.3 — "redirects to a ≤60s signed URL against the published private copy".
 *
 * Supabase Storage mints those itself (`createSignedUrl`). The local driver has no such service, so
 * the SEMANTICS live here instead of in the driver: an HMAC over (ref, bucket, key, expiry) that a
 * second hit on the gateway (`/api/media/[ref]?t=…`) verifies before any byte is read. Same
 * contract, same expiry window, same failure modes — so swapping in the Supabase driver changes who
 * signs, not what the gateway promises.
 *
 * Properties the tests pin:
 *   · a token is bound to ONE ref — replaying it against another block fails;
 *   · expiry is checked against an injectable clock, so "after 60s" is testable without waiting;
 *   · signature comparison is constant-time, and a truncated/forged token is a refusal, not a throw.
 */

/** §3.3 says ≤60s. This is the whole budget: mint, redirect, fetch. */
export const MEDIA_TOKEN_TTL_SECONDS = 60;

export interface MediaTokenClaims {
  /** The media ref this token is good for — a block id, or `{revisionId}:hero`. */
  ref: string;
  bucket: string;
  key: string;
  /** Unix seconds. */
  exp: number;
  /**
   * Response metadata, carried inside the signature rather than re-derived on the second hit: the
   * bytes are content-addressed (`{sha256}.{ext}`) and know nothing about their own type, and a
   * second database round trip to learn it would defeat the point of the token.
   */
  mime?: string;
  /** Workflow files only — drives `Content-Disposition: attachment`. */
  filename?: string;
}

export type VerifyFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'ref_mismatch';

export type VerifyResult =
  | { ok: true; claims: MediaTokenClaims }
  | { ok: false; reason: VerifyFailure };

// ---------------------------------------------------------------------------
// secret
// ---------------------------------------------------------------------------

let ephemeral: string | null = null;

/**
 * Secret resolution, in order. There is deliberately NO hard-coded fallback constant: a shipped
 * default secret is a forgeable capability, which is exactly what this token must not be.
 *
 *   1. `MEDIA_TOKEN_SECRET`      — the deployment's own secret (docs/SETUP.md)
 *   2. `SUPABASE_SERVICE_ROLE_KEY` — already a server-only secret of at least equal sensitivity
 *   3. a per-process random       — dev/CI with no env at all. Tokens then die with the process,
 *                                   which is harmless at a 60s TTL and is the safe direction.
 */
export function mediaTokenSecret(): string {
  const explicit = process.env.MEDIA_TOKEN_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRole && serviceRole.length >= 16 && !serviceRole.startsWith('YOUR-')) {
    return serviceRole;
  }

  if (ephemeral === null) {
    ephemeral = randomBytes(32).toString('hex');
    console.warn(
      '[media] no MEDIA_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY — signing media tokens with a ' +
        'per-process random secret. Fine for dev; set MEDIA_TOKEN_SECRET before deploying.',
    );
  }
  return ephemeral;
}

// ---------------------------------------------------------------------------
// encoding
// ---------------------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signMediaToken(
  claims: MediaTokenClaims,
  secret: string = mediaTokenSecret(),
): string {
  const body: Record<string, unknown> = {
    r: claims.ref,
    b: claims.bucket,
    k: claims.key,
    e: claims.exp,
  };
  if (claims.mime !== undefined) body.m = claims.mime;
  if (claims.filename !== undefined) body.f = claims.filename;
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload, secret)}`;
}

export function mintMediaToken(
  input: Omit<MediaTokenClaims, 'exp'>,
  options: { now?: number; ttlSeconds?: number; secret?: string } = {},
): { token: string; expiresAt: number } {
  const now = options.now ?? Date.now();
  const ttl = Math.min(options.ttlSeconds ?? MEDIA_TOKEN_TTL_SECONDS, MEDIA_TOKEN_TTL_SECONDS);
  const exp = Math.floor(now / 1000) + ttl;
  return {
    token: signMediaToken({ ...input, exp }, options.secret ?? mediaTokenSecret()),
    expiresAt: exp,
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyMediaToken(
  token: string,
  expected: { ref: string; now?: number; secret?: string },
): VerifyResult {
  const secret = expected.secret ?? mediaTokenSecret();
  const now = expected.now ?? Date.now();

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, signature] = parts as [string, string];

  if (!constantTimeEquals(signature, sign(payload, secret))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let decoded: { r?: unknown; b?: unknown; k?: unknown; e?: unknown; m?: unknown; f?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof decoded.r !== 'string' ||
    typeof decoded.b !== 'string' ||
    typeof decoded.k !== 'string' ||
    typeof decoded.e !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  // Ref binding is checked BEFORE expiry so a replay against another object reads as a replay.
  if (decoded.r !== expected.ref) return { ok: false, reason: 'ref_mismatch' };
  if (decoded.e * 1000 <= now) return { ok: false, reason: 'expired' };

  const claims: MediaTokenClaims = {
    ref: decoded.r,
    bucket: decoded.b,
    key: decoded.k,
    exp: decoded.e,
  };
  if (typeof decoded.m === 'string') claims.mime = decoded.m;
  if (typeof decoded.f === 'string') claims.filename = decoded.f;
  return { ok: true, claims };
}
