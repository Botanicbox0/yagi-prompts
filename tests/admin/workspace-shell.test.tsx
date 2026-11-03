import { describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
import { AdminShell } from '@/components/admin/chrome';
import { MetricStrip, SectionJumpBar } from '@/components/admin/patterns';
import { TemplateSpecSummaryCard } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PromptRow } from '@/lib/prompts/repo';
async function html(node: ReactNode) { const { prelude } = await prerender(node); return new Response(prelude).text(); }
describe('one admin workspace shell', () => {
  it.each(['home', 'renders', 'prompts', 'campaigns', 'inquiries', 'brandWorkspace', 'contests', 'community', 'payments', 'users'] as const)('keeps the same navigation and language controls on %s', async active => {
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

  it('renders Operate v2 SectionJumpBar and MetricStrip with tabular numerals and section anchors', async () => {
    const markup = await html(
      <div>
        <SectionJumpBar
          label="Jump to section"
          items={[
            { id: 'brand-dna', label: 'Brand DNA', count: '5' },
            { id: 'feature-policy', label: 'Feature policy', count: '1' },
          ]}
        />
        <MetricStrip
          label="Key metrics"
          items={[
            { key: 'campaigns', label: 'Active campaigns', value: '3' },
            { key: 'looks', label: 'Saved looks', value: '8', tone: 'action' },
          ]}
        />
      </div>,
    );
    expect(markup).toContain('data-admin-jump-bar');
    expect(markup).toContain('href="#brand-dna"');
    expect(markup).toContain('href="#feature-policy"');
    expect(markup).toContain('data-admin-metric-strip');
    expect(markup).toContain('data-metric="campaigns"');
  });

  it('renders TemplateSpecSummaryCard with unit economics and Zero-Leak Director vault badge', async () => {
    const mockRow = {
      id: '00000000-0000-0000-0000-000000000001',
      slug: 'seoul-runway',
      status: 'published',
      number: 12,
      category: 'fashion',
      featured: true,
      sortOrder: 10,
      medium: 'video',
      engine: 'seedance-2.0-pro',
      aspectDefault: '9:16',
      runtimeSeconds: 5,
      priceKrw: 1900,
      price1080Krw: 2900,
      source: 'yagi',
      textVisibility: 'private',
      title: { ko: '서울 런웨이', en: 'Seoul Runway' },
      summary: { ko: '런웨이', en: 'Runway' },
      promptText: { ko: '프롬프트 본문', en: 'Prompt body' },
      steps: [],
      tips: [],
      tags: ['fashion'],
      variables: [],
      media: {},
      publishedAt: new Date(),
      updatedAt: new Date(),
    } as unknown as PromptRow;

    const markup = await html(<TemplateSpecSummaryCard row={mockRow} dict={getDictionary('ko')} locale="ko" />);
    expect(markup).toContain('data-template-spec-summary');
    expect(markup).toContain('seedance-2.0-pro');
    expect(markup).toContain('Gemini 3.8 Flash');
    expect(markup).toContain('1,900원');
  });
});
