import { BRAND_STUDIO_ACTION_PATH } from "@/lib/admin/brand-host-studio";
import type { BrandCopy } from "./action-form";
import { ManagedForm } from "./managed-form";

/**
 * A DB admin's campaign preparation on brand.twings.app (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비"):
 * the same fields and operations as the `/admin/brand-workspace` panel, posted to the brand host's
 * studio door. The campaign starts hidden from the client; its page then shows the shortlist panel
 * with the campaign ID the import worker needs. The page heading carries the title and intro.
 */
export function StudioPrep({ b, organizations, selectedId }: {
  b: BrandCopy;
  organizations: ReadonlyArray<{ id: string; name: string }>;
  selectedId: string | null;
}) {
  const c = b.studioPrep;
  const selected = organizations.some((o) => o.id === selectedId) ? selectedId! : organizations[0]?.id;
  return (
    <section className="bw-panel" data-studio-prep={organizations.length}>
      {organizations.length === 0 ? (
        <p className="bw-note">{c.noBrands}</p>
      ) : (
        <ManagedForm op="brandWorkspace.createProject" action={BRAND_STUDIO_ACTION_PATH} b={b} submit={c.submit}>
          <label>
            {c.brand}
            <select name="organizationId" defaultValue={selected} required data-studio-prep-brand>
              {organizations.map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}
            </select>
            <span className="bw-muted">{c.brandHint}</span>
          </label>
          <label>{b.projectTitle}<input name="title" minLength={3} maxLength={120} required /></label>
          <label>{c.objective}<textarea name="objective" minLength={3} maxLength={2000} required /></label>
          <label>{c.budget}<input type="number" name="budgetKrw" min={0} inputMode="numeric" /></label>
          <input type="hidden" name="productionMode" value="creator" />
        </ManagedForm>
      )}
      <p className="bw-note" data-studio-prep-next>{c.next}</p>
      <details className="bw-contract-add" data-studio-prep-new-brand open={organizations.length === 0}>
        <summary>{c.newBrand}</summary>
        <p className="bw-muted">{c.newBrandHint}</p>
        <ManagedForm op="brandWorkspace.organization" action={BRAND_STUDIO_ACTION_PATH} b={b} submit={c.newBrand}>
          <label>{c.brand}<input name="name" minLength={2} maxLength={100} required autoComplete="organization" /></label>
        </ManagedForm>
      </details>
    </section>
  );
}
