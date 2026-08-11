import { describe, expect, it } from 'vitest';
import { badgeFor, BADGE_WINDOW_DAYS } from '@/lib/content/badges';

/**
 * PLAN §3.5 — "In-app: NEW/UPDATED badges for everyone."
 *
 * A truth table rather than a handful of examples: two independent windows with an explicit
 * precedence between them is exactly the shape that rots quietly, and there are only nine cases.
 */

const NOW = Date.parse('2026-08-12T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('NEW / UPDATED badges (§3.5)', () => {
  it('uses the fortnight §3.5 asks for', () => {
    expect(BADGE_WINDOW_DAYS).toBe(14);
  });

  const cases: Array<{
    name: string;
    firstPublishedAt: string | null;
    updatedAt: string | null;
    expected: 'new' | 'updated' | null;
  }> = [
    { name: 'debuted today', firstPublishedAt: ago(0), updatedAt: null, expected: 'new' },
    { name: 'debuted 13 days ago', firstPublishedAt: ago(13), updatedAt: null, expected: 'new' },
    { name: 'debuted 15 days ago', firstPublishedAt: ago(15), updatedAt: null, expected: null },
    {
      name: 'old playbook rewritten yesterday',
      firstPublishedAt: ago(300),
      updatedAt: ago(1),
      expected: 'updated',
    },
    {
      name: 'old playbook rewritten 15 days ago',
      firstPublishedAt: ago(300),
      updatedAt: ago(15),
      expected: null,
    },
    {
      // Both windows open: to a reader who has never seen it, it is new — not "updated".
      name: 'debuted 3 days ago and already corrected',
      firstPublishedAt: ago(3),
      updatedAt: ago(1),
      expected: 'new',
    },
    {
      name: 'debuted 20 days ago, corrected 20 days ago',
      firstPublishedAt: ago(20),
      updatedAt: ago(20),
      expected: null,
    },
    { name: 'never published', firstPublishedAt: null, updatedAt: null, expected: null },
    {
      name: 'no debut recorded but a recent rewrite',
      firstPublishedAt: null,
      updatedAt: ago(2),
      expected: 'updated',
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.expected ?? 'no badge'}`, () => {
      expect(
        badgeFor({
          firstPublishedAt: testCase.firstPublishedAt,
          updatedAt: testCase.updatedAt,
          now: NOW,
        }),
      ).toBe(testCase.expected);
    });
  }

  it('treats the boundary as exclusive at exactly the window edge', () => {
    expect(badgeFor({ firstPublishedAt: ago(14), updatedAt: null, now: NOW })).toBeNull();
    expect(
      badgeFor({ firstPublishedAt: new Date(NOW - 14 * DAY + 1000).toISOString(), updatedAt: null, now: NOW }),
    ).toBe('new');
  });

  it('does not lose a badge to clock skew between the app and the database', () => {
    const future = new Date(NOW + 5 * 60 * 1000).toISOString();
    expect(badgeFor({ firstPublishedAt: future, updatedAt: null, now: NOW })).toBe('new');
  });

  it('ignores an unparseable timestamp rather than rendering a badge for NaN', () => {
    expect(badgeFor({ firstPublishedAt: 'not-a-date', updatedAt: null, now: NOW })).toBeNull();
  });
});
