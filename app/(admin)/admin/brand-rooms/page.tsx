import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { brandRoomsOpen } from "@/lib/flags";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, StatusPill, type AdminTone } from "@/components/admin/patterns";
import { formatAdminTime, formatCount } from "@/lib/admin/format";
import { roomAdminPath, staffRoomOverview } from "@/lib/brand-rooms/messages";
import { GENERAL_CHANNEL, roomDeskPath } from "@/lib/brand-rooms/message-contracts";
import { STORYBOARD_ADMIN_PATH } from "@/lib/brand-rooms/storyboard-contracts";
import "@/components/brand-rooms/chat/chat.css";

/**
 * `/admin/brand-rooms` — the team's project list (docs/BRAND-ROOMS-FEEDBACK.md §3–4). First the new requests
 * (client-visible projects the team has not written in yet: a commission leaves no line), then every other
 * conversation, the ones waiting for the team first (a brand line, or a brand note, approval or change
 * request on the work since the team last saw it), then by last activity. A project row opens its desk; a
 * brand's general conversation keeps its own page. Sandboxed and generation-closed brands are not listed.
 */
export const dynamic = "force-dynamic";

function projectTone(status: string): AdminTone {
  return status === "active" ? "action" : status === "requested" ? "progress" : "done";
}

export default async function AdminBrandRooms({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!brandRoomsOpen()) notFound();
  const [viewer, sql, locale, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale);
  const c = dict.roomsChat;
  const a = c.admin;
  const d = dict.adminConsole.roomDesk;
  const overview = sql ? await staffRoomOverview({ sql }, viewer) : null;
  const newRequests = overview && overview.ok ? overview.newRequests : [];
  // A new request the brand already wrote in is listed once, in its own group.
  const fresh = new Set(newRequests.map((p) => `${p.organizationId}:${p.channel}`));
  const channels = overview && overview.ok ? overview.channels.filter((ch) => !fresh.has(`${ch.organizationId}:${ch.channel}`)) : null;
  const organizations = overview && overview.ok ? overview.organizations : [];
  const waiting = channels ? [...channels, ...newRequests].reduce((n, ch) => n + ch.teamUnread, 0) : 0;
  const statusWord = (status: string) => dict.brandWorkspace.status[status as keyof typeof dict.brandWorkspace.status] ?? status;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-brand-rooms>
        {/* The back label names where it goes: the console's own name for /admin/brand-workspace (the crumb says the same). */}
        <AdminPageHeader
          back={{ href: "/admin/brand-workspace", label: dict.adminConsole.nav.brandWorkspace }}
          title={a.title}
          {...(channels && waiting > 0 ? { count: formatCount(waiting, locale), countLabel: interpolate(a.waiting, { count: waiting }) } : {})}
          lede={d.listLede}
        />
        {!channels ? (
          <p role="alert">{dict.brandWorkspace.unavailable}</p>
        ) : (
          <>
            <section data-admin-room-new-requests>
              <h2 className="mb-1 text-base font-semibold">{d.newRequests}</h2>
              <p className="admin-cell-sub mb-3">{d.newRequestsHint}</p>
              <AdminTable
                caption={d.newRequests}
                columns={[
                  { key: "organization", label: a.columns.organization },
                  { key: "project", label: d.project },
                  { key: "status", label: d.status },
                  { key: "received", label: d.received },
                  { key: "waiting", label: a.columns.waiting, numeric: true },
                ]}
                rows={newRequests.map((p) => ({
                  key: `${p.organizationId}:${p.projectId}`,
                  data: { "data-admin-room-new": `${p.organizationId}:${p.projectId}` },
                  cells: {
                    organization: p.organizationName,
                    project: (
                      <a href={roomDeskPath(p.organizationId, p.projectId)} className="admin-row-link">
                        <span>{p.title ?? ""}</span>
                        {p.lastLine && <span className="admin-cell-sub">{p.lastLine}</span>}
                      </a>
                    ),
                    status: <StatusPill tone={projectTone(p.status)}>{statusWord(p.status)}</StatusPill>,
                    received: formatAdminTime(p.createdAt, locale),
                    waiting: p.teamUnread > 0 ? <StatusPill tone="action">{interpolate(a.waiting, { count: p.teamUnread })}</StatusPill> : "—",
                  },
                }))}
                empty={d.noNewRequests}
              />
            </section>
            <section className="mt-6" data-admin-room-conversations>
              <h2 className="mb-3 text-base font-semibold">{d.conversations}</h2>
              <AdminTable
                caption={d.conversations}
                columns={[
                  { key: "organization", label: a.columns.organization },
                  { key: "channel", label: a.columns.channel },
                  { key: "last", label: a.columns.last },
                  { key: "waiting", label: a.columns.waiting, numeric: true },
                ]}
                rows={channels.map((ch) => ({
                  key: `${ch.organizationId}:${ch.channel}`,
                  data: { "data-admin-room-row": `${ch.organizationId}:${ch.channel}` },
                  cells: {
                    organization: ch.organizationName,
                    channel: (
                      // A project opens its desk; a brand's general conversation keeps its own page.
                      <a href={ch.projectId ? roomDeskPath(ch.organizationId, ch.projectId) : roomAdminPath(ch.organizationId, GENERAL_CHANNEL)} className="admin-row-link">
                        <span>{ch.projectId ? (ch.title ?? "") : c.inbox.general}</span>
                        {ch.lastLine && <span className="admin-cell-sub">{ch.lastLine}</span>}
                      </a>
                    ),
                    last: (
                      <span>
                        {formatAdminTime(ch.lastAt, locale)}
                        {ch.lastRole && <span className="admin-cell-sub">{ch.lastRole === "studio" ? a.lastFromTeam : a.lastFromBrand}</span>}
                      </span>
                    ),
                    waiting: ch.teamUnread > 0 ? <StatusPill tone="action">{interpolate(a.waiting, { count: ch.teamUnread })}</StatusPill> : "—",
                  },
                }))}
                empty={a.empty}
              />
            </section>
          </>
        )}
        {organizations.length > 0 && (
          <section className="mt-6" data-admin-room-organizations>
            <h2 className="mb-3 text-base font-semibold">{d.generalConversation}</h2>
            <ul className="brc-admin-links" style={{ listStyle: "none", padding: 0 }}>
              {organizations.map((o) => (
                <li key={o.id}>
                  <a className="admin-btn" href={roomAdminPath(o.id)}>
                    {o.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="mt-6" data-admin-room-team-pages>
          <h2 className="mb-3 text-base font-semibold">{d.otherPages}</h2>
          <ul className="brc-admin-links" style={{ listStyle: "none", padding: 0 }}>
            <li>
              <a className="admin-btn" href={STORYBOARD_ADMIN_PATH}>
                {d.allStoryboards}
              </a>
            </li>
            <li>
              <a className="admin-btn" href="/admin/brand-rooms/reviews">
                {d.allDeliveries}
              </a>
            </li>
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
