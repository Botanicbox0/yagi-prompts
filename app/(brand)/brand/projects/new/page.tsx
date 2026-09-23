import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { brandScope, membershipOf } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref } from "@/lib/brands/workspace/selection";
export default async function NewBrandProject({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, b }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice, choices } = await brandScope(sql, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // A brief goes to the SELECTED brand, and only when that brand's role may send one.
  const workspace = { organizations: membershipOf(choice) };
  const organizations = workspace.organizations.filter(
    (o) => o.role !== "viewer",
  );
  const back = scopedHref("/brand", choice);
  return (
    <div data-brand-new-project>
      <div className="bw-heading">
        <div>
          <a href={back}>← {b.back}</a>
          <h1>{b.newProject}</h1>
          <p>{b.emptyBody}</p>
        </div>
      </div>
      {!choices.some((c) => c.role !== "guest") ? (
        // No workspace yet: create it here and come straight back, instead of bouncing via /brand
        // (which, for campaign-only invitees, shows their campaigns and no creation form).
        <section className="bw-panel" data-brand-new-project-setup>
          <h2>{b.needOrganization}</h2>
          <p className="bw-note">{b.organizationHint}</p>
          <ActionForm
            operation="organization.create"
            b={b}
            submit={b.createOrganization}
            redirectTo="/brand/projects/new"
          >
            <label>
              {b.organization}
              <input name="name" minLength={2} maxLength={100} required autoComplete="organization" />
            </label>
          </ActionForm>
        </section>
      ) : organizations.length === 0 ? (
        <section className="bw-empty" data-brand-new-project-read-only>
          <p>{choice?.role === "guest" ? b.access.sharedOnly : b.access.viewerCannotRequest}</p>
          <a href={back} className="bw-button">
            {b.back}
          </a>
        </section>
      ) : (
        <section className="bw-panel">
          <ActionForm operation="project.create" b={b} submit={b.submitProject}>
            <label>
              {b.organization}
              <select name="organizationId" required>
                {organizations.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {b.projectTitle}
              <input name="title" required minLength={3} maxLength={120} />
            </label>
            <label>
              {b.objective}
              <textarea
                name="objective"
                required
                minLength={3}
                maxLength={2000}
                rows={4}
              />
            </label>
            <label>
              {b.audience}
              <textarea name="audience" maxLength={1000} rows={3} />
            </label>
            <div className="bw-grid">
              <label>
                {b.budget}
                <input
                  name="budgetKrw"
                  type="number"
                  min={0}
                  max={1000000000000}
                  step={1}
                  inputMode="numeric"
                />
                <span className="bw-muted">{b.budgetHint}</span>
              </label>
              <label>
                {b.taxBasis}
                <select name="budgetTaxBasis">
                  <option value="unspecified">{b.tax.unspecified}</option>
                  <option value="included">{b.tax.included}</option>
                  <option value="excluded">{b.tax.excluded}</option>
                </select>
              </label>
            </div>
            <div className="bw-grid">
              <label>
                {b.startsOn}
                <input type="date" name="startsOn" />
              </label>
              <label>
                {b.endsOn}
                <input type="date" name="endsOn" />
              </label>
            </div>
            <label>
              {b.production}
              <select name="productionMode">
                <option value="creator">{b.productionModes.creator}</option>
                <option value="studio">{b.productionModes.studio}</option>
              </select>
              <span className="bw-muted">
                {b.creatorHint} {b.studioHint}
              </span>
            </label>
            <details>
              <summary>{b.criteria}</summary>
              <p className="bw-note">{b.criteriaHint}</p>
              <div className="bw-grid">
                {(["instagram", "tiktok", "x", "youtube"] as const).map(
                  (platform) => (
                    <label className="bw-check" key={platform}>
                      <input
                        type="checkbox"
                        name="platforms"
                        value={platform}
                      />
                      {b.platforms[platform]}
                    </label>
                  ),
                )}
              </div>
              <div className="bw-grid">
                <label>
                  {b.minFollowers}
                  <input
                    name="minFollowers"
                    type="number"
                    min={0}
                    max={1000000000}
                    step={1}
                  />
                </label>
                <label>
                  {b.maxFollowers}
                  <input
                    name="maxFollowers"
                    type="number"
                    min={0}
                    max={1000000000}
                    step={1}
                  />
                </label>
              </div>
              <div className="bw-grid">
                <label>
                  {b.primaryMetric}
                  <select name="primaryMetric">
                    <option value="views">{b.metricNames.views}</option>
                    <option value="engagement">
                      {b.metricNames.engagement}
                    </option>
                    <option value="content_count">
                      {b.metricNames.content_count}
                    </option>
                  </select>
                </label>
                <label>
                  {b.targetValue}
                  <input name="targetValue" type="number" min={0} step={1} />
                </label>
              </div>
            </details>
            <div>
              <h2>{b.references}</h2>
              <p className="bw-muted">{b.referenceHint}</p>
              {[0, 1, 2].map((i) => (
                <div className="bw-grid" key={i} style={{ marginTop: 16 }}>
                  <label>
                    {b.referenceUrl}
                    <input
                      name="referenceUrl"
                      type="url"
                      maxLength={2048}
                      placeholder="https://"
                    />
                  </label>
                  <label>
                    {b.referenceNote}
                    <input name="referenceNote" maxLength={500} />
                  </label>
                </div>
              ))}
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
