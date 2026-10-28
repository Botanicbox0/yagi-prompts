import { describe, expect, it } from 'vitest';
import { isPublicNavCurrent } from '@/lib/navigation/public-state';

describe('public navigation', () => {
  it('marks page paths and true descendants without matching similar names', () => {
    expect(isPublicNavCurrent('/ko/campaigns', '/ko/campaigns', '')).toBe(true);
    expect(isPublicNavCurrent('/ko/campaigns', '/ko/campaigns/morphic', '')).toBe(true);
    expect(isPublicNavCurrent('/ko/video', '/ko/video/', '')).toBe(true);
    expect(isPublicNavCurrent('/ko/video', '/ko/videography', '')).toBe(false);
    expect(isPublicNavCurrent('https://brand.twings.app', '/ko/brands', '')).toBe(false);
  });

  it('keeps fallback and not-found navigation usable before a path is available', () => {
    expect(isPublicNavCurrent('/ko/video', null, '')).toBe(false);
    expect(isPublicNavCurrent('/', null, '')).toBe(false);
    expect(isPublicNavCurrent('/ko/brands#work', '', '#work')).toBe(false);
  });

  it('marks only the matching brand section rather than every same-page link', () => {
    expect(isPublicNavCurrent('/ko/brands#work', '/ko/brands', '#work')).toBe(true);
    expect(isPublicNavCurrent('/ko/brands#process', '/ko/brands', '#work')).toBe(false);
    expect(isPublicNavCurrent('/ko/brands#work', '/ko/brands', '')).toBe(false);
    expect(isPublicNavCurrent('/ko/brands#work', '/ko/brands/stories/morphic', '#work')).toBe(false);
  });
});
