import { describe, expect, it } from 'vitest';
import { withReturnTab } from '@/lib/auth/return-tab';
import { authReturnPath } from '@/lib/routing/surfaces';

const PROJECT = '/brand/projects/6279ee97-631f-46fd-a507-518de58a26dd';
const door = (next: string) => `/auth/signin?provider=google&next=${encodeURIComponent(next)}&locale=ko`;
const nextOf = (href: string) => new URL(href, 'https://x.invalid').searchParams.get('next');

describe('withReturnTab', () => {
  it('puts the campaign tab the link named into the sign-in return path', () => {
    const href = withReturnTab(door(PROJECT), '#shortlist');
    expect(nextOf(href)).toBe(`${PROJECT}#shortlist`);
    expect(href.startsWith('/auth/signin?')).toBe(true);
    expect(href).toContain('provider=google');
    expect(href).toContain('locale=ko');
  });
  it('keeps the query of the campaign link', () => {
    expect(nextOf(withReturnTab(door(`${PROJECT}?returnTo=%2Fbrand`), '#shortlist'))).toBe(`${PROJECT}?returnTo=%2Fbrand#shortlist`);
  });
  it('survives the return-path validation the sign-in and callback routes apply', () => {
    const next = nextOf(withReturnTab(door(PROJECT), '#shortlist'));
    expect(authReturnPath(next, 'brand.twings.app', '/brand')).toBe(`${PROJECT}#shortlist`);
  });
  it('never carries an invitation token or any fragment with a value', () => {
    expect(withReturnTab(door('/brand/invite'), '#token=abc')).toBe(door('/brand/invite'));
    expect(withReturnTab(door(PROJECT), '#token=abc')).toBe(door(PROJECT));
    expect(withReturnTab(door(PROJECT), '#usage=post:1')).toBe(door(PROJECT));
  });
  it('ignores fragments that are not campaign tabs and pages that are not campaigns', () => {
    expect(withReturnTab(door(PROJECT), '#junk')).toBe(door(PROJECT));
    expect(withReturnTab(door(PROJECT), '')).toBe(door(PROJECT));
    expect(withReturnTab(door('/brand'), '#shortlist')).toBe(door('/brand'));
    expect(withReturnTab(door(`${PROJECT}/participants`), '#shortlist')).toBe(door(`${PROJECT}/participants`));
  });
  it('leaves a return path that already names a section alone', () => {
    expect(withReturnTab(door(`${PROJECT}#review`), '#shortlist')).toBe(door(`${PROJECT}#review`));
  });
  it('leaves a link without a return path alone', () => {
    expect(withReturnTab('/ko/legal/terms', '#shortlist')).toBe('/ko/legal/terms');
  });
});
