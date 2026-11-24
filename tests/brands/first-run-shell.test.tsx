import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * The shell an account WITHOUT a workspace sees: the "create your workspace" screen (`/brand`) and the
 * invitation landing (`/brand/invite`). It is the first screen of every new brand customer, and it is
 * the one place the `topbar` layout is still drawn for a studio customer (a workspace gets the rail).
 *
 * Found on the real screen, 2026-11-24:
 *  - the bar kept a hard-coded white background from the light theme while every word on it follows the
 *    dark theme's ink, so the lockup, the "no brand yet" line, sign-out and the powered-by mark could not
 *    be read;
 *  - the first tab was an icon with no name: the layout withholds the studio label from a viewer with no
 *    studio-capable brand, but the tab was drawn anyway;
 *  - the remaining tabs (library, campaigns, the order toggle) led to pages that could only say "no brand
 *    yet", and a signed-out visitor on the invitation landing got every tab and a sign-out button.
 * Now such a bar has no tabs at all; it keeps the topbar frame (the lockup, the brand line, language and,
 * when signed in, sign-out stay in the layout).
 */
const state = vi.hoisted(() => ({ path: '/brand' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(''),
}));

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';

const b = getDictionary('ko').brandWorkspace;
const labels = { home: b.home, members: b.members, settings: b.managed.settings, library: b.managed.library };
const NO_WORKSPACE: BrandWorkspaceScope = { choices: [], projectOrganizations: {} };

/** `[href, visible text]` of every link in the markup. */
function links(html: string): Array<[string, string]> {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [
    m[1]!,
    m[2]!.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim(),
  ]);
}

describe('the shell of an account without a workspace', () => {
  it('draws no tabs at all, and so no tab without a name, while the topbar frame stays', () => {
    // app/(brand)/layout.tsx passes studio="" to a signed-in viewer with no studio-capable brand.
    const html = renderToStaticMarkup(<WorkspaceNavigation {...labels} studio="" scope={NO_WORKSPACE} />);
    expect(html).toContain('data-brand-layout-mode="topbar"');
    expect(links(html)).toEqual([]);
    expect(html).not.toContain('data-nav-item');
    expect(html).not.toContain('data-nav-order-toggle');
  });

  it('draws no tabs for a signed-out visitor either, even when the studio label travels', () => {
    const html = renderToStaticMarkup(<WorkspaceNavigation {...labels} studio={b.productionStudio.title} scope={null} />);
    expect(html).toContain('data-brand-layout-mode="topbar"');
    expect(links(html)).toEqual([]);
    expect(html).not.toContain('data-nav-invite-cta');
  });

  it('keeps named tabs for an account waiting on a shared campaign', () => {
    const html = renderToStaticMarkup(<WorkspaceNavigation {...labels} studio="" scope={NO_WORKSPACE} pendingShare />);
    expect(html).toContain('data-brand-layout-mode="topbar"');
    const all = links(html);
    expect(all.length).toBeGreaterThan(0);
    for (const [href, text] of all) expect(text, `link to ${href} has no name`).not.toBe('');
    expect(html).not.toContain('data-nav-item="/brand/studio"');
  });
});

describe('app/(brand)/workspace.css — the topbar follows the theme', () => {
  const css = readFileSync(path.join(process.cwd(), 'app/(brand)/workspace.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** The declaration blocks of the rule that paints the bar itself (desktop and narrow). */
  const blocks = [...css.matchAll(/\.bw-shell:has\(\[data-brand-layout-mode="topbar"\]\) \.bw-sidebar\s*\{([^}]*)\}/g)].map((m) => m[1]!);

  it('finds the bar rule in both width ranges', () => {
    expect(blocks.length).toBe(2);
  });

  it('paints the bar from a theme token, never a literal light colour', () => {
    for (const block of blocks) {
      const background = /(?:^|;)\s*background\s*:\s*([^;]+);/.exec(block)?.[1]?.trim();
      expect(background, 'the bar rule sets its own background').toBeTruthy();
      expect(background).toMatch(/var\(--ys-surface\)/);
      expect(background).not.toMatch(/rgba?\(\s*255|#fff|white/i);
    }
  });
});
