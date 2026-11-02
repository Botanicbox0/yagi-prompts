import { describe, expect, it } from 'vitest';
import { approveBrandContent, createBrandProject } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';

/** Validation answers before any database work, so an unusable runner proves nothing was written. */
const deps = { sql: {} as SqlRunner };
const viewer = { userId: '00000000-0000-4000-8000-000000000001' } as Parameters<typeof createBrandProject>[1];
const id = () => crypto.randomUUID();
const brief = {
  organizationId: id(), requestId: id(), title: 'Autumn launch', objective: 'Introduce the collection',
  budgetKrw: null, productionMode: 'creator',
};

describe('brand workspace validation paths', () => {
  it('names the nested criteria field, not the whole criteria object', async () => {
    const result = await createBrandProject(deps, viewer, { ...brief, criteria: { platforms: [], minFollowers: 5000, maxFollowers: 100, primaryMetric: 'views', targetValue: null } });
    expect(result).toEqual({ ok: false, code: 'invalid', field: 'criteria.maxFollowers' });
  });

  it('names the reference row whose link was refused', async () => {
    const result = await createBrandProject(deps, viewer, { ...brief, referenceLinks: [
      { url: 'https://example.com/a', note: '' },
      { url: 'http://example.com/insecure', note: '' },
    ] });
    expect(result).toEqual({ ok: false, code: 'invalid', field: 'referenceLinks.1.url' });
  });

  it('keeps top-level field names unchanged', async () => {
    expect(await createBrandProject(deps, viewer, { ...brief, title: 'x' })).toEqual({ ok: false, code: 'invalid', field: 'title' });
    expect(await approveBrandContent(deps, viewer, {
      projectId: id(), contentVersionId: id(), expectedRevision: 0, decision: 'changes_requested', comment: '  ', requestId: id(),
    })).toEqual({ ok: false, code: 'invalid', field: 'comment' });
  });
});
