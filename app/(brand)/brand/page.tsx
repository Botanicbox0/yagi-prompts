import { ServiceGuide } from "@/components/brand-workspace/service-guide";
import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { countPendingSharedCampaigns, loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { brandScope, selectedAccess } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
export default async function BrandHome({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, locale }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // Only the selected brand's campaigns: another brand's work never mixes into this home.
  const workspace = choice
    ? await loadBrandWorkspace({ sql, verifiedEmail }, viewer, { organizationId: choice.id })
    : { organizations: [], projects: [] };
  const access = selectedAccess(choice, workspace.projects);
  // Accepted campaign invitations the studio has not shared yet: honest waiting, never a "create a workspace" start.
  const pendingShares = access.staff ? 0 : await countPendingSharedCampaigns({ sql }, viewer);
  const newProject = scopedHref("/brand/projects/new", choice);
  return (
    <div data-brand-home>
      <div className="bw-heading">
        <div>
          <h1>{b.dashboard.title}</h1>
          <p>{b.dashboard.subtitle}</p>
        </div>
        {workspace.projects.length > 0 && access.canRequest && <a href={newProject} className="bw-button bw-primary">{b.newProject}</a>}
      </div>
      {access.staff && choice && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} />}
      <ServiceGuide kind="campaign" b={b} showOther={!access.projectScopedOnly} organizationId={choice?.id} />
      {pendingShares > 0 && (
        <section className={access.fresh ? "bw-empty" : "bw-note"} data-brand-pending-share={pendingShares}>
          <h2>{b.pendingShareTitle}</h2>
          <p>{b.pendingShareBody}</p>
        </section>
      )}
      {access.fresh && pendingShares > 0 ? null : access.fresh ? (
        <section className="bw-panel">
          <h2>{b.needOrganization}</h2><ol className="bw-setup"><li>{b.performance.setupOne}</li><li>{b.performance.setupTwo}</li><li>{b.performance.setupThree}</li></ol>
          <p className="bw-note">{b.organizationHint}</p>
          <ActionForm
            operation="organization.create"
            b={b}
            submit={b.createOrganization}
            redirectTo="/brand/projects/new"
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
            access.staff ? (
              <section className="bw-empty" data-brand-empty="staff">
                <h2>{b.access.staffEmpty}</h2>
                <p>{b.access.staffEmptyBody}</p>
              </section>
            ) : access.canRequest ? (
              <section className="bw-empty" data-brand-empty="request">
                <h2>{b.empty}</h2>
                <p>{b.emptyBody}</p>
                <a className="bw-button bw-primary" href={newProject}>
                  {b.newProject}
                </a>
              </section>
            ) : (
              <section className="bw-empty" data-brand-empty="read-only">
                <h2>{b.access.viewerEmpty}</h2>
                <p>{b.access.viewerEmptyBody}</p>
              </section>
            )
          ) : (
            <CampaignList projects={workspace.projects} b={b} locale={locale}/>
          )}
          {access.hasOrganization && workspace.organizations.length > 0 && (
            <section className="bw-team-footer">
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
          )}
        </>
      )}
    </div>
  );
}
