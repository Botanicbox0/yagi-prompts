import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { withHomeOverview } from './home-overview';
import { loadCampaignParticipation } from '@/lib/campaigns/production';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STAGING_BUCKET, type StorageDriver } from '@/lib/storage';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from './selection';
import { hasStaffReadAccess } from './staff';
import { UNKNOWN_POST_PRESENTATION } from './performance';
import {
  BrandHttpsUrlSchema, BrandOrganizationSchema, BrandProjectSchema, BrandProjectStatusSchema, BrandContentSchema,
  BrandDecisionSchema, BrandMessageSchema, BrandPostSchema, BrandReportSchema, BrandAttachmentSchema,
  BRAND_ATTACHMENT_LIMITS, normalizeBrandPostUrl,
  BrandInvitationSchema, BrandInvitationAcceptSchema, BrandMemberRevokeSchema,
  BrandCriteriaSchema,
  BrandPostMetricsSchema, BrandPostMetricsBatchSchema,
  BrandExternalPostsSchema, BrandProjectCoverSchema, BRAND_COVER_MIMES,
  BrandPostPresentationSchema, BRAND_POST_HANDLE_PATTERN,
} from './schemas';
import type {
  BrandOutcome, BrandFailureCode, BrandRole, BrandProjectSummary, BrandProjectDetail, BrandWorkspace,
  BrandContentVersion, BrandDecision, BrandMessage, BrandAttachment, BrandPost, BrandReport, BrandReportSnapshot,
  BrandMembers, BrandMetricsBatchResult, BrandExternalPostsResult, BrandPostPresentation,
} from './types';
export type * from './types';
export interface BrandWorkspaceDeps {
  sql: SqlRunner;
  storage?: Pick<StorageDriver, 'read'>;
  /**
   * Server-authenticated verified email only (`lib/auth/verified-email.ts`), never a request-body,
   * profile or `Viewer.email` value. Used for invitations and for the TWINGS team's read-only view of
   * every brand (`./staff.ts`).
   */
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
/**
 * `write` is the owner/editor right (approve, upload, request). `comment` is narrower: it lets a
 * campaign-only guest who was explicitly invited to comment post in the campaign conversation and
 * grants nothing else. Organization viewers stay read-only.
 *
 * `staff` is the TWINGS team's READ view (./staff.ts): the studio's internal detail, re-checked here,
 * and never combined with a write or comment right.
 */
async function project(sql: SqlRunner, userId: string, id: string, options: { studio?: boolean; staff?: { verifiedEmail?: string }; write?: boolean; comment?: boolean } = {}): Promise<Row> {
  if (options.studio) await studio(sql, userId);
  if (options.staff) {
    if (options.write || options.comment) throw new Denied('forbidden');
    if (!await hasStaffReadAccess(sql, userId, options.staff.verifiedEmail)) throw new Denied('not_found');
  }
  const row = (await sql.query(`select p.*,o.name as organization_name from brand_projects p
    join brand_organizations o on o.id=p.organization_id where p.id=$1 ${options.write ? 'for update of p' : 'for share of p'}`, [id])).rows[0];
  if (!row) throw new Denied('not_found');
  if (options.studio) { row.member_role = 'studio'; row.can_comment = true; }
  else if (options.staff) { row.member_role = 'studio'; row.can_comment = false; }
  else {
    if (!row.client_visible) throw new Denied('not_found');
    const orgRole = (await sql.query("select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active' for share", [row.organization_id,userId])).rows[0];
    const guest = (await sql.query("select can_comment from brand_project_members where organization_id=$1 and project_id=$2 and user_id=$3 and status='active' for share", [row.organization_id,id,userId])).rows[0];
    if (!orgRole && !guest) throw new Denied('not_found');
    row.member_role = orgRole?.role ?? 'viewer';
    row.can_comment = row.member_role !== 'viewer' || guest?.can_comment === true;
    if(options.write && row.member_role==='viewer') throw new Denied('forbidden');
    if(options.comment && !row.can_comment) throw new Denied('forbidden');
  }
  return row;
}
/** The customer's own access first; the TWINGS team's read-only view only where that finds nothing. */
async function readableProject(sql: SqlRunner, userId: string, id: string, verifiedEmail?: string): Promise<Row> {
  try { return await project(sql, userId, id); }
  catch (error) {
    if (!(error instanceof Denied) || error.code !== 'not_found') throw error;
    return project(sql, userId, id, { staff: { verifiedEmail } });
  }
}
/** Brand-level READ role: the active membership, else `studio` for the TWINGS team, else not_found. */
async function memberOrStaff(sql: SqlRunner, userId: string, organizationId: string, verifiedEmail?: string): Promise<BrandRole | 'studio'> {
  try { return await member(sql, userId, organizationId); }
  catch (error) {
    if (!(error instanceof Denied) || error.code !== 'not_found') throw error;
    if (await hasStaffReadAccess(sql, userId, verifiedEmail)) return 'studio';
    throw error;
  }
}
async function mutation<S extends z.ZodType, T>(deps: Pick<BrandWorkspaceDeps, 'sql'>, viewer: Viewer, schema: S, input: unknown,
  perform: (sql: SqlRunner, userId: string, value: z.output<S>) => Promise<T>): Promise<BrandOutcome<T>> {
  if (!uuid(viewer.userId)) return fail('sign_in_required');
  const parsed = schema.safeParse(input);
  // The full dotted path (`criteria.maxFollowers`, `referenceLinks.1.url`) lets the form mark the exact
  // control; the brand workspace form is the only reader of this field.
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
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
    // Only ever this project's own attachment (composite key); the route re-authorizes every read.
    coverUrl: row.cover_attachment_id ? `/api/brand-workspace/attachments/${row.cover_attachment_id}` : null,
  };
}
const attachmentUrl = (id: string) => `/api/brand-workspace/attachments/${id}`;
function presentationDto(row: Row): BrandPostPresentation {
  const followers = nullableNumber(row.follower_count);
  return { revision: Number(row.presentation_revision ?? 0),
    // Only ever this project's own attachment (composite key); the route re-authorizes every read.
    thumbnailUrl: row.thumbnail_attachment_id ? attachmentUrl(String(row.thumbnail_attachment_id)) : null,
    handle: row.creator_handle == null ? null : String(row.creator_handle), displayName: row.creator_name == null ? null : String(row.creator_name),
    followers, followersApproximate: followers !== null && row.followers_approximate === true,
    followersSource: followers === null ? null : row.followers_source as BrandPostPresentation['followersSource'],
    followersMeasuredAt: followers === null || row.followers_measured_at == null ? null : stamp(row.followers_measured_at) };
}
const FrozenPresentationSchema = z.object({
  thumbnailUrl: z.string().regex(/^\/api\/brand-workspace\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).nullable().catch(null),
  handle: z.string().regex(BRAND_POST_HANDLE_PATTERN).nullable().catch(null),
  displayName: z.string().min(1).max(80).nullable().catch(null),
  followers: z.number().int().nonnegative().nullable().catch(null),
  followersApproximate: z.boolean().catch(false),
  followersSource: z.enum(['creator_evidence', 'studio_review']).nullable().catch(null),
  followersMeasuredAt: z.string().refine(v => Number.isFinite(Date.parse(v))).nullable().catch(null),
});
/**
 * Presentation exactly as it was frozen into a report. Snapshots published before presentation existed
 * carry none: every field is unknown. Only the private attachment route (never a signed or external URL)
 * survives, and a follower count without its source and time is dropped rather than shown bare.
 */
function frozenPresentation(source: unknown): BrandPostPresentation {
  const parsed = FrozenPresentationSchema.safeParse(source);
  if (!parsed.success) return { ...UNKNOWN_POST_PRESENTATION };
  const v = parsed.data, known = v.followers !== null && v.followersSource !== null && v.followersMeasuredAt !== null;
  return { revision: 0, thumbnailUrl: v.thumbnailUrl, handle: v.handle, displayName: v.displayName,
    followers: known ? v.followers : null, followersApproximate: known && v.followersApproximate,
    followersSource: known ? v.followersSource : null, followersMeasuredAt: known ? v.followersMeasuredAt : null };
}
function postDto(row: Row): BrandPost {
  return { id: String(row.id), url: String(row.url), platform: row.platform as BrandPost['platform'],
    origin: row.origin === 'external_import' ? 'external_import' : 'approved_content',
    contentVersionId: row.content_version_id == null ? null : String(row.content_version_id),
    publishedAt: row.published_at == null ? null : stamp(row.published_at), metricRevision: Number(row.metric_revision),
    verification: row.verification as BrandPost['verification'], metricsSource: row.metrics_source as BrandPost['metricsSource'],
    measuredAt: row.measured_at == null ? null : stamp(row.measured_at), views: nullableNumber(row.views), viewsApproximate: row.views_approximate === true, likes: nullableNumber(row.likes),
    comments: nullableNumber(row.comments), shares: nullableNumber(row.shares), saves: nullableNumber(row.saves), createdAt: stamp(row.created_at),
    presentation: presentationDto(row) };
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
  // A post thumbnail is how the post is shown, not a campaign file: clients see it on the post card only.
  // An image that is also a content version's file stays listed, since content previews look it up here.
  // The campaign cover the TWINGS team uploaded is shown at the top of the page, not listed as a file;
  // a cover picked from the brand's own upload stays in the brand's file list.
  const thumbnails = row.member_role === 'studio' ? '' : ` and ((not exists(select 1 from brand_posts t where t.project_id=brand_attachments.project_id and t.thumbnail_attachment_id=brand_attachments.id)
      and not exists(select 1 from brand_projects cp join profiles u on u.id=brand_attachments.created_by where cp.id=brand_attachments.project_id and cp.cover_attachment_id=brand_attachments.id and u.is_admin))
    or exists(select 1 from brand_content_versions c where c.project_id=brand_attachments.project_id and c.attachment_id=brand_attachments.id))`;
  const attachments: BrandAttachment[] = (await scoped('brand_attachments', `and status='ready' and access_scope='workspace'${thumbnails} order by created_at`)).map(r => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), sizeBytes: Number(r.size_bytes), createdAt: stamp(r.created_at) }));
  const posts = (await scoped('brand_posts', 'order by created_at')).map(postDto);
  const reports: BrandReport[] = (await scoped('brand_reports', 'order by version desc')).map(r => {
    const source = r.snapshot as BrandReportSnapshot;
    // Rebuild even stored snapshots explicitly; extra JSON properties never reach consumers.
    const snapshot: BrandReportSnapshot = { totalPosts: source.totalPosts, measuredPosts: source.measuredPosts, viewsTotal: source.viewsTotal,
      // Snapshots stored before imported links or rounded counts existed carry neither field: approved content, exact counts.
      metricDefinition: 'sum_of_latest_post_views', posts: source.posts.map(p => ({ id: p.id, origin: p.origin === 'external_import' ? 'external_import' as const : 'approved_content' as const,
        contentVersionId: p.contentVersionId ?? null, url: p.url, platform: p.platform,
        publishedAt: p.publishedAt ?? null, metricRevision: p.metricRevision, verification: p.verification, metricsSource: p.metricsSource, measuredAt: p.measuredAt, views: p.views, viewsApproximate: p.viewsApproximate === true && p.views != null, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, createdAt: p.createdAt,
        presentation: frozenPresentation((p as { presentation?: unknown }).presentation) })), viewsTotalApproximate: false };
    // Derived from the frozen rows themselves, so a stored total can never be shown as exact by mistake.
    snapshot.viewsTotalApproximate = snapshot.posts.some(p => p.viewsApproximate);
    return { id: String(r.id), version: Number(r.version), summary: String(r.summary), periodStart: day(r.period_start)!, periodEnd: day(r.period_end)!, snapshot, createdAt: stamp(r.created_at) };
  });
  const contracts = (await scoped('brand_contract_documents', row.member_role === 'studio' ? 'order by created_at desc,version desc' : 'and shared=true order by created_at desc,version desc')).map(r=>({
    id:String(r.id),documentKey:String(r.document_key),title:String(r.title),version:Number(r.version),attachmentId:String(r.attachment_id),shared:Boolean(r.shared),revision:Number(r.revision),createdAt:stamp(r.created_at)
  }));
  const contractUploads = row.member_role === 'studio' ? (await scoped('brand_attachments', "and status='ready' and access_scope='contract' and id not in (select attachment_id from brand_contract_documents) order by created_at desc")).map(r=>({id:String(r.id),name:String(r.name),mime:String(r.mime),sizeBytes:Number(r.size_bytes),createdAt:stamp(r.created_at)})) : [];
  const references = z.array(z.object({ url: z.string(), note: z.string() })).parse(row.reference_links);
  return { ...summary(row), role: row.member_role as BrandProjectDetail['role'], canComment: row.can_comment === true, referenceLinks: references, contracts, contractUploads, contents, decisions, messages, attachments, posts, reports, participation: await loadCampaignParticipation(sql, String(row.id)) };
}

/**
 * `organizationId` narrows BOTH lists to one brand (the workspace selector's brand). Access is the
 * same rule either way: an active membership, or an active invitation to that visible campaign.
 * The TWINGS team browsing a selected brand it is not a member of reads every campaign of that brand,
 * including ones not yet shared, with no organization row (it holds no customer role there).
 */
export async function loadBrandWorkspace(deps: BrandWorkspaceDeps, viewer: Viewer, options: { includeAllContent?: boolean; organizationId?: string } = {}): Promise<BrandWorkspace> {
  if (!uuid(viewer.userId)) return { organizations: [], projects: [] };
  if (options.organizationId !== undefined && !uuid(options.organizationId)) return { organizations: [], projects: [] };
  const scope = options.organizationId ?? null;
  return deps.sql.transaction(async sql => {
    const memberships = (await sql.query(`select o.id,o.name,m.role from brand_organizations o join brand_memberships m on m.organization_id=o.id
      where m.user_id=$1 and m.status='active' and ($2::uuid is null or o.id=$2::uuid) order by o.created_at for share of m`, [viewer.userId, scope])).rows;
    if (scope !== null && memberships.length === 0 && await hasStaffReadAccess(sql, viewer.userId!, deps.verifiedEmail)) {
      const all = (await sql.query(`select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id
        where p.organization_id=$1 order by p.updated_at desc`, [scope])).rows;
      return { organizations: [], projects: await withHomeOverview(sql, all.map(summary), options.includeAllContent ? Infinity : 4) };
    }
    const projects = (await sql.query(`select p.*,o.name as organization_name from brand_projects p join brand_organizations o on o.id=p.organization_id
      where p.client_visible and ($2::uuid is null or p.organization_id=$2::uuid) and (exists(select 1 from brand_memberships m where m.organization_id=p.organization_id and m.user_id=$1 and m.status='active') or exists(select 1 from brand_project_members m where m.project_id=p.id and m.user_id=$1 and m.status='active')) order by p.updated_at desc`, [viewer.userId, scope])).rows;
    return { organizations: memberships.map(r => ({ id: String(r.id), name: String(r.name), role: r.role as BrandRole })), projects: await withHomeOverview(sql, projects.map(summary), options.includeAllContent ? Infinity : 4) };
  });
}
const logoUrl = (r: Row): string | null => r.logo_id ? `/api/brand-workspace/organizations/${r.id}/logo?v=${Number(r.logo_revision)}` : null;
/**
 * Every brand this account may pick in the workspace selector: its active memberships, then brands it
 * reaches only through an active invitation to a campaign that is currently shared. Such a guest is
 * listed as `guest` and gains no membership, owner control or brand-wide access from being listed.
 * The TWINGS team (./staff.ts) instead lists every other brand, empty ones included, as `studio`
 * (which replaces `guest`), and every campaign maps to its brand whether shared or not.
 */
export async function loadBrandWorkspaceScope(deps: BrandWorkspaceDeps, viewer: Viewer): Promise<BrandWorkspaceScope> {
  if (!uuid(viewer.userId)) return { choices: [], projectOrganizations: {} };
  return deps.sql.transaction(async sql => {
    const memberships = (await sql.query(`select o.id,o.name,o.logo_id,o.logo_revision,m.role from brand_organizations o join brand_memberships m on m.organization_id=o.id
      where m.user_id=$1 and m.status='active' order by o.created_at,o.id`, [viewer.userId])).rows;
    const projects = (await sql.query(`select p.id,p.organization_id,o.name,o.logo_id,o.logo_revision,
      exists(select 1 from brand_memberships m where m.organization_id=p.organization_id and m.user_id=$1 and m.status='active') as member
      from brand_projects p join brand_organizations o on o.id=p.organization_id
      where p.client_visible and (exists(select 1 from brand_memberships m where m.organization_id=p.organization_id and m.user_id=$1 and m.status='active')
        or exists(select 1 from brand_project_members g where g.project_id=p.id and g.user_id=$1 and g.status='active'))
      order by o.created_at,o.id,p.id`, [viewer.userId])).rows;
    const choices: BrandWorkspaceChoice[] = memberships.map(r => ({ id: String(r.id), name: String(r.name), role: r.role as BrandRole, logoUrl: logoUrl(r) }));
    if (await hasStaffReadAccess(sql, viewer.userId!, deps.verifiedEmail)) {
      const brands = (await sql.query('select id,name,logo_id,logo_revision from brand_organizations order by lower(name),id')).rows;
      for (const r of brands) if (!choices.some(c => c.id === r.id)) choices.push({ id: String(r.id), name: String(r.name), role: 'studio', logoUrl: logoUrl(r) });
      const all = (await sql.query('select id,organization_id from brand_projects order by id')).rows;
      return { choices, projectOrganizations: Object.fromEntries(all.map(r => [String(r.id), String(r.organization_id)])) };
    }
    for (const r of projects) {
      if (r.member !== true && !choices.some(c => c.id === r.organization_id))
        choices.push({ id: String(r.organization_id), name: String(r.name), role: 'guest', logoUrl: logoUrl({ ...r, id: r.organization_id }) });
    }
    return { choices, projectOrganizations: Object.fromEntries(projects.map(r => [String(r.id), String(r.organization_id)])) };
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
  try { return await deps.sql.transaction(async sql => detail(sql, isStudio ? await project(sql, viewer.userId!, id, { studio: true }) : await readableProject(sql, viewer.userId!, id, deps.verifiedEmail))); }
  catch (error) { if (error instanceof Denied) return null; throw error; }
}
export const loadBrandProject = (deps: BrandWorkspaceDeps, viewer: Viewer, id: string) => loadProject(deps, viewer, id, false);
export const loadStudioProject = (deps: BrandWorkspaceDeps, viewer: Viewer, id: string) => loadProject(deps, viewer, id, true);
/** Lightweight current authorization for output media; does not load reports/attachments/contents. */
export async function canReadBrandProject(deps: BrandWorkspaceDeps, viewer: Viewer, id: string): Promise<boolean> {
  if (!uuid(viewer.userId) || !uuid(id)) return false;
  try { return await deps.sql.transaction(async sql => { await readableProject(sql, viewer.userId!, id, deps.verifiedEmail); return true; }); }
  catch (error) { if (error instanceof Denied) return false; throw error; }
}

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
/**
 * Which server surface a conversation write came through. Set by the server code that calls the
 * service (the brand API passes `client`, the admin console passes `studio`), never by a request body.
 *
 *   · `studio`: the admin console. Requires `is_admin`; the row is the studio's even if that admin also
 *     holds a seat in the brand.
 *   · `client`: the brand workspace. The customer's own seat decides: a member or commenting guest
 *     writes as the brand (and the studio is notified), even when that account is also `is_admin`.
 *     Only an `is_admin` account with no customer access there writes as the studio, as before.
 *     Domain-only staff (./staff.ts) hold a read right only and are refused on both paths.
 */
export type BrandWriteEntry = 'client' | 'studio';
/** Customer access first; the studio only where the customer check finds nothing and the user is `is_admin`. */
async function clientOrStudio<T>(sql: SqlRunner, userId: string, asClient: () => Promise<T>, asStudio: () => Promise<T>): Promise<{ row: T; studio: boolean }> {
  try { return { row: await asClient(), studio: false }; }
  catch (error) {
    if (!(error instanceof Denied) || error.code !== 'not_found' || (await profile(sql, userId)).is_admin !== true) throw error;
    return { row: await asStudio(), studio: true };
  }
}
export async function sendBrandMessage(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown, entry: BrandWriteEntry = 'client'): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandMessageSchema, input, async (sql, userId, v) => {
    // Commenting is its own right: owners, editors and invited commenting guests; never org viewers.
    const asStudio = () => project(sql, userId, v.projectId, { studio: true, comment: true });
    const { row: p, studio: isStudio } = entry === 'studio' ? { row: await asStudio(), studio: true }
      : await clientOrStudio(sql, userId, () => project(sql, userId, v.projectId, { comment: true }), asStudio);
    const old = await retry(sql, 'brand_messages', v.projectId, userId, v.requestId); if (old) return { id: old };
    const recent = (await sql.query<{ n: number }>("select count(*)::int as n from brand_messages where created_by=$1 and created_at>now()-interval '1 minute'", [userId])).rows[0]!.n;
    if (recent >= 10) throw new Denied('rate_limited');
    const id = randomUUID();
    await sql.query('insert into brand_messages(id,organization_id,project_id,body,author_role,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7)', [id, p.organization_id, p.id, v.body, isStudio ? 'studio' : 'brand', userId, v.requestId]);
    if (!isStudio) await event(sql, p, 'message_received', id); return { id };
  });
}
type Observation = { verification: string; metricsSource: string; views: number | null; viewsApproximate: boolean; likes: number | null; comments: number | null; shares: number | null; saves: number | null };
/** Append one immutable observation. History is only ever inserted, by these three call sites. */
async function observe(sql: SqlRunner, p: Row, postId: string, revision: number, o: Observation, measuredAt: string | null, userId: string, requestId: string, batchId: string | null): Promise<string> {
  const id = randomUUID();
  await sql.query(`insert into brand_post_measurements(id,organization_id,project_id,post_id,revision,verification,metrics_source,measured_at,views,views_approximate,likes,comments,shares,saves,created_by,request_id,batch_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [id, p.organization_id, p.id, postId, revision, o.verification, o.metricsSource, measuredAt, o.views, o.viewsApproximate, o.likes, o.comments, o.shares, o.saves, userId, requestId, batchId]);
  return id;
}
/** brand_posts is the latest projection of that history, written in the same transaction. */
async function projectLatest(sql: SqlRunner, postId: string, revision: number, o: Observation, measuredAt: string | null): Promise<void> {
  await sql.query('update brand_posts set metric_revision=$1,verification=$2,metrics_source=$3,measured_at=$4,views=$5,views_approximate=$6,likes=$7,comments=$8,shares=$9,saves=$10 where id=$11',
    [revision, o.verification, o.metricsSource, measuredAt, o.views, o.viewsApproximate, o.likes, o.comments, o.shares, o.saves, postId]);
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
    await sql.query(`insert into brand_posts(id,organization_id,project_id,content_version_id,url,platform,verification,metrics_source,measured_at,views,views_approximate,likes,comments,shares,saves,created_by,request_id,platform_post_id,published_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, [id, p.organization_id, p.id, c.id, normalized.url, normalized.platform, v.verification, v.metricsSource, v.measuredAt, v.views, v.viewsApproximate, v.likes, v.comments, v.shares, v.saves, userId, v.requestId, normalized.postId, v.publishedAt]);
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
    // An imported link whose publish time is still unknown cannot be placed in or out of the period, so
    // it is included and stays visibly undated in the snapshot rather than silently dropped.
    const posts = (await sql.query(`select * from brand_posts where organization_id=$1 and project_id=$2
      and (published_at is null or (published_at >= ($3::date::timestamp at time zone 'Asia/Seoul')
      and published_at < (($4::date+1)::timestamp at time zone 'Asia/Seoul'))) order by published_at nulls last,created_at,id`, [p.organization_id, p.id, v.periodStart, v.periodEnd])).rows.map(postDto);
    const measured = posts.filter(post => post.views !== null);
    const snapshot: BrandReportSnapshot = { totalPosts: posts.length, measuredPosts: measured.length, viewsTotal: measured.length ? measured.reduce((sum, p) => sum + p.views!, 0) : null,
      viewsTotalApproximate: measured.some(p => p.viewsApproximate), metricDefinition: 'sum_of_latest_post_views', posts };
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
    const digest = createHash('sha256').update(JSON.stringify([p.id, rows.map(r => [r.postId, r.expectedRevision, r.verification, r.metricsSource, r.views, r.likes, r.comments, r.shares, r.saves, ...(r.viewsApproximate ? ['views_approximate'] : [])])])).digest('hex');
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

/**
 * Append links to posts that were already published outside this workspace. Each is stored as an
 * `external_import`: no content version, no approval, no counts, and a publish time only when the
 * studio actually knows it. Links are identified by their normalized platform post id, so the same
 * post pasted as /reel/, with tracking parameters or twice in one paste is one post. A link already on
 * the campaign is left as it is; the only change it can receive is a first known publish time.
 * No link is fetched; counts are collected afterwards through the existing collection console.
 */
export async function importBrandExternalPosts(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<BrandExternalPostsResult>> {
  return mutation(deps, viewer, BrandExternalPostsSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    // Same freeze as collection: a completed or cancelled campaign receives no new posts.
    if (p.status !== 'active') throw new Denied('not_active');
    const links = new Map<string, { url: string; platform: string; postId: string; publishedAt: string | null }>();
    for (const post of v.posts) {
      // Any unusable line refuses the whole paste, so nothing is half-saved.
      const normalized = normalizeBrandPostUrl(post.url); if (!normalized) throw new Denied('invalid');
      if (post.publishedAt && +new Date(post.publishedAt) > Date.now() + 300000) throw new Denied('invalid');
      const key = `${normalized.platform}:${normalized.postId}`, seen = links.get(key);
      if (!seen) { links.set(key, { ...normalized, publishedAt: post.publishedAt }); continue; }
      if (seen.publishedAt && post.publishedAt && +new Date(seen.publishedAt) !== +new Date(post.publishedAt)) throw new Denied('invalid');
      seen.publishedAt ??= post.publishedAt;
    }
    let added = 0, existing = 0, dated = 0;
    for (const [key, link] of [...links].sort(([x], [y]) => x.localeCompare(y))) {
      const requestId = rowRequestId(v.requestId, key);
      const row = (await sql.query('select id,origin,published_at,created_by,request_id from brand_posts where project_id=$1 and platform=$2 and platform_post_id=$3 for update',
        [p.id, link.platform, link.postId])).rows[0];
      if (!row) {
        await sql.query(`insert into brand_posts(id,organization_id,project_id,content_version_id,origin,url,platform,platform_post_id,published_at,verification,metrics_source,created_by,request_id)
          values($1,$2,$3,null,'external_import',$4,$5,$6,$7,$8,'unavailable',$9,$10)`,
          [randomUUID(), p.organization_id, p.id, link.url, link.platform, link.postId, link.publishedAt, v.verification, userId, requestId]);
        added++; continue;
      }
      // A retried request finds its own rows and reports them as added again, writing nothing.
      if (row.created_by === userId && row.request_id === requestId) { added++; continue; }
      existing++;
      if (link.publishedAt && row.origin === 'external_import' && row.published_at == null) {
        await sql.query('update brand_posts set published_at=$1 where id=$2 and published_at is null', [link.publishedAt, row.id]);
        dated++;
      }
    }
    return { id: String(p.id), added, existing, dated };
  });
}

/** Studio-only. The cover is one of this project's own ready images; `null` removes it. */
export async function setBrandProjectCover(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  return mutation(deps, viewer, BrandProjectCoverSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    if ((p.cover_attachment_id ?? null) === v.attachmentId) return { id: String(p.id) };
    if (Number(p.revision) !== v.expectedRevision) throw new Denied('conflict');
    if (v.attachmentId && !(await sql.query(`select id from brand_attachments where project_id=$1 and id=$2 and status='ready'
      and access_scope='workspace' and mime=any($3::text[])`, [p.id, v.attachmentId, [...BRAND_COVER_MIMES]])).rows[0]) throw new Denied('invalid');
    await sql.query('update brand_projects set cover_attachment_id=$1,revision=revision+1,updated_at=now() where id=$2', [v.attachmentId, p.id]);
    return { id: String(p.id) };
  });
}

/**
 * Studio-only. How one post is recognized on the campaign page: a thumbnail chosen from this project's
 * own ready images, the creator's handle and, when actually known, a follower count with its source and
 * time. Guarded by `presentation_revision` alone, so it never races or moves `metric_revision`, and it
 * touches no metric or measurement history. Allowed in every campaign state: it describes the post,
 * it is not a measurement. Reports already published keep the presentation they were frozen with.
 */
export async function setBrandPostPresentation(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; revision: number }>> {
  return mutation(deps, viewer, BrandPostPresentationSchema, input, async (sql, userId, v) => {
    const p = await project(sql, userId, v.projectId, { studio: true, write: true });
    const post = (await sql.query('select * from brand_posts where project_id=$1 and id=$2 for update', [p.id, v.postId])).rows[0];
    if (!post) throw new Denied('not_found');
    const current = presentationDto(post);
    const wanted = { thumbnailUrl: v.thumbnailAttachmentId ? attachmentUrl(v.thumbnailAttachmentId) : null, handle: v.handle, displayName: v.displayName,
      followers: v.followers, followersApproximate: v.followersApproximate, followersSource: v.followersSource };
    const same = (Object.keys(wanted) as Array<keyof typeof wanted>).every(k => current[k] === wanted[k])
      && (current.followersMeasuredAt === null ? v.followersMeasuredAt === null : v.followersMeasuredAt !== null && +new Date(current.followersMeasuredAt) === +new Date(v.followersMeasuredAt));
    // A retry whose first attempt committed (or a save that changes nothing) succeeds without a new revision.
    if (same) return { id: String(post.id), revision: current.revision };
    if (current.revision !== v.expectedRevision) throw new Denied('conflict');
    if (v.followersMeasuredAt && +new Date(v.followersMeasuredAt) > Date.now() + 300000) throw new Denied('invalid');
    if (v.thumbnailAttachmentId && !(await sql.query(`select id from brand_attachments where project_id=$1 and id=$2 and status='ready'
      and access_scope='workspace' and mime=any($3::text[])`, [p.id, v.thumbnailAttachmentId, [...BRAND_COVER_MIMES]])).rows[0]) throw new Denied('invalid');
    await sql.query(`update brand_posts set thumbnail_attachment_id=$1,creator_handle=$2,creator_name=$3,follower_count=$4,followers_approximate=$5,
      followers_source=$6,followers_measured_at=$7,presentation_revision=presentation_revision+1 where id=$8 and project_id=$9`,
      [v.thumbnailAttachmentId, v.handle, v.displayName, v.followers, v.followersApproximate, v.followersSource, v.followersMeasuredAt, post.id, p.id]);
    return { id: String(post.id), revision: current.revision + 1 };
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
async function attachmentRow(sql: SqlRunner, userId: string, id: string, upload = false, verifiedEmail?: string): Promise<Row> {
  const row = (await sql.query('select * from brand_attachments where id=$1', [id])).rows[0];
  if (!row) throw new Denied('not_found');
  let isStudio = (await profile(sql, userId)).is_admin === true;
  // A download follows the same rule as the project page that lists it; an upload never uses the team view.
  if (isStudio || upload) await project(sql, userId, String(row.project_id), { studio: isStudio, write: upload });
  else isStudio = (await readableProject(sql, userId, String(row.project_id), verifiedEmail)).member_role === 'studio';
  if(!isStudio && row.access_scope==='contract' && !(await sql.query('select id from brand_contract_documents where attachment_id=$1 and project_id=$2 and shared=true',[id,row.project_id])).rows[0]) throw new Denied('not_found');
  if (upload ? row.created_by !== userId || row.status !== 'pending' : row.status !== 'ready') throw new Denied('not_found');
  return row;
}
async function attachmentAccess(deps: BrandWorkspaceDeps, viewer: Viewer, id: string, upload: boolean): Promise<BrandAttachmentAccess | null> {
  if (!uuid(viewer.userId) || !uuid(id)) return null;
  try { return await deps.sql.transaction(async sql => { const r = await attachmentRow(sql, viewer.userId!, id, upload, upload ? undefined : deps.verifiedEmail); return { contract:r.access_scope==='contract', key: String(r.storage_key), name: String(r.name), mime: String(r.mime), sizeBytes: Number(r.size_bytes) }; }); }
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
    // Owners manage the team; the TWINGS team may read it. Changes stay with owners and /admin.
    const role = await memberOrStaff(sql, viewer.userId!, organizationId, deps.verifiedEmail);
    if (role !== 'owner' && role !== 'studio') throw new Denied('forbidden');
    const org = (await sql.query('select id,name from brand_organizations where id=$1', [organizationId])).rows[0];
    if (!org) throw new Denied('not_found');
    const members = (await sql.query(`select m.id,m.user_id,m.role,m.status,p.email from brand_memberships m
      join profiles p on p.id=m.user_id where m.organization_id=$1 order by m.created_at`, [organizationId])).rows;
    // A campaign-only invitation names its campaign, but only once that campaign is shared with the client.
    const invitations = (await sql.query(`select i.id,i.email,i.role,i.expires_at,i.accepted_at,i.revoked_at,i.project_id,p.client_visible as project_shared,
      case when p.client_visible then p.title end as project_title from brand_invites i left join brand_projects p on p.id=i.project_id and p.organization_id=i.organization_id
      where i.organization_id=$1 order by i.created_at desc`, [organizationId])).rows;
    return { organization: { id: String(org.id), name: String(org.name) }, members: members.map(m => ({
      id: String(m.id), userId: String(m.user_id), email: m.role !== 'owner' || m.user_id === viewer.userId ? String(m.email) : null,
      role: m.role as BrandRole, status: m.status as 'active' | 'revoked', isSelf: m.user_id === viewer.userId,
    })), invitations: invitations.map(i => ({ id: String(i.id), email: i.role === 'owner' ? null : String(i.email), role: i.role as 'owner' | 'editor' | 'viewer', expiresAt: stamp(i.expires_at),
      project: i.project_id ? { shared: i.project_shared === true, title: i.project_title == null ? null : String(i.project_title) } : null,
      status: i.revoked_at ? 'revoked' as const : i.accepted_at ? 'accepted' as const : +new Date(stamp(i.expires_at)) <= Date.now() ? 'expired' as const : 'pending' as const })) };
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}
/**
 * Campaigns this account was invited to as a guest that the studio has not shared yet, in brands where
 * it holds no membership. Only a count: nothing about those campaigns is shown until they are shared.
 */
export async function countPendingSharedCampaigns(deps: BrandWorkspaceDeps, viewer: Viewer): Promise<number> {
  if (!uuid(viewer.userId)) return 0;
  const row = (await deps.sql.query<{ n: number }>(`select count(*)::int as n from brand_project_members g join brand_projects p on p.id=g.project_id and p.organization_id=g.organization_id
    where g.user_id=$1 and g.status='active' and not p.client_visible
    and not exists(select 1 from brand_memberships m where m.organization_id=g.organization_id and m.user_id=$1 and m.status='active')`, [viewer.userId])).rows[0];
  return Number(row?.n ?? 0);
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
/**
 * Where an accepted invitation lands is decided from this result (`invitationLanding`): the brand
 * itself, or the campaign when it is shared with the client. `projectShared` is false for a campaign
 * the studio has not shared yet, so the guest is not sent to a page that cannot open.
 */
export type BrandInvitationAccepted = { organizationId: string; projectId?: string; projectShared?: boolean };
async function acceptedScope(sql: SqlRunner, invite: Row): Promise<BrandInvitationAccepted> {
  if (!invite.project_id) return { organizationId: String(invite.organization_id) };
  const shared = (await sql.query('select client_visible from brand_projects where id=$1 and organization_id=$2', [invite.project_id, invite.organization_id])).rows[0]?.client_visible === true;
  return { organizationId: String(invite.organization_id), projectId: String(invite.project_id), projectShared: shared };
}
export async function acceptBrandInvitation(deps: BrandWorkspaceDeps, viewer: Viewer, input: unknown): Promise<BrandOutcome<BrandInvitationAccepted>> {
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
      return acceptedScope(sql, invite);
    }
    // Revoking the inviting owner's role also invalidates their still-outstanding invitations.
    if(invite.issued_by_studio) await studio(sql,String(invite.created_by));
    else if (await member(sql, String(invite.created_by), String(invite.organization_id)) !== 'owner') throw new Denied('not_found');
    if(invite.project_id) {
      // The newest invitation defines the guest's scope, including whether they may comment.
      await sql.query("insert into brand_project_members(organization_id,project_id,user_id,can_comment) values($1,$2,$3,$4) on conflict(project_id,user_id) do update set status='active',can_comment=excluded.can_comment",[invite.organization_id,invite.project_id,userId,invite.can_comment===true]);
      await sql.query('update brand_invites set accepted_at=now(),accepted_by=$1 where id=$2',[userId,invite.id]);
      return acceptedScope(sql, invite);
    }
    const current = (await sql.query('select role,status from brand_memberships where organization_id=$1 and user_id=$2 for update', [invite.organization_id, userId])).rows[0];
    // Already an active member. The same role (a re-sent invitation) is used up and lands in the
    // brand. A different role is refused and left pending: accepting never changes a seat, and a
    // silently "accepted" owner invitation that kept an editor seat would mislead the studio.
    if (current?.status === 'active' && current.role !== invite.role) throw new Denied('existing_member_role_mismatch');
    if (current?.status !== 'active')
      await sql.query(`insert into brand_memberships(organization_id,user_id,role) values($1,$2,$3)
        on conflict(organization_id,user_id) do update set role=excluded.role,status='active'`, [invite.organization_id, userId, invite.role]);
    await sql.query('update brand_invites set accepted_at=now(),accepted_by=$1 where id=$2', [userId, invite.id]);
    return acceptedScope(sql, invite);
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
// `canComment` applies to campaign-only guests; organization members' rights come from their role.
const StudioInvitationSchema=z.object({organizationId:z.uuid(),projectId:z.uuid().nullable().default(null),email:z.email().trim().toLowerCase().max(254),role:z.enum(['owner','editor','viewer']),canComment:z.boolean().default(false),requestId:z.uuid()}).refine(v=>!v.projectId||v.role==='viewer').refine(v=>!v.canComment||v.projectId!==null,{path:['canComment']});
export async function createStudioInvitation(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome<{id:string;token:string}>> {
 return mutation(deps,viewer,StudioInvitationSchema,input,async(sql,userId,v)=>{
  await studio(sql,userId);
  const org=(await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId])).rows[0];
  if(!org)throw new Denied('not_found');
  if(v.projectId){
   const p=await project(sql,userId,v.projectId,{studio:true});
   if(p.organization_id!==v.organizationId)throw new Denied('not_found');
   // A campaign-only guest can open nothing until the campaign is shared; invite once it is.
   // Brand-wide invitations do not depend on any campaign and stay available before publication.
   if(!p.client_visible)throw new Denied('not_shared');
  }
  if((await sql.query('select id from brand_invites where organization_id=$1 and created_by=$2 and request_id=$3',[v.organizationId,userId,v.requestId])).rows[0])throw new Denied('conflict');
  const count=(await sql.query("select count(*)::int as n from brand_invites where organization_id=$1 and created_at>now()-interval '1 day'",[v.organizationId])).rows[0];
  if(Number(count?.n)>=20)throw new Denied('rate_limited');
  await sql.query('update brand_invites set revoked_at=now() where organization_id=$1 and email=$2 and project_id is not distinct from $3::uuid and accepted_at is null and revoked_at is null',[v.organizationId,v.email,v.projectId]);
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await sql.query("insert into brand_invites(id,organization_id,project_id,email,role,can_comment,issued_by_studio,token_hash,expires_at,created_by,request_id) values($1,$2,$3,$4,$5,$6,true,$7,now()+interval '7 days',$8,$9)",[id,v.organizationId,v.projectId,v.email,v.role,v.canComment,createHash('sha256').update(token).digest('hex'),userId,v.requestId]);
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
 id:string;name:string;logoUrl:string|null;logoRevision:number;
 members:Array<{userId:string;email:string;role:string;projectId:string|null;projectTitle:string|null;status:string;canComment:boolean}>;
 invitations:Array<{id:string;email:string;role:string;projectId:string|null;projectTitle:string|null;state:'pending'|'accepted'|'revoked'|'expired';expiresAt:string;canComment:boolean}>;
}
export async function loadStudioBrandAccess(deps:BrandWorkspaceDeps,viewer:Viewer,organizationId:string):Promise<StudioBrandAccess|null> {
 if(!uuid(viewer.userId)||!uuid(organizationId))return null;
 try{return await deps.sql.transaction(async sql=>{
  await studio(sql,viewer.userId!);
  const org=(await sql.query('select id,name,logo_id,logo_revision from brand_organizations where id=$1',[organizationId])).rows[0];if(!org)return null;
  const members=(await sql.query(`select m.user_id,p.email,m.role,m.status,null::uuid as project_id,null::text as project_title,m.role<>'viewer' as can_comment from brand_memberships m join profiles p on p.id=m.user_id where m.organization_id=$1
    union all select m.user_id,p.email,'viewer',m.status,m.project_id,c.title,m.can_comment from brand_project_members m join profiles p on p.id=m.user_id join brand_projects c on c.id=m.project_id where m.organization_id=$1`,[organizationId])).rows;
  const invitations=(await sql.query('select i.id,i.email,i.role,i.project_id,c.title as project_title,i.accepted_at,i.revoked_at,i.expires_at,i.can_comment from brand_invites i left join brand_projects c on c.id=i.project_id where i.organization_id=$1 order by i.created_at desc',[organizationId])).rows;
  return {id:String(org.id),name:String(org.name),logoUrl:logoUrl(org),logoRevision:Number(org.logo_revision),members:members.map(m=>({userId:String(m.user_id),email:String(m.email),role:String(m.role),status:String(m.status),projectId:m.project_id?String(m.project_id):null,projectTitle:m.project_title?String(m.project_title):null,canComment:m.can_comment===true})),
   invitations:invitations.map(i=>({id:String(i.id),email:String(i.email),role:String(i.role),projectId:i.project_id?String(i.project_id):null,projectTitle:i.project_title?String(i.project_title):null,expiresAt:stamp(i.expires_at),canComment:i.project_id?i.can_comment===true:i.role!=='viewer',state:i.revoked_at?'revoked':i.accepted_at?'accepted':+new Date(stamp(i.expires_at))<=Date.now()?'expired':'pending'}))};
 });}catch(e){if(e instanceof Denied)return null;throw e}
}
export async function revokeStudioInvitation(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({organizationId:z.uuid(),invitationId:z.uuid()}),input,async(sql,userId,v)=>{
  await studio(sql,userId);await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId]);
  const r=(await sql.query('update brand_invites set revoked_at=now() where organization_id=$1 and id=$2 and accepted_at is null returning id',[v.organizationId,v.invitationId])).rows[0];
  if(!r)throw new Denied('not_found');return {id:String(r.id)};
 });
}

export interface BrandOrganizationSettings {id:string;name:string;website:string;description:string;contactEmail:string;revision:number;role:BrandRole|'studio';logoUrl:string|null;logoRevision:number}
export async function loadBrandSettings(deps:BrandWorkspaceDeps,viewer:Viewer,id:string,isStudio=false):Promise<BrandOrganizationSettings|null> {
 if(!uuid(viewer.userId)||!uuid(id))return null;
 try{return await deps.sql.transaction(async sql=>{
  const role=isStudio?(await studio(sql,viewer.userId!),'studio' as const):await memberOrStaff(sql,viewer.userId!,id,deps.verifiedEmail);
  const r=(await sql.query('select id,name,website,description,contact_email,profile_revision,logo_id,logo_revision from brand_organizations where id=$1',[id])).rows[0];
  if(!r)return null;return {id:String(r.id),name:String(r.name),website:String(r.website),description:String(r.description),contactEmail:String(r.contact_email),revision:Number(r.profile_revision),role,logoUrl:logoUrl(r),logoRevision:Number(r.logo_revision)};
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
  if(isStudio)await studio(sql,viewer.userId!);else await memberOrStaff(sql,viewer.userId!,id,deps.verifiedEmail);
  return (await sql.query('select id,body,author_role,created_at from brand_support_messages where organization_id=$1 order by created_at,id',[id])).rows.map(r=>({id:String(r.id),body:String(r.body),authorRole:r.author_role as BrandMessage['authorRole'],createdAt:stamp(r.created_at)}));
 });}catch(e){if(e instanceof Denied)return null;throw e}
}
/** `entry` as for `sendBrandMessage`: server-provided, never from the request. */
export async function sendBrandSupport(deps:BrandWorkspaceDeps,viewer:Viewer,input:unknown,entry:BrandWriteEntry='client'):Promise<BrandOutcome> {
 return mutation(deps,viewer,z.object({organizationId:z.uuid(),body:z.string().trim().min(1).max(4000),requestId:z.uuid()}),input,async(sql,userId,v)=>{
  const isStudio=entry==='studio'?(await studio(sql,userId),true)
   :(await clientOrStudio(sql,userId,()=>member(sql,userId,v.organizationId,true),async()=>undefined)).studio;
  const org=(await sql.query('select id from brand_organizations where id=$1 for update',[v.organizationId])).rows[0];if(!org)throw new Denied('not_found');
  const old=(await sql.query('select id from brand_support_messages where organization_id=$1 and created_by=$2 and request_id=$3',[v.organizationId,userId,v.requestId])).rows[0];if(old)return{id:String(old.id)};
  const count=(await sql.query("select count(*)::int as n from brand_support_messages where created_by=$1 and created_at>now()-interval '1 hour'",[userId])).rows[0];if(Number(count?.n)>=30)throw new Denied('rate_limited');
  const id=randomUUID();await sql.query('insert into brand_support_messages(id,organization_id,body,author_role,created_by,request_id) values($1,$2,$3,$4,$5,$6)',[id,v.organizationId,v.body,isStudio?'studio':'brand',userId,v.requestId]);return{id};
 });
}

/** 2 MiB, checked against the bytes themselves; the declared type is never trusted. */
export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const BRAND_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type BrandLogoMime = typeof BRAND_LOGO_MIMES[number];
/** The image type the bytes actually are, or null. Only PNG, JPEG and WebP can be a logo. */
export function brandLogoMime(bytes: Uint8Array): BrandLogoMime | null {
  if (bytes.byteLength < 12) return null;
  const mime = actualMime(bytes);
  return (BRAND_LOGO_MIMES as readonly string[]).includes(mime ?? '') ? mime as BrandLogoMime : null;
}
const BrandLogoSchema = z.object({
  organizationId: z.uuid(), requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  bytes: z.instanceof(Uint8Array).refine(b => b.byteLength > 0 && b.byteLength <= BRAND_LOGO_MAX_BYTES, 'Use an image up to 2 MiB'),
  /** Optional declared type (a browser's file.type). When present it must match the bytes. */
  mime: z.enum(BRAND_LOGO_MIMES).optional(),
});
const BrandLogoRemoveSchema = z.object({ organizationId: z.uuid(), expectedRevision: z.number().int().nonnegative() });
/**
 * Owners of the brand and the studio set its logo. Unknown and not-a-member look the same (not_found);
 * an editor or viewer of the brand is refused. The organization row is locked first, so two writers
 * queue and the later one sees `conflict` through `expectedRevision`.
 */
async function logoWriter(sql: SqlRunner, userId: string, organizationId: string): Promise<Row> {
  const isStudio = (await profile(sql, userId)).is_admin === true;
  const org = (await sql.query('select id,logo_id,logo_revision from brand_organizations where id=$1 for update', [organizationId])).rows[0];
  if (!org) throw new Denied('not_found');
  if (!isStudio && await member(sql, userId, organizationId) !== 'owner') throw new Denied('forbidden');
  return org;
}
/**
 * Store an inspected image as the brand's current logo. No campaign is needed. Retrying the same
 * `requestId` with the same bytes returns the first result; different bytes under it are a conflict.
 * The bytes go to the private staging bucket only.
 */
export async function storeBrandOrganizationLogo(deps: { sql: SqlRunner; storage?: Pick<StorageDriver, 'putStaging'> }, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; revision: number }>> {
  return mutation(deps, viewer, BrandLogoSchema, input, async (sql, userId, v) => {
    const mime = brandLogoMime(v.bytes);
    if (!mime || (v.mime && v.mime !== mime)) throw new Denied('invalid');
    const org = await logoWriter(sql, userId, v.organizationId);
    const sha256 = createHash('sha256').update(v.bytes).digest('hex');
    const old = (await sql.query('select id,sha256 from brand_organization_logos where organization_id=$1 and created_by=$2 and request_id=$3', [org.id, userId, v.requestId])).rows[0];
    if (old) {
      if (old.sha256 !== sha256) throw new Denied('conflict');
      return { id: String(old.id), revision: Number(org.logo_revision) };
    }
    if (Number(org.logo_revision) !== v.expectedRevision) throw new Denied('conflict');
    if (!deps.storage) throw new Denied('storage_unavailable');
    const id = randomUUID(), storageKey = `brands/${org.id}/logos/${id}`;
    await deps.storage.putStaging(storageKey, v.bytes, mime);
    await sql.query('insert into brand_organization_logos(id,organization_id,storage_key,mime,size_bytes,sha256,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, org.id, storageKey, mime, v.bytes.byteLength, sha256, userId, v.requestId]);
    await sql.query('update brand_organizations set logo_id=$1,logo_revision=logo_revision+1 where id=$2', [id, org.id]);
    return { id, revision: Number(org.logo_revision) + 1 };
  });
}
/** Back to the default avatar. The stored bytes stay (storage has no delete); nothing points at them. */
export async function removeBrandOrganizationLogo(deps: { sql: SqlRunner }, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; revision: number }>> {
  return mutation(deps, viewer, BrandLogoRemoveSchema, input, async (sql, userId, v) => {
    const org = await logoWriter(sql, userId, v.organizationId);
    // Already on the default avatar: a retried removal succeeds without moving the revision.
    if (org.logo_id == null) return { id: String(org.id), revision: Number(org.logo_revision) };
    if (Number(org.logo_revision) !== v.expectedRevision) throw new Denied('conflict');
    await sql.query('update brand_organizations set logo_id=null,logo_revision=logo_revision+1 where id=$1', [org.id]);
    return { id: String(org.id), revision: Number(org.logo_revision) + 1 };
  });
}
export interface BrandLogoAccess { key: string; mime: BrandLogoMime; sizeBytes: number; sha256: string }
/**
 * Who may see a brand's logo: the TWINGS team (./staff.ts), an active member of the brand, or an active
 * guest of one of its currently shared campaigns. Everyone else, and a brand without a logo, gets null (404).
 */
export async function loadBrandOrganizationLogoAccess(deps: { sql: SqlRunner; verifiedEmail?: string }, viewer: Viewer, organizationId: string): Promise<BrandLogoAccess | null> {
  if (!uuid(viewer.userId) || !uuid(organizationId)) return null;
  try { return await deps.sql.transaction(async sql => {
    const isStudio = await hasStaffReadAccess(sql, viewer.userId!, deps.verifiedEmail);
    const allowed = isStudio || (await sql.query(`select 1 from brand_memberships m where m.organization_id=$1 and m.user_id=$2 and m.status='active'
      union all select 1 from brand_project_members g join brand_projects p on p.id=g.project_id and p.organization_id=g.organization_id
      where g.organization_id=$1 and g.user_id=$2 and g.status='active' and p.client_visible limit 1`, [organizationId, viewer.userId])).rows.length > 0;
    if (!allowed) return null;
    const r = (await sql.query(`select l.storage_key,l.mime,l.size_bytes,l.sha256 from brand_organizations o
      join brand_organization_logos l on l.organization_id=o.id and l.id=o.logo_id where o.id=$1`, [organizationId])).rows[0];
    return r ? { key: String(r.storage_key), mime: r.mime as BrandLogoMime, sizeBytes: Number(r.size_bytes), sha256: String(r.sha256) } : null;
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}
