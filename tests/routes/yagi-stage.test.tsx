import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { HeroStage } from '@/components/yagi/hero-stage';
import { mayPreviewFilm } from '@/lib/yagi/playback';

describe('studio opening and preview playback', () => {
  it('renders its heading and film choices in HTML while mounting only the selected film', () => {
    const t = getDictionary('ko').yagi;
    const html = renderToStaticMarkup(<HeroStage t={t} />);
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain(t.headline);
    expect(html).toContain(t.definition);
    expect(html).toContain('data-service-definition');
    expect(html).toContain(t.work.beauty.title);
    expect(html).toContain(t.work.highteen.title);
    expect((html.match(/<video/g) ?? []).length).toBe(1);
    expect(html).toContain('beauty-rose.mp4');
    expect(html).not.toContain('highteen.mp4');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('permits desktop previews but preserves deliberate pauses, motion preferences and hidden pages', () => {
    const allowed = { hoverCapable: true, reducedMotion: false, hidden: false, manuallyPaused: false, viewerOpen: false };
    expect(mayPreviewFilm(allowed)).toBe(true);
    for (const blocked of [
      { hoverCapable: false }, { reducedMotion: true }, { hidden: true },
      { manuallyPaused: true }, { viewerOpen: true },
    ]) expect(mayPreviewFilm({ ...allowed, ...blocked })).toBe(false);
  });
});
