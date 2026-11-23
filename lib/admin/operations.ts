import { ok, type AdminContext, type AdminOutcome } from './context';
import { PLAYBOOK_OPERATIONS, type BlockDraftInput } from './playbook-operations';
import { PROMPT_OPERATIONS } from './prompt-operations';
import { ACCOUNT_DELETION_OPERATIONS } from './account-deletion-operations';
import { CONTEST_OPERATIONS } from './contest-operations';
import { CAMPAIGN_OPERATIONS } from './campaign-operations';
import { CAMPAIGN_PRODUCTION_OPERATIONS } from './campaign-production-operations';
import { BRAND_OPERATIONS } from './brand-operations';
import { BRAND_WORKSPACE_OPERATIONS } from './brand-workspace-operations';
import { BRAND_USAGE_OPERATIONS } from './brand-usage-operations';
import { BRAND_ENGINE_OPERATIONS } from './brand-engine-operations';
import { BRAND_BILLING_OPERATIONS } from './brand-billing-operations';
import { BRAND_SUBSCRIPTION_OPERATIONS } from './brand-subscription-operations';
import { BRAND_STUDIO_OPERATIONS } from './brand-studio-operations';
import { BRAND_STUDIO_REVIEW_OPERATIONS } from './brand-studio-review-operations';
import { BRAND_ROOM_MESSAGE_OPERATIONS } from './brand-room-message-operations';
import { BRAND_ROOMS_STORYBOARD_OPERATIONS } from './brand-rooms-storyboard-operations';
import { BRAND_ROOMS_REVIEW_OPERATIONS } from './brand-rooms-review-operations';
import { BRAND_PRODUCTION_OPERATIONS } from './brand-production-operations';
import { PLATFORM_OPERATIONS } from './platform-operations';
import { CAMPAIGN_RISK_OPERATIONS } from './campaign-risk-operations';
import { CAMPAIGN_COLLABORATION_OPERATIONS } from './campaign-collaboration-operations';
import { CAMPAIGN_FUNDING_OPERATIONS } from './campaign-funding-operations';
import { SOCIAL_OPERATIONS } from './social-operations';
import { LANDING_MEDIA_OPERATIONS } from './landing-media-operations';
import { RENDER_OPERATIONS } from './render-operations';
import { PAYOUT_OPERATIONS } from './payout-operations';
import { BILLING_PAYMENT_OPERATIONS } from './billing-payment-operations';
import { SUPPORT_OPERATIONS } from './support-operations';

export type { BlockDraftInput };

/**
 * PLAN §3.8 / docs/ADMIN.md §6 — every admin mutation, as one registry.
 *
 * Domain modules (`./*-operations.ts`) export `{ '<domain>.<verb>': op }` maps; this file spreads
 * them into `ADMIN_OPERATIONS` so `tests/admin/auth.test.ts` enumerates every operation automatically.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

export interface AdminOperation<T = unknown> {
  /** Every mutation writes; the dispatcher uses this to decide whether to re-read the catalog. */
  parse(form: FormData): ParseResult<T>;
  run(ctx: AdminContext, input: T): Promise<AdminOutcome>;
}

const refreshCaches: AdminOperation<Record<string, never>> = {
  parse: () => ({ ok: true, value: {} }),
  async run(ctx) {
    ctx.revalidate?.();
    ctx.revalidatePrompts?.();
    return ok('cachesRefreshed');
  },
};

export const ADMIN_OPERATIONS = {
  'caches.refresh': refreshCaches,
  ...PLAYBOOK_OPERATIONS,
  ...PROMPT_OPERATIONS,
  ...CONTEST_OPERATIONS,
  ...CAMPAIGN_OPERATIONS,
  ...CAMPAIGN_PRODUCTION_OPERATIONS,
  ...BRAND_OPERATIONS,
  ...BRAND_WORKSPACE_OPERATIONS,
  ...BRAND_USAGE_OPERATIONS,
  ...BRAND_PRODUCTION_OPERATIONS,
  // docs/BRAND-PRODUCT.md — per-brand feature policy (deny-list) and B2B plan assignment.
  ...BRAND_ENGINE_OPERATIONS,
  // docs/BRAND-PRODUCT.md §6.4 — B2B billing core (plan allowance defaults, discounts, invoices, extra credits).
  ...BRAND_BILLING_OPERATIONS,
  // docs/BRAND-RECURRING-BILLING.md §14 B1a — B2B subscription lifecycle and tax-invoice recording (behind BRAND_BILLING_AUTO_ISSUE).
  ...BRAND_SUBSCRIPTION_OPERATIONS,
  // docs/BRAND-STUDIO-V2.md §9 — the studio v2 monthly allowance and preferred lane per organization.
  ...BRAND_STUDIO_OPERATIONS,
  // docs/BRAND-STUDIO-V3.md §7 — the review space, team side: reply, resolve, status, open a review.
  ...BRAND_STUDIO_REVIEW_OPERATIONS,
  // docs/BRAND-ROOMS.md §4 — project room conversations, team side: send, pin, take down, read mark.
  ...BRAND_ROOM_MESSAGE_OPERATIONS,
  // docs/BRAND-ROOMS.md §5 — project room storyboards, team side: create, title, cuts, share, version, delete.
  ...BRAND_ROOMS_STORYBOARD_OPERATIONS,
  // docs/BRAND-ROOMS.md §6 — project room deliverables, team side: deliver a file or a new version, make or revoke a share link
  // (docs/BRAND-ROOMS-FEEDBACK.md §4: the project desk makes links as the team).
  ...BRAND_ROOMS_REVIEW_OPERATIONS,
  ...PLATFORM_OPERATIONS,
  ...CAMPAIGN_RISK_OPERATIONS,
  ...CAMPAIGN_COLLABORATION_OPERATIONS,
  ...CAMPAIGN_FUNDING_OPERATIONS,
  ...SOCIAL_OPERATIONS,
  ...LANDING_MEDIA_OPERATIONS,
  ...RENDER_OPERATIONS,
  ...PAYOUT_OPERATIONS,
  ...BILLING_PAYMENT_OPERATIONS,
  ...SUPPORT_OPERATIONS,
  // docs/RUNBOOK-deletion.md — the account deletion queue: delete now, mark done by hand, close.
  ...ACCOUNT_DELETION_OPERATIONS,
};

export type AdminOperationName = keyof typeof ADMIN_OPERATIONS;

export const ADMIN_OPERATION_NAMES = Object.keys(ADMIN_OPERATIONS) as AdminOperationName[];

export function isAdminOperationName(value: string): value is AdminOperationName {
  return Object.prototype.hasOwnProperty.call(ADMIN_OPERATIONS, value);
}
