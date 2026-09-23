import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import {
  loadBrandWorkspace,
  loadBrandMembers,
} from "@/lib/brands/workspace/service";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const [{ organizationId }, { sql, viewer, b, locale }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const workspace = await loadBrandWorkspace({ sql }, viewer);
  const owners = workspace.organizations.filter((o) => o.role === "owner");
  const id = organizationId ?? owners[0]?.id;
  const team = id ? await loadBrandMembers({ sql }, viewer, id) : null;
  return (
    <div data-brand-members>
      <div className="bw-heading">
        <div>
          <h1>{b.members}</h1>
          <p>{b.teamHint}</p>
        </div>
      </div>
      {owners.length > 1 && (
        <nav className="bw-tabs" aria-label={b.organizations}>
          {owners.map((o) => (
            <a key={o.id} href={`/brand/members?organizationId=${o.id}`} aria-current={team?.organization.id === o.id ? "page" : undefined}>
              {o.name}
            </a>
          ))}
        </nav>
      )}
      {!team ? (
        // Reaching this page without ownership is an expected state, not an error: say who can act.
        <section className="bw-empty" data-brand-members-unavailable>
          <p>
            {owners.length === 0
              ? workspace.organizations.length === 0
                ? b.access.sharedOnly
                : b.access.ownerOnlyTeam
              : b.denied}
          </p>
          <a href="/brand" className="bw-button">{b.back}</a>
        </section>
      ) : (
        <>
          <section className="bw-panel">
            <h2>{team.organization.name}</h2>
            <ul className="bw-list">
              {team.members
                .filter((m) => m.status === "active")
                .map((m) => (
                  <li className="bw-row" key={m.id}>
                    <div>
                      <strong>{m.email ?? b.roles[m.role]}</strong>
                      <p className="bw-muted">{b.roles[m.role]}</p>
                    </div>
                    {m.role !== "owner" && (
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
          <section className="bw-panel">
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
          </section>
          {team.invitations.length > 0 && (
            <section className="bw-panel">
              <h2>{b.invitations}</h2>
              <ul className="bw-list">
                {team.invitations.map((i) => (
                  <li key={i.id} className="bw-row">
                    <div>
                      {i.email}
                      <p className="bw-muted">
                        {b.roles[i.role]} · {b.expiresAt}{" "}
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
