import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { DeletionFacts, DeletionPendingNotice, DeletionRequestStatus, deletionFlash } from '@/components/account/deletion';
import { AccountDeletionQueue } from '@/components/admin/account-deletion-queue';
import { NOTHING_PENDING, type DeletionQueueItem } from '@/lib/account/deletion';
import { buildSitemap, DISALLOWED_PATHS } from '@/lib/seo/sitemap';
import { ACCOUNT_DELETION_REST, ACCOUNT_DELETE_PATH, accountDeletionHref } from '@/lib/account/links';

/**
 * docs/APP-STORE-LAUNCH.md §3.2 — what the member and the operator are shown. The wording comes
 * from the dictionaries; these tests pin the states, not the sentences.
 */
const ko = getDictionary('ko');
const en = getDictionary('en');
const cancel = async () => {};

describe('the confirmation step', () => {
  it('lists what goes and what stays in both locales', () => {
    for (const dict of [ko, en]) {
      const html = renderToStaticMarkup(<DeletionFacts copy={dict.accountDeletion} />);
      expect(html).toContain('data-deletion-facts');
      for (const line of [...dict.accountDeletion.deleted, ...dict.accountDeletion.kept]) expect(html).toContain(line.replaceAll('"', '&quot;'));
    }
  });

  it('says nothing when nothing is moving, and names each thing that is', () => {
    expect(renderToStaticMarkup(<DeletionPendingNotice copy={ko.accountDeletion} pending={NOTHING_PENDING} />)).toBe('');
    const html = renderToStaticMarkup(<DeletionPendingNotice copy={ko.accountDeletion} pending={{ renders: 2, payments: 0, subscription: true, campaigns: 1 }} />);
    expect(html).toContain('data-deletion-pending="3"');
    expect(html).toContain('결과물 2편');
    expect(html).toContain('캠페인 1건');
    expect(html).not.toContain('결제 0건');
  });

  it('offers the cancel button only before an operator starts', () => {
    const request = { id: 'r', status: 'requested' as const, requestedAt: '2026-10-27T03:00:00.000Z', dueAt: '2026-11-03T03:00:00.000Z', startedAt: null };
    const open = renderToStaticMarkup(<DeletionRequestStatus copy={ko.accountDeletion} locale="ko" request={request} cancel={cancel} />);
    expect(open).toContain('data-deletion-request="requested"');
    expect(open).toContain('data-deletion-cancel');
    expect(open).toContain('2026');
    const started = renderToStaticMarkup(<DeletionRequestStatus copy={ko.accountDeletion} locale="ko" request={{ ...request, status: 'processing', startedAt: request.requestedAt }} cancel={cancel} />);
    expect(started).not.toContain('data-deletion-cancel');
  });

  it('turns the redirect codes into a line, and ignores anything else', () => {
    expect(deletionFlash(ko.accountDeletion, 'cancelled')?.tone).toBe('ok');
    expect(deletionFlash(ko.accountDeletion, 'unavailable')?.text).toContain('hello@yagiworkshop.xyz');
    expect(deletionFlash(ko.accountDeletion, 'requested')).toBeNull();
    expect(deletionFlash(ko.accountDeletion, ['cancelled'])).toBeNull();
  });
});

describe('the admin queue', () => {
  const item = (over: Partial<DeletionQueueItem> = {}): DeletionQueueItem => ({
    id: '11111111-1111-4111-8111-111111111111', status: 'requested', requestedAt: '2026-10-20T03:00:00.000Z', dueAt: '2026-10-27T03:00:00.000Z',
    startedAt: null, userId: 'a0000000-0000-4000-8000-00000000b001', email: 'me@twings.test', accountExists: true, staff: false,
    completedAt: null, cancelledAt: null, note: null, ...over,
  });
  const now = new Date('2026-10-28T00:00:00Z');

  it('says the table is missing before 0064', () => {
    expect(renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={null} now={now} />)).toContain(ko.accountDeletion.admin.unavailable);
  });

  it('marks overdue requests, keeps "done" shut while the account exists and flags staff', () => {
    const html = renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={{ open: [item({ staff: true })], closed: [] }} now={now} />);
    expect(html).toContain('data-overdue="true"');
    expect(html).toContain('data-deletion-staff');
    expect(html).toContain('value="account.deletion.start"');
    expect(html).toMatch(/value="account\.deletion\.complete"[\s\S]*?<button[^>]*disabled=""/);
    expect(html).toContain('value="account.deletion.cancel"');
  });

  it('lets an operator mark it done once the account is gone, and shows closed rows without forms', () => {
    const open = renderToStaticMarkup(<AccountDeletionQueue copy={en.accountDeletion.admin} locale="en" queue={{ open: [item({ status: 'processing', accountExists: false, userId: null })], closed: [item({ id: '22222222-2222-4222-8222-222222222222', status: 'completed', email: null, accountExists: false, userId: null })] }} now={new Date('2026-10-21T00:00:00Z')} />);
    expect(open).not.toContain('data-overdue');
    expect(open).not.toContain('value="account.deletion.start"');
    expect(open).not.toMatch(/value="account\.deletion\.complete"[\s\S]*?<button[^>]*disabled=""/);
    expect(open).toContain(en.accountDeletion.admin.accountGone);
    expect(open).toContain(en.accountDeletion.admin.noEmail);
    expect(open.match(/value="account\.deletion\.complete"/g)).toHaveLength(1);
  });
});

describe('the public page address', () => {
  it('is listed in both locales and never collides with the private /account prefix', () => {
    const urls = buildSitemap({ origin: 'https://twings.app', cards: [] }).map((entry) => entry.url);
    expect(urls).toContain(`https://twings.app${accountDeletionHref('ko')}`);
    expect(urls).toContain(`https://twings.app${accountDeletionHref('en')}`);
    for (const path of DISALLOWED_PATHS) expect(ACCOUNT_DELETION_REST.startsWith(path.replace('$', '')), path).toBe(false);
    expect(ACCOUNT_DELETE_PATH.startsWith('/account/')).toBe(true);
  });
});
