/**
 * Cross-island helper for opening the workspace `SupportDrawer` (support.tsx) with an optional
 * prefilled, customer-editable message draft and target organization ID.
 */
export const OPEN_BRAND_SUPPORT_EVENT = 'twings:open-brand-support';

export interface OpenBrandSupportDetail {
  organizationId?: string;
  draft?: string;
}

export interface ClosedAllowanceDraftCopy {
  closedRequestDraft: string;
  closedRequestOrgFallback: string;
}

export function buildClosedAllowanceDraft(
  copy: ClosedAllowanceDraftCopy,
  organizationName: string | null | undefined,
): string {
  const cleanName = organizationName?.trim() || copy.closedRequestOrgFallback;
  return copy.closedRequestDraft.replace('{organization}', cleanName);
}

export function resolveSupportOpenDetail<T extends { id: string }>(
  detail: unknown,
  organizations: readonly T[],
  currentOrganizationId: string,
): { organizationId: string; draft: string | null } {
  if (!detail || typeof detail !== 'object') {
    return { organizationId: currentOrganizationId, draft: null };
  }
  const obj = detail as Record<string, unknown>;
  const requestedOrg = typeof obj.organizationId === 'string' ? obj.organizationId : null;
  const organizationId =
    requestedOrg && organizations.some((org) => org.id === requestedOrg) ? requestedOrg : currentOrganizationId;
  const draft = typeof obj.draft === 'string' ? obj.draft : null;
  return { organizationId, draft };
}

type EventDispatcher = Pick<Window, 'dispatchEvent'>;

export function openBrandSupport(detail: OpenBrandSupportDetail = {}, targetWindow?: EventDispatcher | null): void {
  const win = targetWindow ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return;
  let dispatched = false;
  if (typeof CustomEvent === 'function') {
    const event = new CustomEvent<OpenBrandSupportDetail>(OPEN_BRAND_SUPPORT_EVENT, {
      detail,
      cancelable: true,
    });
    // SupportDrawer calls event.preventDefault() when mounted.
    dispatched = !win.dispatchEvent(event);
  } else {
    win.dispatchEvent({ type: OPEN_BRAND_SUPPORT_EVENT, detail } as unknown as Event);
    return;
  }
  if (!dispatched && typeof document !== 'undefined') {
    document.querySelector<HTMLButtonElement>('[data-concierge-launcher]')?.click();
  }
}
