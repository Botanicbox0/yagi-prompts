/**
 * The first line of a room's conversation: the request itself ("의뢰를 접수했어요" + the project title,
 * dated when the project was created), with a way back to what was sent (파일 > 기획서).
 *
 * Read from the project, not stored as a message: an event row must point at a storyboard or a deliverable
 * (0082 `brand_room_messages_event` / `_ref_key`), and a request has neither. Being derived, it is never
 * unread for anyone. Server component.
 */
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import type { RoomProject } from '@/lib/brand-rooms/overview';

export function RoomRequestedLine({
  project,
  copy,
  locale,
  briefHref,
}: {
  project: Pick<RoomProject, 'title' | 'createdAt'>;
  copy: RoomsShellCopy['overview'];
  locale: 'ko' | 'en';
  briefHref: string;
}) {
  const when = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  });
  const at = Number.isNaN(Date.parse(project.createdAt)) ? null : project.createdAt;
  return (
    <div className="brr-requested" data-room-requested>
      <span className="brr-activity-dot" aria-hidden="true" />
      <p className="brr-requested-text">
        <strong>{copy.activity.requested}</strong>
        <span className="brr-requested-title">{project.title}</span>
        {at ? <time dateTime={at}>{when.format(new Date(at))}</time> : null}
      </p>
      <a className="brr-requested-link" href={briefHref} data-room-requested-brief>
        {copy.received.brief}
      </a>
    </div>
  );
}
