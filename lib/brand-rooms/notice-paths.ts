/**
 * Where the room notice settings live (docs/BRAND-ROOMS-FEEDBACK.md §10): the section of the messages
 * inbox (`/brand/rooms`) with this id. No imports on purpose: the inbox (a client component), the page
 * after unsubscribing and the tests share it.
 */
export const ROOM_NOTICE_SETTINGS_ID = 'notice-settings';

/** The inbox of one brand, scrolled to the settings section. Relative: put it after the brand host. */
export function roomNoticeSettingsPath(organizationId: string): string {
  return `/brand/rooms?${new URLSearchParams({ organizationId: organizationId.toLowerCase() }).toString()}#${ROOM_NOTICE_SETTINGS_ID}`;
}
