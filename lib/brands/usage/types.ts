/**
 * Explicit projections for brand secondary usage. Brand DTOs are built field by field and never carry
 * a creator amount, consent evidence, compensation, margin, internal refusal reason or payment key.
 */
import type { USAGE_DURATION_HINTS, USAGE_EDITS, USAGE_EXCLUSIONS, USAGE_HINTS, USAGE_INTENTS, USAGE_KINDS } from './schemas';

export type UsageFailureCode =
  | 'sign_in_required' | 'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'rate_limited' | 'not_active'
  // Studio-only detail codes (admin console). Brand operations collapse guard failures to `conflict`.
  | 'incomplete_scope' | 'subject_unpinned' | 'consent_missing' | 'terms_unavailable' | 'expired' | 'payments_closed'
  | 'unavailable' | 'amount_mismatch' | 'already_processed' | 'confirm_pending' | 'provider_mismatch' | 'payment_failed' | 'refund_failed'
  | 'non_live_payment' | 'not_payable' | 'payment_review';
export type UsageOutcome<T = { id: string }> = ({ ok: true } & T) | { ok: false; code: UsageFailureCode; field?: string };

export type UsageCaseStatus = 'inquiry' | 'scoping' | 'scope_defined' | 'quoted' | 'accepted' | 'paid' | 'fulfilled' | 'blocked_after_payment' | 'withdrawn' | 'closed';
/** What the brand is told. Internal negotiation steps collapse into `in_review`. */
export type BrandUsageState =
  | 'submitted' | 'in_review' | 'quoted' | 'quote_expired' | 'awaiting_payment' | 'payment_confirming' | 'confirming_terms'
  | 'licensed' | 'suspended' | 'needs_attention' | 'declined' | 'withdrawn' | 'closed' | 'refunded';
export type UsageGrantState = 'pending_start' | 'scheduled' | 'active' | 'expired' | 'suspended' | 'terminated';

export type UsageKind = typeof USAGE_KINDS[number];
export type UsageSubjectPin =
  | { kind: 'content_version'; contentVersionId: string; assetSha256: string; title: string }
  | { kind: 'original_post'; postId: string; url: string; platform: string; platformPostId: string }
  | { kind: 'master'; attachmentId: string; assetSha256: string; name: string };
export interface UsageScopeItem {
  itemId: string; subject: UsageSubjectPin; usageKinds: UsageKind[]; channels: string[]; territory: string[];
  advertiser: string | null; edits: typeof USAGE_EDITS[number];
  timing: { kind: 'fixed'; startsOn: string; endsOn: string } | { kind: 'first_use'; durationDays: number };
}
export interface UsageScope {
  version: 1; timeZone: string; exclusions: Array<typeof USAGE_EXCLUSIONS[number]>; excludedNote: string; items: UsageScopeItem[];
}

export interface BrandUsageSubject { itemId: string; kind: 'content_version' | 'post'; label: string | null; url: string | null; platform: string | null; origin: 'approved_content' | 'external_import' | null }
export interface BrandUsageQuote {
  id: string; revision: number; totalKrw: number; taxBasis: 'included' | 'excluded'; currency: 'KRW';
  validUntil: string; expired: boolean; note: string; status: 'open' | 'accepted' | 'superseded' | 'declined';
  scope: { timeZone: string; exclusions: string[]; excludedNote: string; items: Array<Omit<UsageScopeItem, 'subject'> & { subjectLabel: string | null; subjectPlatform: string | null; subjectKind: UsageSubjectPin['kind'] }> };
  /** A customer-shared contract document of this campaign; re-authorized by the attachment route. */
  contract: { title: string; version: number; url: string } | null;
  acceptedAt: string | null;
}
export interface BrandUsageGrant {
  id: string; itemId: string; subjectLabel: string | null; subjectPlatform: string | null; state: UsageGrantState; startsAt: string | null; endsAt: string | null; durationDays: number | null;
}
export interface BrandUsageCase {
  id: string; state: BrandUsageState; revision: number; createdAt: string; updatedAt: string;
  intent: typeof USAGE_INTENTS[number]; question: string; hints: Array<typeof USAGE_HINTS[number]> | null;
  durationHint: typeof USAGE_DURATION_HINTS[number] | null; timingText: string | null; budgetKrw: number | null;
  subjects: BrandUsageSubject[];
  messages: Array<{ id: string; body: string; authorRole: 'brand' | 'studio'; createdAt: string }>;
  /** A summary only. Never the creator's words, evidence or amount. */
  availability: 'checking' | 'confirmed' | null;
  quote: BrandUsageQuote | null;
  payment: { id: string; status: 'pending' | 'confirming' | 'paid' | 'refund_pending' | 'refunded' | 'failed' | 'expired' | 'review'; amountKrw: number } | null;
  grants: BrandUsageGrant[];
  actions: { message: boolean; withdraw: boolean; requestChanges: boolean; accept: boolean; pay: boolean };
}
export interface BrandUsageView {
  role: 'owner' | 'editor' | 'viewer' | 'studio'; buyer: boolean; paymentsOpen: boolean; cases: BrandUsageCase[];
  /** Subjects a writer may ask about: current approved content versions and every post of the campaign. */
  eligible: Array<{ kind: 'content_version' | 'post'; id: string; label: string }>;
}

/** Studio-only projection for /admin. Contains internal fields by design; never pass it to a brand page. */
export interface StudioUsageCase {
  id: string; organizationId: string; organizationName: string; projectId: string; projectTitle: string;
  status: UsageCaseStatus; revision: number; closeReason: string | null; blockedReason: string | null; createdAt: string; updatedAt: string;
  intent: string; question: string; hints: string[] | null; durationHint: string | null; timingText: string | null; budgetKrw: number | null;
  items: Array<{ id: string; position: number; kind: 'content_version' | 'post'; label: string; contentVersionId: string | null; postId: string | null; postOrigin: string | null; postUrl: string | null; postContentVersionId: string | null }>;
  messages: Array<{ id: string; body: string; authorRole: 'brand' | 'studio'; createdAt: string }>;
  scopes: Array<{ id: string; revision: number; sha256: string; scope: UsageScope; createdAt: string }>;
  compensations: Array<{ id: string; scopeRevisionId: string; revision: number; amountKrw: number; taxBasis: string; note: string; createdAt: string }>;
  consents: Array<{ id: string; itemId: string; scopeRevisionId: string; scopeSha256: string; compensationId: string; approverKind: string; approvedAt: string; evidenceReference: string; rightsChecks: string[]; withdrawnAt: string | null; createdAt: string }>;
  quotes: Array<{ id: string; revision: number; scopeRevisionId: string; totalKrw: number; taxBasis: string; validUntil: string; expired: boolean; status: string; contractId: string; note: string; acceptedAt: string | null; createdAt: string }>;
  payments: Array<{ id: string; quoteId: string; status: string; amountKrw: number; environment: string; failureCode: string | null; createdAt: string; approvedAt: string | null; refundedAt: string | null }>;
  grants: Array<{ id: string; itemId: string; state: UsageGrantState; startsAt: string | null; endsAt: string | null; durationDays: number | null; events: Array<{ kind: string; reason: string; createdAt: string }> }>;
  events: Array<{ kind: string; actor: string; createdAt: string }>;
  contracts: Array<{ id: string; title: string; version: number; shared: boolean }>;
  masters: Array<{ id: string; name: string; mime: string }>;
  buyers: Array<{ userId: string; email: string; role: string | null }>;
  members: Array<{ userId: string; email: string; role: string }>;
}
export interface StudioUsageQueueRow { id: string; organizationName: string; projectId: string; projectTitle: string; status: UsageCaseStatus; updatedAt: string; subjects: number }
