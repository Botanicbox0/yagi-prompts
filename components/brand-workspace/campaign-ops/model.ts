/**
 * Pure domain/view helpers for campaign ops C1 pages (`/brand/campaigns`, `/brand/production`).
 * Client-safe: no server-only, env, or db imports.
 */
import { roomTrack, type RoomTrack } from '@/lib/brand-rooms/overview';
import { scopedHref } from '@/lib/brands/workspace/selection';
import type { BrandProjectStatus, BrandProjectSummary } from '@/lib/brands/workspace/types';
import type { CampaignOpsCopy } from '@/messages/campaign-ops';
import type { ProcessStep } from '../process-stage/model';

export type CampaignOpsKind = 'campaigns' | 'production';
export type CampaignOpsPageState = 'before' | 'after';
export type CampaignOpsStatusFilter = 'all' | BrandProjectStatus;

const STATUS_ORDER: readonly BrandProjectStatus[] = ['requested', 'active', 'completed', 'cancelled'];
const STATUS_SORT_RANK: Readonly<Record<BrandProjectStatus, number>> = {
  requested: 0,
  active: 1,
  completed: 2,
  cancelled: 3,
};

export function campaignOpsProjectTrack(
  project: Pick<BrandProjectSummary, 'productionMode' | 'objective' | 'intakeBrief'>,
): RoomTrack {
  return roomTrack(project);
}

export function campaignOpsProjectKind(
  project: Pick<BrandProjectSummary, 'productionMode' | 'objective' | 'intakeBrief'>,
): CampaignOpsKind {
  return campaignOpsProjectTrack(project) === 'creator_campaign' ? 'campaigns' : 'production';
}

export function splitProjectsByKind(
  projects: readonly BrandProjectSummary[],
  kind: CampaignOpsKind,
): BrandProjectSummary[] {
  return projects.filter((project) => campaignOpsProjectKind(project) === kind);
}

export function campaignOpsPageState(projects: readonly unknown[]): CampaignOpsPageState {
  return projects.length === 0 ? 'before' : 'after';
}

export function usedStatuses(projects: readonly Pick<BrandProjectSummary, 'status'>[]): BrandProjectStatus[] {
  const present = new Set(projects.map((p) => p.status));
  return STATUS_ORDER.filter((status) => present.has(status));
}

export function filterProjectsByStatus(
  projects: readonly BrandProjectSummary[],
  status: CampaignOpsStatusFilter,
): BrandProjectSummary[] {
  return status === 'all' ? [...projects] : projects.filter((p) => p.status === status);
}

export function sortCampaignOpsProjects(projects: readonly BrandProjectSummary[]): BrandProjectSummary[] {
  const needsAction = (p: BrandProjectSummary) => p.status === 'active' && (p.overview?.pending ?? 0) > 0;
  return projects
    .slice()
    .sort(
      (a, z) =>
        Number(needsAction(z)) - Number(needsAction(a)) ||
        STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[z.status] ||
        Date.parse(z.updatedAt) - Date.parse(a.updatedAt),
    );
}

export function campaignOpsStartHref(kind: CampaignOpsKind, organizationId: string): string {
  const base =
    kind === 'campaigns'
      ? '/brand/projects/new?track=creator_campaign&start=ops'
      : '/brand/projects/new?track=studio_film&start=ops';
  return scopedHref(base, { id: organizationId });
}

export function campaignOpsSteps(kind: CampaignOpsKind, copy: CampaignOpsCopy): ProcessStep[] {
  if (kind === 'campaigns') {
    const s = copy.campaigns.steps;
    return [
      { label: s.step1.label, body: s.step1.body, pictureId: 'c-brief' },
      { label: s.step2.label, body: s.step2.body, pictureId: 'c-template' },
      { label: s.step3.label, body: s.step3.body, pictureId: 'c-recruit' },
      { label: s.step4.label, body: s.step4.body, pictureId: 'c-pick' },
      { label: s.step5.label, body: s.step5.body, pictureId: 'c-post' },
      { label: s.step6.label, body: s.step6.body, pictureId: 'c-report' },
    ];
  }
  const s = copy.production.steps;
  return [
    { label: s.step1.label, body: s.step1.body, pictureId: 'p-request' },
    { label: s.step2.label, body: s.step2.body, pictureId: 'p-board' },
    { label: s.step3.label, body: s.step3.body, pictureId: 'p-draft' },
    { label: s.step4.label, body: s.step4.body, pictureId: 'p-revise' },
    { label: s.step5.label, body: s.step5.body, pictureId: 'p-done' },
  ];
}
