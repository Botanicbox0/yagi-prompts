import { describe, expect, it } from 'vitest';
import { inboxFilters, inboxHref, matchesInboxItem } from '@/lib/admin/inbox-filters';

describe('admin inquiry queue filters', () => {
  it('defaults to all loaded work for existing row links and rejects unknown or repeated values', () => {
    expect(inboxFilters({ kind: 'feedback', status: 'closed' })).toEqual({ kind: 'feedback', status: 'all', query: '' });
    expect(inboxFilters({})).toEqual({ kind: 'all', status: 'all', query: '' });
    expect(inboxFilters({ kind: ['brand'], status: 'invalid', q: ['secret'] })).toEqual({ kind: 'all', status: 'all', query: '' });
  });
  it('matches each real status without treating replied or contacted as new', () => {
    const filters = inboxFilters({ status: 'ongoing' });
    expect(matchesInboxItem('brand', 'contacted', 'Example', filters)).toBe(true);
    expect(matchesInboxItem('feedback', 'replied', 'Example', filters)).toBe(true);
    expect(matchesInboxItem('brand', 'new', 'Example', filters)).toBe(false);
    expect(matchesInboxItem('brand', 'closed', 'Example', filters)).toBe(false);
  });
  it('combines kind, normalized text and status without mutating filters', () => {
    const filters = inboxFilters({ kind: 'brand', status: 'all', q: '  SAMPLE 회사  ' });
    expect(matchesInboxItem('brand', 'closed', 'sample 회사 message', filters)).toBe(true);
    expect(matchesInboxItem('feedback', 'new', 'sample 회사 message', filters)).toBe(false);
    expect(matchesInboxItem('brand', 'new', 'other', filters)).toBe(false);
    expect(filters.query).toBe('SAMPLE 회사');
  });
  it('builds a safe same-origin return URL preserving filters but no outcome parameters', () => {
    const filters = inboxFilters({ kind: 'feedback', status: 'ongoing', q: 'a&b / + 한글', ok: 'saved' });
    const href = inboxHref(filters);
    const url = new URL(href, 'https://admin.example.test');
    expect(url.pathname).toBe('/admin/inquiries');
    expect(url.searchParams.get('q')).toBe('a&b / + 한글');
    expect(url.searchParams.get('kind')).toBe('feedback');
    expect(url.searchParams.get('status')).toBe('ongoing');
    expect(url.searchParams.has('ok')).toBe(false);
    expect(inboxHref(filters, { kind: 'brand' })).toContain('kind=brand');
    expect(filters.kind).toBe('feedback');
  });
});
