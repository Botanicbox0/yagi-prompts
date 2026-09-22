import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import {
  loadBrandSettings,
  loadBrandWorkspace,
} from "@/lib/brands/workspace/service";
export default async function BrandSettings({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const [{ organizationId }, { sql, viewer, b }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const workspace = await loadBrandWorkspace({ sql }, viewer);
  const selected = organizationId ?? workspace.organizations[0]?.id;
  const org = selected
      ? await loadBrandSettings({ sql }, viewer, selected)
      : null,
    c = b.managed;
  return (
    <div data-brand-settings>
      <div className="bw-heading">
        <div>
          <h1>{c.settings}</h1>
          <p>{c.profileHint}</p>
        </div>
      </div>
      <nav className="bw-status-tabs">
        {workspace.organizations.map((o) => (
          <a
            key={o.id}
            href={`/brand/settings?organizationId=${o.id}`}
            aria-current={org?.id === o.id ? "page" : undefined}
          >
            {o.name}
          </a>
        ))}
      </nav>
      {!org ? (
        <p className="bw-note">{b.denied}</p>
      ) : (
        <section className="bw-panel bw-settings-panel">
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
        </section>
      )}
    </div>
  );
}
