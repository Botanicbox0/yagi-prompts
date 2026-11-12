import { ServiceGuide } from "@/components/brand-workspace/service-guide";
import { CampaignMoatShowcase } from "@/components/brand-workspace/campaign-moat-showcase";
import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { countPendingSharedCampaigns, loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { brandScope, selectedAccess } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { poolVisible, scopedHref, sectionVisibility } from "@/lib/brands/workspace/selection";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
import { CAMPAIGN_LIST_ANCHOR } from "@/components/brand-studio/doors";
import { brandRoomsOpen, brandStudioV2Open } from "@/lib/flags";
import { influencersOpen } from "@/lib/influencers/rules";
import { featureDenied } from "@/lib/brands/features";
import { roomsOpenFor } from "@/components/brand-rooms/room/visibility";
import { roomUnreadCounts } from "@/lib/brand-rooms/overview";
import { studioShowroomVisible, studioV2Visible } from "@/lib/brand-studio/visibility";
import { getDictionary } from "@/lib/i18n/dictionaries";
export default async function BrandHome({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, dict, locale }] = await Promise.all([searchParams, brandContext()]);
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
  // Studio v2 (docs/BRAND-STUDIO-V2.md §5.1): three doors replace the showcase. A sandboxed or
  // generation-closed brand fails studioV2Visible and keeps exactly the page below.
  const doors = choice && brandStudioV2Open() && studioV2Visible(choice, true) ? choice : null;
  // Project rooms (docs/BRAND-ROOMS.md §3): "룸 열기" on each card, only while rooms are open for this
  // brand (flag on, not sandboxed, generation allowed, not the team view). Closed: the list is unchanged.
  const rooms = choice && roomsOpenFor(choice, brandRoomsOpen())
    ? {
        organizationId: choice.id,
        unread: await roomUnreadCounts(sql, { organizationId: choice.id, userId: viewer.userId, projectIds: workspace.projects.map((p) => p.id) }),
        copy: dict.roomsShell.entry,
      }
    : null;
  const campaignList = rooms ? <CampaignList projects={workspace.projects} b={b} locale={locale} rooms={rooms}/> : <CampaignList projects={workspace.projects} b={b} locale={locale}/>;
  const totalRoomUnread = rooms ? Object.values(rooms.unread).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0) : 0;
  const creatorsEntry = Boolean(rooms && choice && influencersOpen() && poolVisible(choice) && !featureDenied(choice.denied, "creator_pool"));
  const projectOnlyShowroom = Boolean(rooms && choice && !access.staff && choice.role !== "guest" && studioShowroomVisible(choice, brandStudioV2Open()));
  const sp = dict.roomsShell.space;
  return (
    <div data-brand-home data-project-space={rooms ? "" : undefined}>
      {rooms ? (
        <div className="bw-heading" data-project-space-header>
          <div>
            <p className="bw-kicker">{sp.eyebrow}</p>
            <div className="bw-title">
              <h1>{sp.title}</h1>
              {workspace.projects.length > 0 && <span className="bw-count-chip" data-campaign-total>{workspace.projects.length}</span>}
            </div>
            <p>{sp.subtitle}</p>
          </div>
          <div className="bw-row">
            <a href={scopedHref("/brand/rooms", choice)} className="bw-button" data-project-space-inbox>
              {sp.inboxLink}
              {totalRoomUnread > 0 ? ` (${totalRoomUnread})` : ""}
            </a>
            {creatorsEntry && (
              <a href={scopedHref("/brand/creators", choice)} className="bw-button" data-project-space-creators>
                {sp.creatorsLink}
              </a>
            )}
            {access.canRequest && (
              <a href={newProject} className="bw-button bw-primary" data-project-space-new>
                {sp.newBrief}
              </a>
            )}
          </div>
        </div>
      ) : (
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
      )}
      {access.staff && choice && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} />}
      {projectOnlyShowroom && choice && (
        <section className="bw-note" data-project-only-retention-notice>
          <p style={{ margin: 0 }}>
            {sp.retentionNotice}{" "}
            <a href={scopedHref("/brand/studio", choice)} style={{ fontWeight: 600, color: "#3063A7" }}>
              {sp.retentionCta}
            </a>
          </p>
        </section>
      )}
      {workspace.projects.length === 0 && !choice && (
        <ServiceGuide kind="campaign" b={b} studioAllowed={studioOpen} showOther={!access.projectScopedOnly && studioOpen} />
      )}
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
          ) : doors ? (
            <section id={CAMPAIGN_LIST_ANCHOR} data-brand-campaigns>{campaignList}</section>
          ) : (
            campaignList
          )}
          {!doors && choice && studioOpen && (
            <CampaignMoatShowcase
              locale={locale === "en" ? "en" : "ko"}
              organizationId={choice.id}
              studioOpen={studioOpen}
              canRequest={access.canRequest}
              membersOpen={sectionVisibility(choice).members}
              settingsOpen={sectionVisibility(choice).settings}
            />
          )}
          <details className="bw-service-disclosure" data-brand-service-disclosure>
            <summary>{b.dashboard.serviceGuideToggle}</summary>
            <ServiceGuide kind="campaign" b={b} studioAllowed={studioOpen} showOther={!access.projectScopedOnly && studioOpen} organizationId={choice?.id} />
          </details>
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
