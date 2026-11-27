/**
 * Hand-written key sets and forbidden strings (not captured output) describing closed-switch
 * (`BRAND_CAMPAIGN_OPS=off` or excluded org/seat) prop maps, React element shapes, and rendered values
 * on main commit b27eb51f222ff68853f0ae4689425bf527ff05c3 (`0bfae54f~1`).
 */
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * Source commit inspectable via `git show 0bfae54f~1:<path>` across:
 *   - app/(brand)/layout.tsx
 *   - app/(brand)/brand/home/page.tsx
 *   - app/(brand)/brand/page.tsx
 *   - app/(brand)/brand/rooms/[projectId]/page.tsx
 *   - app/(brand)/brand/projects/[id]/page.tsx
 *   - components/brand-workspace/project-detail.tsx
 *   - app/(brand)/brand/projects/[id]/reports/[reportId]/page.tsx
 *   - app/(brand)/brand/projects/new/page.tsx
 */

export const MAIN_PARITY_SOURCE_COMMIT = 'b27eb51f222ff68853f0ae4689425bf527ff05c3';

export const CLOSED_SWITCH_FORBIDDEN_STRINGS = [
  '캠페인 운영',
  '제작 의뢰',
  'campaignOps',
  'opsTrack',
  'track-context',
] as const;

export const MAIN_NAV_PROP_KEYS = [
  'billing',
  'creators',
  'home',
  'homeLabel',
  'identity',
  'library',
  'locale',
  'members',
  'pendingShare',
  'railExpanded',
  'railModes',
  'rooms',
  'roomsCopy',
  'scope',
  'settings',
  'shell',
  'soundStudio',
  'studio',
  'studioV2',
  'workspaceMenu',
] as const;

export const MAIN_BELL_PROP_KEYS = [
  'bellCopy',
  'candidates',
  'children',
  'locale',
  'railModes',
  'rooms',
  'scope',
  'send',
] as const;

export const MAIN_HOME_PROP_KEYS = [
  'activeProjects',
  'allowance',
  'canOpenBilling',
  'checklist',
  'copy',
  'layout',
  'locale',
  'notice',
  'organizationId',
  'organizationName',
  'planCatalogue',
  'readOnly',
  'results',
  'reviews',
  'viewerNote',
] as const;

export const MAIN_PROJECT_DETAIL_PROP_KEYS_WITH_ROOM = [
  'applicants',
  'b',
  'backHref',
  'formatTitle',
  'generativeMediaAllowed',
  'locale',
  'payments',
  'project',
  'prototypeLayer',
  'roomEntry',
  'shortlist',
  'shortlistCount',
  'staffManageHref',
  'staffTools',
  'usage',
] as const;

export const MAIN_PROJECT_DETAIL_PROP_KEYS_WITHOUT_ROOM = MAIN_PROJECT_DETAIL_PROP_KEYS_WITH_ROOM.filter(
  (k) => k !== 'roomEntry',
);

export const MAIN_INTAKE_WIZARD_PROP_KEYS = [
  'copy',
  'initialTrack',
  'organizations',
  'selfStudioClosed',
] as const;

export function expectedMainIntakeQueryCases(): ReadonlyArray<{
  query: { track?: string; start?: string };
  initialTrack: string | undefined;
}> {
  // Exact main behavior from 0bfae54f~1:app/(brand)/brand/projects/new/page.tsx:
  // initialTrack={typeof track === "string" ? track : undefined} (unknown & start=ops ignored).
  return [
    { query: { track: 'studio_film' }, initialTrack: 'studio_film' },
    { query: { track: 'not_real' }, initialTrack: 'not_real' },
    { query: { track: 'creator_campaign', start: 'ops' }, initialTrack: 'creator_campaign' },
  ];
}

export function expectedMainRoomsNavKeys(): readonly string[] {
  return ['commission', 'commissions', 'groupMake', 'groupTeam', 'messages', 'mode', 'unread', 'unreadShort'];
}

export function expectedMainHomeCopySummary(ko: Dictionary) {
  return {
    roomsNav: ko.roomsShell.nav,
    activeStatus: ko.brandWorkspace.status.active,
    allAssets: ko.studioLibrary.allAssets,
  };
}

export function expectedMainRoomShellStructure(projectId: string) {
  return {
    providerName: 'RoomShareInvitesProvider',
    childCount: 1,
    childTag: 'div',
    rootClass: 'brr-room',
    projectId,
    directChildNames: ['RoomHeader', 'RoomTabs', 'section'],
  };
}

export function expectedMainReportStructure(projectId: string, backLabel: string) {
  return {
    rootType: 'Fragment',
    childCount: 2,
    firstChild: { tag: 'a', className: 'bw-no-print bw-button', href: `/brand/projects/${projectId}`, text: `← ${backLabel}` },
    secondChildComponent: 'ReportResult',
  };
}
