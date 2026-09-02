import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { NoticeBand } from '@/components/marketing/notice';
import { noticeLabels } from '@/components/marketing/notice-codes';

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

  it('shows no door on the OAuth error codes — there is nothing to sign into yet', () => {
    const html = renderToStaticMarkup(
      <NoticeBand code="oauth" labels={labels} signinHref="/auth/signin?next=%2F&locale=ko" onDismiss={() => {}} />,
    );
    expect(html).not.toContain('data-notice-signin');
  });
});
