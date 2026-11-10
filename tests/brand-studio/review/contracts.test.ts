import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommentAddSchema,
  ReviewCreateSchema,
  formatTimecode,
  nextStatuses,
  parseReviewTime,
  reviewHref,
  spotVisibleAt,
  threadComments,
  type ReviewComment,
} from '@/lib/brand-studio/review-contracts';
import { sendToReview } from '@/components/brand-studio/review/send';

/** docs/BRAND-STUDIO-V3.md §7 — the pure half of the review contract, and the gallery's seam. */
const ORG = 'a0000000-0000-4000-8000-00000000000a';
const ID = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function note(n: number, extra: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: ID(n),
    parentId: null,
    authorName: 'owner',
    authorRole: 'brand',
    body: `note ${n}`,
    atMs: null,
    x: null,
    y: null,
    resolved: false,
    createdAt: new Date(Date.UTC(2026, 10, 11, 0, 0, n)).toISOString(),
    deleted: false,
    mine: false,
    ...extra,
  };
}

describe('timecodes and links', () => {
  it('formats m:ss.t and h:mm:ss', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(1250)).toBe('0:01.2');
    expect(formatTimecode(61_999)).toBe('1:01.9');
    expect(formatTimecode(3_723_000)).toBe('1:02:03');
    expect(formatTimecode(null)).toBe('0:00.0');
  });

  it('builds the scoped link with the moment and reads `t` back defensively', () => {
    expect(reviewHref(ORG)).toBe(`/brand/studio/review?organizationId=${ORG}`);
    expect(reviewHref(ORG, ID(1), 1234.6)).toBe(`/brand/studio/review?organizationId=${ORG}&review=${ID(1)}&t=1235`);
    expect(reviewHref(ORG, ID(1), 0)).toBe(`/brand/studio/review?organizationId=${ORG}&review=${ID(1)}`);
    expect(parseReviewTime('1235')).toBe(1235);
    expect(parseReviewTime(['40', '50'])).toBe(40);
    for (const bad of ['-1', '1e3', '12.5', '', undefined, '999999999']) expect(parseReviewTime(bad)).toBeNull();
  });
});

describe('threads', () => {
  it('orders moments by time, then whole-piece notes by writing order, with replies under their head', () => {
    const threads = threadComments([
      note(1),
      note(2, { atMs: 5000 }),
      note(3, { atMs: 1000 }),
      note(4, { parentId: ID(2) }),
      note(5, { parentId: ID(2), deleted: true }),
      note(6, { deleted: true }),
      note(7, { deleted: true, atMs: 200 }),
      note(8, { parentId: ID(7) }),
    ]);
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      [ID(7), [ID(8)]],
      [ID(3), []],
      [ID(2), [ID(4)]],
      [ID(1), []],
    ]);
  });

  it('shows spot pins near their moment on a film and always on a still', () => {
    expect(spotVisibleAt({ atMs: 1000, x: 0.5, y: 0.5 }, 1300)).toBe(true);
    expect(spotVisibleAt({ atMs: 1000, x: 0.5, y: 0.5 }, 1500)).toBe(false);
    expect(spotVisibleAt({ atMs: null, x: 0.5, y: 0.5 }, null)).toBe(true);
    expect(spotVisibleAt({ atMs: 1000, x: null, y: null }, 1000)).toBe(false);
  });

  it('offers the status moves the screen shows', () => {
    expect(nextStatuses('open')).toEqual(['changes_requested', 'approved']);
    expect(nextStatuses('changes_requested')).toEqual(['approved', 'open']);
    expect(nextStatuses('approved')).toEqual(['open']);
  });
});

describe('input schemas', () => {
  it('needs exactly one subject and a title within 120 characters', () => {
    expect(ReviewCreateSchema.safeParse({ organizationId: ORG, title: 'x', outputId: ID(1) }).success).toBe(true);
    expect(ReviewCreateSchema.safeParse({ organizationId: ORG, title: 'x' }).success).toBe(false);
    expect(ReviewCreateSchema.safeParse({ organizationId: ORG, title: 'x', outputId: ID(1), assetId: ID(2) }).success).toBe(false);
    expect(ReviewCreateSchema.safeParse({ organizationId: ORG, title: 'x'.repeat(121), outputId: ID(1) }).success).toBe(false);
  });

  it('keeps spots whole and replies without a moment', () => {
    const base = { organizationId: ORG, reviewId: ID(1), body: 'hi' };
    expect(CommentAddSchema.safeParse({ ...base, atMs: 10, x: 0, y: 1 }).success).toBe(true);
    expect(CommentAddSchema.safeParse({ ...base, x: 0.2 }).success).toBe(false);
    expect(CommentAddSchema.safeParse({ ...base, atMs: -1 }).success).toBe(false);
    expect(CommentAddSchema.safeParse({ ...base, atMs: 1.5 }).success).toBe(false);
    expect(CommentAddSchema.safeParse({ ...base, parentId: ID(2), atMs: 5 }).success).toBe(false);
    expect(CommentAddSchema.safeParse({ ...base, parentId: ID(2) }).success).toBe(true);
  });
});

describe('sendToReview (the gallery seam)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the review and answers the scoped screen address', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, existing: false, review: { id: ID(9) } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendToReview({ organizationId: ORG, ref: { outputId: ID(3) }, title: '  A   blue bottle  ' });
    expect(result).toEqual({ ok: true, href: `/brand/studio/review?organizationId=${ORG}&review=${ID(9)}` });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/brand-studio/review');
    expect(JSON.parse(String(init.body))).toEqual({ operation: 'review.create', input: { organizationId: ORG, title: 'A blue bottle', outputId: ID(3) } });
  });

  it('passes refusals through as studio codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'forbidden' }), { status: 403 })));
    expect(await sendToReview({ organizationId: ORG, ref: { assetId: ID(3) }, title: 'x' })).toEqual({ ok: false, code: 'forbidden' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 429 })));
    expect(await sendToReview({ organizationId: ORG, ref: { assetId: ID(3) }, title: 'x' })).toEqual({ ok: false, code: 'failed' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await sendToReview({ organizationId: ORG, ref: { assetId: ID(3) }, title: 'x' })).toEqual({ ok: false, code: 'failed' });
    expect(await sendToReview({ organizationId: ORG, ref: { assetId: ID(3) }, title: '   ' })).toEqual({ ok: false, code: 'invalid' });
  });
});
