import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { TwingsStudio, type StudioLabels, type StudioStyle } from '@/components/twings/studio';

/**
 * The studio as MARKUP — the first render, before any interaction. What it says to someone who
 * has not uploaded anything yet is the whole first impression, and it is static HTML.
 */

const dict = getDictionary('en');
const labels: StudioLabels = {
  stepPhoto: dict.studio.stepPhoto,
  stepStyle: dict.studio.stepStyle,
  stepPay: dict.studio.stepPay,
  stepResult: dict.studio.stepResult,
  dropZone: dict.studio.dropZone,
  dropHint: dict.studio.dropHint,
  changePhoto: dict.studio.changePhoto,
  chooseStyle: dict.studio.chooseStyle,
  payCta: dict.studio.payCta,
  payNote: dict.studio.payNote,
  demoBadge: dict.studio.demoBadge,
  rendering: dict.studio.rendering,
  renderingNote: dict.studio.renderingNote,
  resultHeading: dict.studio.resultHeading,
  resultNote: dict.studio.resultNote,
  again: dict.studio.again,
  runtimeLabel: dict.studio.runtimeLabel,
  needPhoto: dict.studio.needPhoto,
  noStyles: dict.studio.noStyles,
  seePrompt: dict.studio.seePrompt,
};

const styles: StudioStyle[] = [
  {
    id: 'seoul-90s',
    title: '90s Seoul Interview',
    price: '$4',
    runtime: '15',
    blurb: '1994 Seoul, shot on Betacam',
    posterSrc: '/p.jpg',
    videoSrc: '/v.mp4',
    promptHref: '/en/prompts/90s-seoul-interview',
  },
];

describe('the studio before a photo exists', () => {
  const html = renderToStaticMarkup(<TwingsStudio styles={styles} labels={labels} />);

  it('says why the button is asleep, and ties the reason to the button', () => {
    expect(html).toContain('data-studio-hint');
    expect(html).toContain(dict.studio.needPhoto);
    expect(html).toMatch(/data-pay-cta="true"[^>]*disabled=""/);
    expect(html).toMatch(/data-pay-cta="true"[^>]*aria-describedby="studio-cta-hint"/);
  });

  it('makes the drop zone a real label for a named file input, so a keyboard reaches it', () => {
    expect(html).toContain('<label for="studio-photo"');
    expect(html).toMatch(/<input[^>]*id="studio-photo"[^>]*aria-label="[^"]+"/);
    // No click handler on a div doing a button's job.
    expect(html).not.toContain('role="button"');
  });

  it('still wears the demo badge — the mock says it is a mock', () => {
    expect(html).toContain('data-demo-badge');
    expect(html).toContain(dict.studio.demoBadge);
  });
});

describe('the studio with no scene to sell', () => {
  it('closes politely instead of rendering an empty grid and a dead button', () => {
    const html = renderToStaticMarkup(<TwingsStudio styles={[]} labels={labels} />);
    expect(html).toContain('data-phase="empty"');
    expect(html).toContain(dict.studio.noStyles);
    expect(html).not.toContain('data-pay-cta');
    expect(html).not.toContain('data-style-option');
  });
});
