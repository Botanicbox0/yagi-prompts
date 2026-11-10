import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, OpForm, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, FilterPills, StatusPill, type AdminTone } from "@/components/admin/patterns";
import { formatAdminTime, formatCount } from "@/lib/admin/format";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { staffStoryboardList } from "@/lib/brand-rooms/storyboards";
import { STORYBOARD_ADMIN_PATH, STORYBOARD_LIMITS, storyboardAdminHref, type StoryboardStatus } from "@/lib/brand-rooms/storyboard-contracts";

/**
 * `/admin/brand-rooms/storyboards` — every storyboard of an open brand's project rooms
 * (docs/BRAND-ROOMS.md §5), newest activity first, filtered by brand, and the form that starts a new
 * draft for a project. Sandboxed brands never appear here (the service drops them).
 */
export const dynamic = "force-dynamic";

const TONES: Record<StoryboardStatus, AdminTone> = { draft: "hold", shared: "action", changes_requested: "progress", approved: "done" };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminStoryboards({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, sql, locale, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale);
  const s = dict.roomsStoryboard;
  const a = s.admin;
  const organizationId = typeof search.organizationId === "string" && UUID.test(search.organizationId) ? search.organizationId : null;
  const result = sql ? await staffStoryboardList({ sql, media: createStudioMediaStore() }, viewer, { organizationId }) : null;
  const data = result && result.ok ? result : null;
  const organizations = data ? [...new Map(data.projects.map((p) => [p.organizationId, p.organizationName])).entries()] : [];
  const pills = [
    { key: "all", label: a.filterAll, href: STORYBOARD_ADMIN_PATH, current: organizationId === null },
    ...organizations.map(([id, name]) => ({ key: id, label: name, href: `${STORYBOARD_ADMIN_PATH}?organizationId=${id}`, current: organizationId === id })),
  ];
  const projects = data ? data.projects.filter((p) => !organizationId || p.organizationId === organizationId) : [];
  const back = organizationId ? `${STORYBOARD_ADMIN_PATH}?organizationId=${organizationId}` : STORYBOARD_ADMIN_PATH;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-storyboards>
        <AdminPageHeader title={a.title} {...(data ? { count: formatCount(data.boards.length, locale) } : {})} lede={a.lede} />
        {organizations.length > 1 ? <FilterPills label={a.columns.organization} pills={pills} /> : null}
        {!data ? (
          <p role="alert">{dict.brandWorkspace.unavailable}</p>
        ) : (
          <AdminTable
            caption={a.caption}
            columns={[
              { key: "organization", label: a.columns.organization },
              { key: "project", label: a.columns.project },
              { key: "title", label: a.columns.title },
              { key: "version", label: a.columns.version },
              { key: "status", label: a.columns.status },
              { key: "cuts", label: a.columns.cuts, numeric: true },
              { key: "source", label: a.columns.source },
              { key: "activity", label: a.columns.activity },
            ]}
            rows={data.boards.map((board) => ({
              key: board.id,
              data: { "data-admin-storyboard-row": board.id },
              cells: {
                organization: board.organizationName,
                project: board.projectTitle,
                title: (
                  <a href={storyboardAdminHref(board.id)} className="admin-row-link">
                    <span>{board.title}</span>
                  </a>
                ),
                version: interpolate(s.version, { n: board.version }),
                status: <StatusPill tone={TONES[board.status]}>{s.status[board.status]}</StatusPill>,
                cuts: formatCount(board.cuts, locale),
                source: `${s.madeBy[board.createdRole]} · ${a.source[board.source]}`,
                activity: formatAdminTime(board.updatedAt, locale),
              },
            }))}
            empty={a.empty}
          />
        )}
        {data ? (
          <details className="bw-contract-add mt-4" data-admin-storyboard-create open={data.boards.length === 0}>
            <summary>{a.createTitle}</summary>
            <p className="bw-muted">{a.createHint}</p>
            {projects.length === 0 ? (
              <p className="bw-muted">{a.noProjects}</p>
            ) : (
              <OpForm op="brand_rooms.storyboard.create" back={back} className="bw-form">
                <label>
                  {a.project}
                  <select name="projectId" required>
                    {organizations
                      .filter(([id]) => !organizationId || id === organizationId)
                      .map(([id, name]) => (
                        <optgroup label={name} key={id}>
                          {projects
                            .filter((p) => p.organizationId === id)
                            .map((p) => (
                              <option value={p.projectId} key={p.projectId}>
                                {p.projectTitle}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                  </select>
                </label>
                <label>
                  {a.columns.title}
                  <input name="title" required minLength={1} maxLength={STORYBOARD_LIMITS.titleMax} defaultValue={s.actions.defaultTitle} />
                </label>
                <button className="bw-button" type="submit">
                  {a.create}
                </button>
              </OpForm>
            )}
          </details>
        ) : null}
      </div>
    </AdminShell>
  );
}
