import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Audit batch 7/8 (consumer states and copy): the scratch repros in the surface audit asserted the
 * defects; these assert the fixed behavior on the real seams — rendered pages and components.
 */
const state = vi.hoisted(() => ({
  status: 'succeeded' as string,
  campaign: null as unknown,
  style: null as unknown,
}));
const JOB_ID = '22222222-2222-4222-8222-222222222222';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: 'u', email: 'a@b.c', isAdmin: false, tier: 'free', locale: 'ko' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko', getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: vi.fn() }));
vi.mock('@/components/renders/auto-refresh', () => ({ AutoRefresh: () => null }));
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));
vi.mock('@/app/(app)/identity/verify/actions', () => ({ startVerificationAction: async () => undefined }));
vi.mock('@/lib/identity/service', () => ({ loadIdentityGroup: async () => null }));
vi.mock('@/lib/renders/service', () => ({
  failureReason: () => 'reason',
  loadOwnRender: async () => ({
    templateTitle: 'T',
    templateTitleKo: '템플릿',
    job: {
      id: JOB_ID, status: state.status, medium: 'video', aspect: '9:16', templateSlug: 'tpl',
      createdAt: new Date().toISOString(), providerTaskId: null, resultMime: 'video/mp4',
      shareToken: 'tok', shareExpiresAt: new Date(Date.now() + 86400_000).toISOString(), errorCode: 'provider_error',
    },
  }),
}));
vi.mock('@/lib/renders/feedback', () => ({
  FEEDBACK_REASONS: ['face', 'playback', 'mismatch', 'other'],
  loadRenderFeedback: async () => null,
  submitRenderFeedback: async () => ({ ok: false, code: 'unavailable' }),
  notifyRenderFeedback: vi.fn(),
}));
vi.mock('@/lib/campaigns/public-catalog', () => ({
  getCampaignCatalog: async () => ({ campaigns: state.campaign ? [state.campaign] : [], totals: { live: 1, recruiting: 1 } }),
}));
vi.mock('@/lib/prompts/public-catalog', () => ({
  getPromptCatalog: async () => ({ yagi: state.style ? [state.style] : [], community: [] }),
}));

import RenderPage from '@/app/(app)/renders/[id]/page';
import VerifyIdentityPage from '@/app/(app)/identity/verify/page';
import CampaignDetailPage from '@/app/(marketing)/[locale]/campaigns/[slug]/page';
import { AppHeader } from '@/components/app/app-header';
import { MarketingFooter, signInReturn } from '@/components/marketing/chrome';
import { BrandInquiryReceived } from '@/components/campaigns/brand-form';
import { deletionMailto } from '@/components/app/deletion-mailto';
import { createSubmitGuard } from '@/components/twings/submit-guard';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatKrw } from '@/lib/i18n/format';
import { siteOgImage } from '@/lib/seo/og';
import { companyLine } from '@/lib/notify/company-line';
import { renderUnsubscribed } from '@/lib/notify/unsubscribe-page';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';

const ko = getDictionary('ko');
const en = getDictionary('en');

const renderResult = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(await RenderPage({ params: Promise.resolve({ id: JOB_ID }), searchParams: Promise.resolve(query) }));

describe('P2-9: a way back to the account', () => {
  it('the app header links /account with the dictionary label', () => {
    const html = renderToStaticMarkup(<AppHeader locale="ko" dict={ko} rest="/renders" />);
    expect(html).toContain('href="/account"');
    expect(html).toContain(ko.nav.account);
  });

  it('the static footer links the account through sign-in, in each language', () => {
    for (const [locale, dict] of [['ko', ko], ['en', en]] as const) {
      const html = renderToStaticMarkup(<MarketingFooter locale={locale} dict={dict} />);
      expect(html).toContain(`href="/auth/signin?next=%2Faccount&amp;locale=${locale}"`);
      expect(html).toContain('data-footer-account');
      // P2-17: the contact mail subject follows the page language.
      expect(html).toContain(`subject=${encodeURIComponent(dict.footer.mailSubject)}`);
    }
  });
});

describe('P3: nav sign-in returns to the page it was pressed on', () => {
  it('uses the static page path, and the templates from the landing', () => {
    expect(signInReturn('ko', '/campaigns/seoul-94')).toBe('/ko/campaigns/seoul-94');
    expect(signInReturn('en', '/t/tpl')).toBe('/en/t/tpl');
    expect(signInReturn('ko', '/')).toBe('/ko/video');
  });
});

describe('P2-10 and P3: the result page', () => {
  beforeEach(() => {
    state.status = 'succeeded';
  });

  for (const outcome of ['unavailable', 'not_found', 'sign_in_required', 'whatever']) {
    it(`?feedback=${outcome} says so in an alert`, async () => {
      const html = await renderResult({ feedback: outcome });
      expect(html).toContain('data-feedback-error="unavailable"');
      expect(html).toContain('role="alert"');
      expect(html).toContain(ko.renders.feedback.errUnavailable);
    });
  }

  it('keeps the specific invalid message and stays quiet on sent', async () => {
    expect(await renderResult({ feedback: 'invalid' })).toContain(ko.renders.feedback.errInvalid);
    expect(await renderResult({ feedback: 'sent' })).not.toContain('data-feedback-error');
  });

  it('the progressbar has an accessible name', async () => {
    state.status = 'running';
    const html = await renderResult();
    const bar = /<div[^>]*role="progressbar"[^>]*>/.exec(html)?.[0] ?? '';
    expect(bar).toContain(`aria-label="${ko.renders.progressLabel}"`);
  });

  it('share expiry and refund notes are no longer faded to 45%', async () => {
    const ok = await renderResult();
    expect(ok).toMatch(/<p class="[^"]*opacity-70[^"]*">[^<]*까지 로그인 없이/);
    expect(ok).not.toMatch(/opacity-45/);
    state.status = 'failed';
    const failed = await renderResult();
    expect(failed).toMatch(/<p class="[^"]*opacity-70[^"]*">생성이 최종 실패하면/);
  });
});

describe('P2-12: identity verify keeps its return path through the language switch', () => {
  it('the locale toggle posts back to the page with ?next', async () => {
    const html = renderToStaticMarkup(await VerifyIdentityPage({ searchParams: Promise.resolve({ next: '/ko/t/tpl#make', err: 'bank_error' }) }));
    expect(html).toContain('name="next" value="/identity/verify?next=%2Fko%2Ft%2Ftpl%23make"');
  });
});

describe('P2-11 and Q3: campaign detail', () => {
  beforeEach(() => {
    state.campaign = {
      id: 'c1', slug: 'seoul-94', status: 'recruiting', title: { en: 'Seoul 94', ko: '서울 94' }, summary: { en: 's', ko: '요약' },
      brief: null, hostName: 'Studio', hostKind: 'brand', hostUrl: null, styleSlug: 'neon-alley', platforms: ['instagram'],
      deliverable: 'reel', slots: 10, slotsTaken: 0, applicationsCloseAt: null, postDeadlineAt: null,
      requirements: { hashtags: [], mentions: [], disclosure: true }, publishedAt: null,
    };
    state.style = { slug: 'neon-alley', title: 'Neon alley', titleKo: '네온 골목', video: null, poster: null };
  });

  it('the format CTA opens the template make section, not the generic /studio listing', async () => {
    const html = renderToStaticMarkup(await CampaignDetailPage({ params: Promise.resolve({ locale: 'ko', slug: 'seoul-94' }) }));
    expect(html).toContain('href="/ko/t/neon-alley#make"');
    expect(html).not.toContain('href="/ko/studio"');
  });

  it('does not promise "upload a photo and it comes out" while generation is closed', async () => {
    const html = renderToStaticMarkup(await CampaignDetailPage({ params: Promise.resolve({ locale: 'ko', slug: 'seoul-94' }) }));
    const c = ko.campaigns;
    if (RENDER_PIPELINE_PUBLIC) {
      expect(html).toContain(c.formatBody);
    } else {
      expect(html).toContain(c.formatBodyClosed);
      expect(html).not.toContain(c.formatBody);
      expect(html).toContain(c.makeItCtaClosed);
    }
  });

  it('the payout step no longer promises a blanket seven days', () => {
    expect(ko.campaigns.step5).not.toContain('7일');
    expect(en.campaigns.step5).not.toMatch(/seven days/i);
    expect(ko.faq.a5).not.toContain('7일');
    expect(en.faq.a5).not.toMatch(/seven days/i);
  });
});

describe('P2-14: the unsubscribe page names the mail that was switched off', () => {
  it('new-template and campaign mails', () => {
    expect(renderUnsubscribed({ locale: 'ko', toggle: 'notif_new_playbook' })).toContain('새 템플릿 알림');
    expect(renderUnsubscribed({ locale: 'ko', toggle: 'notif_updates' })).toContain('캠페인 알림');
    expect(renderUnsubscribed({ locale: 'en', toggle: 'notif_new_playbook' })).toContain('new template');
    expect(renderUnsubscribed({ locale: 'en', toggle: 'notif_updates' })).toContain('campaign');
    for (const locale of ['ko', 'en'] as const) {
      for (const toggle of ['notif_new_playbook', 'notif_updates'] as const) {
        expect(renderUnsubscribed({ locale, toggle })).not.toMatch(/플레이북|playbook/i);
      }
    }
  });
});

describe('P2-16: FAQ a3 carries the terms §5.3 elements', () => {
  it('ko', () => {
    for (const phrase of ['본인 얼굴', '인물 자산 그룹', '자동 검수', 'BytePlus', '카메라 본인 인증', '24시간', '계정을 삭제하면']) {
      expect(ko.faq.a3).toContain(phrase);
    }
  });
  it('en', () => {
    for (const phrase of ['your own face', 'likeness asset group', 'automated review', 'BytePlus', 'camera check', '24 hours', 'Deleting your account']) {
      expect(en.faq.a3).toContain(phrase);
    }
  });
});

describe('Q7: the brand enquiry success panel', () => {
  const labels = ko.campaigns.brands;
  it('mentions the receipt only when it went out, and promises no SLA', () => {
    const without = renderToStaticMarkup(<BrandInquiryReceived labels={labels} receipt={false} />);
    expect(without).not.toContain(labels.successReceipt);
    expect(without).not.toContain('1영업일');
    const withReceipt = renderToStaticMarkup(<BrandInquiryReceived labels={labels} receipt />);
    expect(withReceipt).toContain('data-brand-inquiry-receipt');
    expect(withReceipt).toContain(labels.successReceipt);
    expect(en.campaigns.brands.successBody).not.toMatch(/business day/);
  });
});

describe('P2-17 and P2-18: localized strings and money', () => {
  it('the deletion mailto is written in the reader language', () => {
    const koHref = decodeURIComponent(deletionMailto(ko.account, 'me@example.com'));
    expect(koHref).toContain(ko.account.deletionMailSubject);
    expect(koHref).toContain('계정: me@example.com');
    expect(decodeURIComponent(deletionMailto(en.account, null))).toContain('Account: (the address I am signed in with)');
  });

  it('OG alt and email company line follow the locale', () => {
    expect(siteOgImage('ko').alt).toMatch(/[가-힣]/);
    expect(siteOgImage('en').alt).not.toMatch(/[가-힣]/);
    expect(companyLine('en', { address: true })).toBe('YAGI WORKSHOP Inc. · 55 Digital-ro 34-gil, Guro-gu, Seoul, Republic of Korea · hello@yagiworkshop.xyz');
    expect(companyLine('ko')).toBe('야기워크숍 주식회사 · hello@yagiworkshop.xyz');
  });

  it('one KRW format per locale', () => {
    expect(formatKrw(9900, 'ko')).toBe('9,900원');
    expect(formatKrw(9900, 'en')).toBe('₩9,900');
  });
});

describe('H3: the studio submit guard', () => {
  it('refuses re-entry while in flight and stays locked after navigation', () => {
    const guard = createSubmitGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    expect(guard.finish()).toBe(true);
    expect(guard.begin()).toBe(true);
    guard.leave();
    expect(guard.finish()).toBe(false);
    expect(guard.begin()).toBe(false);
  });
});
