/**
 * The workspace home (`/brand/home`, docs/BRAND-STUDIO-V3.md §12), on the 직접 만들기 side: one prompt bar,
 * what waits for this member as thin lines, and the brand's newest work as a wall.
 *
 * The rail already lists every tool, so the home repeats none of them (no tool cards, no credits sentence:
 * the rail's meter is the one place credits are read). The prompt bar is the page's only surface and holds
 * its only filled button. Everything under it is unboxed: lines divided by hairlines, then pictures at their
 * own proportions in rows of one height. A brand that has made nothing yet gets the first-run guide and
 * three starters in the same grammar.
 *
 * Plain markup from the server; the prompt bar, the starters, the guide and the wall's tiles (a clip plays,
 * muted, while the pointer is on it) are client islands.
 * Techniques (docs/design/TOOLBOX.md §1-2), four: the studio dock's own surface for the prompt bar, hairline
 * rows instead of cards, a justified wall (Gallery Passepartout: the pictures are the page), tabular numerals.
 */
import type { ReactNode } from 'react';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { HOME_STARTERS, homeTileRatio, homeWallRows, type HomeDoorKey, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import type { BillingPlanCatalogueItem } from '@/lib/brands/billing-ui';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { interpolate } from '@/lib/i18n/format';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import type { BrandHomeCopy } from '@/messages/brand-home';
import type { RoomsChatCopy } from '@/messages/rooms-chat';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import type { StudioShellCopy } from '@/messages/studio-shell';
import type { RailSummary } from '../rail-activity';
import { FirstRunChecklist } from './first-run-checklist';
import { WorkspaceBell } from '../bell';
import { HomePrompt, HomeStarterButton, HomeWallTile, type HomePromptCopy } from './home-actions';
import { HomeNewsLine, type BrandNewsCopy } from './news-line';
import { HomeProjectCards, topRowClassName, type ProjectCardsCopy, type SpineHomeProps } from './project-cards';
import s from './home.module.css';

/** How many waiting drafts get a line of their own before the rest fold into "모두 보기". */
const REVIEW_LINES = 2;

type BaseHomeCopy = {
  home: BrandHomeCopy;
  shell: StudioShellCopy;
  roomsNav: RoomsShellCopy['nav'];
  inbox: RoomsChatCopy['inbox'];
  prompt: Pick<HomePromptCopy, 'label' | 'placeholder'>;
  activeStatus: string;
  /** The asset hub's own name, for the wall's one link out (shown where the brand has the hub). */
  allAssets: string;
  closedRequestDraft?: string;
  closedRequestOrgFallback?: string;
  billingCustomer?: BrandBillingCopy['customer'];
  brandNews?: BrandNewsCopy;
};

type WorkspaceHomeBaseProps = {
  organizationId: string;
  organizationName: string;
  locale: 'ko' | 'en';
  layout: HomeLayout;
  /** Read by the first-run guide only (which window "이용 가능" speaks of); the home shows no credits itself. */
  allowance: RailSummary['allowance'] | null;
  /** Drafts and storyboards waiting for this member's decision, newest first (the inbox's own list). */
  reviews: readonly RoomAlertItem[];
  /** Newest results, at most `HOME_WALL_LIMIT`. */
  results: readonly HomeResult[];
  /** Projects in progress, for the team line's facts. */
  activeProjects: number;
  /** A viewer-role member or the team view: no prompt bar, no request. */
  readOnly: boolean;
  /** A viewer-role member: one line saying who can create and request. */
  viewerNote?: boolean;
  /** The TWINGS team view's own notice, rendered by the page. */
  notice?: ReactNode;
  /** First-run onboarding checklist state derived from existing tables (C1 Item 2). */
  checklist?: FirstRunChecklistState | null;
  canOpenBilling?: boolean;
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  /** Live announcement for the home's news line (slice 3b); omitted when closed or absent. */
  news?: HomeAnnouncement | null;
};

export type WorkspaceHomeProps =
  | (WorkspaceHomeBaseProps & {
      /** Brand project spine (slice 3a): omitted when closed or non-member. */
      spineHome?: undefined;
      copy: BaseHomeCopy & Partial<ProjectCardsCopy>;
    })
  | (WorkspaceHomeBaseProps & {
      /** Brand project spine (slice 3a): requires all four spine copy groups when present. */
      spineHome: SpineHomeProps;
      copy: BaseHomeCopy & ProjectCardsCopy;
    });

const Chevron = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </svg>
);

export function WorkspaceHome(props: WorkspaceHomeProps) {
  const { copy, organizationId, layout } = props;
  const h = copy.home;
  const scope = (path: string) => scopedHref(path, { id: organizationId });
  const teamName =
    layout.team.key === 'commission' ? copy.roomsNav.commission : layout.team.key === 'campaign' ? copy.shell.create.campaign : copy.shell.rail.campaigns;
  const teamLine = layout.team.key === 'projects' ? h.lines.projects : layout.team.key === 'commission' ? h.lines.commission : h.lines.campaign;
  const reviewCount = props.reviews.length;
  const shownReviews = props.reviews.slice(0, REVIEW_LINES);
  // The team line says how many projects are under way; what waits for a decision already has its own lines above.
  const teamFact = props.activeProjects > 0 ? `${copy.activeStatus} ${props.activeProjects}` : null;
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
  const hasResults = props.results.length > 0;
  const studioHref: Record<HomeDoorKey, string> = { image: scope('/brand/studio'), video: scope('/brand/studio/video') };
  const heading = interpolate(h.heading, { name: props.organizationName });
  const hasAssets = layout.tools.some((tool) => tool.key === 'assets');
  const wall = homeWallRows(props.results, homeTileRatio);
  const spineHome = props.spineHome;
  const spineCopy: ProjectCardsCopy | null = props.spineHome
    ? {
        projectHome: props.copy.projectHome,
        projectSpine: props.copy.projectSpine,
        libraryHub: props.copy.libraryHub,
        roomsOverview: props.copy.roomsOverview,
      }
    : null;
  const showWorkWall = !spineHome || spineHome.cards.projects.length === 0;
  const headingNode = (
    <h1 className={s.name} title={heading}>
      {heading}
    </h1>
  );

  return (
    <div className={s.home} data-workspace-home={organizationId} data-follows-rail-mode="" data-home-mode="make" data-home-read-only={props.readOnly ? 'true' : undefined} data-home-state={hasResults ? 'content' : 'empty'}>
      {/* The page's heading is the workspace's name, said quietly: the prompt bar is what the eye lands on. */}
      {spineHome ? (
        <div className={topRowClassName} data-home-top-row="">
          {headingNode}
          <WorkspaceBell />
        </div>
      ) : (
        headingNode
      )}
      {props.viewerNote ? (
        <p className={s.note} data-home-viewer-note>
          {h.viewerNote}
        </p>
      ) : null}
      {props.notice}
      {props.news && copy.brandNews ? <HomeNewsLine organizationId={organizationId} news={props.news} copy={copy.brandNews} /> : null}

      {props.readOnly ? null : (
        <HomePrompt
          organizationId={organizationId}
          hrefs={studioHref}
          copy={{ ...copy.prompt, medium: h.prompt.medium, mediumLabel: `${h.prompt.medium.image} / ${h.prompt.medium.video}`, button: h.prompt.button, hint: h.prompt.hint }}
        />
      )}

      {spineHome && spineCopy ? (
        <HomeProjectCards
          organizationId={organizationId}
          locale={props.locale}
          spineHome={spineHome}
          requestHref={spineHome.canCreate && layout.team.key !== 'projects' ? scope(layout.team.path) : null}
          requestActionKey={layout.team.key !== 'projects' ? layout.team.key : undefined}
          copy={spineCopy}
        />
      ) : (
        /* What waits, one line each; a line exists only while there is something to say. Each group names itself. */
        <div className={s.lines} data-home-lines>
          {reviewCount > 0 ? (
            <div className={s.lineGroup} data-home-reviews={reviewCount}>
              <h2 className={s.lineLabel}>
                <span>{copy.inbox.alertsHeading}</span>
                <span className={s.count}>{reviewCount}</span>
              </h2>
              <ul className={s.lineRows}>
                {shownReviews.map((alert) => (
                  <li key={alert.id}>
                    <a href={alertHref(alert)} className={s.line} data-home-review={alert.kind}>
                      <span className={s.lineTitle}>{alert.title || alert.projectTitle}</span>
                      <span className={s.lineMeta}>
                        {alert.projectTitle && alert.title ? <span className={s.lineProject}>{alert.projectTitle}</span> : null}
                        <span>{alertLine(alert)}</span>
                      </span>
                      <Chevron className={s.lineArrow} />
                    </a>
                  </li>
                ))}
                {reviewCount > shownReviews.length ? (
                  <li>
                    <a href={scope('/brand/rooms')} className={s.lineMore} data-home-reviews-more>
                      {interpolate(h.reviewMore, { count: reviewCount })}
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <div className={s.lineGroup} data-home-team={layout.team.key}>
            <h2 className={s.lineLabel}>
              <span>{copy.roomsNav.groupTeam}</span>
            </h2>
            <div className={s.teamRow}>
              {teamFact ? (
                <a href={scope('/brand')} className={s.line} data-home-team-facts>
                  <span className={`${s.lineTitle} ${s.fact}`}>{teamFact}</span>
                </a>
              ) : (
                <p className={s.teamSay}>{teamLine}</p>
              )}
              <a href={scope(layout.team.path)} className={`${s.textLink} ${s.rowAction}`} data-home-action={layout.team.key}>
                {teamName}
                <Chevron className={s.lineArrow} />
              </a>
            </div>
          </div>
        </div>
      )}

      {!props.readOnly && props.checklist?.show ? (
        <FirstRunChecklist
          organizationId={organizationId}
          organizationName={props.organizationName}
          locale={props.locale}
          checklist={props.checklist}
          copy={h.checklist}
          billingCopy={copy.billingCustomer}
          planCatalogue={props.planCatalogue}
          canOpenBilling={props.canOpenBilling}
          closedRequestDraft={copy.closedRequestDraft}
          closedRequestOrgFallback={copy.closedRequestOrgFallback}
          allowanceWindow={props.allowance?.window ?? null}
        />
      ) : null}

      {showWorkWall ? (
        hasResults ? (
          <section className={s.work} aria-labelledby="workspace-home-recent" data-home-results={props.results.length}>
            <div className={s.workHead}>
              <h2 id="workspace-home-recent" className={s.workTitle}>
                {h.recentTitle}
              </h2>
              {hasAssets ? (
                <a href={scope('/brand/library')} className={s.textLink} data-home-action="assets">
                  {copy.allAssets}
                </a>
              ) : null}
            </div>
            <div className={s.wall} data-home-wall>
              {wall.map((row, index) => (
                <ul key={index} className={s.wallRow} data-home-wall-row={row.items.length}>
                  {row.items.map(({ item, ratio }) => (
                    <li key={item.outputId} style={{ flexGrow: ratio, aspectRatio: String(ratio) }}>
                      <HomeWallTile
                        href={item.href}
                        kind={item.kind}
                        src={item.src}
                        clip={item.clip}
                        play={item.play}
                        seconds={item.seconds}
                        label={item.kind === 'video' ? h.result.video : h.result.image}
                      />
                    </li>
                  ))}
                  {/* A short last row keeps a full row's height: the rest of the line stays open. */}
                  {row.rest > 0 ? <li aria-hidden="true" className={s.wallRest} style={{ flexGrow: row.rest }} /> : null}
                </ul>
              ))}
            </div>
          </section>
        ) : (
          <section className={s.work} aria-labelledby="workspace-home-starters" data-home-starters>
            <div className={s.workHead}>
              <h2 id="workspace-home-starters" className={s.workTitle}>
                {h.starters.title}
              </h2>
            </div>
            <ul className={s.starters}>
              {HOME_STARTERS.map((starter) => (
                <li key={starter.key}>
                  {props.readOnly ? (
                    <a href={studioHref[starter.medium]} className={s.starter} data-home-starter={starter.key} data-medium={starter.medium}>
                      <span className={s.starterPicture}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={starter.picture} alt="" loading="lazy" decoding="async" />
                      </span>
                      <span className={s.starterText}>
                        <span className={s.starterName}>
                          <span className={s.starterMeta}>{h.prompt.medium[starter.medium]}</span>
                          {h.starters[starter.key].name}
                        </span>
                        <span className={s.starterPrompt}>{h.starters[starter.key].prompt}</span>
                      </span>
                    </a>
                  ) : (
                    <HomeStarterButton
                      starter={{ ...starter, name: h.starters[starter.key].name, prompt: h.starters[starter.key].prompt }}
                      organizationId={organizationId}
                      href={studioHref[starter.medium]}
                      mediumLabel={h.prompt.medium[starter.medium]}
                      actionLabel={h.prompt.button}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      ) : null}
    </div>
  );
}
