import type { BrandOrganization } from "@/lib/brands/workspace/types";

/**
 * What the workspace chrome should offer, derived from memberships the server already scoped.
 * Presentation only: every page and API still authorizes on its own, so a hidden link is never
 * the thing that keeps someone out.
 */
export function workspaceAccess(workspace: { organizations: readonly BrandOrganization[]; projects: readonly unknown[] }) {
  const hasOrganization = workspace.organizations.length > 0;
  return {
    hasOrganization,
    /** Owners and editors can send briefs; viewers read. */
    canRequest: workspace.organizations.some((o) => o.role !== "viewer"),
    isOwner: workspace.organizations.some((o) => o.role === "owner"),
    /** Invited to individual campaigns only, with no workspace membership. */
    projectScopedOnly: !hasOrganization && workspace.projects.length > 0,
    /** Signed in, nothing yet: the workspace-creation path stays open. */
    fresh: !hasOrganization && workspace.projects.length === 0,
  };
}
export type WorkspaceAccess = ReturnType<typeof workspaceAccess>;

export interface NavigationVisibility {
  studio: boolean;
  identity?: boolean;
  settings: boolean;
  members: boolean;
}
