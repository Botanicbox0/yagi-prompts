import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * Influencer status (docs/PLATFORM-2.0.md §17, founder 2026-10-23): ONE linked account with
 * 3,000+ followers, confirmed by an administrator. Not a sum across accounts, never the model's
 * guess, never the number the member typed. Every gate that asks "is this an influencer" asks
 * `isInfluencer` — the screens, the campaign list, apply and invitation acceptance alike.
 */
export const INFLUENCER_MIN_FOLLOWERS = 3000;
export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
/** A confirmation older than this is shown as expired (re-submit, please); it keeps counting. */
export const SOCIAL_RECHECK_DAYS = 90;
export const SOCIAL_DAILY_SUBMISSIONS = 5;
export const SOCIAL_PATH = '/identity/social';
/** The signed-in campaign list, shaped per viewer (§17.2); `/{locale}/campaigns` stays public-only. */
export const OPEN_CAMPAIGNS_PATH = '/campaigns/open';

/** `TWINGS_INFLUENCERS=on` opens the page, the queue, the worker and the non-public campaigns. */
export function influencersOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_INFLUENCERS === 'on';
}

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** 0057 applied? Every reader degrades to "unavailable" without it instead of a 500. */
export async function socialReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>("select to_regclass('public.social_accounts') is not null as ready");
  return rows[0]?.ready === true;
}

/** A verified account at or above the line. `expired` rows (a later re-measurement) do not count. */
export async function isInfluencer(sql: SqlRunner, userId: string | null): Promise<boolean> {
  if (!userId || !(await socialReady(sql))) return false;
  const { rows } = await sql.query<{ yes: boolean }>(
    "select exists(select 1 from social_accounts where user_id=$1 and status='verified' and follower_count >= $2) as yes",
    [userId, INFLUENCER_MIN_FOLLOWERS],
  );
  return rows[0]?.yes === true;
}

const RESERVED: Record<SocialPlatform, Set<string>> = {
  instagram: new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct', 'tv', 'about', 'legal']),
  tiktok: new Set(),
  youtube: new Set(),
};
const HOST: Record<SocialPlatform, string> = { instagram: 'instagram.com', tiktok: 'tiktok.com', youtube: 'youtube.com' };
const HANDLE: Record<SocialPlatform, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/,
  tiktok: /^[a-z0-9_.]{2,24}$/,
  youtube: /^[a-z0-9_.-]{3,30}$/,
};

function profileOf(platform: SocialPlatform, handle: string): { handle: string; url: string } | null {
  const h = handle.toLowerCase();
  if (!HANDLE[platform].test(h) || RESERVED[platform].has(h) || /^\.|\.$|\.\./.test(h)) return null;
  if (platform === 'instagram') return { handle: h, url: `https://www.instagram.com/${h}/` };
  if (platform === 'tiktok') return { handle: h, url: `https://www.tiktok.com/@${h}` };
  return { handle: h, url: `https://www.youtube.com/@${h}` };
}

/**
 * The profile link, spelled one way per platform — parse only, the same posture as
 * `canonicalPost`: no fetch, no redirect. A bare `@handle` is accepted (phones copy that), a pasted
 * link must be on the chosen platform's own host, and share-sheet tails (`?igsh=…`) are dropped.
 */
export function normalizeProfileUrl(platform: SocialPlatform, raw: string): { handle: string; url: string } | null {
  const value = raw.trim();
  if (!value || value.length > 300 || /[\\\s%]|\/\.\.?\//.test(value)) return null;
  if (/^@?[A-Za-z0-9_.-]{1,30}$/.test(value)) return profileOf(platform, value.replace(/^@/, ''));
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host !== HOST[platform]) return null;
  const path = url.pathname;
  if (platform === 'instagram') {
    const m = path.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
    return m ? profileOf(platform, m[1]!) : null;
  }
  if (platform === 'tiktok') {
    const m = path.match(/^\/@([A-Za-z0-9_.]{2,24})\/?$/);
    return m ? profileOf(platform, m[1]!) : null;
  }
  const m = path.match(/^\/@([A-Za-z0-9_.-]{3,30})\/?$/);
  return m ? profileOf(platform, m[1]!) : null;
}

/** "12,345" / "12 345" / "12345" → 12345; empty → null; anything else → undefined (refuse). */
export function parseFollowerCount(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 1_000_000_000 ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const value = raw.replace(/[,\s]/g, '');
  if (!value) return null;
  if (!/^\d{1,10}$/.test(value)) return undefined;
  const n = Number(value);
  return n <= 1_000_000_000 ? n : undefined;
}
