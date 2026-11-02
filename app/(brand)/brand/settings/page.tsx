import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { loadBrandSettings } from "@/lib/brands/workspace/service";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { LogoControl } from "@/components/brand-workspace/logo-control";
import { BrandAvatar } from "@/components/brand-workspace/brand-avatar";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
export default async function BrandSettings({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // Brand settings are for members of the selected brand; a campaign-only guest has none to open.
  // The TWINGS team reads them here; edits stay with owners and the admin console.
  const org = choice && choice.role !== "guest" ? await loadBrandSettings({ sql, verifiedEmail }, viewer, choice.id) : null,
    c = b.managed;
  return (
    <div data-brand-settings>
      <div className="bw-heading">
        <div>
          <h1>{c.settings}</h1>
          <p>{c.profileHint}</p>
        </div>
      </div>
      {!org ? (
        <section className="bw-empty" data-brand-settings-unavailable>
          <p>{!choice || choice.role === "guest" ? b.access.sharedOnly : b.denied}</p>
          <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
        </section>
      ) : (
        <section className="bw-panel bw-settings-panel">
          {org.role === "studio" ? (
            <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(org.id, brandHost) : null} />
          ) : org.role !== "owner" && <p className="bw-note" data-brand-settings-read-only>{b.access.ownerOnlySettings}</p>}
          <ActionForm
            operation="organization.update"
            fixed={{ organizationId: org.id, expectedRevision: org.revision }}
            b={b}
            submit={b.save}
            disabled={org.role !== "owner"}
          >
            <fieldset disabled={org.role !== "owner"} className="bw-fields">
              <label>
                {b.organization}
                <input
                  name="name"
                  defaultValue={org.name}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </label>
              <label>
                {c.website}
                <input
                  name="website"
                  type="url"
                  defaultValue={org.website}
                  maxLength={2048}
                  placeholder="https://"
                />
              </label>
              <label>
                {c.description}
                <textarea
                  name="description"
                  defaultValue={org.description}
                  maxLength={2000}
                  rows={4}
                />
              </label>
              <label>
                {c.contactEmail}
                <input
                  name="contactEmail"
                  type="email"
                  defaultValue={org.contactEmail}
                  maxLength={254}
                />
              </label>
            </fieldset>
          </ActionForm>
          <section className="bw-logo-section" aria-labelledby="brand-logo-heading" data-brand-logo>
            <h2 id="brand-logo-heading">{b.identity.logo}</h2>
            {org.role === "owner" ? (
              <LogoControl organizationId={org.id} name={org.name} logoUrl={org.logoUrl} logoRevision={org.logoRevision} b={b} />
            ) : (
              <div className="bw-logo-current">
                <BrandAvatar name={org.name} logoUrl={org.logoUrl} />
                {!org.logoUrl && <p className="bw-muted">{b.identity.logoNone}</p>}
              </div>
            )}
          </section>
        </section>
      )}
    </div>
  );
}
