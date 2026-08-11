import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilterBar } from '@/components/library/filter-bar';
import { LibraryEmpty, LibraryGrid, LibrarySkeleton, type GridLabels } from '@/components/library/grid';
import { parseLibraryQuery, type LibraryCard } from '@/lib/content/library';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * PLAN §3.2 — the library surface renders behind the session gate, so it cannot be swept
 * anonymously over HTTP (there is no way to mint a session yet, §11). These render its components
 * server-side instead, which is what catches the failure the sweep would have caught: a card, a
 * filter or an empty state that throws.
 */

const dict = getDictionary('en');

const labels: GridLabels = {
  steps: dict.library.steps,
  proBlocks: dict.library.proBlocks,
  open: dict.library.open,
  showcase: dict.featured.showcaseLabel,
  loginWall: dict.featured.loginWallLabel,
  badgeNew: dict.badge.new,
  badgeUpdated: dict.badge.updated,
  emptyTitle: dict.library.emptyTitle,
  emptyBody: dict.library.emptyBody,
  catalogEmptyTitle: dict.library.catalogEmptyTitle,
  catalogEmptyBody: dict.library.catalogEmptyBody,
  clear: dict.library.clear,
};

const card: LibraryCard = {
  playbookId: '11111111-1111-4111-8111-111111111111',
  revisionId: '11111111-1111-4111-8111-1111111111a1',
  slug: 'character-sheet-generation',
  category: 'character',
  difficulty: 'intermediate',
  title: { en: 'Character sheet generation', ko: '캐릭터 시트 제작' },
  summary: { en: 'One face, many poses.', ko: '한 얼굴, 여러 포즈.' },
  tools: ['ComfyUI'],
  models: ['GPT Image 2'],
  estTimeMin: 45,
  estCostUsd: 1.2,
  isShowcase: true,
  publishedAt: '2026-08-12T00:00:00.000Z',
  firstPublishedAt: '2026-08-12T00:00:00.000Z',
  updatedAt: null,
  hero: { key: `${'a'.repeat(64)}.png`, mime: 'image/png', w: 1600, h: 900 },
  stepCount: 2,
  blockCount: 7,
  proBlockCount: 3,
  promptCount: 1,
};

describe('library grid (§3.2)', () => {
  const html = renderToStaticMarkup(
    <LibraryGrid
      cards={[card]}
      locale="en"
      labels={labels}
      categoryLabel={(k) => k}
      difficultyLabel={(k) => k}
    />,
  );

  it('opens every published playbook — the funnel split is a marketing rule, not this one', () => {
    expect(html).toContain('href="/en/p/character-sheet-generation"');
    expect(html).not.toContain('href="/library"');
  });

  it('shows the "N pro blocks" indicator and the step count', () => {
    expect(html).toContain('3 pro blocks');
    expect(html).toContain('2 steps');
  });

  it('addresses hero media through the gateway when no CDN is configured (§11)', () => {
    // `publicContentUrl` answers null with no Supabase project, and the library is behind the
    // login wall, so the entitlement-checked gateway is the correct fallback.
    expect(html).toContain('/api/media/11111111-1111-4111-8111-1111111111a1%3Ahero');
  });

  it('has two different empty states with two different answers', () => {
    const filtered = renderToStaticMarkup(<LibraryEmpty filtered labels={labels} />);
    const bare = renderToStaticMarkup(<LibraryEmpty filtered={false} labels={labels} />);
    expect(filtered).toContain(labels.emptyTitle);
    expect(filtered).toContain('href="/library"');
    expect(bare).toContain(labels.catalogEmptyTitle);
    expect(bare).not.toContain('href="/library"');
  });

  it('renders a skeleton, never a spinner (§3.2)', () => {
    const skeleton = renderToStaticMarkup(<LibrarySkeleton label="Loading" count={2} />);
    expect(skeleton).toContain('aria-busy="true"');
    expect(skeleton).toContain('bg-hairline');
    expect(skeleton).not.toMatch(/animate-spin|spinner/);
  });
});

describe('library filters (§3.2) — the URL is the state', () => {
  const html = renderToStaticMarkup(
    <FilterBar
      query={parseLibraryQuery({ category: 'video', q: 'kling' })}
      facets={{
        categories: ['video', 'character'],
        difficulties: ['beginner', 'advanced'],
        tags: ['ComfyUI', 'Kling 3.0'],
      }}
      filtered
      labels={{
        search: dict.library.search,
        searchPlaceholder: dict.library.searchPlaceholder,
        category: dict.library.filterCategory,
        difficulty: dict.library.filterDifficulty,
        tag: dict.library.filterTag,
        all: dict.library.filterAll,
        apply: dict.library.apply,
        clear: dict.library.clear,
        sortNewest: dict.library.sortNewest,
        categoryLabel: (k) => k,
        difficultyLabel: (k) => k,
      }}
    />,
  );

  it('is a plain GET form, so it works with JavaScript off', () => {
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/library"');
    for (const name of ['q', 'category', 'difficulty', 'tag']) {
      expect(html, name).toContain(`name="${name}"`);
    }
  });

  it('reflects the current query back into the controls', () => {
    expect(html).toContain('value="kling"');
    expect(html).toContain('<option value="video" selected="">');
  });

  it('offers only facets that exist, plus an explicit "all"', () => {
    expect(html).toContain('>Kling 3.0<');
    expect(html).toContain(`>${dict.library.filterAll}<`);
    expect(html).not.toContain('>music<');
  });

  it('offers a way out when something is filtered', () => {
    expect(html).toContain(dict.library.clear);
  });

  it('offers no sort control — §3.2 has exactly one order in v1', () => {
    expect(html).not.toContain('name="sort"');
  });
});
