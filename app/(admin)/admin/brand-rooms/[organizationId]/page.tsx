import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { brandRoomsOpen } from "@/lib/flags";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader } from "@/components/admin/patterns";
import { formatAdminTime } from "@/lib/admin/format";
import { AdminRoomChannel } from "@/components/brand-rooms/chat/admin";
import { roomAdminPath, staffRoomChannels } from "@/lib/brand-rooms/messages";
import { GENERAL_CHANNEL } from "@/lib/brand-rooms/message-contracts";

/**
 * `/admin/brand-rooms/[organizationId]` — one organization's conversations, the team's side
 * (docs/BRAND-ROOMS.md §4). Left: "일반 문의" and every project channel with the brand lines waiting for
 * the team. Right: the chosen channel (`?channel=<projectId|general>`), the same stream the brand sees;
 * the team reads everything, replies, pins and takes lines down through the registered
 * `brand_rooms.*` operations (`author_role = 'studio'`). A project channel's header links to that
 * project's storyboards and deliverables on the team's own pages (slices S and R).
 */
export const dynamic = "force-dynamic";

export default async function AdminBrandRoom({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!brandRoomsOpen()) notFound();
  const [viewer, sql, locale, { organizationId }, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), params, searchParams]);
  const dict = getDictionary(locale);
  const c = dict.roomsChat;
  const a = c.admin;
  if (!sql) return <p role="alert">{dict.brandWorkspace.unavailable}</p>;
  const room = await staffRoomChannels({ sql }, viewer, organizationId);
  if (!room.ok) notFound();
  const asked = typeof search.channel === "string" ? search.channel.trim().toLowerCase() : GENERAL_CHANNEL;
  const current = room.channels.find((ch) => ch.channel === asked) ?? room.channels.find((ch) => ch.channel === GENERAL_CHANNEL)!;
  const name = current.projectId ? (current.title ?? "") : c.inbox.general;
  const workQuery = current.projectId ? `?organizationId=${room.organization.id}&projectId=${current.projectId}` : "";
  const roomLocale = locale === "en" ? "en" : "ko";
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-brand-room={room.organization.id}>
        <AdminPageHeader back={{ href: "/admin/brand-rooms", label: a.back }} eyebrow={a.brandLabel} title={room.organization.name} lede={a.teamNote} />
        <div className="brc-admin-room">
          <nav className="brc-admin-channels" aria-label={c.inbox.listLabel}>
            <ul>
              {room.channels.map((ch) => (
                <li key={ch.channel}>
                  <a
                    href={roomAdminPath(room.organization.id, ch.channel)}
                    className="brc-inbox-item"
                    aria-current={ch.channel === current.channel ? "true" : undefined}
                    data-unread={ch.teamUnread > 0 ? "true" : undefined}
                    data-admin-room-channel={ch.channel}
                  >
                    <span className="brc-inbox-mark" aria-hidden="true">
                      <svg viewBox="0 0 20 20">
                        {ch.projectId ? (
                          <>
                            <rect x="3.5" y="4.5" width="13" height="11" rx="2.5" />
                            <path d="M3.5 8h13" />
                          </>
                        ) : (
                          <path d="M4 5.5h12v7H9.5L6 15.5v-3H4z" />
                        )}
                      </svg>
                    </span>
                    <span className="brc-inbox-text">
                      <span className="brc-inbox-name">{ch.projectId ? (ch.title ?? "") : c.inbox.general}</span>
                      <span className="brc-inbox-line">{ch.lastLine ?? c.inbox.noMessages}</span>
                    </span>
                    <span className="brc-inbox-side">
                      {ch.lastAt && <time dateTime={ch.lastAt}>{formatAdminTime(ch.lastAt, locale)}</time>}
                      {ch.teamUnread > 0 && (
                        <span className="brc-badge" aria-label={interpolate(a.waiting, { count: ch.teamUnread })}>
                          {ch.teamUnread > 99 ? "99+" : ch.teamUnread}
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="brc-admin-pane">
            <AdminRoomChannel
              key={current.channel}
              organizationId={room.organization.id}
              channel={current.channel}
              locale={roomLocale}
              copy={c}
              channelName={name}
              header={
                <div className="brc-pane-head">
                  <div className="brc-pane-title">
                    <h2>{name}</h2>
                    <p>{current.projectId ? c.channel.projectLede : c.channel.generalLede}</p>
                  </div>
                  {current.projectId && (
                    <div className="brc-admin-links" data-admin-room-work-links>
                      <span>{a.workLinks}</span>
                      <a className="brc-btn" href={`/admin/brand-rooms/storyboards${workQuery}`}>
                        {a.storyboards}
                      </a>
                      <a className="brc-btn" href={`/admin/brand-rooms/reviews${workQuery}`}>
                        {a.deliverables}
                      </a>
                    </div>
                  )}
                </div>
              }
            />
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
