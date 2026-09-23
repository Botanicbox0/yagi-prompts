import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { NoticeBand } from '@/components/marketing/notice';
import { noticeLabels, noticeSigninHref, stripNoticeParams } from '@/components/marketing/notice-codes';

/**
 * UX audit (2026-09-03): the "sign in first" band said the sentence and offered only Dismiss —
 * the reader who had just been bounced had to find the nav to do the one thing asked of them.
 */
describe('the sign-in notice band', () => {
  const labels = noticeLabels(getDictionary('ko'));

  it('carries the sign-in door, with the gated page as its return', () => {
    const html = renderToStaticMarkup(
      <NoticeBand
        code="signin"
        labels={labels}
        signinHref="/auth/signin?next=%2Fko%2Fprompts%2Fx&locale=ko"
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('data-notice-signin');
    expect(html).toContain('href="/auth/signin?next=%2Fko%2Fprompts%2Fx&amp;locale=ko"');
    expect(html).toContain(labels.signIn);
  });

  // Audit P1-5 replaced "no door on the OAuth codes": a cancelled consent is exactly when the
  // reader needs the retry, and the failure redirect now carries the page they were heading to.
  it('shows the retry door on the OAuth error codes when the failure carried a return path', () => {
    for (const code of ['oauth', 'oauth_unconfigured'] as const) {
      const html = renderToStaticMarkup(
        <NoticeBand code={code} labels={labels} signinHref="/auth/signin?next=%2Fko%2Ft%2Fx&locale=ko" onDismiss={() => {}} />,
      );
      expect(html).toContain('data-notice-signin');
      expect(html).toContain('href="/auth/signin?next=%2Fko%2Ft%2Fx&amp;locale=ko"');
    }
  });

  // Coordinator browser QA: the band showed the internal "ERROR=OAUTH" chip to customers. The code
  // stays in `data-notice` for the sweep and analytics; readers see only the localized sentence.
  it('shows the localized sentence without the internal code label, in both languages', () => {
    for (const locale of ['ko', 'en'] as const) {
      const l = noticeLabels(getDictionary(locale));
      for (const [code, message] of [['oauth', l.oauth], ['oauth_unconfigured', l.oauthUnconfigured], ['signin', l.signin]] as const) {
        const html = renderToStaticMarkup(<NoticeBand code={code} labels={l} signinHref="/auth/signin?next=%2Fko&locale=ko" onDismiss={() => {}} />);
        expect(html).toContain(`data-notice="${code}"`);
        expect(html).toContain(message);
        expect(html).toContain('data-notice-signin');
        const visible = html.replace(/<[^>]+>/g, ' ');
        expect(visible).not.toMatch(/error=|oauth_unconfigured|\boauth\b/i);
      }
    }
  });

  it('shows no door when there is nothing safe to return to', () => {
    const html = renderToStaticMarkup(<NoticeBand code="oauth" labels={labels} signinHref={null} onDismiss={() => {}} />);
    expect(html).not.toContain('data-notice-signin');
  });
});

describe('noticeSigninHref', () => {
  it('keeps a safe next for the OAuth codes', () => {
    expect(noticeSigninHref('oauth', '?error=oauth&next=%2Fko%2Ft%2Fsome-template%23make', '/ko', 'ko')).toBe(
      '/auth/signin?next=%2Fko%2Ft%2Fsome-template%23make&locale=ko',
    );
    expect(noticeSigninHref('oauth_unconfigured', '?error=oauth_unconfigured&next=%2Fcampaigns%2Fx%2Fapply', '/en', 'en')).toBe(
      '/auth/signin?next=%2Fcampaigns%2Fx%2Fapply&locale=en',
    );
  });

  it('offers no OAuth retry without a next', () => {
    expect(noticeSigninHref('oauth', '?error=oauth', '/ko', 'ko')).toBeNull();
  });

  for (const next of ['//evil.example/x', '/\\evil.example/x', '/%2fevil.example', '/%5cevil.example', 'https://evil.example/', '/\t/evil.example']) {
    it(`never turns ${JSON.stringify(next)} into a door`, () => {
      const search = `?${new URLSearchParams({ error: 'oauth', next })}`;
      expect(noticeSigninHref('oauth', search, '/ko', 'ko')).toBeNull();
      // The gate code falls back to this page, as before.
      const gate = noticeSigninHref('signin', `?${new URLSearchParams({ signin: '1', next })}`, '/ko', 'ko');
      expect(gate).toBe('/auth/signin?next=%2Fko&locale=ko');
    });
  }

  it('cleans the failure return path out of the URL with the error', () => {
    expect(stripNoticeParams('?error=oauth&next=%2Fko%2Ft%2Fx&utm=a')).toBe('?utm=a');
  });
});
