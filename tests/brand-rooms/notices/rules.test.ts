import { describe, expect, it } from 'vitest';
import { ROOM_EVENT_KINDS } from '@/lib/brand-rooms/events';
import { messageNoticeKind, noticeExcerpt, ROOM_EVENT_NOTICES, ROOM_NOTICE_KINDS, ROOM_NOTICE_LIMITS, ROOM_NOTICE_RULES } from '@/lib/brand-rooms/notices';
import { readMigration } from '@/lib/db/migrations';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.1 — the rule table as data: which room happening becomes which notice,
 * when its mail goes, whether it pushes, and whose action it has to be.
 */
describe('room notice rules (§2.1)', () => {
  it('maps every kind to the proposed mail timing, push and actor', () => {
    expect(ROOM_NOTICE_RULES).toEqual({
      new_version: { email: 'now', push: true, actor: 'studio' },
      storyboard: { email: 'now', push: true, actor: 'studio' },
      team_message: { email: 'bundle', push: true, actor: 'studio' },
      team_reply: { email: 'bundle', push: true, actor: 'studio' },
      mention: { email: 'now', push: true, actor: 'any' },
      intake_received: { email: 'now', push: false, actor: 'brand' },
    });
    expect(Object.keys(ROOM_NOTICE_RULES).sort()).toEqual([...ROOM_NOTICE_KINDS].sort());
  });

  it('turns only the team’s drafts, storyboards and replies into notices; approvals and change requests notify nobody', () => {
    expect(ROOM_EVENT_NOTICES).toEqual({
      review_posted: 'new_version',
      review_version: 'new_version',
      storyboard_shared: 'storyboard',
      storyboard_version: 'storyboard',
      review_commented: 'team_reply',
    });
    for (const event of ['storyboard_approved', 'storyboard_changes_requested', 'review_approved', 'review_changes_requested'] as const) {
      expect(ROOM_EVENT_NOTICES[event], event).toBeUndefined();
    }
    for (const event of Object.keys(ROOM_EVENT_NOTICES)) expect(ROOM_EVENT_KINDS).toContain(event);
  });

  it('gives a named person one mention instead of the team line, and a colleague’s plain line to nobody', () => {
    expect(messageNoticeKind('studio', false)).toBe('team_message');
    expect(messageNoticeKind('studio', true)).toBe('mention');
    expect(messageNoticeKind('brand', true)).toBe('mention');
    expect(messageNoticeKind('brand', false)).toBeNull();
  });

  it('keeps the proposed timings in one place: 10 minutes, one bundle per 30 minutes, 3 attempts, 5 lines, 120 characters', () => {
    expect(ROOM_NOTICE_LIMITS).toMatchObject({ bundleDelayMinutes: 10, bundleCapMinutes: 30, maxAttempts: 3, maxLines: 5, excerptChars: 120 });
    const long = `${'가'.repeat(119)}나다라`;
    expect(noticeExcerpt(long)).toBe(`${'가'.repeat(119)}나…`);
    expect(noticeExcerpt('  two\n\nlines  ')).toBe('two lines');
    expect(noticeExcerpt(null)).toBe('');
  });

  it('spells the same kinds in the table constraint (0094)', () => {
    const core = readMigration('0094_core_brand_room_notices.sql');
    for (const kind of ROOM_NOTICE_KINDS) expect(core).toContain(`'${kind}'`);
    const glue = readMigration('0167_glue_brand_room_notices.sql');
    for (const table of ['brand_room_notice_prefs', 'brand_room_notices']) expect(glue).toContain(`'${table}'`);
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});
