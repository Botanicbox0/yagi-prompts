import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadStudioWorkspace } from "@/lib/brands/workspace/service";
import { AdminShell } from "@/components/admin/chrome";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
export const dynamic = "force-dynamic";
export default async function StudioBrands() {
  const [viewer, sql, locale] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
  ]);
  const dict = getDictionary(locale),
    b = dict.brandWorkspace;
  const workspace = sql ? await loadStudioWorkspace({ sql }, viewer) : null;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <div data-studio-brand-queue>
        <div className="bw-heading">
          <h1>{b.studioTitle}</h1>
        </div>
        {!workspace ? (
          <p role="alert">{b.unavailable}</p>
        ) : !workspace.projects.length ? (
          <div className="bw-empty">{b.studioEmpty}</div>
        ) : (
          <section className="bw-panel">
            <ul className="bw-list">
              {workspace.projects.map((p) => (
                <li key={p.id} className="bw-row">
                  <div>
                    <h3>
                      <a href={`/admin/brand-workspace/${p.id}`}>{p.title}</a>
                    </h3>
                    <p className="bw-muted">
                      {p.organizationName} · {formatBrandTimestamp(p.updatedAt, locale)}
                    </p>
                  </div>
                  <span className="bw-status" data-state={p.status}>
                    {b.status[p.status]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AdminShell>
  );
}
