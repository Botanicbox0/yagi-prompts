/** URL-only queue state. No outcome text or arbitrary return paths are accepted. */
export type InboxKind = 'all' | 'brand' | 'feedback';
export type InboxStatus = 'new' | 'ongoing' | 'closed' | 'all';
export interface InboxFilters { kind: InboxKind; status: InboxStatus; query: string }
export function inboxFilters(params: Record<string, string | string[] | undefined>): InboxFilters {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const kind = one('kind'), status = one('status');
  return { kind: kind === 'brand' || kind === 'feedback' ? kind : 'all', status: kind === 'feedback' && status === 'closed' ? 'all' : status === 'new' || status === 'ongoing' || status === 'closed' ? status : 'all', query: one('q').trim().slice(0, 200) };
}
export function inboxHref(filters: InboxFilters, patch: Partial<InboxFilters> = {}): string {
  const value = { ...filters, ...patch };
  const params = new URLSearchParams({ kind: value.kind, status: value.status });
  if (value.query) params.set('q', value.query);
  return `/admin/inquiries?${params}`;
}
export function matchesInboxItem(kind: Exclude<InboxKind, 'all'>, status: string, text: string, filters: InboxFilters): boolean {
  if (filters.kind !== 'all' && filters.kind !== kind) return false;
  const state = status === 'contacted' || status === 'replied' ? 'ongoing' : status;
  return (filters.status === 'all' || filters.status === state) && text.toLowerCase().includes(filters.query.toLowerCase());
}
