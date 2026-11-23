import { createHash } from 'node:crypto';

export const CONCIERGE_UID_COOKIE = 'twings_concierge_uid';

/** Opaque, non-PII per-user key for scoping browser localStorage escalation hints (zero auth authority). */
export function conciergeUserScopeKey(userId: string): string {
  return createHash('sha256').update(`twings-concierge-uid:v1:${userId}`).digest('hex').slice(0, 24);
}
