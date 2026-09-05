import type { ApplicationStatus, CampaignStatus, PayoutRule } from './schemas';

/**
 * The campaign state machines and the payout arithmetic, as pure functions (docs/CAMPAIGNS.md §3–§4).
 *
 * Every transition the admin surface or a creator form can request goes through `canTransition`,
 * and every 원 a creator is owed comes out of `computePayout`. Both are here, not in the repo or the
 * route handlers, so the rules can be read in one screen and tested without a database — the same
 * split the contests module uses for its phase logic.
 */

// ---------------------------------------------------------------------------
// campaign lifecycle
// ---------------------------------------------------------------------------

const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ['recruiting', 'archived'],
  recruiting: ['selecting', 'draft', 'archived'],
  selecting: ['running', 'recruiting', 'archived'],
  running: ['closed', 'archived'],
  closed: ['archived'],
  archived: [],
};

export function canCampaignTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Recruiting, selecting, running: the campaign appears on the public listing. */
export function isCampaignPublic(status: CampaignStatus): boolean {
  return status === 'recruiting' || status === 'selecting' || status === 'running';
}

/** Applications are accepted only while recruiting AND before the application deadline. */
export function acceptsApplications(
  campaign: { status: CampaignStatus; applicationsCloseAt: string | null },
  now: Date | number,
): boolean {
  if (campaign.status !== 'recruiting') return false;
  if (campaign.applicationsCloseAt === null) return false;
  return new Date(now).getTime() < Date.parse(campaign.applicationsCloseAt);
}

/** A selected creator may submit (or resubmit) a link while running and before the post deadline. */
export function acceptsPosts(
  campaign: { status: CampaignStatus; postDeadlineAt: string | null },
  now: Date | number,
): boolean {
  if (campaign.status !== 'running' && campaign.status !== 'selecting') return false;
  if (campaign.postDeadlineAt === null) return false;
  return new Date(now).getTime() < Date.parse(campaign.postDeadlineAt);
}

// ---------------------------------------------------------------------------
// application lifecycle
// ---------------------------------------------------------------------------

const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ['selected', 'declined', 'withdrawn'],
  selected: ['posted', 'withdrawn', 'expired'],
  posted: ['verified', 'rejected'],
  rejected: ['posted', 'expired'],
  verified: ['paid'],
  declined: [],
  withdrawn: [],
  paid: [],
  expired: [],
};

export function canApplicationTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

/** The statuses that occupy one of the campaign's slots. */
export const SLOT_HOLDING_STATUSES: readonly ApplicationStatus[] = ['selected', 'posted', 'verified', 'rejected', 'paid'];

export function holdsSlot(status: ApplicationStatus): boolean {
  return SLOT_HOLDING_STATUSES.includes(status);
}

/** Terminal: nothing further can happen to this application. */
export function isApplicationTerminal(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0;
}

/** The creator-facing step (1-based) for a progress bar: apply → selected → posted → verified → paid. */
export function applicationStep(status: ApplicationStatus): number {
  switch (status) {
    case 'applied':
      return 1;
    case 'selected':
    case 'rejected':
      return 2;
    case 'posted':
      return 3;
    case 'verified':
      return 4;
    case 'paid':
      return 5;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// the hold
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function holdUntil(verifiedAt: Date | string, holdDays: number): Date {
  return new Date(new Date(verifiedAt).getTime() + holdDays * DAY_MS);
}

/** Paying before the hold ends is refused by code, not by policy text. */
export function payoutReleasable(
  application: { status: ApplicationStatus; holdUntil: string | null },
  now: Date | number,
): boolean {
  if (application.status !== 'verified') return false;
  if (application.holdUntil === null) return false;
  return new Date(now).getTime() >= Date.parse(application.holdUntil);
}

// ---------------------------------------------------------------------------
// payout arithmetic
// ---------------------------------------------------------------------------

export interface PayoutBreakdown {
  /** The amount owed, in minor units, after floor and cap. */
  cents: number;
  flatCents: number;
  variableCents: number;
  floored: boolean;
  capped: boolean;
}

/**
 * Integer arithmetic only. Views are converted to 1,000-view units with the remainder paid pro
 * rata, rounded to the nearest 원 — a creator with 1,500 views on a 500원/1k rule gets 750원,
 * not 500원.
 */
export function computePayout(rule: PayoutRule, metrics: { views: number }): PayoutBreakdown {
  const views = Math.max(0, Math.floor(metrics.views));
  const flatCents = rule.model === 'per_view' ? 0 : rule.flatCents;
  const variableRaw = rule.model === 'flat' ? 0 : Math.round((views * rule.perThousandViewsCents) / 1000);

  let cents = flatCents + variableRaw;
  let floored = false;
  let capped = false;
  if (rule.model !== 'flat') {
    if (cents < rule.minCents) {
      cents = rule.minCents;
      floored = true;
    }
    if (rule.maxCents !== null && cents > rule.maxCents) {
      cents = rule.maxCents;
      capped = true;
    }
  }
  return { cents, flatCents, variableCents: cents - flatCents, floored, capped };
}

/** For a flat rule the payout is known at verification; a view-based rule needs the snapshot. */
export function needsMetrics(rule: PayoutRule): boolean {
  return rule.model !== 'flat';
}

/** 원 as "30,000원" (ko) / "₩30,000" (en); the only currency v1 knows. */
export function formatWon(cents: number, locale: string): string {
  const digits = Math.round(cents).toLocaleString('en-US');
  return locale === 'ko' ? `${digits}원` : `₩${digits}`;
}
