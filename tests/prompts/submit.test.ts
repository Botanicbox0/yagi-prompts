import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { countRecentSubmissions, loadPromptBySlug, loadSubmissionsByAuthor } from '@/lib/prompts/repo';
import { isRateLimited, submitPrompt, uniqueSlug } from '@/lib/prompts/submit';
import { RATE_WINDOW_HOURS, SUBMISSIONS_PER_DAY } from '@/lib/prompts/schemas';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { emptyPromptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §13.1/E — community submission.
 *
 * Every assertion here is about something the SERVER decides and the form cannot: who the author
 * is, what status the row is born in, whether the text is public, and whether there is any quota
 * left. A submission form that could set any of those would not be a submission form.
 */

const submitter: Viewer = {
  tier: 'free',
  userId: FIXTURE_USERS.free.id,
  email: 'free@playbook.test',
  isAdmin: false,
  locale: 'en',
};

const anon: Viewer = { tier: 'anon', userId: null, email: null, isAdmin: false, locale: null };

const input = (overrides: Partial<Parameters<typeof submitPrompt>[2]> = {}) => ({
  title: 'Underwater drift',
  promptText: 'Slow drift past a kelp forest with god rays overhead, neutral buoyancy.',
  useCase: ['cinematic'],
  handle: '@hana',
  consent: true,
  video: null,
  poster: null,
  ...overrides,
});

describe('rate limit (§13.1 — 3/day/user)', () => {
  it('lets the first three through and refuses the fourth', () => {
    expect(SUBMISSIONS_PER_DAY).toBe(3);
    expect(RATE_WINDOW_HOURS).toBe(24);
    expect([0, 1, 2].map((n) => isRateLimited(n))).toEqual([false, false, false]);
    expect([3, 4, 99].map((n) => isRateLimited(n))).toEqual([true, true, true]);
  });
});

describe('submitPrompt (§13.1/E)', () => {
  let harness: PromptHarness;
  const deps = () => ({ sql: harness.sql, storage: harness.storage });

  beforeEach(async () => {
    harness = await emptyPromptHarness();
  });
  afterEach(async () => harness.close());

  it('creates a PENDING, community, public-text row owned by the session user', async () => {
    const result = await submitPrompt(deps(), submitter, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = (await loadPromptBySlug(harness.sql, result.slug))!;
    expect(row.status).toBe('pending');
    expect(row.source).toBe('community');
    expect(row.textVisibility).toBe('public');
    expect(row.authorId).toBe(FIXTURE_USERS.free.id);
    expect(row.authorHandle).toBe('hana');
    expect(row.publishedAt).toBeNull();
    expect(row.featured).toBe(false);
  });

  it('refuses an anonymous submission before it validates anything', async () => {
    const result = await submitPrompt(deps(), anon, input());
    expect(result).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await loadSubmissionsByAuthor(harness.sql, FIXTURE_USERS.free.id)).toHaveLength(0);
  });

  it('refuses an unconsented submission and writes nothing', async () => {
    const result = await submitPrompt(deps(), submitter, input({ consent: false }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('invalid');
    expect(await countRecentSubmissions(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS)).toBe(0);
  });

  it('refuses over-long text at the server boundary', async () => {
    const result = await submitPrompt(deps(), submitter, input({ promptText: 'x'.repeat(2001) }));
    expect(result.ok === false && result.code).toBe('invalid');
  });

  it('refuses the FOURTH submission inside the window', async () => {
    for (let n = 0; n < SUBMISSIONS_PER_DAY; n += 1) {
      const result = await submitPrompt(deps(), submitter, input({ title: `Shot number ${n}` }));
      expect(result.ok, `submission ${n}`).toBe(true);
    }
    const fourth = await submitPrompt(deps(), submitter, input({ title: 'One too many' }));
    expect(fourth.ok).toBe(false);
    expect(fourth.ok === false && fourth.code).toBe('rate_limited');
    expect(await countRecentSubmissions(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS)).toBe(
      SUBMISSIONS_PER_DAY,
    );
  });

  it('refuses an oversized upload and leaves no half-made row behind', async () => {
    const huge = new File([new Uint8Array(33 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    const result = await submitPrompt(deps(), submitter, input({ video: huge }));
    expect(result).toEqual({ ok: false, code: 'upload', detail: 'too_large' });
    expect(await countRecentSubmissions(harness.sql, FIXTURE_USERS.free.id, RATE_WINDOW_HOURS)).toBe(0);
  });

  it('stages an accepted clip privately — never into the public bucket', async () => {
    const clip = new File([new TextEncoder().encode('webm placeholder')], 'clip.webm', {
      type: 'video/webm',
    });
    const result = await submitPrompt(deps(), submitter, input({ video: clip }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = (await loadPromptBySlug(harness.sql, result.slug))!;
    const media = row.media as { video?: { staging_key: string; published_key?: string } };
    expect(media.video?.staging_key).toMatch(/^content\/prompt\//);
    expect(media.video?.published_key).toBeUndefined();
    expect(await harness.storage.exists('content', media.video!.staging_key)).toBe(true);
  });

  it('derives a slug from the title and disambiguates a collision', async () => {
    const first = await submitPrompt(deps(), submitter, input({ title: 'Underwater drift' }));
    expect(first.ok && first.slug).toBe('underwater-drift');

    const second = await submitPrompt(deps(), submitter, input({ title: 'Underwater drift' }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.slug).not.toBe('underwater-drift');
    expect(second.slug.startsWith('underwater-drift-')).toBe(true);
  });

  it('falls back to an id-based slug for a title that transliterates to nothing', async () => {
    const slug = await uniqueSlug(harness.sql, '수중 드리프트', 'abcdef01-2345-6789-abcd-ef0123456789');
    expect(slug).toBe('prompt-abcdef01');
  });
});
