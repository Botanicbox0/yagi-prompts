import { describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
import { AdminShell, AdminSectionNav, AdminFilterBar, AdminFold, AdminBadge } from '@/components/admin/chrome';
import { getDictionary } from '@/lib/i18n/dictionaries';
async function html(node: ReactNode) { const { prelude } = await prerender(node); return new Response(prelude).text(); }
describe('one admin workspace shell', () => {
  it.each(['home', 'prompts', 'campaigns', 'inquiries', 'brandWorkspace', 'policy', 'playbooks'] as const)('keeps the same navigation and language controls on %s', async active => {
    const markup = await html(<AdminShell dict={getDictionary('ko').admin} locale="ko" active={active}><p>Content</p></AdminShell>);
    expect(markup).toContain('data-admin-navigation');
    expect(markup).toContain('data-admin-active="' + active + '"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain('action="/api/workspace-locale"');
    expect(markup).toContain('action="/admin/do"');
    expect(markup).toContain('action="/auth/signout"');
    expect(markup).toContain('href="/admin"');
  });

  it('renders shared list/detail pattern primitives (AdminSectionNav, AdminFilterBar, AdminFold, AdminBadge)', async () => {
    const markup = await html(
      <div>
        <AdminSectionNav
          ariaLabel="섹션 이동"
          items={[
            { id: 'triage', label: '검수 대기', count: 4 },
            { id: 'settings', label: '설정', count: 0 },
          ]}
        />
        <AdminFilterBar
          ariaLabel="상태 필터"
          items={[
            { href: '/admin/renders?status=all', label: '전체', count: 12, active: true },
            { href: '/admin/renders?status=failed', label: '실패', count: 2, active: false },
          ]}
        />
        <AdminFold summary="캠페인 상세 설정 수정" badge="편집">
          <p>Form body</p>
        </AdminFold>
        <AdminBadge tone="danger">위험</AdminBadge>
      </div>,
    );
    expect(markup).toContain('data-admin-section-nav');
    expect(markup).toContain('href="#triage"');
    expect(markup).toContain('data-admin-filter-bar');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-admin-fold');
    expect(markup).toContain('data-admin-badge="danger"');
  });
});
