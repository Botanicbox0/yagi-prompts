import { TEAM_NOTICE_KINDS, type TeamNoticeKind } from '@/lib/brands/team-notice-outbox';

/** URL-only queue state. No outcome text or arbitrary return paths are accepted. */
export type InboxKind = 'all' | 'brand' | 'feedback' | 'team';
export type InboxStatus = 'new' | 'ongoing' | 'closed' | 'all';
export interface InboxFilters { kind: InboxKind; status: InboxStatus; query: string }
export function inboxFilters(params: Record<string, string | string[] | undefined>): InboxFilters {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const kind = one('kind'), status = one('status');
  return {
    kind: kind === 'brand' || kind === 'feedback' || kind === 'team' ? kind : 'all',
    status: kind === 'feedback' && status === 'closed' ? 'all' : status === 'new' || status === 'ongoing' || status === 'closed' ? status : 'all',
    query: one('q').trim().slice(0, 200),
  };
}
export function inboxHref(filters: InboxFilters, patch: Partial<InboxFilters> = {}): string {
  const value = { ...filters, ...patch };
  const params = new URLSearchParams({ kind: value.kind, status: value.status });
  if (value.query) params.set('q', value.query);
  return `/admin/inquiries?${params}`;
}
export function matchesInboxItem(kind: 'brand' | 'feedback', status: string, text: string, filters: InboxFilters): boolean {
  if (filters.kind !== 'all' && filters.kind !== kind) return false;
  const state = status === 'contacted' || status === 'replied' ? 'ongoing' : status;
  return (filters.status === 'all' || filters.status === state) && text.toLowerCase().includes(filters.query.toLowerCase());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeamNoticeFilterStatus = 'all' | 'sent' | 'pending' | 'failed' | 'skipped';
export interface TeamNoticeFilters {
  noticeKind: 'all' | TeamNoticeKind;
  deliveryStatus: TeamNoticeFilterStatus;
  awaiting: boolean;
  organizationId: string | null;
  page: number;
}

export function teamNoticeFilters(params: Record<string, string | string[] | undefined>): TeamNoticeFilters {
  const one = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : '');
  const rawKind = one('noticeKind');
  const rawStatus = one('deliveryStatus');
  const rawAwaiting = one('awaiting');
  const rawOrg = one('organizationId') || one('org');
  const rawPage = Number(one('page'));
  const noticeKind = (TEAM_NOTICE_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as TeamNoticeKind)
    : 'all';
  const deliveryStatus: TeamNoticeFilterStatus =
    rawStatus === 'sent' || rawStatus === 'pending' || rawStatus === 'failed' || rawStatus === 'skipped'
      ? rawStatus
      : 'all';
  const organizationId = UUID_RE.test(rawOrg.trim()) ? rawOrg.trim().toLowerCase() : null;
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(500, rawPage) : 1;
  return {
    noticeKind,
    deliveryStatus,
    awaiting: rawAwaiting === '1' || rawAwaiting === 'true',
    organizationId,
    page,
  };
}

export function teamNoticeHref(
  base: InboxFilters,
  team: TeamNoticeFilters,
  patch: Partial<TeamNoticeFilters> & { kind?: InboxKind } = {},
): string {
  const nextKind = patch.kind ?? base.kind;
  const resetPage =
    patch.noticeKind !== undefined ||
    patch.deliveryStatus !== undefined ||
    patch.awaiting !== undefined ||
    patch.organizationId !== undefined ||
    patch.kind !== undefined;
  const nextTeam: TeamNoticeFilters = {
    noticeKind: patch.noticeKind ?? team.noticeKind,
    deliveryStatus: patch.deliveryStatus ?? team.deliveryStatus,
    awaiting: patch.awaiting ?? team.awaiting,
    organizationId: patch.organizationId !== undefined ? patch.organizationId : team.organizationId,
    page: patch.page ?? (resetPage ? 1 : team.page),
  };
  const params = new URLSearchParams({ kind: nextKind, status: base.status });
  if (base.query) params.set('q', base.query);
  if (nextTeam.noticeKind !== 'all') params.set('noticeKind', nextTeam.noticeKind);
  if (nextTeam.deliveryStatus !== 'all') params.set('deliveryStatus', nextTeam.deliveryStatus);
  if (nextTeam.awaiting) params.set('awaiting', '1');
  if (nextTeam.organizationId) params.set('organizationId', nextTeam.organizationId);
  if (nextTeam.page > 1) params.set('page', String(nextTeam.page));
  return `/admin/inquiries?${params}`;
}
