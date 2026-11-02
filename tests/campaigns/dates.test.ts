import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { adminHarness, expectOk, ADMIN_VIEWER, type AdminHarness } from '@/tests/helpers/admin';
import { runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { loadCampaignBySlug } from '@/lib/campaigns/repo';
import { acceptsApplications } from '@/lib/campaigns/state';
import { formatCampaignDateTime, parseKstDateTimeLocal, toKstDateTimeLocal } from '@/lib/campaigns/dates';
import { parseDateTimeLocal } from '@/lib/contests/schemas';
import { CampaignFields } from '@/components/admin/campaign-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * P1-1 (2026-09-23): the campaign form says "한국 시간", so what the admin types is Korea
 * wall-clock. 18:00 typed → 09:00Z stored → 18:00 shown again in the editor and in the copy.
 */

const FORM = {
  slug: 'tz-check', titleEn: 'T', titleKo: 'T', summaryEn: 'S', summaryKo: 'S', hostName: 'X', hostKind: 'brand',
  platforms: ['instagram'], deliverable: 'reel', slots: '1',
  applicationsCloseAt: '2026-10-01T18:00', postDeadlineAt: '2026-10-05T18:00',
  payoutModel: 'flat', payoutFlat: '10000', holdDays: '7',
};

describe('campaign dates are Korea time', () => {
  let h: AdminHarness;
  beforeEach(async () => {
    h = await adminHarness();
    await seedProfile(runner(h.db), { id: ADMIN_VIEWER.userId!, email: ADMIN_VIEWER.email!, isAdmin: true });
  });
  afterEach(async () => h.close());

  it('campaign.create stores the typed KST wall-clock as the matching instant', async () => {
    expect(getDictionary('ko').admin.campaignDatesHint).toContain('한국 시간');
    expectOk(await h.run('campaign.create', FORM));
    const row = await loadCampaignBySlug(runner(h.db), 'tz-check');
    expect(row?.applicationsCloseAt).toBe('2026-10-01T09:00:00.000Z');
    expect(row?.postDeadlineAt).toBe('2026-10-05T09:00:00.000Z');
  });

  it('the editor re-renders the stored instant as the same KST wall-clock, and a re-save keeps it', async () => {
    expectOk(await h.run('campaign.create', FORM));
    const row = (await loadCampaignBySlug(runner(h.db), 'tz-check'))!;
    const html = renderToStaticMarkup(createElement(CampaignFields, { row, dict: getDictionary('ko'), styleSlugs: [] }));
    expect(html).toContain('name="applicationsCloseAt" value="2026-10-01T18:00"');
    expect(html).toContain('name="postDeadlineAt" value="2026-10-05T18:00"');
    // Saving the untouched editor must not move the deadline (the invisible shift the audit found).
    expectOk(await h.run('campaign.update', { ...FORM, id: row.id, applicationsCloseAt: toKstDateTimeLocal(row.applicationsCloseAt) }));
    expect((await loadCampaignBySlug(runner(h.db), 'tz-check'))?.applicationsCloseAt).toBe('2026-10-01T09:00:00.000Z');
  });

  it('the apply gate closes at the KST instant, not nine hours later', async () => {
    expectOk(await h.run('campaign.create', FORM));
    const row = (await loadCampaignBySlug(runner(h.db), 'tz-check'))!;
    const recruiting = { ...row, status: 'recruiting' as const };
    expect(acceptsApplications(recruiting, Date.parse('2026-10-01T17:59:00+09:00'))).toBe(true);
    expect(acceptsApplications(recruiting, Date.parse('2026-10-01T18:00:00+09:00'))).toBe(false);
    expect(acceptsApplications(recruiting, Date.parse('2026-10-02T02:00:00+09:00'))).toBe(false);
  });
});

describe('KST helpers', () => {
  it('parse and format in both directions, refusing impossible dates', () => {
    expect(parseKstDateTimeLocal('2026-10-01T00:30')).toBe('2026-09-30T15:30:00.000Z');
    expect(parseKstDateTimeLocal('')).toBeNull();
    expect(parseKstDateTimeLocal('2026-02-31T10:00')).toBeNull();
    expect(parseKstDateTimeLocal('2026-10-01T09:00:00.000Z')).toBe('2026-10-01T09:00:00.000Z');
    expect(toKstDateTimeLocal('2026-09-30T15:30:00.000Z')).toBe('2026-10-01T00:30');
    expect(toKstDateTimeLocal(null)).toBe('');
  });

  it('shows a deadline as Korea date and time in both languages', () => {
    expect(formatCampaignDateTime('2026-10-01T09:00:00.000Z', 'ko')).toBe('2026년 10월 1일 오후 6:00');
    expect(formatCampaignDateTime('2026-10-01T09:00:00.000Z', 'en')).toBe('Oct 1, 2026, 6:00 PM KST');
    // 00:30 KST is still the 1st in Korea even though it is the 30th in UTC.
    expect(formatCampaignDateTime('2026-09-30T15:30:00.000Z', 'ko')).toContain('10월 1일');
    expect(formatCampaignDateTime(null, 'ko')).toBeNull();
  });

  it('leaves the retired contest helper reading UTC', () => {
    expect(parseDateTimeLocal('2026-10-01T18:00')).toBe('2026-10-01T18:00:00.000Z');
  });
});
