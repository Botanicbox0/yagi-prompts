import type { BrandCopy } from "./action-form";

/**
 * Shown on every page the TWINGS team opens for a brand it is not a member of: this is a read-only
 * view, not the customer's seat. `manageHref` (DB admins only) points at the existing admin screen,
 * which authorizes itself; this component grants nothing.
 */
export function StaffNotice({ b, manageHref }: { b: BrandCopy; manageHref?: string | null }) {
  return (
    <aside className="bw-note bw-staff-note" role="note" data-brand-staff-view>
      <div>
        <strong>{b.access.staffTitle}</strong>
        <p>{b.access.staffReadOnly}</p>
      </div>
      {manageHref && <a className="bw-button" href={manageHref} data-brand-staff-manage>{b.access.staffManage} →</a>}
    </aside>
  );
}

/** Existing admin destinations only; nothing new is opened by linking to them. */
// The dedicated brand host rejects /admin. Local and preview hosts support both surfaces.
export const adminOrganizationHref = (organizationId: string, brandHost = false) => `${brandHost ? 'https://admin.twings.app' : ''}/admin/brand-workspace/organizations/${organizationId}`;
export const adminProjectHref = (projectId: string, brandHost = false) => `${brandHost ? 'https://admin.twings.app' : ''}/admin/brand-workspace/${projectId}`;
