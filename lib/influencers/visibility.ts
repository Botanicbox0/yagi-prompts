import type { SqlRunner } from '@/lib/db/sql-runner';
import { loadCampaignCounts, loadCampaignsByIds, type CampaignRow } from '@/lib/campaigns/repo';
import { influencersOpen, isInfluencer } from './rules';

/**
 * Who sees, applies to and accepts which campaign (docs/PLATFORM-2.0.md §17.2). One rule for the
 * signed-in list, `loadApplyState`/`applyToCampaign` and `acceptInvitation`:
 *
 *   public       everyone (and the cached marketing list, which shows nothing else)
 *   influencers  members with a verified 3,000+ account, or named in campaign_targets
 *   invited      only members named in campaign_targets (an invitation link is its own proof)
 *
 * With TWINGS_INFLUENCERS off only `public` exists for members. `campaigns.audience` and
 * `campaign_targets` are 0056's (slice B1).
 */
export type CampaignAudience = 'public' | 'influencers' | 'invited';
export type AudienceAccess = 'ok' | 'influencer_required' | 'hidden';
type Env = Record<string, string | undefined>;

export function audienceOf(raw: unknown): CampaignAudience {
  return raw === 'influencers' || raw === 'invited' ? raw : 'public';
}

export function audienceAccess(audience: CampaignAudience, viewer: { open: boolean; influencer: boolean; targeted: boolean }): AudienceAccess {
  if (audience === 'public') return 'ok';
  if (!viewer.open) return 'hidden';
  if (viewer.targeted) return 'ok';
  if (audience === 'influencers') return viewer.influencer ? 'ok' : 'influencer_required';
  return 'hidden';
}

async function isTargeted(sql: SqlRunner, campaignId: string, userId: string): Promise<boolean> {
  return (await sql.query('select 1 from campaign_targets where campaign_id=$1 and user_id=$2', [campaignId, userId])).rows.length > 0;
}

export async function campaignAudience(sql: SqlRunner, campaignId: string): Promise<CampaignAudience> {
  const { rows } = await sql.query<{ audience: string | null }>('select audience from campaigns where id=$1', [campaignId]);
  return audienceOf(rows[0]?.audience);
}

/** The rule for one campaign and one viewer (null = signed out: never past `public`). */
export async function campaignAccess(sql: SqlRunner, campaignId: string, userId: string | null, env: Env = process.env): Promise<AudienceAccess> {
  const audience = await campaignAudience(sql, campaignId);
  if (audience === 'public') return 'ok';
  const open = influencersOpen(env);
  if (!open || userId === null) return audienceAccess(audience, { open, influencer: false, targeted: false });
  const targeted = await isTargeted(sql, campaignId, userId);
  const influencer = targeted ? false : await isInfluencer(sql, userId);
  return audienceAccess(audience, { open, influencer, targeted });
}

export interface VisibleCampaign { row: CampaignRow; audience: CampaignAudience; slotsTaken: number }
export interface VisibleCampaigns {
  open: boolean;
  influencer: boolean;
  /** `influencers` and `invited` campaigns this viewer may see, shown above the rest. */
  forYou: VisibleCampaign[];
  public: VisibleCampaign[];
}

/** The signed-in campaign list (`/campaigns/open`): per viewer, never cached. */
export async function loadVisibleCampaigns(sql: SqlRunner, userId: string, env: Env = process.env): Promise<VisibleCampaigns> {
  const open = influencersOpen(env);
  const influencer = open ? await isInfluencer(sql, userId) : false;
  const { rows } = await sql.query<{ id: string; audience: string | null; targeted: boolean }>(
    `select c.id, c.audience,
            exists(select 1 from campaign_targets t where t.campaign_id=c.id and t.user_id=$1) as targeted
       from campaigns c
      where c.status in ('recruiting','selecting','running')
      order by (c.status = 'recruiting') desc, c.applications_close_at asc nulls last, c.slug asc`,
    [userId],
  );
  const visible = rows
    .map(r => ({ id: r.id, audience: audienceOf(r.audience), targeted: r.targeted === true }))
    .filter(r => audienceAccess(r.audience, { open, influencer, targeted: r.targeted }) === 'ok');
  const [campaigns, counts] = await Promise.all([loadCampaignsByIds(sql, visible.map(r => r.id)), loadCampaignCounts(sql, visible.map(r => r.id))]);
  const byId = new Map(campaigns.map(c => [c.id, c]));
  const out = visible.flatMap(r => {
    const row = byId.get(r.id);
    return row ? [{ row, audience: r.audience, slotsTaken: counts.get(r.id)?.slotsTaken ?? 0 }] : [];
  });
  return { open, influencer, forYou: out.filter(c => c.audience !== 'public'), public: out.filter(c => c.audience === 'public') };
}
