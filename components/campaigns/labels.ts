import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PayoutLabels } from '@/lib/campaigns/copy';
import type { CampaignPlatform, CampaignStatus, Deliverable } from '@/lib/campaigns/schemas';
import type { HostKind } from '@/lib/contests/schemas';

/**
 * The dictionary → label seam for the campaign surfaces, like `components/contests/labels.ts`:
 * server pages hand a flat object to the presentational pieces, so none of them imports both
 * dictionaries.
 */
export interface CampaignLabels {
  status: Record<CampaignStatus, string>;
  platform: Record<CampaignPlatform, string>;
  deliverable: Record<Deliverable, string>;
  hostKind: Record<HostKind, string>;
  payout: PayoutLabels;
  payoutLabel: string;
  hostedBy: string;
  slotsLine: string;
  applyBy: string;
  postBy: string;
  applyCta: string;
  applyClosed: string;
  seeStyle: string;
}

export function campaignLabels(dict: Dictionary): CampaignLabels {
  const c = dict.campaigns;
  return {
    status: {
      draft: c.statusDraft,
      recruiting: c.statusRecruiting,
      selecting: c.statusSelecting,
      running: c.statusRunning,
      closed: c.statusClosed,
      archived: c.statusArchived,
    },
    platform: { instagram: c.platformInstagram, tiktok: c.platformTiktok, youtube: c.platformYoutube },
    deliverable: {
      reel: c.deliverableReel,
      feed: c.deliverableFeed,
      story: c.deliverableStory,
      short: c.deliverableShort,
      video: c.deliverableVideo,
    },
    hostKind: {
      brand: dict.contests.hostKindBrand,
      platform: dict.contests.hostKindPlatform,
      studio: dict.contests.hostKindStudio,
      creator: dict.contests.hostKindCreator,
      community: dict.contests.hostKindCommunity,
    },
    payout: {
      flat: c.payoutFlat,
      perView: c.payoutPerView,
      hybrid: c.payoutHybrid,
      floor: c.payoutFloor,
      cap: c.payoutCap,
      hold: c.payoutHold,
      holdNone: c.payoutHoldNone,
    },
    payoutLabel: c.payoutLabel,
    hostedBy: c.hostedBy,
    slotsLine: c.slotsLine,
    applyBy: c.applyBy,
    postBy: c.postBy,
    applyCta: c.applyCta,
    applyClosed: c.applyClosed,
    seeStyle: c.seeStyle,
  };
}
