import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { loadBrandMembers } from "@/lib/brands/workspace/service";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { interpolate } from "@/lib/i18n/format";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, locale }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // Team management follows the role in the SELECTED brand, never ownership of another one.
  // The TWINGS team reads the list; inviting and revoking stay with owners and the admin console.
  const staff = choice?.role === "studio";
  const team = choice?.role === "owner" || staff ? await loadBrandMembers({ sql, verifiedEmail }, viewer, choice!.id) : null;
  return (
    <div data-brand-members>
      <div className="bw-heading">
        <div>
          <h1>{b.members}</h1>
          <p>{b.teamHint}</p>
        </div>
      </div>
      {!team ? (
        // Reaching this page without ownership is an expected state, not an error: say who can act.
        <section className="bw-empty" data-brand-members-unavailable>
          <p>
            {!choice || choice.role === "guest"
              ? b.access.sharedOnly
              : choice.role !== "owner"
                ? b.access.ownerOnlyTeam
                : b.denied}
          </p>
          <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
        </section>
      ) : (
        <>
          {staff && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(team.organization.id, brandHost) : null} />}
          <section className="bw-panel">
            <h2>{team.organization.name}</h2>
            <ul className="bw-list">
              {team.members
                .filter((m) => m.status === "active")
                .map((m) => (
                  <li className="bw-row" key={m.id}>
                    <div>
                      {/* Another owner's address stays private; the label alone says who it is. */}
                      <strong>{m.email ?? b.otherOwner}</strong>
                      {m.email !== null && <p className="bw-muted">{b.roles[m.role]}</p>}
                    </div>
                    {!staff && m.role !== "owner" && (
                      <ActionForm
                        operation="member.revoke"
                        fixed={{
                          organizationId: team.organization.id,
                          userId: m.userId,
                        }}
                        b={b}
                        submit={b.revoke}
                        tone="danger"
                        confirm={{ prompt: b.confirm.revokeMember, action: b.confirm.revokeMemberAction }}
                      />
                    )}
                  </li>
                ))}
            </ul>
          </section>
          {!staff && <section className="bw-panel">
            <h2>{b.createInvite}</h2>
            <ActionForm
              operation="invitation.create"
              fixed={{ organizationId: team.organization.id }}
              b={b}
              submit={b.createInvite}
            >
              <label>
                {b.inviteEmail}
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                />
              </label>
              <label>
                {b.role}
                <select name="role">
                  <option value="editor">{b.roles.editor}</option>
                  <option value="viewer">{b.roles.viewer}</option>
                </select>
              </label>
              <p className="bw-muted">{b.inviteExpiry}</p>
            </ActionForm>
          </section>}
          {team.invitations.length > 0 && (
            <section className="bw-panel">
              <h2>{b.invitations}</h2>
              <ul className="bw-list">
                {team.invitations.map((i) => (
                  <li key={i.id} className="bw-row">
                    <div>
                      {i.email}
                      <p className="bw-muted">
                        {i.project
                          ? i.project.title !== null ? interpolate(b.invitationCampaign, { title: i.project.title }) : b.invitationCampaignPending
                          : b.roles[i.role]}{" "}
                        · {b.expiresAt}{" "}
                        {formatBrandTimestamp(i.expiresAt, locale)}
                      </p>
                    </div>
                    <span className="bw-status">
                      {b.invitationStates[i.status]}
                    </span>
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
