import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { AdminShell, OpForm, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, FilterPills, StatusPill, type AdminTone } from "@/components/admin/patterns";
import { formatAdminTime, formatCount } from "@/lib/admin/format";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { staffReviewList } from "@/lib/brand-studio/review";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/brand-studio/review-contracts";
import { loadStudioWorkspace } from "@/lib/brands/workspace/service";

/**
 * `/admin/brand-studio/reviews` — every piece brands put up for review (docs/BRAND-STUDIO-V3.md §7),
 * newest activity first, and the form that opens a review on an existing asset or result.
 */
export const dynamic = "force-dynamic";

const TONES: Record<ReviewStatus, AdminTone> = { open: "action", changes_requested: "progress", approved: "done" };

export default async function StudioReviews({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, sql, locale, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale);
  const r = dict.studioReview;
  const a = r.admin;
  const asked = typeof search.status === "string" ? search.status : "";
  const status = (REVIEW_STATUSES as readonly string[]).includes(asked) ? (asked as ReviewStatus) : null;
  const deps = sql ? { sql, media: createStudioMediaStore() } : null;
  const [list, workspace] = deps ? await Promise.all([staffReviewList(deps, viewer, { status }), loadStudioWorkspace({ sql: deps.sql }, viewer)]) : [null, null];
  const reviews = list && list.ok ? list.reviews : null;
  const organizations = workspace ? workspace.organizations : [];
  const pills = [
    { key: "all", label: a.filterAll, href: "/admin/brand-studio/reviews", current: status === null },
    ...REVIEW_STATUSES.map((s) => ({ key: s, label: r.status[s], href: `/admin/brand-studio/reviews?status=${s}`, current: status === s })),
  ];
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-studio-reviews>
        <AdminPageHeader
          back={{ href: "/admin/brand-workspace", label: dict.brandWorkspace.dashboard.studioTitle }}
          title={a.title}
          {...(reviews ? { count: formatCount(reviews.length, locale) } : {})}
          lede={a.lede}
        />
        <FilterPills label={r.statusLabel} pills={pills} />
        {!reviews ? (
          <p role="alert">{dict.brandWorkspace.unavailable}</p>
        ) : (
          <AdminTable
            caption={a.caption}
            columns={[
              { key: "organization", label: a.columns.organization },
              { key: "title", label: a.columns.title },
              { key: "status", label: a.columns.status },
              { key: "open", label: a.columns.open, numeric: true },
              { key: "activity", label: a.columns.activity },
            ]}
            rows={reviews.map((item) => ({
              key: item.id,
              data: { "data-admin-review-row": item.id },
              cells: {
                organization: item.organizationName,
                title: (
                  <a href={`/admin/brand-studio/reviews/${item.id}`} className="admin-row-link">
                    <span>{item.title}</span>
                    {!item.available && <span className="admin-cell-sub">{a.unavailable}</span>}
                  </a>
                ),
                status: <StatusPill tone={TONES[item.status]}>{r.status[item.status]}</StatusPill>,
                open: `${formatCount(item.commentsOpen, locale)} / ${formatCount(item.commentsTotal, locale)}`,
                activity: formatAdminTime(item.lastActivityAt, locale),
              },
            }))}
            empty={a.empty}
          />
        )}
        {organizations.length > 0 && (
          <details className="bw-contract-add mt-4" data-admin-review-create>
            <summary>{a.createTitle}</summary>
            <p className="bw-muted">{a.createHint}</p>
            <OpForm op="brand_studio.review.create" back="/admin/brand-studio/reviews" className="bw-form">
              <label>
                {a.organization}
                <select name="organizationId" required>
                  {organizations.map((o) => (
                    <option value={o.id} key={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {a.subjectKind}
                <select name="subjectKind" defaultValue="output">
                  <option value="output">{a.output}</option>
                  <option value="asset">{a.asset}</option>
                </select>
              </label>
              <label>
                {a.subjectId}
                <input name="subjectId" required pattern="[0-9a-fA-F-]{36}" autoComplete="off" />
              </label>
              <label>
                {a.titleLabel}
                <input name="title" required minLength={1} maxLength={120} />
              </label>
              <button className="bw-button" type="submit">
                {a.create}
              </button>
            </OpForm>
          </details>
        )}
      </div>
    </AdminShell>
  );
}
