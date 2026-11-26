/**
 * Action filtering and scope-policy lookup bridging `asset-hub-spine` with `HubTile` / `HubDetail` (R-A Fix 2).
 */
import type { StudioBrandProjectGroup, StudioBrandProjectOverview } from "@/lib/brand-studio/contracts";
import type { HubAction } from "../asset-hub-model";
import { finishedScopeControls, isFinishedProjectGroup, type ScopeControls } from "./model";

/** Resolves `finishedScopeControls` from a `ScopeView` scope key (`project:<id>`). */
export function finishedScopeControlsForKey(
  scopeKey: string | undefined,
  overview: Pick<StudioBrandProjectOverview, "projects">,
  initialProjectGroup?: StudioBrandProjectGroup | null,
): ScopeControls {
  if (!scopeKey || !scopeKey.startsWith("project:")) return finishedScopeControls(false);
  const target = scopeKey.slice("project:".length).toLowerCase();
  const group =
    overview.projects.find((g) => g.project.id.toLowerCase() === target) ??
    (initialProjectGroup && initialProjectGroup.project.id.toLowerCase() === target ? initialProjectGroup : null);
  return finishedScopeControls(isFinishedProjectGroup(group));
}

/**
 * Applies `finishedScopeControls` to `HubTile` / `HubDetail` actions (R-A Fix 2):
 * active scopes return actions untouched; finished scopes keep only `projectMove` (`move out`).
 */
export function applyScopeControlsToActions(
  actions: { main: HubAction | null; more: HubAction[] },
  controls?: ScopeControls | null,
): { main: HubAction | null; more: HubAction[] } {
  if (!controls || controls.canAddWork) return actions;
  return {
    main: null,
    more: controls.canMoveOut ? actions.more.filter((action) => action.key === "projectMove") : [],
  };
}
