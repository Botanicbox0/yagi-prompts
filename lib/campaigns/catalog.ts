import type { SqlRunner } from '@/lib/db/sql-runner';
import type { HostKind } from '@/lib/contests/schemas';
import { loadCampaignCounts, loadPublicCampaigns, type CampaignRow } from './repo';
import type {
  CampaignLocalized,
  CampaignPlatform,
  CampaignStatus,
  Deliverable,
  PayoutRule,
  Requirements,
} from './schemas';

/**
 * The public projection of a campaign — what the cached listing and detail pages read
 * (docs/CAMPAIGNS.md §6). Same posture as `lib/contests/catalog.ts`: dates, not phases (the phase
 * is derived at render time so the page can stay static), counts, never rows, and nothing a
 * creator or a client did not agree to make public. The client's budget is NOT here.
 *
 * A campaign's imagery is its style's: the card carries `styleSlug`, and the page joins it to the
 * prompt catalog's card for the poster and the example film. One image, one owner.
 */
export interface CampaignCard {
  id: string;
  slug: string;
  status: CampaignStatus;
  title: CampaignLocalized;
  summary: CampaignLocalized;
  brief: CampaignLocalized | null;
  hostName: string;
  hostKind: HostKind;
  hostUrl: string | null;
  styleSlug: string | null;
  platforms: CampaignPlatform[];
  deliverable: Deliverable;
  slots: number;
  /** selected + posted + verified + rejected + paid. */
  slotsTaken: number;
  applicationsCloseAt: string | null;
  postDeadlineAt: string | null;
  payout: PayoutRule | null;
  requirements: Requirements;
  publishedAt: string | null;
}

export interface CampaignCatalog {
  campaigns: CampaignCard[];
  totals: { live: number; recruiting: number };
}

export const EMPTY_CAMPAIGN_CATALOG: CampaignCatalog = { campaigns: [], totals: { live: 0, recruiting: 0 } };

export function toCampaignCard(row: CampaignRow, slotsTaken: number): CampaignCard {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    title: row.title,
    summary: row.summary,
    brief: row.brief,
    hostName: row.hostName,
    hostKind: row.hostKind,
    hostUrl: row.hostUrl,
    styleSlug: row.styleSlug,
    platforms: row.platforms,
    deliverable: row.deliverable,
    slots: row.slots,
    slotsTaken,
    applicationsCloseAt: row.applicationsCloseAt,
    postDeadlineAt: row.postDeadlineAt,
    payout: row.payout,
    requirements: row.requirements,
    publishedAt: row.publishedAt,
  };
}

export async function loadCampaignCatalog(sql: SqlRunner): Promise<CampaignCatalog> {
  const rows = await loadPublicCampaigns(sql);
  const counts = await loadCampaignCounts(sql, rows.map((row) => row.id));
  const campaigns = rows.map((row) => toCampaignCard(row, counts.get(row.id)?.slotsTaken ?? 0));
  return {
    campaigns,
    totals: {
      live: campaigns.length,
      recruiting: campaigns.filter((card) => card.status === 'recruiting').length,
    },
  };
}

/** Recruiting first (the actionable ones), then the rest, in the listing order the repo set. */
export function splitCampaigns(catalog: CampaignCatalog): { recruiting: CampaignCard[]; running: CampaignCard[] } {
  return {
    recruiting: catalog.campaigns.filter((card) => card.status === 'recruiting'),
    running: catalog.campaigns.filter((card) => card.status !== 'recruiting'),
  };
}
