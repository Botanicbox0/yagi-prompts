import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { campaignProductionSchemaReady } from './production';
import { isRenderId } from '@/lib/renders/share';
/** Only the selected creator's exact campaign preview. No generic brand attachment capability. */
export async function loadCampaignPreview(sql: SqlRunner, viewer: Viewer, applicationId: string) {
  if (!viewer.userId || !isRenderId(applicationId) || !await campaignProductionSchemaReady(sql)) return null;
  const row = (await sql.query<{ storage_key: string; mime: string; size_bytes: number }>(`select f.storage_key,f.mime,f.size_bytes from campaign_applications a
    join campaign_productions p on p.campaign_id=a.campaign_id join brand_production_contracts c on c.id=p.contract_id
    join brand_production_templates t on t.id=p.template_id and t.contract_id=c.id join brand_attachments f on f.id=t.preview_attachment_id and f.project_id=c.project_id
    where a.id=$1 and a.creator_id=$2 and a.status in ('selected','rejected','posted','verified','paid') and f.status='ready' and f.access_scope='workspace'`, [applicationId, viewer.userId])).rows[0];
  return row && ['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(row.mime) ? row : null;
}
