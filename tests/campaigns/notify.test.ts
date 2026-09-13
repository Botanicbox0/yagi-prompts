import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_VIEWER, adminHarness, expectOk, type AdminHarness } from '@/tests/helpers/admin';
import { runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { loadApplication, loadApplicationById, loadCampaignBySlug, submitPost, upsertApplication } from '@/lib/campaigns/repo';
import { savePreferences } from '@/lib/notify/preferences';
import { verifyUnsubscribeToken } from '@/lib/notify/unsubscribe';

/**
 * Campaign mail (2026-09-13), end to end through the dispatcher and the harness's fake mailer:
 * opening recruitment mails exactly the people with the campaign switch on, in their language,
 * with a one-click unsubscribe signed for them; each moderation step mails the one creator it
 * concerns, once per transition. Nothing is sent on the request path — the harness records the
 * deferred tasks and the test flushes them.
 */

const CREATOR = 'f0000000-0000-4000-8000-000000000001';
const SUBSCRIBER_KO = 'f0000000-0000-4000-8000-000000000201';
const SUBSCRIBER_EN = 'f0000000-0000-4000-8000-000000000202';
const BYSTANDER = 'f0000000-0000-4000-8000-000000000203';

const FORM = {
  slug: 'seoul-94-reel',
  titleEn: 'Seoul 94',
  titleKo: '서울 94',
  summaryEn: 'Be the interviewee in a 1994 news segment.',
  summaryKo: '1994년 뉴스 인터뷰의 주인공이 되어보세요.',
  hostName: 'A GLOBAL AI PLATFORM',
  hostKind: 'brand',
  styleSlug: '90s-seoul-interview',
  platforms: ['instagram'],
  deliverable: 'reel',
  slots: '2',
  applicationsCloseAt: '2026-09-20T00:00',
  postDeadlineAt: '2026-10-01T00:00',
  payoutModel: 'flat',
  payoutFlat: '20000',
  holdDays: '7',
  hashtags: '#광고',
  mentions: '@twings.app',
  disclosure: 'on',
};

describe('campaign mail', () => {
  let h: AdminHarness;
  beforeEach(async () => {
    h = await adminHarness();
    const sql = runner(h.db);
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, email: ADMIN_VIEWER.email!, isAdmin: true });
    await seedProfile(sql, { id: CREATOR, email: 'creator@playbook.test', locale: 'ko' });
    await seedProfile(sql, { id: SUBSCRIBER_KO, email: 'ko@playbook.test', locale: 'ko' });
    await seedProfile(sql, { id: SUBSCRIBER_EN, email: 'en@playbook.test', locale: 'en' });
    await seedProfile(sql, { id: BYSTANDER, email: 'quiet@playbook.test', locale: 'ko' });
    // Two people want campaign alerts; the bystander wants only new templates; the creator wants nothing.
    await savePreferences(sql, SUBSCRIBER_KO, { newPlaybook: false, updates: true });
    await savePreferences(sql, SUBSCRIBER_EN, { newPlaybook: true, updates: true });
    await savePreferences(sql, BYSTANDER, { newPlaybook: true, updates: false });
  });
  afterEach(async () => {
    await h.close();
  });

  it('mails every campaign subscriber once when recruiting opens — in their language, with their own unsubscribe link', async () => {
    const sql = runner(h.db);
    expectOk(await h.run('campaign.create', FORM));
    const campaign = (await loadCampaignBySlug(sql, FORM.slug))!;
    expect(h.mailer.sent).toHaveLength(0);

    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'recruiting' }));
    expect(h.deferred).toHaveLength(1);
    await h.flush();

    const to = h.mailer.sent.map((m) => m.to).sort();
    expect(to).toEqual(['en@playbook.test', 'ko@playbook.test']);
    const ko = h.mailer.sent.find((m) => m.to === 'ko@playbook.test')!;
    const en = h.mailer.sent.find((m) => m.to === 'en@playbook.test')!;
    expect(ko.subject).toContain('서울 94');
    expect(ko.text).toContain('20,000원');
    expect(ko.text).toContain('https://twings.test/ko/campaigns/seoul-94-reel');
    expect(en.subject).toContain('Seoul 94');
    expect(en.text).toContain('https://twings.test/en/campaigns/seoul-94-reel');
    // The unsubscribe link is signed for THAT person and flips the campaign switch, not the other one.
    const token = new URL(ko.unsubscribeUrl).searchParams.get('t')!;
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: true, claims: { userId: SUBSCRIBER_KO, toggle: 'notif_updates' } });
    expect(h.mailer.idempotencyKeys().sort()).toEqual([`campaign:${campaign.id}:recruiting:${SUBSCRIBER_KO}`, `campaign:${campaign.id}:recruiting:${SUBSCRIBER_EN}`].sort());

    // Draft and back again: the same keys, so the provider collapses a second run.
    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'draft' }));
    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'recruiting' }));
    await h.flush();
    expect(h.mailer.duplicateKeys().length).toBe(2);
  });

  it('mails the one creator on select, verify, reject and pay — once per transition, never on the request path', async () => {
    const sql = runner(h.db);
    expectOk(await h.run('campaign.create', FORM));
    const campaign = (await loadCampaignBySlug(sql, FORM.slug))!;
    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'recruiting' }));
    await h.flush();
    h.mailer.reset();

    await upsertApplication(sql, { campaignId: campaign.id, creatorId: CREATOR, pitch: 'I post 90s edits weekly.', snsUrl: 'https://instagram.com/hana', followerCount: 1200 });
    let app = (await loadApplication(sql, campaign.id, CREATOR))!;

    expectOk(await h.run('campaignApplication.select', { id: app.id, version: app.version }));
    expect(h.mailer.sent).toHaveLength(0); // deferred, not sent inline
    await h.flush();
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]?.to).toBe('creator@playbook.test');
    expect(h.mailer.sent[0]?.subject).toContain('선정');
    expect(h.mailer.sent[0]?.text).toContain('https://twings.test/campaigns/mine');
    expect(h.mailer.sent[0]?.text).toContain('#광고');

    app = (await loadApplicationById(sql, app.id))!;
    await submitPost(sql, app.id, { postUrl: 'https://www.instagram.com/reel/abc123/', postPlatform: 'instagram' });
    app = (await loadApplicationById(sql, app.id))!;
    expectOk(await h.run('campaignApplication.reject', { id: app.id, version: app.version, reason: '광고 표기가 없습니다.' }));
    await h.flush();
    expect(h.mailer.sent[1]?.subject).toContain('수정');
    expect(h.mailer.sent[1]?.text).toContain('광고 표기가 없습니다.');

    app = (await loadApplicationById(sql, app.id))!;
    await submitPost(sql, app.id, { postUrl: 'https://www.instagram.com/reel/def456/', postPlatform: 'instagram' });
    app = (await loadApplicationById(sql, app.id))!;
    expectOk(await h.run('campaignApplication.verify', { id: app.id, version: app.version }));
    await h.flush();
    expect(h.mailer.sent[2]?.subject).toContain('검수 통과');

    // End the hold by hand, then pay: the mail names the amount.
    await sql.query(`update campaign_applications set hold_until = now() - interval '1 minute' where id = $1`, [app.id]);
    app = (await loadApplicationById(sql, app.id))!;
    expectOk(await h.run('campaignApplication.pay', { id: app.id, version: app.version, payoutRef: 'T-1' }));
    await h.flush();
    expect(h.mailer.sent[3]?.subject).toContain('정산 완료');
    expect(h.mailer.sent[3]?.text).toContain('20,000원');

    expect(h.mailer.sent).toHaveLength(4);
    expect(h.mailer.duplicateKeys()).toEqual([]);
    // A stale review sends nothing.
    expect(await h.run('campaignApplication.decline', { id: app.id, version: 'stale' })).toMatchObject({ ok: false });
    await h.flush();
    expect(h.mailer.sent).toHaveLength(4);
  });
});
