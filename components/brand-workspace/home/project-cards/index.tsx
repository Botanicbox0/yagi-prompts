/**
 * The 직접 만들기 home's project cards block, 미분류 row, and no-project guide line (docs/BRAND-PROJECT-SPINE.md §5).
 * Plain server markup except `NewProjectTrigger` (which opens slice 1b's `NewProjectForm` in a modal dialog).
 */
import Link from 'next/link';
import { LazyVideoCover } from '@/components/brand-studio/asset-hub-spine/lazy-video-cover';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { interpolate } from '@/lib/i18n/format';
import {
  brandArchiveHref,
  cardCoverLayout,
  cardHref,
  cardSecondLine,
  cardStatusMark,
  cardThirdLine,
  cardUnreadBadge,
  homeProjectsSwitch,
  isFinishedCard,
  parseProjectsFilter,
  projectCardsSlice,
  unfiledCoverSlots,
  unfiledTotal,
  unlistedProjectCount,
  type CoverSlot,
  type ProjectCardsCopy,
  type SpineHomeProps,
} from './model';
import { NewProjectTrigger } from './new-project-trigger';
import pc from './project-cards.module.css';

export type { ProjectCardsCopy, ProjectHomeCopy, SpineHomeProps } from './model';
export { NewProjectTrigger } from './new-project-trigger';
export const topRowClassName = pc.topRow;

function PlayGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 5.5v9l7.5-4.5z" />
    </svg>
  );
}

function CoverSlotPicture({
  slot,
  imgClassName,
  placeholderClassName,
}: {
  slot: CoverSlot;
  imgClassName?: string;
  placeholderClassName?: string;
}) {
  if (slot.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        className={imgClassName}
        src={slot.src}
        srcSet={slot.srcSet}
        sizes={slot.sizes}
        width={slot.width}
        height={slot.height}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  }
  if (slot.kind === 'video') {
    return <LazyVideoCover url={slot.url} className={placeholderClassName} />;
  }
  return (
    <span className={placeholderClassName} aria-hidden="true">
      <PlayGlyph />
    </span>
  );
}

export interface HomeProjectCardsProps {
  organizationId: string;
  locale: 'ko' | 'en';
  spineHome: SpineHomeProps;
  requestHref: string | null;
  requestActionKey?: string;
  copy: ProjectCardsCopy;
}

export function HomeProjectCards({
  organizationId,
  locale,
  spineHome,
  requestHref,
  requestActionKey,
  copy,
}: HomeProjectCardsProps) {
  const { cards, canCreate, roomsOpen, filter } = spineHome;
  const activeFilter = parseProjectsFilter(filter);
  const viewSwitch = homeProjectsSwitch(cards, activeFilter, organizationId, copy.projectHome);
  const switchNode = viewSwitch ? (
    <div className={pc.switchTrack} role="group" aria-label={copy.projectHome.blockTitle} data-home-projects-switch="">
      {[viewSwitch.active, viewSwitch.all].map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={pc.switchLink}
          aria-current={item.current ? 'page' : undefined}
          data-projects-filter={item.key}
        >
          <span>{item.label}</span>
          <span className={pc.switchNum}>{item.count}</span>
        </a>
      ))}
    </div>
  ) : null;

  const actions =
    canCreate || requestHref ? (
      <div className={pc.sectionActions}>
        {requestHref ? (
          <a href={requestHref} className={pc.textAction} data-home-action={requestActionKey ?? 'commission'}>
            {copy.projectHome.requestTeam}
          </a>
        ) : null}
        {canCreate ? <NewProjectTrigger organizationId={organizationId} copy={copy.projectSpine} /> : null}
      </div>
    ) : null;

  const totalUnfiled = unfiledTotal(cards.unfiled.counts);
  const unfiledThumbs = totalUnfiled > 0 ? unfiledCoverSlots(cards.unfiled.covers) : [];
  const assetsHref = scopedHref('/brand/library', { id: organizationId });
  const unfiledNode =
    totalUnfiled > 0 ? (
      <div className={pc.unfiled} data-home-unfiled={totalUnfiled}>
        <span className={pc.unfiledLabel}>{copy.projectSpine.unfiled}</span>
        {unfiledThumbs.length > 0 ? (
          <div className={pc.unfiledThumbs}>
            {unfiledThumbs.map((slot) => (
              <CoverSlotPicture
                key={slot.id}
                slot={slot}
                imgClassName={pc.unfiledThumb}
                placeholderClassName={pc.unfiledVideo}
              />
            ))}
          </div>
        ) : null}
        <span className={pc.unfiledSay}>{interpolate(copy.projectHome.unfiledLine, { n: totalUnfiled })}</span>
        {canCreate ? (
          <a href={assetsHref} className={pc.textAction} data-home-unfiled-move="">
            {copy.projectSpine.move}
          </a>
        ) : null}
      </div>
    ) : null;

  if (cards.projects.length === 0) {
    if (!switchNode) {
      return (
        <div className={pc.guideLine} data-home-no-projects="">
          <p className={pc.guideText}>{copy.projectHome.guideNoProject}</p>
          {actions}
        </div>
      );
    }
    return (
      <>
        <section className={pc.section} aria-labelledby="workspace-home-projects" data-home-projects="">
          <div className={pc.sectionHead}>
            <h2 id="workspace-home-projects" className={pc.sectionTitle}>
              {copy.projectHome.blockTitle}
            </h2>
            {switchNode}
            {actions}
          </div>
          <div className={pc.guideLine} data-home-no-projects="">
            <p className={pc.guideText}>{copy.projectHome.guideNoProject}</p>
          </div>
        </section>
        {unfiledNode}
      </>
    );
  }

  const renderNow = new Date();
  const { shown, hasMore } = projectCardsSlice(cards.projects);
  const archiveCount = unlistedProjectCount(cards, activeFilter);
  const moreHref =
    activeFilter === 'all' ? `${assetsHref}${assetsHref.includes('?') ? '&' : '?'}projects=all` : assetsHref;

  return (
    <>
      <section className={pc.section} aria-labelledby="workspace-home-projects" data-home-projects="">
        <div className={pc.sectionHead}>
          <h2 id="workspace-home-projects" className={pc.sectionTitle}>
            {copy.projectHome.blockTitle}
          </h2>
          {switchNode}
          {actions}
        </div>
        <ul className={pc.cards} data-home-cards="">
          {shown.map((card) => {
            const cover = cardCoverLayout(card.covers);
            const badge = cardUnreadBadge(card.unread, copy.projectHome);
            const secondLine = cardSecondLine(card, copy);
            const thirdLine = cardThirdLine(card, copy, locale, renderNow);
            const finished = isFinishedCard(card);
            const statusMark = cardStatusMark(card, copy.projectHome);
            return (
              <li key={card.project.id}>
                <a
                  href={cardHref(card, organizationId, roomsOpen)}
                  className={pc.card}
                  data-home-project={card.project.id}
                  data-origin={card.project.origin}
                  data-finished={finished ? '' : undefined}
                >
                  <div className={pc.cover} data-cover-layout={cover.mode}>
                    {cover.slots.length === 0 ? (
                      <span className={pc.coverEmpty} aria-hidden="true" />
                    ) : (
                      cover.slots.map((slot) => (
                        <CoverSlotPicture
                          key={slot.id}
                          slot={slot}
                          imgClassName={pc.coverImage}
                          placeholderClassName={pc.coverVideo}
                        />
                      ))
                    )}
                  </div>
                  <div className={pc.cardText}>
                    <div className={pc.cardTitleRow}>
                      <span className={pc.cardTitle}>{card.project.title}</span>
                      {statusMark ? (
                        <span className={pc.cardStatus} data-home-project-status={card.status ?? 'finished'}>
                          {statusMark}
                        </span>
                      ) : null}
                      {badge ? (
                        <span className={pc.cardUnread} data-home-project-unread={card.unread}>
                          <span aria-hidden="true">{badge.display}</span>
                          <span className="bw-sr-only">{badge.label}</span>
                        </span>
                      ) : null}
                    </div>
                    <div className={pc.cardMeta} data-home-project-second="">
                      {secondLine}
                    </div>
                    {thirdLine ? (
                      <div className={pc.cardMeta} data-home-project-third="">
                        {thirdLine}
                      </div>
                    ) : null}
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
        {hasMore || archiveCount > 0 ? (
          <div className={pc.moreRow}>
            {hasMore ? (
              <a href={moreHref} className={pc.textAction} data-home-projects-more="">
                {copy.libraryHub.projects.seeAll}
              </a>
            ) : null}
            {archiveCount > 0 ? (
              <Link
                href={brandArchiveHref(organizationId)}
                className={pc.textAction}
                data-home-projects-archive={archiveCount}
              >
                {interpolate(copy.projectHome.archiveLink, { n: archiveCount })}
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {unfiledNode}
    </>
  );
}
