import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STAGING_BUCKET, type StorageDriver } from '@/lib/storage';
import {
  BrandOrganizationSchema, BrandProjectSchema, BrandProjectStatusSchema, BrandContentSchema,
  BrandDecisionSchema, BrandMessageSchema, BrandPostSchema, BrandReportSchema, BrandAttachmentSchema,
  BRAND_ATTACHMENT_LIMITS, normalizeBrandPostUrl,
  BrandInvitationSchema, BrandInvitationAcceptSchema, BrandMemberRevokeSchema,
  BrandCriteriaSchema,
  BrandPostMetricsSchema, BrandPostMetricsBatchSchema,
} from './schemas';
import type {
  BrandOutcome, BrandFailureCode, BrandRole, BrandProjectSummary, BrandProjectDetail, BrandWorkspace,
  BrandContentVersion, BrandDecision, BrandMessage, BrandAttachment, BrandPost, BrandReport, BrandReportSnapshot,
  BrandMembers, BrandMetricsBatchResult,
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
  row.member_role = options.studio ? 'studio' : await member(sql, userId, String(row.organization_id), options.write);
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
    id: String(row.id), organizationId: String(row.organization_id), organizationName: String(row.organization_name),
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
  const attachments: BrandAttachment[] = (await scoped('brand_attachments', "and status='ready' order by created_at")).map(r => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), sizeBytes: Number(r.size_bytes), createdAt: stamp(r.created_at) }));
  const posts = (await scoped('brand_posts', 'order by created_at')).map(postDto);
  const reports: BrandReport[] = (await scoped('brand_reports', 'order by version desc')).map(r => {
    const source = r.snapshot as BrandReportSnapshot;
    // Rebuild even stored snapshots explicitly; extra JSON properties never reach consumers.
    const snapshot: BrandReportSnapshot = { totalPosts: source.totalPosts, measuredPosts: source.measuredPosts, viewsTotal: source.viewsTotal,
      metricDefinition: 'sum_of_latest_post_views', posts: source.posts.map(p => ({ id: p.id, contentVersionId: p.contentVersionId, url: p.url, platform: p.platform,
        publishedAt: p.publishedAt, metricRevision: p.metricRevision, verification: p.verification, metricsSource: p.metricsSource, measuredAt: p.measuredAt, views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, createdAt: p.createdAt })) };
    return { id: String(r.id), version: Number(r.version), summary: String(r.summary), periodStart: day(r.period_start)!, periodEnd: day(r.period_end)!, snapshot, createdAt: stamp(r.created_at) };
  });
  const references = z.array(z.object({ url: z.string(), note: z.string() })).parse(row.reference_links);
  return { ...summary(row), role: row.member_role as BrandProjectDetail['role'], referenceLinks: references, contents, decisions, messages, attachments, posts, reports };
}

export async function loadBrandWorkspace(deps: BrandWorkspaceDeps, viewer: Viewer): Promise<BrandWorkspace> {
  if (!uuid(viewer.userId)) return { organizations: [], projects: [] };
  return deps.sql.transaction(async sql => {
    const memberships = (await sql.query(`select o.id,o.name,m.role from brand_organizations o join brand_memberships m on m.organization_id=o.id
      where m.user_id=$1 and m.status='active' order by o.created_at for share of m`, [viewer.userId])).rows;
    const projects = (await sql.query(`select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id
      join brand_memberships m on m.organization_id=p.organization_id where m.user_id=$1 and m.status='active' order by p.updated_at desc`, [viewer.userId])).rows;
    return { organizations: memberships.map(r => ({ id: String(r.id), name: String(r.name), role: r.role as BrandRole })), projects: projects.map(summary) };
  });
}
export async function loadStudioWorkspace(deps: BrandWorkspaceDeps, viewer: Viewer): Promise<BrandWorkspace> {
  if (!uuid(viewer.userId)) return { organizations: [], projects: [] };
  try { return await deps.sql.transaction(async sql => {
    await studio(sql, viewer.userId!);
    const rows = (await sql.query('select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id order by p.updated_at desc')).rows;
    return { organizations: [], projects: rows.map(summary) };
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
export async function createBrandProject(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandProjectSchema, input, async (sql, userId, v) => {
    await sql.query('select id from brand_organizations where id=$1 for update', [v.organizationId]);
    await member(sql, userId, v.organizationId, true);
    const existing = (await sql.query<{ id: string }>('select id from brand_projects where organization_id=$1 and created_by=$2 and request_id=$3', [v.organizationId, userId, v.requestId])).rows[0];
    if (existing) return { id: existing.id };
    const count = (await sql.query<{ n: number }>("select count(*)::int as n from brand_projects where organization_id=$1 and created_at>now()-interval '1 day'", [v.organizationId])).rows[0]!.n;
    if (count >= 20) throw new Denied('rate_limited');
    const id = randomUUID();
    await sql.query(`insert into brand_projects(id,organization_id,title,objective,audience,budget_krw,budget_tax_basis,starts_on,ends_on,production_mode,reference_links,created_by,request_id,criteria)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb)`, [id, v.organizationId, v.title, v.objective, v.audience, v.budgetKrw, v.budgetTaxBasis, v.startsOn, v.endsOn, v.productionMode, JSON.stringify(v.referenceLinks), userId, v.requestId, JSON.stringify(v.criteria)]);
    await event(sql, { id, organization_id: v.organizationId }, 'project_requested', id);
    return { id };
  });
}
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
    const attachment = (await sql.query("select id,sha256 from brand_attachments where project_id=$1 and id=$2 and status='ready'", [p.id, v.attachmentId])).rows[0];
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
type Observation = { verification: string; metricsSource: string; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null };
/** Append one immutable observation. History is only ever inserted, by these three call sites. */
async function observe(sql: SqlRunner, p: Row, postId: string, revision: number, o: Observation, measuredAt: string | null, userId: string, requestId: string, batchId: string | null): Promise<string> {
  const id = randomUUID();
  await sql.query(`insert into brand_post_measurements(id,organization_id,project_id,post_id,revision,verification,metrics_source,measured_at,views,likes,comments,shares,saves,created_by,request_id,batch_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [id, p.organization_id, p.id, postId, revision, o.verification, o.metricsSource, measuredAt, o.views, o.likes, o.comments, o.shares, o.saves, userId, requestId, batchId]);
  return id;
}
/** brand_posts is the latest projection of that history, written in the same transaction. */
async function projectLatest(sql: SqlRunner, postId: string, revision: number, o: Observation, measuredAt: string | null): Promise<void> {
  await sql.query('update brand_posts set metric_revision=$1,verification=$2,metrics_source=$3,measured_at=$4,views=$5,likes=$6,comments=$7,shares=$8,saves=$9 where id=$10',
    [revision, o.verification, o.metricsSource, measuredAt, o.views, o.likes, o.comments, o.shares, o.saves, postId]);
}
/**
 * The latest projection only moves forward. An observation older than the latest known one is
 * refused, and a known observation is never replaced by "unavailable". The SAME instant is accepted
 * as a correction of that observation: both revisions stay in history. Counts may go down.
 */
function admissible(post: Row, measuredAt: string | null): void {
  if (post.measured_at == null) return;
  if (measuredAt === null || +new Date(measuredAt) < +new Date(stamp(post.measured_at))) throw new Denied('invalid');
}
/** Deterministic per-row request id, so a retried batch can never write a second history row. */
function rowRequestId(batchRequestId: string, postId: string): string {
  const h = createHash('sha256').update(`${batchRequestId}:${postId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
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
    // The values entered with the post are its first real observation: history revision 0, same transaction.
    if (v.metricsSource !== 'unavailable') await observe(sql, p, id, 0, v, v.measuredAt, userId, v.requestId, null);
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
    // Collection stops when the studio closes the campaign. `project(..., write)` holds the same row
    // lock `activateBrandProject` takes, so a save can never commit after the close.
    if (p.status !== 'active') throw new Denied('not_active');
    const post = (await sql.query('select * from brand_posts where project_id=$1 and id=$2 for update', [p.id, v.postId])).rows[0];
    if (!post) throw new Denied('not_found');
    if (Number(post.metric_revision) !== v.expectedRevision) throw new Denied('conflict');
    if (v.measuredAt && +new Date(v.measuredAt) > Date.now() + 300000) throw new Denied('invalid');
    admissible(post, v.measuredAt);
    const id = await observe(sql, p, String(post.id), v.expectedRevision + 1, v, v.measuredAt, userId, v.requestId, null);
    await projectLatest(sql, String(post.id), v.expectedRevision + 1, v, v.measuredAt);
    return { id };
  });
}

/**
 * The studio console: every explicitly selected row is saved in ONE transaction under ONE
 * server-side measurement time. Any stale, missing or foreign row rolls the whole save back.
 * No provider is called; the values are what an administrator read and typed just now.
 */
export async function saveBrandPostMetricsBatch(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<BrandMetricsBatchResult>> {
  return mutation(deps, viewer, BrandPostMetricsBatchSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    const rows = [...v.rows].sort((x, y) => x.postId.localeCompare(y.postId));
    const digest = createHash('sha256').update(JSON.stringify([p.id, rows.map(r => [r.postId, r.expectedRevision, r.verification, r.metricsSource, r.views, r.likes, r.comments, r.shares, r.saves])])).digest('hex');
    const old = (await sql.query('select id,payload_sha256,row_count,measured_at from brand_post_collection_batches where project_id=$1 and created_by=$2 and request_id=$3', [p.id, userId, v.requestId])).rows[0];
    if (old) {
      if (old.payload_sha256 !== digest) throw new Denied('conflict');
      return { id: String(old.id), saved: Number(old.row_count), measuredAt: stamp(old.measured_at) };
    }
    if (p.status !== 'active') throw new Denied('not_active');
    // Locked in id order so two overlapping saves queue instead of deadlocking.
    const posts = (await sql.query('select * from brand_posts where project_id=$1 and id=any($2::uuid[]) order by id for update', [p.id, rows.map(r => r.postId)])).rows;
    if (posts.length !== rows.length) throw new Denied('not_found');
    const measuredAt = new Date().toISOString(), id = randomUUID();
    for (const r of rows) {
      const post = posts.find(candidate => candidate.id === r.postId)!;
      if (Number(post.metric_revision) !== r.expectedRevision) throw new Denied('conflict');
      admissible(post, measuredAt);
    }
    await sql.query('insert into brand_post_collection_batches(id,organization_id,project_id,request_id,payload_sha256,row_count,measured_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, p.organization_id, p.id, v.requestId, digest, rows.length, measuredAt, userId]);
    for (const r of rows) {
      await observe(sql, p, r.postId, r.expectedRevision + 1, r, measuredAt, userId, rowRequestId(v.requestId, r.postId), id);
      await projectLatest(sql, r.postId, r.expectedRevision + 1, r, measuredAt);
    }
    return { id, saved: rows.length, measuredAt };
  });
}

export async function reserveBrandAttachment(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; storageKey: string }>> {
  return mutation(deps, viewer, BrandAttachmentSchema, input, async (sql, userId, v) => {
    const isStudio = (await profile(sql, userId)).is_admin === true;
    const p = await project(sql, userId, v.projectId, { studio: isStudio, write: true });
    const old = (await sql.query<{ id: string; storage_key: string; status: string; name: string; mime: string; size_bytes: number }>('select id,storage_key,status,name,mime,size_bytes from brand_attachments where project_id=$1 and created_by=$2 and request_id=$3', [p.id, userId, v.requestId])).rows[0];
    if (old) {
      if (old.status !== 'pending' || old.name !== v.name || old.mime !== v.mime || Number(old.size_bytes) !== v.sizeBytes) throw new Denied('conflict');
      return { id: old.id, storageKey: old.storage_key };
    }
    const count = (await sql.query<{ n: number }>('select count(*)::int as n from brand_attachments where project_id=$1', [p.id])).rows[0]!.n;
    if (count >= 100) throw new Denied('rate_limited');
    const id = randomUUID(), storageKey = `brands/${p.organization_id}/${p.id}/${id}`;
    await sql.query('insert into brand_attachments(id,organization_id,project_id,name,mime,size_bytes,storage_key,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, p.organization_id, p.id, v.name, v.mime, v.sizeBytes, storageKey, userId, v.requestId]);
    return { id, storageKey };
  });
}
export interface BrandAttachmentAccess { key: string; name: string; mime: string; sizeBytes: number }
async function attachmentRow(sql: SqlRunner, userId: string, id: string, upload = false): Promise<Row> {
  const row = (await sql.query('select * from brand_attachments where id=$1', [id])).rows[0];
  if (!row) throw new Denied('not_found');
  const isStudio = (await profile(sql, userId)).is_admin === true;
  await project(sql, userId, String(row.project_id), { studio: isStudio, write: upload });
  if (upload ? row.created_by !== userId || row.status !== 'pending' : row.status !== 'ready') throw new Denied('not_found');
  return row;
}
async function attachmentAccess(deps: BrandWorkspaceDeps, viewer: Viewer, id: string, upload: boolean): Promise<BrandAttachmentAccess | null> {
  if (!uuid(viewer.userId) || !uuid(id)) return null;
  try { return await deps.sql.transaction(async sql => { const r = await attachmentRow(sql, viewer.userId!, id, upload); return { key: String(r.storage_key), name: String(r.name), mime: String(r.mime), sizeBytes: Number(r.size_bytes) }; }); }
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
export async function acceptBrandInvitation(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ organizationId: string }>> {
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
      await member(sql, userId, String(invite.organization_id));
      return { organizationId: String(invite.organization_id) };
    }
    // Revoking the inviting owner's role also invalidates their still-outstanding invitations.
    if (await member(sql, String(invite.created_by), String(invite.organization_id)) !== 'owner') throw new Denied('not_found');
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
