/** Explicit external projection: never serialize database rows or creator campaign DTOs. */
export type BrandRole = 'owner' | 'editor' | 'viewer';
export type BrandProjectStatus = 'requested' | 'active' | 'completed' | 'cancelled';
export type ProductionMode = 'creator' | 'studio';
export type BrandFailureCode = 'sign_in_required' | 'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'rate_limited' | 'not_active' | 'not_approved' | 'consent_required' | 'storage_unavailable';
export type BrandOutcome<T = { id: string }> = ({ ok: true } & T) | { ok: false; code: BrandFailureCode; field?: string };
export interface BrandOrganization { id: string; name: string; role: BrandRole }
export interface BrandReferenceLink { url: string; note: string }
export interface BrandCriteria {
  platforms: Array<'instagram' | 'tiktok' | 'x' | 'youtube'>; minFollowers: number | null; maxFollowers: number | null;
  primaryMetric: 'views' | 'engagement' | 'content_count'; targetValue: number | null;
}
export interface BrandProjectSummary {
  overview?: BrandHomeOverview; clientVisible?: boolean;
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
  id: string; contentVersionId: string; url: string; platform: 'instagram' | 'tiktok' | 'x' | 'youtube';
  publishedAt: string; metricRevision: number;
  verification: 'unverified' | 'manual'; metricsSource: 'unavailable' | 'creator_evidence' | 'studio_review';
  measuredAt: string | null; views: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; createdAt: string;
}
export interface BrandReportSnapshot {
  totalPosts: number; measuredPosts: number; viewsTotal: number | null;
  /** Sum of latest per-post views, never unique reach and never summed over time. */
  metricDefinition: 'sum_of_latest_post_views'; posts: BrandPost[];
}
export interface BrandReport {
  id: string; version: number; summary: string; periodStart: string; periodEnd: string;
  snapshot: BrandReportSnapshot; createdAt: string;
}
export interface BrandProjectDetail extends BrandProjectSummary {
  contracts?: BrandContract[]; contractUploads?: BrandAttachment[];
  role: BrandRole | 'studio'; referenceLinks: BrandReferenceLink[]; contents: BrandContentVersion[];
  decisions: BrandDecision[]; messages: BrandMessage[]; attachments: BrandAttachment[];
  posts: BrandPost[]; reports: BrandReport[];
}
export interface BrandWorkspace { organizations: BrandOrganization[]; projects: BrandProjectSummary[] }
/** Owner-only team administration; deliberately separate from every project DTO. */
export interface BrandMembers {
  organization: { id: string; name: string };
  members: Array<{ id: string; userId: string; email: string | null; role: BrandRole; status: 'active' | 'revoked'; isSelf: boolean }>;
  invitations: Array<{ id: string; email: string; role: 'editor' | 'viewer'; expiresAt: string; status: 'pending' | 'accepted' | 'revoked' | 'expired' }>;
}

export interface BrandContract { id:string; documentKey:string;title:string;version:number;attachmentId:string;shared:boolean;revision:number;createdAt:string }
