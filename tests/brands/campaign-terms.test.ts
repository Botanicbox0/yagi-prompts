import { describe, expect, it } from 'vitest';
import {
  CampaignTermsSchema, checkWizardStep, firstIncompleteStep, termsFromDraft, saveWizardDraft, loadWizardDraft,
  clearWizardDraft, wizardDraftKey, briefColumnsFromTerms, campaignPrefillFromTerms, campaignAudienceFor, type WizardDraft,
} from '@/lib/brands/workspace/campaign-terms';

/** docs/PLATFORM-2.0.md §16.3 — the five-step wizard's terms, step by step and as a whole. */
const format = { kind: 'template', slug: 'mirror-dance', source: 'yagi' };
const reward = { model: 'flat', rewardMinKrw: 100_000, rewardMaxKrw: 150_000, perThousandViewsKrw: null, totalBudgetKrw: 1_000_000, taxBasis: 'excluded', slots: 5 };
const audience = { mode: 'criteria', platforms: ['instagram', 'tiktok', 'instagram'], minFollowers: 3000, gender: 'female', regions: ['서울'] };
const schedule = { applicationsCloseOn: '2026-11-10', postDeadlineOn: '2026-11-24', hashtags: ['#twings', 'twings'], mentions: ['@twings.app'], disclosure: true, prohibited: '경쟁사 언급 금지' };
const full: WizardDraft = { version: 1, step: 'review', title: '가을 신제품 캠페인', objective: '신제품 립 컬러를 20대에게 알린다', format, reward, audience, schedule };

class Memory implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

describe('wizard steps', () => {
  it('validates each step on its own and reports the failing field', () => {
    expect(checkWizardStep('format', full)).toEqual({ ok: true });
    expect(checkWizardStep('format', { ...full, title: 'ab' })).toMatchObject({ ok: false, issues: [{ path: 'title' }] });
    expect(checkWizardStep('format', { ...full, format: { kind: 'custom', note: 'short' } })).toMatchObject({ ok: false, issues: [{ path: 'format.note' }] });
    expect(checkWizardStep('format', { ...full, format: { kind: 'custom', note: '브랜드 전용 포맷을 새로 만들어 주세요' } })).toEqual({ ok: true });
    expect(checkWizardStep('reward', full)).toEqual({ ok: true });
    expect(checkWizardStep('audience', full)).toEqual({ ok: true });
    expect(checkWizardStep('schedule', full)).toEqual({ ok: true });
    expect(checkWizardStep('review', full)).toEqual({ ok: true });
  });

  it('keeps the ad disclosure fixed: it cannot be turned off', () => {
    expect(checkWizardStep('schedule', { ...full, schedule: { ...schedule, disclosure: false } })).toMatchObject({ ok: false, issues: [{ path: 'schedule.disclosure' }] });
    expect(checkWizardStep('schedule', { ...full, schedule: { ...schedule, disclosure: undefined } }).ok).toBe(false);
  });

  it('requires the post deadline after the application deadline', () => {
    expect(checkWizardStep('schedule', { ...full, schedule: { ...schedule, postDeadlineOn: '2026-11-10' } })).toMatchObject({ ok: false, issues: [{ path: 'schedule.postDeadlineOn' }] });
    expect(checkWizardStep('schedule', { ...full, schedule: { ...schedule, applicationsCloseOn: '2026-02-31' } }).ok).toBe(false);
  });

  it('keeps slots and budget consistent: slots × lowest reward fits the total', () => {
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, slots: 11 } })).toMatchObject({ ok: false, issues: [{ path: 'reward.totalBudgetKrw' }] });
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, slots: 10 } })).toEqual({ ok: true });
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, rewardMaxKrw: 50_000 } })).toMatchObject({ ok: false, issues: [{ path: 'reward.rewardMaxKrw' }] });
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, slots: 0 } }).ok).toBe(false);
  });

  it('follows the existing payout models: view-based needs a rate, flat has none', () => {
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, model: 'hybrid' } })).toMatchObject({ ok: false, issues: [{ path: 'reward.perThousandViewsKrw' }] });
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, model: 'hybrid', perThousandViewsKrw: 2000 } })).toEqual({ ok: true });
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, model: 'per_view', rewardMinKrw: 0, perThousandViewsKrw: 2000 } })).toEqual({ ok: true });
    expect(checkWizardStep('reward', { ...full, reward: { ...reward, perThousandViewsKrw: 2000 } }).ok).toBe(false);
  });

  it('accepts the three audiences and refuses criteria without a platform', () => {
    expect(checkWizardStep('audience', { audience: { mode: 'all' } })).toEqual({ ok: true });
    expect(checkWizardStep('audience', { audience: { mode: 'invited' } })).toEqual({ ok: true });
    expect(checkWizardStep('audience', { audience: { ...audience, platforms: [] } }).ok).toBe(false);
    expect(checkWizardStep('audience', { audience: { mode: 'everyone' } }).ok).toBe(false);
  });

  it('reopens a restored draft at the first incomplete step', () => {
    expect(firstIncompleteStep({})).toBe('format');
    expect(firstIncompleteStep({ ...full, audience: undefined })).toBe('audience');
    expect(firstIncompleteStep(full)).toBe('review');
  });

  it('produces normalized terms only when every step is complete', () => {
    expect(termsFromDraft({ ...full, schedule: undefined })).toBeNull();
    const terms = termsFromDraft(full)!;
    expect(terms.audience).toEqual({ mode: 'criteria', platforms: ['instagram', 'tiktok'], minFollowers: 3000, gender: 'female', regions: ['서울'] });
    expect(terms.schedule.hashtags).toEqual(['twings']);
    expect(terms.schedule.mentions).toEqual(['twings.app']);
    expect(CampaignTermsSchema.safeParse({ ...terms, extra: 1 }).success).toBe(false);
  });
});

describe('draft storage', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  it('saves and restores a draft per workspace', () => {
    const store = new Memory();
    expect(saveWizardDraft(store, org, { ...full, step: 'audience' })).toBe(true);
    expect(loadWizardDraft(store, org)).toEqual({ ...full, step: 'audience' });
    expect(loadWizardDraft(store, '22222222-2222-4222-8222-222222222222')).toBeNull();
    clearWizardDraft(store, org);
    expect(loadWizardDraft(store, org)).toBeNull();
  });

  it('ignores a draft it did not write, and survives a blocked store', () => {
    const store = new Memory();
    store.setItem(wizardDraftKey(org), '{not json');
    expect(loadWizardDraft(store, org)).toBeNull();
    store.setItem(wizardDraftKey(org), JSON.stringify({ version: 2, step: 'format' }));
    expect(loadWizardDraft(store, org)).toBeNull();
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } };
    expect(saveWizardDraft(blocked, org, full)).toBe(false);
    expect(loadWizardDraft(blocked, org)).toBeNull();
    expect(() => clearWizardDraft(blocked, org)).not.toThrow();
    expect(loadWizardDraft(null, org)).toBeNull();
  });
});

describe('what the terms fill', () => {
  const terms = termsFromDraft(full)!;
  it('derives the brief columns on the server from the terms', () => {
    expect(briefColumnsFromTerms(terms)).toEqual({
      budgetKrw: 1_000_000, budgetTaxBasis: 'excluded', startsOn: null, endsOn: '2026-11-24', productionMode: 'creator',
      criteria: { platforms: ['instagram', 'tiktok'], minFollowers: 3000, maxFollowers: null, primaryMetric: 'views', targetValue: null },
    });
  });

  it('maps the audience to the campaign visibility it asks for', () => {
    expect(campaignAudienceFor({ mode: 'all' })).toBe('public');
    expect(campaignAudienceFor(terms.audience)).toBe('influencers');
    expect(campaignAudienceFor({ mode: 'invited' })).toBe('invited');
  });

  it('pre-fills the admin campaign form, leaving the English side and the final rule to TWINGS', () => {
    const prefill = campaignPrefillFromTerms({ title: full.title!, objective: full.objective!, organizationName: '브랜드' }, terms, () => ['조건: 여성']);
    expect(prefill).toMatchObject({
      title: { en: '', ko: '가을 신제품 캠페인' }, summary: { en: '', ko: full.objective }, brief: { en: '', ko: '조건: 여성' },
      hostName: '브랜드', styleSlug: 'mirror-dance', platforms: ['instagram', 'tiktok'], slots: 5,
      applicationsCloseAt: '2026-11-10T14:59:00.000Z', postDeadlineAt: '2026-11-24T14:59:00.000Z',
      payout: { model: 'flat', flatCents: 100_000, perThousandViewsCents: 0, minCents: 0, maxCents: null, holdDays: 7 },
      requirements: { hashtags: ['twings'], mentions: ['twings.app'], disclosure: true }, budgetCents: 1_000_000, audience: 'influencers',
    });
    const custom = campaignPrefillFromTerms({ title: 't', objective: 'o', organizationName: 'b' }, { ...terms, format: { kind: 'custom', note: '전용 제작 요청입니다' }, audience: { mode: 'all' } }, () => []);
    expect(custom.styleSlug).toBeNull();
    expect(custom.platforms).toEqual(['instagram']);
    expect(custom.brief).toBeNull();
  });
});
