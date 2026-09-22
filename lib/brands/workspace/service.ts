import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { withHomeOverview } from './home-overview';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STAGING_BUCKET, type StorageDriver } from '@/lib/storage';
import {
  BrandHttpsUrlSchema, BrandOrganizationSchema, BrandProjectSchema, BrandProjectStatusSchema, BrandContentSchema,
  BrandDecisionSchema, BrandMessageSchema, BrandPostSchema, BrandReportSchema, BrandAttachmentSchema,
  BRAND_ATTACHMENT_LIMITS, normalizeBrandPostUrl,
  BrandInvitationSchema, BrandInvitationAcceptSchema, BrandMemberRevokeSchema,
  BrandCriteriaSchema,
  BrandPostMetricsSchema,
} from './schemas';
import type {
  BrandOutcome, BrandFailureCode, BrandRole, BrandProjectSummary, BrandProjectDetail, BrandWorkspace,
  BrandContentVersion, BrandDecision, BrandMessage, BrandAttachment, BrandPost, BrandReport, BrandReportSnapshot,
  BrandMembers,
} from './types';
export type * from './types';
export interface BrandWorkspaceDeps {
  sql: SqlRunner;
  storage?: Pick<StorageDriver, 'read'>;
  /** Server-authenticated verified email only, never a request-body value. Used for invitations. */
  verifiedEmail?: string;
}
type Row = Record<string, unknown>;
class Denied extends Error { constructor(readonly code: BrandFailureCode) { super(code); } }
const uuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;
const stamp = (v: unknown): string => v instanceof Date ? v.toISOString() : String(v);
const day = (v: unknown): string | null => v == null ? null : stamp(v).slice(0, 10);
const nullableNumber = (v: unknown): number | null => v == null ? null : Number(v);
const fail = (code: BrandFailureCode) => ({ ok: false as const, code });

async function profile(sql: SqlRunner, userId: string, write = false): Promise<Row> {
  const row = (await sql.query(`select id,is_admin,email from profiles where id=$1 ${write ? 'for update' : 'for share'}`, [userId])).rows[0];
  if (!row) throw new Denied('sign_in_required'); return row;
}
async function studio(sql: SqlRunner, userId: string): Promise<void> {
  if ((await profile(sql, userId)).is_admin !== true) throw new Denied('forbidden');
}
async function member(sql: SqlRunner, userId: string, organizationId: string, write = false): Promise<BrandRole> {
  const row = (await sql.query('select role from brand_memberships where organization_id=$1 and user_id=$2 and status=\'active\' for share', [organizationId, userId])).rows[0];
  if (!row) throw new Denied('not_found');
  if (write && row.role === 'viewer') throw new Denied('forbidden');
  return row.role as BrandRole;
}
async function project(sql: SqlRunner, userId: string, id: string, options: { studio?: boolean; write?: boolean } = {}): Promise<Row> {
  if (options.studio) await studio(sql, userId);
  const row = (await sql.query(`select p.*,o.name as organization_name from brand_projects p
    join brand_organizations o on o.id=p.organization_id where p.id=$1 ${options.write ? 'for update of p' : 'for share of p'}`, [id])).rows[0];
  if (!row) throw new Denied('not_found');
  if (options.studio) row.member_role = 'studio';
  else {
    if (!row.client_visible) throw new Denied('not_found');
    const orgRole = (await sql.query("select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active' for share", [row.organization_id,userId])).rows[0];
    const grant = orgRole || (await sql.query("select user_id from brand_project_members where project_id=$1 and user_id=$2 and status='active' for share", [id,userId])).rows[0];
    if (!grant) throw new Denied('not_found');
    row.member_role = orgRole?.role ?? 'viewer';
    if(options.write && row.member_role==='viewer') throw new Denied('forbidden');
  }
  return row;
}
async function mutation<S extends z.ZodType, T>(deps: BrandWorkspaceDeps, viewer: Viewer, schema: S, input: unknown,
  perform: (sql: SqlRunner, userId: string, value: z.output<S>) => Promise<T>): Promise<BrandOutcome<T>> {
  if (!uuid(viewer.userId)) return fail('sign_in_required');
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: String(parsed.error.issues[0]?.path[0] ?? '') };
  try {
    return await deps.sql.transaction(async sql => {
      await profile(sql, viewer.userId!, true);
      return { ok: true as const, ...await perform(sql, viewer.userId!, parsed.data) };
    });
  } catch (error) {
    if (error instanceof Denied) return fail(error.code);
    if ((error as { code?: string }).code === '23505') return fail('conflict');
    throw error;
  }
}
async function event(sql: SqlRunner, row: Row, kind: string, subjectId: string) {
  await sql.query('insert into brand_workspace_events(organization_id,project_id,kind,subject_id) values($1,$2,$3,$4) on conflict(kind,subject_id) do nothing', [row.organization_id, row.id, kind, subjectId]);
}
async function retry(sql: SqlRunner, table: string, projectId: string, userId: string, requestId: string): Promise<string | null> {
  // Call sites use fixed table names, never any submitted string.
  return (await sql.query<{ id: string }>(`select id from ${table} where project_id=$1 and created_by=$2 and request_id=$3`, [projectId, userId, requestId])).rows[0]?.id ?? null;
}
function summary(row: Row): BrandProjectSummary {
  return {
    clientVisible: Boolean(row.client_visible), id: String(row.id), organizationId: String(row.organization_id), organizationName: String(row.organization_name),
    title: String(row.title), objective: String(row.objective), audience: String(row.audience), budgetKrw: nullableNumber(row.budget_krw),
    criteria: BrandCriteriaSchema.parse(row.criteria),
    budgetTaxBasis: row.budget_tax_basis as BrandProjectSummary['budgetTaxBasis'], startsOn: day(row.starts_on), endsOn: day(row.ends_on),
    productionMode: row.production_mode as BrandProjectSummary['productionMode'], status: row.status as BrandProjectSummary['status'],
    revision: Number(row.revision), createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at),
  };
}
function postDto(row: Row): BrandPost {
  return { id: String(row.id), contentVersionId: String(row.content_version_id), url: String(row.url), platform: row.platform as BrandPost['platform'],
    publishedAt: stamp(row.published_at), metricRevision: Number(row.metric_revision),
    verification: row.verification as BrandPost['verification'], metricsSource: row.metrics_source as BrandPost['metricsSource'],
    measuredAt: row.measured_at == null ? null : stamp(row.measured_at), views: nullableNumber(row.views), likes: nullableNumber(row.likes),
    comments: nullableNumber(row.comments), shares: nullableNumber(row.shares), saves: nullableNumber(row.saves), createdAt: stamp(row.created_at) };
}
async function detail(sql: SqlRunner, row: Row): Promise<BrandProjectDetail> {
  const params = [row.organization_id, row.id];
  const scoped = async (table: string, suffix = '') => (await sql.query(`select * from ${table} where organization_id=$1 and project_id=$2 ${suffix}`, params)).rows;
  const contents: BrandContentVersion[] = (await scoped('brand_content_versions', 'order by created_at desc,version desc')).map(r => ({
    id: String(r.id), slotKey: String(r.slot_key), version: Number(r.version), title: String(r.title), attachmentId: String(r.attachment_id), mediaUrl: `/api/brand-workspace/attachments/${r.attachment_id}`,
    caption: String(r.caption), usageRights: String(r.usage_rights), reviewRevision: Number(r.review_revision), decision: 'pending', createdAt: stamp(r.created_at),
  }));
  const decisions: BrandDecision[] = (await scoped('brand_content_decisions', 'order by created_at,revision')).map(r => ({
    id: String(r.id), contentVersionId: String(r.content_version_id), decision: r.decision as BrandDecision['decision'],
    comment: String(r.comment), revision: Number(r.revision), createdAt: stamp(r.created_at),
  }));
  for (const decision of decisions) { const content = contents.find(c => c.id === decision.contentVersionId); if (content) content.decision = decision.decision; }
  const messages: BrandMessage[] = (await scoped('brand_messages', 'order by created_at,id')).map(r => ({ id: String(r.id), body: String(r.body), authorRole: r.author_role as BrandMessage['authorRole'], createdAt: stamp(r.created_at) }));
  const attachments: BrandAttachment[] = (await scoped('brand_attachments', "and status='ready' and access_scope='workspace' order by created_at")).map(r => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), sizeBytes: Number(r.size_bytes), createdAt: stamp(r.created_at) }));
  const posts = (await scoped('brand_posts', 'order by created_at')).map(postDto);
  const reports: BrandReport[] = (await scoped('brand_reports', 'order by version desc')).map(r => {
    const source = r.snapshot as BrandReportSnapshot;
    // Rebuild even stored snapshots explicitly; extra JSON properties never reach consumers.
    const snapshot: BrandReportSnapshot = { totalPosts: source.totalPosts, measuredPosts: source.measuredPosts, viewsTotal: source.viewsTotal,
      metricDefinition: 'sum_of_latest_post_views', posts: source.posts.map(p => ({ id: p.id, contentVersionId: p.contentVersionId, url: p.url, platform: p.platform,
        publishedAt: p.publishedAt, metricRevision: p.metricRevision, verification: p.verification, metricsSource: p.metricsSource, measuredAt: p.measuredAt, views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, createdAt: p.createdAt })) };
    return { id: String(r.id), version: Number(r.version), summary: String(r.summary), periodStart: day(r.period_start)!, periodEnd: day(r.period_end)!, snapshot, createdAt: stamp(r.created_at) };
  });
  const contracts = (await scoped('brand_contract_documents', row.member_role === 'studio' ? 'order by created_at desc,version desc' : 'and shared=true order by created_at desc,version desc')).map(r=>({
    id:String(r.id),documentKey:String(r.document_key),title:String(r.title),version:Number(r.version),attachmentId:String(r.attachment_id),shared:Boolean(r.shared),revision:Number(r.revision),createdAt:stamp(r.created_at)
  }));
  const contractUploads = row.member_role === 'studio' ? (await scoped('brand_attachments', "and status='ready' and access_scope='contract' and id not in (select attachment_id from brand_contract_documents) order by created_at desc")).map(r=>({id:String(r.id),name:String(r.name),mime:String(r.mime),sizeBytes:Number(r.size_bytes),createdAt:stamp(r.created_at)})) : [];
  const references = z.array(z.object({ url: z.string(), note: z.string() })).parse(row.reference_links);
  return { ...summary(row), role: row.member_role as BrandProjectDetail['role'], referenceLinks: references, contracts, contractUploads, contents, decisions, messages, attachments, posts, reports };
}

export async function loadBrandWorkspace(deps: BrandWorkspaceDeps, viewer: Viewer, options: { includeAllContent?: boolean } = {}): Promise<BrandWorkspace> {
  if (!uuid(viewer.userId)) return { organizations: [], projects: [] };
  return deps.sql.transaction(async sql => {
    const memberships = (await sql.query(`select o.id,o.name,m.role from brand_organizations o join brand_memberships m on m.organization_id=o.id
      where m.user_id=$1 and m.status='active' order by o.created_at for share of m`, [viewer.userId])).rows;
    const projects = (await sql.query(`select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id
      where p.client_visible and (exists(select 1 from brand_memberships m where m.organization_id=p.organization_id and m.user_id=$1 and m.status='active') or exists(select 1 from brand_project_members m where m.project_id=p.id and m.user_id=$1 and m.status='active')) order by p.updated_at desc`, [viewer.userId])).rows;
    return { organizations: memberships.map(r => ({ id: String(r.id), name: String(r.name), role: r.role as BrandRole })), projects: await withHomeOverview(sql, projects.map(summary), options.includeAllContent ? Infinity : 4) };
  });
}
export async function loadStudioWorkspace(deps: BrandWorkspaceDeps, viewer: Viewer): Promise<BrandWorkspace> {
  if (!uuid(viewer.userId)) return { organizations: [], projects: [] };
  try { return await deps.sql.transaction(async sql => {
    await studio(sql, viewer.userId!);
    const rows = (await sql.query('select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id order by p.updated_at desc')).rows;
    const orgs=(await sql.query('select id,name from brand_organizations order by created_at desc')).rows;
    return { organizations: orgs.map(r=>({id:String(r.id),name:String(r.name),role:'owner' as const})), projects: await withHomeOverview(sql, rows.map(summary)) };
  }); } catch (error) { if (error instanceof Denied) return { organizations: [], projects: [] }; throw error; }
}
async function loadProject(deps: BrandWorkspaceDeps, viewer: Viewer, id: string, isStudio: boolean): Promise<BrandProjectDetail | null> {
  if (!uuid(viewer.userId) || !uuid(id)) return null;
  try { return await deps.sql.transaction(async sql => detail(sql, await project(sql, viewer.userId!, id, { studio: isStudio }))); }
  catch (error) { if (error instanceof Denied) return null; throw error; }
}
export const loadBrandProject = (deps: BrandWorkspaceDeps, viewer: Viewer, id: string) => loadProject(deps, viewer, id, false);
export const loadStudioProject = (deps: BrandWorkspaceDeps, viewer: Viewer, id: string) => loadProject(deps, viewer, id, true);

export async function createBrandOrganization(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandOrganizationSchema, input, async (sql, userId, v) => {
    await sql.query('select id from profiles where id=$1 for update', [userId]);
    const existing = (await sql.query<{ id: string }>('select id from brand_organizations where created_by=$1 and request_id=$2', [userId, v.requestId])).rows[0];
    if (existing) { await member(sql, userId, existing.id); return { id: existing.id }; }
    const count = (await sql.query<{ n: number }>('select count(*)::int as n from brand_organizations where created_by=$1', [userId])).rows[0]!.n;
    if (count >= 5) throw new Denied('rate_limited');
    const id = randomUUID();
    await sql.query('insert into brand_organizations(id,name,created_by,request_id) values($1,$2,$3,$4)', [id, v.name, userId, v.requestId]);
    await sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')", [id, userId]);
    return { id };
  });
}
async function createProject(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown, managed: boolean): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandProjectSchema, input, async (sql, userId, v) => {
    await sql.query('select id from brand_organizations where id=$1 for update', [v.organizationId]);
    if(managed) await studio(sql,userId); else await member(sql, userId, v.organizationId, true);
    const existing = (await sql.query<{ id: string }>('select id from brand_projects where organization_id=$1 and created_by=$2 and request_id=$3', [v.organizationId, userId, v.requestId])).rows[0];
    if (existing) return { id: existing.id };
    const count = (await sql.query<{ n: number }>("select count(*)::int as n from brand_projects where organization_id=$1 and created_at>now()-interval '1 day'", [v.organizationId])).rows[0]!.n;
    if (count >= 20) throw new Denied('rate_limited');
    const id = randomUUID();
    await sql.query(`insert into brand_projects(id,organization_id,title,objective,audience,budget_krw,budget_tax_basis,starts_on,ends_on,production_mode,reference_links,created_by,request_id,criteria)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb)`, [id, v.organizationId, v.title, v.objective, v.audience, v.budgetKrw, v.budgetTaxBasis, v.startsOn, v.endsOn, v.productionMode, JSON.stringify(v.referenceLinks), userId, v.requestId, JSON.stringify(v.criteria)]);
    if(managed) await sql.query('update brand_projects set client_visible=false where id=$1',[id]);
    else await event(sql, { id, organization_id: v.organizationId }, 'project_requested', id);
    return { id };
  });
}
export const createBrandProject=(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown)=>createProject(deps,viewer,input,false);
export const createStudioProject=(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown)=>createProject(deps,viewer,input,true);
export async function activateBrandProject(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandProjectStatusSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    if (Number(p.revision) !== v.expectedRevision) throw new Denied('conflict');
    const valid = (p.status === 'requested' && ['active', 'cancelled'].includes(v.status)) || (p.status === 'active' && ['completed', 'cancelled'].includes(v.status));
    if (!valid) throw new Denied('conflict');
    await sql.query('update brand_projects set status=$1,revision=revision+1,updated_at=now() where id=$2', [v.status, p.id]);
    await event(sql, p, 'project_status_changed', randomUUID()); return { id: String(p.id) };
  });
}
export async function addBrandContentVersion(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandContentSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    const old = await retry(sql, 'brand_content_versions', v.projectId, userId, v.requestId); if (old) return { id: old };
    if (p.status !== 'active') throw new Denied('not_active');
    if (p.production_mode === 'studio' && !v.creatorConsentConfirmed) throw new Denied('consent_required');
    const attachment = (await sql.query("select id,sha256 from brand_attachments where project_id=$1 and id=$2 and status='ready' and access_scope='workspace'", [p.id, v.attachmentId])).rows[0];
    if (!attachment) throw new Denied('invalid');
    const version = Number((await sql.query<{ n: number }>('select coalesce(max(version),0)+1 as n from brand_content_versions where project_id=$1 and slot_key=$2', [p.id, v.slotKey])).rows[0]!.n);
    const id = randomUUID();
    await sql.query(`insert into brand_content_versions(id,organization_id,project_id,slot_key,version,title,attachment_id,caption,usage_rights,creator_consent_confirmed,created_by,request_id,asset_sha256)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, p.organization_id, p.id, v.slotKey, version, v.title, v.attachmentId, v.caption, v.usageRights, v.creatorConsentConfirmed, userId, v.requestId, attachment.sha256]);
    return { id };
  });
}
export async function approveBrandContent(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandDecisionSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { write: true });
    const old = await retry(sql, 'brand_content_decisions', v.projectId, userId, v.requestId); if (old) return { id: old };
    if (p.status !== 'active') throw new Denied('not_active');
    const c = (await sql.query('select * from brand_content_versions where project_id=$1 and id=$2 for update', [p.id, v.contentVersionId])).rows[0];
    if (!c) throw new Denied('not_found');
    const newer = (await sql.query('select id from brand_content_versions where project_id=$1 and slot_key=$2 and version>$3', [p.id, c.slot_key, c.version])).rows.length > 0;
    if (newer || Number(c.review_revision) !== v.expectedRevision) throw new Denied('conflict');
    await sql.query('update brand_content_versions set review_revision=review_revision+1 where id=$1', [c.id]);
    const id = randomUUID();
    await sql.query(`insert into brand_content_decisions(id,organization_id,project_id,content_version_id,decision,comment,revision,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, p.organization_id, p.id, c.id, v.decision, v.comment, v.expectedRevision + 1, userId, v.requestId]);
    await event(sql, p, 'content_decided', id); return { id };
  });
}
export async function sendBrandMessage(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandMessageSchema, input, async (sql, userId, v) => {
    const isStudio = (await profile(sql, userId)).is_admin === true;
    const p = await project(sql, userId, v.projectId, { studio: isStudio, write: true });
    const old = await retry(sql, 'brand_messages', v.projectId, userId, v.requestId); if (old) return { id: old };
    const recent = (await sql.query<{ n: number }>("select count(*)::int as n from brand_messages where created_by=$1 and created_at>now()-interval '1 minute'", [userId])).rows[0]!.n;
    if (recent >= 10) throw new Denied('rate_limited');
    const id = randomUUID();
    await sql.query('insert into brand_messages(id,organization_id,project_id,body,author_role,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7)', [id, p.organization_id, p.id, v.body, isStudio ? 'studio' : 'brand', userId, v.requestId]);
    if (!isStudio) await event(sql, p, 'message_received', id); return { id };
  });
}
export async function recordBrandPost(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandPostSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    const old = await retry(sql, 'brand_posts', v.projectId, userId, v.requestId); if (old) return { id: old };
    if (p.status !== 'active') throw new Denied('not_active');
    const normalized = normalizeBrandPostUrl(v.url); if (!normalized) throw new Denied('invalid');
    if (v.measuredAt && +new Date(v.measuredAt) > Date.now() + 300000) throw new Denied('invalid');
    const c = (await sql.query(`select c.id from brand_content_versions c join brand_content_decisions d on d.content_version_id=c.id and d.revision=c.review_revision
      where c.project_id=$1 and c.id=$2 and d.decision='approved'
      and not exists(select 1 from brand_content_versions newer where newer.project_id=c.project_id and newer.slot_key=c.slot_key and newer.version>c.version)`, [p.id, v.contentVersionId])).rows[0];
    if (!c) throw new Denied('not_approved');
    const id = randomUUID();
    await sql.query(`insert into brand_posts(id,organization_id,project_id,content_version_id,url,platform,verification,metrics_source,measured_at,views,likes,comments,shares,saves,created_by,request_id,platform_post_id,published_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [id, p.organization_id, p.id, c.id, normalized.url, normalized.platform, v.verification, v.metricsSource, v.measuredAt, v.views, v.likes, v.comments, v.shares, v.saves, userId, v.requestId, normalized.postId, v.publishedAt]);
    return { id };
  });
}
export async function publishBrandReport(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandReportSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    const old = await retry(sql, 'brand_reports', v.projectId, userId, v.requestId); if (old) return { id: old };
    if (!['active', 'completed'].includes(String(p.status))) throw new Denied('not_active');
    // Inclusive Korean calendar dates; metrics remain the latest known observation for each selected post.
    const posts = (await sql.query(`select * from brand_posts where organization_id=$1 and project_id=$2
      and published_at >= ($3::date::timestamp at time zone 'Asia/Seoul')
      and published_at < (($4::date+1)::timestamp at time zone 'Asia/Seoul') order by published_at`, [p.organization_id, p.id, v.periodStart, v.periodEnd])).rows.map(postDto);
    const measured = posts.filter(post => post.views !== null);
    const snapshot: BrandReportSnapshot = { totalPosts: posts.length, measuredPosts: measured.length, viewsTotal: measured.length ? measured.reduce((sum, p) => sum + p.views!, 0) : null, metricDefinition: 'sum_of_latest_post_views', posts };
    const version = Number((await sql.query<{ n: number }>('select coalesce(max(version),0)+1 as n from brand_reports where project_id=$1', [p.id])).rows[0]!.n);
    const id = randomUUID();
    await sql.query('insert into brand_reports(id,organization_id,project_id,version,summary,period_start,period_end,snapshot,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)', [id, p.organization_id, p.id, version, v.summary, v.periodStart, v.periodEnd, JSON.stringify(snapshot), userId, v.requestId]);
    await event(sql, p, 'report_published', id); return { id };
  });
}

export async function updateBrandPostMetrics(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandPostMetricsSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    const old = (await sql.query<{ id: string; post_id: string }>('select id,post_id from brand_post_measurements where project_id=$1 and created_by=$2 and request_id=$3', [p.id, userId, v.requestId])).rows[0];
    if (old) { if (old.post_id !== v.postId) throw new Denied('conflict'); return { id: old.id }; }
    if (!['active', 'completed'].includes(String(p.status))) throw new Denied('not_active');
    const post = (await sql.query('select * from brand_posts where project_id=$1 and id=$2 for update', [p.id, v.postId])).rows[0];
    if (!post) throw new Denied('not_found');
    if (Number(post.metric_revision) !== v.expectedRevision) throw new Denied('conflict');
    if (v.measuredAt && +new Date(v.measuredAt) > Date.now() + 300000) throw new Denied('invalid');
    const id = randomUUID(), revision = v.expectedRevision + 1;
    await sql.query(`insert into brand_post_measurements(id,organization_id,project_id,post_id,revision,verification,metrics_source,measured_at,views,likes,comments,shares,saves,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, p.organization_id, p.id, post.id, revision, v.verification, v.metricsSource, v.measuredAt, v.views, v.likes, v.comments, v.shares, v.saves, userId, v.requestId]);
    await sql.query(`update brand_posts set metric_revision=$1,verification=$2,metrics_source=$3,measured_at=$4,views=$5,likes=$6,comments=$7,shares=$8,saves=$9 where id=$10`,
      [revision, v.verification, v.metricsSource, v.measuredAt, v.views, v.likes, v.comments, v.shares, v.saves, post.id]);
    return { id };
  });
}

export async function reserveBrandAttachment(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; storageKey: string }>> {
  return mutation(deps, viewer, BrandAttachmentSchema, input, async (sql, userId, v) => {
    const isStudio = (await profile(sql, userId)).is_admin === true;
    const p = await project(sql, userId, v.projectId, { studio: isStudio, write: true });
    if(v.purpose === 'contract' && !isStudio) throw new Denied('forbidden');
    const old = (await sql.query<{ id: string; access_scope: string; storage_key: string; status: string; name: string; mime: string; size_bytes: number }>('select id,access_scope,storage_key,status,name,mime,size_bytes from brand_attachments where project_id=$1 and created_by=$2 and request_id=$3', [p.id, userId, v.requestId])).rows[0];
    if (old) {
      if (old.access_scope !== v.purpose || old.status !== 'pending' || old.name !== v.name || old.mime !== v.mime || Number(old.size_bytes) !== v.sizeBytes) throw new Denied('conflict');
      return { id: old.id, storageKey: old.storage_key };
    }
    const count = (await sql.query<{ n: number }>('select count(*)::int as n from brand_attachments where project_id=$1', [p.id])).rows[0]!.n;
    if (count >= 100) throw new Denied('rate_limited');
    const id = randomUUID(), storageKey = `brands/${p.organization_id}/${p.id}/${id}`;
    await sql.query('insert into brand_attachments(id,organization_id,project_id,name,mime,size_bytes,storage_key,created_by,request_id,access_scope) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, p.organization_id, p.id, v.name, v.mime, v.sizeBytes, storageKey, userId, v.requestId,v.purpose]);
    return { id, storageKey };
  });
}
export interface BrandAttachmentAccess { contract?:boolean; key: string; name: string; mime: string; sizeBytes: number }
async function attachmentRow(sql: SqlRunner, userId: string, id: string, upload = false): Promise<Row> {
  const row = (await sql.query('select * from brand_attachments where id=$1', [id])).rows[0];
  if (!row) throw new Denied('not_found');
  const isStudio = (await profile(sql, userId)).is_admin === true;
  await project(sql, userId, String(row.project_id), { studio: isStudio, write: upload });
  if(!isStudio && row.access_scope==='contract' && !(await sql.query('select id from brand_contract_documents where attachment_id=$1 and project_id=$2 and shared=true',[id,row.project_id])).rows[0]) throw new Denied('not_found');
  if (upload ? row.created_by !== userId || row.status !== 'pending' : row.status !== 'ready') throw new Denied('not_found');
  return row;
}
async function attachmentAccess(deps: BrandWorkspaceDeps, viewer: Viewer, id: string, upload: boolean): Promise<BrandAttachmentAccess | null> {
  if (!uuid(viewer.userId) || !uuid(id)) return null;
  try { return await deps.sql.transaction(async sql => { const r = await attachmentRow(sql, viewer.userId!, id, upload); return { contract:r.access_scope==='contract', key: String(r.storage_key), name: String(r.name), mime: String(r.mime), sizeBytes: Number(r.size_bytes) }; }); }
  catch (error) { if (error instanceof Denied) return null; throw error; }
}
export const loadBrandAttachmentAccess = (deps: BrandWorkspaceDeps, viewer: Viewer, id: string) => attachmentAccess(deps, viewer, id, false);
export const loadBrandAttachmentUploadAccess = (deps: BrandWorkspaceDeps, viewer: Viewer, id: string) => attachmentAccess(deps, viewer, id, true);
function actualMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (b.subarray(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return 'video/webm';
  return null;
}
export async function completeBrandAttachment(deps: BrandWorkspaceDeps, viewer: Viewer, id: string): Promise<BrandOutcome> {
  return mutation(deps, viewer, z.string().uuid(), id, async (sql, userId, attachmentId) => {
    if (!deps.storage) throw new Denied('storage_unavailable');
    const existing = (await sql.query('select * from brand_attachments where id=$1', [attachmentId])).rows[0];
    if (!existing) throw new Denied('not_found');
    const isStudio = (await profile(sql, userId)).is_admin === true;
    await project(sql, userId, String(existing.project_id), { studio: isStudio, write: true });
    if (existing.created_by !== userId) throw new Denied('forbidden');
    if (existing.status === 'ready') return { id: attachmentId };
    const bytes = await deps.storage.read(STAGING_BUCKET, String(existing.storage_key));
    const mime = actualMime(bytes), expected = existing.mime as keyof typeof BRAND_ATTACHMENT_LIMITS;
    if (mime !== expected || bytes.byteLength !== Number(existing.size_bytes) || bytes.byteLength > BRAND_ATTACHMENT_LIMITS[expected]) throw new Denied('invalid');
    await sql.query("update brand_attachments set status='ready',sha256=$1 where id=$2", [createHash('sha256').update(bytes).digest('hex'), attachmentId]);
    return { id: attachmentId };
  });
}

export async function loadBrandMembers(deps: BrandWorkspaceDeps, viewer: Viewer, organizationId: string): Promise<BrandMembers | null> {
  if (!uuid(viewer.userId) || !uuid(organizationId)) return null;
  try { return await deps.sql.transaction(async sql => {
    if (await member(sql, viewer.userId!, organizationId) !== 'owner') throw new Denied('forbidden');
    const org = (await sql.query('select id,name from brand_organizations where id=$1', [organizationId])).rows[0]!;
    const members = (await sql.query(`select m.id,m.user_id,m.role,m.status,p.email from brand_memberships m
      join profiles p on p.id=m.user_id where m.organization_id=$1 order by m.created_at`, [organizationId])).rows;
    const invitations = (await sql.query('select id,email,role,expires_at,accepted_at,revoked_at from brand_invites where organization_id=$1 order by created_at desc', [organizationId])).rows;
    return { organization: { id: String(org.id), name: String(org.name) }, members: members.map(m => ({
      id: String(m.id), userId: String(m.user_id), email: m.role !== 'owner' || m.user_id === viewer.userId ? String(m.email) : null,
      role: m.role as BrandRole, status: m.status as 'active' | 'revoked', isSelf: m.user_id === viewer.userId,
    })), invitations: invitations.map(i => ({ id: String(i.id), email: String(i.email), role: i.role as 'editor' | 'viewer', expiresAt: stamp(i.expires_at),
      status: i.revoked_at ? 'revoked' as const : i.accepted_at ? 'accepted' as const : +new Date(stamp(i.expires_at)) <= Date.now() ? 'expired' as const : 'pending' as const })) };
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}
export async function createBrandInvitation(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; token: string }>> {
  return mutation(deps, viewer, BrandInvitationSchema, input, async (sql, userId, v) => {
    await sql.query('select id from brand_organizations where id=$1 for update', [v.organizationId]);
    if (await member(sql, userId, v.organizationId) !== 'owner') throw new Denied('forbidden');
    const duplicate = (await sql.query('select id from brand_invites where organization_id=$1 and created_by=$2 and request_id=$3', [v.organizationId, userId, v.requestId])).rows[0];
    // A token is shown only once and never stored recoverably. A lost response needs a fresh invite.
    if (duplicate) throw new Denied('conflict');
    const existingMember = (await sql.query(`select m.id from brand_memberships m join profiles p on p.id=m.user_id
      where m.organization_id=$1 and m.status='active' and lower(p.email)=$2`, [v.organizationId, v.email])).rows[0];
    if (existingMember) throw new Denied('conflict');
    const count = (await sql.query<{ n: number }>("select count(*)::int as n from brand_invites where organization_id=$1 and created_at>now()-interval '1 day'", [v.organizationId])).rows[0]!.n;
    if (count >= 20) throw new Denied('rate_limited');
    await sql.query('update brand_invites set revoked_at=now() where organization_id=$1 and email=$2 and accepted_at is null and revoked_at is null', [v.organizationId, v.email]);
    const token = randomBytes(32).toString('base64url'), id = randomUUID();
    await sql.query(`insert into brand_invites(id,organization_id,email,role,token_hash,expires_at,created_by,request_id)
      values($1,$2,$3,$4,$5,now()+interval '7 days',$6,$7)`, [id, v.organizationId, v.email, v.role, createHash('sha256').update(token).digest('hex'), userId, v.requestId]);
    return { id, token };
  });
}
export async function acceptBrandInvitation(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ organizationId: string; projectId?: string }>> {
  return mutation(deps, viewer, BrandInvitationAcceptSchema, input, async (sql, userId, v) => {
    const row = (await sql.query(`select * from brand_invites where token_hash=$1`, [createHash('sha256').update(v.token).digest('hex')])).rows[0];
    if (!row) throw new Denied('not_found');
    // Same lock order as issue/revoke so another owner cannot revoke while acceptance commits.
    await sql.query('select id from brand_organizations where id=$1 for update', [row.organization_id]);
    const invite = (await sql.query('select * from brand_invites where id=$1 for update', [row.id])).rows[0]!;
    if (invite.revoked_at || +new Date(stamp(invite.expires_at)) <= Date.now()) throw new Denied('not_found');
    const confirmed = deps.verifiedEmail?.trim().toLowerCase();
    const stored = String((await profile(sql, userId)).email).trim().toLowerCase();
    if (!confirmed || confirmed !== stored || confirmed !== invite.email) throw new Denied('forbidden');
    if (invite.accepted_at) {
      if (invite.accepted_by !== userId) throw new Denied('not_found');
      // A response-lost retry confirms existing access; it never reactivates a revoked member.
      if(invite.project_id) { if(!(await sql.query("select user_id from brand_project_members where project_id=$1 and user_id=$2 and status='active'",[invite.project_id,userId])).rows[0]) throw new Denied('not_found'); }
      else await member(sql, userId, String(invite.organization_id));
      return { organizationId: String(invite.organization_id), ...(invite.project_id?{projectId:String(invite.project_id)}:{}) };
    }
    // Revoking the inviting owner's role also invalidates their still-outstanding invitations.
    if(invite.issued_by_studio) await studio(sql,String(invite.created_by));
    else if (await member(sql, String(invite.created_by), String(invite.organization_id)) !== 'owner') throw new Denied('not_found');
    if(invite.project_id) {
      await sql.query("insert into brand_project_members(organization_id,project_id,user_id) values($1,$2,$3) on conflict(project_id,user_id) do update set status='active'",[invite.organization_id,invite.project_id,userId]);
      await sql.query('update brand_invites set accepted_at=now(),accepted_by=$1 where id=$2',[userId,invite.id]);
      return {organizationId:String(invite.organization_id),projectId:String(invite.project_id)};
    }
    const current = (await sql.query('select role,status from brand_memberships where organization_id=$1 and user_id=$2 for update', [invite.organization_id, userId])).rows[0];
    if (current?.status === 'active') throw new Denied('conflict');
    await sql.query(`insert into brand_memberships(organization_id,user_id,role) values($1,$2,$3)
      on conflict(organization_id,user_id) do update set role=excluded.role,status='active'`, [invite.organization_id, userId, invite.role]);
    await sql.query('update brand_invites set accepted_at=now(),accepted_by=$1 where id=$2', [userId, invite.id]);
    return { organizationId: String(invite.organization_id) };
  });
}
export async function revokeBrandMember(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandMemberRevokeSchema, input, async (sql, userId, v) => {
    await sql.query('select id from brand_organizations where id=$1 for update', [v.organizationId]);
    if (await member(sql, userId, v.organizationId) !== 'owner') throw new Denied('forbidden');
    const target = (await sql.query('select id,role from brand_memberships where organization_id=$1 and user_id=$2 and status=\'active\' for update', [v.organizationId, v.userId])).rows[0];
    if (!target) throw new Denied('not_found');
    if (target.role === 'owner') {
      const owners = (await sql.query<{ n: number }>("select count(*)::int as n from brand_memberships where organization_id=$1 and role='owner' and status='active'", [v.organizationId])).rows[0]!.n;
      if (owners <= 1) throw new Denied('forbidden');
    }
    await sql.query("update brand_memberships set status='revoked' where organization_id=$1 and user_id=$2", [v.organizationId, v.userId]);
    return { id: String(target.id) };
  });
}
export const createBrandInvite = createBrandInvitation;
export const acceptBrandInvite = acceptBrandInvitation;

/** Studio creates the organization, never a fabricated client profile or membership. */
export async function createStudioOrganization(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,BrandOrganizationSchema,input,async(sql,userId,v)=>{
  await studio(sql,userId);
  const old=(await sql.query('select id from brand_organizations where created_by=$1 and request_id=$2',[userId,v.requestId])).rows[0];
  if(old)return {id:String(old.id)};
  const id=randomUUID();
  await sql.query('insert into brand_organizations(id,name,created_by,request_id,studio_managed) values($1,$2,$3,$4,true)',[id,v.name,userId,v.requestId]);
  return {id};
 });
}
export async function setBrandProjectVisibility(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({projectId:z.uuid(),visible:z.boolean(),expectedRevision:z.number().int().nonnegative()}),input,async(sql,userId,v)=>{
  const p=await project(sql,userId,v.projectId,{studio:true,write:true});
  if(Number(p.revision)!==v.expectedRevision)throw new Denied('conflict');
  await sql.query('update brand_projects set client_visible=$1,revision=revision+1,updated_at=now() where id=$2',[v.visible,p.id]);
  return {id:String(p.id)};
 });
}
const StudioInvitationSchema=z.object({organizationId:z.uuid(),projectId:z.uuid().nullable().default(null),email:z.email().trim().toLowerCase().max(254),role:z.enum(['owner','editor','viewer']),requestId:z.uuid()}).refine(v=>!v.projectId||v.role==='viewer');
export async function createStudioInvitation(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome<{id:string;token:string}>> {
 return mutation(deps,viewer,StudioInvitationSchema,input,async(sql,userId,v)=>{
  await studio(sql,userId);
  const org=(await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId])).rows[0];
  if(!org)throw new Denied('not_found');
  if(v.projectId && (await project(sql,userId,v.projectId,{studio:true})).organization_id!==v.organizationId)throw new Denied('not_found');
  if((await sql.query('select id from brand_invites where organization_id=$1 and created_by=$2 and request_id=$3',[v.organizationId,userId,v.requestId])).rows[0])throw new Denied('conflict');
  const count=(await sql.query("select count(*)::int as n from brand_invites where organization_id=$1 and created_at>now()-interval '1 day'",[v.organizationId])).rows[0];
  if(Number(count?.n)>=20)throw new Denied('rate_limited');
  await sql.query('update brand_invites set revoked_at=now() where organization_id=$1 and email=$2 and project_id is not distinct from $3::uuid and accepted_at is null and revoked_at is null',[v.organizationId,v.email,v.projectId]);
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await sql.query("insert into brand_invites(id,organization_id,project_id,email,role,issued_by_studio,token_hash,expires_at,created_by,request_id) values($1,$2,$3,$4,$5,true,$6,now()+interval '7 days',$7,$8)",[id,v.organizationId,v.projectId,v.email,v.role,createHash('sha256').update(token).digest('hex'),userId,v.requestId]);
  return {id,token};
 });
}
export async function revokeStudioAccess(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({organizationId:z.uuid(),userId:z.uuid(),projectId:z.uuid().nullable().default(null)}),input,async(sql,userId,v)=>{
  await studio(sql,userId);
  await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId]);
  if(v.projectId)await sql.query("update brand_project_members set status='revoked' where organization_id=$1 and project_id=$2 and user_id=$3",[v.organizationId,v.projectId,v.userId]);
  else {
   await sql.query("update brand_memberships set status='revoked' where organization_id=$1 and user_id=$2",[v.organizationId,v.userId]);
   await sql.query("update brand_project_members set status='revoked' where organization_id=$1 and user_id=$2",[v.organizationId,v.userId]);
  }
  await sql.query('update brand_invites set revoked_at=now() where organization_id=$1 and (accepted_by=$2 or email=(select lower(email) from profiles where id=$2)) and ($3::uuid is null or project_id=$3)',[v.organizationId,v.userId,v.projectId]);
  return {id:v.userId};
 });
}
export async function addBrandContract(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({projectId:z.uuid(),attachmentId:z.uuid(),documentKey:z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),title:z.string().trim().min(1).max(160),requestId:z.uuid()}),input,async(sql,userId,v)=>{
  const p=await project(sql,userId,v.projectId,{studio:true,write:true});
  const old=await retry(sql,'brand_contract_documents',v.projectId,userId,v.requestId);if(old)return {id:old};
  const file=(await sql.query("select id from brand_attachments where project_id=$1 and id=$2 and status='ready' and access_scope='contract' and mime='application/pdf'",[p.id,v.attachmentId])).rows[0];
  if(!file)throw new Denied('invalid');
  const version=Number((await sql.query('select coalesce(max(version),0)+1 as n from brand_contract_documents where project_id=$1 and document_key=$2',[p.id,v.documentKey])).rows[0]?.n);
  const id=randomUUID();
  await sql.query('insert into brand_contract_documents(id,organization_id,project_id,document_key,title,version,attachment_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,p.organization_id,p.id,v.documentKey,v.title,version,file.id,userId,v.requestId]);
  return {id};
 });
}
export async function shareBrandContract(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({projectId:z.uuid(),contractId:z.uuid(),shared:z.boolean(),expectedRevision:z.number().int().nonnegative()}),input,async(sql,userId,v)=>{
  await project(sql,userId,v.projectId,{studio:true,write:true});
  const doc=(await sql.query('select * from brand_contract_documents where project_id=$1 and id=$2 for update',[v.projectId,v.contractId])).rows[0];
  if(!doc)throw new Denied('not_found');
  if(Number(doc.revision)!==v.expectedRevision)throw new Denied('conflict');
  await sql.query('update brand_contract_documents set shared=$1,revision=revision+1 where id=$2',[v.shared,doc.id]);
  await sql.query('insert into brand_contract_sharing_events(contract_id,shared,revision,created_by) values($1,$2,$3,$4)',[doc.id,v.shared,v.expectedRevision+1,userId]);
  return {id:String(doc.id)};
 });
}

export interface StudioBrandAccess {
 id:string;name:string;
 members:Array<{userId:string;email:string;role:string;projectId:string|null;projectTitle:string|null;status:string}>;
 invitations:Array<{id:string;email:string;role:string;projectId:string|null;projectTitle:string|null;state:'pending'|'accepted'|'revoked'|'expired';expiresAt:string}>;
}
export async function loadStudioBrandAccess(deps:BrandWorkspaceDeps,viewer:Viewer,organizationId:string):Promise<StudioBrandAccess|null> {
 if(!uuid(viewer.userId)||!uuid(organizationId))return null;
 try{return await deps.sql.transaction(async sql=>{
  await studio(sql,viewer.userId!);
  const org=(await sql.query('select id,name from brand_organizations where id=$1',[organizationId])).rows[0];if(!org)return null;
  const members=(await sql.query(`select m.user_id,p.email,m.role,m.status,null::uuid as project_id,null::text as project_title from brand_memberships m join profiles p on p.id=m.user_id where m.organization_id=$1
    union all select m.user_id,p.email,'viewer',m.status,m.project_id,c.title from brand_project_members m join profiles p on p.id=m.user_id join brand_projects c on c.id=m.project_id where m.organization_id=$1`,[organizationId])).rows;
  const invitations=(await sql.query('select i.id,i.email,i.role,i.project_id,c.title as project_title,i.accepted_at,i.revoked_at,i.expires_at from brand_invites i left join brand_projects c on c.id=i.project_id where i.organization_id=$1 order by i.created_at desc',[organizationId])).rows;
  return {id:String(org.id),name:String(org.name),members:members.map(m=>({userId:String(m.user_id),email:String(m.email),role:String(m.role),status:String(m.status),projectId:m.project_id?String(m.project_id):null,projectTitle:m.project_title?String(m.project_title):null})),
   invitations:invitations.map(i=>({id:String(i.id),email:String(i.email),role:String(i.role),projectId:i.project_id?String(i.project_id):null,projectTitle:i.project_title?String(i.project_title):null,expiresAt:stamp(i.expires_at),state:i.revoked_at?'revoked':i.accepted_at?'accepted':+new Date(stamp(i.expires_at))<=Date.now()?'expired':'pending'}))};
 });}catch(e){if(e instanceof Denied)return null;throw e}
}
export async function revokeStudioInvitation(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({organizationId:z.uuid(),invitationId:z.uuid()}),input,async(sql,userId,v)=>{
  await studio(sql,userId);await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId]);
  const r=(await sql.query('update brand_invites set revoked_at=now() where organization_id=$1 and id=$2 and accepted_at is null returning id',[v.organizationId,v.invitationId])).rows[0];
  if(!r)throw new Denied('not_found');return {id:String(r.id)};
 });
}

export interface BrandOrganizationSettings {id:string;name:string;website:string;description:string;contactEmail:string;revision:number;role:BrandRole|'studio'}
export async function loadBrandSettings(deps:BrandWorkspaceDeps,viewer:Viewer,id:string,isStudio=false):Promise<BrandOrganizationSettings|null> {
 if(!uuid(viewer.userId)||!uuid(id))return null;
 try{return await deps.sql.transaction(async sql=>{
  const role=isStudio?(await studio(sql,viewer.userId!),'studio' as const):await member(sql,viewer.userId!,id);
  const r=(await sql.query('select id,name,website,description,contact_email,profile_revision from brand_organizations where id=$1',[id])).rows[0];
  if(!r)return null;return {id:String(r.id),name:String(r.name),website:String(r.website),description:String(r.description),contactEmail:String(r.contact_email),revision:Number(r.profile_revision),role};
 });}catch(e){if(e instanceof Denied)return null;throw e}
}
export async function updateBrandSettings(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({organizationId:z.uuid(),name:z.string().trim().min(2).max(100),website:z.union([z.literal(''),BrandHttpsUrlSchema]),description:z.string().trim().max(2000),contactEmail:z.union([z.literal(''),z.email().max(254)]),expectedRevision:z.number().int().nonnegative()}),input,async(sql,userId,v)=>{
  const isStudio=(await profile(sql,userId)).is_admin===true;
  if(!isStudio && await member(sql,userId,v.organizationId)!=='owner')throw new Denied('forbidden');
  const r=(await sql.query('update brand_organizations set name=$1,website=$2,description=$3,contact_email=$4,profile_revision=profile_revision+1 where id=$5 and profile_revision=$6 returning id',[v.name,v.website,v.description,v.contactEmail,v.organizationId,v.expectedRevision])).rows[0];
  if(!r)throw new Denied('conflict');return {id:String(r.id)};
 });
}
export async function loadBrandSupport(deps:BrandWorkspaceDeps,viewer:Viewer,id:string,isStudio=false):Promise<BrandMessage[]|null> {
 if(!uuid(viewer.userId)||!uuid(id))return null;
 try{return await deps.sql.transaction(async sql=>{
  if(isStudio)await studio(sql,viewer.userId!);else await member(sql,viewer.userId!,id);
  return (await sql.query('select id,body,author_role,created_at from brand_support_messages where organization_id=$1 order by created_at,id',[id])).rows.map(r=>({id:String(r.id),body:String(r.body),authorRole:r.author_role as BrandMessage['authorRole'],createdAt:stamp(r.created_at)}));
 });}catch(e){if(e instanceof Denied)return null;throw e}
}
export async function sendBrandSupport(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({organizationId:z.uuid(),body:z.string().trim().min(1).max(4000),requestId:z.uuid()}),input,async(sql,userId,v)=>{
  const isStudio=(await profile(sql,userId)).is_admin===true;
  if(!isStudio)await member(sql,userId,v.organizationId,true);
  const org=(await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId])).rows[0];if(!org)throw new Denied('not_found');
  const old=(await sql.query('select id from brand_support_messages where organization_id=$1 and created_by=$2 and request_id=$3',[v.organizationId,userId,v.requestId])).rows[0];if(old)return{id:String(old.id)};
  const count=(await sql.query("select count(*)::int as n from brand_support_messages where created_by=$1 and created_at>now()-interval '1 hour'",[userId])).rows[0];if(Number(count?.n)>=30)throw new Denied('rate_limited');
  const id=randomUUID();await sql.query('insert into brand_support_messages(id,organization_id,body,author_role,created_by,request_id) values($1,$2,$3,$4,$5,$6)',[id,v.organizationId,v.body,isStudio?'studio':'brand',userId,v.requestId]);return{id};
 });
}
