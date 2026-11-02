import { configureCampaignProduction, approveCampaignRetry } from '@/lib/campaigns/production';
import { resolveCampaignDispatch } from '@/lib/campaigns/production-dispatch';
import { adminCampaignPath } from '@/lib/campaigns/links';
import { fail, ok } from './context';
import type { AdminOperation } from './operations';
import * as f from './form';
const configure: AdminOperation<Record<string, unknown>> = {
  parse(form) {
    const parts = f.str(form, 'binding').split('|');
    if (parts.length !== 2) return { ok: false, detail: 'binding' };
    return { ok: true, value: { campaignId: f.str(form, 'campaignId'), contractId: parts[0], templateId: parts[1], expectedRevision: Number(f.str(form, 'expectedRevision')), enabled: f.bool(form, 'enabled'), referenceAttachmentIds: form.getAll('referenceAttachmentIds').map(String) } };
  },
  async run(ctx, input) {
    const r = await configureCampaignProduction(ctx, ctx.viewer, input);
    return r.ok ? ok('saved', { to: adminCampaignPath(r.id) }) : fail(r.code === 'forbidden' ? 'forbidden' : r.code === 'not_found' ? 'notFound' : r.code === 'conflict' ? 'staleReview' : 'invalid');
  },
};
const retry: AdminOperation<{ renderId: string; campaignId: string }> = {
  parse: form => ({ ok: true, value: { renderId: f.str(form, 'renderId'), campaignId: f.str(form, 'campaignId') } }),
  async run(ctx, input) {
    const r = await approveCampaignRetry(ctx, ctx.viewer, input.renderId);
    return r.ok ? ok('saved', { to: adminCampaignPath(input.campaignId) }) : fail(r.code === 'forbidden' ? 'forbidden' : r.code === 'not_found' ? 'notFound' : 'invalid');
  },
};
const resolve: AdminOperation<{ renderId: string; campaignId: string; action: string; taskId: string; confirmed: boolean }> = {
  parse: form => ({ ok: true, value: { renderId: f.str(form, 'renderId'), campaignId: f.str(form, 'campaignId'), action: f.str(form, 'action'), taskId: f.str(form, 'taskId'), confirmed: f.bool(form, 'confirmed') } }),
  async run(ctx, { campaignId, ...input }) {
    const r = await resolveCampaignDispatch(ctx, ctx.viewer, input);
    return r.ok ? ok('saved', { to: adminCampaignPath(campaignId) }) : fail(r.code === 'forbidden' ? 'forbidden' : r.code === 'conflict' ? 'staleReview' : r.code === 'not_releasable' ? 'notReleasable' : 'invalid');
  },
};
export const CAMPAIGN_PRODUCTION_OPERATIONS = { 'campaignProduction.configure': configure, 'campaignProduction.retry': retry, 'campaignProduction.resolve': resolve } as const;
