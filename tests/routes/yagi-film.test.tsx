import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilmPlayer } from '@/components/yagi/film-player';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { playFilm } from '@/lib/yagi/playback';

describe('studio film viewing', () => {
  it('offers an accessible modal viewer without preloading a second film for every tile', () => {
    const html = renderToStaticMarkup(<FilmPlayer src="/reel/campaigns/beauty-rose.mp4" poster="/reel/campaigns/beauty-rose.jpg"
      label="Rose film" labels={getDictionary('en').yagi} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-label="Rose film"');
    expect(html).toContain('Close film');
    expect((html.match(/<video/g) ?? []).length).toBe(1);
    expect(html).toContain('preload="none"');
    expect(html).not.toContain('autoplay=""');
  });

  it('reports rejected playback so the visitor gets a retry instead of a dead control', async () => {
    const failure = vi.fn();
    await playFilm({ play: vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError')) }, failure);
    expect(failure).toHaveBeenCalledOnce();
  });

  it('does not misreport intentional off-screen or dialog pauses as a failed film', async () => {
    const failure = vi.fn();
    await playFilm({ play: vi.fn().mockRejectedValue(new DOMException('Interrupted', 'AbortError')) }, failure);
    expect(failure).not.toHaveBeenCalled();
  });

  it('does not show a failure after successful playback', async () => {
    const failure = vi.fn();
    await playFilm({ play: vi.fn().mockResolvedValue(undefined) }, failure);
    expect(failure).not.toHaveBeenCalled();
  });
});
