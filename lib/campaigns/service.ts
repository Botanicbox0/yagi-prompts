import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  ApplicationLocked,
  countRecentApplicationWrites,
  loadApplication,
  loadApplicationsByCreator,
  loadCampaignById,
  loadCampaignsByIds,
  loadCampaignBySlug,
  loadCampaignCounts,
  recordApplicationWrite,
  reportViews,
  submitPost,
  upsertApplication,
  type ApplicationRow,
  type CampaignRow,
} from './repo';
import {
  APPLICATION_WRITES_PER_DAY,
  ApplySchema,
  MetricsSchema,
  PostSchema,
  isApplyField,
  platformOfUrl,
  type ApplyField,
} from './schemas';
import { acceptsApplications, acceptsPosts, isCampaignPublic } from './state';
import { toCampaignCard, type CampaignCard } from './catalog';
import { loadProfileSnsUrl, saveProfileSnsUrl } from '@/lib/contests/repo';
import { loadCreatorProduction, loadCreatorProductions, type CreatorProduction } from './production';
import { normalizeBrandPostUrl } from '@/lib/brands/workspace/schemas';

/** A creator receives their participation terms, never the brand's internal budget row. */
export type CreatorCampaign = CampaignCard & Pick<CampaignRow, 'payout'>;
function creatorCampaign(row: CampaignRow, slotsTaken = 0): CreatorCampaign {
  return { ...toCampaignCard(row, slotsTaken), payout: row.payout };
}

/**
 * The creator's three moves — apply, submit the post link, report the seven-day views — as one
 * injectable service, on the shape `lib/contests/submit.ts` established: the server action is a
 * thin wrapper, every decision is here, and nothing is trusted from the form except the fields a
 * creator owns. The status, the campaign and the creator id are all supplied by the server.
 */

export interface CampaignServiceDeps {
  sql: SqlRunner;
  now?: Date | number;
}

const RATE_WINDOW_HOURS = 24;

export type ApplyFailure =
  | { code: 'sign_in_required' }
  | { code: 'not_found' }
  | { code: 'not_open' }
  | { code: 'slots_full' }
  | { code: 'locked' }
  | { code: 'invalid'; detail: string; field?: ApplyField }
  | { code: 'rate_limited' };

export type ApplyOutcome = { ok: true; id: string; resubmitted: boolean } | ({ ok: false } & ApplyFailure);

export interface ApplyInputRaw {
  pitch: string;
  snsUrl: string;
  followerCount: string;
  consent: boolean;
  rememberSns?: boolean;
}

export interface ApplyState {
  campaign: CreatorCampaign;
  existing: ApplicationRow | null;
  open: boolean;
  slotsLeft: number;
  snsPrefill: string | null;
}

/** The apply page's state: a public campaign, the viewer's own row if any, and whether the door is open. */
export async function loadApplyState(deps: CampaignServiceDeps, slug: string, userId: string | null): Promise<ApplyState | null> {
  const campaign = await loadCampaignBySlug(deps.sql, slug);
  if (campaign === null || !isCampaignPublic(campaign.status)) return null;
  const existing = userId === null ? null : await loadApplication(deps.sql, campaign.id, userId);
  const snsPrefill = userId === null ? null : existing?.snsUrl ?? await loadProfileSnsUrl(deps.sql, userId);
  const counts = await loadCampaignCounts(deps.sql, [campaign.id]);
  const taken = counts.get(campaign.id)?.slotsTaken ?? 0;
  return {
    campaign: creatorCampaign(campaign, taken),
    existing,
    open: acceptsApplications(campaign, deps.now ?? Date.now()),
    slotsLeft: Math.max(0, campaign.slots - taken),
    snsPrefill,
  };
}

export async function applyToCampaign(
  deps: CampaignServiceDeps,
  viewer: Viewer,
  slug: string,
  input: ApplyInputRaw,
): Promise<ApplyOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const userId = viewer.userId;

  const followers = Number.parseInt(input.followerCount.replace(/[,\s]/g, ''), 10);
  const parsed = ApplySchema.safeParse({
    pitch: input.pitch,
    snsUrl: input.snsUrl,
    followerCount: Number.isFinite(followers) ? followers : -1,
    consent: input.consent === true ? true : undefined,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    const first = parsed.error.issues[0]?.path[0];
    const field = typeof first === 'string' && isApplyField(first) ? first : null;
    return { ok: false, code: 'invalid', detail, ...(field === null ? {} : { field }) };
  }

  const state = await loadApplyState(deps, slug, userId);
  if (state === null) return { ok: false, code: 'not_found' };
  if (!state.open) return { ok: false, code: 'not_open' };
  // A creator who already holds a slot cannot rewrite their pitch; a fresh applicant needs a slot.
  if (state.existing !== null && state.existing.status !== 'applied') return { ok: false, code: 'locked' };
  if (state.existing === null && state.slotsLeft === 0) return { ok: false, code: 'slots_full' };

  const recent = await countRecentApplicationWrites(deps.sql, userId, RATE_WINDOW_HOURS);
  if (recent >= APPLICATION_WRITES_PER_DAY) return { ok: false, code: 'rate_limited' };

  try {
    const { id, created } = await deps.sql.transaction(async tx => {
      const application = await upsertApplication(tx, {
        campaignId: state.campaign.id,
        creatorId: userId,
        pitch: parsed.data.pitch,
        snsUrl: parsed.data.snsUrl,
        followerCount: parsed.data.followerCount,
      });
      await recordApplicationWrite(tx, userId, state.campaign.id);
      if (input.rememberSns === true) await saveProfileSnsUrl(tx, userId, parsed.data.snsUrl);
      return application;
    });
    return { ok: true, id, resubmitted: !created };
  } catch (error) {
    if (error instanceof ApplicationLocked) return { ok: false, code: 'locked' };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// the post link
// ---------------------------------------------------------------------------

export type PostFailure =
  | { code: 'sign_in_required' }
  | { code: 'not_found' }
  | { code: 'not_selected' }
  | { code: 'not_open' }
  | { code: 'wrong_platform' }
  | { code: 'production_required' }
  | { code: 'invalid'; detail: string };

export type PostOutcome = { ok: true } | ({ ok: false } & PostFailure);

export async function submitCampaignPost(
  deps: CampaignServiceDeps,
  viewer: Viewer,
  applicationId: string,
  input: { postUrl: string },
): Promise<PostOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const parsed = PostSchema.safeParse({ postUrl: input.postUrl });
  if (!parsed.success) {
    return { ok: false, code: 'invalid', detail: parsed.error.issues[0]?.message ?? 'invalid link' };
  }
  const mine = (await loadApplicationsByCreator(deps.sql, viewer.userId)).find((a) => a.id === applicationId) ?? null;
  if (mine === null) return { ok: false, code: 'not_found' };
  if (mine.status !== 'selected' && mine.status !== 'rejected') return { ok: false, code: 'not_selected' };
  const campaign = await loadCampaignById(deps.sql, mine.campaignId);
  if (campaign === null) return { ok: false, code: 'not_found' };
  if (!acceptsPosts(campaign, deps.now ?? Date.now())) return { ok: false, code: 'not_open' };
  const production = await loadCreatorProduction(deps.sql, viewer.userId, mine.id, new Date(deps.now ?? Date.now()));
  if (production?.requiresProduction && production.job?.status !== 'succeeded') return { ok: false, code: 'production_required' };
  if (production?.requiresProduction && !normalizeBrandPostUrl(parsed.data.postUrl)) return { ok: false, code: 'invalid', detail: 'A full HTTPS post URL is required.' };
  // The link must belong to one of the platforms the brief named — checked by host, before a
  // reviewer ever opens it.
  const platform = platformOfUrl(parsed.data.postUrl);
  if (platform === null || !campaign.platforms.includes(platform)) return { ok: false, code: 'wrong_platform' };
  const moved = await submitPost(deps.sql, mine.id, { postUrl: parsed.data.postUrl, postPlatform: platform });
  return moved ? { ok: true } : { ok: false, code: 'not_selected' };
}

// ---------------------------------------------------------------------------
// the seven-day number
// ---------------------------------------------------------------------------

export type ViewsOutcome = { ok: true } | { ok: false; code: 'sign_in_required' | 'not_found' | 'not_posted' | 'invalid' };

export async function reportCampaignViews(
  deps: CampaignServiceDeps,
  viewer: Viewer,
  applicationId: string,
  input: { views: string },
): Promise<ViewsOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const views = Number.parseInt(input.views.replace(/[,\s]/g, ''), 10);
  const parsed = MetricsSchema.safeParse({ views: Number.isFinite(views) ? views : -1 });
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const mine = (await loadApplicationsByCreator(deps.sql, viewer.userId)).find((a) => a.id === applicationId) ?? null;
  if (mine === null) return { ok: false, code: 'not_found' };
  if (mine.status !== 'posted' && mine.status !== 'verified') return { ok: false, code: 'not_posted' };
  const saved = await reportViews(deps.sql, mine.id, parsed.data.views);
  return saved ? { ok: true } : { ok: false, code: 'not_posted' };
}

// ---------------------------------------------------------------------------
// my campaigns
// ---------------------------------------------------------------------------

export interface MyCampaign {
  production: CreatorProduction | null;
  application: ApplicationRow;
  campaign: CreatorCampaign;
  canPost: boolean;
  canReportViews: boolean;
}

export async function loadMyCampaigns(deps: CampaignServiceDeps, userId: string): Promise<MyCampaign[]> {
  const applications = await loadApplicationsByCreator(deps.sql, userId);
  const now = deps.now ?? Date.now();
  const out: MyCampaign[] = [];
  const rows = await loadCampaignsByIds(deps.sql, [...new Set(applications.map(a => a.campaignId))]);
  const campaigns = new Map(rows.map(c => [c.id, c]));
  const production = await loadCreatorProductions(deps.sql, userId, applications.map(a => a.id), new Date(now));
  for (const application of applications) {
    const campaign = campaigns.get(application.campaignId);
    if (!campaign) continue;
    out.push({
      production: production.get(application.id) ?? null,
      application,
      campaign: creatorCampaign(campaign),
      canPost: (application.status === 'selected' || application.status === 'rejected') && acceptsPosts(campaign, now) && (!production.get(application.id)?.requiresProduction || production.get(application.id)?.job?.status === 'succeeded'),
      canReportViews: application.status === 'posted' || application.status === 'verified',
    });
  }
  return out;
}
