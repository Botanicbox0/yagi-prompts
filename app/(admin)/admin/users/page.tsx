import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatDate, interpolate } from "@/lib/i18n/format";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { loadAdminUserView } from "@/lib/admin/renders-users";
import {
  AdminBadge,
  AdminFilterBar,
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  INPUT,
  Panel,
} from "@/components/admin/chrome";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [, locale, params, sql] = await Promise.all([
    requireAdmin(),
    getLocaleFromHeaders(),
    searchParams,
    getSqlRunner(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const uv = dict.adminWorkflow.userView;

  const q = one(params, "q");
  const role = one(params, "role");

  const view =
    sql === null
      ? null
      : await loadAdminUserView(sql, {
          ...(q ? { q } : {}),
          ...(role ? { role } : {}),
        });

  return (
    <AdminShell dict={a} locale={locale} active="users">
      <div data-admin-users-view>
        <h1 className="text-3xl font-semibold leading-tight">{uv.heading}</h1>
        <p className="mt-3 max-w-detail text-body opacity-65">{uv.lede}</p>

        {view === null ? (
          <p role="status" className="admin-empty-state mt-6">
            {dict.adminWorkflow.unavailable}
          </p>
        ) : (
          <>
            <AdminFilterBar
              ariaLabel={uv.heading}
              items={[
                {
                  href: "/admin/users",
                  label: uv.filterAll,
                  count: view.counts.all,
                  active: !role,
                },
                {
                  href: "/admin/users?role=admin",
                  label: uv.filterAdmin,
                  count: view.counts.admins,
                  active: role === "admin",
                },
                {
                  href: "/admin/users?role=maker",
                  label: uv.filterMaker,
                  count: view.counts.makers,
                  active: role === "maker",
                },
                {
                  href: "/admin/users?role=influencer",
                  label: uv.filterInfluencer,
                  count: view.counts.influencers,
                  active: role === "influencer",
                },
                {
                  href: "/admin/users?role=brand",
                  label: uv.filterBrand,
                  count: view.counts.brands,
                  active: role === "brand",
                },
              ]}
              trailing={
                <form
                  method="get"
                  action="/admin/users"
                  className="flex flex-wrap items-center gap-2"
                >
                  {role && <input type="hidden" name="role" value={role} />}
                  <input
                    type="search"
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder={uv.searchPlaceholder}
                    className={`${INPUT} w-52`}
                  />
                  <button type="submit" className={BUTTON_PRIMARY}>
                    {uv.searchAction}
                  </button>
                  {(q || role) && (
                    <a href="/admin/users" className={BUTTON}>
                      {uv.clearSearch}
                    </a>
                  )}
                </form>
              }
            />

            <Panel title={`${uv.heading} (${view.users.length})`}>
              {view.users.length === 0 ? (
                <p className="font-mono text-code opacity-60">{uv.empty}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    data-admin-users-table
                    className="w-full border-collapse text-left font-mono text-[0.76rem]"
                  >
                    <thead>
                      <tr className="border-b border-hairline opacity-60">
                        <th className="py-2 pr-3">{uv.colMember}</th>
                        <th className="py-2 pr-3">{uv.colRoles}</th>
                        <th className="py-2 pr-3">{uv.colSocial}</th>
                        <th className="py-2 pr-3">{uv.colSelfie}</th>
                        <th className="py-2 pr-3">{uv.colActivity}</th>
                        <th className="py-2">{uv.colActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {view.users.map((u) => (
                        <tr key={u.id} data-admin-user-row={u.id}>
                          <td className="py-2.5 pr-3 align-top">
                            <div className="font-semibold">
                              {u.displayName ?? u.id.slice(0, 8)}
                              {u.makerHandle ? ` (@${u.makerHandle})` : ""}
                            </div>
                            <div className="opacity-70">
                              {u.emailMasked ?? "—"} · {u.id.slice(0, 8)}
                            </div>
                            <div className="tabular-nums opacity-55">
                              {formatDate(u.createdAt, locale)}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 align-top">
                            <div className="flex flex-wrap gap-1.5">
                              {u.isAdmin && (
                                <AdminBadge tone="accent">
                                  {uv.roleAdmin}
                                </AdminBadge>
                              )}
                              {u.isMaker && (
                                <AdminBadge tone="success">
                                  {uv.roleMaker}
                                </AdminBadge>
                              )}
                              {u.isInfluencer && (
                                <AdminBadge tone="accent">
                                  {uv.roleInfluencer}
                                </AdminBadge>
                              )}
                              {u.brandCount > 0 && (
                                <AdminBadge tone="warning">
                                  {interpolate(uv.roleBrand, {
                                    count: String(u.brandCount),
                                  })}
                                </AdminBadge>
                              )}
                              {!u.isAdmin &&
                                !u.isMaker &&
                                !u.isInfluencer &&
                                u.brandCount === 0 && (
                                  <AdminBadge tone="neutral">
                                    {uv.roleMember}
                                  </AdminBadge>
                                )}
                            </div>
                          </td>
                          <td className="max-w-xs py-2.5 pr-3 align-top">
                            {u.socialSummary ? (
                              <span className="break-words">
                                {u.socialSummary}
                              </span>
                            ) : (
                              <span className="opacity-45">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 align-top tabular-nums">
                            {u.selfieCount > 0 ? (
                              <AdminBadge tone="neutral">
                                {interpolate(uv.selfieActive, {
                                  count: String(u.selfieCount),
                                })}
                              </AdminBadge>
                            ) : (
                              <span className="opacity-50">{uv.selfieNone}</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 align-top tabular-nums">
                            {interpolate(uv.activityLine, {
                              orders: String(u.ordersCount),
                              renders: String(u.rendersCount),
                              apps: String(u.applicationsCount),
                            })}
                          </td>
                          <td className="py-2.5 align-top">
                            <div className="flex flex-wrap gap-2">
                              <a
                                href={`/admin/renders?userId=${encodeURIComponent(u.id)}`}
                                className={BUTTON}
                              >
                                {uv.viewRenders}
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </AdminShell>
  );
}
