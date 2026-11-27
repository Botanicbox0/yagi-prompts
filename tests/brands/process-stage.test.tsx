import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ProcessStage } from '@/components/brand-workspace/process-stage';
import { campaignOpsSteps } from '@/components/brand-workspace/campaign-ops/model';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const ko = getDictionary('ko').campaignOps;
const mounted: MountedDom[] = [];

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
    public pointerType: 'mouse' | 'touch' | 'pen' = 'mouse',
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

class FocusLike {
  bubbles = true;
  cancelable = false;
  defaultPrevented = false;
  cancelBubble = false;
  target: unknown = null;
  currentTarget: unknown = null;
  constructor(
    public type: 'focusin' | 'focusout',
    public relatedTarget: unknown = null,
  ) {}
  preventDefault() {}
  stopPropagation() {
    this.cancelBubble = true;
  }
  stopImmediatePropagation() {
    this.cancelBubble = true;
  }
}

class AnimEndLike {
  bubbles = true;
  cancelable = false;
  defaultPrevented = false;
  cancelBubble = false;
  target: unknown = null;
  currentTarget: unknown = null;
  type = 'animationend';
  preventDefault() {}
  stopPropagation() {
    this.cancelBubble = true;
  }
  stopImmediatePropagation() {
    this.cancelBubble = true;
  }
}

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProcessStage', () => {
  const campaignSteps = campaignOpsSteps('campaigns', ko);
  const productionSteps = campaignOpsSteps('production', ko);

  it('renders all steps in order with aria-current="step", example caption, aria-hidden pictures, and no timers in source', () => {
    const dir = join(process.cwd(), 'components', 'brand-workspace', 'process-stage');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/\bsetInterval\b|\bsetTimeout\b/);
    }
    const css = readFileSync(join(dir, 'process-stage.module.css'), 'utf8');
    expect(css).toContain('animation-play-state: paused');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');

    const html = renderToStaticMarkup(
      <ProcessStage
        steps={campaignSteps}
        ariaLabel={ko.campaigns.how.title}
        exampleCaption={ko.campaigns.how.example}
        pic={ko.pic}
      />,
    );
    expect(html).toContain('data-process-stage');
    expect(html).toContain('data-step="1"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(ko.campaigns.how.example);
    expect(html).toContain('data-process-pic="c-brief"');
    expect(html).toContain(ko.pic.brief.review);
    expect(html).toContain('aria-hidden="true"');
  });

  it('advances on animationend and wraps around after the last step with aria-live="off"', async () => {
    const dom = await mountDom(
      <ProcessStage
        steps={productionSteps}
        ariaLabel={ko.production.how.title}
        exampleCaption={ko.production.how.example}
        pic={ko.pic}
      />,
    );
    mounted.push(dom);

    const active = () => dom.query('[aria-current="step"]')!.getAttribute('data-step');
    const body = () => dom.query('[data-process-body]')!;
    const live = () => dom.query('[data-process-live]')!;
    expect(active()).toBe('1');
    expect(body().hasAttribute('aria-live')).toBe(false);
    expect(live().getAttribute('aria-live')).toBe('polite');
    expect(live().textContent).toBe('');

    for (const expected of ['2', '3', '4', '5', '1']) {
      const bar = dom.query('[data-process-bar-fill]')!;
      await act(async () => {
        bar.dispatchEvent(new AnimEndLike() as never);
      });
      expect(active()).toBe(expected);
      expect(body().hasAttribute('aria-live')).toBe(false);
      expect(live().textContent).toBe('');
    }
  });

  it('jumps on click and Enter/Space, announces via dedicated polite region on user change, and names region only', async () => {
    const dom = await mountDom(
      <ProcessStage
        steps={campaignSteps}
        ariaLabel={ko.campaigns.how.title}
        exampleCaption={ko.campaigns.how.example}
        pic={ko.pic}
      />,
    );
    mounted.push(dom);

    expect(dom.query('[role="region"]')?.getAttribute('aria-label')).toBe(ko.campaigns.how.title);
    expect(dom.query('ol')?.hasAttribute('aria-label')).toBe(false);

    await dom.click('[data-segment-index="4"]');
    expect(dom.query('[aria-current="step"]')?.getAttribute('data-step')).toBe('4');
    expect(dom.query('[data-process-pic="c-pick"]')).not.toBeNull();
    expect(dom.query('[data-process-body]')?.hasAttribute('aria-live')).toBe(false);
    expect(dom.query('[data-process-body]')?.textContent).toBe(ko.campaigns.steps.step4.body);
    expect(dom.query('[data-process-live]')?.getAttribute('aria-live')).toBe('polite');
    expect(dom.query('[data-process-live]')?.textContent).toBe(ko.campaigns.steps.step4.body);

    const seg2 = dom.query('[data-segment-index="2"]')!;
    await dom.keyDown('Enter', { target: seg2 });
    expect(dom.query('[aria-current="step"]')?.getAttribute('data-step')).toBe('2');
    expect(dom.query('[data-process-live]')?.textContent).toBe(ko.campaigns.steps.step2.body);

    const seg6 = dom.query('[data-segment-index="6"]')!;
    await dom.keyDown(' ', { target: seg6 });
    expect(dom.query('[aria-current="step"]')?.getAttribute('data-step')).toBe('6');
    expect(dom.query('[data-process-pic="c-report"]')).not.toBeNull();

    // Clicking active step restarts fill (replaces bar element).
    const beforeBar = dom.query('[data-process-bar-fill]');
    await dom.click('[data-segment-index="6"]');
    const afterBar = dom.query('[data-process-bar-fill]');
    expect(afterBar).not.toBeNull();
    expect(afterBar).not.toBe(beforeBar);
  });

  it('pauses on pointer hover and :focus-visible keyboard focus only (mouse click focus does not pause)', async () => {
    const dom = await mountDom(
      <ProcessStage
        steps={campaignSteps}
        ariaLabel={ko.campaigns.how.title}
        exampleCaption={ko.campaigns.how.example}
        pic={ko.pic}
      />,
    );
    mounted.push(dom);

    const root = dom.query('[data-process-stage]')!;
    expect(root.getAttribute('data-paused')).toBe('false');
    expect(dom.query('[data-process-bar-fill]')!.style.animationPlayState).toBe('running');

    await act(async () => {
      root.dispatchEvent(new PointerLike('pointerover') as never);
    });
    expect(root.getAttribute('data-paused')).toBe('true');
    expect(dom.query('[data-process-bar-fill]')!.style.animationPlayState).toBe('paused');

    await act(async () => {
      root.dispatchEvent(new PointerLike('pointerout') as never);
    });
    expect(root.getAttribute('data-paused')).toBe('false');

    const seg = dom.query('[data-segment-index="2"]')! as unknown as HTMLElement & {
      matches?: (selector: string) => boolean;
    };
    // Pointer click focus (:focus-visible = false) must NOT pause the stage.
    let focusVisible = false;
    seg.matches = () => focusVisible;
    await act(async () => {
      seg.dispatchEvent(new FocusLike('focusin') as never);
    });
    expect(root.getAttribute('data-paused')).toBe('false');

    // Keyboard focus (:focus-visible = true) MUST pause the stage until blur.
    focusVisible = true;
    await act(async () => {
      seg.dispatchEvent(new FocusLike('focusin') as never);
    });
    expect(root.getAttribute('data-paused')).toBe('true');
    expect(dom.query('[data-process-bar-fill]')!.style.animationPlayState).toBe('paused');

    await act(async () => {
      seg.dispatchEvent(new FocusLike('focusout', dom.document.body) as never);
    });
    expect(root.getAttribute('data-paused')).toBe('false');
  });

  it('does not auto-advance when prefers-reduced-motion: reduce matches', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));

    const dom = await mountDom(
      <ProcessStage
        steps={campaignSteps}
        ariaLabel={ko.campaigns.how.title}
        exampleCaption={ko.campaigns.how.example}
        pic={ko.pic}
      />,
    );
    mounted.push(dom);

    const root = dom.query('[data-process-stage]')!;
    expect(root.getAttribute('data-reduced-motion')).toBe('true');

    const bar = dom.query('[data-process-bar-fill]')!;
    await act(async () => {
      bar.dispatchEvent(new AnimEndLike() as never);
    });
    expect(dom.query('[aria-current="step"]')?.getAttribute('data-step')).toBe('1');
  });
});
