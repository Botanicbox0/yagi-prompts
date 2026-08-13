import { describe, expect, it } from 'vitest';
import { EMBEDDED_WEBVIEW_TOKENS, isEmbeddedWebView } from '@/lib/auth/webview';

/**
 * Design review F1 — the embedded-WebView gate on `/auth/signin`.
 *
 * Google answers `disallowed_useragent` inside in-app browsers, and the founder's bio link IS
 * how readers arrive — from Instagram, KakaoTalk and friends. The strings below are real UAs
 * (captured 2024–2026 app builds), because the whole value of this suite is that the tokens
 * match what those apps actually send, and nothing that real browsers send.
 */

const EMBEDDED: Array<[string, string]> = [
  [
    'Instagram iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98 (iPhone16,2; iOS 17_5_1; ko_KR; ko; scale=3.00; 1290x2796; 591149735)',
  ],
  [
    'Instagram Android',
    'Mozilla/5.0 (Linux; Android 14; SM-S928N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.135 Mobile Safari/537.36 Instagram 341.0.0.40.109 Android (34/14; 450dpi; 1080x2340; samsung; SM-S928N; e3q; qcom; ko_KR; 628603063)',
  ],
  [
    'KakaoTalk iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5',
  ],
  [
    'Facebook iOS (FBAN/FBAV)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/467.0.0.28.107;FBBV/604676211;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBID/phone;FBLC/ko_KR;FBOP/5]',
  ],
  [
    'Line iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 Line/14.10.0/IAB',
  ],
  [
    'Naver in-app',
    'Mozilla/5.0 (Linux; Android 14; SM-G998N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.135 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.3)',
  ],
  [
    'Daum apps',
    'Mozilla/5.0 (Linux; Android 13; SM-G991N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.135 Mobile Safari/537.36;DaumApps/5.9.5 daumCafe/5.9.5',
  ],
  [
    'Everytime iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Everytime/8.0.5',
  ],
  [
    'generic Android WebView (the `; wv)` marker alone)',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AD1A.240530.030; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36',
  ],
];

const REAL_BROWSERS: Array<[string, string]> = [
  [
    'Chrome on Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ],
  [
    'Chrome on Android (no wv marker)',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  ],
  [
    'Safari on iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ],
  [
    'Safari on macOS',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  ],
  [
    'Samsung Internet',
    'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  ],
];

describe('isEmbeddedWebView (F1)', () => {
  for (const [name, ua] of EMBEDDED) {
    it(`detects ${name}`, () => {
      expect(isEmbeddedWebView(ua)).toBe(true);
    });
  }

  for (const [name, ua] of REAL_BROWSERS) {
    it(`passes ${name} through to Google`, () => {
      expect(isEmbeddedWebView(ua)).toBe(false);
    });
  }

  it('is case-insensitive — apps do not agree on casing', () => {
    expect(isEmbeddedWebView('mozilla/5.0 instagram 300.0')).toBe(true);
    expect(isEmbeddedWebView('Mozilla/5.0 KakaoTalk 10.0')).toBe(true);
  });

  it('answers false for an absent header', () => {
    expect(isEmbeddedWebView('')).toBe(false);
  });

  it('keeps the token list the brief names, verbatim', () => {
    expect([...EMBEDDED_WEBVIEW_TOKENS]).toEqual([
      'Instagram',
      'KAKAOTALK',
      'FBAN',
      'FBAV',
      'Line/',
      'NAVER(inapp',
      'DaumApps',
      'Everytime',
      '; wv)',
    ]);
  });
});
