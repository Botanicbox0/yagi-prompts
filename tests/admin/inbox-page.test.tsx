import { describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { BrandInquiry } from '@/lib/brands/repo';
import type { RenderFeedbackRow } from '@/lib/renders/feedback';
const fixture = vi.hoisted(() => ({ brands: [] as BrandInquiry[], feedback: [] as RenderFeedbackRow[] }));
// Each admin page verifies the admin itself; these tests render the page as one.
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => ({ isAdmin: true }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/brands/repo', () => ({ listBrandInquiries: async (_sql: unknown, args: { statuses: string[] }) => fixture.brands.filter(row => args.statuses.includes(row.status)) }));
vi.mock('@/lib/renders/feedback', () => ({ listRenderFeedback: async () => fixture.feedback }));
vi.mock('@/lib/brands/slack-delivery', () => ({ loadBrandInquiryDeliveryStates: async () => new Map() }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
import Inquiries from '@/app/(admin)/admin/inquiries/page';
import { getDictionary } from '@/lib/i18n/dictionaries';
const base: BrandInquiry = { id: 'brand-new', createdAt: '2026-10-01T00:00:00Z', locale: 'ko', inquiryType: 'campaign', useCase: 'undecided', company: 'Fixture studio', contactName: 'Fixture contact', email: 'fixture@example.test', phone: null, budgetBand: 'undecided', templateSlug: null, timing: null, message: 'sample request', consentAt: '2026-10-01T00:00:00Z', userId: null, status: 'new', contactedAt: null, receiptSentAt: null };
const feedback: RenderFeedbackRow = { id: 'feedback-new', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', renderId: 'fixture-render', userId: 'fixture-user', reason: 'playback', message: 'sample feedback', status: 'new', repliedAt: null, templateSlug: 'fixture-template', renderStatus: 'succeeded', medium: 'video', email: 'fixture@example.test' };
async function render(params: Record<string, string> = {}) {
  fixture.brands = [base, { ...base, id: 'brand-contacted', company: 'Other fixture', status: 'contacted' }, { ...base, id: 'brand-closed', company: 'Archive fixture', status: 'closed' }];
  fixture.feedback = [feedback, { ...feedback, id: 'feedback-replied', status: 'replied' }];
  const { prelude } = await prerender(await Inquiries({ searchParams: Promise.resolve(params) }));
  return new Response(prelude).text();
}
describe('admin inquiry queue SSR', () => {
  it('keeps existing Slack row anchors reachable across all loaded brand statuses', async () => {
    const html = await render();
    for (const id of ['brand-new', 'brand-contacted', 'brand-closed']) expect(html).toContain(`id="inquiry-${id}"`);
    expect(html).toContain('data-inbox-results="5"');
  });

  it('starts with new requests across both kinds and exposes native GET search', async () => {
    const html = await render({ status: 'new' });
    expect(html).toContain('id="inquiry-brand-new"');
    expect(html).toContain('id="feedback-feedback-new"');
    expect(html).not.toContain('id="inquiry-brand-contacted"');
    expect(html).not.toContain('id="inquiry-brand-closed"');
    expect(html).not.toContain('id="feedback-feedback-replied"');
    expect(html).toContain('data-inbox-results="2"');
    expect(html).toMatch(/<form[^>]*action="\/admin\/inquiries"[^>]*method="get"/);
  });
  it('preserves kind, status and search in every queue mutation and puts its outcome by the return anchor', async () => {
    const html = await render({ kind: 'brand', status: 'all', q: 'Fixture studio', ok: 'saved' });
    expect(html).toContain('data-inbox-results="1"');
    expect(html).not.toContain('data-render-feedback="new"');
    expect(html).toContain('name="_back" value="/admin/inquiries?kind=brand&amp;status=all&amp;q=Fixture+studio#inbox-results"');
    expect(html).toContain('name="_op" value="brandInquiry.status"');
    expect(html.indexOf('id="inbox-results"')).toBeLessThan(html.indexOf('data-outcome="ok"'));
  });
  it('shows honest empty results and the loaded search window', async () => {
    const html = await render({ q: 'not-a-fixture' });
    expect(html).toContain('data-inbox-results="0"');
    expect(html).toContain(getDictionary('ko').admin.inbox.noResults);
    expect(html).toContain(getDictionary('ko').admin.inbox.windowNote);
    expect(html).not.toContain('name="_op" value="brandInquiry.status"');
  });
});
