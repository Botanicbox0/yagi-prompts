import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
export default async function BrandHome() {
  const { sql, viewer, b, locale } = await brandContext();
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const workspace = await loadBrandWorkspace({ sql }, viewer);
  return (
    <div data-brand-home>
      <div className="bw-heading">
        <div>
          <h1>{b.intro}</h1>
          <p>{b.introBody}</p>
        </div>
      </div>
      {workspace.organizations.length === 0 ? (
        <section className="bw-panel">
          <h2>{b.needOrganization}</h2>
          <p className="bw-note">{b.organizationHint}</p>
          <ActionForm
            operation="organization.create"
            b={b}
            submit={b.createOrganization}
          >
            <label>
              {b.organization}
              <input
                name="name"
                minLength={2}
                maxLength={100}
                required
                autoComplete="organization"
              />
            </label>
          </ActionForm>
        </section>
      ) : (
        <>
          {workspace.projects.length === 0 ? (
            <section className="bw-empty">
              <h2>{b.empty}</h2>
              <p>{b.emptyBody}</p>
              <a className="bw-button bw-primary" href="/brand/projects/new">
                {b.newProject}
              </a>
            </section>
          ) : (
            <section className="bw-panel">
              <h2>{b.home}</h2>
              <ul className="bw-list">
                {workspace.projects.map((p) => (
                  <li key={p.id}>
                    <div className="bw-row">
                      <div>
                        <h3>
                          <a href={`/brand/projects/${p.id}`}>{p.title}</a>
                        </h3>
                        <p className="bw-muted">
                          {p.organizationName} · {b.latestUpdate}{" "}
                          {formatBrandTimestamp(p.updatedAt, locale)}
                        </p>
                      </div>
                      <span className="bw-status" data-state={p.status}>
                        {b.status[p.status]}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="bw-panel">
            <h2>{b.organizations}</h2>
            <ul className="bw-list">
              {workspace.organizations.map((o) => (
                <li key={o.id} className="bw-row">
                  <div>
                    {o.name}
                    <p className="bw-muted">{b.roles[o.role]}</p>
                  </div>
                  {o.role === "owner" && (
                    <a href={`/brand/members?organizationId=${o.id}`}>
                      {b.viewTeam} →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
