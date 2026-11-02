import type { BrandProjectSummary } from './types';

/**
 * The one date line a campaign card shows. A recorded end date is shown as recorded. Without one, only
 * a requested campaign is still being scheduled; an active, completed or cancelled campaign simply has
 * no date to show, so nothing suggests the schedule is still being negotiated. No date is inferred.
 */
export type CampaignDateLine = { kind: 'endsOn'; date: string } | { kind: 'pending' } | null;
export function campaignDateLine(p: Pick<BrandProjectSummary, 'status' | 'endsOn'>): CampaignDateLine {
  if (p.endsOn) return { kind: 'endsOn', date: p.endsOn };
  return p.status === 'requested' ? { kind: 'pending' } : null;
}
/** A single unset date in the brief: "to be agreed" only while the request is open, "not set" after. */
export function unsetDateKey(status: BrandProjectSummary['status']): 'pending' | 'notSet' {
  return status === 'requested' ? 'pending' : 'notSet';
}
