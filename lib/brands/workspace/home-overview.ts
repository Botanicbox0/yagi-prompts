import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BrandProjectSummary, BrandHomeContent } from './types';

/** Only call with the membership/studio-authorized project list; never submitted ids. */
export async function withHomeOverview(sql: SqlRunner, projects: BrandProjectSummary[]): Promise<BrandProjectSummary[]> {
  if (!projects.length) return projects;
  const ids = projects.map(p => p.id);
  const contents = (await sql.query<{
    id: string; project_id: string; title: string; version: number; created_at: Date | string;
    decision: BrandHomeContent['decision']; attachment_id: string | null; mime: string | null;
  }>(`with current_content as (
    select distinct on (project_id,slot_key) id,project_id,organization_id,title,version,created_at,attachment_id
    from brand_content_versions where project_id=any($1::uuid[])
    order by project_id,slot_key,version desc
  ) select c.id,c.project_id,c.title,c.version,c.created_at,
    coalesce(d.decision,'pending') as decision,a.id as attachment_id,a.mime
    from current_content c
    left join lateral (select decision from brand_content_decisions where content_version_id=c.id
      and project_id=c.project_id and organization_id=c.organization_id order by revision desc limit 1) d on true
    left join brand_attachments a on a.id=c.attachment_id and a.project_id=c.project_id
      and a.organization_id=c.organization_id and a.status='ready'
    order by c.created_at desc,c.id`, [ids])).rows;
  const posts = (await sql.query<{ project_id: string; count: number }>(
    'select project_id,count(*)::int as count from brand_posts where project_id=any($1::uuid[]) group by project_id', [ids])).rows;
  return projects.map(p => {
    const own = contents.filter(c => c.project_id === p.id);
    return { ...p, overview: {
      pending: own.filter(c => c.decision === 'pending').length,
      changes: own.filter(c => c.decision === 'changes_requested').length,
      published: posts.find(row => row.project_id === p.id)?.count ?? 0,
      contents: own.slice(0, 4).map(c => ({ id: c.id, title: c.title, version: Number(c.version), decision: c.decision,
        mediaUrl: c.attachment_id ? `/api/brand-workspace/attachments/${c.attachment_id}` : null, mime: c.mime,
        createdAt: c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at) })),
    } };
  });
}
