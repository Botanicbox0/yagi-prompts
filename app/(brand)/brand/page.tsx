import { ServiceGuide } from "@/components/brand-workspace/service-guide";
import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { countPendingSharedCampaigns, loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { brandScope, selectedAccess } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref, sectionVisibility } from "@/lib/brands/workspace/selection";
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
  const studioOpen = !choice || sectionVisibility(choice).studio;
  return (
    <div data-brand-home>
      <div className="bw-heading">
        <div>
          <div className="bw-title">
            <h1>{b.dashboard.title}</h1>
            {workspace.projects.length > 0 && <span className="bw-count-chip" data-campaign-total>{workspace.projects.length}</span>}
          </div>
          <p>{b.dashboard.subtitle}</p>
        </div>
        {workspace.projects.length > 0 && access.canRequest && <a href={newProject} className="bw-button bw-primary">{b.newProject}</a>}
        {/* DB admins prepare campaigns as the studio (docs/BRAND-STAFF-ACCESS.md); team-domain readers do not. */}
        {access.staff && viewer.isAdmin && <a href={newProject} className="bw-button bw-primary" data-studio-prep-link>{b.studioPrep.cta}</a>}
      </div>
      {access.staff && choice && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} />}
      {studioOpen && choice && (
        <section
          className="bw-panel"
          data-brand-home-studio-shortcuts
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "16px",
            borderLeft: "4px solid #3875C5",
          }}
        >
          <div>
            <strong>
              {locale === "ko"
                ? `${choice.name} · 올인원 브랜드 에셋 & 프로덕션 스튜디오`
                : `${choice.name} · All-in-One Brand Asset & Production Studio`}
            </strong>
            <p className="bw-muted" style={{ marginTop: "4px" }}>
              {locale === "ko"
                ? "6단계 브랜드 온보딩(웹사이트·SNS·제품·룩북 인제스트)과 5대 프로덕션 스튜디오(2D 공간 블로킹 · 레퍼런스 영상 역설계 · 극소 부위 5단계 수선 · 3-Track 사운드 마스터 · Frame.io 시사)를 바로 실행하세요."
                : "Launch the 6-step Brand Memory Onboarding and 5-Module Production Studio (2D Spatial Stage, Video Reverse, 5-Step Micro-ROI, 3-Track Sound, Frame Review)."}
            </p>
          </div>
          <div className="bw-row" style={{ gap: "8px" }}>
            <a
              href={scopedHref("/brand/identity", choice)}
              className="bw-button"
              data-home-onboarding-cta
            >
              {locale === "ko" ? "① 브랜드 온보딩 · 메모리 설정 →" : "① Brand Onboarding & Memory →"}
            </a>
            <a
              href={scopedHref("/brand/studio", choice)}
              className="bw-button bw-primary"
              data-home-studio-cta
            >
              {locale === "ko" ? "② 통합 프로덕션 스튜디오 열기 →" : "② Open Production Studio →"}
            </a>
          </div>
        </section>
      )}
      {workspace.projects.length === 0 && <ServiceGuide kind="campaign" b={b} studioAllowed={studioOpen} showOther={!access.projectScopedOnly && studioOpen} organizationId={choice?.id} />}
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
          {workspace.projects.length > 0 && <details className="bw-service-disclosure" data-brand-service-disclosure><summary>{b.dashboard.serviceGuideToggle}</summary><ServiceGuide kind="campaign" b={b} studioAllowed={studioOpen} showOther={!access.projectScopedOnly && studioOpen} organizationId={choice?.id} /></details>}
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
