import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { PromptRow } from '@/lib/prompts/repo';
import { loadPromptById } from '@/lib/prompts/repo';
import { acceptsPosts } from './state';
import type { CampaignStatus } from './schemas';

export type CampaignProductionCode = 'sign_in_required' | 'forbidden' | 'invalid' | 'not_found' | 'not_selected' | 'not_open' | 'unavailable' | 'contract_inactive' | 'quota_exhausted' | 'generation_used' | 'conflict' | 'not_failed';
type Failure = { ok: false; code: CampaignProductionCode };
type Row = Record<string, unknown>;
type Deps = { sql: SqlRunner; now?: Date };
class Refused extends Error { constructor(readonly code: string) { super(code); } }
const uuid = z.string().uuid();
const stamp = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
export const campaignProductionOpen = () => process.env.CAMPAIGN_PRODUCTION_PUBLIC === 'on';

/** Rollout seam: old manual campaigns remain readable before the new migration is applied. */
export async function campaignProductionSchemaReady(sql: SqlRunner): Promise<boolean> {
  return (await sql.query<{ ready: boolean }>("select to_regclass('public.campaign_productions') is not null and to_regclass('public.campaign_render_jobs') is not null as ready")).rows[0]?.ready === true;
}
async function admin(sql: SqlRunner, viewer: Viewer) {
  if (!uuid.safeParse(viewer.userId).success) throw new Refused('sign_in_required');
  if (!(await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1', [viewer.userId])).rows[0]?.is_admin) throw new Refused('forbidden');
}
function blocked(row: Row, now: Date): CampaignProductionCode | null {
  if (!['selected', 'rejected'].includes(String(row.application_status))) return 'not_selected';
  if (!campaignProductionOpen() || row.enabled !== true || row.project_status !== 'active' || !acceptsPosts({ status: row.campaign_status as CampaignStatus, postDeadlineAt: row.post_deadline_at == null ? null : stamp(row.post_deadline_at) }, now)) return 'not_open';
  if (row.contract_enabled !== true || +now < Date.parse(stamp(row.starts_at)) || +now >= Date.parse(stamp(row.ends_at))) return 'contract_inactive';
  return null;
}
const configSchema = z.object({ campaignId: uuid, contractId: uuid, templateId: uuid, enabled: z.boolean(), expectedRevision: z.number().int().min(-1), referenceAttachmentIds: z.array(uuid).max(3).default([]) }).strict();

/** Admin-only explicit sponsorship. Changing the binding/product after any render is refused. */
export async function configureCampaignProduction(deps: Deps, viewer: Viewer, input: unknown): Promise<{ ok: true; id: string } | Failure> {
  const parsed = configSchema.safeParse(input); if (!parsed.success) return { ok: false, code: 'invalid' };
  try {
    return await deps.sql.transaction(async sql => {
      await admin(sql, viewer);
      if (!await campaignProductionSchemaReady(sql)) throw new Refused('unavailable');
      const v = parsed.data;
      const campaign = (await sql.query('select id from campaigns where id=$1 for update', [v.campaignId])).rows[0];
      if (!campaign) throw new Refused('not_found');
      const binding = (await sql.query<Row>(`select c.id,c.project_id,p.status from brand_production_contracts c join brand_projects p on p.id=c.project_id
        join brand_production_templates t on t.contract_id=c.id join prompt_items f on f.id=t.id
        where c.id=$1 and t.id=$2 and p.production_mode='creator' and f.audience='brand' and f.status='published' and f.engine='seedance-2.5'`, [v.contractId, v.templateId])).rows[0];
      if (!binding) throw new Refused('not_found');
      const ids = [...new Set(v.referenceAttachmentIds)];
      if (ids.length !== v.referenceAttachmentIds.length) throw new Refused('invalid');
      const references = ids.length ? (await sql.query<Row>(`select id,size_bytes from brand_attachments where id=any($1::uuid[]) and project_id=$2 and status='ready' and access_scope='workspace' and mime in ('image/jpeg','image/png','image/webp') and size_bytes<=2000000`, [ids, binding.project_id])).rows : [];
      if (references.length !== ids.length || references.reduce((n, r) => n + Number(r.size_bytes), 0) > 4000000) throw new Refused('invalid');
      const old = (await sql.query<Row>('select * from campaign_productions where campaign_id=$1 for update', [v.campaignId])).rows[0];
      if (old && Number(old.revision) !== v.expectedRevision || !old && v.expectedRevision !== -1) throw new Refused('conflict');
      if (old && (old.contract_id !== v.contractId || old.template_id !== v.templateId || JSON.stringify(old.reference_attachment_ids) !== JSON.stringify(ids)) && (await sql.query('select render_id from campaign_render_jobs where campaign_id=$1 limit 1', [v.campaignId])).rows.length) throw new Refused('conflict');
      if (old) await sql.query('update campaign_productions set contract_id=$2,template_id=$3,reference_attachment_ids=$4,enabled=$5,revision=revision+1,updated_by=$6,updated_at=now() where campaign_id=$1', [v.campaignId, v.contractId, v.templateId, ids, v.enabled, viewer.userId]);
      else await sql.query('insert into campaign_productions(campaign_id,contract_id,template_id,reference_attachment_ids,enabled,updated_by) values($1,$2,$3,$4,$5,$6)', [v.campaignId, v.contractId, v.templateId, ids, v.enabled, viewer.userId]);
      return { ok: true as const, id: v.campaignId };
    });
  } catch (e) { if (e instanceof Refused) return { ok: false, code: e.code as CampaignProductionCode }; throw e; }
}

export interface CreatorProduction {
  requiresProduction: boolean;
  preview: { href: string; mime: string } | null;
  canCreate: boolean; blockedReason: CampaignProductionCode | null;
  job: { id: string; status: string } | null;
}
export async function loadCreatorProduction(sql: SqlRunner, creatorId: string, applicationId: string, now = new Date()): Promise<CreatorProduction | null> {
  return (await loadCreatorProductions(sql, creatorId, [applicationId], now)).get(applicationId) ?? null;
}
/** One batch for My campaigns, regardless of how many campaigns the creator has joined. */
export async function loadCreatorProductions(sql: SqlRunner, creatorId: string, applicationIds: string[], now = new Date()): Promise<Map<string, CreatorProduction>> {
  const out = new Map<string, CreatorProduction>();
  if (!uuid.safeParse(creatorId).success || !applicationIds.length || applicationIds.some(id => !uuid.safeParse(id).success) || !await campaignProductionSchemaReady(sql)) return out;
  const rows = (await sql.query<Row>(`select a.id,a.status as application_status,c.status as campaign_status,c.post_deadline_at,p.enabled,
    bc.enabled as contract_enabled,bc.starts_at,bc.ends_at,bp.status as project_status,
    (select count(*)::int from campaign_render_jobs j where j.application_id=a.id) as attempts,
    (select count(*)::int from campaign_render_jobs j where j.application_id=a.id and j.retry_approved_at is not null) as retries,
    (select count(*)::int from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.application_id=a.id and j.status<>'failed') as live,
    (select count(*)::int from brand_production_reservations r where r.contract_id=bc.id and r.released_at is null) as used,bc.generation_limit,
    latest.id as job_id,latest.status as job_status,preview.mime as preview_mime
    from campaign_applications a join campaigns c on c.id=a.campaign_id join campaign_productions p on p.campaign_id=c.id
    join brand_production_contracts bc on bc.id=p.contract_id join brand_projects bp on bp.id=bc.project_id
    join brand_production_templates bt on bt.id=p.template_id and bt.contract_id=p.contract_id
    left join brand_attachments preview on preview.id=bt.preview_attachment_id and preview.project_id=bc.project_id and preview.status='ready' and preview.access_scope='workspace'
    left join lateral(select j.id,j.status from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.application_id=a.id order by l.created_at desc,j.created_at desc limit 1) latest on true
    where a.id=any($1::uuid[]) and a.creator_id=$2`, [applicationIds, creatorId])).rows;
  for (const r of rows) {
    const job = r.job_id ? { id: String(r.job_id), status: String(r.job_status) } : null;
    const reason = blocked(r, now) ?? (Number(r.live) > 0 || Number(r.attempts) >= 1 + Number(r.retries) ? 'generation_used' : Number(r.used) >= Number(r.generation_limit) ? 'quota_exhausted' : null);
    const preview = r.preview_mime && ['selected','rejected','posted','verified','paid'].includes(String(r.application_status)) ? { href: `/api/campaign-production/${r.id}/preview`, mime: String(r.preview_mime) } : null;
    out.set(String(r.id), { requiresProduction: r.enabled === true || Number(r.attempts) > 0, preview, canCreate: reason === null, blockedReason: reason, job });
  }
  return out;
}

/** Reuses the exact contract lock and reservation table used by brand studio production.
 * No membership impersonation; authorization is the creator's selected campaign application.
 */
export async function reserveCampaignProduction<F extends string>(deps: Deps, viewer: Viewer,
  input: { applicationId: string; requestId: string; fingerprint: string },
  enqueue: (sql: SqlRunner, template: PromptRow, referenceAttachmentIds: string[]) => Promise<{ ok: true; id: string; held: boolean; referenceKeys?: string[] } | { ok: false; code: F }>,
): Promise<{ ok: true; id: string; held: boolean } | { ok: false; code: CampaignProductionCode | F }> {
  if (!viewer.userId) return { ok: false, code: 'sign_in_required' };
  if (!z.object({ applicationId: uuid, requestId: uuid, fingerprint: z.string().min(1).max(200) }).strict().safeParse(input).success) return { ok: false, code: 'invalid' };
  try { return await deps.sql.transaction(async sql => {
    if (!await campaignProductionSchemaReady(sql)) throw new Refused('unavailable');
    const a = (await sql.query<Row>('select campaign_id from campaign_applications where id=$1 and creator_id=$2', [input.applicationId, viewer.userId])).rows[0];
    if (!a) throw new Refused('not_found');
    // Campaign -> config -> project -> contract -> application; configure/select use the same root lock.
    await sql.query('select id from campaigns where id=$1 for update', [a.campaign_id]);
    const p = (await sql.query<Row>('select * from campaign_productions where campaign_id=$1 for update', [a.campaign_id])).rows[0];
    if (!p) throw new Refused('not_found');
    const project = (await sql.query<Row>('select bp.id,bp.status from brand_projects bp join brand_production_contracts c on c.project_id=bp.id where c.id=$1 for share of bp', [p.contract_id])).rows[0];
    const contract = (await sql.query<Row>('select * from brand_production_contracts where id=$1 for update', [p.contract_id])).rows[0];
    const app = (await sql.query<Row>('select * from campaign_applications where id=$1 and creator_id=$2 for update', [input.applicationId, viewer.userId])).rows[0];
    const campaign = (await sql.query<Row>('select status,post_deadline_at from campaigns where id=$1', [a.campaign_id])).rows[0];
    if (!app || !contract || !project || !campaign) throw new Refused('not_found');
    const prior = (await sql.query<Row>('select r.*,j.status,l.application_id from brand_production_reservations r join render_jobs j on j.id=r.render_id left join campaign_render_jobs l on l.render_id=r.render_id where r.user_id=$1 and r.request_id=$2', [viewer.userId, input.requestId])).rows[0];
    if (prior) {
      if (prior.application_id !== input.applicationId || prior.fingerprint !== input.fingerprint) throw new Refused('conflict');
      return { ok: true as const, id: String(prior.render_id), held: prior.status === 'held' };
    }
    const reason = blocked({ application_status: app.status, campaign_status: campaign.status, post_deadline_at: campaign.post_deadline_at, enabled: p.enabled, project_status: project.status, contract_enabled: contract.enabled, starts_at: contract.starts_at, ends_at: contract.ends_at }, deps.now ?? new Date());
    if (reason) throw new Refused(reason);
    const tally = (await sql.query<{ attempts: number; retries: number; live: number }>(`select count(*)::int as attempts,count(*) filter(where l.retry_approved_at is not null)::int as retries,count(*) filter(where j.status<>'failed')::int as live from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.application_id=$1`, [input.applicationId])).rows[0]!;
    if (tally.live || tally.attempts >= 1 + tally.retries) throw new Refused('generation_used');
    const used = (await sql.query<{ n: number }>('select count(*)::int as n from brand_production_reservations where contract_id=$1 and released_at is null', [p.contract_id])).rows[0]!.n;
    if (used >= Number(contract.generation_limit)) throw new Refused('quota_exhausted');
    const template = await loadPromptById(sql, String(p.template_id));
    if (!template || template.audience !== 'brand' || template.status !== 'published' || template.engine !== 'seedance-2.5' || template.medium !== 'video') throw new Refused('not_found');
    const created = await enqueue(sql, template, p.reference_attachment_ids as string[]);
    if (!created.ok) throw new Refused(created.code);
    await sql.query('insert into brand_production_reservations(render_id,contract_id,template_id,user_id,request_id,fingerprint) values($1,$2,$3,$4,$5,$6)', [created.id, p.contract_id, p.template_id, viewer.userId, input.requestId, input.fingerprint]);
    await sql.query('insert into campaign_render_jobs(render_id,application_id,campaign_id,contract_id,template_id,creator_id,reference_keys) values($1,$2,$3,$4,$5,$6,$7::jsonb)', [created.id, input.applicationId, a.campaign_id, p.contract_id, p.template_id, viewer.userId, JSON.stringify(created.referenceKeys ?? [])]);
    return { ok: true as const, id: created.id, held: created.held };
  }); } catch (e) {
    if (e instanceof Refused) return { ok: false, code: e.code as CampaignProductionCode | F };
    if ((e as { code?: string }).code === '23505') return { ok: false, code: 'conflict' };
    throw e;
  }
}

/** One extra attempt for one actual terminal failure. Repeating the admin action cannot add more. */
export async function approveCampaignRetry(deps: Deps, viewer: Viewer, renderId: string): Promise<{ ok: true } | Failure> {
  if (!uuid.safeParse(renderId).success) return { ok: false, code: 'invalid' };
  try { return await deps.sql.transaction(async sql => {
    await admin(sql, viewer);
    if (!await campaignProductionSchemaReady(sql)) throw new Refused('unavailable');
    const r = (await sql.query<Row>('select l.*,j.status from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.render_id=$1 for update of l', [renderId])).rows[0];
    if (!r) throw new Refused('not_found'); if (r.status !== 'failed') throw new Refused('not_failed');
    await sql.query('update campaign_render_jobs set retry_approved_by=$2,retry_approved_at=now() where render_id=$1 and retry_approved_at is null', [renderId, viewer.userId]);
    return { ok: true as const };
  }); } catch (e) { if (e instanceof Refused) return { ok: false, code: e.code as CampaignProductionCode }; throw e; }
}

export interface CampaignParticipation {
  id: string; slug: string; title: { en: string; ko: string }; slots: number;
  /** The campaign's own lifecycle state (drives the brand timeline); absent in older fixtures. */
  status?: import('./schemas').CampaignStatus;
  applied: number; selected: number; generated: number; posted: number; verified: number; paid: number;
  posts: Array<{ id: string; url: string; status: string; renderId: string | null }>;
}
/** Internal projection, invoked ONLY after the caller authorized this brand project. No inputs/prompts/money. */
export async function loadCampaignParticipation(sql: SqlRunner, projectId: string): Promise<CampaignParticipation[]> {
  if (!await campaignProductionSchemaReady(sql)) return [];
  const rows = (await sql.query<Row>(`select c.id,c.slug,c.title,c.slots,c.status,
    count(a.id)::int as applied,count(a.id) filter(where a.status in ('selected','rejected','posted','verified','paid'))::int as selected,
    count(a.id) filter(where exists(select 1 from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.application_id=a.id and j.status='succeeded'))::int as generated,
    count(a.id) filter(where a.status in ('posted','verified','paid'))::int as posted,
    count(a.id) filter(where a.status in ('verified','paid'))::int as verified,count(a.id) filter(where a.status='paid')::int as paid
    from campaign_productions p join brand_production_contracts b on b.id=p.contract_id join campaigns c on c.id=p.campaign_id
    left join campaign_applications a on a.campaign_id=c.id where b.project_id=$1 group by c.id order by c.created_at`, [projectId])).rows;
  return Promise.all(rows.map(async r => ({ id: String(r.id), slug: String(r.slug), title: r.title as CampaignParticipation['title'], slots: Number(r.slots), status: r.status as CampaignParticipation['status'], applied: Number(r.applied), selected: Number(r.selected), generated: Number(r.generated), posted: Number(r.posted), verified: Number(r.verified), paid: Number(r.paid), posts: (await sql.query<{ id: string; url: string; status: string; renderId: string | null }>(`select a.id,a.post_url as url,a.status,(select l.render_id from campaign_render_jobs l join render_jobs j on j.id=l.render_id where l.application_id=a.id and j.status='succeeded' order by l.created_at desc limit 1) as "renderId" from campaign_applications a where a.campaign_id=$1 and a.status in ('posted','verified','paid') and a.post_url is not null order by a.posted_at`, [r.id])).rows })));
}
