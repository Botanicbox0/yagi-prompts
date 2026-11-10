import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { brandRoomsOpen } from "@/lib/flags";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, StatusPill } from "@/components/admin/patterns";
import { formatAdminTime, formatCount } from "@/lib/admin/format";
import { roomAdminPath, staffRoomOverview } from "@/lib/brand-rooms/messages";
import "@/components/brand-rooms/chat/chat.css";

/**
 * `/admin/brand-rooms` — every client organization's room conversations (docs/BRAND-ROOMS.md §4), the
 * ones with brand lines the team has not read or answered first, then by last activity. Sandboxed and
 * generation-closed organizations are not listed. Each row opens that organization's conversations.
 */
export const dynamic = "force-dynamic";

export default async function AdminBrandRooms({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!brandRoomsOpen()) notFound();
  const [viewer, sql, locale, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale);
  const c = dict.roomsChat;
  const a = c.admin;
  const overview = sql ? await staffRoomOverview({ sql }, viewer) : null;
  const channels = overview && overview.ok ? overview.channels : null;
  const organizations = overview && overview.ok ? overview.organizations : [];
  const waiting = channels ? channels.reduce((n, ch) => n + ch.teamUnread, 0) : 0;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-brand-rooms>
        <AdminPageHeader
          back={{ href: "/admin/brand-workspace", label: dict.brandWorkspace.dashboard.studioTitle }}
          title={a.title}
          {...(channels ? { count: formatCount(waiting, locale), countLabel: interpolate(a.waiting, { count: waiting }) } : {})}
          lede={a.lede}
        />
        {!channels ? (
          <p role="alert">{dict.brandWorkspace.unavailable}</p>
        ) : (
          <AdminTable
            caption={a.caption}
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
                  <a href={roomAdminPath(ch.organizationId, ch.channel)} className="admin-row-link">
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
        )}
        {organizations.length > 0 && (
          <section className="mt-6" data-admin-room-organizations>
            <h2 className="mb-3 text-base font-semibold">{a.openBrand}</h2>
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
      </div>
    </AdminShell>
  );
}
