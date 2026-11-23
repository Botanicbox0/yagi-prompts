import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import {
  BILLING_REQUEST_INTENTS,
  formatKrwAmount,
  type BillingRequestIntent,
} from '@/lib/brands/billing-ui';
import { BRAND_PLANS } from '@/lib/brands/plans';
import {
  sendBrandSupport,
  type BrandWorkspaceDeps,
} from '@/lib/brands/workspace/service';
import type { BrandOutcome } from '@/lib/brands/workspace/types';
import { getDictionary } from '@/lib/i18n/dictionaries';

export type BillingNoticeKind = 'plan_request' | 'allowance_request';

const BillingRequestInputSchema = z.object({
  organizationId: z.uuid(),
  intent: z.enum(BILLING_REQUEST_INTENTS),
  desiredPlan: z
    .enum(['b2b_29', 'b2b_49', 'b2b_69', 'project_only', 'undecided'])
    .optional(),
  note: z.string().trim().max(2000).optional().default(''),
  surface: z.string().trim().max(60).optional(),
  neededCredits: z.number().int().nonnegative().max(10_000_000).optional(),
  remainingCredits: z.number().int().nonnegative().max(10_000_000).optional(),
  requestId: z.uuid(),
});

export function noticeKindForBillingIntent(intent: BillingRequestIntent): BillingNoticeKind {
  return intent === 'allowance_request' ? 'allowance_request' : 'plan_request';
}

function desiredPlanLabel(
  planId: NonNullable<z.infer<typeof BillingRequestInputSchema>['desiredPlan']>,
  locale: 'ko' | 'en',
): string {
  const dict = getDictionary(locale);
  const c = dict.brandBilling.customer;
  const thread = dict.brandBilling.requestThread;
  if (planId === 'undecided') return c.requestForm.desiredPlanNone;
  const tierName = c.planSection.tierNames[planId];
  const monthlyKrw = BRAND_PLANS[planId].monthlyKrw;
  if (monthlyKrw <= 0) return tierName;
  const formatted = formatKrwAmount(monthlyKrw, locale);
  return thread.planPriceOption
    .replace('{name}', tierName)
    .replace('{amount}', formatted)
    .replace('{vat}', c.planSection.vatSeparate);
}

export function formatBillingRequestBody(
  input: z.infer<typeof BillingRequestInputSchema>,
  locale: 'ko' | 'en' = 'ko',
): string {
  const dict = getDictionary(locale);
  const thread = dict.brandBilling.requestThread;

  const lines: string[] = [thread.headers[input.intent]];
  if (input.desiredPlan) {
    lines.push(`${thread.desiredPlanLabel}: ${desiredPlanLabel(input.desiredPlan, locale)}`);
  }
  if (
    typeof input.neededCredits === 'number' ||
    typeof input.remainingCredits === 'number'
  ) {
    const parts: string[] = [];
    if (typeof input.neededCredits === 'number') {
      parts.push(thread.creditsNeeded.replace('{count}', String(input.neededCredits)));
    }
    if (typeof input.remainingCredits === 'number') {
      parts.push(thread.creditsRemaining.replace('{count}', String(input.remainingCredits)));
    }
    lines.push(`${thread.creditsStatusLabel}: ${parts.join(' · ')}`);
  }
  if (input.note) {
    lines.push(`${thread.detailsLabel}: ${input.note}`);
  }
  return lines.join('\n').slice(0, 4000);
}

export type BillingRequestOutcome =
  | { ok: true; id: string; noticeKind: BillingNoticeKind }
  | {
      ok: false;
      code:
        | 'sign_in_required'
        | 'forbidden'
        | 'not_found'
        | 'invalid'
        | 'conflict'
        | 'rate_limited'
        | 'unavailable';
    };

export async function submitBrandBillingRequest(
  deps: BrandWorkspaceDeps,
  viewer: Viewer,
  input: unknown,
): Promise<BillingRequestOutcome> {
  const parsed = BillingRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid' };
  }

  const noticeKind = noticeKindForBillingIntent(parsed.data.intent);
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const body = formatBillingRequestBody(parsed.data, locale);
  const surface = parsed.data.surface
    ? `billing:${parsed.data.intent}:${parsed.data.surface}`.slice(0, 80)
    : `billing:${parsed.data.intent}`;

  const outcome: BrandOutcome = await sendBrandSupport(
    deps,
    viewer,
    {
      organizationId: parsed.data.organizationId,
      body,
      requestId: parsed.data.requestId,
      surface,
    },
    'client',
    {
      noticeKind,
      adminPath: `/admin/brand-workspace/organizations/${parsed.data.organizationId}`,
      perOrgHourlyLimit: 5,
      requireWritableMember: true,
    },
  );

  if (!outcome.ok) {
    const code = outcome.code;
    if (
      code === 'sign_in_required' ||
      code === 'forbidden' ||
      code === 'not_found' ||
      code === 'invalid' ||
      code === 'conflict' ||
      code === 'rate_limited'
    ) {
      return { ok: false, code };
    }
    return { ok: false, code: 'invalid' };
  }

  return {
    ok: true,
    id: String((outcome as { id?: unknown }).id ?? ''),
    noticeKind,
  };
}
