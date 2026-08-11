import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  isAppPath,
  localizedPath,
  parseAcceptLanguage,
  resolveLocale,
  splitLocale,
} from '@/lib/i18n/config';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

describe('locale precedence chain (PLAN §3.9)', () => {
  it('is URL > cookie > profile > Accept-Language > en', () => {
    expect(
      resolveLocale({ urlLocale: 'en', cookieLocale: 'ko', profileLocale: 'ko', acceptLanguage: 'ko' }),
    ).toBe('en');
    expect(resolveLocale({ urlLocale: null, cookieLocale: 'ko', profileLocale: 'en' })).toBe('ko');
    expect(resolveLocale({ profileLocale: 'ko', acceptLanguage: 'en-US' })).toBe('ko');
    expect(resolveLocale({ acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8' })).toBe('ko');
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
  });

  it('ignores unsupported values at every level rather than trusting them', () => {
    expect(resolveLocale({ urlLocale: 'fr', cookieLocale: 'ko' })).toBe('ko');
    expect(resolveLocale({ cookieLocale: 'zz', acceptLanguage: 'ja-JP' })).toBe('en');
  });

  it('reads q-values in Accept-Language', () => {
    expect(parseAcceptLanguage('en;q=0.3,ko;q=0.9')).toBe('ko');
    expect(parseAcceptLanguage('fr-FR,de;q=0.8')).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
  });
});

describe('locale-prefixed public routing (PLAN §3.9 / §4)', () => {
  it('splits and rebuilds prefixed paths losslessly', () => {
    expect(splitLocale('/ko/pricing')).toEqual({ locale: 'ko', rest: '/pricing' });
    expect(splitLocale('/en')).toEqual({ locale: 'en', rest: '/' });
    expect(splitLocale('/pricing')).toEqual({ locale: null, rest: '/pricing' });
    expect(splitLocale('/ko/p/character-sheet')).toEqual({ locale: 'ko', rest: '/p/character-sheet' });

    expect(localizedPath('ko', '/')).toBe('/ko');
    expect(localizedPath('en', '/pricing')).toBe('/en/pricing');
    expect(localizedPath('ko', '/p/x')).toBe('/ko/p/x');
  });

  it('classifies app surface as unprefixed', () => {
    for (const path of ['/library', '/account', '/billing/success', '/admin', '/admin/policy']) {
      expect(isAppPath(path), path).toBe(true);
    }
    for (const path of ['/en', '/ko/pricing', '/en/p/slug', '/']) {
      expect(isAppPath(path), path).toBe(false);
    }
    // a playbook slug that merely starts with an app prefix is still public
    expect(isAppPath('/libraries')).toBe(false);
  });
});

describe('dictionaries', () => {
  it('keeps ko structurally identical to en', () => {
    const shape = (value: unknown): unknown =>
      value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, shape(v)]),
          )
        : typeof value;
    expect(shape(ko)).toEqual(shape(en));
  });

  it('carries the §3.1 Korean CTA verbatim', () => {
    expect(ko.auth.startWithGoogle).toBe('Google로 시작하기');
    expect(en.auth.startWithGoogle).toBe('Start with Google');
  });
});
