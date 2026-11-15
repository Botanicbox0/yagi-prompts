import { describe, expect, it } from 'vitest';
import { corsMediaUrl } from '@/lib/brand-studio/cors-media-url';

const PAGE = 'https://brand.twings.app';

describe('the address a frame is captured from', () => {
  it('gives a cross-origin file its own cache entry', () => {
    expect(corsMediaUrl('https://media.twings.app/st/abc.mp4', PAGE)).toBe('https://media.twings.app/st/abc.mp4?cors=1');
    // An existing query is kept; the marker is set once.
    expect(corsMediaUrl('https://media.twings.app/st/abc.mp4?v=2', PAGE)).toBe('https://media.twings.app/st/abc.mp4?v=2&cors=1');
    expect(corsMediaUrl('https://media.twings.app/st/abc.mp4?cors=1', PAGE)).toBe('https://media.twings.app/st/abc.mp4?cors=1');
  });

  it('leaves same-origin, blob and data addresses alone', () => {
    expect(corsMediaUrl('/api/brand-studio/media/st/abc.mp4', PAGE)).toBe('/api/brand-studio/media/st/abc.mp4');
    expect(corsMediaUrl('https://brand.twings.app/api/brand-studio/media/st/abc.mp4', PAGE)).toBe('https://brand.twings.app/api/brand-studio/media/st/abc.mp4');
    expect(corsMediaUrl('blob:https://brand.twings.app/1234', PAGE)).toBe('blob:https://brand.twings.app/1234');
    expect(corsMediaUrl('data:video/mp4;base64,AAAA', PAGE)).toBe('data:video/mp4;base64,AAAA');
    expect(corsMediaUrl('', PAGE)).toBe('');
  });

  it('without a page (server render) marks only absolute addresses', () => {
    expect(corsMediaUrl('https://media.twings.app/st/abc.mp4', null)).toBe('https://media.twings.app/st/abc.mp4?cors=1');
    expect(corsMediaUrl('/api/brand-studio/media/st/abc.mp4', null)).toBe('/api/brand-studio/media/st/abc.mp4');
  });
});
