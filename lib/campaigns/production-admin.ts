import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { campaignProductionOpen, campaignProductionSchemaReady } from './production';
import { CAMPAIGN_DISPATCH_PREFIX, CAMPAIGN_DISPATCH_REVIEW_MINUTES } from './production-dispatch';
export interface CampaignProductionAdmin {
  ready: boolean; open: boolean;
  config: { contractId: string; templateId: string; referenceAttachmentIds: string[]; enabled: boolean; revision: number } | null;
  formats: Array<{ contractId: string; templateId: string; projectId: string; title: string; titleKo: string; contractTitle: string; projectTitle: string }>;
  references: Array<{ id: string; name: string; projectId: string; projectTitle: string }>;
  jobs: Array<{ id: string; applicationId: string; status: string; retryApproved: boolean; needsReview: boolean }>;
}
export async function loadCampaignProductionAdmin(sql: SqlRunner, viewer: Viewer, campaignId: string): Promise<CampaignProductionAdmin | null> {
  if (!viewer.userId || !(await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1', [viewer.userId])).rows[0]?.is_admin) return null;
  const empty = { ready: false, open: campaignProductionOpen(), config: null, formats: [], references: [], jobs: [] };
  if (!await campaignProductionSchemaReady(sql)) return empty;
  const config = (await sql.query<NonNullable<CampaignProductionAdmin['config']>>('select contract_id as "contractId",template_id as "templateId",reference_attachment_ids as "referenceAttachmentIds",enabled,revision from campaign_productions where campaign_id=$1', [campaignId])).rows[0] ?? null;
  const formats = (await sql.query<CampaignProductionAdmin['formats'][number]>(`select c.id as "contractId",t.id as "templateId",c.project_id as "projectId",p.title,p.title_ko as "titleKo",c.title as "contractTitle",b.title as "projectTitle" from brand_production_templates t join brand_production_contracts c on c.id=t.contract_id join prompt_items p on p.id=t.id join brand_projects b on b.id=c.project_id where b.production_mode='creator' and b.status not in ('completed','cancelled') and p.status='published' order by c.created_at desc,t.created_at desc`)).rows;
  const references = (await sql.query<CampaignProductionAdmin['references'][number]>(`select a.id,a.name,a.project_id as "projectId",b.title as "projectTitle" from brand_attachments a join brand_projects b on b.id=a.project_id where a.status='ready' and a.access_scope='workspace' and a.mime in ('image/jpeg','image/png','image/webp') and a.size_bytes<=2000000 and b.id=any($1::uuid[]) order by a.created_at desc limit 200`, [[...new Set(formats.map(f => f.projectId))]])).rows;
  const jobs = (await sql.query<CampaignProductionAdmin['jobs'][number]>(`select j.id,l.application_id as "applicationId",j.status,(l.retry_approved_at is not null) as "retryApproved",
    (j.provider_task_id like $2 and l.dispatch_started_at<=now()-make_interval(mins=>$3)) as "needsReview" from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.campaign_id=$1 order by l.created_at desc`, [campaignId, `${CAMPAIGN_DISPATCH_PREFIX}%`, CAMPAIGN_DISPATCH_REVIEW_MINUTES])).rows;
  return { ready: true, open: campaignProductionOpen(), config, formats, references, jobs };
}
