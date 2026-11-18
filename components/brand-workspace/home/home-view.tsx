/**
 * The workspace home (`/brand/home`, docs/BRAND-STUDIO-V3.md §12): what this brand can do, and what is
 * waiting for it. Plain markup from the server; the credits line is the one client island.
 *
 * Techniques (docs/design/TOOLBOX.md §1-2), four: quiet wash cards with a double-ring hairline and the
 * top inset highlight, concentric radius (card 16 / icon well 10), tabular numerals on credits and
 * counts, and the brand's own results as the only media. No gradient, glow, stock or generated art; no
 * filled button (TASTE.md 16: at most one, and nothing here needs it).
 */
import type { ReactNode } from 'react';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { clock } from '@/components/brand-studio/rail/text';
import { RAIL_ICON } from '@/components/brand-workspace/rail-model';
import type { HomeAction, HomeActionKey, HomeGroupId, HomeResult } from '@/lib/brands/workspace/home';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { interpolate } from '@/lib/i18n/format';
import type { BrandHomeCopy } from '@/messages/brand-home';
import type { RoomsChatCopy } from '@/messages/rooms-chat';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import type { StudioShellCopy } from '@/messages/studio-shell';
import type { RailSummary } from '../rail-activity';
import { HomeCredits } from './home-credits';
import s from './home.module.css';

const ICON: Record<HomeActionKey, string> = {
  image: RAIL_ICON.image,
  video: RAIL_ICON.video,
  compose: RAIL_ICON.compose,
  workflows: RAIL_ICON.workflows,
  assets: RAIL_ICON.assets,
  commission: RAIL_ICON.commission,
  campaign: RAIL_ICON.campaigns,
};

export interface WorkspaceHomeProps {
  organizationId: string;
  organizationName: string;
  locale: 'ko' | 'en';
  actions: readonly HomeAction[];
  /** Project rooms are open: the cards fall into the rail's two groups. */
  grouped: boolean;
  allowance: RailSummary['allowance'] | null;
  /** Drafts and storyboards waiting for this member's decision, newest first (the inbox's own list). */
  reviews: readonly RoomAlertItem[];
  results: readonly HomeResult[];
  /** A viewer-role member: they open every screen, but making and requesting are for owners and editors. */
  readOnly: boolean;
  /** The TWINGS team view: the page's own staff notice, rendered by the page. */
  notice?: ReactNode;
  copy: {
    home: BrandHomeCopy;
    shell: StudioShellCopy;
    roomsNav: RoomsShellCopy['nav'];
    inbox: RoomsChatCopy['inbox'];
  };
}

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

const Arrow = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className={s.rowArrow}>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </svg>
);

export function WorkspaceHome(props: WorkspaceHomeProps) {
  const { copy, organizationId } = props;
  const h = copy.home;
  const scope = (path: string) => scopedHref(path, { id: organizationId });
  const name = (key: HomeActionKey): string =>
    key === 'commission'
      ? copy.roomsNav.commission
      : key === 'campaign'
        ? copy.shell.create.campaign
        : copy.shell.rail[key];
  const groups: Array<{ id: HomeGroupId; label: string | null; actions: HomeAction[] }> = props.grouped
    ? (['make', 'team'] as const)
        .map((id) => ({
          id,
          label: id === 'make' ? copy.roomsNav.groupMake : copy.roomsNav.groupTeam,
          actions: props.actions.filter((a) => a.group === id),
        }))
        .filter((g) => g.actions.length > 0)
    : [{ id: 'make', label: null, actions: [...props.actions] }];
  const reviewCount = props.reviews.length;
  const shownReviews = props.reviews.slice(0, 3);
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
  const hasContinue = reviewCount > 0 || props.results.length > 0;
  const titleId = 'workspace-home-title';
  const actionsId = 'workspace-home-actions';
  const continueId = 'workspace-home-continue';

  return (
    <div className={s.home} data-workspace-home={organizationId} data-home-read-only={props.readOnly ? 'true' : undefined}>
      <header className={s.head} aria-labelledby={titleId}>
        <h1 id={titleId} className={s.title}>
          {interpolate(h.heading, { name: props.organizationName })}
        </h1>
        <HomeCredits allowance={props.allowance} copy={copy.shell} locale={props.locale} className={s.credits} />
        {props.readOnly ? (
          <p className={s.note} data-home-viewer-note>
            {h.viewerNote}
          </p>
        ) : null}
      </header>
      {props.notice}

      <section className={s.actions} aria-labelledby={actionsId} data-home-actions={props.actions.length}>
        <h2 id={actionsId} className={s.srOnly}>
          {h.actionsTitle}
        </h2>
        <div className={s.groups} data-grouped={props.grouped ? 'true' : 'false'}>
          {groups.map((group) => {
            const labelId = `workspace-home-group-${group.id}`;
            return (
              <div
                key={group.id}
                className={s.group}
                data-home-group={group.id}
                data-count={group.actions.length}
                role="group"
                aria-labelledby={group.label ? labelId : undefined}
                style={{ ['--home-make-cols' as string]: Math.max(1, group.actions.length) }}
              >
                {group.label ? (
                  <p id={labelId} className={s.groupLabel}>
                    {group.label}
                  </p>
                ) : null}
                <ul className={s.cards}>
                  {group.actions.map((action) => (
                    <li key={action.key} className={s.cardItem}>
                      <a href={scope(action.path)} className={s.card} data-home-action={action.key}>
                        <span className={s.iconWell}>
                          <Icon d={ICON[action.key]} className={s.icon} />
                        </span>
                        <span className={s.cardText}>
                          <span className={s.cardName}>{name(action.key)}</span>
                          <span className={s.cardLine}>{h.lines[action.key]}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {hasContinue ? (
        <section className={s.continue} aria-labelledby={continueId} data-home-continue>
          <h2 id={continueId} className={s.sectionTitle}>
            {h.continueTitle}
          </h2>
          <div className={s.continueGrid} data-columns={reviewCount > 0 && props.results.length > 0 ? '2' : '1'}>
            {reviewCount > 0 ? (
              <div className={s.block} data-home-reviews={reviewCount}>
                <p className={s.blockTitle}>
                  <span>{copy.inbox.alertsHeading}</span>
                  <span className={s.count}>{reviewCount}</span>
                </p>
                <ul className={s.rows}>
                  {shownReviews.map((alert) => (
                    <li key={alert.id}>
                      <a href={alertHref(alert)} className={s.row} data-home-review={alert.kind}>
                        <span className={s.rowText}>
                          <span className={s.rowTitle}>{alert.title || alert.projectTitle}</span>
                          <span className={s.rowMeta}>
                            {alert.projectTitle ? `${alert.projectTitle} · ` : ''}
                            {alertLine(alert)}
                          </span>
                        </span>
                        <Arrow />
                      </a>
                    </li>
                  ))}
                </ul>
                {reviewCount > shownReviews.length ? (
                  <a href={scope('/brand/rooms')} className={s.more} data-home-reviews-more>
                    {interpolate(h.reviewMore, { count: reviewCount })}
                  </a>
                ) : null}
              </div>
            ) : null}
            {props.results.length > 0 ? (
              <div className={s.block} data-home-results={props.results.length}>
                <p className={s.blockTitle}>
                  <span>{h.recentTitle}</span>
                </p>
                <ul className={s.thumbs}>
                  {props.results.map((result) => (
                    <li key={result.outputId}>
                      <a
                        href={result.href}
                        className={s.thumb}
                        data-home-result={result.kind}
                        aria-label={result.kind === 'video' ? h.result.video : h.result.image}
                      >
                        {/* The brand's own result, through the studio's private media route. */}
                        {result.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={result.src} alt="" loading="lazy" decoding="async" />
                        ) : result.clip ? (
                          // A clip without a poster: its first frame, muted, never playing.
                          <video src={`${result.clip}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
                        ) : null}
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
            ) : null}
          </div>
        </section>
      ) : (
        <p className={s.empty} data-home-empty>
          {h.emptyLine}
        </p>
      )}
    </div>
  );
}
