/**
 * The room's head and tab bar (docs/BRAND-ROOMS.md §7): back to 의뢰, the project, its track and status,
 * the people in the room with the YAGI team, a link to the campaign page (creator campaigns only), then 개요 · 스토리보드 ·
 * 시안 · 대화 as links (`?tab=`) with the count of what waits in each.
 *
 * Server component. Techniques (docs/design/TOOLBOX.md §1-2): large bold title, concentric radius on the
 * pill tab track (a recessed `--ys-raised` well with a white pill, TASTE §12), tabular numerals on counts.
 */
import { interpolate } from '@/lib/i18n/format';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import type { RoomPerson, RoomProject, RoomTab } from '@/lib/brand-rooms/overview';

const FACES = 5;

export function RoomHeader({
  project,
  people,
  copy,
  statusLabel,
  backHref,
  detailHref,
}: {
  project: RoomProject;
  people: RoomPerson[];
  copy: RoomsShellCopy['room'];
  statusLabel: string;
  backHref: string;
  /** The campaign page with its creators and results; only a creator campaign has one worth opening. */
  detailHref: string | null;
}) {
  const shown = people.slice(0, FACES);
  const rest = people.length - shown.length;
  return (
    <header className="brr-head" data-room-head={project.id}>
      <div className="brr-head-top">
        <a className="brr-back" href={backHref} data-room-back>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M11.5 5.5 7 10l4.5 4.5" />
          </svg>
          {copy.back}
        </a>
        {detailHref ? (
          <a className="brr-detail" href={detailHref} data-room-detail>
            {copy.detail}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7.5 12.5l5-5M8.5 7.5h4v4" />
            </svg>
          </a>
        ) : null}
      </div>
      <div className="brr-head-main">
        <div className="brr-head-title">
          <p className="brr-meta">
            <span className="brr-track" data-room-track={project.track}>
              {copy.tracks[project.track]}
            </span>
            <span className="bw-status" data-state={project.status}>
              {statusLabel}
            </span>
          </p>
          <h1>{project.title}</h1>
        </div>
        <div className="brr-people" data-room-people role="group" aria-label={copy.people}>
          {shown.length > 0 ? (
            <ul className="brr-faces">
              {shown.map((person) => (
                <li key={person.id} className="brr-face" title={person.name ?? copy.member}>
                  <span aria-hidden="true">{person.initials}</span>
                  <span className="brr-sr">{person.name ?? copy.member}</span>
                </li>
              ))}
              {rest > 0 ? (
                <li className="brr-face brr-face-more">
                  <span>{interpolate(copy.more, { count: rest })}</span>
                </li>
              ) : null}
            </ul>
          ) : null}
          <span className="brr-team-chip" data-room-team>
            <span className="brr-team-dot" aria-hidden="true" />
            {copy.team}
          </span>
        </div>
      </div>
    </header>
  );
}

export interface RoomTabLink {
  tab: RoomTab;
  href: string;
  count: number;
}

export function RoomTabs({ tabs, current, copy }: { tabs: RoomTabLink[]; current: RoomTab; copy: RoomsShellCopy['room'] }) {
  return (
    <nav className="brr-tabs" aria-label={copy.tabs.label} data-room-tabs>
      <ul>
        {tabs.map(({ tab, href, count }) => (
          <li key={tab}>
            <a href={href} data-room-tab={tab} aria-current={tab === current ? 'page' : undefined}>
              <span>{copy.tabs[tab]}</span>
              {count > 0 && tab !== 'overview' ? (
                <span className="brr-tab-count" data-room-tab-count={count}>
                  <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
                  <span className="brr-sr">{interpolate(copy.tabCounts[tab], { count })}</span>
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
