import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Explainer, explainerDismissed, type ExplainerProps } from '@/components/brand-studio/explainer';

/**
 * docs/BRAND-STUDIO-V3.md §3 — the first-use explainer the image, video and review screens mount.
 * The server cannot know whether this browser dismissed it, so the first paint is hidden (no flash for
 * a returning person) with the whole text already in the markup.
 */
const base: ExplainerProps = {
  storageKey: 'twings_explainer_test_v1',
  title: '브랜드 이미지를 바로 만들어요',
  line: '참조를 끌어다 놓고 한 줄로 말하면 됩니다.',
  actions: [
    { label: '지금 만들기', event: 'twings:test-focus', primary: true },
    { label: '예시 보기', href: '/brand/studio?example=1' },
    { label: '세 번째는 넘쳐요', href: '/x' },
  ],
  stepsTitle: '어떻게 진행되나요?',
  steps: Array.from({ length: 8 }, (_, i) => ({ title: `단계 ${i + 1}`, line: `설명 ${i + 1}` })),
  dismissLabel: '다시 보지 않기',
  reopenLabel: '설명 다시 보기',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Explainer', () => {
  it('renders hidden on the server with the hero, up to two actions and up to six steps', () => {
    const html = renderToStaticMarkup(<Explainer {...base} />);
    expect(html).toMatch(/<section[^>]*data-studio-explainer="twings_explainer_test_v1"[^>]*hidden/);
    expect(html).toContain('data-explainer-state="pending"');
    expect(html).toContain(base.title);
    expect(html).toContain(base.line);
    expect(html).toContain(base.stepsTitle!);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('data-explainer-action="primary"');
    expect(html).toContain('href="/brand/studio?example=1"');
    expect(html).not.toContain('세 번째는 넘쳐요');
    expect((html.match(/data-explainer-step=/g) ?? []).length).toBe(6);
    expect(html).not.toContain('단계 7');
    expect(html).toContain(base.dismissLabel);
    // Ordered list: the numbers are presentation; the list itself carries the order.
    expect(html).toContain('<ol');
  });

  it('looks complete without media and puts media in its slot when given', () => {
    const plain = renderToStaticMarkup(<Explainer {...base} />);
    expect(plain).toContain('data-has-media="false"');
    expect(plain).not.toContain('data-explainer-media');
    const withMedia = renderToStaticMarkup(<Explainer {...base} media={<img src="/x.webp" alt="" />} steps={base.steps.slice(0, 3)} />);
    expect(withMedia).toContain('data-has-media="true"');
    expect(withMedia).toMatch(/data-explainer-media[^>]*><img src="\/x.webp"/);
    expect((withMedia.match(/data-explainer-step=/g) ?? []).length).toBe(3);
  });

  it('names the section by its title for assistive technology', () => {
    const html = renderToStaticMarkup(<Explainer {...base} />);
    const id = /<h2 id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${id}"`);
  });
});

describe('explainerDismissed', () => {
  it('reads the stored choice and treats blocked storage as not dismissed', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    expect(explainerDismissed('k')).toBeNull();
    store.set('k', '1');
    expect(explainerDismissed('k')).toBe(true);
    store.set('k', '0');
    expect(explainerDismissed('k')).toBe(false);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(explainerDismissed('k')).toBeNull();
  });
});
