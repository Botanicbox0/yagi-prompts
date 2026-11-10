/**
 * "룸 열기": the way from a campaign card or the project page into that project's room
 * (docs/BRAND-ROOMS.md §3, §7). Rendered only when `roomsOpenFor` says so; with rooms closed the pages
 * that carry it render exactly as before. No hooks: it works in server and client components alike.
 */
import { interpolate } from '@/lib/i18n/format';
import type { RoomsShellCopy } from '@/messages/rooms-shell';

export const ROOM_ICON = 'M3.5 4.5h10v7.5H8l-3 2.5v-2.5H3.5z M13.5 7.5h3v7H15v2l-2.6-2H9.5v-2.5';

export function RoomEntry({
  href,
  unread,
  copy,
  variant,
}: {
  href: string;
  unread: number;
  copy: RoomsShellCopy['entry'];
  /** `card`: a dark glass chip on a campaign card's picture. `header`: a white pill in the project header. */
  variant: 'card' | 'header';
}) {
  const count = Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
  return (
    <a href={href} className="brr-entry" data-room-entry={variant} data-room-unread={count > 0 ? count : undefined}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="brr-entry-icon">
        <path d={ROOM_ICON} />
      </svg>
      <span>{copy.open}</span>
      {count > 0 ? (
        <span className="brr-entry-badge">
          <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
          <span className="brr-sr">{interpolate(copy.unread, { count })}</span>
        </span>
      ) : null}
    </a>
  );
}
