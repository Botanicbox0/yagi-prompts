/**
 * The workspace home on 야기 팀과 (founder 2026-11-20): a brand that works with the YAGI team sees what it
 * came for, not the making side. What waits on the person first (a draft or storyboard to decide, unread
 * team messages), then its projects with the stage each one is at, and one action: 새 프로젝트 의뢰. With no
 * project yet, one line on how working with the team goes and the same action.
 *
 * No prompt bar, no studio doors, no making examples, no credits: those belong to 직접 만들기. Plain server
 * markup; the stage line is the room's own (`brr-stage-line`, components/brand-rooms/room/room.css) and
 * every word comes from the rooms' and the home's existing copy.
 */
import type { ReactNode } from 'react';
import type { RoomAlertItem, RoomStage } from '@/components/brand-rooms/seams';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { RAIL_ICON } from '@/components/brand-workspace/rail-model';
import type { RoomStep } from '@/lib/brand-rooms/overview';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { interpolate } from '@/lib/i18n/format';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import type { BrandHomeCopy } from '@/messages/brand-home';
import type { RoomsChatCopy } from '@/messages/rooms-chat';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import { HomeNewsLine, type BrandNewsCopy } from './news-line';
import s from './home.module.css';

export interface TeamHomeProject {
  id: string;
  title: string;
  stage: RoomStage;
  steps: readonly RoomStep[];
  /** Unread team messages in this project's room, for this person. */
  unread: number;
}

export interface WorkspaceTeamHomeProps {
  organizationId: string;
  organizationName: string;
  /** In order (lib/brands/workspace/home.ts `teamHomeProjects`). */
  projects: readonly TeamHomeProject[];
  /** Every project the brand can see, for "모든 프로젝트". */
  totalProjects: number;
  /** Drafts and storyboards waiting for this member's decision, newest first (the inbox's own list). */
  reviews: readonly RoomAlertItem[];
  /** Owners and editors (never the TWINGS team view): 새 프로젝트 의뢰. */
  canRequest: boolean;
  viewerNote?: boolean;
  notice?: ReactNode;
  news?: HomeAnnouncement | null;
  copy: {
    home: BrandHomeCopy;
    nav: RoomsShellCopy['nav'];
    space: RoomsShellCopy['space'];
    overview: RoomsShellCopy['overview'];
    inbox: RoomsChatCopy['inbox'];
    brandNews?: BrandNewsCopy;
  };
}

const ROOM_STAGE_ORDER: readonly RoomStage[] = ['requested', 'storyboard', 'draft', 'revision', 'done'];

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

const Chevron = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </svg>
);

function StageLine({ steps, copy }: { steps: readonly Pick<RoomStep, 'stage' | 'state'>[]; copy: WorkspaceTeamHomeProps['copy']['overview'] }) {
  const stateLabel = { done: copy.stageDone, current: copy.stageNow, skipped: copy.stageAhead, ahead: copy.stageAhead } as const;
  return (
    <ol className={`brr-stage-line ${s.teamStageLine}`} aria-label={copy.stageTitle}>
      {steps.map((step) => (
        <li key={step.stage} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className="brr-stage-dot" aria-hidden="true">
            {step.state === 'done' ? (
              <svg viewBox="0 0 20 20">
                <path d="M5.5 10.5l3 3 6-7" />
              </svg>
            ) : null}
          </span>
          <span className="brr-stage-name">{copy.stages[step.stage]}</span>
          <span className={s.srOnly}>{stateLabel[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}

export function WorkspaceTeamHome(props: WorkspaceTeamHomeProps) {
  const { copy, organizationId } = props;
  const scope = (path: string) => scopedHref(path, { id: organizationId });
  const heading = interpolate(copy.home.heading, { name: props.organizationName });
  const request = props.canRequest ? (
    <a href={scope('/brand/projects/new')} className="bs-btn" data-variant="solid" data-size="md" data-home-action="commission">
      <Icon d={RAIL_ICON.commission} className={s.teamActionIcon} />
      <span>{copy.nav.commission}</span>
    </a>
  ) : null;
  const alertLine = (alert: RoomAlertItem) =>
    alert.kind === 'storyboard'
      ? interpolate(copy.inbox.alertStoryboard, { version: alert.version })
      : alert.openNotes > 0
        ? interpolate(copy.inbox.alertReviewNotes, { version: alert.version, count: alert.openNotes })
        : interpolate(copy.inbox.alertReview, { version: alert.version });
  const alertHref = (alert: RoomAlertItem) =>
    roomHref(alert.projectId, organizationId, alert.kind === 'storyboard' ? 'storyboard' : 'review', {
      [alert.kind === 'storyboard' ? 'board' : 'review']: alert.targetId,
    });
  const chats = props.projects.filter((p) => p.unread > 0);
  const waitingCount = props.reviews.length + chats.length;
  const fresh = props.totalProjects === 0;

  return (
    <div className={s.home} data-workspace-home={organizationId} data-follows-rail-mode="" data-home-mode="team" data-home-read-only={props.canRequest ? undefined : 'true'}>
      <header className={s.head}>
        <h1 className={s.name} title={heading}>
          {heading}
        </h1>
        {fresh ? null : request}
      </header>
      {props.viewerNote ? (
        <p className={s.note} data-home-viewer-note>
          {copy.home.viewerNote}
        </p>
      ) : null}
      {props.notice}
      {props.news && copy.brandNews ? <HomeNewsLine organizationId={organizationId} news={props.news} copy={copy.brandNews} /> : null}

      {waitingCount > 0 ? (
        <section className={s.block} aria-labelledby="workspace-home-waiting" data-home-team-waiting={waitingCount}>
          <h2 id="workspace-home-waiting" className={s.blockTitle}>
            <span>{copy.overview.todoTitle}</span>
            <span className={s.count}>{waitingCount}</span>
          </h2>
          <ul className={s.rows}>
            {props.reviews.slice(0, 5).map((alert) => (
              <li key={alert.id}>
                <a href={alertHref(alert)} className={s.row} data-home-review={alert.kind}>
                  <span className={s.rowText}>
                    <span className={s.rowTitle}>{alert.title || alert.projectTitle}</span>
                    <span className={s.rowMeta}>
                      {alert.projectTitle ? <span className={s.rowProject}>{alert.projectTitle}</span> : null}
                      <span className={s.rowState}>{alertLine(alert)}</span>
                    </span>
                  </span>
                  <Chevron className={s.rowArrow} />
                </a>
              </li>
            ))}
            {chats.map((project) => (
              <li key={`chat-${project.id}`}>
                <a href={roomHref(project.id, organizationId, 'chat')} className={s.row} data-home-chat={project.id}>
                  <span className={s.rowText}>
                    <span className={s.rowTitle}>{project.title}</span>
                    <span className={s.rowMeta}>
                      <span className={s.rowProject}>{copy.overview.todoChat}</span>
                      <span className={s.rowState}>{interpolate(copy.overview.todoChatLine, { count: project.unread })}</span>
                    </span>
                  </span>
                  <Chevron className={s.rowArrow} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fresh ? (
        <section className={s.teamEmpty} data-home-team-empty aria-labelledby="workspace-home-empty">
          <h2 id="workspace-home-empty" className={s.teamEmptyTitle}>
            {copy.space.empty.title}
          </h2>
          <p className={s.teamEmptyLine}>{copy.space.empty.body}</p>
          <StageLine steps={ROOM_STAGE_ORDER.map((stage) => ({ stage, state: 'ahead' as const }))} copy={copy.overview} />
          {request}
        </section>
      ) : (
        <section className={s.block} aria-labelledby="workspace-home-projects" data-home-team-projects={props.projects.length}>
          <h2 id="workspace-home-projects" className={s.blockTitle}>
            <span>{copy.space.title}</span>
            <span className={s.count}>{props.totalProjects}</span>
            <a href={scope('/brand')} className={s.blockLink} data-home-all-projects>
              {copy.space.list.all}
            </a>
          </h2>
          <ul className={s.teamProjects}>
            {props.projects.map((project) => (
              <li key={project.id}>
                <a href={roomHref(project.id, organizationId)} className={s.teamProject} data-home-project={project.id} data-home-project-stage={project.stage}>
                  <span className={s.teamProjectHead}>
                    <span className={s.teamProjectTitle}>{project.title}</span>
                    <span className={s.teamProjectStage}>
                      {copy.overview.stageNow} · {copy.overview.stages[project.stage]}
                    </span>
                    <Chevron className={s.rowArrow} />
                  </span>
                  <StageLine steps={project.steps} copy={copy.overview} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
