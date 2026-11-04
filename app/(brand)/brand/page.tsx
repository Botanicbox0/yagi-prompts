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
            padding: "24px",
            borderRadius: "24px",
            marginBottom: "24px",
            background: "#FFFFFF",
            boxShadow: "var(--ys-card)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "18px",
            }}
          >
            <div>
              <p className="bw-kicker" style={{ marginBottom: "4px" }}>
                {locale === "ko" ? "무엇부터 시작할까요?" : "WHERE TO START"}
              </p>
              <h2 style={{ fontSize: "20px", fontWeight: 600, letterSpacing: "-0.03em", margin: 0 }}>
                {locale === "ko"
                  ? "브랜드 자산을 등록하거나, 레퍼런스 영상·화보 리믹스를 바로 시작하세요"
                  : "Register your brand assets or start remixing reference films and editorials"}
              </h2>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
            }}
          >
            <a
              href={scopedHref("/brand/identity", choice)}
              data-home-onboarding-cta
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "14px",
                borderRadius: "20px",
                background: "#F8F9FA",
                border: "1px solid rgba(0,0,0,0.06)",
                textDecoration: "none",
                color: "inherit",
                gap: "12px",
              }}
            >
              <div
                style={{
                  height: "148px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  background: "#E8EFF7",
                  position: "relative",
                }}
              >
                <img
                  src="/reel/landing/look-feather.webp"
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "10px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background: "rgba(18, 18, 22, 0.68)",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  STEP 1 · 30초 설정
                </span>
              </div>
              <div>
                <strong style={{ fontSize: "15px", display: "block", marginBottom: "4px" }}>
                  {locale === "ko" ? "우리 브랜드 기억시키기" : "Teach Your Brand Identity"}
                </strong>
                <p className="bw-muted" style={{ fontSize: "13px", margin: 0, lineHeight: 1.5 }}>
                  {locale === "ko"
                    ? "웹사이트 주소와 대표 제품 사진만 올리면 브랜드 색감·로고·금칙어를 자동으로 정리합니다."
                    : "Drop your website URL and product photos to lock your palette, logo, and tone."}
                </p>
              </div>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--ys-accent-text)",
                }}
              >
                {locale === "ko" ? "브랜드 메모리 열기 →" : "Open Brand Memory →"}
              </span>
            </a>

            <a
              href={scopedHref("/brand/studio", choice)}
              data-home-studio-cta
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "14px",
                borderRadius: "20px",
                background: "#F8F9FA",
                border: "1.5px solid rgba(56, 117, 197, 0.35)",
                textDecoration: "none",
                color: "inherit",
                gap: "12px",
              }}
            >
              <div
                style={{
                  height: "148px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  background: "#E8EFF7",
                  position: "relative",
                }}
              >
                <img
                  src="/reel/landing/v7/rx-runway-duo.jpg"
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "10px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background: "#3875C5",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  STEP 2 · 메인 스튜디오
                </span>
              </div>
              <div>
                <strong style={{ fontSize: "15px", display: "block", marginBottom: "4px" }}>
                  {locale === "ko" ? "레퍼런스 영상·화보 리믹스" : "Remix Reference Films & Looks"}
                </strong>
                <p className="bw-muted" style={{ fontSize: "13px", margin: 0, lineHeight: 1.5 }}>
                  {locale === "ko"
                    ? "검증된 패션·뷰티 필름의 카메라 무빙과 빛은 그대로 두고, 제품과 색감만 우리 브랜드로 바꿉니다."
                    : "Keep the camera choreography and lighting of proven films while swapping in your product."}
                </p>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignSelf: "flex-start",
                  padding: "6px 14px",
                  borderRadius: "999px",
                  background: "#3875C5",
                  color: "#FFFFFF",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                {locale === "ko" ? "스튜디오에서 바로 만들기 →" : "Open Production Studio →"}
              </span>
            </a>

            <a
              href={`${scopedHref("/brand/studio", choice)}#micro-roi`}
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "14px",
                borderRadius: "20px",
                background: "#F8F9FA",
                border: "1px solid rgba(0,0,0,0.06)",
                textDecoration: "none",
                color: "inherit",
                gap: "12px",
              }}
            >
              <div
                style={{
                  height: "148px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  background: "#E8EFF7",
                  position: "relative",
                }}
              >
                <img
                  src="/reel/landing/c-logo-ours.webp"
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "10px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background: "rgba(18, 18, 22, 0.68)",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  STEP 3 · 부분 복원 & 마감
                </span>
              </div>
              <div>
                <strong style={{ fontSize: "15px", display: "block", marginBottom: "4px" }}>
                  {locale === "ko" ? "로고·제품·피부 부분 수선 & 사운드" : "Detail Repair & Sound Finish"}
                </strong>
                <p className="bw-muted" style={{ fontSize: "13px", margin: 0, lineHeight: 1.5 }}>
                  {locale === "ko"
                    ? "전체 사진을 다시 뽑지 않고 흐린 로고나 피부만 네모로 찍어 복원하고, 클라이맥스 사운드를 입힙니다."
                    : "Fix only the logo, bottle, or skin inside a box without re-rendering the rest of the frame."}
                </p>
              </div>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--ys-accent-text)",
                }}
              >
                {locale === "ko" ? "부분 수선·사운드 열기 →" : "Open Detail Repair →"}
              </span>
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
