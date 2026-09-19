import 'server-only';
import { unstable_cache } from 'next/cache';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { CAMPAIGNS_TAG, CATALOG_TTL_SECONDS } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { readPublicProjection } from '@/lib/db/read-policy';
import { EMPTY_CAMPAIGN_CATALOG, loadCampaignCatalog, type CampaignCatalog } from './catalog';

/**
 * The cached campaign projection — `[static + tag 'campaigns' + 1h TTL]`, exactly the posture the
 * contests catalog established, for the same reasons: the listing varies by nobody, so one cached
 * document is right for everyone, and the admin's select/verify/pay operations invalidate it.
 */
async function readCampaignCatalog(): Promise<CampaignCatalog> {
  return readPublicProjection(await getSqlRunner(), EMPTY_CAMPAIGN_CATALOG, loadCampaignCatalog);
}

/**
 * Versioned key. A cached projection outlives a shape change (the site has been bitten three
 * times by this): **bump the version string in the same commit as any change to `CampaignCard`.**
 */
export const getCampaignCatalog = unstable_cache(readCampaignCatalog, ['campaign-catalog', 'v2-private-payment-terms', resolveRuntimeMode()], {
  tags: [CAMPAIGNS_TAG],
  revalidate: CATALOG_TTL_SECONDS,
});
