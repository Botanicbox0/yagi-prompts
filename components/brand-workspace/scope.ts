import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { loadBrandWorkspaceScope } from "@/lib/brands/workspace/service";
import { resolveWorkspaceSelection, selectedChoice, type BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import type { BrandOrganization } from "@/lib/brands/workspace/types";
import { workspaceAccess } from "./access";

/**
 * The brand a page works on, from its `?organizationId=` (validated against this account's own
 * choices) or the brand that owns the page's campaign. Same rule as the sidebar selector.
 */
export async function brandScope(sql: SqlRunner, viewer: Viewer, query: string | string[] | undefined, routeOrganizationId?: string) {
  const scope = await loadBrandWorkspaceScope({ sql }, viewer);
  const selection = resolveWorkspaceSelection(scope.choices, { query: query ?? null, routeOrganizationId: routeOrganizationId ?? null });
  return { ...scope, selection, choice: selectedChoice(selection) };
}

/** The selected brand as a membership, or none for a campaign-only guest. */
export function membershipOf(choice: BrandWorkspaceChoice | null): BrandOrganization[] {
  return choice && choice.role !== "guest" ? [{ id: choice.id, name: choice.name, role: choice.role }] : [];
}

/** `workspaceAccess` for the SELECTED brand only: owning another brand grants nothing here. */
export function selectedAccess(choice: BrandWorkspaceChoice | null, projects: readonly unknown[]) {
  return workspaceAccess({ organizations: membershipOf(choice), projects });
}
