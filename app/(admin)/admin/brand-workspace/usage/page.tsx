import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { loadStudioUsageQueue } from "@/lib/brands/usage/service";
import { AdminShell, OpForm, OutcomeBanner } from "@/components/admin/chrome";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";

/** Every secondary-usage case, the ones that need the studio first (docs/SECONDARY-USAGE.md). */
export const dynamic = "force-dynamic";
export default async function StudioUsageQueue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, sql, locale, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale), b = dict.brandWorkspace, a = b.secondaryUsage.admin;
  const projectId = typeof search.projectId === "string" ? search.projectId : undefined;
  const rows = sql ? await loadStudioUsageQueue({ sql }, viewer, projectId) : null;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner dict={dict.admin} ok={typeof search.ok === "string" ? search.ok : undefined} err={typeof search.err === "string" ? search.err : undefined} detail={typeof search.detail === "string" ? search.detail : undefined} />
      <div data-studio-usage-queue>
        <div className="bw-heading"><div><a href="/admin/brand-workspace">← {b.back}</a><h1>{a.queue}</h1><p className="bw-muted">{a.queueHint}</p></div></div>
        <p className="bw-note">{a.privateBoundary}</p>
        <OpForm op="brandUsage.reconcile" back="/admin/brand-workspace/usage" className="bw-form"><button className="bw-button" type="submit">{a.reconcile}</button></OpForm>
        {!rows ? <p role="alert">{b.unavailable}</p> : !rows.length ? <p className="bw-empty">{a.none}</p> : (
          <ul className="bw-list">
            {rows.map((r) => (
              <li key={r.id} data-usage-queue-row={r.status}>
                <a href={`/admin/brand-workspace/usage/${r.id}`}><strong>{r.organizationName} · {r.projectTitle}</strong></a>
                <p className="bw-muted"><span className="bw-status" data-state={r.status}>{a.statuses[r.status]}</span> · {interpolate(a.subjects, { count: r.subjects })} · {formatBrandTimestamp(r.updatedAt, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
