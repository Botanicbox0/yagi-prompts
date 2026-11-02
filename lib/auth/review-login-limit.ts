/** Warm-instance defence in addition to Supabase Auth's authoritative rate limits.
 * Bounded memory, no passwords, email addresses or raw client IPs are stored. */
import { createHash } from 'node:crypto';
const buckets = new Map<string, { count: number; until: number }>();
export function allowReviewLogin(client: string, email: string, now = Date.now()): boolean {
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const limits: Array<[string, number]> = [['global', 40], [`ip:${hash(client)}`, 10], [`email:${hash(email.toLowerCase().trim())}`, 5]];
  if (buckets.size > 4096 || limits.some(([key, limit]) => (buckets.get(key)?.count ?? 0) >= limit)) return false;
  for (const [key] of limits) {
    const current = buckets.get(key);
    buckets.set(key, { count: (current?.count ?? 0) + 1, until: current?.until ?? now + 60_000 });
  }
  return true;
}
