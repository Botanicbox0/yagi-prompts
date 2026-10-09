import { describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
describe('admin queue return fragments', () => {
  it('preserves filters and a stable queue anchor for success and failure', () => {
    expect(outcomeUrl('/admin/inquiries?kind=brand&status=new&q=a%26b#inbox-results', { ok: true, code: 'saved' })).toBe('/admin/inquiries?kind=brand&status=new&q=a%26b&ok=saved#inbox-results');
    expect(outcomeUrl('/admin/inquiries#inbox-results', { ok: false, code: 'invalid' })).toBe('/admin/inquiries?err=invalid#inbox-results');
  });
  it('keeps return-path guards and discards obsolete outcome messages', () => {
    expect(outcomeUrl('https://outside.example/test#x', { ok: true, code: 'saved' })).toBe('/admin?ok=saved');
    expect(outcomeUrl('/account#x', { ok: true, code: 'saved' })).toBe('/admin?ok=saved');
    expect(outcomeUrl('/admin/inquiries?err=invalid&detail=old#inbox-results', { ok: true, code: 'saved' })).toBe('/admin/inquiries?ok=saved#inbox-results');
  });
});

describe('registered inquiry status operations return to the filtered queue', () => {
  it.each(['brandInquiry.status', 'renderFeedback.status'])('%s preserves query and anchor on success and failure', async operation => {
    const id = 'a0000000-0000-4000-8000-000000000001';
    const back = '/admin/inquiries?kind=brand&status=all&q=fixture#inbox-results';
    const query = vi.fn().mockResolvedValue({ rows: [{ id }] });
    const context = { viewer: { tier: 'admin', isAdmin: true, userId: id }, sql: { query }, storage: {} } as unknown as AdminContext;
    const form = new FormData();
    form.set('_op', operation); form.set('_back', back); form.set('id', id); form.set('status', 'closed');
    const success = await dispatchAdmin(operation, form, context);
    expect(success).toEqual({ ok: true, code: 'saved' });
    expect(outcomeUrl(back, success)).toBe('/admin/inquiries?kind=brand&status=all&q=fixture&ok=saved#inbox-results');
    expect(query).toHaveBeenCalledWith(expect.stringContaining(operation === 'brandInquiry.status' ? 'update brand_inquiries' : 'update render_feedback'), [id, 'closed']);
    query.mockResolvedValueOnce({ rows: [] });
    const failure = await dispatchAdmin(operation, form, context);
    const failedUrl = new URL(outcomeUrl(back, failure), 'https://admin.example.test');
    expect(failure).toMatchObject({ ok: false, code: 'notFound' });
    expect(failedUrl.searchParams.get('q')).toBe('fixture');
    expect(failedUrl.searchParams.get('status')).toBe('all');
    expect(failedUrl.searchParams.get('err')).toBe('notFound');
    expect(failedUrl.hash).toBe('#inbox-results');
    expect(outcomeUrl('https://outside.example/test', success)).toBe('/admin?ok=saved');
  });
});
