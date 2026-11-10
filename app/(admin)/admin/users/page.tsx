import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell } from "@/components/admin/chrome";
import {
  AdminPageHeader,
  AdminTable,
  FilterPills,
  Pager,
  StatusPill,
  type AdminTone,
} from "@/components/admin/patterns";
import {
  USER_PAGE_SIZE,
  USER_ROLES,
  loadAdminUsers,
  socialTone,
  userFilter,
  userHref,
  type UserRole,
} from "@/lib/admin/users";
import { formatAdminTime, formatCount, shortId } from "@/lib/admin/format";

/**
 * `/admin/users` — minimal-PII user directory (docs/ADMIN.md §7.3, PLATFORM-2.0 §10).
 * Shows the first eight characters of the account UUID, join date, roles, verified/submitted SNS
 * platform + follower count, active selfie count, paid order count, render count, and last activity.
 * Never renders e-mail, display name, or selfie photos. Read-only.
 */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function roleTone(role: UserRole): AdminTone {
  switch (role) {
    case "admin":
      return "action";
    case "creative":
      return "done";
    case "social":
      return "progress";
    case "brand":
      return "hold";
  }
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.adminConsole;
  const u = c.users;
  const filter = userFilter(params);
  const directory = sql === null ? null : await loadAdminUsers(sql, filter);

  const first = directory && directory.total > 0 ? (filter.page - 1) * USER_PAGE_SIZE + 1 : 0;
  const last = directory ? Math.min(filter.page * USER_PAGE_SIZE, directory.total) : 0;

  return (
    <AdminShell dict={a} locale={locale} active="users">
      <AdminPageHeader
        title={u.title}
        {...(directory
          ? {
              count: formatCount(directory.total, locale),
              countLabel: interpolate(u.count, { count: formatCount(directory.total, locale) }),
            }
          : {})}
        lede={u.lede}
      />

      {directory === null ? (
        <p role="status" className="admin-notice">
          {dict.adminWorkflow.unavailable}
        </p>
      ) : (
        <section className="admin-section" data-admin-users aria-label={u.title}>
          <div className="admin-toolbar">
            <FilterPills
              label={u.roleFilter}
              pills={[
                {
                  key: "all",
                  label: c.list.all,
                  href: userHref(filter, { role: null }),
                  count: formatCount(directory.allCount, locale),
                  current: filter.role === null,
                },
                ...USER_ROLES.map((role) => ({
                  key: role,
                  label: u.roles[role],
                  href: userHref(filter, { role }),
                  count: formatCount(directory.byRole[role], locale),
                  current: filter.role === role,
                })),
              ]}
            />
            <form method="get" action="/admin/users" className="admin-search" role="search">
              {filter.role ? <input type="hidden" name="role" value={filter.role} /> : null}
              <input
                type="search"
                name="q"
                defaultValue={filter.query}
                placeholder={u.searchPlaceholder}
                aria-label={c.list.search}
              />
              <button type="submit" className="admin-btn">
                {c.list.find}
              </button>
              {filter.query ? (
                <a href={userHref(filter, { query: "" })} className="admin-btn">
                  {c.list.clear}
                </a>
              ) : null}
            </form>
          </div>

          <AdminTable
            caption={u.title}
            empty={directory.allCount === 0 ? u.emptyAll : u.empty}
            columns={[
              { key: "account", label: u.columns.account },
              { key: "joined", label: u.columns.joined },
              { key: "roles", label: u.columns.roles },
              { key: "socials", label: u.columns.socials },
              { key: "selfies", label: u.columns.selfies, numeric: true },
              { key: "orders", label: u.columns.orders, numeric: true },
              { key: "renders", label: u.columns.renders, numeric: true },
              { key: "lastActive", label: u.columns.lastActive },
            ]}
            rows={directory.rows.map((user) => ({
              key: user.id,
              data: {
                "data-user-row": shortId(user.id),
                "data-roles": user.roles.join(",") || "member",
              },
              cells: {
                account: (
                  <div>
                    <code title={user.id}>{shortId(user.id)}</code>
                    {user.maskedEmail ? (
                      <span className="admin-cell-sub" data-user-masked-email>
                        {user.maskedEmail}
                      </span>
                    ) : null}
                    {user.creativeHandle ? (
                      <span className="admin-cell-sub">@{user.creativeHandle}</span>
                    ) : null}
                  </div>
                ),
                joined: <span className="admin-nowrap">{formatAdminTime(user.createdAt, locale)}</span>,
                roles:
                  user.roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {user.roles.map((role) => (
                        <StatusPill key={role} tone={roleTone(role)}>
                          {u.roles[role]}
                        </StatusPill>
                      ))}
                    </div>
                  ) : (
                    <StatusPill tone="hold">{u.roles.member}</StatusPill>
                  ),
                socials:
                  user.socials.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {user.socials.map((s, idx) => (
                        <span key={`${s.platform}-${idx}`} className="flex flex-wrap items-center gap-1.5">
                          <StatusPill tone={socialTone(s.status)}>
                            {u.platforms[s.platform]} · {u.socialStatuses[s.status]}
                          </StatusPill>
                          {s.followerCount !== null ? (
                            <span className="admin-cell-sub">
                              {interpolate(u.followers, { count: formatCount(s.followerCount, locale) })}
                            </span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : (
                    "—"
                  ),
                selfies: formatCount(user.selfieCount, locale),
                orders: formatCount(user.paidOrderCount, locale),
                renders:
                  user.renderCount > 0 ? (
                    <a href="/admin/renders" className="admin-row-link">
                      <span>{formatCount(user.renderCount, locale)}</span>
                    </a>
                  ) : (
                    formatCount(user.renderCount, locale)
                  ),
                lastActive: <span className="admin-nowrap">{formatAdminTime(user.lastActiveAt, locale)}</span>,
              },
            }))}
          />

          {directory.total > 0 ? (
            <Pager
              label={c.list.pages}
              summary={interpolate(c.list.range, {
                from: formatCount(first, locale),
                to: formatCount(last, locale),
                total: formatCount(directory.total, locale),
              })}
              prev={filter.page > 1 ? userHref(filter, { page: filter.page - 1 }) : null}
              next={last < directory.total ? userHref(filter, { page: filter.page + 1 }) : null}
              prevLabel={c.list.prev}
              nextLabel={c.list.next}
            />
          ) : null}
        </section>
      )}
    </AdminShell>
  );
}
