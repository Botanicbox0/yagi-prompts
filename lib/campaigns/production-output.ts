import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { canReadBrandProject } from '@/lib/brands/workspace/service';
import { campaignProductionSchemaReady } from './production';
import { isRenderId } from '@/lib/renders/share';

/** Re-authorize every media request. Brands see submitted results only; never input photos/recipes. */
export async function loadCampaignOutput(deps: { sql: SqlRunner; verifiedEmail?: string }, viewer: Viewer, id: string) {
  if (!viewer.userId || !isRenderId(id) || !await campaignProductionSchemaReady(deps.sql)) return null;
  return deps.sql.transaction(async sql => {
    const row = (await sql.query<{ user_id: string; project_id: string; application_status: string; status: string; result_key: string | null; result_mime: string | null }>(`select j.user_id,b.project_id,a.status as application_status,j.status,j.result_key,j.result_mime
      from campaign_render_jobs l join render_jobs j on j.id=l.render_id join brand_production_contracts b on b.id=l.contract_id join campaign_applications a on a.id=l.application_id where j.id=$1`, [id])).rows[0];
    if (!row) return null;
    if (row.user_id !== viewer.userId && !(await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1', [viewer.userId])).rows[0]?.is_admin) {
      if (!['posted', 'verified', 'paid'].includes(row.application_status) || !await canReadBrandProject({ ...deps, sql }, viewer, row.project_id)) return null;
    }
    return { status: row.status, resultKey: row.result_key, resultMime: row.result_mime };
  });
}
