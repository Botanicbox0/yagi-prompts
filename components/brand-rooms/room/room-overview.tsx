/**
 * The room's 개요 tab (docs/BRAND-ROOMS.md §7): the stage line (의뢰 접수 → 스토리보드 → 시안 → 수정 →
 * 완료, dated where the data says so), "지금 확인할 것" with a link into the tab that holds each item, and
 * the five latest activities. A request nobody has answered with work yet opens with the "we got it" note
 * (and a way back to what was sent); any other empty room opens with a one-line explanation.
 *
 * Server component; the explanation is the shared client `Explainer` (components/brand-studio/explainer.tsx).
 * Techniques (docs/design/TOOLBOX.md §1-2): architectural hairlines on the stage line, white cards on the
 * alabaster page with a double-ring border, tabular numerals on dates and counts.
 */
import { Explainer } from '@/components/brand-studio/explainer';
import { interpolate } from '@/lib/i18n/format';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import type { RoomActivity, RoomOverview as Overview, RoomTab, RoomTodo } from '@/lib/brand-rooms/overview';

export const ROOM_EXPLAINER_KEY = 'twings_brand_room_explainer_v1';

type Href = (tab: RoomTab, extra?: Record<string, string>) => string;

const formatter = (locale: 'ko' | 'en', withTime: boolean) =>
  new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Seoul',
  });

function todoLink(todo: RoomTodo, href: Href): string {
  if (todo.kind === 'storyboard') return href('storyboard', { board: todo.id });
  if (todo.kind === 'review') return href('review', { review: todo.id });
  return href('chat');
}

/** The brief the client sent: the files tab opened on 기획서. */
export const briefHref = (href: Href): string => href('files', { category: 'brief' });

function activityLink(item: RoomActivity, href: Href): string {
  if (item.kind === 'requested') return briefHref(href);
  if (item.kind === 'message') return href('chat');
  if (item.kind.startsWith('board')) return href('storyboard', item.targetId ? { board: item.targetId } : {});
  return href('review', item.targetId ? { review: item.targetId } : {});
}

function activityLine(item: RoomActivity, copy: RoomsShellCopy['overview']['activity']): string {
  if (item.kind !== 'message') return copy[item.kind];
  if (item.authorRole === 'studio') return copy.messageTeam;
  return item.authorName ? interpolate(copy.messageNamed, { name: item.authorName }) : copy.messageMember;
}

export function RoomOverview({
  overview,
  copy,
  locale,
  href,
}: {
  overview: Overview;
  copy: RoomsShellCopy['overview'];
  locale: 'ko' | 'en';
  href: Href;
}) {
  const day = formatter(locale, false);
  const moment = formatter(locale, true);
  const stateLabel = { done: copy.stageDone, current: copy.stageNow, skipped: copy.stageAhead, ahead: copy.stageAhead } as const;
  return (
    <div className="brr-overview" data-room-overview data-room-stage={overview.stage}>
      {overview.received ? (
        <section className="brr-card brr-received" data-room-received aria-labelledby="brr-received-title">
          <h2 id="brr-received-title">{copy.received.title}</h2>
          <p className="brr-received-line">{copy.received.line}</p>
          <div className="brr-received-actions">
            <a className="brr-received-primary" href={briefHref(href)} data-room-received-brief>
              {copy.received.brief}
            </a>
            <a className="brr-received-secondary" href={href('chat')} data-room-received-chat>
              {copy.received.chat}
            </a>
          </div>
        </section>
      ) : overview.empty ? (
        <Explainer
          storageKey={ROOM_EXPLAINER_KEY}
          title={copy.explainer.title}
          line={copy.explainer.line}
          actions={[{ label: copy.explainer.action, href: href('chat'), primary: true }]}
          steps={[]}
          dismissLabel={copy.explainer.dismiss}
          reopenLabel={copy.explainer.reopen}
          className="brr-explainer"
        />
      ) : null}

      <section className="brr-card brr-stages" data-room-stages aria-labelledby="brr-stages-title">
        <h2 id="brr-stages-title">{copy.stageTitle}</h2>
        <ol className="brr-stage-line">
          {overview.steps.map((step) => (
            <li key={step.stage} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
              <span className="brr-stage-dot" aria-hidden="true">
                {step.state === 'done' ? (
                  <svg viewBox="0 0 20 20">
                    <path d="M5.5 10.5l3 3 6-7" />
                  </svg>
                ) : null}
              </span>
              <span className="brr-stage-name">{copy.stages[step.stage]}</span>
              <span className="brr-stage-date">
                {step.at && step.state !== 'ahead' && step.state !== 'skipped' ? (
                  <time dateTime={step.at}>{day.format(new Date(step.at))}</time>
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </span>
              <span className="brr-sr">{stateLabel[step.state]}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="brr-overview-grid">
        <section className="brr-card" data-room-todo={overview.todos.length} aria-labelledby="brr-todo-title">
          <h2 id="brr-todo-title">
            {copy.todoTitle}
            {overview.todos.length > 0 ? <span className="brr-count">{overview.todos.length}</span> : null}
          </h2>
          {overview.todos.length > 0 ? (
            <ul className="brr-todo">
              {overview.todos.map((todo) => (
                <li key={todo.kind === 'chat' ? 'chat' : `${todo.kind}:${todo.id}`}>
                  <a href={todoLink(todo, href)} data-room-todo-item={todo.kind}>
                    <span className="brr-todo-icon" data-kind={todo.kind} aria-hidden="true">
                      <svg viewBox="0 0 20 20">
                        <path
                          d={
                            todo.kind === 'storyboard'
                              ? 'M3 4.5h6v5H3z M11 4.5h6v5h-6z M3 11.5h6v4H3z M11 11.5h6v4h-6z'
                              : todo.kind === 'review'
                                ? 'M3 5.5h10v9H3z M13 8.6l4-2.4v7.6l-4-2.4'
                                : 'M3.5 4.5h10v7.5H8l-3 2.5v-2.5H3.5z M13.5 7.5h3v7H15v2l-2.6-2H9.5v-2.5'
                          }
                        />
                      </svg>
                    </span>
                    <span className="brr-todo-text">
                      <span className="brr-todo-kind">
                        {todo.kind === 'storyboard'
                          ? interpolate(copy.todoBoard, { version: todo.version })
                          : todo.kind === 'review'
                            ? interpolate(copy.todoReview, { version: todo.version })
                            : copy.todoChat}
                      </span>
                      <strong>{todo.kind === 'chat' ? interpolate(copy.todoChatLine, { count: todo.unread }) : todo.title}</strong>
                      {todo.kind === 'review' ? (
                        <span className="brr-todo-note">
                          {todo.openNotes > 0 ? interpolate(copy.todoReviewNotes, { count: todo.openNotes }) : copy.todoReviewWaiting}
                        </span>
                      ) : null}
                    </span>
                    <span className="brr-todo-go">
                      {todo.kind === 'storyboard' ? copy.todoBoardAction : todo.kind === 'review' ? copy.todoReviewAction : copy.todoChatAction}
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M8 5.5l4.5 4.5L8 14.5" />
                      </svg>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="brr-empty">{copy.todoEmpty}</p>
          )}
        </section>

        <section className="brr-card" data-room-activity={overview.activity.length} aria-labelledby="brr-activity-title">
          <h2 id="brr-activity-title">{copy.activityTitle}</h2>
          {overview.activity.length > 0 ? (
            <ol className="brr-activity">
              {overview.activity.map((item) => (
                <li key={item.key}>
                  <a href={activityLink(item, href)} data-room-activity-item={item.kind}>
                    <span className="brr-activity-dot" data-team={item.authorRole === 'studio' || undefined} aria-hidden="true" />
                    <span className="brr-activity-text">
                      <span className="brr-activity-line">{activityLine(item, copy.activity)}</span>
                      {item.kind === 'message' ? (
                        item.line ? <span className="brr-activity-meta">{item.line}</span> : null
                      ) : item.title ? (
                        <span className="brr-activity-meta">
                          {item.title}
                          {item.version ? <span className="brr-version">v{item.version}</span> : null}
                        </span>
                      ) : null}
                    </span>
                    <time dateTime={item.at}>{moment.format(new Date(item.at))}</time>
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="brr-empty">{copy.activityEmpty}</p>
          )}
        </section>
      </div>
    </div>
  );
}
