import { z } from 'zod';
import { isIP } from 'node:net';

/** Link-only references: no crawling, oEmbed, server downloads or implied usage rights. */
export function normalizeBrandHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostname.includes('.') ||
      isIP(hostname.replace(/^\[|\]$/g, '')) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname) ||
      /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
export const BrandHttpsUrlSchema = z.string().trim().max(2048).refine(v => normalizeBrandHttpsUrl(v) !== null, 'Use a public HTTPS link').transform(v => normalizeBrandHttpsUrl(v)!);
const id = z.string().uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v; });
export const BrandOrganizationSchema = z.object({ name: text(2, 100), requestId: id });
export const BrandInvitationSchema = z.object({ organizationId: id, email: z.email().trim().toLowerCase().max(254), role: z.enum(['editor', 'viewer']), requestId: id });
export const BrandInvitationAcceptSchema = z.object({ token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/) });
export const BrandMemberRevokeSchema = z.object({ organizationId: id, userId: id });
export const BrandReferenceLinkSchema = z.object({ url: BrandHttpsUrlSchema, note: text(0, 500).default('') });
export const BrandCriteriaSchema = z.object({
  platforms: z.array(z.enum(['instagram', 'tiktok', 'x', 'youtube'])).max(4).transform(v => [...new Set(v)]).default([]),
  minFollowers: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  maxFollowers: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  primaryMetric: z.enum(['views', 'engagement', 'content_count']).default('views'),
  targetValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
}).refine(v => v.minFollowers === null || v.maxFollowers === null || v.maxFollowers >= v.minFollowers, { path: ['maxFollowers'], message: 'Maximum must not be less than minimum' });
export const BrandProjectSchema = z.object({
  organizationId: id, requestId: id, title: text(3, 120), objective: text(3, 2000), audience: text(0, 1000).default(''),
  budgetKrw: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  budgetTaxBasis: z.enum(['unspecified', 'included', 'excluded']).default('unspecified'),
  criteria: BrandCriteriaSchema.default({ platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null }),
  startsOn: date.nullable().default(null), endsOn: date.nullable().default(null),
  productionMode: z.enum(['creator', 'studio']), referenceLinks: z.array(BrandReferenceLinkSchema).max(10).default([]),
}).refine(v => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { path: ['endsOn'], message: 'End must follow start' });
export const BrandProjectStatusSchema = z.object({ projectId: id, expectedRevision: z.number().int().nonnegative(), status: z.enum(['active', 'completed', 'cancelled']) });
export const BrandContentSchema = z.object({
  projectId: id, requestId: id, slotKey: text(1, 60).regex(/^[a-zA-Z0-9_-]+$/), title: text(1, 120),
  attachmentId: id, caption: text(0, 4000).default(''), usageRights: text(1, 2000),
  creatorConsentConfirmed: z.boolean().default(false),
});
export const BrandDecisionSchema = z.object({
  projectId: id, contentVersionId: id, expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['approved', 'changes_requested']), comment: text(0, 2000).default(''), requestId: id,
}).refine(v => v.decision !== 'changes_requested' || v.comment.length > 0, { path: ['comment'], message: 'Describe the requested changes' });
export const BrandMessageSchema = z.object({ projectId: id, requestId: id, body: text(1, 4000) });
const metric = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null);
/** The views figure was read from a publicly rounded display ("12.3K"): kept, never presented as exact. */
const viewsApproximate = z.boolean().default(false);
const approximateNeedsViews = (v: { views: number | null; viewsApproximate: boolean }) => !v.viewsApproximate || v.views !== null;
const approximateIssue = { path: ['viewsApproximate'], message: 'Only a recorded view count can be approximate' };
export const BrandPostSchema = z.object({
  projectId: id, contentVersionId: id, requestId: id, url: BrandHttpsUrlSchema, publishedAt: z.iso.datetime({ offset: true }),
  verification: z.enum(['unverified', 'manual']).default('unverified'),
  metricsSource: z.enum(['unavailable', 'creator_evidence', 'studio_review']).default('unavailable'),
  measuredAt: z.iso.datetime({ offset: true }).nullable().default(null),
  views: metric, viewsApproximate, likes: metric, comments: metric, shares: metric, saves: metric,
}).refine(v => {
  const measured = [v.views, v.likes, v.comments, v.shares, v.saves].some(x => x !== null);
  return measured ? v.metricsSource !== 'unavailable' && v.measuredAt !== null : v.metricsSource === 'unavailable' && v.measuredAt === null;
}, { path: ['metricsSource'], message: 'Measurements need a source and collection time' }).refine(approximateNeedsViews, approximateIssue);
export const BrandPostMetricsSchema = z.object({
  projectId: id, postId: id, requestId: id, expectedRevision: z.number().int().nonnegative(),
  verification: z.enum(['unverified', 'manual']).default('unverified'),
  metricsSource: z.enum(['unavailable', 'creator_evidence', 'studio_review']).default('unavailable'),
  measuredAt: z.iso.datetime({ offset: true }).nullable().default(null),
  views: metric, viewsApproximate, likes: metric, comments: metric, shares: metric, saves: metric,
}).refine(v => {
  const measured = [v.views, v.likes, v.comments, v.shares, v.saves].some(x => x !== null);
  return measured ? v.metricsSource !== 'unavailable' && v.measuredAt !== null : v.metricsSource === 'unavailable' && v.measuredAt === null;
}, { path: ['metricsSource'], message: 'Measurements need a source and collection time' }).refine(approximateNeedsViews, approximateIssue);
/** One console save. Bounded so a single transaction never holds more than a screenful of row locks. */
export const BRAND_METRICS_BATCH_LIMIT = 50;
/**
 * Strict on purpose: the console's measurement time is the server's, so a submitted `measuredAt`
 * is refused rather than silently dropped. A row is an observation, so it carries at least one value.
 */
export const BrandPostMetricsBatchRowSchema = z.object({
  postId: id, expectedRevision: z.number().int().nonnegative(),
  verification: z.enum(['unverified', 'manual']).default('unverified'),
  metricsSource: z.enum(['creator_evidence', 'studio_review']),
  views: metric, viewsApproximate, likes: metric, comments: metric, shares: metric, saves: metric,
}).strict().refine(v => [v.views, v.likes, v.comments, v.shares, v.saves].some(x => x !== null), { path: ['views'], message: 'Enter at least one observed value' }).refine(approximateNeedsViews, approximateIssue);
export const BrandPostMetricsBatchSchema = z.object({
  projectId: id, requestId: id, rows: z.array(BrandPostMetricsBatchRowSchema).min(1).max(BRAND_METRICS_BATCH_LIMIT),
}).strict().refine(v => new Set(v.rows.map(r => r.postId)).size === v.rows.length, { path: ['rows'], message: 'A post may appear once per save' });
/**
 * Links to posts that were already published outside this workspace. They are appended as they are:
 * no content version, no approval, no counts. A publish time is optional and stays unknown when absent.
 */
export const BRAND_EXTERNAL_POSTS_LIMIT = 50;
export const BrandExternalPostsSchema = z.object({
  projectId: id, requestId: id,
  verification: z.enum(['unverified', 'manual']).default('unverified'),
  posts: z.array(z.object({ url: BrandHttpsUrlSchema, publishedAt: z.iso.datetime({ offset: true }).nullable().default(null) }).strict())
    .min(1).max(BRAND_EXTERNAL_POSTS_LIMIT),
}).strict();
/** Covers are images only; video and PDF stay ordinary files. */
export const BRAND_COVER_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const BrandProjectCoverSchema = z.object({ projectId: id, attachmentId: id.nullable(), expectedRevision: z.number().int().nonnegative() });
/**
 * Studio-only presentation of one post. `null` (or blank) is unknown; nothing here is a metric. A
 * follower count is an observation: it needs where it was read and when, like any other count.
 */
export const BRAND_POST_HANDLE_PATTERN = /^[\p{L}\p{N}._-]{1,50}$/u;
export const BrandPostPresentationSchema = z.object({
  projectId: id, postId: id, expectedRevision: z.number().int().nonnegative(),
  thumbnailAttachmentId: id.nullable().default(null),
  handle: z.string().trim().transform(v => v.replace(/^@/, '')).pipe(z.string().regex(BRAND_POST_HANDLE_PATTERN)).nullable().default(null),
  displayName: text(1, 80).nullable().default(null),
  followers: z.number().int().min(0).max(10_000_000_000).nullable().default(null),
  followersApproximate: z.boolean().default(false),
  followersSource: z.enum(['creator_evidence', 'studio_review']).nullable().default(null),
  followersMeasuredAt: z.iso.datetime({ offset: true }).nullable().default(null),
}).strict().refine(v => v.followers === null
  ? !v.followersApproximate && v.followersSource === null && v.followersMeasuredAt === null
  : v.followersSource !== null && v.followersMeasuredAt !== null,
{ path: ['followersMeasuredAt'], message: 'A follower count needs a source and the time it was read' });
export const BrandReportSchema =z.object({ projectId: id, requestId: id, summary: text(1, 4000), periodStart: date, periodEnd: date })
  .refine(v => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'End must follow start' });
export const BRAND_ATTACHMENT_LIMITS = {
  'image/jpeg': 15 * 1024 * 1024, 'image/png': 15 * 1024 * 1024, 'image/webp': 15 * 1024 * 1024,
  'video/mp4': 50_000_000, 'video/webm': 50_000_000, 'application/pdf': 20 * 1024 * 1024,
} as const;
export type BrandAttachmentMime = keyof typeof BRAND_ATTACHMENT_LIMITS;
export const BrandAttachmentSchema = z.object({
  purpose: z.enum(['workspace','contract']).default('workspace'),
  projectId: id, requestId: id, name: text(1, 160).refine(v => !/[\\/<>:"|?*]/.test(v)),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf']),
  sizeBytes: z.number().int().positive(),
}).refine(v=>v.purpose!=='contract'||v.mime==='application/pdf',{path:['mime']}).refine(v => v.sizeBytes <= BRAND_ATTACHMENT_LIMITS[v.mime], { path: ['sizeBytes'], message: 'File exceeds the format limit' });

/** Require an actual post path, not merely a social hostname/profile URL. */
export function normalizeBrandPostUrl(raw: string): { url: string; platform: 'instagram' | 'tiktok' | 'x' | 'youtube'; postId: string } | null {
  const safe = normalizeBrandHttpsUrl(raw); if (!safe) return null;
  const url = new URL(safe), host = url.hostname.replace(/^www\./, '');
  let platform: 'instagram' | 'tiktok' | 'x' | 'youtube';
  if (host === 'instagram.com' && /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) platform = 'instagram';
  else if (host === 'tiktok.com' && /^\/@[^/]+\/video\/\d+\/?$/.test(url.pathname)) platform = 'tiktok';
  else if (['x.com', 'twitter.com'].includes(host) && /^\/(?:[^/]+|i\/web)\/status\/\d+\/?$/.test(url.pathname)) { platform = 'x'; url.hostname = 'x.com'; }
  else if ((host === 'youtube.com' && ((url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '')) || /^\/shorts\/[\w-]{11}\/?$/.test(url.pathname))) || (host === 'youtu.be' && /^\/[\w-]{11}\/?$/.test(url.pathname))) platform = 'youtube';
  else return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const postId = platform === 'youtube' && url.pathname === '/watch' ? url.searchParams.get('v')! : segments.at(-1)!;
  if (platform === 'youtube') return { platform, postId, url: `https://www.youtube.com/watch?v=${postId}` };
  if (platform === 'x') return { platform, postId, url: `https://x.com/i/web/status/${postId}` };
  if (platform === 'instagram') return { platform, postId, url: `https://www.instagram.com/p/${postId}/` };
  url.search = ''; url.hostname = 'www.tiktok.com'; url.pathname = url.pathname.replace(/\/$/, '');
  return { url: url.href, platform, postId };
}
