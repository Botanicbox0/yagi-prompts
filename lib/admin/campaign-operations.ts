import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseDateTimeLocal } from '@/lib/contests/schemas';
import {
  campaignSlugExists,
  insertCampaign,
  loadApplicationById,
  loadApplicationsForCampaign,
  loadCampaignById,
  setCampaignStatus,
  transitionApplication,
  updateCampaign,
} from '@/lib/campaigns/repo';
import {
  CAMPAIGN_PLATFORMS,
  CampaignFormSchema,
  isCampaignStatus,
  recruitBlockers,
  type CampaignPlatform,
} from '@/lib/campaigns/schemas';
import {
  canApplicationTransition,
  canCampaignTransition,
  computePayout,
  holdUntil,
  holdsSlot,
  needsMetrics,
  payoutReleasable,
} from '@/lib/campaigns/state';
import { ADMIN_CAMPAIGNS_PATH, adminCampaignPath } from '@/lib/campaigns/links';
import { announceCampaignRecruiting, notifyApplicationStatus, type NotifiedApplicationStatus } from '@/lib/campaigns/notify';
import type { CampaignRow } from '@/lib/campaigns/repo';
import { fail, ok, type AdminContext, type AdminMail, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation, ParseResult } from './operations';

/**
 * docs/CAMPAIGNS.md — campaign authoring, the lifecycle, and the application queue, registered in
 * the same dispatcher as prompts and contests so `tests/admin/auth.test.ts` refuses every one of
 * these for a non-admin the moment it exists.
 *
 * Division of labour, as everywhere in `lib/admin`: zod validates the form at this boundary, the
 * state machine in `lib/campaigns/state.ts` decides what may move where, and the database owns the
 * CHECKs that make a public campaign carry dates, a payout and localized copy. Money is computed
 * by `computePayout` and written once, at `pay`, from the stored rule and the stored snapshot —
 * never re-derived later from a rule that might have been edited.
 */

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, detail: issues(result.error) };
}

const NOT_FOUND = 'the campaign this form points at no longer exists';
const APP_NOT_FOUND = 'the application this form points at no longer exists';

function intOrNull(form: FormData, name: string): number | null {
  const raw = f.str(form, name);
  if (raw === '') return null;
  const value = Number.parseInt(raw.replace(/[,\s]/g, ''), 10);
  return Number.isFinite(value) ? value : null;
}

/** Comma- or whitespace-separated hashtags/mentions, as typed in one text input. */
function words(form: FormData, name: string): string[] {
  return f
    .str(form, name)
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The campaign form, read out of a plain multipart POST. */
function campaignFields(form: FormData) {
  const platforms = form
    .getAll('platforms')
    .map(String)
    .filter((p): p is CampaignPlatform => (CAMPAIGN_PLATFORMS as readonly string[]).includes(p));
  const maxCents = intOrNull(form, 'payoutMax');
  return {
    slug: f.str(form, 'slug'),
    title: f.localized(form, 'title'),
    summary: f.localized(form, 'summary'),
    brief: f.optionalLocalized(form, 'brief'),
    hostName: f.str(form, 'hostName'),
    hostKind: f.str(form, 'hostKind') || 'brand',
    hostUrl: f.str(form, 'hostUrl') || null,
    styleSlug: f.str(form, 'styleSlug') || null,
    platforms,
    deliverable: f.str(form, 'deliverable') || 'reel',
    slots: intOrNull(form, 'slots') ?? 0,
    applicationsCloseAt: parseDateTimeLocal(f.str(form, 'applicationsCloseAt')),
    postDeadlineAt: parseDateTimeLocal(f.str(form, 'postDeadlineAt')),
    payout: {
      model: f.str(form, 'payoutModel') || 'flat',
      flatCents: intOrNull(form, 'payoutFlat') ?? 0,
      perThousandViewsCents: intOrNull(form, 'payoutPerK') ?? 0,
      minCents: intOrNull(form, 'payoutMin') ?? 0,
      maxCents,
      currency: 'KRW',
      holdDays: intOrNull(form, 'holdDays') ?? 7,
    },
    requirements: {
      hashtags: words(form, 'hashtags'),
      mentions: words(form, 'mentions'),
      disclosure: f.bool(form, 'disclosure'),
    },
    budgetCents: intOrNull(form, 'budgetCents'),
  };
}

// ---------------------------------------------------------------------------
// campaigns
// ---------------------------------------------------------------------------

const create: AdminOperation<z.infer<typeof CampaignFormSchema>> = {
  parse: (form) => parsed(CampaignFormSchema, campaignFields(form)),
  async run(ctx, input) {
    if (await campaignSlugExists(ctx.sql, input.slug)) return fail('duplicateSlug', input.slug);
    const id = randomUUID();
    // Born a draft: nothing about a new campaign is public, not the fee and not the client.
    await insertCampaign(ctx.sql, { id, ...input });
    return ok('created', { detail: input.slug, to: adminCampaignPath(id) });
  },
};

const Update = z.object({ id: z.string().uuid() });

const update: AdminOperation<{ id: string; input: z.infer<typeof CampaignFormSchema> }> = {
  parse(form) {
    const id = Update.safeParse({ id: f.str(form, 'id') });
    if (!id.success) return { ok: false, detail: 'id: must be a uuid' };
    const base = parsed(CampaignFormSchema, campaignFields(form));
    if (!base.ok) return base;
    return { ok: true, value: { id: id.data.id, input: base.value } };
  },
  async run(ctx, { id, input }) {
    const row = await loadCampaignById(ctx.sql, id);
    if (row === null) return fail('notFound', NOT_FOUND);
    if (await campaignSlugExists(ctx.sql, input.slug, id)) return fail('duplicateSlug', input.slug);
    const saved = await updateCampaign(ctx.sql, id, input);
    if (!saved) return fail('notFound', NOT_FOUND);
    if (row.status !== 'draft' && row.status !== 'archived') ctx.revalidateCampaigns?.();
    return ok('saved', { detail: input.slug, to: adminCampaignPath(id) });
  },
};

const Status = z.object({ id: z.string().uuid(), to: z.string() });

/**
 * One operation for every lifecycle move. The gate to `recruiting` is the one with teeth: it is the
 * moment the fee and the dates become a public promise, so `recruitBlockers` runs first and names
 * what is missing in a sentence the database would otherwise refuse with a constraint name.
 */
const status: AdminOperation<z.infer<typeof Status>> = {
  parse: (form) => parsed(Status, { id: f.str(form, 'id'), to: f.str(form, 'to') }),
  async run(ctx, input) {
    const row = await loadCampaignById(ctx.sql, input.id);
    if (row === null) return fail('notFound', NOT_FOUND);
    if (!isCampaignStatus(input.to)) return fail('invalid', `to: unknown status ${input.to}`);
    if (!canCampaignTransition(row.status, input.to)) {
      return fail('badTransition', `${row.status} → ${input.to}`);
    }
    if (input.to === 'recruiting') {
      const blockers = recruitBlockers(row);
      if (blockers.length > 0) return fail('notPublishable', blockers.join(', '));
    }
    const moved = await setCampaignStatus(ctx.sql, input.id, input.to);
    if (!moved) return fail('notFound', NOT_FOUND);
    ctx.revalidateCampaigns?.();
    // Recruiting opens: everyone with the campaign switch on hears about it, after the redirect.
    if (input.to === 'recruiting') {
      mailAfter(ctx, (mail) => announceCampaignRecruiting({ sql: ctx.sql, mailer: mail.mailer, siteUrl: mail.siteUrl }, { ...row, status: 'recruiting' }));
    }
    const code =
      input.to === 'recruiting'
        ? 'published'
        : input.to === 'archived'
          ? 'archived'
          : input.to === 'draft'
            ? 'unpublished'
            : 'saved';
    return ok(code, { detail: row.slug, to: adminCampaignPath(input.id) });
  },
};

// ---------------------------------------------------------------------------
// applications
// ---------------------------------------------------------------------------

const Review = z.object({ id: z.string().uuid(), version: z.string().min(1) });
const Rejection = Review.extend({ reason: z.string().trim().min(3).max(400) });
const Metrics = Review.extend({ views: z.number().int().min(0) });
const Pay = Review.extend({ payoutRef: z.string().trim().max(120).default('') });

/**
 * Mail after the commit (2026-09-13). Both halves are injected by the route; a test harness that
 * passes neither gets the old behaviour — no mail, no error. The row is re-read inside the task so
 * the message carries the post-transition version, which is also its idempotency key.
 */
function mailAfter(ctx: AdminContext, task: (mail: AdminMail) => Promise<unknown>): void {
  const mail = ctx.mail;
  if (!mail || !ctx.defer) return;
  ctx.defer(async () => {
    await task(mail);
  });
}

function mailApplicationStatus(ctx: AdminContext, appId: string, campaign: CampaignRow, status: NotifiedApplicationStatus): void {
  mailAfter(ctx, async (mail) => {
    const fresh = await loadApplicationById(ctx.sql, appId);
    if (fresh !== null) await notifyApplicationStatus({ sql: ctx.sql, mailer: mail.mailer, siteUrl: mail.siteUrl }, { app: fresh, campaign, status });
  });
}

async function reviewTarget(ctx: Parameters<AdminOperation['run']>[0], id: string) {
  const app = await loadApplicationById(ctx.sql, id);
  if (app === null) return null;
  const campaign = await loadCampaignById(ctx.sql, app.campaignId);
  return campaign === null ? null : { app, campaign };
}

const select: AdminOperation<z.infer<typeof Review>> = {
  parse: (form) => parsed(Review, { id: f.str(form, 'id'), version: f.str(form, 'version') }),
  async run(ctx, input) {
    const target = await reviewTarget(ctx, input.id);
    if (target === null) return fail('notFound', APP_NOT_FOUND);
    const { app, campaign } = target;
    if (!canApplicationTransition(app.status, 'selected')) return fail('badTransition', `${app.status} → selected`);
    // Slots are a promise to the client: the N-th selection past the cap is refused, not queued.
    const taken = (await loadApplicationsForCampaign(ctx.sql, campaign.id)).filter((a) => holdsSlot(a.status)).length;
    if (taken >= campaign.slots) return fail('slotsFull', `${taken}/${campaign.slots}`);
    const moved = await transitionApplication(ctx.sql, app.id, input.version, 'selected', {
      selectedAt: new Date().toISOString(),
    });
    if (!moved) return fail('staleReview');
    ctx.revalidateCampaigns?.();
    mailApplicationStatus(ctx, app.id, campaign, 'selected');
    return ok('selected', { to: adminCampaignPath(campaign.id) });
  },
};

const decline: AdminOperation<z.infer<typeof Review>> = {
  parse: (form) => parsed(Review, { id: f.str(form, 'id'), version: f.str(form, 'version') }),
  async run(ctx, input) {
    const target = await reviewTarget(ctx, input.id);
    if (target === null) return fail('notFound', APP_NOT_FOUND);
    const { app, campaign } = target;
    if (!canApplicationTransition(app.status, 'declined')) return fail('badTransition', `${app.status} → declined`);
    const moved = await transitionApplication(ctx.sql, app.id, input.version, 'declined');
    if (!moved) return fail('staleReview');
    mailApplicationStatus(ctx, app.id, campaign, 'declined');
    return ok('declined', { to: adminCampaignPath(campaign.id) });
  },
};

/** The post checks out: link opens, right platform, hashtags and disclosure present. Starts the hold. */
const verify: AdminOperation<z.infer<typeof Review>> = {
  parse: (form) => parsed(Review, { id: f.str(form, 'id'), version: f.str(form, 'version') }),
  async run(ctx, input) {
    const target = await reviewTarget(ctx, input.id);
    if (target === null) return fail('notFound', APP_NOT_FOUND);
    const { app, campaign } = target;
    if (!canApplicationTransition(app.status, 'verified')) return fail('badTransition', `${app.status} → verified`);
    if (campaign.payout === null) return fail('notPublishable', 'payout rule');
    const verifiedAt = new Date();
    const moved = await transitionApplication(ctx.sql, app.id, input.version, 'verified', {
      verifiedAt: verifiedAt.toISOString(),
      holdUntil: holdUntil(verifiedAt, campaign.payout.holdDays).toISOString(),
      // A flat fee is known now; a view-based one waits for the snapshot at the end of the hold.
      payoutCents: needsMetrics(campaign.payout) ? null : computePayout(campaign.payout, { views: 0 }).cents,
    });
    if (!moved) return fail('staleReview');
    ctx.revalidateCampaigns?.();
    mailApplicationStatus(ctx, app.id, campaign, 'verified');
    return ok('verified', { to: adminCampaignPath(campaign.id) });
  },
};

const reject: AdminOperation<z.infer<typeof Rejection>> = {
  parse: (form) =>
    parsed(Rejection, { id: f.str(form, 'id'), version: f.str(form, 'version'), reason: f.text(form, 'reason') }),
  async run(ctx, input) {
    const target = await reviewTarget(ctx, input.id);
    if (target === null) return fail('notFound', APP_NOT_FOUND);
    const { app, campaign } = target;
    if (!canApplicationTransition(app.status, 'rejected')) return fail('badTransition', `${app.status} → rejected`);
    const moved = await transitionApplication(ctx.sql, app.id, input.version, 'rejected', { rejectReason: input.reason });
    if (!moved) return fail('staleReview');
    mailApplicationStatus(ctx, app.id, campaign, 'rejected');
    return ok('rejected', { to: adminCampaignPath(campaign.id) });
  },
};

/** The admin's confirmed seven-day number (overrides the creator's self-report). */
const metrics: AdminOperation<z.infer<typeof Metrics>> = {
  parse: (form) =>
    parsed(Metrics, { id: f.str(form, 'id'), version: f.str(form, 'version'), views: intOrNull(form, 'views') ?? -1 }),
  async run(ctx, input) {
    const target = await reviewTarget(ctx, input.id);
    if (target === null) return fail('notFound', APP_NOT_FOUND);
    const { app, campaign } = target;
    if (app.status !== 'posted' && app.status !== 'verified') return fail('badTransition', `${app.status}: no post to measure`);
    const moved = await transitionApplication(ctx.sql, app.id, input.version, app.status, {
      viewsSnapshot: input.views,
      metricsSource: 'admin',
    });
    if (!moved) return fail('staleReview');
    return ok('saved', { to: adminCampaignPath(campaign.id) });
  },
};

/**
 * The settlement. Refused before the hold ends (by `payoutReleasable`, not by a note in a policy),
 * refused for a view-based rule without a snapshot, and the amount is computed here, once, from the
 * stored rule and the stored snapshot, then written next to `paid_at` and the transfer reference.
 */
const pay: AdminOperation<z.infer<typeof Pay>> = {
  parse: (form) =>
    parsed(Pay, { id: f.str(form, 'id'), version: f.str(form, 'version'), payoutRef: f.str(form, 'payoutRef') }),
  async run(ctx, input) {
    const target = await reviewTarget(ctx, input.id);
    if (target === null) return fail('notFound', APP_NOT_FOUND);
    const { app, campaign } = target;
    if (!canApplicationTransition(app.status, 'paid')) return fail('badTransition', `${app.status} → paid`);
    if (!payoutReleasable(app, Date.now())) return fail('notReleasable', app.holdUntil ?? '');
    if (campaign.payout === null) return fail('notPublishable', 'payout rule');
    if (needsMetrics(campaign.payout) && app.viewsSnapshot === null) return fail('metricsRequired');
    const amount = computePayout(campaign.payout, { views: app.viewsSnapshot ?? 0 }).cents;
    const moved = await transitionApplication(ctx.sql, app.id, input.version, 'paid', {
      payoutCents: amount,
      paidAt: new Date().toISOString(),
      payoutRef: input.payoutRef || null,
    });
    if (!moved) return fail('staleReview');
    mailApplicationStatus(ctx, app.id, campaign, 'paid');
    return ok('paid', { detail: String(amount), to: adminCampaignPath(campaign.id) });
  },
};

export const CAMPAIGN_OPERATIONS = {
  'campaign.create': create,
  'campaign.update': update,
  'campaign.status': status,
  'campaignApplication.select': select,
  'campaignApplication.decline': decline,
  'campaignApplication.verify': verify,
  'campaignApplication.reject': reject,
  'campaignApplication.metrics': metrics,
  'campaignApplication.pay': pay,
} as const;

export const CAMPAIGNS_BACK = ADMIN_CAMPAIGNS_PATH;
export type CampaignOutcome = AdminOutcome;
