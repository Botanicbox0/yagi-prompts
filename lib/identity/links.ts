import { normalizeReturnPath } from '@/lib/auth/return-path';

/**
 * The identity surface's paths, spelled once: the verify page (session-gated app surface, see
 * `APP_PREFIXES`), the bank's callback, and the studio's way in.
 */
export const IDENTITY_PATH = '/identity';
export const IDENTITY_VERIFY_PATH = '/identity/verify';
export const IDENTITY_CALLBACK_PATH = '/api/identity/callback';

/** Same rule as `/auth/signin`: same-origin relative paths only. */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 512 ? null : normalizeReturnPath(value);
}

export function identityVerifyHref(next: string | null, extra: { err?: string; result?: string } = {}): string {
  const query = new URLSearchParams();
  if (next) query.set('next', next);
  if (extra.err) query.set('err', extra.err);
  if (extra.result) query.set('result', extra.result);
  const suffix = query.toString();
  return `${IDENTITY_VERIFY_PATH}${suffix ? `?${suffix}` : ''}`;
}
