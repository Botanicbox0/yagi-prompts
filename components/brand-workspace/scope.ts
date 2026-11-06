import { cache } from "react";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { loadBrandWorkspaceScope } from "@/lib/brands/workspace/service";
import { resolveWorkspaceSelection, selectedChoice, type BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import type { BrandOrganization } from "@/lib/brands/workspace/types";
import { workspaceAccess } from "./access";

/** Deduplicated per server render when layout and page both load the workspace scope. */
export const loadCachedBrandWorkspaceScope = cache(
  (sql: SqlRunner, verifiedEmail: string | undefined, viewer: Viewer) =>
    loadBrandWorkspaceScope({ sql, verifiedEmail }, viewer),
);

/**
 * The brand a page works on, from its `?organizationId=` (validated against this account's own
 * choices) or the brand that owns the page's campaign. Same rule as the sidebar selector.
 */
export async function brandScope(deps: { sql: SqlRunner; verifiedEmail?: string }, viewer: Viewer, query: string | string[] | undefined, routeOrganizationId?: string) {
  const scope = await loadCachedBrandWorkspaceScope(deps.sql, deps.verifiedEmail, viewer);
  const selection = resolveWorkspaceSelection(scope.choices, { query: query ?? null, routeOrganizationId: routeOrganizationId ?? null });
  return { ...scope, selection, choice: selectedChoice(selection) };
}


/** The selected brand as a membership, or none for a campaign-only guest or the TWINGS team view. */
export function membershipOf(choice: BrandWorkspaceChoice | null): BrandOrganization[] {
  return choice && choice.role !== "guest" && choice.role !== "studio" ? [{ id: choice.id, name: choice.name, role: choice.role }] : [];
}

/**
 * `workspaceAccess` for the SELECTED brand only: owning another brand grants nothing here. The TWINGS
 * team view is a brand with nothing to request, set up or own: every section reads, none writes.
 */
export function selectedAccess(choice: BrandWorkspaceChoice | null, projects: readonly unknown[]) {
  if (choice?.role === "studio")
    return { hasOrganization: true, canRequest: false, isOwner: false, projectScopedOnly: false, fresh: false, staff: true };
  return { ...workspaceAccess({ organizations: membershipOf(choice), projects }), staff: false };
}
