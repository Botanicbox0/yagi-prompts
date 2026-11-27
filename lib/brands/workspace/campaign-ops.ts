import type { RoomEntryOrg } from '@/components/brand-rooms/room/visibility';
import { brandCampaignOpsOpenFor, brandRoomsOpen, brandStudioV2Open } from '@/lib/flags';
import { campaignOpsEligible } from './campaign-ops-policy';

/**
 * Single source of truth for whether Campaign Ops C1 is open for this viewer's selected org:
 * requires `BRAND_STUDIO_V2=on`, `BRAND_ROOMS=on`, `BRAND_CAMPAIGN_OPS=on` matching the org list,
 * and an eligible non-guest, non-staff, non-sandboxed, `generative_media`-open org.
 */
export function campaignOpsOpenForViewer(
  org: RoomEntryOrg | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const processEnv = env as NodeJS.ProcessEnv;
  if (!brandStudioV2Open(processEnv) || !brandRoomsOpen(processEnv)) return false;
  if (!campaignOpsEligible(org)) return false;
  return brandCampaignOpsOpenFor(org!.id, env);
}
