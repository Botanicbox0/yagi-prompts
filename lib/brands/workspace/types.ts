/** Explicit external projection: never serialize database rows or creator campaign DTOs. */
export type BrandRole = 'owner' | 'editor' | 'viewer';
export type BrandProjectStatus = 'requested' | 'active' | 'completed' | 'cancelled';
export type ProductionMode = 'creator' | 'studio';
export type BrandFailureCode = 'sign_in_required' | 'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'rate_limited' | 'not_active' | 'not_approved' | 'consent_required' | 'storage_unavailable' | 'not_shared';
export type BrandOutcome<T = { id: string }> = ({ ok: true } & T) | { ok: false; code: BrandFailureCode; field?: string };
export interface BrandOrganization { id: string; name: string; role: BrandRole }
export interface BrandReferenceLink { url: string; note: string }
export interface BrandCriteria {
  platforms: Array<'instagram' | 'tiktok' | 'x' | 'youtube'>; minFollowers: number | null; maxFollowers: number | null;
  primaryMetric: 'views' | 'engagement' | 'content_count'; targetValue: number | null;
}
export interface BrandProjectSummary {
  overview?: BrandHomeOverview; clientVisible?: boolean;
  /** Private route to the project's own cover image; null when the studio has not chosen one. */
  coverUrl?: string | null;
  id: string; organizationId: string; organizationName: string; title: string; objective: string;
  audience: string; budgetKrw: number | null; budgetTaxBasis: 'unspecified' | 'included' | 'excluded';
  criteria: BrandCriteria;
  startsOn: string | null; endsOn: string | null; productionMode: ProductionMode;
  status: BrandProjectStatus; revision: number; createdAt: string; updatedAt: string;
}
export interface BrandHomeContent {
  id: string; title: string; version: number; decision: BrandContentVersion['decision'];
  mediaUrl: string | null; mime: string | null; createdAt: string;
}
export interface BrandHomeOverview {
  pending: number; changes: number; published: number; contents: BrandHomeContent[];
}
export interface BrandContentVersion {
  id: string; slotKey: string; version: number; title: string; attachmentId: string; mediaUrl: string; caption: string;
  usageRights: string; reviewRevision: number; decision: 'pending' | 'approved' | 'changes_requested';
  createdAt: string;
}
export interface BrandDecision {
  id: string; contentVersionId: string; decision: 'approved' | 'changes_requested';
  comment: string; revision: number; createdAt: string;
}
export interface BrandMessage { id: string; body: string; authorRole: 'brand' | 'studio'; createdAt: string }
export interface BrandAttachment { id: string; name: string; mime: string; sizeBytes: number; createdAt: string }
export interface BrandPost {
  id: string; url: string; platform: 'instagram' | 'tiktok' | 'x' | 'youtube';
  /**
   * `approved_content`: a content version approved in this workspace, with a known publish time.
   * `external_import`: a link to a post already published elsewhere. It has no content version, was
   * never approved here, and its publish time is null until it is actually known.
   */
  origin: 'approved_content' | 'external_import';
  contentVersionId: string | null; publishedAt: string | null; metricRevision: number;
  verification: 'unverified' | 'manual'; metricsSource: 'unavailable' | 'creator_evidence' | 'studio_review';
  measuredAt: string | null; views: number | null;
  /** `views` was read from a publicly rounded display ("12.3K"). Never true without a view count. */
  viewsApproximate: boolean;
  likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; createdAt: string;
  presentation: BrandPostPresentation;
}
/**
 * How a post is recognized on the campaign page, set by the studio only. Never metrics: editing it does
 * not touch `metricRevision` or measurement history. Every field may be unknown (null), never guessed.
 */
export interface BrandPostPresentation {
  /** Optimistic-concurrency token for presentation edits only. */
  revision: number;
  /** Private route to one of this project's own ready images; re-authorized on every read. */
  thumbnailUrl: string | null;
  /** Account handle without '@'. */
  handle: string | null; displayName: string | null;
  /** Unknown is null, never 0. A known count always has `followersSource` and `followersMeasuredAt`. */
  followers: number | null; followersApproximate: boolean;
  followersSource: 'creator_evidence' | 'studio_review' | null; followersMeasuredAt: string | null;
}
/** Studio console result only. `measuredAt` is the one server-side time shared by every saved row. */
export interface BrandMetricsBatchResult { id: string; saved: number; measuredAt: string }
/** Studio link import result. `existing` links were already on the campaign and were not added again. */
export interface BrandExternalPostsResult { id: string; added: number; existing: number; dated: number }
export interface BrandReportSnapshot {
  totalPosts: number; measuredPosts: number; viewsTotal: number | null;
  /** At least one summed view count was a publicly rounded display value, so the total is approximate. */
  viewsTotalApproximate: boolean;
  /** Sum of latest per-post views, never unique reach and never summed over time. */
  metricDefinition: 'sum_of_latest_post_views'; posts: BrandPost[];
}
export interface BrandReport {
  id: string; version: number; summary: string; periodStart: string; periodEnd: string;
  snapshot: BrandReportSnapshot; createdAt: string;
}
export interface BrandProjectDetail extends BrandProjectSummary {
  contracts?: BrandContract[]; contractUploads?: BrandAttachment[];
  role: BrandRole | 'studio';
  /** May post in the campaign comments. Owners, editors, the studio and guests invited to comment. */
  canComment: boolean;
  referenceLinks: BrandReferenceLink[]; contents: BrandContentVersion[];
  decisions: BrandDecision[]; messages: BrandMessage[]; attachments: BrandAttachment[];
  posts: BrandPost[]; reports: BrandReport[];
}
export interface BrandWorkspace { organizations: BrandOrganization[]; projects: BrandProjectSummary[] }
/** Owner-only team administration; deliberately separate from every project DTO. */
export interface BrandMembers {
  organization: { id: string; name: string };
  members: Array<{ id: string; userId: string; email: string | null; role: BrandRole; status: 'active' | 'revoked'; isSelf: boolean }>;
  /** `project`: a campaign-only invitation. Its title is known only once the campaign is shared with the client. */
  invitations: Array<{ id: string; email: string | null; role: 'owner' | 'editor' | 'viewer'; expiresAt: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; project: { shared: boolean; title: string | null } | null }>;
}

export interface BrandContract { id:string; documentKey:string;title:string;version:number;attachmentId:string;shared:boolean;revision:number;createdAt:string }
