import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { Notice, NoticeBand } from '@/components/marketing/notice';
import {
  noticeLabels,
  parseNoticeCode,
  stripNoticeParams,
} from '@/components/marketing/notice-codes';

/**
 * Design review F2 — the auth outcomes that used to be silent.
 *
 * `/auth/signin` and `/auth/callback` land back on the landing with `?error=oauth` or
 * `?error=oauth_unconfigured`, and the login gate emits `?signin=1` — and nothing rendered any
 * of them. The band reads ONLY those three codes; anything else stays a plain page.
 */

const dict = getDictionary('en');
const labels = noticeLabels(dict);

describe('parseNoticeCode (F2)', () => {
  it('reads exactly the three known codes', () => {
    expect(parseNoticeCode('?error=oauth')).toBe('oauth');
    expect(parseNoticeCode('?error=oauth_unconfigured')).toBe('oauth_unconfigured');
    expect(parseNoticeCode('?signin=1&next=%2Flibrary')).toBe('signin');
  });

  it('answers null for unknown or absent parameters', () => {
    expect(parseNoticeCode('')).toBeNull();
    expect(parseNoticeCode('?')).toBeNull();
    expect(parseNoticeCode('?error=nope')).toBeNull();
    expect(parseNoticeCode('?error=')).toBeNull();
    expect(parseNoticeCode('?signin=0')).toBeNull();
    expect(parseNoticeCode('?utm_source=x')).toBeNull();
  });

  it('prefers the error over the gate when both appear', () => {
    expect(parseNoticeCode('?signin=1&error=oauth')).toBe('oauth');
  });
});

describe('stripNoticeParams (F2)', () => {
  it('removes the handled parameters and keeps everyone else’s', () => {
    expect(stripNoticeParams('?error=oauth&utm_source=x')).toBe('?utm_source=x');
    expect(stripNoticeParams('?error=oauth_unconfigured')).toBe('');
    // `next` belongs to the same gate redirect that carried `signin=1`.
    expect(stripNoticeParams('?signin=1&next=%2Flibrary')).toBe('');
    expect(stripNoticeParams('?next=%2Flibrary')).toBe('?next=%2Flibrary');
  });
});

describe('NoticeBand (F2)', () => {
  const band = (code: Parameters<typeof NoticeBand>[0]['code']) =>
    renderToStaticMarkup(<NoticeBand code={code} labels={labels} onDismiss={() => {}} />);

  it('renders each code as mono label + its dictionary sentence', () => {
    const oauth = band('oauth');
    expect(oauth).toContain('data-notice="oauth"');
    expect(oauth).toContain('error=oauth');
    expect(oauth).toContain(dict.notice.oauth);

    const unconfigured = band('oauth_unconfigured');
    expect(unconfigured).toContain('data-notice="oauth_unconfigured"');
    expect(unconfigured).toContain('error=oauth_unconfigured');
    expect(unconfigured).toContain(dict.notice.oauthUnconfigured);

    const signin = band('signin');
    expect(signin).toContain('data-notice="signin"');
    expect(signin).toContain(dict.notice.signin);
  });

  it('carries the dismiss control', () => {
    expect(band('oauth')).toContain(dict.notice.dismiss);
    expect(band('oauth')).toContain('<button');
  });
});

describe('Notice (F2)', () => {
  it('renders nothing on the server — the static page stays byte-identical', () => {
    // The code is read from `location.search` in an effect; before it runs there is no band.
    expect(renderToStaticMarkup(<Notice labels={labels} />)).toBe('');
  });
});
