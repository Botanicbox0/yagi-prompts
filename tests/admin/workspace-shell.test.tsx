import { describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
import { AdminShell } from '@/components/admin/chrome';
import { getDictionary } from '@/lib/i18n/dictionaries';
async function html(node: ReactNode) { const { prelude } = await prerender(node); return new Response(prelude).text(); }
describe('one admin workspace shell', () => {
  it.each(['home', 'prompts', 'campaigns', 'inquiries', 'brandWorkspace', 'contests', 'community'] as const)('keeps the same navigation and language controls on %s', async active => {
    const markup = await html(<AdminShell dict={getDictionary('ko').admin} locale="ko" active={active}><p>Content</p></AdminShell>);
    expect(markup).toContain('data-admin-navigation');
    expect(markup).toContain('data-admin-active="' + active + '"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain('action="/api/workspace-locale"');
    expect(markup).toContain('action="/admin/do"');
    expect(markup).toContain('action="/auth/signout"');
    expect(markup).toContain('href="/admin"');
  });

  // docs/ADMIN.md §2.1 — the old product's screens keep their routes but no menu entry.
  it.each(['playbooks', 'policy'] as const)('marks no menu entry current on the legacy %s screen', async active => {
    const ko = getDictionary('ko').adminConsole;
    const markup = await html(<AdminShell dict={getDictionary('ko').admin} locale="ko" active={active}><p>Content</p></AdminShell>);
    expect(markup).toContain('data-admin-navigation');
    expect(markup).not.toContain('aria-current="page"');
    expect(markup).toContain(ko.legacy);
    expect(markup).toContain(ko.nav[active]);
  });

  it('folds the menu behind a scriptless toggle on small screens', async () => {
    const markup = await html(<AdminShell dict={getDictionary('ko').admin} locale="ko" active="home"><p>Content</p></AdminShell>);
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*id="admin-menu-toggle"/);
    expect(markup).toContain('for="admin-menu-toggle"');
    expect(markup).toContain('id="admin-navigation"');
    // Refresh returns to the page it was pressed on.
    expect(markup).toContain('name="_back" value="/admin"');
  });
});
