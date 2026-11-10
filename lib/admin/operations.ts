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
import { BRAND_STUDIO_OPERATIONS } from './brand-studio-operations';
import { BRAND_STUDIO_REVIEW_OPERATIONS } from './brand-studio-review-operations';
import { BRAND_PRODUCTION_OPERATIONS } from './brand-production-operations';
import { PLATFORM_OPERATIONS } from './platform-operations';
import { CAMPAIGN_RISK_OPERATIONS } from './campaign-risk-operations';
import { CAMPAIGN_COLLABORATION_OPERATIONS } from './campaign-collaboration-operations';
import { CAMPAIGN_FUNDING_OPERATIONS } from './campaign-funding-operations';
import { SOCIAL_OPERATIONS } from './social-operations';
import { LANDING_MEDIA_OPERATIONS } from './landing-media-operations';
import { RENDER_OPERATIONS } from './render-operations';
import { PAYOUT_OPERATIONS } from './payout-operations';

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
  // docs/BRAND-STUDIO-V2.md §9 — the studio v2 monthly allowance and preferred lane per organization.
  ...BRAND_STUDIO_OPERATIONS,
  // docs/BRAND-STUDIO-V3.md §7 — the review space, team side: reply, resolve, status, open a review.
  ...BRAND_STUDIO_REVIEW_OPERATIONS,
  ...PLATFORM_OPERATIONS,
  ...CAMPAIGN_RISK_OPERATIONS,
  ...CAMPAIGN_COLLABORATION_OPERATIONS,
  ...CAMPAIGN_FUNDING_OPERATIONS,
  ...SOCIAL_OPERATIONS,
  ...LANDING_MEDIA_OPERATIONS,
  ...RENDER_OPERATIONS,
  ...PAYOUT_OPERATIONS,
  // docs/RUNBOOK-deletion.md — the account deletion queue: delete now, mark done by hand, close.
  ...ACCOUNT_DELETION_OPERATIONS,
};

export type AdminOperationName = keyof typeof ADMIN_OPERATIONS;

export const ADMIN_OPERATION_NAMES = Object.keys(ADMIN_OPERATIONS) as AdminOperationName[];

export function isAdminOperationName(value: string): value is AdminOperationName {
  return Object.prototype.hasOwnProperty.call(ADMIN_OPERATIONS, value);
}
