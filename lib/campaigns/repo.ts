import type { SqlRunner } from '@/lib/db/sql-runner';
import type { HostKind } from '@/lib/contests/schemas';
import {
  parsePayoutRule,
  parseRequirements,
  type ApplicationStatus,
  type CampaignLocalized,
  type CampaignPlatform,
  type CampaignStatus,
  type Deliverable,
  type PayoutRule,
  type Requirements,
} from './schemas';

/**
 * Campaigns — the database boundary (docs/CAMPAIGNS.md §5).
 *
 * Same doctrine as `lib/contests/repo.ts`: one column list per table spelled once, rows mapped to
 * camelCase with jsonb parsed through zod (a malformed payout rule becomes `null`, which the
 * publish gate refuses, rather than a crash on the listing), and an optimistic-concurrency token
 * (`version` = `updated_at` at microsecond precision) on the rows the moderation forms carry.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

export interface CampaignRow {
  id: string;
  slug: string;
  status: CampaignStatus;
  title: CampaignLocalized;
  summary: CampaignLocalized;
  brief: CampaignLocalized | null;
  hostName: string;
  hostKind: HostKind;
  hostUrl: string | null;
  media: unknown;
  styleSlug: string | null;
  platforms: CampaignPlatform[];
  deliverable: Deliverable;
  slots: number;
  applicationsCloseAt: string | null;
  postDeadlineAt: string | null;
  payout: PayoutRule | null;
  requirements: Requirements;
  budgetCents: number | null;
  createdAt: string | null;
  publishedAt: string | null;
}

export interface ApplicationRow {
  id: string;
  campaignId: string;
  creatorId: string;
  status: ApplicationStatus;
  pitch: string;
  snsUrl: string;
  followerCount: number;
  selectedAt: string | null;
  postUrl: string | null;
  postPlatform: CampaignPlatform | null;
  postedAt: string | null;
  verifiedAt: string | null;
  holdUntil: string | null;
  viewsSnapshot: number | null;
  metricsSource: 'self' | 'admin' | 'api' | null;
  payoutCents: number | null;
  paidAt: string | null;
  payoutRef: string | null;
  rejectReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** `updated_at` at microsecond precision — the moderation forms' concurrency token. */
  version: string;
}

/** Per-campaign counters for the admin board and the public "N of M slots" line. */
export interface CampaignCounts {
  applied: number;
  selected: number;
  posted: number;
  verified: number;
  paid: number;
  /** selected + posted + verified + rejected + paid — the slots in use. */
  slotsTaken: number;
}

interface RawCampaign {
  id: string;
  slug: string;
  status: CampaignStatus;
  title: CampaignLocalized;
  summary: CampaignLocalized;
  brief: CampaignLocalized | null;
  host_name: string;
  host_kind: string;
  host_url: string | null;
  media: unknown;
  style_slug: string | null;
  platforms: string[] | null;
  deliverable: string;
  slots: number;
  applications_close_at: Date | string | null;
  post_deadline_at: Date | string | null;
  payout: unknown;
  requirements: unknown;
  budget_cents: number | string | null;
  created_at: Date | string | null;
  published_at: Date | string | null;
}

interface RawApplication {
  id: string;
  campaign_id: string;
  creator_id: string;
  status: ApplicationStatus;
  pitch: string;
  sns_url: string;
  follower_count: number;
  selected_at: Date | string | null;
  post_url: string | null;
  post_platform: string | null;
  posted_at: Date | string | null;
  verified_at: Date | string | null;
  hold_until: Date | string | null;
  views_snapshot: number | string | null;
  metrics_source: string | null;
  payout_cents: number | string | null;
  paid_at: Date | string | null;
  payout_ref: string | null;
  reject_reason: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  version: string;
}

const CAMPAIGN_COLUMNS = `id, slug, status, title, summary, brief, host_name, host_kind, host_url, media,
                          style_slug, platforms, deliverable, slots, applications_close_at, post_deadline_at,
                          payout, requirements, budget_cents, created_at, published_at`;

const VERSION_EXPR = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const APPLICATION_COLUMNS = `id, campaign_id, creator_id, status, pitch, sns_url, follower_count, selected_at,
                             post_url, post_platform, posted_at, verified_at, hold_until, views_snapshot,
                             metrics_source, payout_cents, paid_at, payout_ref, reject_reason,
                             created_at, updated_at, ${VERSION_EXPR} as version`;

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toInt(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : null;
}

const HOST_KINDS: readonly string[] = ['brand', 'platform', 'studio', 'creator', 'community'];
const PLATFORMS: readonly string[] = ['instagram', 'tiktok', 'youtube'];
const DELIVERABLES: readonly string[] = ['reel', 'feed', 'story', 'short', 'video'];

function toCampaign(raw: RawCampaign): CampaignRow {
  return {
    id: raw.id,
    slug: raw.slug,
    status: raw.status,
    title: raw.title,
    summary: raw.summary,
    brief: raw.brief,
    hostName: raw.host_name,
    hostKind: (HOST_KINDS.includes(raw.host_kind) ? raw.host_kind : 'brand') as HostKind,
    hostUrl: raw.host_url,
    media: raw.media,
    styleSlug: raw.style_slug,
    platforms: (raw.platforms ?? []).filter((p): p is CampaignPlatform => PLATFORMS.includes(p)),
    deliverable: (DELIVERABLES.includes(raw.deliverable) ? raw.deliverable : 'reel') as Deliverable,
    slots: raw.slots,
    applicationsCloseAt: toIso(raw.applications_close_at),
    postDeadlineAt: toIso(raw.post_deadline_at),
    payout: parsePayoutRule(raw.payout),
    requirements: parseRequirements(raw.requirements),
    budgetCents: toInt(raw.budget_cents),
    createdAt: toIso(raw.created_at),
    publishedAt: toIso(raw.published_at),
  };
}

function toApplication(raw: RawApplication): ApplicationRow {
  return {
    id: raw.id,
    campaignId: raw.campaign_id,
    creatorId: raw.creator_id,
    status: raw.status,
    pitch: raw.pitch,
    snsUrl: raw.sns_url,
    followerCount: raw.follower_count,
    selectedAt: toIso(raw.selected_at),
    postUrl: raw.post_url,
    postPlatform: PLATFORMS.includes(raw.post_platform ?? '') ? (raw.post_platform as CampaignPlatform) : null,
    postedAt: toIso(raw.posted_at),
    verifiedAt: toIso(raw.verified_at),
    holdUntil: toIso(raw.hold_until),
    viewsSnapshot: toInt(raw.views_snapshot),
    metricsSource:
      raw.metrics_source === 'self' || raw.metrics_source === 'admin' || raw.metrics_source === 'api'
        ? raw.metrics_source
        : null,
    payoutCents: toInt(raw.payout_cents),
    paidAt: toIso(raw.paid_at),
    payoutRef: raw.payout_ref,
    rejectReason: raw.reject_reason,
    createdAt: toIso(raw.created_at),
    updatedAt: toIso(raw.updated_at),
    version: raw.version,
  };
}

// ---------------------------------------------------------------------------
// campaigns — reads
// ---------------------------------------------------------------------------

/** The public listing: recruiting first, soonest application deadline first. */
export async function loadPublicCampaigns(sql: SqlRunner): Promise<CampaignRow[]> {
  const { rows } = await sql.query<RawCampaign>(
    `select ${CAMPAIGN_COLUMNS} from campaigns
      where status in ('recruiting','selecting','running')
      order by (status = 'recruiting') desc, applications_close_at asc nulls last, slug asc`,
  );
  return rows.map(toCampaign);
}

/** By slug, whatever the status — the caller decides what a draft means. */
export async function loadCampaignBySlug(sql: SqlRunner, slug: string): Promise<CampaignRow | null> {
  const { rows } = await sql.query<RawCampaign>(`select ${CAMPAIGN_COLUMNS} from campaigns where slug = $1`, [slug]);
  return rows[0] ? toCampaign(rows[0]) : null;
}

export async function loadCampaignById(sql: SqlRunner, id: string): Promise<CampaignRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await sql.query<RawCampaign>(`select ${CAMPAIGN_COLUMNS} from campaigns where id = $1`, [id]);
  return rows[0] ? toCampaign(rows[0]) : null;
}

/** The admin board: drafts first, then the live ones, then newest. */
export async function loadAllCampaigns(sql: SqlRunner): Promise<CampaignRow[]> {
  const { rows } = await sql.query<RawCampaign>(
    `select ${CAMPAIGN_COLUMNS} from campaigns
      order by (status = 'draft') desc,
               (status in ('recruiting','selecting','running')) desc,
               coalesce(published_at, created_at) desc, slug asc`,
  );
  return rows.map(toCampaign);
}

export async function campaignSlugExists(sql: SqlRunner, slug: string, exceptId?: string): Promise<boolean> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from campaigns where slug = $1 and ($2::uuid is null or id <> $2)`,
    [slug, exceptId ?? null],
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function loadCampaignCounts(sql: SqlRunner, campaignIds: string[]): Promise<Map<string, CampaignCounts>> {
  const counts = new Map<string, CampaignCounts>();
  if (campaignIds.length === 0) return counts;
  const { rows } = await sql.query<{ campaign_id: string; status: ApplicationStatus; n: number }>(
    `select campaign_id, status, count(*)::int as n
       from campaign_applications
      where campaign_id = any($1::uuid[])
      group by campaign_id, status`,
    [campaignIds],
  );
  for (const id of campaignIds) counts.set(id, { applied: 0, selected: 0, posted: 0, verified: 0, paid: 0, slotsTaken: 0 });
  for (const row of rows) {
    const c = counts.get(row.campaign_id);
    if (!c) continue;
    if (row.status === 'applied') c.applied += row.n;
    if (row.status === 'selected') c.selected += row.n;
    if (row.status === 'posted') c.posted += row.n;
    if (row.status === 'verified') c.verified += row.n;
    if (row.status === 'paid') c.paid += row.n;
    if (['selected', 'posted', 'verified', 'rejected', 'paid'].includes(row.status)) c.slotsTaken += row.n;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// campaigns — writes
// ---------------------------------------------------------------------------

export interface CampaignWriteArgs {
  slug: string;
  title: CampaignLocalized;
  summary: CampaignLocalized;
  brief: CampaignLocalized | null;
  hostName: string;
  hostKind: HostKind;
  hostUrl: string | null;
  styleSlug: string | null;
  platforms: CampaignPlatform[];
  deliverable: Deliverable;
  slots: number;
  applicationsCloseAt: string | null;
  postDeadlineAt: string | null;
  payout: PayoutRule;
  requirements: Requirements;
  budgetCents: number | null;
}

export async function insertCampaign(sql: SqlRunner, args: CampaignWriteArgs & { id: string }): Promise<void> {
  await sql.query(
    `insert into campaigns
       (id, slug, status, title, summary, brief, host_name, host_kind, host_url, style_slug, platforms,
        deliverable, slots, applications_close_at, post_deadline_at, payout, requirements, budget_cents)
     values ($1, $2, 'draft', $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10::text[],
             $11, $12, $13::timestamptz, $14::timestamptz, $15::jsonb, $16::jsonb, $17)`,
    [
      args.id,
      args.slug,
      JSON.stringify(args.title),
      JSON.stringify(args.summary),
      args.brief === null ? null : JSON.stringify(args.brief),
      args.hostName,
      args.hostKind,
      args.hostUrl,
      args.styleSlug,
      args.platforms,
      args.deliverable,
      args.slots,
      args.applicationsCloseAt,
      args.postDeadlineAt,
      JSON.stringify(args.payout),
      JSON.stringify(args.requirements),
      args.budgetCents,
    ],
  );
}

export async function updateCampaign(sql: SqlRunner, id: string, args: CampaignWriteArgs): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update campaigns
        set slug = $2, title = $3::jsonb, summary = $4::jsonb, brief = $5::jsonb, host_name = $6, host_kind = $7,
            host_url = $8, style_slug = $9, platforms = $10::text[], deliverable = $11, slots = $12,
            applications_close_at = $13::timestamptz, post_deadline_at = $14::timestamptz,
            payout = $15::jsonb, requirements = $16::jsonb, budget_cents = $17
      where id = $1
      returning id`,
    [
      id,
      args.slug,
      JSON.stringify(args.title),
      JSON.stringify(args.summary),
      args.brief === null ? null : JSON.stringify(args.brief),
      args.hostName,
      args.hostKind,
      args.hostUrl,
      args.styleSlug,
      args.platforms,
      args.deliverable,
      args.slots,
      args.applicationsCloseAt,
      args.postDeadlineAt,
      JSON.stringify(args.payout),
      JSON.stringify(args.requirements),
      args.budgetCents,
    ],
  );
  return rows.length > 0;
}

/**
 * Status changes go through here and nowhere else. `published_at` is stamped the first time a
 * campaign leaves draft; the CHECKs in 0013 refuse a public status without dates, payout, localized
 * copy and a servable poster — the TypeScript gate (`recruitBlockers`) runs first so the admin gets
 * a sentence, and the database stays the thing that is actually true.
 */
export async function setCampaignStatus(sql: SqlRunner, id: string, status: CampaignStatus): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update campaigns
        set status = $2,
            published_at = case when $2 in ('draft','archived') then published_at else coalesce(published_at, now()) end
      where id = $1
      returning id`,
    [id, status],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// applications
// ---------------------------------------------------------------------------

export async function loadApplicationsForCampaign(sql: SqlRunner, campaignId: string): Promise<ApplicationRow[]> {
  const { rows } = await sql.query<RawApplication>(
    `select ${APPLICATION_COLUMNS} from campaign_applications
      where campaign_id = $1
      order by (status = 'applied') desc, (status = 'posted') desc, created_at asc`,
    [campaignId],
  );
  return rows.map(toApplication);
}

export async function loadApplicationsByCreator(sql: SqlRunner, creatorId: string): Promise<ApplicationRow[]> {
  const { rows } = await sql.query<RawApplication>(
    `select ${APPLICATION_COLUMNS} from campaign_applications
      where creator_id = $1 order by created_at desc`,
    [creatorId],
  );
  return rows.map(toApplication);
}

export async function loadApplication(sql: SqlRunner, campaignId: string, creatorId: string): Promise<ApplicationRow | null> {
  const { rows } = await sql.query<RawApplication>(
    `select ${APPLICATION_COLUMNS} from campaign_applications where campaign_id = $1 and creator_id = $2`,
    [campaignId, creatorId],
  );
  return rows[0] ? toApplication(rows[0]) : null;
}

export async function loadApplicationById(sql: SqlRunner, id: string): Promise<ApplicationRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await sql.query<RawApplication>(
    `select ${APPLICATION_COLUMNS} from campaign_applications where id = $1`,
    [id],
  );
  return rows[0] ? toApplication(rows[0]) : null;
}

/** The payout queue across every campaign: verified, hold ended, oldest first. */
export async function loadPayoutQueue(sql: SqlRunner, now: Date): Promise<ApplicationRow[]> {
  const { rows } = await sql.query<RawApplication>(
    `select ${APPLICATION_COLUMNS} from campaign_applications
      where status = 'verified' and hold_until <= $1::timestamptz
      order by hold_until asc`,
    [now.toISOString()],
  );
  return rows.map(toApplication);
}

export interface ApplyArgs {
  campaignId: string;
  creatorId: string;
  pitch: string;
  snsUrl: string;
  followerCount: number;
}

/**
 * One application per creator per campaign. A second submission while still `applied` REPLACES the
 * pitch (the same "resubmit while open replaces" rule as contest entries); once selected or beyond,
 * the row is the creator's record and the apply form is not offered.
 */
export async function upsertApplication(sql: SqlRunner, args: ApplyArgs): Promise<{ id: string; created: boolean }> {
  const { rows } = await sql.query<{ id: string; created: boolean }>(
    `insert into campaign_applications (campaign_id, creator_id, pitch, sns_url, follower_count)
     values ($1, $2, $3, $4, $5)
     on conflict (campaign_id, creator_id) do update
        set pitch = excluded.pitch, sns_url = excluded.sns_url, follower_count = excluded.follower_count
      where campaign_applications.status = 'applied'
     returning id, (xmax = 0) as created`,
    [args.campaignId, args.creatorId, args.pitch, args.snsUrl, args.followerCount],
  );
  const row = rows[0];
  if (!row) throw new ApplicationLocked();
  return row;
}

export class ApplicationLocked extends Error {
  constructor() {
    super('the application is past the point where it can be rewritten');
    this.name = 'ApplicationLocked';
  }
}

/** Guarded status write: `version` must still match, or the form was stale and nothing happens. */
export async function transitionApplication(
  sql: SqlRunner,
  id: string,
  version: string,
  to: ApplicationStatus,
  patch: Partial<{
    selectedAt: string | null;
    postUrl: string | null;
    postPlatform: CampaignPlatform | null;
    postedAt: string | null;
    verifiedAt: string | null;
    holdUntil: string | null;
    viewsSnapshot: number | null;
    metricsSource: 'self' | 'admin' | 'api' | null;
    payoutCents: number | null;
    paidAt: string | null;
    payoutRef: string | null;
    rejectReason: string | null;
  }> = {},
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update campaign_applications
        set status = $3,
            selected_at   = coalesce($4::timestamptz, selected_at),
            post_url      = coalesce($5, post_url),
            post_platform = coalesce($6, post_platform),
            posted_at     = coalesce($7::timestamptz, posted_at),
            verified_at   = coalesce($8::timestamptz, verified_at),
            hold_until    = coalesce($9::timestamptz, hold_until),
            views_snapshot = coalesce($10::bigint, views_snapshot),
            metrics_source = coalesce($11, metrics_source),
            payout_cents  = coalesce($12::bigint, payout_cents),
            paid_at       = coalesce($13::timestamptz, paid_at),
            payout_ref    = coalesce($14, payout_ref),
            reject_reason = case when $3 = 'rejected' then $15 else reject_reason end
      where id = $1 and ${VERSION_EXPR} = $2
      returning id`,
    [
      id,
      version,
      to,
      patch.selectedAt ?? null,
      patch.postUrl ?? null,
      patch.postPlatform ?? null,
      patch.postedAt ?? null,
      patch.verifiedAt ?? null,
      patch.holdUntil ?? null,
      patch.viewsSnapshot ?? null,
      patch.metricsSource ?? null,
      patch.payoutCents ?? null,
      patch.paidAt ?? null,
      patch.payoutRef ?? null,
      patch.rejectReason ?? null,
    ],
  );
  return rows.length > 0;
}

/** The creator's own link submission — no version token, they own the row. */
export async function submitPost(
  sql: SqlRunner,
  id: string,
  post: { postUrl: string; postPlatform: CampaignPlatform | null },
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update campaign_applications
        set status = 'posted', post_url = $2, post_platform = $3, posted_at = now(), reject_reason = null
      where id = $1 and status in ('selected','rejected')
      returning id`,
    [id, post.postUrl, post.postPlatform],
  );
  return rows.length > 0;
}

/** The creator's seven-day number (v1 self-report); the admin confirms it when releasing the payout. */
export async function reportViews(sql: SqlRunner, id: string, views: number): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update campaign_applications
        set views_snapshot = $2, metrics_source = 'self'
      where id = $1 and status in ('posted','verified')
      returning id`,
    [id, views],
  );
  return rows.length > 0;
}

export async function countRecentApplicationWrites(sql: SqlRunner, creatorId: string, hours: number): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from campaign_application_writes
      where creator_id = $1 and created_at > now() - ($2::int * interval '1 hour')`,
    [creatorId, hours],
  );
  return rows[0]?.n ?? 0;
}

export async function recordApplicationWrite(sql: SqlRunner, creatorId: string, campaignId: string): Promise<void> {
  await sql.query(`insert into campaign_application_writes (creator_id, campaign_id) values ($1, $2)`, [
    creatorId,
    campaignId,
  ]);
}
