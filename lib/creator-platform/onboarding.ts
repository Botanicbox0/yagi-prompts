import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { CreatorApplicationInput, PlatformError, demand } from './contract';
import { canonicalPost } from './social';
import { approvedCreator, lockUser, onboardingReady } from './service';

export const APPLICATION_FIELDS = ['displayName','portfolioUrl','samples','mediums','tools','message','rights','program'] as const;
export type ApplicationField = (typeof APPLICATION_FIELDS)[number];
export function isApplicationField(value: unknown): value is ApplicationField {
  return typeof value === 'string' && (APPLICATION_FIELDS as readonly string[]).includes(value);
}
/** `invalid` that names the field, so the form can mark it without echoing the value back. */
export class ApplicationFieldError extends PlatformError {
  constructor(public field: ApplicationField) { super('invalid'); }
}

/** A portfolio is a link the studio opens by hand. Parse only — the server never fetches it. */
export function portfolioHref(raw: string): string | null {
  if (raw.length > 2048 || /[\s\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    // A public DNS name: no IP literals, single-label or local hosts.
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || /\.(?:local|localhost|internal|test)$/.test(host)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/** Server-resolved gates only; `applications` already includes schema readiness. */
export async function submitCreatorApplication(sql: SqlRunner, viewer: Viewer, raw: unknown, access: { applications: boolean }) {
  demand(viewer.userId, 'sign_in_required');
  // Studio accounts review applications; they never apply to themselves.
  demand(!viewer.isAdmin, 'forbidden');
  demand(access.applications, 'not_open');
  const parsed = CreatorApplicationInput.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw isApplicationField(field) ? new ApplicationFieldError(field) : new PlatformError('invalid');
  }
  const input = parsed.data;
  const portfolio = portfolioHref(input.portfolioUrl);
  if (!portfolio) throw new ApplicationFieldError('portfolioUrl');
  const samples = new Map<string, string>();
  for (const value of input.samples) {
    if (!value) continue;
    const post = canonicalPost(value);
    if (!post) throw new ApplicationFieldError('samples');
    samples.set(post.key, post.url);
  }
  if (!samples.size) throw new ApplicationFieldError('samples');
  const mediums = [...new Set(input.mediums)];
  return sql.transaction(async (tx) => {
    await lockUser(tx, viewer.userId!);
    // A retried submission with the same request id is the same application.
    const replay = await tx.query<{ user_id: string }>('select user_id from platform_creator_applications where id=$1', [input.requestId]);
    if (replay.rows.length) { demand(replay.rows[0]!.user_id === viewer.userId, 'not_found'); return { id: input.requestId }; }
    const rate = await tx.query(`insert into platform_rate_limits(user_id,window_start,hits) values($1,date_trunc('hour',now()),1)
      on conflict(user_id,window_start) do update set hits=platform_rate_limits.hits+1 where platform_rate_limits.hits<60 returning hits`, [viewer.userId]);
    demand(rate.rows.length, 'rate_limited');
    demand(!await approvedCreator(tx, viewer.userId!), 'already_creator');
    const open = await tx.query("select id from platform_creator_applications where user_id=$1 and status='submitted'", [viewer.userId]);
    demand(!open.rows.length, 'already_open');
    const recent = await tx.query<{ n: number }>("select count(*)::int n from platform_creator_applications where user_id=$1 and created_at>now()-interval '1 day'", [viewer.userId]);
    demand(recent.rows[0]!.n < 1, 'rate_limited');
    await tx.query(`insert into platform_creator_applications(id,user_id,display_name,portfolio_url,sample_urls,mediums,tools,message)
      values($1,$2,$3,$4,$5::text[],$6::text[],$7,$8)`, [input.requestId, viewer.userId, input.displayName, portfolio, [...samples.values()], mediums, input.tools, input.message]);
    return { id: input.requestId };
  });
}

export type TemplateState = 'pending' | 'published' | 'rejected' | 'archived';
export interface WorkspaceFormat {
  id: string; title: string; medium: 'image' | 'video'; status: 'submitted' | 'accepted' | 'rejected';
  exampleUrl: string; createdAt: string; reviewNote: string | null; reviewedAt: string | null; revisionOf: string | null;
  /** Public catalog state only. Internal moderation text, price and engine stay with the studio. */
  template: { state: TemplateState; slug: string | null } | null;
}
export interface WorkspaceEarning { templateId: string; title: string; orders: number; settled: number; pending: number; creatorDue: number }
export interface CreatorWorkspace {
  onboarding: boolean;
  application: {
    id: string; status: 'submitted' | 'approved' | 'declined'; displayName: string; portfolioUrl: string;
    sampleCount: number; mediums: Array<'image' | 'video'>; decisionNote: string | null; createdAt: string; decidedAt: string | null;
  } | null;
  /** `registeredAt` is when the supplier row was first created; reapproval does not change it. */
  creator: { active: boolean; contractVersion: string; registeredAt: string } | null;
  formats: WorkspaceFormat[];
  earnings: WorkspaceEarning[];
}

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));

/**
 * Explicit allowlist. Never selects recipe, cost, fees, tax, payment keys, other users, email or
 * audit reasons. `onboarding=false` (0051 not applied) returns the older submission view.
 */
export async function loadCreatorWorkspace(sql: SqlRunner, viewer: Viewer, access: { onboarding: boolean }): Promise<CreatorWorkspace> {
  demand(viewer.userId, 'sign_in_required');
  const userId = viewer.userId;
  const application = access.onboarding
    ? (await sql.query<{ id: string; status: 'submitted' | 'approved' | 'declined'; display_name: string; portfolio_url: string; samples: number; mediums: Array<'image' | 'video'>; decision_note: string | null; created_at: unknown; decided_at: unknown }>(
        `select id,status,display_name,portfolio_url,cardinality(sample_urls)::int samples,mediums,decision_note,created_at,decided_at
           from platform_creator_applications where user_id=$1 order by created_at desc limit 1`, [userId])).rows[0] ?? null
    : null;
  const creator = (await sql.query<{ active: boolean; contract_version: string; created_at: unknown }>('select active,contract_version,created_at from platform_creators where user_id=$1', [userId])).rows[0] ?? null;
  const feedback = access.onboarding ? 'f.review_note,f.reviewed_at,f.revision_of' : 'null::text review_note,null::timestamptz reviewed_at,null::uuid revision_of';
  const formats = await sql.query<{ id: string; title: string; medium: 'image' | 'video'; status: WorkspaceFormat['status']; example_url: string; created_at: unknown; review_note: string | null; reviewed_at: unknown; revision_of: string | null; template_state: TemplateState | null; template_slug: string | null }>(
    `select f.id,f.title,f.medium,f.status,f.example_url,f.created_at,${feedback},
            p.status template_state,case when p.status='published' and p.audience='public' then p.slug end template_slug
       from platform_formats f left join prompt_items p on p.id=f.template_id
      where f.user_id=$1 order by f.created_at desc limit 50`, [userId]);
  // Live one-time orders only, the same population `settle` accepts. A refund leaves `paid`, so it drops out.
  const earnings = await sql.query<{ template_id: string; title: string; orders: number; settled: number; due: string }>(
    `select f.template_id,f.title,count(p.id)::int orders,count(s.render_id)::int settled,coalesce(sum(s.creator_due),0)::text due
       from platform_formats f
       join render_jobs j on j.template_id=f.template_id
       join billing_payments p on p.render_id=j.id and p.status='paid' and p.environment='live' and p.payment_type='NORMAL'
       left join platform_settlements s on s.payment_id=p.id and s.creator_id=f.user_id
      where f.user_id=$1 and f.status='accepted'
      group by f.template_id,f.title order by f.title`, [userId]);
  return {
    onboarding: access.onboarding,
    application: application && {
      id: application.id, status: application.status, displayName: application.display_name, portfolioUrl: application.portfolio_url,
      sampleCount: application.samples, mediums: application.mediums, decisionNote: application.decision_note,
      createdAt: iso(application.created_at), decidedAt: isoOrNull(application.decided_at),
    },
    creator: creator && { active: creator.active, contractVersion: creator.contract_version, registeredAt: iso(creator.created_at) },
    formats: formats.rows.map((row) => ({
      id: row.id, title: row.title, medium: row.medium, status: row.status, exampleUrl: row.example_url, createdAt: iso(row.created_at),
      reviewNote: row.review_note, reviewedAt: isoOrNull(row.reviewed_at), revisionOf: row.revision_of,
      template: row.template_state ? { state: row.template_state, slug: row.template_slug } : null,
    })),
    earnings: earnings.rows.map((row) => ({
      templateId: row.template_id, title: row.title, orders: row.orders, settled: row.settled,
      pending: row.orders - row.settled, creatorDue: Number(row.due),
    })),
  };
}

export interface AdminApplication {
  id: string; userId: string; displayName: string; portfolioUrl: string; sampleUrls: string[]; mediums: string[];
  tools: string; message: string; status: 'submitted' | 'approved' | 'declined'; decisionNote: string | null; createdAt: string; decidedAt: string | null;
}
/** Studio review queue. `null` when 0051 is absent so the admin page can say so instead of failing. */
export async function loadApplicationQueue(sql: SqlRunner): Promise<{ open: AdminApplication[]; decided: AdminApplication[] } | null> {
  if (!await onboardingReady(sql)) return null;
  const columns = 'id,user_id,display_name,portfolio_url,sample_urls,mediums,tools,message,status,decision_note,created_at,decided_at';
  const [open, decided] = await Promise.all([
    sql.query<Record<string, unknown>>(`select ${columns} from platform_creator_applications where status='submitted' order by created_at limit 100`),
    sql.query<Record<string, unknown>>(`select ${columns} from platform_creator_applications where status<>'submitted' order by decided_at desc limit 20`),
  ]);
  const shape = (row: Record<string, unknown>): AdminApplication => ({
    id: String(row.id), userId: String(row.user_id), displayName: String(row.display_name), portfolioUrl: String(row.portfolio_url),
    sampleUrls: row.sample_urls as string[], mediums: row.mediums as string[], tools: String(row.tools), message: String(row.message),
    status: row.status as AdminApplication['status'], decisionNote: (row.decision_note as string | null) ?? null,
    createdAt: iso(row.created_at), decidedAt: isoOrNull(row.decided_at),
  });
  return { open: open.rows.map(shape), decided: decided.rows.map(shape) };
}

/** Creator-facing notes for the admin format cards; empty on the older schema. */
export async function loadFormatReviewNotes(sql: SqlRunner, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length || !await onboardingReady(sql)) return new Map();
  const { rows } = await sql.query<{ id: string; review_note: string }>('select id,review_note from platform_formats where id=any($1::uuid[]) and review_note is not null', [ids]);
  return new Map(rows.map((row) => [row.id, row.review_note]));
}

export async function creatorApplicationCount(sql: SqlRunner): Promise<number> {
  if (!await onboardingReady(sql)) return 0;
  const { rows } = await sql.query<{ n: number }>("select count(*)::int n from platform_creator_applications where status='submitted'");
  return rows[0]?.n ?? 0;
}
