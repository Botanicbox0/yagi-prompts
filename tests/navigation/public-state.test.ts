import { describe, expect, it } from 'vitest';
import { filterHref, isPublicNavCurrent, readFilterState, readUseCase, useCaseHref } from '@/lib/navigation/public-state';

/** 2026-11-24: the video list filters by length and NEW; the URL says which, the page stays static. */
describe('list filter URL state', () => {
  const video = { new: ['1'], length: ['short', 'mid', 'long'] } as const;
  const image = { useCase: ['cinematic', 'mv'] } as const;

  it('restores the choices the list offers and drops everything else', () => {
    expect(readFilterState('?new=1&length=short', video)).toEqual({ new: '1', length: 'short' });
    expect(readFilterState('?length=forever&new=yes', video)).toEqual({});
    expect(readFilterState('', video)).toEqual({});
    // A length the list does not offer today (no card in that band) is not restored.
    expect(readFilterState('?length=long', { length: ['short', 'mid'] })).toEqual({});
  });

  it('ignores a legacy use-case link on the video list', () => {
    expect(readFilterState('?useCase=mv', video)).toEqual({});
    expect(readFilterState('?useCase=mv&length=mid', video)).toEqual({ length: 'mid' });
  });

  it('writes only the filter params, keeping other context and the fragment', () => {
    expect(filterHref('https://twings.app/ko/video?source=pwa#grid', { length: 'short' }, video))
      .toBe('/ko/video?source=pwa&length=short#grid');
    expect(filterHref('https://twings.app/ko/video?length=short&source=pwa', { new: '1', length: 'mid' }, video))
      .toBe('/ko/video?source=pwa&new=1&length=mid');
  });

  it('removes cleared params, and strips a legacy use case on the first interaction', () => {
    expect(filterHref('https://twings.app/ko/video?new=1&length=short', {}, video)).toBe('/ko/video');
    expect(filterHref('https://twings.app/ko/video?useCase=mv&source=pwa', { length: 'long' }, video)).toBe('/ko/video?source=pwa&length=long');
    expect(filterHref('https://twings.app/ko/video?useCase=mv', {}, video)).toBe('/ko/video');
  });

  it('never writes a value the list does not offer', () => {
    expect(filterHref('https://twings.app/ko/video', { length: 'forever', new: 'yes' }, video)).toBe('/ko/video');
    expect(filterHref('https://twings.app/ko/video', { useCase: 'mv' }, video)).toBe('/ko/video');
  });

  it('keeps the image list on ?useCase=', () => {
    expect(readFilterState('?useCase=mv', image)).toEqual({ useCase: 'mv' });
    expect(filterHref('https://twings.app/en/image?length=short#top', { useCase: 'cinematic' }, image)).toBe('/en/image?useCase=cinematic#top');
  });
});

describe('public navigation and shareable catalog filters', () => {
  const options = ['cinematic', 'mv'];

  it('restores only use cases that exist in the current catalog', () => {
    expect(readUseCase('?useCase=mv', options)).toBe('mv');
    expect(readUseCase('?useCase=unknown', options)).toBeNull();
    expect(readUseCase('', options)).toBeNull();
  });

  it('changes only the use-case query, preserving other context and the fragment', () => {
    expect(useCaseHref('https://twings.app/ko/video?from=home&useCase=mv#gallery', 'cinematic', options))
      .toBe('/ko/video?from=home&useCase=cinematic#gallery');
    expect(useCaseHref('https://twings.app/ko/video?from=home&useCase=mv#gallery', null, options))
      .toBe('/ko/video?from=home#gallery');
    expect(useCaseHref('https://twings.app/ko/video?useCase=mv', 'unknown', options)).toBe('/ko/video');
  });

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
