import type { BrandProjectDetail } from './types';

/**
 * One campaign, one line (docs/PLATFORM-2.0.md §16.4): brief → TWINGS review → recruiting →
 * selection → production & posting → report → settlement. The current stage is read from facts
 * already stored — the project's status, its linked campaigns' status and counts, reports — never
 * from a date, so the line never claims progress that has not happened.
 *
 * A studio-produced campaign has no recruiting, selection or creator settlement: those stages are
 * `skipped`, not pretended.
 */
export const TIMELINE_STAGES = ['brief', 'review', 'recruiting', 'selection', 'production', 'report', 'settlement'] as const;
export type TimelineStage = (typeof TIMELINE_STAGES)[number];
export type StageState = 'done' | 'current' | 'upcoming' | 'skipped';
export interface CampaignTimeline {
  /** `done`: every stage finished. `cancelled`: no stage is current. */
  current: TimelineStage | 'done' | 'cancelled';
  stages: Array<{ key: TimelineStage; state: StageState }>;
}

type Input = Pick<BrandProjectDetail, 'status' | 'productionMode' | 'reports' | 'posts' | 'contents'> & Partial<Pick<BrandProjectDetail, 'participation'>>;

function currentStage(p: Input): CampaignTimeline['current'] {
  if (p.status === 'cancelled') return 'cancelled';
  if (p.status === 'requested') return 'review';
  const creators = p.productionMode === 'creator';
  const campaigns = p.participation ?? [];
  const unpaid = campaigns.some((c) => c.verified > c.paid);
  if (p.status === 'completed') {
    if (creators && unpaid) return 'settlement';
    return p.reports.length > 0 ? 'done' : 'report';
  }
  // Active.
  if (!creators) return p.reports.length > 0 ? 'report' : 'production';
  if (campaigns.length === 0) return 'recruiting';
  const statuses = campaigns.map((c) => c.status ?? 'draft');
  if (statuses.every((s) => s === 'closed' || s === 'archived')) return unpaid ? 'settlement' : 'report';
  if (statuses.includes('running') || campaigns.some((c) => c.posted > 0)) return 'production';
  if (statuses.includes('selecting')) return 'selection';
  return 'recruiting';
}

export function campaignTimeline(p: Input): CampaignTimeline {
  const current = currentStage(p);
  const skipped = new Set<TimelineStage>(p.productionMode === 'creator' ? [] : ['recruiting', 'selection', 'settlement']);
  const at = current === 'done' ? TIMELINE_STAGES.length : current === 'cancelled' ? -1 : TIMELINE_STAGES.indexOf(current);
  return {
    current,
    stages: TIMELINE_STAGES.map((key, i) => ({
      key,
      state: skipped.has(key) ? 'skipped' : current === 'cancelled' ? (key === 'brief' ? 'done' : 'upcoming') : i < at ? 'done' : i === at ? 'current' : 'upcoming',
    })),
  };
}
