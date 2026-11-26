import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MakeLauncherView } from '@/components/templates/make-launcher';
import { MakeSheet } from '@/components/templates/make-sheet';
import { ReferenceFiles, downloadHref } from '@/components/recipes/reference-files';
import { HowItWasMade } from '@/components/recipes/how-it-was-made';
import { en, type Dictionary } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * The template page's make box and sheet, and the recipe's reference files (founder, 2026-10-29):
 * credits for a member, "Subscribe to make it here" for a visitor, never won or dollar; the make card
 * opens as a sheet; a reference file opens large and downloads.
 */

const labels = (dict: Dictionary) => ({ subscribeCta: dict.templates.subscribeCta, credits: dict.templates.credits, makeCta: dict.templates.makeCta, makeCtaClosed: dict.templates.makeCtaClosed });
const signin = '/en/signin?next=%2Fen%2Ft%2Fgoldfish%23make';

describe('the make launcher', () => {
  it('shows the price to every reader and no credits while a price is given', () => {
    for (const access of [null, { signedIn: false, live: false }, { signedIn: true, live: true }]) {
      const html = renderToStaticMarkup(<MakeLauncherView credits={25} price={{ value: '6,900원', label: '1회 결제' }} signinHref={signin} labels={labels(ko)} access={access} />);
      expect(html).toContain('data-template-price');
      expect(html).toContain('6,900원');
      expect(html).not.toContain('크레딧');
    }
  });

  it('asks a visitor to subscribe, one tap to the sign-up that returns to the sheet, with no cost shown', () => {
    for (const access of [null, { signedIn: false, live: false }]) {
      const html = renderToStaticMarkup(<MakeLauncherView credits={25} signinHref={signin} labels={labels(en)} access={access} />);
      expect(html.split(en.templates.subscribeCta).length - 1).toBe(2);
      expect(html.split(`href="${signin}"`).length - 1).toBe(2);
      expect(html).not.toContain('data-template-credits');
      expect(html).not.toContain('25 credits');
    }
  });

  it('shows a member the cost in credits and opens the sheet', () => {
    const live = renderToStaticMarkup(<MakeLauncherView credits={25} signinHref={signin} labels={labels(ko)} access={{ signedIn: true, live: true }} />);
    expect(live).toContain('data-template-credits');
    expect(live).toContain('25크레딧');
    expect(live).toContain('href="#make"');
    expect(live).toContain(ko.templates.makeCta);
    expect(live).not.toContain(ko.templates.subscribeCta);
    const closed = renderToStaticMarkup(<MakeLauncherView credits={25} signinHref={signin} labels={labels(ko)} access={{ signedIn: true, live: false }} />);
    expect(closed).toContain(ko.templates.makeCtaClosed);
  });

  it('opens with its lead (the selfie promise) and keeps the phone bar down until the box goes by', () => {
    const html = renderToStaticMarkup(
      <MakeLauncherView credits={25} signinHref={signin} labels={labels(en)} access={{ signedIn: true, live: true }} lead={<p>ONE_SELFIE</p>} stickyAfter />,
    );
    expect(html.indexOf('data-make-lead')).toBeLessThan(html.indexOf('data-template-credits'));
    expect(html).toContain('ONE_SELFIE');
    expect(html).toMatch(/<div[^>]*data-make-sticky[^>]*data-make-sticky-state="away"/);
  });
});

describe('how it was made, in the column', () => {
  const long = { presentation: 'story-first' as const, intro: null, outro: null, steps: [{ n: 1, kind: 'video' as const, engine: 'SEEDANCE 2.5', inputs: [], prompt: `[My photo] ${'Shot detail. '.repeat(80)}`, note: null }], files: null };

  // 2026-11-26: the tip is a labelled box above the prompt, so it stays in view while the prompt is folded.
  it("keeps the creative's intro, the labelled step tip above its prompt and the closing line, at the column's size", () => {
    const html = renderToStaticMarkup(<HowItWasMade recipe={{ ...long, intro: 'INTRO_LINE', outro: 'OUTRO_LINE', steps: [{ ...long.steps[0]!, note: 'TIP_LINE' }] }} copy={ko.makerRecipe} compact />);
    expect(/<p[^>]*data-recipe-intro[^>]*>/.exec(html)![0]).toContain('text-sm');
    expect(html.indexOf('INTRO_LINE')).toBeLessThan(html.indexOf('data-recipe-prompt'));
    expect(html).toContain(ko.makerRecipe.how.tipHeading);
    expect(html.indexOf('TIP_LINE')).toBeLessThan(html.indexOf('data-recipe-prompt'));
    expect(html.indexOf('TIP_LINE')).toBeLessThan(html.indexOf('data-recipe-expand'));
    expect(html.indexOf('data-recipe-expand')).toBeLessThan(html.indexOf('OUTRO_LINE'));
    expect(html).not.toContain(ko.makerRecipe.how.lede);
  });

  it('folds a long prompt behind one tap, with the copy button still on top', () => {
    const html = renderToStaticMarkup(<HowItWasMade recipe={long} copy={ko.makerRecipe} compact />);
    expect(html).toContain('data-recipe-prompt="folded"');
    expect(html).toContain('data-recipe-expand');
    expect(html).toContain(ko.makerRecipe.how.expand);
    expect(html).toContain(ko.makerRecipe.how.copy);
  });

  // 2026-11-26: a long prompt folds in the full-width section too; a short one never shows the toggle.
  it('folds a long prompt in the full-width section as well, and leaves a short one alone', () => {
    const html = renderToStaticMarkup(<HowItWasMade recipe={long} copy={ko.makerRecipe} />);
    expect(html).toContain('data-recipe-prompt="folded"');
    expect(html).toContain('data-recipe-expand');
    const short = renderToStaticMarkup(<HowItWasMade recipe={{ ...long, steps: [{ ...long.steps[0]!, prompt: '[My photo] One short line.' }] }} copy={ko.makerRecipe} />);
    expect(short).not.toContain('data-recipe-prompt="folded"');
    expect(short).not.toContain('data-recipe-expand');
  });
});

describe('the make sheet', () => {
  it('is a closed dialog holding its content, with a close button, overscroll containment, and 24px card radius', () => {
    const html = renderToStaticMarkup(<MakeSheet title="Goldfish" closeLabel="Close"><section id="make">studio</section></MakeSheet>);
    expect(html).toMatch(/^<dialog[^>]*data-make-sheet/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain('overscroll-contain');
    expect(html).toContain('rounded-t-[24px]');
    expect(html).toContain('data-make-sheet-handle');
    expect(html).toContain('id="make"');
    expect(html).toContain('data-make-sheet-close');
  });
});

describe('reference files', () => {
  const files = [
    { n: 1, href: '/api/makers/files/ast_0123456789abcdef0123456789abcdef', download: '/api/makers/files/ast_0123456789abcdef0123456789abcdef?download=1', kind: 'image' as const },
    { n: 2, href: '/api/makers/files/ast_fedcba9876543210fedcba9876543210', download: '/api/makers/files/ast_fedcba9876543210fedcba9876543210?download=1', kind: 'video' as const },
  ];

  it('opens each file in a viewer and offers a download of each', () => {
    const html = renderToStaticMarkup(<ReferenceFiles files={files} copy={ko.makerRecipe} />);
    expect(html).toContain('data-recipe-file-open="1"');
    expect(html).toContain('data-recipe-file-open="2"');
    expect(html).toContain(`href="${files[0]!.href}?download=1"`);
    expect(html).toContain(`href="${files[1]!.href}?download=1"`);
    expect(html).toContain('data-recipe-file-viewer');
    expect(html).toContain(ko.makerRecipe.how.download);
  });

  it('adds the download flag to an address with or without a query', () => {
    expect(downloadHref('/api/makers/files/ast_x')).toBe('/api/makers/files/ast_x?download=1');
    expect(downloadHref('/api/makers/files/ast_x?v=2')).toBe('/api/makers/files/ast_x?v=2&download=1');
  });
});
