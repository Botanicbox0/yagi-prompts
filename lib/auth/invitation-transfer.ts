export const PENDING_BRAND_INVITATION_KEY = 'twings.brand.pending-invitation';

/** Client-only storage input. This value must never become an OAuth query or server prop. */
export function invitationBrowserAddress(target: string, stored: string | null, now = Date.now()): string {
  try {
    const url = new URL(target);
    if (url.pathname !== '/brand/invite' || !stored) return target;
    const pending = JSON.parse(stored);
    if (typeof pending?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pending.token)
      || typeof pending.expiresAt !== 'number' || !Number.isFinite(pending.expiresAt)
      || pending.expiresAt <= now || pending.expiresAt > now + 30 * 60 * 1000) return target;
    url.hash = `token=${encodeURIComponent(pending.token)}`;
    return url.href;
  } catch { return target; }
}
