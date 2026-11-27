'use client';

import { useState } from 'react';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import type { RoomTrack } from '@/lib/brand-rooms/overview';
import { scopedHref } from '@/lib/brands/workspace/selection';
import type { BrandProjectSummary } from '@/lib/brands/workspace/types';
import type { BrandCopy } from '../action-form';
import { BrandProjectCard, type CampaignListRooms } from '../campaign-list';
import {
  campaignOpsProjectTrack,
  filterProjectsByStatus,
  sortCampaignOpsProjects,
  usedStatuses,
  type CampaignOpsKind,
  type CampaignOpsStatusFilter,
} from './model';
import s from './campaign-ops.module.css';

export interface CampaignOpsListProps {
  kind: CampaignOpsKind;
  organizationId: string;
  projects: readonly BrandProjectSummary[];
  listTitle: string;
  listEmpty: string;
  allLabel: string;
  b: BrandCopy;
  locale: string;
  rooms: CampaignListRooms;
  trackLabels: Record<RoomTrack, string>;
  initialStatus?: CampaignOpsStatusFilter;
}

export function CampaignOpsList({
  kind,
  organizationId,
  projects,
  listTitle,
  listEmpty,
  allLabel,
  b,
  locale,
  rooms,
  trackLabels,
  initialStatus = 'all',
}: CampaignOpsListProps) {
  const [status, setStatus] = useState<CampaignOpsStatusFilter>(initialStatus);
  const statuses = usedStatuses(projects);
  const filtered = sortCampaignOpsProjects(filterProjectsByStatus(projects, status));
  const linkFor = (project: BrandProjectSummary) =>
    project.clientVisible !== false
      ? roomHref(project.id, organizationId)
      : scopedHref(`/brand/projects/${project.id}`, { id: organizationId });

  return (
    <section className={s.listSection} aria-labelledby="campaign-ops-list-heading" data-campaign-ops-list="">
      <div className={s.listHead}>
        <h2 id="campaign-ops-list-heading" className={s.listTitle}>
          {listTitle}
        </h2>
        <div className={s.filters} role="group" aria-label={b.projectStatus} data-campaign-ops-filters="">
          <button
            type="button"
            className={s.filterChip}
            aria-pressed={status === 'all'}
            data-filter-status="all"
            onClick={() => setStatus('all')}
          >
            <span>{allLabel}</span>
            <span className={s.filterCount}>{projects.length}</span>
          </button>
          {statuses.map((key) => (
            <button
              key={key}
              type="button"
              className={s.filterChip}
              aria-pressed={status === key}
              data-filter-status={key}
              onClick={() => setStatus(key)}
            >
              <span>{b.status[key]}</span>
              <span className={s.filterCount}>{projects.filter((p) => p.status === key).length}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={s.listEmpty} role="status" data-campaign-ops-empty="">
          {listEmpty}
        </p>
      ) : (
        <ul className={`bw-campaign-grid ${s.grid}`} data-campaign-ops-grid="">
          {filtered.map((project) => (
            <BrandProjectCard
              key={project.id}
              project={project}
              href={linkFor(project)}
              b={b}
              locale={locale}
              rooms={rooms}
              trackLabel={kind === 'production' ? trackLabels[campaignOpsProjectTrack(project)] : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
