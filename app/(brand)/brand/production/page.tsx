import type { Metadata } from 'next';
import { getCampaignOpsMetadata, renderCampaignOpsPage } from '@/components/brand-workspace/campaign-ops/server-page';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  return getCampaignOpsMetadata('production', searchParams);
}

export default async function BrandProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  return renderCampaignOpsPage('production', searchParams);
}
