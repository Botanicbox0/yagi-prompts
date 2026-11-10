import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { brandRoomsOpen } from "@/lib/flags";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, StatusPill, type AdminTone } from "@/components/admin/patterns";
import { formatCount } from "@/lib/admin/format";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { reviewAdminPath, staffDeliveryProjects, staffProjectStacks } from "@/lib/brand-studio/review";
import type { ReviewStatus } from "@/lib/brand-studio/review-contracts";
import { DeliveryUpload } from "@/components/brand-studio/review/delivery-upload";

/**
 * `/admin/brand-rooms/reviews` — the team's delivery desk (docs/BRAND-ROOMS.md §6): pick a project of an
 * open brand, upload a draft (film up to 500 MB, image up to 50 MB) as a new deliverable or the next
 * version of one, and see the project's drafts. Share links show on each draft's review page. Sandboxed
 * and generation-closed brands never appear (the service drops them, and delivery refuses them).
 */
export const dynamic = "force-dynamic";

const TONES: Record<ReviewStatus, AdminTone> = { open: "action", changes_requested: "progress", approved: "done" };
const UUID = /^[0-9a-f-]{36}$/i;
const PATH = "/admin/brand-rooms/reviews";

export default async function RoomDeliveries({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, sql, locale, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale);
  const a = dict.roomsReview.admin;
  const r = dict.studioReview;
  const asked = typeof search.projectId === "string" && UUID.test(search.projectId) ? search.projectId : null;
  const deps = sql ? { sql, media: createStudioMediaStore() } : null;
  const open = brandRoomsOpen();
  const list = deps && open ? await staffDeliveryProjects(deps, viewer) : null;
  const projects = list && list.ok ? list.projects : [];
  const project = asked ? projects.find((p) => p.projectId === asked) ?? null : null;
  const stacks = deps && project ? await staffProjectStacks(deps, viewer, { organizationId: project.organizationId, projectId: project.projectId }) : null;
  const rows = stacks && stacks.ok ? stacks.stacks : [];
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-room-deliveries>
        <AdminPageHeader title={a.title} lede={a.lede} {...(project ? { count: formatCount(rows.length, locale) } : {})} />
        {!open ? (
          <p role="status" data-admin-delivery-closed>
            {a.flagOff}
          </p>
        ) : !list || !list.ok ? (
          <p role="alert">{dict.brandWorkspace.unavailable}</p>
        ) : (
          <>
            <form method="get" action={PATH} className="bw-form" data-admin-delivery-project>
              <label>
                {a.project}
                <select name="projectId" defaultValue={project?.projectId ?? ""} required>
                  <option value="" disabled>
                    {a.organization} · {a.project}
                  </option>
                  {projects.map((p) => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.organizationName} · {p.projectTitle}
                    </option>
                  ))}
                </select>
              </label>
              <button className="bw-button" type="submit">
                {a.choose}
              </button>
            </form>
            {project && (
              <>
                <section className="bw-contract-add mt-4" aria-label={a.title}>
                  <DeliveryUpload
                    organizationId={project.organizationId}
                    projectId={project.projectId}
                    stacks={rows.map((s) => ({ reviewId: s.versions[0]!.id, title: s.versions[0]!.title, version: s.versions[0]!.version ?? 1 }))}
                    copy={a}
                  />
                </section>
                <h2 className="mt-4">{a.stacksTitle}</h2>
                <AdminTable
                  caption={a.stacksTitle}
                  columns={[
                    { key: "title", label: a.columns.title },
                    { key: "version", label: a.columns.version },
                    { key: "status", label: a.columns.status },
                    { key: "open", label: a.columns.open, numeric: true },
                    { key: "source", label: a.columns.source },
                  ]}
                  rows={rows.map((s) => {
                    const latest = s.versions[0]!;
                    return {
                      key: s.stackId,
                      data: { "data-admin-delivery-stack": s.stackId },
                      cells: {
                        title: (
                          <a href={reviewAdminPath(latest.id)} className="admin-row-link">
                            <span>{latest.title}</span>
                          </a>
                        ),
                        version: `v${latest.version ?? 1} / ${s.versions.length}`,
                        status: <StatusPill tone={TONES[latest.status]}>{r.status[latest.status]}</StatusPill>,
                        open: formatCount(latest.commentsOpen, locale),
                        source: a.sources[latest.source ?? "studio"],
                      },
                    };
                  })}
                  empty={a.noStacks}
                />
              </>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
