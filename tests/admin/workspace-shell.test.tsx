import { describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
import { AdminShell } from '@/components/admin/chrome';
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
});
