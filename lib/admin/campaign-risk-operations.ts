import type { AdminOperation } from './operations';
import { fail, ok } from './context';
import { reviewRiskFlag } from '@/lib/campaigns/risk/admin';
const review: AdminOperation<Record<string, unknown>> = {
  parse: (form) => ({
    ok: true,
    value: { id: form.get('id'), state: form.get('state'), reason: form.get('reason') },
  }),
  async run(ctx, input) {
    const r = await reviewRiskFlag(ctx.sql, ctx.viewer, input);
    return r.ok ? ok('saved', { to: '/admin/risk' }) : fail(r.code);
  },
};
export const CAMPAIGN_RISK_OPERATIONS = { 'campaignRisk.review': review } as const;
