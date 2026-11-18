/**
 * The workspace home (`/brand/home`, docs/BRAND-STUDIO-V3.md §12). One thing first: the prompt bar, with
 * the page's single filled button. Then the two big doors (이미지 스튜디오, 영상 스튜디오) showing the
 * brand's own newest result, the three compact tools and the YAGI team tile (a service: outlined, with
 * live facts). The lower half is "이어서 하기" (drafts to review, newest results) or, for a brand that has
 * made nothing yet, three starters.
 *
 * Plain markup from the server; the prompt bar, the starters and the credits line are client islands.
 * Techniques (docs/design/TOOLBOX.md §1-2), four: the studio dock's own surface for the prompt bar, media
 * doors with a dark glass plate that holds any picture at ≥ 7:1, concentric radius, tabular numerals.
 */
import type { ReactNode } from 'react';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { clock } from '@/components/brand-studio/rail/text';
import { RAIL_ICON } from '@/components/brand-workspace/rail-model';
import {
  HOME_DOOR_EXAMPLES,
  HOME_STARTERS,
  type HomeDoorKey,
  type HomeLayout,
  type HomeResult,
  type HomeTeamKey,
  type HomeToolKey,
} from '@/lib/brands/workspace/home';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { interpolate } from '@/lib/i18n/format';
import type { BrandHomeCopy } from '@/messages/brand-home';
import type { RoomsChatCopy } from '@/messages/rooms-chat';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import type { StudioShellCopy } from '@/messages/studio-shell';
import type { RailSummary } from '../rail-activity';
import { HomeCredits } from './home-credits';
import { HomePrompt, HomeStarterButton, type HomePromptCopy } from './home-actions';
import s from './home.module.css';

const ICON: Record<HomeDoorKey | HomeToolKey | HomeTeamKey, string> = {
  image: RAIL_ICON.image,
  video: RAIL_ICON.video,
  compose: RAIL_ICON.compose,
  workflows: RAIL_ICON.workflows,
  assets: RAIL_ICON.assets,
  commission: RAIL_ICON.commission,
  campaign: RAIL_ICON.campaigns,
  projects: RAIL_ICON.campaigns,
};

export interface WorkspaceHomeProps {
  organizationId: string;
  organizationName: string;
  locale: 'ko' | 'en';
  layout: HomeLayout;
  allowance: RailSummary['allowance'] | null;
  /** The brand's newest result of each kind, for the doors. */
  doors: Record<HomeDoorKey, HomeResult | null>;
  /** Drafts and storyboards waiting for this member's decision, newest first (the inbox's own list). */
  reviews: readonly RoomAlertItem[];
  /** Newest results, at most 8. */
  results: readonly HomeResult[];
  /** Projects in progress, for the team tile's facts. */
  activeProjects: number;
  /** A viewer-role member or the team view: no prompt bar, no request. */
  readOnly: boolean;
  /** A viewer-role member: one line saying who can create and request. */
  viewerNote?: boolean;
  /** The TWINGS team view's own notice, rendered by the page. */
  notice?: ReactNode;
  copy: {
    home: BrandHomeCopy;
    shell: StudioShellCopy;
    roomsNav: RoomsShellCopy['nav'];
    roomTabCounts: RoomsShellCopy['room']['tabCounts'];
    /** How a project goes (의뢰 접수 · 스토리보드 · 시안 · 수정 · 완료): shown on the team tile while there are no facts. */
    roomStages: RoomsShellCopy['overview']['stages'];
    inbox: RoomsChatCopy['inbox'];
    prompt: Pick<HomePromptCopy, 'label' | 'placeholder'>;
    activeStatus: string;
  };
}

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

/** A result's picture: the image or poster, a clip's still first frame, never playing. */
function ResultPicture({ result }: { result: HomeResult }) {
  if (result.src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={result.src} alt="" loading="lazy" decoding="async" />;
  }
  if (result.clip) return <video src={`${result.clip}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />;
  return null;
}

export function WorkspaceHome(props: WorkspaceHomeProps) {
  const { copy, organizationId, layout } = props;
  const h = copy.home;
  const scope = (path: string) => scopedHref(path, { id: organizationId });
  const toolName = (key: HomeToolKey) => copy.shell.rail[key];
  const doorName = (key: HomeDoorKey) => copy.shell.rail[key];
  const teamName =
    layout.team.key === 'commission' ? copy.roomsNav.commission : layout.team.key === 'campaign' ? copy.shell.create.campaign : copy.shell.rail.campaigns;
  const teamLine = layout.team.key === 'projects' ? h.lines.projects : layout.team.key === 'commission' ? h.lines.commission : h.lines.campaign;
  const reviewCount = props.reviews.length;
  const shownReviews = props.reviews.slice(0, 3);
  const facts = [
    props.activeProjects > 0 ? `${copy.activeStatus} ${props.activeProjects}` : null,
    reviewCount > 0 ? interpolate(copy.roomTabCounts.review, { count: reviewCount }) : null,
  ].filter((fact): fact is string => Boolean(fact));
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
  const lower = reviewCount > 0 ? 'split' : 'full';

  return (
    <div className={s.home} data-workspace-home={organizationId} data-home-read-only={props.readOnly ? 'true' : undefined} data-home-state={hasResults ? 'content' : 'empty'}>
      <header className={s.head}>
        <h1 className={s.title} title={heading}>
          {heading}
        </h1>
        <HomeCredits allowance={props.allowance} copy={copy.shell} locale={props.locale} className={s.credits} />
      </header>
      {props.viewerNote ? (
        <p className={s.note} data-home-viewer-note>
          {h.viewerNote}
        </p>
      ) : null}
      {props.notice}

      {props.readOnly ? null : (
        <HomePrompt
          organizationId={organizationId}
          hrefs={studioHref}
          copy={{ ...copy.prompt, medium: h.prompt.medium, mediumLabel: `${h.prompt.medium.image} / ${h.prompt.medium.video}`, button: h.prompt.button, hint: h.prompt.hint }}
        />
      )}

      <section className={s.tools} aria-labelledby="workspace-home-make" data-home-tools>
        <p id="workspace-home-make" className={s.label}>
          {copy.roomsNav.groupMake}
        </p>
        <ul className={s.doors} data-home-doors>
          {layout.doors.map((door) => {
            const result = props.doors[door.key];
            return (
              <li key={door.key}>
                <a href={scope(door.path)} className={s.door} data-home-action={door.key} data-home-door={door.key} data-door-picture={result ? 'own' : 'example'}>
                  <span className={s.doorPicture}>
                    {result ? (
                      <ResultPicture result={result} />
                    ) : (
                      // A house frame, marked as an example (lib/brands/workspace/home.ts HOME_DOOR_EXAMPLES).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={HOME_DOOR_EXAMPLES[door.key]} alt="" loading="eager" decoding="async" />
                    )}
                  </span>
                  {result ? null : (
                    <span className={s.exampleBadge} data-home-example>
                      {h.exampleBadge}
                    </span>
                  )}
                  <span className={s.doorPlate}>
                    <Icon d={ICON[door.key]} className={s.doorIcon} />
                    <span className={s.doorText}>
                      <span className={s.doorName}>{doorName(door.key)}</span>
                      <span className={s.doorLine}>{h.lines[door.key]}</span>
                    </span>
                    <Chevron className={s.doorArrow} />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className={s.team} data-home-team={layout.team.key}>
          <a href={scope(layout.team.path)} className={s.teamMain} data-home-action={layout.team.key}>
            <span className={s.teamEyebrow}>{copy.roomsNav.groupTeam}</span>
            <span className={s.teamName}>
              <Icon d={ICON[layout.team.key]} className={s.teamIcon} />
              <span>{teamName}</span>
            </span>
            <span className={s.teamLine}>{teamLine}</span>
          </a>
          {layout.team.key === 'campaign' ? null : (
            // How a project with the team goes, in the rooms' own words.
            <ol className={s.stages} data-home-team-stages>
              {(['requested', 'storyboard', 'draft', 'revision', 'done'] as const).map((stage) => (
                <li key={stage}>{copy.roomStages[stage]}</li>
              ))}
            </ol>
          )}
          {facts.length > 0 ? (
            <a href={scope('/brand')} className={s.teamFacts} data-home-team-facts>
              {facts.map((fact) => (
                <span key={fact} className={s.fact}>
                  {fact}
                </span>
              ))}
              <Chevron className={s.factArrow} />
            </a>
          ) : null}
        </div>
        <ul className={s.toolList} data-count={layout.tools.length}>
          {layout.tools.map((tool) => (
            <li key={tool.key}>
              <a href={scope(tool.path)} className={s.tool} data-home-action={tool.key}>
                <span className={s.toolIcon}>
                  <Icon d={ICON[tool.key]} />
                </span>
                <span className={s.toolText}>
                  <span className={s.toolName}>{toolName(tool.key)}</span>
                  <span className={s.toolLine}>{h.lines[tool.key]}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.lower} aria-label={h.continueTitle} data-home-lower={lower} data-home-continue={hasResults || reviewCount > 0 ? '' : undefined}>
        {reviewCount > 0 ? (
          <div className={s.block} data-home-reviews={reviewCount}>
            <h2 className={s.blockTitle}>
              <span>{copy.inbox.alertsHeading}</span>
              <span className={s.count}>{reviewCount}</span>
            </h2>
            <ul className={s.rows}>
              {shownReviews.map((alert) => (
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
            </ul>
            {reviewCount > 0 ? (
              <a href={scope('/brand/rooms')} className={s.more} data-home-reviews-more>
                {interpolate(h.reviewMore, { count: reviewCount })}
              </a>
            ) : null}
          </div>
        ) : null}
        {hasResults ? (
          <div className={s.block} data-home-results={props.results.length}>
            <h2 className={s.blockTitle}>
              <span>{h.recentTitle}</span>
            </h2>
            <ul className={s.thumbs} data-count={props.results.length} style={{ ['--home-thumb-cols' as string]: Math.max(6, props.results.length) }}>
              {props.results.map((result) => (
                <li key={result.outputId}>
                  <a href={result.href} className={s.thumb} data-home-result={result.kind} aria-label={result.kind === 'video' ? h.result.video : h.result.image}>
                    <ResultPicture result={result} />
                    {result.kind === 'video' ? (
                      <span className={s.badge} aria-hidden="true">
                        {result.seconds !== null ? (
                          clock(result.seconds)
                        ) : (
                          <svg viewBox="0 0 20 20">
                            <path d="M7 5.5v9l7.5-4.5z" />
                          </svg>
                        )}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className={s.block} data-home-starters data-layout={lower === 'split' ? 'list' : 'cards'}>
            <h2 className={s.blockTitle}>
              <span>{h.starters.title}</span>
            </h2>
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
                        <span className={s.starterMeta}>{h.prompt.medium[starter.medium]}</span>
                        <span className={s.starterName}>{h.starters[starter.key].name}</span>
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
          </div>
        )}
      </section>
    </div>
  );
}
