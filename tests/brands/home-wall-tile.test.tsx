import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clock } from '@/components/brand-studio/rail/text';
import { HomeWallTile } from '@/components/brand-workspace/home/home-actions';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * One tile of the home's wall (components/brand-workspace/home/home-actions.tsx `HomeWallTile`): a link to the
 * result at its own proportions. A clip shows a still (its poster, or a frame of itself) and plays, muted, only
 * while a mouse pointer is on it: never on its own, never on touch, never for a visitor who asked for less motion.
 */
type TileProps = Parameters<typeof HomeWallTile>[0];
const HREF = '/brand/studio/video?organizationId=a0000000-0000-4000-8000-0000000000a1&view=o%3A1';
const image: TileProps = { href: '/brand/studio?organizationId=a0000000-0000-4000-8000-0000000000a1&view=o%3A2', kind: 'image', src: '/m/still.webp', clip: null, play: null, seconds: null, label: 'Open image result' };
const overPoster: TileProps = { href: HREF, kind: 'video', src: '/m/poster.jpg', clip: null, play: '/m/film.mp4', seconds: 6.2, label: 'Open video result' };
const stilled: TileProps = { href: HREF, kind: 'video', src: null, clip: '/m/film.mp4', play: '/m/film.mp4', seconds: 6.2, label: 'Open video result' };

const tile = (props: TileProps) => renderToStaticMarkup(<HomeWallTile {...props} />);
const attrs = (markup: string, tag: string) => /<(\w+)([^>]*)>/.exec(markup.slice(markup.indexOf(`<${tag}`)))?.[2] ?? '';

describe('the tile, as the server draws it', () => {
  it('is a link to the result with the picture, for an image: nothing to play, no badge', () => {
    const markup = tile(image);
    expect(markup.startsWith('<a ')).toBe(true);
    expect(markup).toMatch(/^<a href="\/brand\/studio\?organizationId=a0000000-0000-4000-8000-0000000000a1&amp;view=o%3A2"[^>]*data-home-result="image"[^>]*aria-label="Open image result"/);
    expect(markup).toContain('<img src="/m/still.webp" alt="" loading="lazy" decoding="async"/>');
    expect(markup).not.toContain('<video');
    expect(markup).not.toContain('data-playing');
    // No duration badge on a still picture.
    expect(markup).not.toContain('<svg');
    expect(markup).not.toMatch(/\d:\d\d/);
  });

  it('stills a clip without a poster on one of its own frames, fetching only its metadata', () => {
    const markup = tile(stilled);
    expect(markup).not.toContain('<img');
    const video = attrs(markup, 'video');
    expect(video).toContain('src="/m/film.mp4#t=1"');
    expect(video).toContain('preload="metadata"');
    expect(video).toContain('data-home-film="still"');
    expect(video).toContain('muted=""');
    // (React's server markup keeps the prop's camel case; HTML attribute names are case-insensitive.)
    expect(video.toLowerCase()).toContain('playsinline=""');
    expect(video).toContain('aria-hidden="true"');
    expect(video).toContain('tabindex="-1"');
    expect(video).not.toMatch(/autoplay/i);
    // Past a fade-in from black, never past the middle of a short clip; a clip of unknown length at 1 s.
    expect(attrs(tile({ ...stilled, seconds: 1.2 }), 'video')).toContain('src="/m/film.mp4#t=0.6"');
    expect(attrs(tile({ ...stilled, seconds: 0.4 }), 'video')).toContain('src="/m/film.mp4#t=0.2"');
    expect(attrs(tile({ ...stilled, seconds: null }), 'video')).toContain('src="/m/film.mp4#t=1"');
    expect(attrs(tile({ ...stilled, seconds: 40 }), 'video')).toContain('src="/m/film.mp4#t=1"');
  });

  it('shows the poster of a clip that has one, with the clip hidden behind it and not fetched until asked', () => {
    const markup = tile(overPoster);
    expect(markup).toContain('<img src="/m/poster.jpg"');
    const video = attrs(markup, 'video');
    expect(video).toContain('src="/m/film.mp4"');
    expect(video).not.toContain('#t=');
    expect(video).toContain('preload="none"');
    expect(video).toContain('data-home-film="over-poster"');
    expect(video).toContain('muted=""');
    expect(video).not.toMatch(/autoplay/i);
    // The picture comes first, so the poster is what shows until the clip plays over it.
    expect(markup.indexOf('<img')).toBeLessThan(markup.indexOf('<video'));
  });

  it('shows the clip\'s length as a clock, or a play mark when the length is unknown', () => {
    expect(tile(overPoster)).toContain(`>${clock(6.2)}</span>`);
    expect(clock(6.2)).toBe('0:06');
    expect(tile({ ...overPoster, seconds: 75 })).toContain('>1:15</span>');
    const unknown = tile({ ...overPoster, seconds: null });
    expect(unknown).toMatch(/<span[^>]*aria-hidden="true"[^>]*><svg viewBox="0 0 20 20"><path d="M7 5\.5v9l7\.5-4\.5z"><\/path><\/svg><\/span>/);
  });

  it('draws no video for a clip with nothing to play', () => {
    const markup = tile({ ...overPoster, play: null });
    expect(markup).not.toContain('<video');
    expect(markup).toContain('<img src="/m/poster.jpg"');
  });
});

/* ------------------------------------------------------------------ pointer behaviour in the DOM harness */

/** A pointer event as the harness dispatches it: bubbles to React's root, which turns over/out into enter/leave. */
class PointerLike {
  bubbles = true;
  cancelable = true;
  defaultPrevented = false;
  cancelBubble = false;
  target: unknown = null;
  currentTarget: unknown = null;
  relatedTarget = null;
  constructor(
    public type: 'pointerover' | 'pointerout',
    public pointerType: 'mouse' | 'touch' | 'pen',
  ) {}
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.cancelBubble = true;
  }
  stopImmediatePropagation() {
    this.cancelBubble = true;
  }
}

const mounted: MountedDom[] = [];
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountTile(props: TileProps) {
  const dom = await mountDom(<HomeWallTile {...props} />);
  mounted.push(dom);
  const link = dom.query('[data-home-result]')!;
  const video = dom.query('video');
  const play = video ? vi.spyOn(video, 'play') : null;
  const pause = video ? vi.spyOn(video, 'pause') : null;
  const pointer = async (type: 'pointerover' | 'pointerout', pointerType: 'mouse' | 'touch' | 'pen' = 'mouse') => {
    await act(async () => {
      link.dispatchEvent(new PointerLike(type, pointerType) as never);
    });
  };
  return { dom, link, video, play, pause, pointer };
}

/** `matchMedia` as a browser answers it for a visitor who asked for less motion. */
function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('the tile under a pointer', () => {
  it('plays a clip over its poster, muted, from the start, while a mouse is on it, and pauses when it leaves', async () => {
    reducedMotion(false);
    const t = await mountTile(overPoster);
    expect(t.link.getAttribute('data-playing')).toBeNull();
    t.video!.currentTime = 3;
    await t.pointer('pointerover');
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.video!.currentTime).toBe(0);
    expect(t.link.getAttribute('data-playing')).toBe('true');
    await t.pointer('pointerout');
    expect(t.pause).toHaveBeenCalledTimes(1);
    expect(t.link.getAttribute('data-playing')).toBeNull();
    // Hidden again behind its poster: no seek back to a still frame.
    expect(t.video!.currentTime).toBe(0);
  });

  it('plays a stilled clip too, and puts it back on its still frame when the pointer leaves', async () => {
    reducedMotion(false);
    const t = await mountTile(stilled);
    await t.pointer('pointerover');
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.link.getAttribute('data-playing')).toBe('true');
    t.video!.currentTime = 4.2;
    await t.pointer('pointerout');
    expect(t.pause).toHaveBeenCalledTimes(1);
    expect(t.link.getAttribute('data-playing')).toBeNull();
    expect(t.video!.currentTime).toBe(1);
  });

  it('never plays on touch or a pen', async () => {
    reducedMotion(false);
    for (const pointerType of ['touch', 'pen'] as const) {
      const t = await mountTile(overPoster);
      await t.pointer('pointerover', pointerType);
      expect(t.play, pointerType).not.toHaveBeenCalled();
      expect(t.link.getAttribute('data-playing'), pointerType).toBeNull();
      await mounted.pop()!.unmount();
    }
  });

  it('never plays for a visitor who asked for less motion', async () => {
    reducedMotion(true);
    for (const props of [overPoster, stilled]) {
      const t = await mountTile(props);
      await t.pointer('pointerover');
      expect(t.play).not.toHaveBeenCalled();
      expect(t.link.getAttribute('data-playing')).toBeNull();
      await mounted.pop()!.unmount();
    }
  });

  it('does nothing for an image', async () => {
    reducedMotion(false);
    const t = await mountTile(image);
    expect(t.video).toBeNull();
    await t.pointer('pointerover');
    expect(t.link.getAttribute('data-playing')).toBeNull();
  });

  it('gives up quietly when the browser refuses to play', async () => {
    reducedMotion(false);
    const t = await mountTile(overPoster);
    t.play!.mockImplementation(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
    await t.pointer('pointerover');
    await act(async () => {
      await Promise.resolve();
    });
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.link.getAttribute('data-playing')).toBeNull();
  });
});
