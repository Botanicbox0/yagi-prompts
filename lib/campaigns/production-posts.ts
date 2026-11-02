import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { importBrandExternalPosts } from '@/lib/brands/workspace/service';
import { campaignProductionSchemaReady } from './production';
export class CampaignPostSyncFailed extends Error { constructor(readonly code: 'brandNotActive' | 'invalid') { super(code); } }
/** Reviewed SNS posts enter the existing brand report pipeline once, without inventing metrics
 * or treating the creator's submission time as the original publication time.
 */
export async function syncVerifiedCampaignPost(sql: SqlRunner, viewer: Viewer, applicationId: string) {
  if (!await campaignProductionSchemaReady(sql)) return;
  const row = (await sql.query<{ project_id: string; post_url: string }>(`select b.project_id,a.post_url from campaign_applications a join campaign_productions p on p.campaign_id=a.campaign_id join brand_production_contracts b on b.id=p.contract_id where a.id=$1 and a.status in ('verified','paid') and a.post_url is not null`, [applicationId])).rows[0];
  if (!row) return;
  const result = await importBrandExternalPosts({ sql }, viewer, { projectId: row.project_id, requestId: applicationId, verification: 'manual', posts: [{ url: row.post_url, publishedAt: null }] });
  if (!result.ok) throw new CampaignPostSyncFailed(result.code === 'not_active' ? 'brandNotActive' : 'invalid');
}
