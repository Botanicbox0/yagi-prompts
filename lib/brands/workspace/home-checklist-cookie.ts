/** Client- & server-safe cookie helper for per-organization first-run checklist dismissal. */
export const HOME_CHECKLIST_DISMISS_COOKIE_PREFIX = 'twings_home_checklist_dismissed_';

export function homeChecklistDismissCookieName(organizationId: string): string {
  return `${HOME_CHECKLIST_DISMISS_COOKIE_PREFIX}${organizationId.toLowerCase()}`;
}

export function readChecklistDismissedFromCookie(_organizationId: string, cookieValue: string | null | undefined): boolean {
  return cookieValue === '1';
}
