import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { INFLUENCER_MIN_FOLLOWERS, influencersOpen, isSocialPlatform, socialReady, type SocialPlatform } from '@/lib/influencers/rules';

/**
 * The creator pool (docs/PLATFORM-2.0.md §16.5, §17.3): verified accounts at or above the
 * influencer line whose owner ticked "show me to brands" on /identity/social. A brand sees a card
 * per account — handle, platform, a follower band rounded to the nearest 1,000 and the day it was
 * last checked — and can do one thing with it: invite that person to one of its recruiting
 * campaigns. Never the account id, an email, a name, the exact count or the profile link.
 * Owners and editors of the brand only; nothing while TWINGS_INFLUENCERS is off.
 */
export const POOL_PATH = '/brand/creators';
export const POOL_API = '/api/brand-creators';
export const POOL_BANDS = ['3k-10k', '10k-50k', '50k-100k', '100k+'] as const;
export type PoolBand = (typeof POOL_BANDS)[number];
const BAND_RANGE: Record<PoolBand, [number, number | null]> = {
  '3k-10k': [0, 10_000],
  '10k-50k': [10_000, 50_000],
  '50k-100k': [50_000, 100_000],
  '100k+': [100_000, null],
};
/** One page of cards. The search narrows it; a brand never needs more than this at once. */
export const POOL_LIMIT = 60;
const QUERY_MAX = 30;
type Env = Record<string, string | undefined>;

export function roundedFollowers(count: number): number {
  return Math.round(count / 1000) * 1000;
}

export function poolBandOf(rounded: number): PoolBand {
  return POOL_BANDS.find((band) => {
    const [min, max] = BAND_RANGE[band];
    return rounded >= min && (max === null || rounded < max);
  })!;
}

/** "3천" · "1.3만" · "125만" / "3K" · "1.25M". The number is already rounded; this only shortens it. */
export function compactFollowers(rounded: number, locale: string): string {
  const trim = (n: number) => String(Number(n.toFixed(2)));
  if (locale === 'ko') return rounded < 10_000 ? `${trim(rounded / 1000)}천` : `${trim(rounded / 10_000)}만`;
  return rounded < 1_000_000 ? `${trim(rounded / 1000)}K` : `${trim(rounded / 1_000_000)}M`;
}

/** Five per slot, never more than fifty, per campaign (B2-b brief). */
export function inviteCap(slots: number): number {
  return Math.max(0, Math.min(slots * 5, 50));
}

export interface PoolQuery { q: string; platform: SocialPlatform | null; band: PoolBand | null }

/** The page's GET form. A repeated or unknown value is dropped, never guessed. */
export function parsePoolQuery(search: Record<string, string | string[] | undefined>): PoolQuery {
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
  const q = one(search.q).trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, QUERY_MAX);
  const platform = one(search.platform);
  const band = one(search.band);
  return { q, platform: isSocialPlatform(platform) ? platform : null, band: (POOL_BANDS as readonly string[]).includes(band) ? (band as PoolBand) : null };
}

export interface PoolCard {
  /** The social account row, the only handle the invite action takes. Not the person's account id. */
  id: string;
  handle: string;
  platform: SocialPlatform;
  /** Rounded to the nearest 1,000. */
  followers: number;
  /** YYYY-MM-DD (KST) of the last administrator check. */
  checkedOn: string;
  /** This brand's campaigns the person is already invited to. */
  invitedTo: string[];
}
export interface PoolCampaign { id: string; slug: string; title: { en: string; ko: string }; slots: number; invited: number; cap: number; closesAt: string }
export type CreatorPool =
  | { state: 'closed' }
  | { state: 'forbidden' }
  | { state: 'unavailable' }
  | { state: 'open'; cards: PoolCard[]; campaigns: PoolCampaign[]; canInvite: boolean; truncated: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 0058 applied? Without it the pool lists but cannot invite. */
export async function designatedInvitesReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(
    "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='campaign_participant_invites' and column_name='invited_user_id') as ready",
  );
  return rows[0]?.ready === true;
}

/** Owner or editor of this brand, as a member (the TWINGS team view never invites). */
export async function poolRole(sql: SqlRunner, viewer: Viewer, organizationId: string): Promise<boolean> {
  if (!viewer.userId || viewer.isAdmin || !UUID.test(organizationId)) return false;
  const { rows } = await sql.query<{ role: string }>(
    "select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active'",
    [organizationId, viewer.userId],
  );
  return rows[0]?.role === 'owner' || rows[0]?.role === 'editor';
}

/** The pool's predicate, in one place for the list and the invite: verified, at the line, consenting. */
export const POOL_MEMBER_SQL = `s.status='verified' and s.follower_count >= ${INFLUENCER_MIN_FOLLOWERS} and s.pool_consent_at is not null`;

/**
 * Recruiting campaigns of this brand's active, shared projects that still take applications — the
 * only ones an invitation can be accepted into (`acceptInvitation` asks the same).
 */
async function invitableCampaigns(sql: SqlRunner, organizationId: string, now: Date, designated: boolean): Promise<PoolCampaign[]> {
  const { rows } = await sql.query<{ id: string; slug: string; title: PoolCampaign['title']; slots: number; closes: Date | string; invited: number }>(
    `select c.id, c.slug, c.title, c.slots, c.applications_close_at as closes,
            ${designated ? "(select count(*)::int from campaign_participant_invites i where i.campaign_id=c.id and i.invited_user_id is not null and i.revoked_at is null)" : '0'} as invited
       from campaigns c
       join campaign_collaboration_links l on l.campaign_id=c.id
       join brand_projects p on p.id=l.project_id
      where p.organization_id=$1 and p.status='active' and p.client_visible=true
        and c.status='recruiting' and c.applications_close_at > $2
      order by c.applications_close_at asc, c.slug asc`,
    [organizationId, now],
  );
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), title: r.title, slots: Number(r.slots), invited: Number(r.invited), cap: inviteCap(Number(r.slots)), closesAt: new Date(r.closes).toISOString() }));
}

export async function loadCreatorPool(
  deps: { sql: SqlRunner; now?: Date; env?: Env },
  viewer: Viewer,
  organizationId: string,
  query: PoolQuery,
): Promise<CreatorPool> {
  const env = deps.env ?? process.env;
  if (!influencersOpen(env)) return { state: 'closed' };
  const { sql } = deps;
  if (!(await poolRole(sql, viewer, organizationId))) return { state: 'forbidden' };
  if (!(await socialReady(sql))) return { state: 'unavailable' };
  const now = deps.now ?? new Date();
  const designated = await designatedInvitesReady(sql);
  const collaboration = env.CAMPAIGN_COLLABORATION_PUBLIC === 'on' &&
    (await sql.query<{ ready: boolean }>("select to_regclass('public.campaign_collaboration_links') is not null as ready")).rows[0]?.ready === true;
  const campaigns = collaboration ? await invitableCampaigns(sql, organizationId, now, designated) : [];

  const params: unknown[] = [];
  const where = [POOL_MEMBER_SQL];
  if (query.q) { params.push(query.q); where.push(`strpos(s.handle, $${params.length}) > 0`); }
  if (query.platform) { params.push(query.platform); where.push(`s.platform = $${params.length}`); }
  if (query.band) {
    // The band is over the ROUNDED number, so a card always sits in the band its label says.
    const [min, max] = BAND_RANGE[query.band];
    params.push(min); where.push(`round(s.follower_count / 1000.0) * 1000 >= $${params.length}`);
    if (max !== null) { params.push(max); where.push(`round(s.follower_count / 1000.0) * 1000 < $${params.length}`); }
  }
  params.push(POOL_LIMIT + 1);
  const { rows } = await sql.query<{ id: string; user_id: string; handle: string; platform: string; follower_count: number; measured_at: Date | string }>(
    `select s.id, s.user_id, s.handle, s.platform, s.follower_count, s.measured_at
       from social_accounts s
      where ${where.join(' and ')}
      order by round(s.follower_count / 1000.0) desc, s.handle asc
      limit $${params.length}`,
    params,
  );
  const page = rows.slice(0, POOL_LIMIT);
  // Which of this brand's open campaigns each person is already named in (targets, not links).
  const targeted = new Map<string, string[]>();
  if (campaigns.length && page.length) {
    const { rows: hits } = await sql.query<{ user_id: string; campaign_id: string }>(
      'select user_id, campaign_id from campaign_targets where campaign_id = any($1::uuid[]) and user_id = any($2::uuid[])',
      [campaigns.map((c) => c.id), [...new Set(page.map((r) => r.user_id))]],
    );
    for (const h of hits) targeted.set(h.user_id, [...(targeted.get(h.user_id) ?? []), String(h.campaign_id)]);
  }
  const kst = (d: Date | string) => new Date(+new Date(d) + 9 * 3600_000).toISOString().slice(0, 10);
  const cards = page.flatMap((r): PoolCard[] => isSocialPlatform(r.platform) ? [{
    id: String(r.id),
    handle: r.handle,
    platform: r.platform,
    followers: roundedFollowers(Number(r.follower_count)),
    checkedOn: kst(r.measured_at),
    invitedTo: targeted.get(r.user_id) ?? [],
  }] : []);
  return { state: 'open', cards, campaigns, canInvite: collaboration && designated, truncated: rows.length > POOL_LIMIT };
}
