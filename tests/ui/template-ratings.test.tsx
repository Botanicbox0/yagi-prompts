import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Ratings on the decision screen render only when there is at least one (docs/PLATFORM-2.0.md
 * §15.1: an empty "아직 평가가 없어요" right before paying is a second letdown, not information).
 */

const mocks = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/creator-platform/service', () => ({ ratingSummary: mocks.summary }));

import { TemplateRatings } from '@/components/community/ratings';

const copy = getDictionary('ko').community;

describe('template ratings on the template page', () => {
  beforeEach(() => vi.stubEnv('TWINGS_COMMUNITY', 'on'));
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('renders nothing while there are no ratings — no empty-state sentence', async () => {
    mocks.summary.mockResolvedValue({ average: null, count: 0, distribution: [0, 0, 0, 0, 0], studioScore: null });
    expect(await TemplateRatings({ templateId: 't', copy })).toBeNull();
    mocks.summary.mockResolvedValue({ average: null, count: 0, distribution: [0, 0, 0, 0, 0], studioScore: 4.5 });
    expect(await TemplateRatings({ templateId: 't', copy })).toBeNull();
  });

  it('renders the average and the count from the first rating on', async () => {
    mocks.summary.mockResolvedValue({ average: 4, count: 1, distribution: [0, 0, 0, 1, 0], studioScore: null });
    const html = renderToStaticMarkup((await TemplateRatings({ templateId: 't', copy }))!);
    expect(html).toContain('data-template-ratings');
    expect(html).toContain('★ 4.0 / 5');
    expect(html).not.toContain(copy.noRatings);
  });
});
