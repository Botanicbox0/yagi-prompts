import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { DeletionFacts, DeletionHoldNotice, DeletionRequestStatus, deletionDay, deletionFlash } from '@/components/account/deletion';
import { AccountDeletionQueue } from '@/components/admin/account-deletion-queue';
import type { DeletionHold, DeletionQueueItem, DeletionRequest } from '@/lib/account/deletion';
import { buildSitemap, DISALLOWED_PATHS } from '@/lib/seo/sitemap';
import { ACCOUNT_DELETION_REST, ACCOUNT_DELETE_PATH, accountDeletionHref } from '@/lib/account/links';
import { ADMIN_QUEUES, adminNextActions } from '@/lib/admin/queues';
import { ADMIN_NAV_GROUPS, ADMIN_NAV_PATHS } from '@/lib/admin/workflow';

/**
 * docs/RUNBOOK-deletion.md — what the member and the operator are shown. The wording comes from the
 * dictionaries; these tests pin the states, not the sentences.
 */
const ko = getDictionary('ko');
const en = getDictionary('en');
const cancel = async () => {};
const ALL_HOLDS: DeletionHold[] = ['render', 'payment', 'staff', 'campaign', 'brand', 'creative', 'subscription', 'records'];

describe('the confirmation step', () => {
  it('lists what goes and what stays in both locales, payments among what stays', () => {
    for (const dict of [ko, en]) {
      const html = renderToStaticMarkup(<DeletionFacts copy={dict.accountDeletion} />);
      expect(html).toContain('data-deletion-facts');
      for (const line of [...dict.accountDeletion.deleted, ...dict.accountDeletion.kept]) expect(html).toContain(line.replaceAll('"', '&quot;'));
      expect(dict.accountDeletion.deleted).toHaveLength(4);
      expect(dict.accountDeletion.kept.join(' ')).toMatch(/5/);
    }
    expect(ko.accountDeletion.kept[0]).toContain('결제');
    expect(en.accountDeletion.kept[0]).toMatch(/payment/i);
  });

  it('has a sentence for every hold in both locales, for the member and for the operator', () => {
    for (const dict of [ko, en]) {
      for (const code of ALL_HOLDS) {
        expect(dict.accountDeletion.holds[code], code).toBeTruthy();
        expect(dict.accountDeletion.admin.holds[code], code).toBeTruthy();
      }
    }
  });

  it('says nothing when nothing holds the account, and names each thing that does', () => {
    expect(renderToStaticMarkup(<DeletionHoldNotice copy={ko.accountDeletion} hold={[]} />)).toBe('');
    const html = renderToStaticMarkup(<DeletionHoldNotice copy={ko.accountDeletion} hold={['render', 'brand']} />);
    expect(html).toContain('data-deletion-hold="render brand"');
    expect(html).toContain(ko.accountDeletion.holds.render);
    expect(html).toContain(ko.accountDeletion.holds.brand);
    expect(html).not.toContain(ko.accountDeletion.holds.payment);
    expect(html).toContain(ko.accountDeletion.holdNote);
  });

  it('shows the day the account goes and a cancel button; a held request lists why instead of a date', () => {
    const request: DeletionRequest = { id: 'r', status: 'requested', requestedAt: '2026-11-11T03:00:00.000Z', scheduledFor: '2026-11-14T03:00:00.000Z', dueAt: '2026-11-18T03:00:00.000Z', hold: [] };
    const open = renderToStaticMarkup(<DeletionRequestStatus copy={ko.accountDeletion} locale="ko" request={request} cancel={cancel} />);
    expect(open).toContain('data-deletion-request="requested"');
    expect(open).toContain('data-deletion-scheduled="2026-11-14"');
    expect(open).toContain('2026년 11월 14일');
    // Korean time, not UTC: a request made at 02:00 KST is still "the 14th" three days later.
    expect(deletionDay('2026-11-13T17:00:00.000Z', 'ko')).toEqual({ label: '2026년 11월 14일', ymd: '2026-11-14' });
    expect(deletionDay('2026-11-13T17:00:00.000Z', 'en').label).toBe('Nov 14, 2026');
    expect(open).toContain('data-deletion-cancel');
    expect(open).not.toContain('data-deletion-hold');
    const held = renderToStaticMarkup(<DeletionRequestStatus copy={en.accountDeletion} locale="en" request={{ ...request, hold: ['payment'] }} cancel={cancel} />);
    expect(held).toContain(en.accountDeletion.requestedHeldBody);
    expect(held).toContain('data-deletion-hold="payment"');
    expect(held).toContain('data-deletion-cancel');
  });

  it('never promises more than the privacy policy: the grace period is a placeholder, 7 days is the limit', () => {
    for (const dict of [ko, en]) {
      const copy = dict.accountDeletion;
      for (const line of [copy.lede, copy.confirmLabel, copy.publicDefinition, copy.timeBody]) expect(line).toContain('{days}');
      expect(copy.requestedBody).toContain('{date}');
      expect(`${copy.publicDefinition} ${copy.timeBody}`).toContain('7');
      expect(dict.account.deletionBody).toContain('{days}');
    }
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
    id: '11111111-1111-4111-8111-111111111111', status: 'requested', requestedAt: '2026-11-01T03:00:00.000Z', scheduledFor: '2026-11-04T03:00:00.000Z', dueAt: '2026-11-08T03:00:00.000Z',
    hold: [], userId: 'a0000000-0000-4000-8000-00000000b001', email: 'me@twings.test', accountExists: true, attempts: 0, lastAttemptAt: null, lastError: null,
    cleanupLeft: 0, removed: null, startedAt: null, completedAt: null, cancelledAt: null, note: null, ...over,
  });
  const now = new Date('2026-11-09T00:00:00Z');

  it('says the table is missing before 0064', () => {
    expect(renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={null} now={now} />)).toContain(ko.accountDeletion.admin.unavailable);
  });

  it('marks an overdue held request, says why, and keeps "done" shut while the account exists', () => {
    const html = renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={{ open: [item({ hold: ['brand'], attempts: 3, lastError: 'tables: brand_memberships' })], closed: [] }} now={now} />);
    expect(html).toContain('data-overdue="true"');
    expect(html).toContain('data-deletion-hold="brand"');
    expect(html).toContain(ko.accountDeletion.admin.holds.brand);
    expect(html).toContain('tables: brand_memberships');
    expect(html).toContain('value="account.deletion.run"');
    expect(html).toMatch(/value="account\.deletion\.complete"[\s\S]*?<button[^>]*disabled=""/);
    expect(html).toContain('value="account.deletion.cancel"');
  });

  it('labels a request quietly waiting out its grace period as exactly that', () => {
    const html = renderToStaticMarkup(<AccountDeletionQueue copy={en.accountDeletion.admin} locale="en" queue={{ open: [item()], closed: [] }} now={new Date('2026-11-02T00:00:00Z')} />);
    expect(html).toContain(en.accountDeletion.admin.waitingGrace);
    expect(html).not.toContain('data-overdue');
    expect(html).toContain(en.accountDeletion.admin.run);
  });

  it('makes the operator type the account before "delete now", and only there', () => {
    const waiting = renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={{ open: [item({ email: 'Mina.QA@example.test' })], closed: [] }} now={new Date('2026-11-02T00:00:00Z')} />);
    const field = waiting.match(/data-deletion-confirm[\s\S]*?<input[^>]*>/)?.[0] ?? '';
    expect(field).toContain('mina.qa@example.test');
    expect(field).toContain('name="confirm"');
    expect(field).toContain('required=""');
    expect(waiting).not.toContain('{phrase}');
    // A cleanup retry deletes no account: nothing to type.
    const retry = renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={{ open: [item({ status: 'processing', accountExists: false, userId: null, cleanupLeft: 1 })], closed: [] }} now={now} />);
    expect(retry).not.toContain('name="confirm"');
  });

  it('shuts "delete now" on an account removed by hand and asks for a note to close it', () => {
    const html = renderToStaticMarkup(<AccountDeletionQueue copy={ko.accountDeletion.admin} locale="ko" queue={{ open: [item({ accountExists: false, userId: null, lastError: 'account removed outside this flow' })], closed: [] }} now={now} />);
    expect(html).toContain(ko.accountDeletion.admin.removedElsewhere);
    expect(html).not.toContain('name="confirm"');
    expect(html).toMatch(/value="account\.deletion\.run"[\s\S]*?<button[^>]*disabled=""/);
    expect(html).toMatch(/value="account\.deletion\.complete"[\s\S]*?<textarea[^>]*required=""/);
  });

  it('offers a cleanup retry once the account is gone, never a cancel, and shows closed rows without forms', () => {
    const html = renderToStaticMarkup(<AccountDeletionQueue copy={en.accountDeletion.admin} locale="en" queue={{
      open: [item({ status: 'processing', accountExists: false, userId: null, cleanupLeft: 2, lastError: 'files: storage refused', removed: { selfies: 1, renders: 4, folders: 6, paymentsKept: 2 } })],
      closed: [item({ id: '22222222-2222-4222-8222-222222222222', status: 'completed', email: null, accountExists: false, userId: null })],
    }} now={new Date('2026-11-05T00:00:00Z')} />);
    expect(html).toContain(en.accountDeletion.admin.retry);
    expect(html).toContain('data-deletion-cleanup-left="2"');
    expect(html).toContain('2 payment records kept');
    expect(html).not.toContain('value="account.deletion.cancel"');
    expect(html).not.toMatch(/value="account\.deletion\.complete"[\s\S]*?<button[^>]*disabled=""/);
    // The note is required when cleanup items are being written off.
    expect(html).toMatch(/<textarea[^>]*required=""/);
    expect(html.match(/value="account\.deletion\.run"/g)).toHaveLength(1);
    expect(html).toContain(en.accountDeletion.admin.accountGone);
  });

  it('is on the admin home and in the menu', () => {
    expect(ADMIN_QUEUES.find((queue) => queue.key === 'accountDeletions')).toMatchObject({ group: 'customers', href: ADMIN_NAV_PATHS.accountDeletions });
    expect(adminNextActions({ accountDeletions: 2, templates: 1 }).map((queue) => queue.key)).toEqual(['accountDeletions', 'templates']);
    expect(adminNextActions({ accountDeletions: 0 })).toEqual([]);
    expect(ADMIN_NAV_GROUPS.find((group) => group.key === 'people')?.items).toContain('accountDeletions');
    for (const dict of [ko, en]) {
      expect(dict.adminWorkflow.tasks.accountDeletions.title).toBeTruthy();
      expect(dict.adminConsole.nav.accountDeletions).toBeTruthy();
      expect(dict.adminConsole.queues.accountDeletions).toBeTruthy();
    }
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
