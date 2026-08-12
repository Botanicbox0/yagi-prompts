import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approvePrompt,
  countRecentSubmissions,
  loadAllPrompts,
  loadPromptById,
  loadPromptBySlug,
  loadPromptsByStatus,
  loadPublishedPrompts,
  loadRelatedPrompts,
  loadSubmissionsByAuthor,
  rejectPrompt,
  setPromptArchived,
  setPromptFeatured,
  slugExists,
} from '@/lib/prompts/repo';
import { RATE_WINDOW_HOURS } from '@/lib/prompts/schemas';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { PROMPT_FIXTURES } from '../../scripts/prompt-fixtures';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §13 — the queries, against a real Postgres with the real fixtures in it.
 *
 * The interesting assertions here are all about what the queries REFUSE to return: the gallery
 * query must not see a pending row, the rate-limit count must not forget a rejected one, and
 * approve/reject must not move a row that is in the wrong state.
 */
describe('prompt repo (§13.1 / §13.2)', () => {
  let harness: PromptHarness;

  beforeAll(async () => {
    harness = await promptHarness();
  });
  afterAll(async () => harness.close());

  it('seeds the whole §13 fixture catalog', async () => {
    const all = await loadAllPrompts(harness.sql);
    expect(all).toHaveLength(PROMPT_FIXTURES.length);
    expect(all.filter((row) => row.source === 'yagi')).toHaveLength(8);
    expect(all.filter((row) => row.source === 'community')).toHaveLength(5);
  });

  it('returns published rows only, both rails, featured first then newest', async () => {
    const rows = await loadPublishedPrompts(harness.sql);
    expect(rows.every((row) => row.status === 'published')).toBe(true);
    expect(rows.map((row) => row.slug)).not.toContain('pending-underwater-drift');
    expect(rows.map((row) => row.slug)).not.toContain('rejected-stock-lookalike');

    // §13.2 rail order: every featured row precedes every unfeatured one.
    const lastFeatured = rows.map((row) => row.featured).lastIndexOf(true);
    const firstPlain = rows.map((row) => row.featured).indexOf(false);
    expect(lastFeatured).toBeLessThan(firstPlain);

    // Within a group, newest first.
    const plain = rows.filter((row) => !row.featured).map((row) => row.publishedAt ?? '');
    expect([...plain].sort().reverse()).toEqual(plain);
  });

  it('loads by slug WHATEVER the status — the caller decides what that means', async () => {
    const pending = await loadPromptBySlug(harness.sql, 'pending-underwater-drift');
    expect(pending?.status).toBe('pending');
    const rejected = await loadPromptBySlug(harness.sql, 'rejected-stock-lookalike');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectReason).toContain('stock footage');
    expect(await loadPromptBySlug(harness.sql, 'no-such-prompt')).toBeNull();
  });

  it('prefers a shared use case for related, never returns the item itself, never a draft', async () => {
    const item = (await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))!;
    const related = await loadRelatedPrompts(harness.sql, {
      id: item.id,
      source: item.source,
      useCase: item.useCase,
    });

    expect(related).toHaveLength(4);
    expect(related.map((row) => row.slug)).not.toContain('neon-alley-dolly');
    expect(related.every((row) => row.status === 'published')).toBe(true);
    // The first hit shares `cinematic` with the subject.
    expect(related[0]!.useCase).toContain('cinematic');
  });

  it('lists a submitter their own rows, newest first, including the refused ones', async () => {
    const rows = await loadSubmissionsByAuthor(harness.sql, FIXTURE_USERS.free.id);
    expect(rows.map((row) => row.slug)).toContain('pending-underwater-drift');
    expect(rows.every((row) => row.authorId === FIXTURE_USERS.free.id)).toBe(true);

    const pro = await loadSubmissionsByAuthor(harness.sql, FIXTURE_USERS.pro.id);
    expect(pro.map((row) => row.slug)).toContain('rejected-stock-lookalike');
  });

  it('queues pending oldest-first — a queue, not a feed', async () => {
    const pending = await loadPromptsByStatus(harness.sql, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.slug).toBe('pending-underwater-drift');
  });

  /**
   * §13.1 rate limit. Counted over EVERY status: letting a rejection refill the quota is exactly
   * the loop an abuser would run.
   */
  it('counts recent submissions across every status', async () => {
    expect(await countRecentSubmissions(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS)).toBe(3);
    expect(await countRecentSubmissions(harness.sql, FIXTURE_USERS.pro.id, RATE_WINDOW_HOURS)).toBe(2);
    expect(await countRecentSubmissions(harness.sql, FIXTURE_USERS.admin.id, RATE_WINDOW_HOURS)).toBe(0);
  });

  it('knows when a slug is taken, and lets a row keep its own', async () => {
    const item = (await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))!;
    expect(await slugExists(harness.sql, 'neon-alley-dolly')).toBe(true);
    expect(await slugExists(harness.sql, 'neon-alley-dolly', item.id)).toBe(false);
    expect(await slugExists(harness.sql, 'brand-new-slug')).toBe(false);
  });
});

describe('prompt state transitions (§13.1 moderation)', () => {
  let harness: PromptHarness;

  beforeAll(async () => {
    harness = await promptHarness();
  });
  afterAll(async () => harness.close());

  it('approves a pending row and stamps its publication instant', async () => {
    const before = (await loadPromptBySlug(harness.sql, 'pending-underwater-drift'))!;
    expect(before.publishedAt).toBeNull();

    const moved = await approvePrompt(harness.sql, {
      id: before.id,
      slug: 'underwater-drift',
      authorHandle: 'hana',
      useCase: ['cinematic'],
      featured: true,
    });
    expect(moved).toBe(true);

    const after = (await loadPromptById(harness.sql, before.id))!;
    expect(after.status).toBe('published');
    expect(after.slug).toBe('underwater-drift');
    expect(after.featured).toBe(true);
    expect(after.publishedAt).not.toBeNull();
  });

  it('refuses to approve something that is already published', async () => {
    const live = (await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))!;
    const moved = await approvePrompt(harness.sql, {
      id: live.id,
      slug: live.slug,
      authorHandle: null,
      useCase: live.useCase,
      featured: live.featured,
    });
    expect(moved).toBe(false);
  });

  it('refuses to reject anything that is not pending', async () => {
    const live = (await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))!;
    expect(await rejectPrompt(harness.sql, live.id, 'nope')).toBe(false);
  });

  it('archives and restores without ever deleting the row or freeing the slug', async () => {
    const live = (await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))!;

    expect(await setPromptArchived(harness.sql, live.id, true)).toBe(true);
    const archived = (await loadPromptById(harness.sql, live.id))!;
    expect(archived.status).toBe('archived');
    expect(archived.publishedAt).not.toBeNull();
    expect(await slugExists(harness.sql, 'neon-alley-dolly')).toBe(true);
    expect((await loadPublishedPrompts(harness.sql)).map((r) => r.slug)).not.toContain(
      'neon-alley-dolly',
    );

    expect(await setPromptArchived(harness.sql, live.id, false)).toBe(true);
    expect((await loadPromptById(harness.sql, live.id))!.status).toBe('published');
  });

  it('toggles featured', async () => {
    const live = (await loadPromptBySlug(harness.sql, 'kitchen-tutorial-overhead'))!;
    expect(live.featured).toBe(false);
    expect(await setPromptFeatured(harness.sql, live.id, true)).toBe(true);
    expect((await loadPromptById(harness.sql, live.id))!.featured).toBe(true);
  });
});
